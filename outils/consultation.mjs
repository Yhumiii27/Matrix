// Consultation, dans l'écran, de ce que le serveur commun réunit pour Matrix (écart E-11, docs/proposition.md § 6) :
//   - matrix.journal_unifie (D18, partage/95) : les pub_journal des outils, aux colonnes communes ;
//   - matrix.rex_unifie (D22, partage/96) : les retours d'expérience de Keystone (projets) et d'Arche (CAPEX) ;
//   - matrix.correspondances (partage/10) : identifiants locaux des outils → clé commune, à décider pendant la transition.
// Connexion en matrix_app. Les deux vues sont en lecture seule ; une correspondance ne change que par une décision
// (deciderCorrespondance), contrôlée ici puis par les contraintes de la table.

export const OUTILS_JOURNAL = ['keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible'];
const LIMITE_JOURNAL = 200, LIMITE_REX = 500, LIMITE_CORRESPONDANCES = 1000;

const texte = v => (v == null ? '' : String(v)).trim();
const date = (v, champ) => {
  const t = texte(v);
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(t) || Number.isNaN(Date.parse(t))) throw new Error(`${champ} : date AAAA-MM-JJ attendue`);
  return t;
};
// Motif LIKE littéral : % et _ saisis sont cherchés tels quels.
const contient = v => `%${v.replace(/[\\%_]/g, c => '\\' + c)}%`;

async function vueExiste(db, nom) {
  return (await db.query('SELECT to_regclass($1) IS NOT NULL AS existe', [nom])).rows[0].existe;
}

/**
 * Journal unifié, du plus récent au plus ancien, par pages de `limite` lignes. Filtres : outil, projet (code exact),
 * recherche (qui, action, objet, détail), depuis / jusqu (dates incluses, jour de Paris). `apres` = { quand, ref_source }
 * de la dernière ligne lue, pour la page suivante.
 */
export async function lireJournal(db, { outil, projet, recherche, depuis, jusqu, apres, limite } = {}) {
  if (!await vueExiste(db, 'matrix.journal_unifie')) return { absente: true, lignes: [], suite: null };
  const conditions = [], params = [];
  const p = v => { params.push(v); return `$${params.length}`; };
  outil = texte(outil);
  if (outil) { if (!OUTILS_JOURNAL.includes(outil)) throw new Error(`outil inconnu : ${outil}`); conditions.push(`outil = ${p(outil)}`); }
  if (texte(projet)) conditions.push(`projet = ${p(texte(projet))}`);
  if (texte(recherche)) {
    const m = p(contient(texte(recherche).slice(0, 100)));
    conditions.push(`(qui ILIKE ${m} OR action ILIKE ${m} OR objet ILIKE ${m} OR detail ILIKE ${m} OR qui_matricule ILIKE ${m})`);
  }
  const d = date(depuis, 'Depuis'), j = date(jusqu, 'Jusqu’au');
  if (d) conditions.push(`quand >= (${p(d)}::date)::timestamp AT TIME ZONE 'Europe/Paris'`);
  if (j) conditions.push(`quand < ((${p(j)}::date + 1)::timestamp AT TIME ZONE 'Europe/Paris')`);
  if (apres?.quand) {
    if (Number.isNaN(Date.parse(apres.quand))) throw new Error('pagination invalide');
    conditions.push(`(quand, ref_source) < (${p(apres.quand)}::timestamptz, ${p(texte(apres.ref_source))})`);
  }
  const n = Math.min(Math.max(Number(limite) || 100, 1), LIMITE_JOURNAL);
  const { rows } = await db.query(
    `SELECT outil, quand, qui, qui_ref, qui_role, qui_matricule, action, objet, detail, projet, nature, ref_source
       FROM matrix.journal_unifie ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY quand DESC, ref_source DESC LIMIT ${n + 1}`, params);
  const lignes = rows.slice(0, n);
  const derniere = lignes.at(-1);
  return { lignes, suite: rows.length > n ? { quand: derniere.quand.toISOString(), ref_source: derniere.ref_source } : null };
}

/** REX unifié (contrat commun, 15 colonnes), le plus récent d'abord. Filtres : outil, projet ou CAPEX, catégorie, recherche. */
export async function lireRex(db, { outil, code, categorie, recherche } = {}) {
  if (!await vueExiste(db, 'matrix.rex_unifie')) return { absente: true, lignes: [] };
  const conditions = [], params = [];
  const p = v => { params.push(v); return `$${params.length}`; };
  if (texte(outil)) conditions.push(`outil = ${p(texte(outil))}`);
  if (texte(code)) { const c = p(texte(code)); conditions.push(`(projet_code = ${c} OR capex_code = ${c})`); }
  if (texte(categorie)) conditions.push(`categorie = ${p(texte(categorie))}`);
  if (texte(recherche)) {
    const m = p(contient(texte(recherche).slice(0, 100)));
    conditions.push(`(titre ILIKE ${m} OR constat ILIKE ${m} OR impact ILIKE ${m} OR recommandation ILIKE ${m} OR numero ILIKE ${m})`);
  }
  const { rows } = await db.query(
    `SELECT ref_source, outil, projet_code, capex_code, numero, categorie, titre, constat, impact, recommandation, portee,
            statut, auteur, cree_le, maj_le
       FROM matrix.rex_unifie ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY cree_le DESC, ref_source LIMIT ${LIMITE_REX}`, params);
  const { rows: cat } = await db.query('SELECT DISTINCT categorie FROM matrix.rex_unifie WHERE categorie IS NOT NULL ORDER BY 1');
  return { lignes: rows, categories: cat.map(r => r.categorie) };
}

// ── Correspondances ──────────────────────────────────────────────────────

export const OBJETS = ['personne', 'projet', 'site', 'unite', 'pays', 'titre', 'document'];
export const STATUTS = ['propose', 'valide', 'a_creer', 'abandonne', 'rejete', 'retire'];
// Décisions possibles depuis chaque statut (commentaire de la table, partage/10). Un statut final ne se rouvre pas :
// une nouvelle proposition s'inscrit sur une nouvelle ligne.
export const DECISIONS = {
  propose: ['valide', 'rejete', 'a_creer', 'abandonne'],
  a_creer: ['valide', 'abandonne'],
  valide: ['retire'],
};
const MOTIF_OBLIGATOIRE = ['rejete', 'retire', 'abandonne'];

export async function lireCorrespondances(db, { objet, outil, statut } = {}) {
  const conditions = [], params = [];
  const p = v => { params.push(v); return `$${params.length}`; };
  if (texte(objet)) conditions.push(`objet = ${p(texte(objet))}`);
  if (texte(outil)) conditions.push(`outil = ${p(texte(outil))}`);
  if (texte(statut)) conditions.push(`statut = ${p(texte(statut))}`);
  const { rows } = await db.query(
    `SELECT id, objet, outil, table_locale, id_local, cle_naturelle, libelle_local, pivot, pivot_provisoire, methode, statut,
            propose_le, propose_par, decide_par, decide_le, note
       FROM matrix.correspondances ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY objet, outil, table_locale, id_local, id LIMIT ${LIMITE_CORRESPONDANCES}`, params);
  const { rows: compte } = await db.query('SELECT objet, statut, count(*)::int AS n FROM matrix.correspondances GROUP BY 1, 2');
  return { lignes: rows, compte };
}

/**
 * Décision sur une correspondance : { id, statut, pivot?, note? }. Le pivot peut être corrigé à la validation (format
 * contrôlé par la table : EMP-/PRV- pour une personne, code ISO pour un pays…). Un rejet, un abandon ou un retrait est
 * motivé. Renvoie la ligne mise à jour.
 */
export async function deciderCorrespondance(db, { id, statut, pivot, note } = {}, par) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error('correspondance inconnue');
  statut = texte(statut);
  if (!STATUTS.includes(statut)) throw new Error(`statut inconnu : ${statut}`);
  note = texte(note).slice(0, 1000) || null;
  if (MOTIF_OBLIGATOIRE.includes(statut) && !note) throw new Error('motif obligatoire pour un rejet, un abandon ou un retrait');
  pivot = texte(pivot) || null;
  await db.query('BEGIN');
  try {
    const { rows: [c] } = await db.query('SELECT id, objet, statut, pivot FROM matrix.correspondances WHERE id = $1 FOR UPDATE', [n]);
    if (!c) throw new Error('correspondance inconnue');
    if (!(DECISIONS[c.statut] ?? []).includes(statut)) throw new Error(`une correspondance « ${c.statut} » ne peut pas passer à « ${statut} »`);
    const nouveauPivot = statut === 'valide' ? (pivot ?? c.pivot) : c.pivot;
    if (statut === 'valide' && !nouveauPivot) throw new Error('la clé commune (pivot) est obligatoire pour valider');
    const { rows: [r] } = await db.query(
      `UPDATE matrix.correspondances
          SET statut = $2, pivot = $3::text, pivot_provisoire = ($4::text = 'personne' AND coalesce($3::text LIKE 'PRV-%', false)),
              decide_par = CASE WHEN $2::text = 'a_creer' THEN NULL ELSE $5::text END,
              decide_le = CASE WHEN $2::text = 'a_creer' THEN NULL ELSE now() END,
              note = coalesce($6::text, note)
        WHERE id = $1
        RETURNING id, objet, outil, table_locale, id_local, cle_naturelle, libelle_local, pivot, pivot_provisoire, methode,
                  statut, propose_le, propose_par, decide_par, decide_le, note`,
      [n, statut, nouveauPivot, c.objet, par, note]);
    await db.query('COMMIT');
    return r;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e.code ? new Error(`le serveur commun refuse la décision : ${e.message}`) : e;
  }
}
