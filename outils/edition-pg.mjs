// Saisies de Matrix sur le serveur commun (écart E-04, docs/proposition.md § 6) : documentation des tables, décisions sur
// les doublons et journal des modifications, dans le schéma matrix (partage/15-matrix-edition.sql), rôle matrix_app.
//
// Chaque modification se fait dans une transaction : la ligne est verrouillée (SELECT … FOR UPDATE), la version vue par
// l'écran est comparée à la version enregistrée (outils/edition.mjs, controlerVersion…), puis la ligne et son entrée de
// journal sont écrites ensemble. Deux personnes qui modifient la même fiche ne s'écrasent plus : la seconde est refusée
// (Conflit) et doit recharger. Les règles de saisie sont celles d'edition.mjs (mêmes validations, mêmes messages).
// edition.json devient la copie locale (remplacerEdition) : la page, les exports et le repli sans serveur la lisent.

import { validerDocumentation, controlerVersionDoc, validerDecision, controlerVersionDecision } from './edition.mjs';

const JOURNAL_MAX = 2000;

async function enTransaction(db, tache) {
  await db.query('BEGIN');
  try { const r = await tache(); await db.query('COMMIT'); return r; } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; }
}
const iso = d => (d instanceof Date ? d : new Date(d)).toISOString();

/** Les tables de partage/15 existent-elles ? (sinon Matrix reste sur edition.json) */
export async function editionDisponible(db) {
  const { rows: [r] } = await db.query(
    `SELECT to_regclass('matrix.documentation') IS NOT NULL AND to_regclass('matrix.decisions_doublons') IS NOT NULL
            AND to_regclass('matrix.journal') IS NOT NULL AS ok`);
  return r.ok;
}

/** Documentation, décisions et journal (les 2 000 dernières entrées), au format d'edition.json. */
export async function lireEditionPg(db) {
  const { rows: docs } = await db.query('SELECT cle, description, domaine, responsable, note, maj_le, maj_par FROM matrix.documentation ORDER BY cle');
  const { rows: decs } = await db.query('SELECT groupe, option, le, par FROM matrix.decisions_doublons ORDER BY groupe');
  const { rows: jrn } = await db.query(`SELECT quand, qui, action, objet, detail FROM (SELECT * FROM matrix.journal ORDER BY id DESC LIMIT ${JOURNAL_MAX}) j ORDER BY id`);
  return {
    documentation: Object.fromEntries(docs.map(d => [d.cle, { description: d.description, domaine: d.domaine, responsable: d.responsable, note: d.note, majLe: iso(d.maj_le), majPar: d.maj_par }])),
    decisions: Object.fromEntries(decs.map(d => [d.groupe, { option: d.option, le: iso(d.le), par: d.par }])),
    journal: jrn.map(j => ({ quand: iso(j.quand), qui: j.qui, action: j.action, objet: j.objet, detail: j.detail })),
  };
}

/**
 * Premier passage sur le serveur commun : si les trois tables sont vides, le contenu d'edition.json y est repris, en une
 * transaction (journal compris, avec ses dates). Renvoie le nombre de lignes reprises, ou null si le serveur avait déjà
 * des saisies (il fait foi).
 */
export async function reprendreEdition(db, ed) {
  return enTransaction(db, async () => {
    await db.query('LOCK TABLE matrix.documentation, matrix.decisions_doublons IN SHARE ROW EXCLUSIVE MODE');
    const { rows: [n] } = await db.query(
      `SELECT (SELECT count(*) FROM matrix.documentation) + (SELECT count(*) FROM matrix.decisions_doublons) + (SELECT count(*) FROM matrix.journal) AS n`);
    if (Number(n.n) > 0) return null;
    let lignes = 0;
    for (const [cle, d] of Object.entries(ed.documentation ?? {})) {
      await db.query(`INSERT INTO matrix.documentation (cle, description, domaine, responsable, note, maj_le, maj_par) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [cle, d.description ?? null, d.domaine ?? null, d.responsable ?? null, d.note ?? null, d.majLe ?? new Date().toISOString(), d.majPar ?? 'reprise']);
      lignes++;
    }
    for (const [groupe, d] of Object.entries(ed.decisions ?? {})) {
      await db.query('INSERT INTO matrix.decisions_doublons (groupe, option, le, par) VALUES ($1, $2, $3, $4)', [groupe, d.option, d.le ?? new Date().toISOString(), d.par ?? 'reprise']);
      lignes++;
    }
    for (const j of ed.journal ?? []) {
      await db.query('INSERT INTO matrix.journal (quand, qui, action, objet, detail) VALUES ($1, $2, $3, $4, $5)', [j.quand, j.qui || '—', j.action, j.objet, j.detail ?? '']);
      lignes++;
    }
    await db.query(`INSERT INTO matrix.journal (qui, action, objet, detail) VALUES ('Matrix', 'Saisies reprises sur le serveur commun', 'edition.json', $1)`,
      [`${Object.keys(ed.documentation ?? {}).length} fiche(s), ${Object.keys(ed.decisions ?? {}).length} décision(s), ${(ed.journal ?? []).length} entrée(s) de journal (E-04)`]);
    return lignes;
  });
}

/** Ajoute une entrée au journal (référentiels : écrits par leur propre chemin, journalisés ici aussi). */
export async function journaliserPg(db, { qui, action, objet, detail = '' }) {
  await db.query('INSERT INTO matrix.journal (qui, action, objet, detail) VALUES ($1, $2, $3, $4)', [qui || '—', action, objet, detail]);
}

/** Documente une table, verrou et contrôle de version compris. Renvoie la fiche enregistrée. */
export async function documenterPg(db, catalogue, saisie, qui) {
  const { cle, fiche, version } = validerDocumentation(catalogue, saisie);
  return enTransaction(db, async () => {
    // Verrou de la clé, même pour une fiche qui n'existe pas encore (deux premières documentations simultanées).
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`matrix.documentation:${cle}`]);
    const { rows: [l] } = await db.query('SELECT description, domaine, responsable, note, maj_le, maj_par FROM matrix.documentation WHERE cle = $1 FOR UPDATE', [cle]);
    const actuelle = l ? { description: l.description, domaine: l.domaine, responsable: l.responsable, note: l.note, majLe: iso(l.maj_le), majPar: l.maj_par } : undefined;
    controlerVersionDoc(cle, version, actuelle);
    const changes = Object.keys(fiche).filter(k => (actuelle?.[k] ?? null) !== fiche[k]);
    if (!changes.length) return actuelle ?? null;
    const { rows: [r] } = await db.query(
      `INSERT INTO matrix.documentation (cle, description, domaine, responsable, note, maj_le, maj_par) VALUES ($1, $2, $3, $4, $5, clock_timestamp(), $6)
       ON CONFLICT (cle) DO UPDATE SET description = EXCLUDED.description, domaine = EXCLUDED.domaine, responsable = EXCLUDED.responsable,
              note = EXCLUDED.note, maj_le = EXCLUDED.maj_le, maj_par = EXCLUDED.maj_par
       RETURNING maj_le`,
      [cle, fiche.description, fiche.domaine, fiche.responsable, fiche.note, qui]);
    await journaliserPg(db, { qui, action: 'Table documentée', objet: cle, detail: changes.join(', ') });
    return { ...fiche, majLe: iso(r.maj_le), majPar: qui };
  });
}

/** Enregistre ou retire une décision sur un groupe de doublons, verrou et contrôle de version compris. */
export async function deciderPg(db, saisie, qui) {
  const { id, option, avant, libelle } = validerDecision(saisie);
  return enTransaction(db, async () => {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`matrix.decisions_doublons:${id}`]);
    const { rows: [l] } = await db.query('SELECT option, le, par FROM matrix.decisions_doublons WHERE groupe = $1 FOR UPDATE', [id]);
    controlerVersionDecision(id, avant, l ? { option: l.option, le: iso(l.le), par: l.par } : undefined);
    if (option == null) await db.query('DELETE FROM matrix.decisions_doublons WHERE groupe = $1', [id]);
    else await db.query(
      `INSERT INTO matrix.decisions_doublons (groupe, option, le, par) VALUES ($1, $2, clock_timestamp(), $3)
       ON CONFLICT (groupe) DO UPDATE SET option = EXCLUDED.option, le = EXCLUDED.le, par = EXCLUDED.par`, [id, option, qui]);
    await journaliserPg(db, { qui, action: option == null ? 'Décision retirée' : 'Décision enregistrée', objet: id, detail: libelle });
    if (option == null) return null;
    const { rows: [d] } = await db.query('SELECT option, le, par FROM matrix.decisions_doublons WHERE groupe = $1', [id]);
    return { option: d.option, le: iso(d.le), par: d.par };
  });
}
