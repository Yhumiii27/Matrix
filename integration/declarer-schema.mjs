// Déclaration du schéma d'un outil auprès de Matrix (contrat matrix.schema/1).
//
// À copier dans Keystone, Codex, Vigie et Cursus, puis à appeler juste après les migrations :
//
//   import { introspecterPostgres, introspecterSqlite, declarerSchema } from './declarer-schema.mjs';
//
//   // Keystone, Codex, Vigie (PGlite ou PostgreSQL) — après migrate(db) :
//   const tables = await introspecterPostgres(sql => pglite.query(sql).then(r => r.rows));
//   await declarerSchema({ app: 'codex', version: process.env.APP_VERSION, tables });
//
//   // Cursus (node:sqlite) — après migrate(db) :
//   const tables = introspecterSqlite(db.sql);
//   await declarerSchema({ app: 'cursus', tables });
//
// Variables d'environnement lues par declarerSchema :
//   MATRIX_URL               adresse de Matrix (ex. https://matrix.exemple.fr, ou https://user:mdp@… derrière une
//                            authentification HTTP) ; si absente, rien n'est envoyé
//   MATRIX_TOKEN             jeton partagé avec Matrix, envoyé dans l'en-tête X-Matrix-Token
//   MATRIX_DECLARATIONS_DIR  dossier où écrire aussi la déclaration (utile sans réseau)
//
// L'envoi n'est jamais bloquant : en cas d'échec, l'outil démarre normalement et un avertissement est écrit.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PG_TABLES = `
  select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = current_schema() and t.table_type = 'BASE TABLE'
    and c.table_name not in ('__drizzle_migrations', 'schema_migrations')
  order by c.table_name, c.ordinal_position`;

const PG_CONSTRAINTS = `
  select rel.relname as table_name, con.contype as kind,
    array(select a.attname from unnest(con.conkey) with ordinality k(n, o)
          join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o)::text[] as cols,
    ref.relname as ref_table,
    array(select a.attname from unnest(con.confkey) with ordinality k(n, o)
          join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o)::text[] as ref_cols,
    con.confdeltype as on_delete
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  left join pg_class ref on ref.oid = con.confrelid
  where n.nspname = current_schema() and con.contype in ('p', 'u', 'f')
  order by rel.relname, con.conname`;

const ON_DELETE = { a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' };
const arr = v => Array.isArray(v) ? v : String(v ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean);

/** Lit le schéma courant d'une base PostgreSQL ou PGlite. `query(sql)` renvoie un tableau de lignes. */
export async function introspecterPostgres(query) {
  const tables = new Map();
  for (const r of await query(PG_TABLES)) {
    if (!tables.has(r.table_name)) tables.set(r.table_name, { name: r.table_name, columns: [], pk: [], fks: [], uniques: [] });
    const type = r.data_type === 'USER-DEFINED' ? r.udt_name : r.data_type === 'ARRAY' ? r.udt_name.replace(/^_/, '') + '[]' : r.data_type;
    tables.get(r.table_name).columns.push({ name: r.column_name, type, nullable: r.is_nullable === 'YES', pk: false, default: r.column_default ?? null });
  }
  for (const r of await query(PG_CONSTRAINTS)) {
    const t = tables.get(r.table_name);
    if (!t) continue;
    const cols = arr(r.cols);
    if (r.kind === 'p') { t.pk = cols; if (cols.length === 1) t.columns.find(c => c.name === cols[0]).pk = true; }
    else if (r.kind === 'u') t.uniques.push(cols);
    else t.fks.push({ columns: cols, table: r.ref_table, refColumns: arr(r.ref_cols), onDelete: ON_DELETE[r.on_delete] ?? null, declared: true });
  }
  return [...tables.values()];
}

/** Lit le schéma courant d'une base SQLite (DatabaseSync de node:sqlite, ou better-sqlite3). */
export function introspecterSqlite(db) {
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const names = all(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not in ('__drizzle_migrations', 'schema_migrations') order by name`).map(r => r.name);
  return names.map(name => {
    const q = `"${name.replace(/"/g, '""')}"`;
    const info = all(`pragma table_info(${q})`);
    const pk = info.filter(c => c.pk > 0).sort((a, b) => a.pk - b.pk).map(c => c.name);
    const fkRows = all(`pragma foreign_key_list(${q})`);
    const fks = Object.values(fkRows.reduce((acc, r) => {
      (acc[r.id] ??= { columns: [], table: r.table, refColumns: [], onDelete: String(r.on_delete).toLowerCase(), declared: true });
      acc[r.id].columns.push(r.from); acc[r.id].refColumns.push(r.to); return acc;
    }, {}));
    const uniques = all(`pragma index_list(${q})`).filter(i => i.unique && i.origin === 'u')
      .map(i => all(`pragma index_info("${i.name.replace(/"/g, '""')}")`).map(c => c.name));
    return {
      name, pk, fks, uniques,
      columns: info.map(c => ({ name: c.name, type: c.type || 'ANY', nullable: !c.notnull && !c.pk, pk: pk.length === 1 && c.pk === 1, default: c.dflt_value ?? null })),
    };
  });
}

/** Construit le document matrix.schema/1. L'empreinte permet à Matrix d'ignorer une déclaration inchangée. */
export function documentSchema({ app, version = null, tables }) {
  const sorted = [...tables].sort((a, b) => a.name.localeCompare(b.name));
  const empreinte = createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
  return { schema: 'matrix.schema/1', app, version, declareLe: new Date().toISOString(), empreinte, tables: sorted };
}

/** Envoie la déclaration à Matrix et/ou l'écrit dans un dossier. Ne lève jamais d'erreur. */
export async function declarerSchema({ app, version, tables, env = process.env, log = console }) {
  const doc = documentSchema({ app, version, tables });
  try {
    if (env.MATRIX_DECLARATIONS_DIR) {
      mkdirSync(env.MATRIX_DECLARATIONS_DIR, { recursive: true });
      writeFileSync(join(env.MATRIX_DECLARATIONS_DIR, `${app}.json`), JSON.stringify(doc, null, 1));
    }
    if (env.MATRIX_URL) {
      // MATRIX_URL peut contenir un identifiant et un mot de passe (https://user:mdp@matrix.exemple.fr) quand Matrix
      // est protégé par l'authentification HTTP de l'hébergeur : ils partent en Basic, le jeton dans X-Matrix-Token.
      const url = new URL('/api/declarations', env.MATRIX_URL);
      const headers = { 'content-type': 'application/json' };
      if (env.MATRIX_TOKEN) headers['x-matrix-token'] = env.MATRIX_TOKEN;
      if (url.username) {
        headers.authorization = 'Basic ' + Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64');
        url.username = ''; url.password = '';
      }
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(doc), signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Matrix a répondu ${res.status} : ${await res.text()}`);
      const r = await res.json();
      if (r.nouvellesTables?.length) log.info?.(`[matrix] nouvelles tables déclarées : ${r.nouvellesTables.join(', ')}`);
    }
  } catch (e) {
    log.warn?.(`[matrix] déclaration du schéma de ${app} non transmise : ${e.message}`);
  }
  return doc;
}
