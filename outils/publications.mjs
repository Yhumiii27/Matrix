// Publications des outils administrées par Matrix (décision M-18, lot P2 ; docs/architecture-postgres.md § 8 septies).
//
// Une publication est une vue pub_ d'un outil. Matrix la définit (registre matrix.publications, écrit par matrix_app) et
// l'applique lui-même, par le rôle matrix_gestion, propriétaire des vues pub_ des six outils (init/03-droits.sql,
// partage/13 et 14). Une application se fait en une transaction, tout ou rien :
//   1. CREATE OR REPLACE VIEW (jamais DROP) : PostgreSQL refuse de lui-même un retrait, un renommage ou un changement de
//      type de colonne ; le contrat enregistré est aussi comparé (vue recréée après un DROP … CASCADE) ;
//   2. les contrôles du socle (droits.verifier()) sur la vue : aucune colonne sensible lue, aucune table d'un autre
//      schéma, propriétaire matrix_gestion ;
//   3. droits des lecteurs d'après le registre des liens : GRANT pour un lien autorisé, REVOKE sinon ;
//   4. registre mis à jour (état « appliquee », contrat), journal par déclencheur.
// Un échec annule tout ; la publication passe alors à l'état « erreur » avec le message, la vue reste telle qu'elle était.
// Une décision sur un lien (écran « Liens entre outils ») est appliquée de même, tout de suite (appliquerLien).

export const OUTILS = ['keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible'];
const NOM = /^[a-z_][a-z0-9_]*$/;
const VUE = /^(keystone|codex|cursus|vigie|arche|crucible)\.pub_[a-z0-9_]+$/;
const LECTEURS = ['keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app', 'crucible_app', 'matrix_app'];
const LONGUEUR_MAX = 20000;

const texte = v => (v == null ? '' : String(v)).trim();
const ident = s => `"${String(s).replace(/"/g, '""')}"`;
const qualifie = vue => vue.split('.').map(ident).join('.');

export function validerVue(vue) {
  vue = texte(vue);
  if (!VUE.test(vue)) throw new Error(`nom de publication invalide : « ${vue} » (attendu : <outil>.pub_<objet>, en minuscules, outil parmi ${OUTILS.join(', ')})`);
  return vue;
}

/**
 * Contrôle d'une requête de vue écrite à la main (mode « sql ») ou d'un filtre : une seule instruction, sans commentaire.
 * Le reste (tables du seul schéma de l'outil, aucune colonne sensible) est contrôlé par le socle à l'application.
 */
export function verifierSql(sql, { filtre = false } = {}) {
  sql = texte(sql).replace(/;\s*$/, '');
  if (!sql) throw new Error(filtre ? 'filtre vide' : 'définition vide');
  if (sql.length > LONGUEUR_MAX) throw new Error(`définition trop longue (${sql.length} caractères, ${LONGUEUR_MAX} au plus)`);
  // Hors chaînes : pas de « ; » (une seule instruction), pas de commentaire (la définition se relit telle quelle).
  const horsChaines = sql.replace(/'(?:[^']|'')*'/g, "''");
  if (/'/.test(horsChaines.replace(/''/g, ''))) throw new Error('chaîne de caractères non fermée');
  if (horsChaines.includes(';')) throw new Error('une seule instruction : « ; » refusé');
  if (/--|\/\*/.test(horsChaines)) throw new Error('commentaire refusé dans une définition (utilisez la description)');
  if (/\$\w*\$/.test(horsChaines)) throw new Error('chaîne entre dollars refusée');
  if (!filtre && !/^(select|with)\b/i.test(sql)) throw new Error('la définition doit être une requête SELECT (ou WITH … SELECT)');
  if (filtre) {
    let prof = 0;
    for (const c of horsChaines) { prof += c === '(' ? 1 : c === ')' ? -1 : 0; if (prof < 0) break; }
    if (prof !== 0) throw new Error('parenthèses déséquilibrées dans le filtre');
    if (/\b(select|union|intersect|except|from)\b/i.test(horsChaines)) throw new Error('le filtre est une condition sur la table source, sans sous-requête (passez en mode SQL)');
  }
  return sql;
}

/**
 * Requête d'une publication en mode « colonnes » : une table de l'outil, des colonnes choisies et leur nom publié, un
 * filtre facultatif. Noms contrôlés et cités : rien n'est interprété comme du SQL hors du filtre.
 */
export function genererDefinition({ outil, source, colonnes, filtre }) {
  const [schema, table, reste] = texte(source).split('.');
  if (reste !== undefined || !NOM.test(schema ?? '') || !NOM.test(table ?? '')) throw new Error(`table source invalide : « ${texte(source)} » (attendu : <schéma>.<table>)`);
  if (outil && schema !== outil) throw new Error(`la table source doit être dans le schéma ${outil} : une vue pub_ ne lit que les tables de son outil`);
  if (!Array.isArray(colonnes) || !colonnes.length) throw new Error('choisissez au moins une colonne');
  const noms = new Set();
  const liste = colonnes.map(c => {
    const colonne = texte(typeof c === 'string' ? c : c?.colonne), nom = texte(typeof c === 'string' ? c : c?.nom) || colonne;
    if (!NOM.test(colonne)) throw new Error(`colonne invalide : « ${colonne} »`);
    if (!NOM.test(nom)) throw new Error(`nom publié invalide : « ${nom} » (minuscules, chiffres et _)`);
    if (noms.has(nom)) throw new Error(`nom publié en double : ${nom}`);
    noms.add(nom);
    return nom === colonne ? `t.${ident(colonne)}` : `t.${ident(colonne)} AS ${ident(nom)}`;
  });
  const f = texte(filtre) ? verifierSql(filtre, { filtre: true }) : '';
  return `SELECT ${liste.join(', ')}\n  FROM ${ident(schema)}.${ident(table)} t${f ? `\n WHERE (${f})` : ''}`;
}

/** Normalise une publication saisie dans l'écran : { vue, mode, source, colonnes, filtre, definition, description }. */
export function preparerPublication(p) {
  const vue = validerVue(p?.vue), outil = vue.split('.')[0];
  const mode = texte(p?.mode) || 'sql';
  if (!['colonnes', 'sql'].includes(mode)) throw new Error(`mode inconnu : ${mode}`);
  const description = texte(p?.description).slice(0, 2000) || null;
  if (mode === 'colonnes') {
    const colonnes = (p.colonnes ?? []).map(c => typeof c === 'string' ? { colonne: c, nom: c } : { colonne: texte(c.colonne), nom: texte(c.nom) || texte(c.colonne) });
    const filtre = texte(p.filtre) || null;
    return { vue, outil, mode, source: texte(p.source), colonnes, filtre, definition: genererDefinition({ outil, source: p.source, colonnes, filtre }), description };
  }
  return { vue, outil, mode, source: null, colonnes: null, filtre: null, definition: verifierSql(p?.definition), description };
}

/** Contrat d'une vue : ses colonnes dans l'ordre, avec leur type. */
async function contratDe(db, vue) {
  const { rows } = await db.query(
    `SELECT a.attname AS nom, format_type(a.atttypid, a.atttypmod) AS type
       FROM pg_attribute a WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [vue]);
  return rows;
}

/** Écart de contrat : chaque colonne déjà publiée garde son rang, son nom et son type ; on n'ajoute qu'en fin. */
export function ecartContrat(avant, apres) {
  if (!Array.isArray(avant) || !avant.length) return null;
  for (let i = 0; i < avant.length; i++) {
    const a = avant[i], b = apres[i];
    if (!b) return `la colonne publiée ${a.nom} disparaît`;
    if (a.nom !== b.nom) return `la colonne publiée n° ${i + 1} s’appelle ${a.nom}, pas ${b.nom}`;
    if (a.type !== b.type) return `la colonne publiée ${a.nom} change de type (${a.type} → ${b.type})`;
  }
  return null;
}

const messageContrat = (vue, detail) => `contrat de ${vue} rompu : ${detail}. Une vue pub_ est un contrat lu par d’autres outils : on n’y retire, ne renomme ni ne change de type aucune colonne, on n’en ajoute qu’en fin ; pour un changement incompatible, publiez une nouvelle vue ${vue}_v2.`;

// ── Lecture (matrix_app) ─────────────────────────────────────────────────

export async function listerPublications(db) {
  const { rows } = await db.query(
    `SELECT p.vue, p.outil, p.mode, p.etat, p.origine, p.description, p.erreur, p.modifie_par, p.modifie_le, p.applique_par, p.applique_le,
            jsonb_array_length(coalesce(p.contrat, '[]')) AS colonnes,
            to_regclass(p.vue) IS NOT NULL AS existe,
            (SELECT array_agg(l.lecteur ORDER BY l.lecteur) FROM matrix.liens l WHERE l.vue = p.vue AND l.statut = 'autorise') AS lecteurs
       FROM matrix.publications p ORDER BY p.vue`);
  // Vues pub_ des outils absentes du registre : créées par une migration, pas encore reprises (partage/14).
  const { rows: hors } = await db.query(
    `SELECT n.nspname || '.' || c.relname AS vue, n.nspname AS outil, pg_get_userbyid(c.relowner) AS proprietaire
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY ($1) AND c.relkind = 'v' AND c.relname LIKE 'pub\\_%'
        AND NOT EXISTS (SELECT FROM matrix.publications p WHERE p.vue = n.nspname || '.' || c.relname)
      ORDER BY 1`, [OUTILS]);
  return { publications: rows, nonReprises: hors };
}

export async function lirePublication(db, vue) {
  vue = validerVue(vue);
  const { rows: [p] } = await db.query('SELECT * FROM matrix.publications WHERE vue = $1', [vue]);
  if (!p) return null;
  const { rows: [etat] } = await db.query(
    `SELECT c.oid IS NOT NULL AS existe, pg_get_userbyid(c.relowner) AS proprietaire
       FROM (SELECT to_regclass($1) AS oid) x LEFT JOIN pg_class c ON c.oid = x.oid`, [vue]);
  const { rows: liens } = await db.query('SELECT lecteur, statut, motif, decide_par, decide_le FROM matrix.liens WHERE vue = $1 ORDER BY lecteur', [vue]);
  const { rows: journal } = await db.query(
    'SELECT action, etat, definition, contrat, detail, par, le FROM matrix.publications_journal WHERE vue = $1 ORDER BY id DESC LIMIT 50', [vue]);
  return { ...p, existe: etat.existe, proprietaire: etat.proprietaire, liens, journal };
}

/** Enregistre un brouillon (création ou modification) ; rien n'est appliqué sur le serveur. Rôle matrix_app. */
export async function enregistrerPublication(db, saisie, par) {
  const p = preparerPublication(saisie);
  const { rows: [r] } = await db.query(
    `INSERT INTO matrix.publications (vue, outil, mode, source, colonnes, filtre, definition, description, etat, origine, modifie_par)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'brouillon', 'matrix', $9)
     ON CONFLICT (vue) DO UPDATE SET mode = EXCLUDED.mode, source = EXCLUDED.source, colonnes = EXCLUDED.colonnes,
            filtre = EXCLUDED.filtre, definition = EXCLUDED.definition, description = EXCLUDED.description,
            etat = 'brouillon', erreur = NULL, modifie_par = EXCLUDED.modifie_par
     RETURNING vue, etat, definition`,
    [p.vue, p.outil, p.mode, p.source, p.colonnes ? JSON.stringify(p.colonnes) : null, p.filtre, p.definition, p.description, par]);
  return r;
}

// ── Application (matrix_gestion) ─────────────────────────────────────────

async function enTransaction(db, tache) {
  await db.query('BEGIN');
  try { const r = await tache(); await db.query('COMMIT'); return r; } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; }
}

const MESSAGES_PG = {
  '42P16': 'PostgreSQL refuse ce changement de colonnes',   // cannot drop / change name of view column
  '42804': 'PostgreSQL refuse ce changement de type',       // cannot change data type of view column
  '42501': 'droit refusé',
  '42P01': 'table ou vue introuvable',
  '42703': 'colonne introuvable',
  '42601': 'erreur de syntaxe',
  '55P03': 'verrou non obtenu en 5 s (table occupée), réessayez',
};

/** Droits des lecteurs d'une vue d'après le registre des liens (dans la transaction en cours, rôle matrix_gestion). */
async function poserDroits(db, vue) {
  const [schema] = vue.split('.');
  const { rows: liens } = await db.query(`SELECT lecteur FROM matrix.liens WHERE vue = $1 AND statut = 'autorise'`, [vue]);
  const autorises = liens.map(l => l.lecteur).filter(l => LECTEURS.includes(l) && l !== `${schema}_app`);
  for (const l of autorises) {
    await db.query(`GRANT USAGE ON SCHEMA ${ident(schema)} TO ${ident(l)}`);
    await db.query(`GRANT SELECT ON ${qualifie(vue)} TO ${ident(l)}`);
    await db.query('INSERT INTO droits.partage_lecteurs (vue, lecteur, pose_par) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [vue, l, 'matrix_gestion']);
  }
  // Droits sans lien autorisé : retirés (lien refusé, demandé, ou jamais inscrit).
  const { rows: poses } = await db.query(
    `SELECT DISTINCT pg_get_userbyid(a.grantee) AS lecteur
       FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE c.oid = to_regclass($1) AND a.privilege_type = 'SELECT' AND pg_get_userbyid(a.grantee) = ANY ($2)`, [vue, LECTEURS]);
  const retires = [];
  for (const { lecteur } of poses) if (!autorises.includes(lecteur)) { await retirerDroit(db, vue, lecteur); retires.push(lecteur); }
  return { autorises, retires };
}

async function retirerDroit(db, vue, lecteur) {
  const [schema] = vue.split('.');
  await db.query(`REVOKE SELECT ON ${qualifie(vue)} FROM ${ident(lecteur)}`);
  await db.query('DELETE FROM droits.partage_lecteurs WHERE vue = $1 AND lecteur = $2', [vue, lecteur]);
  // Plus aucune vue pub_ lisible dans ce schéma : l'USAGE que Matrix a donné est retiré (celui du propriétaire du schéma,
  // posé par 90-droits.sql, l'est au passage suivant de appliquer-liens.sh).
  const { rows: [r] } = await db.query(
    `SELECT EXISTS (SELECT FROM pg_class v JOIN pg_namespace n ON n.oid = v.relnamespace
                     WHERE n.nspname = $1 AND v.relkind = 'v' AND v.relname LIKE 'pub\\_%' AND has_table_privilege($2, v.oid, 'SELECT'))
         OR EXISTS (SELECT FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace CROSS JOIN LATERAL aclexplode(f.proacl) a
                     WHERE n.nspname = $1 AND f.proname LIKE 'pub\\_%' AND a.privilege_type = 'EXECUTE' AND a.grantee = to_regrole($2)) AS lit`,
    [schema, lecteur]);
  if (!r.lit) await db.query(`REVOKE USAGE ON SCHEMA ${ident(schema)} FROM ${ident(lecteur)}`);
}

/**
 * Applique une publication du registre sur le serveur (rôle matrix_gestion). Renvoie { vue, contrat, lecteurs, retires }.
 * En cas d'échec, la publication passe à l'état « erreur » et l'erreur est relancée avec un message lisible.
 */
export async function appliquerPublication(db, vue, par) {
  vue = validerVue(vue);
  try {
    return await enTransaction(db, async () => {
      const { rows: [p] } = await db.query('SELECT * FROM matrix.publications WHERE vue = $1 FOR UPDATE', [vue]);
      if (!p) throw new Error(`publication inconnue : ${vue}`);
      const { rows: [v] } = await db.query(
        `SELECT pg_get_userbyid(c.relowner) AS proprietaire FROM pg_class c WHERE c.oid = to_regclass($1)`, [vue]);
      if (v && v.proprietaire !== 'matrix_gestion')
        throw new Error(`${vue} appartient encore à ${v.proprietaire} : elle doit d’abord être reprise par Matrix (partage/14-reprise-publications.sql)`);
      const definition = p.mode === 'colonnes' ? genererDefinition(p) : verifierSql(p.definition);
      await db.query(`CREATE OR REPLACE VIEW ${qualifie(vue)} AS ${definition}`);
      const contrat = await contratDe(db, vue);
      const ecart = ecartContrat(p.contrat, contrat);
      if (ecart) throw new Error(messageContrat(vue, ecart));
      await db.query(`COMMENT ON VIEW ${qualifie(vue)} IS ${p.description ? `'${p.description.replace(/'/g, "''")}'` : 'NULL'}`);
      // Contrôles du socle sur cette vue (colonnes sensibles, autre schéma, propriétaire, security_invoker).
      const [schema, nom] = vue.split('.');
      const { rows: fautes } = await db.query(
        `SELECT constat FROM droits.verifier() WHERE gravite = 'erreur' AND objet = format('%I.%I', $1::text, $2::text)`, [schema, nom]);
      if (fautes.length) throw new Error(`publication refusée par le contrôle du serveur : ${fautes.map(f => f.constat).join(' ; ')}`);
      const droits = await poserDroits(db, vue);
      await db.query(
        `UPDATE matrix.publications SET definition = $2, contrat = $3::jsonb, etat = 'appliquee', erreur = NULL,
                applique_par = $4, applique_le = now(), modifie_par = $4 WHERE vue = $1`,
        [vue, definition, JSON.stringify(contrat), par]);
      return { vue, contrat, lecteurs: droits.autorises, retires: droits.retires };
    });
  } catch (e) {
    const message = e.code ? `${MESSAGES_PG[e.code] ?? 'refusé par PostgreSQL'} : ${e.message}` : e.message;
    const lisible = e.code === '42P16' || e.code === '42804' ? messageContrat(vue, e.message) : message;
    await db.query(`UPDATE matrix.publications SET etat = 'erreur', erreur = $2, modifie_par = $3 WHERE vue = $1 AND etat <> 'retiree'`,
      [vue, lisible.slice(0, 2000), par]).catch(() => {});
    throw new Error(lisible);
  }
}

/** Retire une publication : la vue est supprimée, sa ligne reste au registre (« retiree »). Refusé tant qu'un lien est autorisé. */
export async function retirerPublication(db, vue, par, motif) {
  vue = validerVue(vue);
  motif = texte(motif).slice(0, 1000);
  if (!motif) throw new Error('motif obligatoire pour retirer une publication');
  return enTransaction(db, async () => {
    const { rows: [p] } = await db.query('SELECT etat FROM matrix.publications WHERE vue = $1 FOR UPDATE', [vue]);
    if (!p) throw new Error(`publication inconnue : ${vue}`);
    const { rows: lus } = await db.query(`SELECT lecteur FROM matrix.liens WHERE vue = $1 AND statut = 'autorise'`, [vue]);
    if (lus.length) throw new Error(`${vue} est encore lue par ${lus.map(l => l.lecteur).join(', ')} : refusez d’abord ces liens`);
    const { rows: [v] } = await db.query('SELECT pg_get_userbyid(relowner) AS proprietaire FROM pg_class WHERE oid = to_regclass($1)', [vue]);
    if (v && v.proprietaire !== 'matrix_gestion') throw new Error(`${vue} appartient à ${v.proprietaire} : Matrix ne la supprime pas`);
    try { if (v) await db.query(`DROP VIEW ${qualifie(vue)}`); }
    catch (e) { throw new Error(e.code === '2BP01' ? `${vue} est utilisée par une autre vue (${e.detail ?? e.message}) : retirez d’abord celle-ci` : e.message); }
    await db.query('DELETE FROM droits.partage_lecteurs WHERE vue = $1', [vue]);
    await db.query(`UPDATE matrix.publications SET etat = 'retiree', erreur = $2, modifie_par = $3 WHERE vue = $1`, [vue, `retirée : ${motif}`, par]);
    return { vue, etat: 'retiree' };
  });
}

/**
 * Applique tout de suite la décision du registre sur un lien (vue, lecteur), rôle matrix_gestion. Une vue pas encore
 * reprise par Matrix (propriétaire : l'outil) est laissée à 90-droits.sql (appliquer-liens.sh, dans les 15 minutes).
 */
export async function appliquerLien(db, { vue, lecteur }) {
  vue = texte(vue); lecteur = texte(lecteur);
  if (!/^(keystone|codex|cursus|vigie|arche|crucible|matrix)\.pub_[a-z0-9_]+$/.test(vue) || !LECTEURS.includes(lecteur)) throw new Error('lien invalide');
  return enTransaction(db, async () => {
    const { rows: [lien] } = await db.query(`SELECT coalesce(to_jsonb(l) ->> 'nature', 'lecture') AS nature FROM matrix.liens l WHERE vue = $1 AND lecteur = $2`, [vue, lecteur]);
    if (lien?.nature === 'execution') return appliquerExecution(db, vue, lecteur);
    const { rows: [v] } = await db.query('SELECT pg_get_userbyid(relowner) AS proprietaire FROM pg_class WHERE oid = to_regclass($1)', [vue]);
    if (!v) return { applique: false, raison: 'vue absente du serveur' };
    if (v.proprietaire !== 'matrix_gestion') return { applique: false, raison: `vue de ${v.proprietaire}, pas encore reprise par Matrix : appliqué par 90-droits.sql dans les 15 minutes` };
    const { rows: [l] } = await db.query('SELECT statut FROM matrix.liens WHERE vue = $1 AND lecteur = $2', [vue, lecteur]);
    const [schema] = vue.split('.');
    if (l?.statut === 'autorise') {
      await db.query(`GRANT USAGE ON SCHEMA ${ident(schema)} TO ${ident(lecteur)}`);
      await db.query(`GRANT SELECT ON ${qualifie(vue)} TO ${ident(lecteur)}`);
      await db.query('INSERT INTO droits.partage_lecteurs (vue, lecteur, pose_par) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [vue, lecteur, 'matrix_gestion']);
      return { applique: true, droit: 'accordé' };
    }
    await retirerDroit(db, vue, lecteur);
    return { applique: true, droit: 'retiré' };
  });
}

/**
 * Lien d'exécution (M-18, lot P4) : un outil écrit chez un autre par une fonction pub_ du propriétaire. matrix_gestion ne
 * reçoit jamais EXECUTE lui-même : droits.accorder_execution (init/03-droits.sql, superutilisateur) pose ou retire le droit
 * au nom du propriétaire, et seulement d'après le registre. USAGE sur le schéma : comme pour une vue.
 */
async function appliquerExecution(db, fonction, lecteur) {
  const [schema] = fonction.split('.');
  if (!OUTILS.includes(schema)) return { applique: false, raison: 'Matrix ne publie pas de fonction d’écriture' };
  const { rows: [l] } = await db.query('SELECT statut FROM matrix.liens WHERE vue = $1 AND lecteur = $2', [fonction, lecteur]);
  if (l?.statut === 'autorise') await db.query(`GRANT USAGE ON SCHEMA ${ident(schema)} TO ${ident(lecteur)}`);
  const { rows: [r] } = await db.query('SELECT droits.accorder_execution($1, $2) AS resultat', [fonction, lecteur]);
  if (r.resultat === 'absente') return { applique: false, raison: 'fonction absente du serveur : l’outil propriétaire ne la fournit pas encore' };
  if (r.resultat === 'retire') {
    const { rows: [u] } = await db.query(
      `SELECT EXISTS (SELECT FROM pg_class v JOIN pg_namespace n ON n.oid = v.relnamespace
                       WHERE n.nspname = $1 AND v.relkind = 'v' AND v.relname LIKE 'pub\\_%' AND has_table_privilege($2, v.oid, 'SELECT'))
           OR EXISTS (SELECT FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace CROSS JOIN LATERAL aclexplode(f.proacl) a
                       WHERE n.nspname = $1 AND f.proname LIKE 'pub\\_%' AND a.privilege_type = 'EXECUTE' AND a.grantee = to_regrole($2)) AS garde`,
      [schema, lecteur]);
    if (!u.garde) await db.query(`REVOKE USAGE ON SCHEMA ${ident(schema)} FROM ${ident(lecteur)}`);
  }
  return { applique: true, droit: r.resultat === 'accorde' ? 'accordé' : 'retiré' };
}
