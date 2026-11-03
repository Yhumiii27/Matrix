// Sonde du serveur commun (outils/sonde.mjs) : décisions sur les liens, déclarations, et lecture d'un vrai serveur
// quand MATRIX_TEST_DATABASE_URL est fourni (rôle matrix_app, socle et partage/10, 12 et 90 joués).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validerLien, declarations, lireServeur, client, validerDemande, demanderLien, liensDuLecteur } from '../outils/sonde.mjs';

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

test('demande d\'accès d\'un outil (E-10) : outil, vue d\'un autre outil, motif', () => {
  assert.deepEqual(validerDemande({ outil: 'arche', vue: 'keystone.pub_projets', motif: '  Rattacher les CAPEX  ' }),
    { vue: 'keystone.pub_projets', lecteur: 'arche_app', statut: 'demande', motif: 'Rattacher les CAPEX', nature: 'lecture' });
  assert.equal(validerDemande({ outil: 'keystone', vue: 'vigie.pub_creer_ncr', nature: 'execution', motif: 'Ouvrir une NCR' }).nature, 'execution');
  assert.throws(() => validerDemande({ outil: 'matrix', vue: 'keystone.pub_projets', motif: 'xxxxxxxxxxxx' }), /outil inconnu/);
  assert.throws(() => validerDemande({ outil: 'bi', vue: 'keystone.pub_projets', motif: 'xxxxxxxxxxxx' }), /outil inconnu/);
  assert.throws(() => validerDemande({ outil: 'arche', vue: 'keystone.pub_projets', motif: 'court' }), /motif obligatoire/);
  assert.throws(() => validerDemande({ outil: 'arche', vue: 'arche.pub_capex', motif: 'xxxxxxxxxxxx' }), /propres données/);
  assert.throws(() => validerDemande({ outil: 'arche', vue: 'keystone.projects', motif: 'xxxxxxxxxxxx' }), /invalide/);
});

const URL_DEMANDES = process.env.MATRIX_TEST_DATABASE_URL;
test('serveur : demande d\'un outil, jamais de rétrogradation d\'un lien autorisé', { skip: !URL_DEMANDES && 'MATRIX_TEST_DATABASE_URL absent' }, async () => {
  const db = client(URL_DEMANDES);
  await db.connect();
  try {
    const vue = `crucible.pub_e10_${Date.now().toString(36)}`;
    const lien = validerDemande({ outil: 'arche', vue, motif: 'Essai E-10 : première demande' });
    const r1 = await demanderLien(db, lien, 'arche (API)');
    assert.deepEqual([r1.statut, r1.demande_par, r1.inchange], ['demande', 'arche (API)', false]);
    // Nouveau motif sur une demande en attente.
    const r2 = await demanderLien(db, { ...lien, motif: 'Essai E-10 : motif précisé' }, 'arche (API)');
    assert.equal(r2.motif, 'Essai E-10 : motif précisé');
    // Refusé par la DSI, puis redemandé : repasse en demande.
    await db.query(`UPDATE matrix.liens SET statut = 'refuse', motif = 'non', decide_par = 'dsi', decide_le = now() WHERE vue = $1 AND lecteur = 'arche_app'`, [vue]);
    assert.equal((await demanderLien(db, lien, 'arche (API)')).statut, 'demande');
    // Autorisé : une nouvelle demande ne change rien.
    await db.query(`UPDATE matrix.liens SET statut = 'autorise', motif = 'ok', decide_par = 'dsi', decide_le = now() WHERE vue = $1 AND lecteur = 'arche_app'`, [vue]);
    const r3 = await demanderLien(db, lien, 'arche (API)');
    assert.deepEqual([r3.statut, r3.motif, r3.inchange], ['autorise', 'ok', true]);
    // Suivi : la vue n'existe pas, aucun droit posé.
    const miens = (await liensDuLecteur(db, 'arche_app')).find(l => l.vue === vue);
    assert.deepEqual([miens.statut, miens.existe, miens.droit_pose], ['autorise', false, null]);
  } finally { await db.end(); }
});
