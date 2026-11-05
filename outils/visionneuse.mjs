// Visionneuse des données : ce qu'il y a dans une table (ou une vue) d'un outil, page par page, sur le serveur commun.
//
// Règle du socle (docs/architecture-postgres.md) : « Matrix lit tout, sauf les colonnes sensibles ». La visionneuse ne lit
// que les colonnes que le serveur ouvre à matrix_app (has_column_privilege) : une colonne sensible ou fermée est montrée
// comme telle, jamais lue ; jamais de SELECT *. Chaque lecture tourne dans une transaction en lecture seule, bornée dans
// le temps ; identifiants cités, valeurs en paramètres ; textes longs tronqués, binaires résumés à leur taille.

const SCHEMAS = ['keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible', 'matrix'];
const NOM = /^[a-z_][a-z0-9_]{0,62}$/;
export const PAR_PAGE = [25, 50, 100, 200];
const LONGUEUR_MAX = 500;

const ident = s => `"${String(s).replace(/"/g, '""')}"`;

// ── Édition des lignes par l'outil propriétaire (demande du 05/11/2026, choix « par les outils ») ──────────────────
// Matrix n'écrit jamais lui-même dans les tables des outils (M-18). Un outil qui veut que la DSI corrige une liste
// d'options depuis Matrix fournit, dans son schéma, une fonction par table (convention docs/edition-par-les-outils.md) :
//   <outil>.pub_editer_<table>(p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text) RETURNS jsonb
//   SECURITY DEFINER, search_path fixé, EXECUTE retiré à PUBLIC ;
//   p_action : ajouter | corriger | retirer ; l'outil applique ses règles et son journal (un retrait peut être un
//   archivage) et refuse par RAISE EXCEPTION, dont le message est montré tel quel.
// Le droit de l'exécuter est un lien « écriture » du registre (lecteur matrix_app), décidé dans « Liens entre outils ».
export const ACTIONS_EDITION = ['ajouter', 'corriger', 'retirer'];
export const fonctionEdition = (outil, table) => `${outil}.pub_editer_${table}`;
const SIGNATURE = ['text', 'jsonb', 'jsonb', 'text', 'text'];

/** Fonction d'édition d'une table : { fonction, existe, conforme, executable, raison }. */
export async function etatEdition(db, outil, table) {
  const fonction = fonctionEdition(outil, table);
  const { rows } = await db.query(
    `SELECT p.oid, p.prosecdef AS definer, pg_get_function_identity_arguments(p.oid) AS args,
            ARRAY(SELECT format_type(t, NULL) FROM unnest(p.proargtypes) t) AS types,
            format_type(p.prorettype, NULL) AS retour,
            EXISTS (SELECT FROM unnest(p.proconfig) AS c(x) WHERE c.x LIKE 'search\\_path=%') AS search_path_fixe,
            has_function_privilege(p.oid, 'EXECUTE') AS executable
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1 AND p.proname = $2`, [outil, `pub_editer_${table}`]);
  if (!rows.length) return { fonction, existe: false, executable: false, raison: `l’outil ne fournit pas ${fonction}` };
  const f = rows.find(r => JSON.stringify(r.types) === JSON.stringify(SIGNATURE)) ?? rows[0];
  const conforme = JSON.stringify(f.types) === JSON.stringify(SIGNATURE) && f.retour === 'jsonb' && f.definer && f.search_path_fixe;
  const raison = !conforme ? `${fonction} ne suit pas la convention (signature (text, jsonb, jsonb, text, text) → jsonb, SECURITY DEFINER, search_path fixé)`
    : !f.executable ? `lien d’écriture matrix_app → ${fonction} non autorisé (« Liens entre outils »)` : null;
  return { fonction, existe: true, conforme, executable: conforme && f.executable, raison };
}

/** Contrôle une modification demandée depuis la visionneuse. */
export function validerEdition(e = {}) {
  const { outil, table } = validerDemande(e);
  const action = String(e.action ?? '');
  if (!ACTIONS_EDITION.includes(action)) throw new Error(`action inconnue : « ${action} » (ajouter, corriger ou retirer)`);
  const objet = v => v && typeof v === 'object' && !Array.isArray(v);
  const cle = e.cle ?? null, valeurs = e.valeurs ?? null;
  if (action !== 'ajouter' && !(objet(cle) && Object.keys(cle).length)) throw new Error('clé de la ligne manquante');
  if (action !== 'retirer' && !(objet(valeurs) && Object.keys(valeurs).length)) throw new Error('valeurs manquantes');
  for (const k of [...Object.keys(cle ?? {}), ...Object.keys(valeurs ?? {})]) if (!NOM.test(k)) throw new Error(`colonne invalide : « ${k} »`);
  const motif = String(e.motif ?? '').trim();
  if (motif.length < 5) throw new Error('motif obligatoire (5 caractères au moins) : il entre dans le journal de l’outil');
  if (motif.length > 500) throw new Error('motif : 500 caractères au plus');
  return { outil, table, action, cle: action === 'ajouter' ? null : cle, valeurs: action === 'retirer' ? null : valeurs, motif };
}

/** Exécute la fonction d'édition de l'outil (rôle matrix_app) ; renvoie ce qu'elle renvoie. */
export async function editerLigne(db, saisie, par) {
  const e = validerEdition(saisie);
  const etat = await etatEdition(db, e.outil, e.table);
  if (!etat.executable) { const err = new Error(`Modification impossible : ${etat.raison}.`); err.code = 409; throw err; }
  const { rows: [r] } = await db.query(`SELECT ${ident(e.outil)}.${ident(`pub_editer_${e.table}`)}($1, $2::jsonb, $3::jsonb, $4, $5) AS r`,
    [e.action, e.cle == null ? null : JSON.stringify(e.cle), e.valeurs == null ? null : JSON.stringify(e.valeurs), par || 'Matrix', e.motif]);
  return { ...e, resultat: r.r };
}

/** Contrôle une demande de lecture ; renvoie la demande normalisée ou lève une erreur lisible. */
export function validerDemande(q = {}) {
  const outil = String(q.outil ?? ''), table = String(q.table ?? '');
  if (!SCHEMAS.includes(outil)) throw new Error(`outil inconnu : « ${outil} »`);
  if (!NOM.test(table)) throw new Error(`table invalide : « ${table} »`);
  const par = PAR_PAGE.includes(Number(q.par)) ? Number(q.par) : 50;
  const page = Math.max(1, Math.min(100000, Math.floor(Number(q.page) || 1)));
  const tri = q.tri ? String(q.tri) : null;
  if (tri && !NOM.test(tri)) throw new Error(`colonne de tri invalide : « ${tri} »`);
  const sens = q.sens === 'desc' ? 'desc' : 'asc';
  const colonne = q.colonne ? String(q.colonne) : null;
  if (colonne && !NOM.test(colonne)) throw new Error(`colonne de filtre invalide : « ${colonne} »`);
  const contient = q.contient == null ? '' : String(q.contient).slice(0, 200);
  return { outil, table, par, page, tri, sens, colonne: contient ? colonne : null, contient };
}

const echapperLike = s => s.replace(/[\\%_]/g, c => '\\' + c);

/**
 * Lit une page de données. Renvoie { outil, table, genre, colonnes: [{ nom, type, lisible }], lignes: [[…]], page, par,
 * total, totalEstime, suivante } ; total est exact quand le comptage tient dans le temps imparti, sinon estimé
 * (statistiques du serveur) ou null. Lève une erreur « introuvable » (code 404) pour une table absente.
 */
export async function lireDonnees(db, demande, { delaiMs = 10000, delaiComptageMs = 3000 } = {}) {
  const d = validerDemande(demande);
  await db.query('BEGIN READ ONLY');
  try {
    await db.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(delaiMs))}`);
    const { rows: cols } = await db.query(
      `SELECT a.attname AS nom, format_type(a.atttypid, a.atttypmod) AS type, t.typname,
              has_column_privilege(c.oid, a.attnum, 'SELECT') AS lisible, c.relkind, c.reltuples
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
         JOIN pg_type t ON t.oid = a.atttypid
        WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        ORDER BY a.attnum`, [d.outil, d.table]);
    if (!cols.length) { const e = new Error(`${d.outil}.${d.table} introuvable sur le serveur commun`); e.code = 404; throw e; }
    const genre = { r: 'table', p: 'table', v: 'vue', m: 'vue matérialisée', f: 'table externe' }[cols[0].relkind];
    const colonnes = cols.map(c => ({ nom: c.nom, type: c.type, lisible: c.lisible }));
    const lisibles = cols.filter(c => c.lisible);
    const base = { outil: d.outil, table: d.table, genre, colonnes, page: d.page, par: d.par };
    if (!lisibles.length) return { ...base, lignes: [], total: null, totalEstime: null, suivante: false, fermee: true };
    const nomsLisibles = new Set(lisibles.map(c => c.nom));
    if (d.tri && !nomsLisibles.has(d.tri)) throw new Error(`tri impossible sur ${d.tri} : colonne absente ou fermée à Matrix`);
    if (d.colonne && !nomsLisibles.has(d.colonne)) throw new Error(`filtre impossible sur ${d.colonne} : colonne absente ou fermée à Matrix`);

    const t = `${ident(d.outil)}.${ident(d.table)}`;
    const params = [];
    let where = '';
    if (d.contient) { params.push(`%${echapperLike(d.contient)}%`); where = ` WHERE ${ident(d.colonne)}::text ILIKE $1`; }

    // Comptage borné (savepoint : un dépassement n'annule pas la lecture).
    let total = null, totalEstime = null;
    await db.query('SAVEPOINT comptage');
    try {
      await db.query(`SET LOCAL statement_timeout = ${Math.max(500, Math.floor(delaiComptageMs))}`);
      total = Number((await db.query(`SELECT count(*) AS n FROM ${t}${where}`, params)).rows[0].n);
      await db.query('RELEASE SAVEPOINT comptage');
    } catch {
      await db.query('ROLLBACK TO SAVEPOINT comptage');
      if (!where && cols[0].reltuples >= 0) totalEstime = Math.round(cols[0].reltuples);
    }
    await db.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(delaiMs))}`);

    const expr = c => c.typname === 'bytea'
      ? `CASE WHEN ${ident(c.nom)} IS NULL THEN NULL ELSE '(binaire, ' || octet_length(${ident(c.nom)}) || ' octets)' END`
      : `left(${ident(c.nom)}::text, ${LONGUEUR_MAX + 1})`;
    const ordre = d.tri ? ` ORDER BY ${ident(d.tri)} ${d.sens.toUpperCase()} NULLS LAST` : '';
    const sql = `SELECT ${lisibles.map((c, i) => `${expr(c)} AS c${i}`).join(', ')} FROM ${t}${where}${ordre} LIMIT ${d.par + 1} OFFSET ${(d.page - 1) * d.par}`;
    const { rows } = await db.query(sql, params);
    const suivante = rows.length > d.par;
    const lignes = rows.slice(0, d.par).map(r => {
      let i = 0;
      return cols.map(c => {
        if (!c.lisible) return { ferme: true };
        const v = r[`c${i++}`];
        return v != null && v.length > LONGUEUR_MAX ? `${v.slice(0, LONGUEUR_MAX)}…` : v;
      });
    });
    const cle = (await db.query(
      `SELECT array_agg(a.attname::text ORDER BY k.ord) AS cle FROM pg_constraint ct
         CROSS JOIN LATERAL unnest(ct.conkey) WITH ORDINALITY AS k(num, ord)
         JOIN pg_attribute a ON a.attrelid = ct.conrelid AND a.attnum = k.num
        WHERE ct.contype = 'p' AND ct.conrelid = to_regclass($1)`, [`${d.outil}.${d.table}`])).rows[0]?.cle ?? [];
    const edition = await etatEdition(db, d.outil, d.table);
    return { ...base, lignes, total, totalEstime, suivante, tri: d.tri, sens: d.sens, colonne: d.colonne, contient: d.contient, cle, edition };
  } finally {
    await db.query('ROLLBACK').catch(() => {});
  }
}
