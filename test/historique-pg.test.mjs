// Historique des schémas sur le serveur commun (E-04, outils/historique-pg.mjs). Les règles pures tournent toujours ; la
// partie base ne tourne qu'avec MATRIX_TEST_DATABASE_URL (matrix_app), sur un serveur d'essai où partage/12 et 16 sont
// joués. Elle écrit des événements d'essai (outil « keystone », table h04_essai_<n>), laissés en place : à ne jamais
// lancer sur le serveur en service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from '../outils/sonde.mjs';
import { empreinteEvenement, evenementValide, historiqueDisponible, envoyerHistorique, lireHistoriquePg, alignerHistorique } from '../outils/historique-pg.mjs';

test('empreinte : indépendante de l\'ordre des clés, distincte d\'un événement à l\'autre', () => {
  const a = { date: '2026-11-02T10:00:00.000Z', app: 'keystone', type: 'colonne_modifiee', table: 'projets', colonne: 'code', avant: { type: 'text', nullable: true }, apres: { nullable: false, type: 'text' } };
  const b = { apres: { type: 'text', nullable: false }, colonne: 'code', table: 'projets', type: 'colonne_modifiee', app: 'keystone', avant: { nullable: true, type: 'text' }, date: '2026-11-02T10:00:00.000Z' };
  assert.equal(empreinteEvenement(a), empreinteEvenement(b));
  assert.match(empreinteEvenement(a), /^[0-9a-f]{64}$/);
  assert.notEqual(empreinteEvenement(a), empreinteEvenement({ ...a, colonne: 'nom' }));
});

test('événement enregistrable : date, outil et type valides', () => {
  assert.ok(evenementValide({ date: '2026-11-02T10:00:00Z', app: 'codex', type: 'table_ajoutee', table: 'documents' }));
  assert.ok(evenementValide({ date: '2026-11-02T10:00:00Z', app: 'vigie', type: 'migration_appliquee' }));
  for (const e of [null, {}, { date: 'hier', app: 'codex', type: 'table_ajoutee' }, { date: '2026-11-02', app: 'Codex!', type: 'table_ajoutee' }, { date: '2026-11-02', app: 'codex', type: '' }])
    assert.ok(!evenementValide(e));
});

const URL = process.env.MATRIX_TEST_DATABASE_URL;
test('serveur : envoi rejouable, ajout seul, copie locale reconstituée', { skip: !URL && 'MATRIX_TEST_DATABASE_URL absent' }, async () => {
  const db = client(URL);
  await db.connect();
  try {
    assert.equal(await historiqueDisponible(db), true);
    const table = `h04_essai_${Date.now().toString(36)}`;
    const e1 = { date: '2026-10-01T08:00:00.000Z', app: 'keystone', type: 'table_ajoutee', table };
    const e2 = { date: '2026-10-02T08:00:00.000Z', app: 'keystone', type: 'colonne_modifiee', table, colonne: 'code', avant: { type: 'text' }, apres: { type: 'varchar(20)' } };
    const casse = { date: 'jamais', app: 'keystone', type: 'table_ajoutee', table };

    // Premier envoi : les deux événements valides ; le second envoi n'ajoute rien (empreinte).
    assert.equal(await envoyerHistorique(db, [e2, e1, casse]), 2);
    assert.equal(await envoyerHistorique(db, [e1, e2]), 0);
    const miens = (await lireHistoriquePg(db)).evenements.filter(e => e.table === table);
    assert.deepEqual(miens, [e1, e2]);   // ordre chronologique, détail (avant, après) gardé
    const { rows: [l] } = await db.query('SELECT quand, outil, type, nom_table, colonne FROM matrix.historique_schemas WHERE nom_table = $1 AND colonne = $2', [table, 'code']);
    assert.equal(l.quand.toISOString(), e2.date);
    assert.deepEqual([l.outil, l.type, l.colonne], ['keystone', 'colonne_modifiee', 'code']);

    // Ajout seul : ni modification ni suppression.
    await assert.rejects(db.query('UPDATE matrix.historique_schemas SET type = $1 WHERE nom_table = $2', ['x', table]));
    await assert.rejects(db.query('DELETE FROM matrix.historique_schemas WHERE nom_table = $1', [table]));

    // Copie locale perdue (volume recréé) : l'alignement la reconstitue depuis la table ; un événement non
    // enregistrable de la copie est gardé à la fin.
    const r = await alignerHistorique(db, { evenements: [casse] });
    assert.equal(r.ajoutes, 0);
    assert.equal(r.ignores, 1);
    assert.deepEqual(r.evenements.filter(e => e.table === table), [e1, e2, casse]);
  } finally { await db.end(); }
});
