// Sonde de Matrix : lit le serveur PostgreSQL commun pour tenir le registre des tables, des liens et de leur santé
// (décision du 24/10/2026 : Matrix « dataverse », lecture du serveur commun, registre des liens appliqué par
// infra/postgres/partage/90-droits.sql).
//
// Connexion : rôle matrix_app (MATRIX_DATABASE_URL). Il lit le catalogue système de chaque schéma d'outil, y compris
// les colonnes qui lui sont fermées (pg_attribute, pas information_schema) : Matrix connaît leur existence sans en
// lire le contenu. Aucune écriture, sauf dans le registre des liens (matrix.liens), par ecrireLien().
//
// Ce que rend lireServeur() :
//   - outils : pour chaque schéma d'outil présent, ses tables (colonnes, clés, liens déclarés, commentaires), ses
//     statistiques (lignes, lignes mortes, taille, dernière analyse) et ses vues pub_ (colonnes, lecteurs) ;
//   - liens : le registre matrix.liens et son journal récent ;
//   - sensibles : droits.colonnes_sensibles ; verifier : droits.verifier() (gravités erreur et attention) ;
//   - references : le contrôle des références entre outils de data/references.json (valeurs orphelines).

import { createHash } from 'node:crypto';
import { analyserVue, confirmer } from './lignage.mjs';
import pg from 'pg';

export const OUTILS = ['keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible'];
export const SCHEMAS_LIENS = [...OUTILS, 'matrix'];
export const LECTEURS = OUTILS.map(o => `${o}_app`).concat('matrix_app');
const JOURNAUX_MIGRATIONS = ['__drizzle_migrations', 'schema_migrations'];

const Q_TABLES = `
  SELECT n.nspname AS schema, c.relname AS nom, c.oid::bigint AS oid, c.relkind AS genre,
         obj_description(c.oid, 'pg_class') AS description,
         pg_total_relation_size(c.oid)::bigint AS taille,
         s.n_live_tup::bigint AS lignes, s.n_dead_tup::bigint AS lignes_mortes, s.n_mod_since_analyze::bigint AS modifiees,
         greatest(s.last_analyze, s.last_autoanalyze) AS analyse_le, greatest(s.last_vacuum, s.last_autovacuum) AS nettoyage_le,
         s.seq_scan::bigint AS lectures_sequentielles, s.idx_scan::bigint AS lectures_index
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
  WHERE n.nspname = ANY ($1) AND c.relkind IN ('r', 'p') AND NOT c.relispartition AND c.relname <> ALL ($2)
  ORDER BY 1, 2`;

const Q_COLONNES = `
  SELECT n.nspname AS schema, c.relname AS table, a.attname AS nom, format_type(a.atttypid, a.atttypmod) AS type,
         NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS defaut, col_description(c.oid, a.attnum) AS description,
         has_column_privilege(c.oid, a.attnum, 'SELECT') AS lisible
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE n.nspname = ANY ($1) AND c.relkind IN ('r', 'p', 'v') AND a.attnum > 0 AND NOT a.attisdropped
  ORDER BY 1, 2, a.attnum`;

const Q_CONTRAINTES = `
  SELECT n.nspname AS schema, rel.relname AS table, con.conname AS nom, con.contype AS genre, con.convalidated AS valide,
         array(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(n, o)
               JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n ORDER BY k.o)::text[] AS colonnes,
         rn.nspname AS ref_schema, ref.relname AS ref_table,
         array(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY k(n, o)
               JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n ORDER BY k.o)::text[] AS ref_colonnes,
         con.confdeltype AS suppression,
         -- Un lien est couvert si un index de la table commence par ses colonnes (jointures et suppressions en cascade).
         (con.contype <> 'f' OR EXISTS (
           SELECT FROM pg_index i
           WHERE i.indrelid = con.conrelid
             AND (i.indkey::int2[])[0:cardinality(con.conkey) - 1] @> con.conkey
             AND (i.indkey::int2[])[0:cardinality(con.conkey) - 1] <@ con.conkey)) AS indexe
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = rel.relnamespace
  LEFT JOIN pg_class ref ON ref.oid = con.confrelid
  LEFT JOIN pg_namespace rn ON rn.oid = ref.relnamespace
  WHERE n.nspname = ANY ($1) AND con.contype IN ('p', 'u', 'f')
  ORDER BY 1, 2, con.conname`;

const Q_VUES = `
  SELECT n.nspname AS schema, c.relname AS nom, obj_description(c.oid, 'pg_class') AS description,
         array(SELECT DISTINCT pg_get_userbyid(a.grantee) FROM aclexplode(c.relacl) a
               WHERE a.privilege_type = 'SELECT' AND a.grantee <> c.relowner ORDER BY 1)::text[] AS lecteurs
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = ANY ($1) AND c.relkind = 'v' AND c.relname LIKE 'pub\\_%'
  ORDER BY 1, 2`;

// Lignage des vues pub_ (E-07) : colonnes des tables dont chaque vue dépend (pg_depend, sûr) et définition de la vue
// (pg_get_viewdef), analysée par outils/lignage.mjs. Catalogues lisibles par tout rôle : aucune donnée n'est lue.
const Q_LIGNAGE = `
  SELECT vn.nspname || '.' || v.relname AS vue, pg_get_viewdef(v.oid, true) AS definition,
         array(SELECT DISTINCT tn.nspname || '.' || t.relname || '.' || a.attname
               FROM pg_rewrite r
               JOIN pg_depend d ON d.objid = r.oid AND d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass AND d.refobjsubid > 0
               JOIN pg_class t ON t.oid = d.refobjid AND t.oid <> v.oid
               JOIN pg_namespace tn ON tn.oid = t.relnamespace
               JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
               WHERE r.ev_class = v.oid ORDER BY 1)::text[] AS sources
  FROM pg_class v
  JOIN pg_namespace vn ON vn.oid = v.relnamespace
  WHERE vn.nspname = ANY ($1) AND v.relkind = 'v' AND v.relname LIKE 'pub\\_%'`;

const ON_DELETE = { a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' };
const nombre = v => v == null ? null : Number(v);
const ident = s => `"${String(s).replace(/"/g, '""')}"`;

export function client(url) {
  return new pg.Client({ connectionString: url, application_name: 'matrix-sonde', statement_timeout: 60000, connectionTimeoutMillis: 10000 });
}

async function essayer(db, sql, params = []) {
  try { return { lignes: (await db.query(sql, params)).rows }; } catch (e) { return { erreur: e.message, lignes: [] }; }
}

/** Lit le serveur commun. `db` est un client pg connecté (rôle matrix_app). */
export async function lireServeur(db, { references = [] } = {}) {
  const luLe = new Date().toISOString();
  const [tables, colonnes, contraintes, vues] = await Promise.all([
    db.query(Q_TABLES, [OUTILS, JOURNAUX_MIGRATIONS]).then(r => r.rows),
    db.query(Q_COLONNES, [SCHEMAS_LIENS]).then(r => r.rows),
    db.query(Q_CONTRAINTES, [OUTILS]).then(r => r.rows),
    db.query(Q_VUES, [SCHEMAS_LIENS]).then(r => r.rows),
  ]);
  const cle = (s, t) => `${s}.${t}`;
  const cols = new Map();
  for (const c of colonnes) (cols.get(cle(c.schema, c.table)) ?? cols.set(cle(c.schema, c.table), []).get(cle(c.schema, c.table))).push(c);
  const cons = new Map();
  for (const c of contraintes) (cons.get(cle(c.schema, c.table)) ?? cons.set(cle(c.schema, c.table), []).get(cle(c.schema, c.table))).push(c);

  const outils = {};
  for (const t of tables) {
    const o = (outils[t.schema] ??= { tables: [], vues: [] });
    const cs = cons.get(cle(t.schema, t.nom)) ?? [];
    const pk = cs.find(c => c.genre === 'p')?.colonnes ?? [];
    o.tables.push({
      name: t.nom,
      description: t.description ?? null,
      columns: (cols.get(cle(t.schema, t.nom)) ?? []).map(c => ({
        name: c.nom, type: c.type, nullable: c.nullable, pk: pk.length === 1 && pk[0] === c.nom, default: c.defaut ?? null,
        ...(c.description ? { description: c.description } : {}), ...(c.lisible ? {} : { fermee: true }),
      })),
      pk,
      uniques: cs.filter(c => c.genre === 'u').map(c => c.colonnes),
      fks: cs.filter(c => c.genre === 'f').map(c => ({
        columns: c.colonnes, table: c.ref_table, refColumns: c.ref_colonnes, onDelete: ON_DELETE[c.suppression] ?? null, declared: true,
        ...(c.ref_schema !== t.schema ? { schema: c.ref_schema } : {}), nom: c.nom, valide: c.valide, indexe: c.indexe,
      })),
      stats: {
        lignes: nombre(t.lignes), lignesMortes: nombre(t.lignes_mortes), modifiees: nombre(t.modifiees), taille: nombre(t.taille),
        analyseLe: t.analyse_le?.toISOString?.() ?? null, nettoyageLe: t.nettoyage_le?.toISOString?.() ?? null,
        lecturesSequentielles: nombre(t.lectures_sequentielles), lecturesIndex: nombre(t.lectures_index),
      },
    });
  }
  const lignage = new Map((await essayer(db, Q_LIGNAGE, [SCHEMAS_LIENS])).lignes.map(l => [l.vue, l]));
  const vuesParSchema = {};
  for (const v of vues) {
    const l = lignage.get(`${v.schema}.${v.nom}`);
    let colonnesLignage = null;
    try { colonnesLignage = l ? confirmer(analyserVue(l.definition, v.schema), l.sources) : null; } catch { colonnesLignage = null; }
    (vuesParSchema[v.schema] ??= []).push({
      vue: `${v.schema}.${v.nom}`, description: v.description, lecteurs: v.lecteurs,
      colonnes: (cols.get(cle(v.schema, v.nom)) ?? []).map(c => c.nom),
      ...(l ? { sources: l.sources, lignage: colonnesLignage } : {}),
    });
  }
  for (const [s, l] of Object.entries(vuesParSchema)) if (outils[s]) outils[s].vues = l;

  const registre = await essayer(db, `SELECT vue, lecteur, statut, origine, motif, demande_par, demande_le, decide_par, decide_le, modifie_le
                                      FROM matrix.liens ORDER BY vue, lecteur`);
  const journal = await essayer(db, `SELECT vue, lecteur, avant, apres, motif, par, le FROM matrix.liens_journal ORDER BY id DESC LIMIT 300`);
  const sensibles = await essayer(db, `SELECT schema_nom AS schema, table_nom AS table, colonne_nom AS colonne, motif, origine
                                       FROM droits.colonnes_sensibles ORDER BY 1, 2, 3`);
  const verifier = await essayer(db, `SELECT gravite, objet, constat FROM droits.verifier() WHERE gravite IN ('erreur', 'attention')`);
  const migrations = await lireMigrations(db, colonnes);

  return {
    luLe,
    outils,
    vues: Object.values(vuesParSchema).flat(),
    liens: { registre: registre.lignes, journal: journal.lignes, ...(registre.erreur ? { erreur: registre.erreur } : {}) },
    sensibles: sensibles.lignes,
    verifier: { lignes: verifier.lignes, ...(verifier.erreur ? { erreur: verifier.erreur } : {}) },
    references: await controlerReferences(db, references, colonnes),
    migrations,
  };
}

// Journal des migrations de chaque outil (écart E-06) : __drizzle_migrations (Drizzle : created_at en millisecondes,
// hash) ou schema_migrations, dans le schéma de l'outil. Nombre de migrations appliquées et date de la dernière ; un
// journal absent ou illisible est dit tel quel. Sert à repérer une structure changée sans nouvelle migration.
async function lireMigrations(db, colonnes) {
  const out = {};
  for (const app of OUTILS) {
    const journal = JOURNAUX_MIGRATIONS.find(j => colonnes.some(c => c.schema === app && c.table === j));
    if (!journal) continue;
    const cols = new Set(colonnes.filter(c => c.schema === app && c.table === journal).map(c => c.nom));
    const t = `${ident(app)}.${ident(journal)}`;
    const quand = cols.has('created_at')
      ? (journal === '__drizzle_migrations' ? `to_timestamp(max(created_at)::double precision / 1000)` : `max(created_at)::timestamptz`)
      : cols.has('applied_at') ? 'max(applied_at)::timestamptz' : 'NULL::timestamptz';
    const empreinte = cols.has('hash') ? `, (SELECT hash FROM ${t} ORDER BY ${cols.has('created_at') ? 'created_at DESC, ' : ''}hash DESC LIMIT 1) AS empreinte` : '';
    const r = await essayer(db, `SELECT count(*)::int AS nombre, ${quand} AS derniere${empreinte} FROM ${t}`);
    out[app] = r.erreur ? { journal: `${app}.${journal}`, erreur: r.erreur }
      : { journal: `${app}.${journal}`, nombre: r.lignes[0].nombre, derniere: r.lignes[0].derniere?.toISOString?.() ?? null, ...(r.lignes[0].empreinte ? { empreinte: r.lignes[0].empreinte } : {}) };
  }
  return out;
}

// Référence « schema.table.colonne » → « schema.vue.colonne » : nombre de valeurs distinctes orphelines (absentes de la
// cible). Une colonne absente du serveur ou illisible pour matrix_app rend la référence « non contrôlable ».
async function controlerReferences(db, references, colonnes) {
  const existe = new Set(colonnes.map(c => `${c.schema}.${c.table}.${c.nom}`));
  const lisible = new Set(colonnes.filter(c => c.lisible).map(c => `${c.schema}.${c.table}.${c.nom}`));
  const out = [];
  for (const r of references) {
    const [ds, dt, dc] = r.de.split('.'), [vs, vt, vc] = r.vers.split('.');
    const base = { id: r.id, decision: r.decision, libelle: r.libelle, de: r.de, vers: r.vers };
    const manque = [r.de, r.vers].filter(x => !existe.has(x));
    if (manque.length) { out.push({ ...base, etat: 'non_controlable', detail: `absent du serveur : ${manque.join(', ')}` }); continue; }
    const ferme = [r.de, r.vers].filter(x => !lisible.has(x));
    if (ferme.length) { out.push({ ...base, etat: 'non_controlable', detail: `illisible pour Matrix : ${ferme.join(', ')}` }); continue; }
    const sql = `SELECT count(DISTINCT s.${ident(dc)})::bigint AS valeurs,
                        count(DISTINCT s.${ident(dc)}) FILTER (WHERE NOT EXISTS (
                          SELECT FROM ${ident(vs)}.${ident(vt)} v WHERE v.${ident(vc)}::text = s.${ident(dc)}::text))::bigint AS orphelines,
                        (array_agg(DISTINCT s.${ident(dc)}::text) FILTER (WHERE NOT EXISTS (
                          SELECT FROM ${ident(vs)}.${ident(vt)} v WHERE v.${ident(vc)}::text = s.${ident(dc)}::text)))[1:5] AS exemples
                 FROM ${ident(ds)}.${ident(dt)} s WHERE s.${ident(dc)} IS NOT NULL AND s.${ident(dc)}::text <> ''`;
    const r2 = await essayer(db, sql);
    if (r2.erreur) { out.push({ ...base, etat: 'non_controlable', detail: r2.erreur }); continue; }
    const { valeurs, orphelines, exemples } = r2.lignes[0];
    out.push({ ...base, etat: Number(orphelines) ? 'orphelins' : 'ok', valeurs: Number(valeurs), orphelines: Number(orphelines), exemples: exemples ?? [] });
  }
  return out;
}

/** Déclarations matrix.schema/1 tirées de la lecture du serveur (structure seulement, sans statistiques). */
export function declarations(lecture) {
  return Object.entries(lecture.outils).filter(([app]) => OUTILS.includes(app)).map(([app, o]) => {
    const tables = o.tables.map(({ stats, ...t }) => ({
      ...t, fks: t.fks.map(({ nom, valide, indexe, ...f }) => f),
    })).sort((a, b) => a.name.localeCompare(b.name));
    const empreinte = createHash('sha256').update(JSON.stringify(tables)).digest('hex').slice(0, 16);
    // Structure seule (colonnes, types, nullité, défauts, clés) : ni commentaires ni droits de Matrix, que le socle peut
    // changer sans migration de l'outil. Sert à repérer un changement hors migration (E-06).
    const structure = tables.map(t => ({ n: t.name, c: t.columns.map(c => [c.name, c.type, c.nullable, c.default]), p: t.pk, u: t.uniques, f: t.fks }));
    const empreinteStructure = createHash('sha256').update(JSON.stringify(structure)).digest('hex').slice(0, 16);
    return { schema: 'matrix.schema/1', app, version: null, origine: 'serveur', declareLe: lecture.luLe, empreinte, empreinteStructure,
      ...(lecture.migrations?.[app] ? { migrations: lecture.migrations[app] } : {}), tables };
  });
}

// ── Registre des liens ───────────────────────────────────────────────────

const STATUTS = ['autorise', 'refuse', 'demande'];

/** Contrôle une décision sur un lien. Renvoie le lien normalisé ou lève une erreur lisible. */
export function validerLien({ vue, lecteur, statut, motif }, vuesConnues = null) {
  vue = String(vue ?? '').trim(); lecteur = String(lecteur ?? '').trim(); statut = String(statut ?? '').trim();
  if (!/^(keystone|codex|cursus|vigie|arche|crucible|matrix)\.pub_[a-z0-9_]+$/.test(vue)) throw new Error(`vue invalide (« ${vue} ») : schéma.pub_nom attendu`);
  if (!LECTEURS.includes(lecteur)) throw new Error(`lecteur inconnu : ${lecteur}`);
  if (`${vue.split('.')[0]}_app` === lecteur) throw new Error('un outil lit ses propres vues sans lien');
  if (!STATUTS.includes(statut)) throw new Error('statut : autorise, refuse ou demande');
  motif = motif == null ? null : String(motif).trim().slice(0, 500) || null;
  if (statut === 'refuse' && !motif) throw new Error('un refus doit être motivé');
  if (vuesConnues && !vuesConnues.has(vue) && statut !== 'demande') throw new Error(`la vue ${vue} n'existe pas encore sur le serveur : seule une demande est possible`);
  return { vue, lecteur, statut, motif };
}

/** Inscrit une décision (ou une demande) dans matrix.liens. Le journal est tenu par le déclencheur de la table. */
export async function ecrireLien(db, lien, par) {
  const r = await db.query(
    `INSERT INTO matrix.liens AS l (vue, lecteur, statut, origine, motif, demande_par, demande_le, decide_par, decide_le)
     VALUES ($1, $2, $3, 'matrix', $4, CASE WHEN $3 = 'demande' THEN $5 END, CASE WHEN $3 = 'demande' THEN now() END,
             CASE WHEN $3 <> 'demande' THEN $5 END, CASE WHEN $3 <> 'demande' THEN now() END)
     ON CONFLICT (vue, lecteur) DO UPDATE SET statut = EXCLUDED.statut, motif = EXCLUDED.motif,
       demande_par = CASE WHEN EXCLUDED.statut = 'demande' THEN EXCLUDED.demande_par ELSE l.demande_par END,
       demande_le = CASE WHEN EXCLUDED.statut = 'demande' THEN EXCLUDED.demande_le ELSE l.demande_le END,
       decide_par = CASE WHEN EXCLUDED.statut <> 'demande' THEN EXCLUDED.decide_par ELSE NULL END,
       decide_le = CASE WHEN EXCLUDED.statut <> 'demande' THEN EXCLUDED.decide_le ELSE NULL END
     RETURNING vue, lecteur, statut, origine, motif, demande_par, demande_le, decide_par, decide_le, modifie_le`,
    [lien.vue, lien.lecteur, lien.statut, lien.motif, par]);
  return r.rows[0];
}

/**
 * Suivi des migrations d'un outil entre deux lectures du serveur (écart E-06). `avant` et `apres` sont ses déclarations
 * (empreinteStructure, migrations). Renvoie les événements d'historique et l'état « hors migration » à garder :
 *   - nouvelles migrations appliquées → événement migrations_appliquees, l'état hors migration est levé ;
 *   - structure changée sans nouvelle migration (journal lisible des deux côtés) → hors_migration, gardé jusqu'à la
 *     prochaine migration appliquée ;
 *   - sinon, l'état précédent est gardé.
 */
export function suivreMigrations(avant, apres, date) {
  const evenements = [];
  const ma = avant?.migrations, mb = apres?.migrations;
  const lisibles = ma && mb && ma.nombre != null && mb.nombre != null;
  let horsMigration = avant?.horsMigration ?? null;
  if (lisibles && mb.nombre !== ma.nombre) {
    evenements.push({ date, app: apres.app, type: 'migrations_appliquees', avant: ma.nombre, apres: mb.nombre, derniere: mb.derniere ?? null });
    horsMigration = null;
  } else if (lisibles && avant.empreinteStructure && apres.empreinteStructure && avant.empreinteStructure !== apres.empreinteStructure) {
    horsMigration = { le: date, migrations: mb.nombre, derniere: mb.derniere ?? null };
    evenements.push({ date, app: apres.app, type: 'hors_migration', migrations: mb.nombre, derniere: mb.derniere ?? null });
  }
  return { evenements, horsMigration };
}
