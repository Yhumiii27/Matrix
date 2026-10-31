// Différence de schéma lisible et suivi des migrations (écart E-06).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { differenceTable, collect, genreSource } from '../outils/collecteur.mjs';
import { suivreMigrations } from '../outils/sonde.mjs';
import { calculerSante } from '../outils/sante.mjs';

const col = (name, type = 'text', nullable = true, def = null) => ({ name, type, nullable, default: def });

test('differenceTable : colonnes ajoutées, retirées, modifiées ; clé, unicités, clés étrangères', () => {
  const avant = { name: 'docs', pk: ['id'], uniques: [['code']], columns: [col('id', 'integer', false), col('code'), col('titre', 'text', false), col('vieux')],
    fks: [{ columns: ['projet_id'], table: 'projets', refColumns: ['id'], declared: true }, { columns: ['x'], table: 'y', refColumns: ['id'], declared: false }] };
  const apres = { name: 'docs', pk: ['id', 'code'], uniques: [['titre']], columns: [col('id', 'integer', false), col('code', 'varchar(12)', false), col('titre', 'text', true, "'?'"), col('neuf', 'date')],
    fks: [{ columns: ['site'], table: 'sites', refColumns: ['code'], declared: true }] };
  const ev = differenceTable('codex', avant, apres, 'D');
  const parType = t => ev.filter(e => e.type === t);
  assert.deepEqual(parType('colonne_ajoutee').map(e => [e.colonne, e.apres.type]), [['neuf', 'date']]);
  assert.deepEqual(parType('colonne_supprimee').map(e => e.colonne), ['vieux']);
  assert.deepEqual(parType('colonne_modifiee').map(e => [e.colonne, e.champs]), [['code', ['type', 'nullable']], ['titre', ['nullable', 'default']]]);
  assert.deepEqual(parType('colonne_modifiee')[0].avant, { type: 'text', nullable: true, default: null });
  assert.deepEqual(parType('cle_modifiee')[0], { date: 'D', app: 'codex', table: 'docs', type: 'cle_modifiee', avant: ['id'], apres: ['id', 'code'] });
  assert.deepEqual([parType('unicite_ajoutee')[0].colonnes, parType('unicite_retiree')[0].colonnes], [['titre'], ['code']]);
  assert.deepEqual([parType('lien_ajoute')[0].lien, parType('lien_retire')[0].lien], ['site→sites(code)', 'projet_id→projets(id)']);
  assert.equal(differenceTable('codex', apres, apres, 'D').length, 0);
});

test('collect : changement de source signalé une fois, sans comparer les colonnes', t => {
  const racine = mkdtempSync(join(tmpdir(), 'matrix-hist-'));
  t.after(() => rmSync(racine, { recursive: true }));
  const data = join(racine, 'data'), decl = join(racine, 'decl');
  mkdirSync(join(racine, 'codex', 'drizzle'), { recursive: true }); mkdirSync(data); mkdirSync(decl);
  writeFileSync(join(racine, 'codex/drizzle/0000.sql'), 'CREATE TABLE "docs" (\n\t"id" text PRIMARY KEY NOT NULL,\n\t"code" varchar(12)\n);');
  const premier = collect({ root: racine, dataDir: data, declDir: decl });
  writeFileSync(join(data, 'catalogue.json'), JSON.stringify(premier.catalogue));
  writeFileSync(join(decl, 'codex.serveur.json'), JSON.stringify({ schema: 'matrix.schema/1', app: 'codex', origine: 'serveur', declareLe: '2026-10-31T00:00:00Z',
    tables: [{ name: 'docs', pk: ['id'], fks: [], uniques: [], columns: [col('id', 'text', false), col('code', 'character varying(12)')] }] }));
  const { events } = collect({ root: racine, dataDir: data, declDir: decl });
  assert.deepEqual(events.map(e => e.type), ['source_changee']);
  assert.equal(genreSource(events[0].avant), 'code');
  assert.equal(genreSource(events[0].apres), 'serveur');
});

test('suivreMigrations : migrations appliquées, changement hors migration, état gardé puis levé', () => {
  const d = (n, structure, extra = {}) => ({ app: 'vigie', empreinteStructure: structure, migrations: { journal: 'vigie.__drizzle_migrations', nombre: n }, ...extra });
  assert.deepEqual(suivreMigrations(null, d(3, 'a'), 'T0'), { evenements: [], horsMigration: null });
  let r = suivreMigrations(d(3, 'a'), d(4, 'b'), 'T1');
  assert.deepEqual(r.evenements.map(e => [e.type, e.avant, e.apres]), [['migrations_appliquees', 3, 4]]);
  r = suivreMigrations(d(4, 'b'), d(4, 'c'), 'T2');
  assert.deepEqual(r.evenements.map(e => e.type), ['hors_migration']);
  assert.equal(r.horsMigration.le, 'T2');
  const garde = suivreMigrations(d(4, 'c', { horsMigration: r.horsMigration }), d(4, 'c'), 'T3');
  assert.deepEqual(garde, { evenements: [], horsMigration: r.horsMigration });
  assert.equal(suivreMigrations(d(4, 'c', { horsMigration: r.horsMigration }), d(5, 'd'), 'T4').horsMigration, null);
  // Journal illisible ou absent : rien n'est conclu.
  assert.deepEqual(suivreMigrations({ app: 'vigie', empreinteStructure: 'a' }, { app: 'vigie', empreinteStructure: 'b' }, 'T5'), { evenements: [], horsMigration: null });
});

test('santé : état des migrations par outil, hors migration en attention', () => {
  const lecture = { luLe: 'T', outils: { vigie: { tables: [] }, codex: { tables: [] }, arche: { tables: [] } }, vues: [],
    liens: { registre: [], journal: [] }, references: [], verifier: { lignes: [] },
    migrations: { vigie: { journal: 'vigie.__drizzle_migrations', nombre: 4 }, codex: { journal: 'codex.__drizzle_migrations', erreur: 'permission denied' } } };
  const s = calculerSante(lecture, { horsMigration: { vigie: { le: 'T2', migrations: 4 } } });
  assert.deepEqual(Object.fromEntries(s.migrations.map(m => [m.app, m.etat])), { vigie: 'hors_migration', codex: 'illisible', arche: 'sans_journal' });
  assert.equal(s.etat, 'attention');
});
