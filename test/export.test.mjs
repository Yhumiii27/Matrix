// Exports du catalogue et API de lecture (outils/export.mjs, écart E-12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fiches, csvTables, csvColonnes, dictionnaireHtml, diagrammeMermaid } from '../outils/export.mjs';

const catalogue = { apps: [
  { id: 'keystone', tables: [
    { name: 'projects', domain: 'Portefeuille', description: 'Projets', pk: ['id'], uniques: [['code']],
      columns: [{ name: 'id', type: 'uuid', nullable: false }, { name: 'code', type: 'text', nullable: false }, { name: 'client_id', type: 'uuid', nullable: true }],
      fks: [{ columns: ['client_id'], table: 'clients', refColumns: ['id'], declared: true }] },
    { name: 'clients', domain: 'Organisation', description: '=HYPERLINK("x"); "clients"', pk: ['id'], uniques: [], sensitive: ['iban'],
      columns: [{ name: 'id', type: 'uuid', nullable: false }, { name: 'iban', type: 'character varying(34)', nullable: true }], fks: [] },
  ] },
  { id: 'codex', tables: [{ name: 'documents', domain: 'Documents', pk: ['id'], uniques: [], columns: [{ name: 'id', type: 'text', nullable: false }], fks: [] }] },
] };
const edition = { documentation: { 'keystone.projects': { description: 'Projets EPC2i', responsable: 'PMO', note: 'Clé : code' } } };
const sante = { vues: [{ vue: 'keystone.pub_projets', lecteurs: ['codex_app', 'matrix_lecture'], sources: ['keystone.projects.code'],
  lignage: [{ colonne: 'code', genre: 'directe', sources: [{ table: 'keystone.projects', colonne: 'code' }] }] }] };

test('fiches : documentation de Matrix, sensibles, références, vues qui publient', () => {
  const [p, c] = fiches(catalogue, { edition, sante, outil: 'keystone' });
  assert.equal(p.description, 'Projets EPC2i');
  assert.equal(p.responsable, 'PMO');
  assert.equal(p.colonnes.find(x => x.nom === 'client_id').reference.table, 'clients');
  assert.deepEqual(p.publiee_par, [{ vue: 'keystone.pub_projets', lecteurs: ['codex_app'], colonnes: [{ colonne: 'code', genre: 'directe', sources: ['code'] }] }]);
  assert.equal(c.colonnes.find(x => x.nom === 'iban').sensible, true);
  assert.equal(fiches(catalogue).length, 3);
});

test('CSV : BOM, séparateur « ; », guillemets, formule neutralisée', () => {
  const t = csvTables(fiches(catalogue, { edition, sante }));
  assert.ok(t.startsWith('﻿outil;table;domaine;'));
  const lignes = t.trim().split('\r\n');
  assert.equal(lignes.length, 4);
  assert.match(lignes[1], /^Keystone;projects;Portefeuille;Projets EPC2i;3;id;1;;PMO;keystone\.pub_projets;$/);
  assert.match(lignes[2], /^Keystone;clients;Organisation;"'=HYPERLINK\(""x""\); ""clients""";2;id;0;iban;;;$/);
  const c = csvColonnes(fiches(catalogue));
  assert.match(c, /\r\nKeystone;projects;client_id;uuid;non;;clients\.id;;\r\n/);
  assert.match(c, /\r\nKeystone;clients;iban;character varying\(34\);non;;;oui;\r\n/);
});

test('dictionnaire : HTML autonome, échappé, une section par table', () => {
  const html = dictionnaireHtml(fiches(catalogue, { edition, sante }), { genereLe: '2026-10-31T12:00:00Z' });
  assert.match(html, /^<!doctype html>/);
  assert.equal((html.match(/<section class="table"/g) || []).length, 3);
  assert.match(html, /=HYPERLINK\(&quot;x&quot;\); &quot;clients&quot;/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /Publiée par <span class="mono">keystone\.pub_projets<\/span> \(lue par codex_app : code → code, telle quelle\)/);
});

test('diagramme Mermaid : entités, PK/FK, relation seulement vers une table de l’extrait', () => {
  const mmd = diagrammeMermaid(fiches(catalogue, { outil: 'keystone' }));
  assert.match(mmd, /^erDiagram\n/);
  assert.match(mmd, /  projects \{\n    uuid id PK\n    text code\n    uuid client_id FK\n  \}/);
  assert.match(mmd, /    character_varying iban\n/);
  assert.match(mmd, /  clients \|\|--o\{ projects : "client_id \(facultatif\)"/);
  const seul = diagrammeMermaid(fiches(catalogue, { outil: 'keystone' }).filter(f => f.table === 'projects'));
  assert.doesNotMatch(seul, /\|\|--o\{/);
});
