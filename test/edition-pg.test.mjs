// Saisies de Matrix sur le serveur commun (E-04, outils/edition-pg.mjs). Ne tourne qu'avec MATRIX_TEST_DATABASE_URL
// (matrix_app), sur un serveur d'essai où partage/12 et 15 sont joués. Écrit une fiche d'essai (keystone.e04_essai_<n>)
// et des décisions sur D01, laissées en place : à ne jamais lancer sur le serveur en service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from '../outils/sonde.mjs';
import { editionDisponible, lireEditionPg, reprendreEdition, documenterPg, deciderPg } from '../outils/edition-pg.mjs';

const URL = process.env.MATRIX_TEST_DATABASE_URL;
test('serveur : verrou et version, deux modifications simultanées, journal', { skip: !URL && 'MATRIX_TEST_DATABASE_URL absent' }, async () => {
  const a = client(URL), b = client(URL);
  await Promise.all([a.connect(), b.connect()]);
  try {
    assert.equal(await editionDisponible(a), true);
    const table = `e04_essai_${Date.now().toString(36)}`, cle = `keystone.${table}`;
    const catalogue = { apps: [{ id: 'keystone', tables: [{ name: table }] }] };

    // Deux personnes documentent en même temps la même fiche vierge : une seule passe, l'autre est refusée.
    const r = await Promise.allSettled([
      documenterPg(a, catalogue, { app: 'keystone', table, description: 'par Claire', version: null }, 'claire'),
      documenterPg(b, catalogue, { app: 'keystone', table, description: 'par Marc', version: null }, 'marc'),
    ]);
    assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
    const refus = r.find(x => x.status === 'rejected').reason;
    assert.equal(refus.code, 'conflit');
    const gagnante = r.find(x => x.status === 'fulfilled').value;

    // Avec la bonne version, la modification suivante passe ; la fiche, sa version et le journal sont à jour.
    const suite = await documenterPg(b, catalogue, { app: 'keystone', table, description: 'revue', note: 'n', version: gagnante.majLe }, 'marc');
    const ed = await lireEditionPg(a);
    assert.equal(ed.documentation[cle].description, 'revue');
    assert.equal(ed.documentation[cle].majLe, suite.majLe);
    assert.ok(ed.journal.filter(j => j.objet === cle).length >= 2);
    await assert.rejects(documenterPg(a, catalogue, { app: 'keystone', table, description: 'en retard', version: gagnante.majLe }, 'claire'), e => e.code === 'conflit');

    // Décision : l'option vue avant le choix doit être celle enregistrée.
    const actuelle = (await lireEditionPg(a)).decisions.D01?.option ?? null;
    const autre = actuelle === 'A' ? 'B' : 'A';
    assert.equal((await deciderPg(a, { id: 'D01', option: autre, avant: actuelle }, 'claire')).option, autre);
    await assert.rejects(deciderPg(b, { id: 'D01', option: actuelle, avant: actuelle }, 'marc'), e => e.code === 'conflit');

    // Reprise d'edition.json : jamais sur un serveur qui a déjà des saisies (il fait foi).
    assert.equal(await reprendreEdition(a, { documentation: { [cle]: { description: 'ancienne' } }, decisions: {}, journal: [] }), null);
    assert.equal((await lireEditionPg(a)).documentation[cle].description, 'revue');
    // Le journal ne se modifie pas.
    await assert.rejects(a.query(`DELETE FROM matrix.journal WHERE objet = $1`, [cle]), /interdit/);
  } finally {
    await Promise.all([a.end(), b.end()]);
  }
});
