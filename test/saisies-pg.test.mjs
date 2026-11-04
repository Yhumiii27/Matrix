// Glossaire et règles de qualité saisis par la DSI (M-04 ; E-08, E-09 ; outils/saisies-pg.mjs). Règles pures toujours ;
// partie base avec MATRIX_TEST_DATABASE_URL (matrix_app, partage/12, 15 et 17 joués). Écrit des termes et des règles
// d'essai, laissés en place : à ne jamais lancer sur le serveur en service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { client } from '../outils/sonde.mjs';
import { idTerme, validerTerme, saisiesDisponibles, lireGlossaire, enregistrerTerme, lireReglesPg, reglesActives, reprendreRegles, enregistrerRegle } from '../outils/saisies-pg.mjs';

const CATALOGUE = { apps: [{ id: 'keystone', tables: [{ name: 'projects', columns: [{ name: 'code' }, { name: 'name' }] }] },
  { id: 'vigie', tables: [{ name: 'events', columns: [{ name: 'keystone_project_code' }] }] }] };

test('terme : identifiant tiré du libellé, champs contrôlés, colonnes du catalogue', () => {
  assert.equal(idTerme('Code projet (Keystone) — clé D02'), 'code-projet-keystone-cle-d02');
  const v = validerTerme({ terme: ' Code projet ', definition: 'Identifiant du projet', synonymes: 'n° projet, numéro de projet, n° projet',
    colonnes: 'vigie.events.keystone_project_code\nkeystone.projects.code' }, CATALOGUE);
  assert.equal(v.id, 'code-projet');
  assert.deepEqual(v.fiche.synonymes, ['n° projet', 'numéro de projet']);
  assert.deepEqual(v.fiche.colonnes, ['keystone.projects.code', 'vigie.events.keystone_project_code']);
  assert.equal(v.version, undefined);
  assert.throws(() => validerTerme({ terme: '', definition: 'x' }, CATALOGUE), /Terme : obligatoire/);
  assert.throws(() => validerTerme({ terme: 'x y', definition: '' }, CATALOGUE), /Définition : obligatoire/);
  assert.throws(() => validerTerme({ terme: 'Code', definition: 'x', colonnes: 'keystone.projects' }, CATALOGUE), /outil\.table\.colonne/);
  assert.throws(() => validerTerme({ terme: 'Code', definition: 'x', colonnes: 'keystone.projects.inconnue' }, CATALOGUE), /inconnue du catalogue/);
  assert.throws(() => validerTerme({ terme: 'Code', definition: 'x', id: 'Pas Bon' }, CATALOGUE), /identifiant invalide/);
});

const BASE = process.env.MATRIX_TEST_DATABASE_URL;
test('serveur : glossaire et règles, version contrôlée, retrait, journal', { skip: !BASE && 'MATRIX_TEST_DATABASE_URL absent' }, async () => {
  const db = client(BASE);
  await db.connect();
  try {
    assert.equal(await saisiesDisponibles(db), true);
    // Règles : reprise du fichier quand la table est vide (une seule fois).
    const doc = JSON.parse(readFileSync(new URL('../data/regles-qualite.json', import.meta.url), 'utf8'));
    const n = await reprendreRegles(db, doc);
    assert.ok(n === null || n === doc.regles.length);
    assert.equal(await reprendreRegles(db, doc), null);

    // Glossaire : création, conflit sur une version dépassée, retrait.
    const terme = `Essai E-08 ${Date.now().toString(36)}`;
    const t1 = await enregistrerTerme(db, CATALOGUE, { terme, definition: 'Première définition', colonnes: ['keystone.projects.code'], version: null }, 'claire');
    assert.equal(t1.actif, true);
    await assert.rejects(enregistrerTerme(db, CATALOGUE, { terme, definition: 'Autre', version: null }, 'marc'), e => e.code === 'conflit');
    const t2 = await enregistrerTerme(db, CATALOGUE, { id: t1.id, terme, definition: 'Définition revue', colonnes: ['keystone.projects.code'], version: t1.majLe }, 'marc');
    await assert.rejects(enregistrerTerme(db, CATALOGUE, { id: t1.id, terme, definition: 'En retard', version: t1.majLe }, 'claire'), e => e.code === 'conflit');
    const t3 = await enregistrerTerme(db, CATALOGUE, { id: t1.id, terme, definition: 'Définition revue', colonnes: ['keystone.projects.code'], actif: false, version: t2.majLe }, 'marc');
    assert.equal(t3.actif, false);
    assert.equal((await lireGlossaire(db)).find(t => t.id === t1.id).definition, 'Définition revue');
    const { rows: journal } = await db.query(`SELECT action FROM matrix.journal WHERE objet = $1 ORDER BY id`, [`glossaire:${t1.id}`]);
    assert.deepEqual(journal.map(j => j.action), ['Terme ajouté au glossaire', 'Terme du glossaire modifié', 'Terme retiré du glossaire']);

    // Règle : ajout, modification, retrait ; une règle retirée n'est plus contrôlée.
    const id = `Q${900 + Math.floor(Math.random() * 99)}`;
    const avant = (await lireReglesPg(db)).find(r => r.id === id);
    const r1 = await enregistrerRegle(db, { id, table: 'keystone.projects', type: 'unicite', colonnes: ['code'], libelle: 'Essai E-09', gravite: 'erreur', version: avant?.majLe ?? null }, 'claire');
    assert.deepEqual([r1.id, r1.actif, r1.colonnes], [id, true, ['code']]);
    assert.ok((await reglesActives(db)).regles.some(r => r.id === id));
    await assert.rejects(enregistrerRegle(db, { id, table: 'keystone.projects', type: 'unicite', colonnes: ['code'], libelle: 'x', version: avant?.majLe ?? null }, 'marc'),
      e => e.code === 'conflit' || /colonne/.test(e.message));
    await assert.rejects(enregistrerRegle(db, { id, table: 'keystone.projects', type: 'fraicheur', colonne: 'code', libelle: 'x', version: r1.majLe }, 'marc'), /maxJours/);
    const r2 = await enregistrerRegle(db, { id, table: 'keystone.projects', type: 'unicite', colonnes: ['code'], libelle: 'Essai E-09', gravite: 'erreur', actif: false, version: r1.majLe }, 'marc');
    assert.equal(r2.actif, false);
    assert.ok(!(await reglesActives(db)).regles.some(r => r.id === id));
  } finally { await db.end(); }
});
