// Saisies de Matrix (outils/edition.mjs) : validation des référentiels, liens entre listes, journal, listes saisies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chargerEdition, enregistrerReferentiel, preparerReferentiel, referentielsSaisis, adopterReferentiels, decider, documenter } from '../outils/edition.mjs';

const dossier = () => mkdtempSync(join(tmpdir(), 'matrix-edition-'));
const fichier = d => JSON.parse(readFileSync(join(d, 'edition.json'), 'utf8'));
const zone = (code, extra = {}) => ({ code, libelle: code, ordre: 0, actif: true, ...extra });
const filiale = (code, extra = {}) => ({ code, nom: code, pays_iso2: 'MA', zone_code: null, devise: 'MAD', ordre: 0, actif: true, ...extra });

test('sans saisie : référentiels de départ (data/referentiels.json), aucune liste saisie', t => {
  const d = dossier(); t.after(() => rmSync(d, { recursive: true }));
  const ed = chargerEdition(d);
  assert.ok(ed.referentiels.pays.some(p => p.iso2 === 'FR'));
  assert.equal(referentielsSaisis(d).size, 0);
});

test('codes et champs contrôlés comme dans le schéma matrix', t => {
  const d = dossier(); t.after(() => rmSync(d, { recursive: true }));
  assert.throws(() => enregistrerReferentiel(d, 'filiales', [filiale('AB')], 'essai'), /Trois majuscules/);
  assert.throws(() => enregistrerReferentiel(d, 'filiales', [filiale('APM', { pays_iso2: 'XX' })], 'essai'), /pays XX absent/);
  assert.throws(() => enregistrerReferentiel(d, 'filiales', [filiale('APM'), filiale('APM')], 'essai'), /en double/);
  assert.throws(() => enregistrerReferentiel(d, 'sites', [{ code: 'all', libelle: 'x' }], 'essai'), /réservé/);
  assert.throws(() => enregistrerReferentiel(d, 'zones', [zone('MAG', { ouest: 1, nord: 2 })], 'essai'), /cadre se saisit en entier/);
  assert.throws(() => enregistrerReferentiel(d, 'organigramme', [{ code: 'QMS', niveau: 'departement', libelle_fr: 'a', libelle_en: 'b' }], 'essai'), /QMS réservé/);
  assert.throws(() => enregistrerReferentiel(d, 'inconnu', [], 'essai'), /référentiel inconnu/);
});

test('cadre d\'une zone arrondi à la précision de numeric(6,2)', t => {
  const d = dossier(); t.after(() => rmSync(d, { recursive: true }));
  const [z] = enregistrerReferentiel(d, 'zones', [zone('MAG', { ouest: -17.126, nord: 37.5, est: 11.6, sud: 20.7 })], 'essai');
  assert.equal(z.ouest, -17.13);
});

test('une valeur utilisée par une autre liste ne se retire pas', t => {
  const d = dossier(); t.after(() => rmSync(d, { recursive: true }));
  enregistrerReferentiel(d, 'zones', [zone('MAG')], 'essai');
  enregistrerReferentiel(d, 'filiales', [filiale('APM', { zone_code: 'MAG' })], 'essai');
  assert.throws(() => enregistrerReferentiel(d, 'zones', [], 'essai'), /zone MAG est utilisée par la filiale APM/);
  assert.throws(() => enregistrerReferentiel(d, 'filiales', [filiale('APM', { zone_code: 'EUR' })], 'essai'), /zone EUR absente/);
});

test('journal, listes saisies, liste inchangée sans écriture', t => {
  const d = dossier(); t.after(() => rmSync(d, { recursive: true }));
  enregistrerReferentiel(d, 'zones', [zone('MAG')], 'claire');
  let e = fichier(d);
  assert.deepEqual(e.saisis, ['zones']);
  assert.deepEqual(e.journal.at(-1), { ...e.journal.at(-1), qui: 'claire', action: 'Référentiel modifié', objet: 'Zones', detail: 'ajout : MAG' });
  assert.equal(preparerReferentiel(d, 'zones', [zone('MAG')]).inchange, true);
  enregistrerReferentiel(d, 'zones', [zone('MAG', { libelle: 'Maghreb' })], 'claire');
  e = fichier(d);
  assert.equal(e.journal.at(-1).detail, 'modification : MAG');
  assert.equal(e.journal.length, 2);
});

test('liste reprise du serveur : journalisée, pas comptée comme saisie', t => {
  const d = dossier(); t.after(() => rmSync(d, { recursive: true }));
  enregistrerReferentiel(d, 'zones', [zone('MAG')], 'claire');
  adopterReferentiels(d, { filiales: [filiale('APM')] }, 'serveur commun');
  const e = fichier(d);
  assert.deepEqual(e.saisis, ['zones']);
  assert.equal(e.referentiels.filiales[0].code, 'APM');
  assert.equal(e.journal.at(-1).action, 'Référentiel relu du serveur commun');
});

test('ancien edition.json sans « saisis » : liste saisie = liste qui diffère de celle de départ', t => {
  const d = dossier(); t.after(() => rmSync(d, { recursive: true }));
  enregistrerReferentiel(d, 'zones', [zone('MAG')], 'claire');
  const e = fichier(d); delete e.saisis;
  writeFileSync(join(d, 'edition.json'), JSON.stringify(e));
  assert.deepEqual([...referentielsSaisis(d)], ['zones']);
});

test('décisions et documentation : objets inconnus refusés', t => {
  const d = dossier(); t.after(() => rmSync(d, { recursive: true }));
  assert.throws(() => decider(d, { id: 'D99', option: 'A' }, 'claire'), /groupe de doublons inconnu/);
  const catalogue = { apps: [{ id: 'keystone', tables: [{ name: 'projects' }] }] };
  assert.throws(() => documenter(d, catalogue, { app: 'keystone', table: 'absente' }, 'claire'), /table inconnue/);
  const fiche = documenter(d, catalogue, { app: 'keystone', table: 'projects', description: '  Projets  ' }, 'claire');
  assert.equal(fiche.description, 'Projets');
});
