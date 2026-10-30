// Tests des référentiels sur le serveur commun (E-01) : npm test (node --test "test/**/*.test.mjs").
// La partie base de données ne tourne qu'avec MATRIX_TEST_DATABASE_URL, en matrix_app, sur un serveur où le socle et
// partage/10-matrix-referentiels.sql sont joués. Elle écrit des codes d'essai (zone ZTEST, filiale ZZT, site ztest_*)
// qu'elle désactive à la fin : à ne jamais lancer sur le serveur en service.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparer, lireReferentiels, ecrireReferentiels } from '../outils/referentiels-pg.mjs';
import { client } from '../outils/sonde.mjs';

const site = (code, extra = {}) => ({ code, libelle: code, ville: null, pays_iso2: 'FR', ordre: 0, actif: true, filiale_code: null, latitude: null, longitude: null, ...extra });

test('comparer : ligne différente, ligne nouvelle, ligne à désactiver', () => {
  const serveur = [site('lyon'), site('marseille'), site('ancien', { actif: false }), site('havre')];
  const saisie = [site('lyon'), site('marseille', { ville: 'Marseille' }), site('neuf')];
  assert.deepEqual(comparer('sites', saisie, serveur), { aEcrire: ['marseille', 'neuf'], aDesactiver: ['havre'], egal: false });
});

test('comparer : nombres lus en texte (numeric) et devise char(3) égaux à la saisie', () => {
  const s = [site('lyon', { latitude: 45.764043, longitude: 4.835659 })];
  const db = [site('lyon', { latitude: '45.764043', longitude: '4.835659' })];
  assert.equal(comparer('sites', s, db).egal, true);
  const f = [{ code: 'APM', nom: 'A', pays_iso2: 'MA', zone_code: null, devise: 'MAD', ordre: 0, actif: true }];
  assert.equal(comparer('filiales', f, [{ ...f[0], devise: 'MAD' }]).egal, true);
});

test('comparer : une ligne déjà désactivée et absente de la saisie n\'est pas un écart', () => {
  assert.equal(comparer('sites', [site('lyon')], [site('lyon'), site('vieux', { actif: false })]).egal, true);
});

const URL = process.env.MATRIX_TEST_DATABASE_URL;
test('serveur : écriture, relecture, désactivation, refus sans effet', { skip: !URL && 'MATRIX_TEST_DATABASE_URL absent' }, async () => {
  const db = client(URL);
  await db.connect();
  try {
    const zone = { code: 'ZTEST', libelle: 'Zone d’essai', responsable: null, ordre: 99, actif: true, ouest: -10, nord: 50, est: 10, sud: 40 };
    const filiale = { code: 'ZZT', nom: 'Filiale d’essai', pays_iso2: 'FR', zone_code: 'ZTEST', devise: 'EUR', ordre: 99, actif: true };
    const avant = await lireReferentiels(db);
    const sites = [...avant.sites.filter(s => s.actif), site('ztest_a', { filiale_code: 'ZZT', latitude: 45.5, longitude: 4.25 }), site('ztest_b')];
    const bilan = await ecrireReferentiels(db, {
      zones: [...avant.zones.filter(z => z.actif), zone], filiales: [...avant.filiales.filter(f => f.actif), filiale], sites,
    });
    assert.equal(bilan.sites.ecrites, 2);
    let lu = await lireReferentiels(db);
    assert.equal(comparer('sites', sites, lu.sites).egal, true);
    assert.equal(comparer('zones', [...avant.zones.filter(z => z.actif), zone], lu.zones).egal, true);

    // Réécrire la même liste ne change rien ; retirer ztest_b le désactive sans le supprimer.
    assert.equal((await ecrireReferentiels(db, { sites })).sites.ecrites, 0);
    const b2 = await ecrireReferentiels(db, { sites: sites.filter(s => s.code !== 'ztest_b') });
    assert.deepEqual(b2.sites, { ecrites: 0, desactivees: 1 });
    lu = await lireReferentiels(db);
    assert.equal(lu.sites.find(s => s.code === 'ztest_b').actif, false);

    // Une contrainte du schéma refuse la liste : rien n'est écrit (transaction annulée).
    const mauvais = sites.map(s => s.code === 'ztest_a' ? { ...s, filiale_code: 'ZZZ' } : s);
    await assert.rejects(ecrireReferentiels(db, { sites: [...mauvais, site('ztest_c')] }), /refuse l'enregistrement/);
    lu = await lireReferentiels(db);
    assert.equal(lu.sites.some(s => s.code === 'ztest_c'), false);
    assert.equal(lu.sites.find(s => s.code === 'ztest_a').filiale_code, 'ZZT');
  } finally {
    // Nettoyage : codes d'essai désactivés (les tables n'acceptent pas toujours la suppression : clés étrangères).
    await db.query("UPDATE matrix.sites SET actif = false, filiale_code = NULL WHERE code LIKE 'ztest\\_%'").catch(() => {});
    await db.query("UPDATE matrix.filiales SET actif = false WHERE code = 'ZZT'").catch(() => {});
    await db.query("UPDATE matrix.zones SET actif = false WHERE code = 'ZTEST'").catch(() => {});
    await db.end();
  }
});
