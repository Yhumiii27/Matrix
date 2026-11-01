// Collecte des schémas (outils/collecteur.mjs, outils/litteral.mjs, écart E-14) : rien n'est exécuté, le serveur
// commun fait foi, les migrations Drizzle sont suivies jusqu'aux changements de colonnes, l'inconnu est signalé.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lireLitteral } from '../outils/litteral.mjs';
import { collect } from '../outils/collecteur.mjs';

test('lireLitteral : données seulement', () => {
  assert.deepEqual(lireLitteral(`{
    // commentaire
    a: { pk: 'id', cols: { id: "text", n: 1.5e2, ok: true, rien: null, l: [1, -2, 'x',], }, }, /* bloc */
    'b-c': \`gabarit simple\`, 3: 'trois',
  }`), { a: { pk: 'id', cols: { id: 'text', n: 150, ok: true, rien: null, l: [1, -2, 'x'] } }, 'b-c': 'gabarit simple', 3: 'trois' });
  for (const [texte, motif] of [
    ['{ a: process.exit(1) }', /valeur « process » refusée/], ['{ a: x }', /valeur « x »/], ['{ ...b }', /propagation/],
    ['{ a: `${1}` }', /gabarit/], ['{ a: 1 + 2 }', /« , » ou « } »/], ['{ __proto__: {} }', /__proto__/],
    ['{ a: 1 } ; f()', /texte en trop/], ["{ a: 'non fermée }", /chaîne non fermée/],
  ]) assert.throws(() => lireLitteral(texte), motif, texte);
});

function depot(fichiers) {
  const racine = mkdtempSync(join(tmpdir(), 'matrix-col-'));
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(join(racine, chemin, '..'), { recursive: true });
    writeFileSync(join(racine, chemin), contenu);
  }
  const data = join(racine, '_data'), decl = join(racine, '_decl');
  mkdirSync(data); mkdirSync(decl);
  return { racine, data, decl };
}
const app = (catalogue, id) => catalogue.apps.find(a => a.id === id);
const table = (catalogue, id, nom) => app(catalogue, id).tables.find(t => t.name === nom);

test('migrations Drizzle : colonnes ajoutées, renommées, retypées, nullité ; instruction inconnue signalée', t => {
  const { racine, data, decl } = depot({
    'codex/drizzle/0000_init.sql': `CREATE TABLE "docs" (\n\t"id" text PRIMARY KEY NOT NULL,\n\t"titre" text NOT NULL,\n\t"ancien" integer\n);`,
    'codex/drizzle/0001_suite.sql': [
      'ALTER TABLE "docs" ADD COLUMN "statut" text;',
      'ALTER TABLE "docs" ALTER COLUMN "titre" DROP NOT NULL;',
      'ALTER TABLE "docs" ALTER COLUMN "statut" SET NOT NULL;',
      'ALTER TABLE "docs" ALTER COLUMN "ancien" SET DATA TYPE bigint USING "ancien"::bigint;',
      'ALTER TABLE "docs" RENAME COLUMN "ancien" TO "numero";',
      'ALTER TABLE "docs" ADD CONSTRAINT "docs_statut_check" CHECK ("statut" <> \'\');',
      'CREATE INDEX "docs_statut_idx" ON "docs" USING btree ("statut");',
      'ALTER TABLE "docs" INHERIT "autre";',
    ].join('--> statement-breakpoint\n'),
  });
  t.after(() => rmSync(racine, { recursive: true }));
  const { catalogue } = collect({ root: racine, dataDir: data, declDir: decl });
  const cols = Object.fromEntries(table(catalogue, 'codex', 'docs').columns.map(c => [c.name, [c.type, c.nullable]]));
  assert.deepEqual(cols, { id: ['text', false], titre: ['text', true], numero: ['bigint', true], statut: ['text', false] });
  assert.equal(app(catalogue, 'codex').avertissements.length, 1);
  assert.match(app(catalogue, 'codex').avertissements[0], /0001_suite\.sql : ALTER TABLE "docs" INHERIT/);
});

test('Cursus : TABLES lu sans exécution ; code exécutable refusé, repli sans planter', t => {
  const ok = depot({ 'cursus/server/src/db.ts': `export const TABLES = {\n  employes: { pk: 'id', cols: { id: 'int', nomComplet: 'text' } },\n} satisfies Record<string, TableDef>;` });
  t.after(() => rmSync(ok.racine, { recursive: true }));
  const { catalogue } = collect({ root: ok.racine, dataDir: ok.data, declDir: ok.decl });
  assert.deepEqual(table(catalogue, 'cursus', 'employes').columns.map(c => c.name), ['id', 'nom_complet']);

  const piege = depot({ 'cursus/server/src/db.ts': `export const TABLES = {\n  employes: { pk: 'id', cols: (globalThis.__MATRIX_PIEGE = 1, {}) },\n} satisfies Record<string, TableDef>;` });
  t.after(() => rmSync(piege.racine, { recursive: true }));
  const r = collect({ root: piege.racine, dataDir: piege.data, declDir: piege.decl });
  assert.equal(globalThis.__MATRIX_PIEGE, undefined, 'le code de Cursus a été exécuté');
  assert.equal(app(r.catalogue, 'cursus'), undefined);
});

test('priorité : serveur commun, puis déclaration de l’outil, puis dépôt ; colonnes fermées = sensibles', t => {
  const { racine, data, decl } = depot({ 'vigie/drizzle/0000.sql': 'CREATE TABLE "events" (\n\t"id" integer PRIMARY KEY NOT NULL\n);' });
  t.after(() => rmSync(racine, { recursive: true }));
  const doc = (origine, colonnes, declareLe) => JSON.stringify({ schema: 'matrix.schema/1', app: 'vigie', origine, declareLe, empreinte: origine,
    tables: [{ name: 'events', pk: ['id'], fks: [], uniques: [], columns: colonnes }] });
  writeFileSync(join(decl, 'vigie.json'), doc('outil', [{ name: 'id', type: 'integer' }, { name: 'declare', type: 'text' }], '2026-10-31T10:00:00Z'));
  let { catalogue } = collect({ root: racine, dataDir: data, declDir: decl });
  assert.match(app(catalogue, 'vigie').source, /^déclaration du/);
  writeFileSync(join(decl, 'vigie.serveur.json'), doc('serveur', [{ name: 'id', type: 'integer' }, { name: 'injury', type: 'text', fermee: true }], '2026-10-30T10:00:00Z'));
  ({ catalogue } = collect({ root: racine, dataDir: data, declDir: decl }));
  assert.match(app(catalogue, 'vigie').source, /^serveur commun lu le/, 'le serveur passe avant la déclaration, même plus ancienne');
  assert.deepEqual(table(catalogue, 'vigie', 'events').columns.map(c => c.name), ['id', 'injury']);
  assert.ok(table(catalogue, 'vigie', 'events').sensitive.includes('injury'));
});
