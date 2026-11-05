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
    return { ...base, lignes, total, totalEstime, suivante, tri: d.tri, sens: d.sens, colonne: d.colonne, contient: d.contient };
  } finally {
    await db.query('ROLLBACK').catch(() => {});
  }
}
