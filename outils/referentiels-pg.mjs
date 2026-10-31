// Référentiels de Matrix sur le serveur commun (écart E-01, docs/proposition.md § 6) : pays, zones, filiales, sites et
// organigramme saisis dans l'écran Référentiels sont écrits dans les tables du schéma matrix
// (infra/postgres/partage/10-matrix-referentiels.sql), que les outils lisent par les vues matrix.pub_*.
//
// Connexion en matrix_app, propriétaire de ces tables. Une liste s'écrit en une transaction, sous le verrou
// hashtext('matrix.referentiels') : chaque ligne saisie est insérée ou mise à jour (seulement si elle change, pour ne pas
// déplacer modifie_le) ; une ligne absente de la saisie n'est jamais supprimée (les outils gardent son code), elle est
// désactivée (actif = false). Les règles de validation sont celles d'outils/edition.mjs, qui reprennent les contraintes
// du schéma ; une contrainte que la saisie ne connaît pas (unicité d'un nom, par exemple) est renvoyée telle quelle.

export const LISTES = ['pays', 'zones', 'filiales', 'sites', 'organigramme'];  // ordre des dépendances

const DEF = {
  pays: { table: 'matrix.pays', cle: 'iso2', colonnes: ['iso2', 'iso3', 'nom_fr', 'nom_en', 'actif'] },
  zones: { table: 'matrix.zones', cle: 'code', colonnes: ['code', 'libelle', 'responsable', 'ordre', 'actif', 'ouest', 'nord', 'est', 'sud'], nombres: ['ouest', 'nord', 'est', 'sud'] },
  filiales: { table: 'matrix.filiales', cle: 'code', colonnes: ['code', 'nom', 'pays_iso2', 'zone_code', 'devise', 'ordre', 'actif'] },
  sites: { table: 'matrix.sites', cle: 'code', colonnes: ['code', 'libelle', 'ville', 'pays_iso2', 'ordre', 'actif', 'filiale_code', 'latitude', 'longitude'], nombres: ['latitude', 'longitude'] },
  organigramme: { table: 'matrix.organigramme', cle: 'code', colonnes: ['code', 'niveau', 'parent_code', 'libelle_fr', 'libelle_en', 'responsable_matricule', 'site_code', 'ordre', 'actif'] },
};
const NIVEAU = { departement: 0, service: 1, equipe: 2 };

// Une ligne telle que la saisie la produit (mêmes clés, même ordre, nombres en nombres, char(3) sans espaces).
function normaliser(liste, ligne) {
  const d = DEF[liste], out = {};
  for (const c of d.colonnes) {
    let v = ligne[c] ?? null;
    if (v != null && d.nombres?.includes(c)) v = Number(v);
    if (typeof v === 'string' && c === 'devise') v = v.trim();
    out[c] = v;
  }
  return out;
}

/** Lit les cinq référentiels du schéma matrix, lignes désactivées comprises. */
export async function lireReferentiels(db) {
  const out = {};
  for (const liste of LISTES) {
    const d = DEF[liste];
    const ordre = liste === 'pays' ? 'iso2' : liste === 'organigramme' ? 'ordre, code' : 'ordre, code';
    const { rows } = await db.query(`SELECT ${d.colonnes.join(', ')} FROM ${d.table} ORDER BY ${ordre}`);
    out[liste] = rows.map(r => normaliser(liste, r));
  }
  return out;
}

/**
 * Écart entre la saisie et le serveur pour une liste : lignes à écrire (absentes ou différentes sur le serveur) et lignes
 * actives du serveur absentes de la saisie (à désactiver). Une ligne déjà désactivée sur le serveur et absente de la
 * saisie n'est pas un écart.
 */
export function comparer(liste, saisie, serveur) {
  const cle = DEF[liste].cle;
  const S = new Map(serveur.map(r => [r[cle], JSON.stringify(normaliser(liste, r))]));
  const L = new Set(saisie.map(r => r[cle]));
  const aEcrire = saisie.filter(r => S.get(r[cle]) !== JSON.stringify(normaliser(liste, r))).map(r => r[cle]);
  const aDesactiver = serveur.filter(r => r.actif && !L.has(r[cle])).map(r => r[cle]);
  return { aEcrire, aDesactiver, egal: !aEcrire.length && !aDesactiver.length };
}

async function ecrireListe(db, liste, lignes) {
  const d = DEF[liste], cols = d.colonnes, cle = d.cle;
  const rangees = liste === 'organigramme' ? [...lignes].sort((a, b) => NIVEAU[a.niveau] - NIVEAU[b.niveau]) : lignes;
  const autres = cols.filter(c => c !== cle);
  const sql = `INSERT INTO ${d.table} AS t (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
    ON CONFLICT (${cle}) DO UPDATE SET ${autres.map(c => `${c} = EXCLUDED.${c}`).join(', ')}
    WHERE (${autres.map(c => `t.${c}`).join(', ')}) IS DISTINCT FROM (${autres.map(c => `EXCLUDED.${c}`).join(', ')})`;
  let ecrites = 0;
  for (const r of rangees) ecrites += (await db.query(sql, cols.map(c => r[c] ?? null))).rowCount;
  const codes = lignes.map(r => r[cle]);
  const { rowCount: desactivees } = await db.query(
    `UPDATE ${d.table} SET actif = false WHERE actif AND NOT (${cle} = ANY ($1::text[]))`, [codes]);
  return { ecrites, desactivees };
}

/**
 * Écrit des listes validées (objet { liste: lignes }) dans une seule transaction, dans l'ordre des dépendances.
 * Renvoie, par liste, le nombre de lignes écrites et désactivées. Une erreur annule tout.
 */
export async function ecrireReferentiels(db, listes) {
  const bilan = {};
  await db.query('BEGIN');
  try {
    await db.query("SELECT pg_advisory_xact_lock(hashtext('matrix.referentiels'))");
    for (const liste of LISTES) if (listes[liste]) bilan[liste] = await ecrireListe(db, liste, listes[liste]);
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw new Error(`le serveur commun refuse l'enregistrement (rien n'est modifié) : ${e.message}`);
  }
  return bilan;
}
