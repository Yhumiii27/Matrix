// Saisies de la DSI sur le serveur commun (décision M-04 du 04/11/2026 : « DSI seule ») : glossaire métier (écart
// E-08) et règles de qualité des données (écart E-09), dans le schéma matrix (partage/17-matrix-glossaire-qualite.sql,
// rôle matrix_app).
//
// Même discipline que les saisies d'E-04 (outils/edition-pg.mjs) : une transaction par modification, ligne verrouillée,
// version contrôlée (maj_le vue par l'écran ; une modification préparée sur une version dépassée est refusée, code
// « conflit »), entrée de matrix.journal dans la même transaction. Rien ne se supprime : un terme ou une règle retirés
// passent à actif = false.

import { Conflit } from './edition.mjs';
import { validerRegle } from './qualite.mjs';

const iso = d => d ? (d instanceof Date ? d : new Date(d)).toISOString() : null;
const quandLisible = d => d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' }) : '';

async function enTransaction(db, tache) {
  await db.query('BEGIN');
  try { const r = await tache(); await db.query('COMMIT'); return r; } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; }
}

function controlerVersion(objet, version, actuelle) {
  if (version === undefined) return;
  if (iso(actuelle?.majLe) !== iso(version))
    throw new Conflit(`${objet} a été modifié entre-temps${actuelle?.majPar ? ` par ${actuelle.majPar}` : ''}${actuelle?.majLe ? ` le ${quandLisible(actuelle.majLe)}` : ''} : rechargez, puis refaites votre modification.`, actuelle ?? null);
}

const texte = (v, max, nom, obligatoire = false) => {
  const t = v == null ? '' : String(v).trim();
  if (obligatoire && !t) throw new Error(`${nom} : obligatoire`);
  if (t.length > max) throw new Error(`${nom} : ${max} caractères au plus`);
  return t || null;
};
const liste = v => (Array.isArray(v) ? v : String(v ?? '').split(/[\n,;]/)).map(x => String(x).trim()).filter(Boolean);

/** Identifiant d'un terme : son libellé sans accents, en minuscules, mots reliés par des tirets. */
export const idTerme = terme => String(terme ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// ── Glossaire ───────────────────────────────────────────────────────────────

/**
 * Contrôle un terme saisi. `catalogue` sert à vérifier les colonnes reliées (outil.table.colonne). Renvoie
 * { id, fiche, version } ; version : maj_le vue par l'écran (null pour un nouveau terme, absente : pas de contrôle).
 */
export function validerTerme(saisie, catalogue) {
  const terme = texte(saisie?.terme, 120, 'Terme', true);
  const id = String(saisie?.id ?? '').trim() || idTerme(terme);
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(id)) throw new Error(`identifiant invalide (« ${id} ») : minuscules, chiffres et tirets`);
  const definition = texte(saisie?.definition, 4000, 'Définition', true);
  const synonymes = [...new Set(liste(saisie?.synonymes).map(s => s.slice(0, 120)))];
  if (synonymes.length > 20) throw new Error('20 synonymes au plus');
  const connues = new Set((catalogue?.apps ?? []).flatMap(a => a.tables.flatMap(t => t.columns.map(c => `${a.id}.${t.name}.${c.name}`))));
  const colonnes = [...new Set(liste(saisie?.colonnes))].sort();
  for (const c of colonnes) {
    if (!/^(keystone|codex|cursus|vigie|arche|crucible)\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(c)) throw new Error(`colonne invalide (« ${c} ») : outil.table.colonne attendu`);
    if (!connues.has(c)) throw new Error(`colonne inconnue du catalogue : ${c}`);
  }
  return {
    id,
    fiche: { terme, definition, synonymes, domaine: texte(saisie?.domaine, 80, 'Domaine'), proprietaire: texte(saisie?.proprietaire, 120, 'Propriétaire'), colonnes, actif: saisie?.actif !== false },
    version: saisie?.version,
  };
}

const ligneTerme = l => ({ id: l.id, terme: l.terme, definition: l.definition, synonymes: l.synonymes ?? [], domaine: l.domaine, proprietaire: l.proprietaire,
  colonnes: l.colonnes ?? [], actif: l.actif, majLe: iso(l.maj_le), majPar: l.maj_par });

/** Les tables de partage/17 existent-elles ? */
export async function saisiesDisponibles(db) {
  const { rows: [r] } = await db.query(`SELECT to_regclass('matrix.glossaire') IS NOT NULL AND to_regclass('matrix.regles_qualite') IS NOT NULL AS ok`);
  return r.ok;
}

/** Tout le glossaire, retirés compris, par terme. */
export async function lireGlossaire(db) {
  const { rows } = await db.query('SELECT * FROM matrix.glossaire ORDER BY lower(terme), id');
  return rows.map(ligneTerme);
}

/** Enregistre un terme (nouveau, modifié ou retiré), verrou, version et journal compris. Renvoie le terme enregistré. */
export async function enregistrerTerme(db, catalogue, saisie, qui) {
  const { id, fiche, version } = validerTerme(saisie, catalogue);
  return enTransaction(db, async () => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`matrix.glossaire:${id}`]);
    const { rows: [l] } = await db.query('SELECT * FROM matrix.glossaire WHERE id = $1 FOR UPDATE', [id]);
    const actuel = l ? ligneTerme(l) : undefined;
    controlerVersion(`Le terme « ${actuel?.terme ?? fiche.terme} »`, version, actuel);
    const changes = Object.keys(fiche).filter(k => JSON.stringify(actuel?.[k] ?? null) !== JSON.stringify(fiche[k] ?? null));
    if (actuel && !changes.length) return actuel;
    const { rows: [r] } = await db.query(
      `INSERT INTO matrix.glossaire (id, terme, definition, synonymes, domaine, proprietaire, colonnes, actif, maj_le, maj_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, clock_timestamp(), $9)
       ON CONFLICT (id) DO UPDATE SET terme = EXCLUDED.terme, definition = EXCLUDED.definition, synonymes = EXCLUDED.synonymes,
         domaine = EXCLUDED.domaine, proprietaire = EXCLUDED.proprietaire, colonnes = EXCLUDED.colonnes, actif = EXCLUDED.actif,
         maj_le = EXCLUDED.maj_le, maj_par = EXCLUDED.maj_par
       RETURNING *`,
      [id, fiche.terme, fiche.definition, fiche.synonymes, fiche.domaine, fiche.proprietaire, fiche.colonnes, fiche.actif, qui]);
    const action = !actuel ? 'Terme ajouté au glossaire' : actuel.actif && !fiche.actif ? 'Terme retiré du glossaire' : 'Terme du glossaire modifié';
    await db.query('INSERT INTO matrix.journal (qui, action, objet, detail) VALUES ($1, $2, $3, $4)', [qui || '—', action, `glossaire:${id}`, actuel ? changes.join(', ') : fiche.terme]);
    return ligneTerme(r);
  });
}

// ── Règles de qualité ───────────────────────────────────────────────────────

const ligneRegle = l => ({ ...l.regle, actif: l.actif, majLe: iso(l.maj_le), majPar: l.maj_par });
// Forme stockée d'une règle : ce que l'on saisit, sans les champs calculés par validerRegle.
const brute = r => {
  const b = { id: r.id, table: r.table, type: r.type, libelle: r.libelle, gravite: r.gravite };
  if (r.type === 'unicite') b.colonnes = r.colonnes; else b.colonne = r.colonnes[0];
  for (const k of ['maxJours', 'seuil', 'min', 'max', 'liste']) if (r[k] !== undefined) b[k] = r[k];
  return b;
};

/** Toutes les règles, retirées comprises, par id. */
export async function lireReglesPg(db) {
  const { rows } = await db.query('SELECT * FROM matrix.regles_qualite ORDER BY id');
  return rows.map(ligneRegle);
}

/** Règles actives, au format de chargerRegles (une règle devenue invalide est écartée et signalée). */
export async function reglesActives(db) {
  const erreurs = [], regles = [];
  for (const r of (await lireReglesPg(db)).filter(r => r.actif)) {
    try { regles.push(validerRegle(r)); } catch (e) { erreurs.push(e.message); }
  }
  return { regles, erreurs };
}

/** Premier passage : table vide, reprise de data/regles-qualite.json. Renvoie le nombre de règles reprises, ou null. */
export async function reprendreRegles(db, doc) {
  return enTransaction(db, async () => {
    await db.query('LOCK TABLE matrix.regles_qualite IN SHARE ROW EXCLUSIVE MODE');
    const { rows: [n] } = await db.query('SELECT count(*)::int AS n FROM matrix.regles_qualite');
    if (n.n > 0) return null;
    const regles = (doc?.regles ?? []).map(validerRegle).map(brute);
    for (const r of regles) await db.query('INSERT INTO matrix.regles_qualite (id, regle, maj_par) VALUES ($1, $2, $3)', [r.id, r, 'reprise (data/regles-qualite.json)']);
    await db.query(`INSERT INTO matrix.journal (qui, action, objet, detail) VALUES ('Matrix', 'Règles de qualité reprises sur le serveur commun', 'data/regles-qualite.json', $1)`, [`${regles.length} règle(s) (E-09, M-04)`]);
    return regles.length;
  });
}

/** Enregistre une règle (nouvelle, modifiée ou retirée : actif = false), verrou, version et journal compris. */
export async function enregistrerRegle(db, saisie, qui) {
  const { version, actif = true, majLe, majPar, ...reste } = saisie ?? {};
  const regle = brute(validerRegle(reste));
  return enTransaction(db, async () => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`matrix.regles_qualite:${regle.id}`]);
    const { rows: [l] } = await db.query('SELECT * FROM matrix.regles_qualite WHERE id = $1 FOR UPDATE', [regle.id]);
    const actuelle = l ? ligneRegle(l) : undefined;
    controlerVersion(`La règle ${regle.id}`, version, actuelle);
    if (actuelle && actuelle.actif === (actif !== false) && JSON.stringify(brute(validerRegle(actuelle))) === JSON.stringify(regle)) return actuelle;
    const { rows: [r] } = await db.query(
      `INSERT INTO matrix.regles_qualite (id, regle, actif, maj_le, maj_par) VALUES ($1, $2, $3, clock_timestamp(), $4)
       ON CONFLICT (id) DO UPDATE SET regle = EXCLUDED.regle, actif = EXCLUDED.actif, maj_le = EXCLUDED.maj_le, maj_par = EXCLUDED.maj_par
       RETURNING *`, [regle.id, regle, actif !== false, qui]);
    const action = !actuelle ? 'Règle de qualité ajoutée' : actuelle.actif && actif === false ? 'Règle de qualité retirée' : 'Règle de qualité modifiée';
    await db.query('INSERT INTO matrix.journal (qui, action, objet, detail) VALUES ($1, $2, $3, $4)', [qui || '—', action, `qualite:${regle.id}`, `${regle.table} · ${regle.libelle}`]);
    return ligneRegle(r);
  });
}
