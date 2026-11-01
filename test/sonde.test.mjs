// Sonde du serveur commun (outils/sonde.mjs) : décisions sur les liens, déclarations, et lecture d'un vrai serveur
// quand MATRIX_TEST_DATABASE_URL est fourni (rôle matrix_app, socle et partage/10, 12 et 90 joués).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validerLien, declarations, lireServeur, client } from '../outils/sonde.mjs';

test('validerLien : formes, lecteur, refus motivé, vue inexistante', () => {
  assert.deepEqual(validerLien({ vue: ' keystone.pub_projets ', lecteur: 'codex_app', statut: 'autorise' }),
    { vue: 'keystone.pub_projets', lecteur: 'codex_app', statut: 'autorise', motif: null, nature: 'lecture' });
  assert.throws(() => validerLien({ vue: 'keystone.projects', lecteur: 'codex_app', statut: 'autorise' }), /vue invalide/);
  assert.throws(() => validerLien({ vue: 'keystone.pub_projets', lecteur: 'postgres', statut: 'autorise' }), /lecteur inconnu/);
  assert.throws(() => validerLien({ vue: 'keystone.pub_projets', lecteur: 'keystone_app', statut: 'autorise' }), /ses propres données/);
  assert.throws(() => validerLien({ vue: 'keystone.pub_projets', lecteur: 'codex_app', statut: 'refuse', motif: '  ' }), /motivé/);
  const connues = new Set(['keystone.pub_projets']);
  assert.throws(() => validerLien({ vue: 'keystone.pub_futur', lecteur: 'codex_app', statut: 'autorise' }, connues), /seule une demande/);
  assert.equal(validerLien({ vue: 'keystone.pub_futur', lecteur: 'codex_app', statut: 'demande' }, connues).statut, 'demande');
  // Lien d'écriture (M-18, lot P4) : exécution d'une fonction pub_ d'un outil, jamais de Matrix.
  assert.equal(validerLien({ vue: 'codex.pub_deposer_document', lecteur: 'arche_app', statut: 'demande', nature: 'execution' }).nature, 'execution');
  assert.throws(() => validerLien({ vue: 'matrix.pub_creer_site', lecteur: 'arche_app', statut: 'autorise', nature: 'execution' }), /Matrix ne publie pas/);
  assert.throws(() => validerLien({ vue: 'codex.pub_x', lecteur: 'arche_app', statut: 'autorise', nature: 'ecriture' }), /nature/);
  assert.throws(() => validerLien({ vue: 'codex.pub_absente', lecteur: 'arche_app', statut: 'autorise', nature: 'execution' }, connues), /la fonction .* n'existe pas encore/);
});

test('declarations : structure seule, empreinte stable, outils seulement', () => {
  const t = { name: 'b', columns: [], pk: [], uniques: [], fks: [{ columns: ['x'], table: 'a', nom: 'fk', valide: true, indexe: false }], stats: { lignes: 3 } };
  const lecture = { luLe: '2026-10-30T00:00:00Z', outils: { keystone: { tables: [t, { ...t, name: 'a', fks: [] }] }, matrix: { tables: [t] } } };
  const [d] = declarations(lecture);
  assert.equal(declarations(lecture).length, 1);
  assert.deepEqual(d.tables.map(x => x.name), ['a', 'b']);
  assert.equal('stats' in d.tables[1], false);
  assert.deepEqual(d.tables[1].fks, [{ columns: ['x'], table: 'a' }]);
  assert.equal(d.empreinte, declarations({ ...lecture, luLe: 'autre' })[0].empreinte);
});

const URL = process.env.MATRIX_TEST_DATABASE_URL;
test('lireServeur : registre des liens, vues pub_ de Matrix, socle sans erreur', { skip: !URL && 'MATRIX_TEST_DATABASE_URL absent' }, async () => {
  const db = client(URL);
  await db.connect();
  try {
    const l = await lireServeur(db);
    assert.equal(l.liens.erreur, undefined, `registre illisible : ${l.liens.erreur}`);
    assert.ok(l.liens.registre.length > 0, 'registre vide : 90-droits.sql doit l\'avoir amorcé');
    assert.ok(l.vues.some(v => v.vue === 'matrix.pub_filiales'), 'matrix.pub_filiales absente');
    assert.deepEqual(l.verifier.lignes.filter(v => v.gravite === 'erreur'), []);
  } finally { await db.end(); }
});
