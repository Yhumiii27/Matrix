// Visionneuse des données (outils/visionneuse.mjs). Validation toujours ; lecture sur PostgreSQL avec
// MATRIX_TEST_DATABASE_URL (matrix_app) et MATRIX_TEST_ADMIN_URL (table d'essai dans le schéma crucible, supprimée ensuite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from '../outils/sonde.mjs';
import { validerDemande, lireDonnees } from '../outils/visionneuse.mjs';

test('demande : outil, table, page, taille, tri et filtre contrôlés', () => {
  assert.deepEqual(validerDemande({ outil: 'keystone', table: 'projects' }),
    { outil: 'keystone', table: 'projects', par: 50, page: 1, tri: null, sens: 'asc', colonne: null, contient: '' });
  assert.equal(validerDemande({ outil: 'vigie', table: 'events', par: '100', page: '3', sens: 'desc' }).par, 100);
  assert.equal(validerDemande({ outil: 'vigie', table: 'events', par: '7' }).par, 50);
  assert.equal(validerDemande({ outil: 'vigie', table: 'events', page: '-4' }).page, 1);
  assert.equal(validerDemande({ outil: 'vigie', table: 'events', colonne: 'title' }).colonne, null);   // sans texte, pas de filtre
  for (const [q, re] of [[{ outil: 'droits', table: 'x' }, /outil inconnu/], [{ outil: 'vigie', table: 'events; drop' }, /table invalide/],
    [{ outil: 'vigie', table: 'events', tri: 'a"b' }, /tri invalide/], [{ outil: 'vigie', table: 'events', colonne: 'x y', contient: 'a' }, /filtre invalide/]])
    assert.throws(() => validerDemande(q), re);
});

const BASE = process.env.MATRIX_TEST_DATABASE_URL, ADMIN = process.env.MATRIX_TEST_ADMIN_URL;
test('serveur : colonnes fermées jamais lues, tri, filtre, pages, binaire, texte long', { skip: !(BASE && ADMIN) && 'MATRIX_TEST_DATABASE_URL ou MATRIX_TEST_ADMIN_URL absent' }, async () => {
  const admin = client(ADMIN), db = client(BASE);
  await Promise.all([admin.connect(), db.connect()]);
  const t = `vis_essai_${Date.now().toString(36)}`, f = `vis_ferme_${Date.now().toString(36)}`;
  try {
    // Colonnes sensibles déclarées au socle avant la création : le déclencheur droits_ddl les ferme à matrix_lecture.
    await admin.query(`INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif) VALUES
      ('crucible', '${t}', 'secret', 'essai de la visionneuse'), ('crucible', '${f}', '*', 'essai de la visionneuse');
      CREATE TABLE crucible.${t} (id int PRIMARY KEY, nom text, note text, photo bytea, secret text);
      INSERT INTO crucible.${t} SELECT g, 'nom ' || g, CASE WHEN g = 3 THEN repeat('x', 700) END, CASE WHEN g = 1 THEN '\\x0102'::bytea END, 's' FROM generate_series(1, 7) g;
      CREATE TABLE crucible.${f} (x text);`);
    const r = await lireDonnees(db, { outil: 'crucible', table: t, par: 25, tri: 'id', sens: 'desc' });
    assert.equal(r.genre, 'table');
    assert.deepEqual(r.colonnes.map(c => [c.nom, c.lisible]), [['id', true], ['nom', true], ['note', true], ['photo', true], ['secret', false]]);
    assert.equal(r.total, 7);
    assert.deepEqual(r.lignes[0], ['7', 'nom 7', null, null, { ferme: true }]);
    const l3 = r.lignes.find(l => l[0] === '3'), l1 = r.lignes.find(l => l[0] === '1');
    assert.equal(l3[2].length, 501);
    assert.ok(l3[2].endsWith('…'));
    assert.equal(l1[3], '(binaire, 2 octets)');
    // Pages de 25 : une seule ; filtre (accents, joker échappé) ; colonne fermée refusée au tri et au filtre.
    assert.equal(r.suivante, false);
    const p = await lireDonnees(db, { outil: 'crucible', table: t, par: 25, colonne: 'nom', contient: 'NOM 5' });
    assert.deepEqual([p.total, p.lignes.length, p.lignes[0][0]], [1, 1, '5']);
    assert.equal((await lireDonnees(db, { outil: 'crucible', table: t, colonne: 'nom', contient: '%' })).total, 0);
    await assert.rejects(lireDonnees(db, { outil: 'crucible', table: t, tri: 'secret' }), /fermée/);
    await assert.rejects(lireDonnees(db, { outil: 'crucible', table: t, colonne: 'secret', contient: 's' }), /fermée/);
    // Table entièrement fermée : rien n'est lu. Table absente : 404.
    const fermee = await lireDonnees(db, { outil: 'crucible', table: f });
    assert.deepEqual([fermee.fermee, fermee.lignes], [true, []]);
    await assert.rejects(lireDonnees(db, { outil: 'crucible', table: 'nexiste_pas' }), e => e.code === 404);
    // La connexion ressort hors transaction.
    assert.equal((await db.query('SELECT 1 AS un')).rows[0].un, 1);
  } finally {
    await admin.query(`DROP TABLE IF EXISTS crucible.${t}; DROP TABLE IF EXISTS crucible.${f}; DELETE FROM droits.colonnes_sensibles WHERE table_nom IN ('${t}', '${f}')`).catch(() => {});
    await Promise.all([admin.end(), db.end()]);
  }
});
