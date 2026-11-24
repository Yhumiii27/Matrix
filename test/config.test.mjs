// Configuration validée au démarrage (Norma § 9) : outils/config.mjs lit et contrôle toutes les variables de Matrix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VARIABLES, lireConfiguration, chargerConfiguration } from '../outils/config.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRA = {
  MATRIX_ENTRA_TENANT_ID: 'clavis', MATRIX_ENTRA_CLIENT_ID: 'matrix', MATRIX_ENTRA_CLIENT_SECRET: 's',
  MATRIX_ENTRA_ISSUER: 'https://clavis.epc2i.example', MATRIX_PUBLIC_URL: 'https://matrix.epc2i.example/',
  MATRIX_SESSION_SECRET: 'x'.repeat(32),
};

test('sans variable : les valeurs par défaut, aucune erreur', () => {
  const { config, erreurs, avertissements } = lireConfiguration({});
  assert.deepEqual(erreurs, []);
  assert.deepEqual(avertissements, []);
  assert.equal(config.port, 3700);
  assert.equal(config.synchroMinutes, 60);
  assert.equal(config.dureeDroitMs, 60000);
  assert.equal(config.dataDir, join(RACINE, 'data'));
  assert.equal(config.declarationsDir, join(RACINE, 'declarations'));
  assert.equal(config.sourcesDir, null);
  assert.equal(config.production, false);
  assert.equal(config.accesClavis, false);
  assert.equal(config.dbUrl, '');
  assert.equal(config.entra.active, false);
  assert.equal(config.alertes.active, false);
});

test('valeurs lues, vides = défaut', () => {
  const { config, erreurs } = lireConfiguration({ PORT: '3000', NODE_ENV: 'production', MATRIX_SYNCHRO_MINUTES: '0', MATRIX_ACCES_CLAVIS_SECONDES: '',
    MATRIX_DATABASE_URL: 'postgres://matrix_app:p@127.0.0.1:5432/epc2i', MATRIX_GESTION_DATABASE_URL: 'postgresql://matrix_gestion:p@db/epc2i',
    MATRIX_TOKEN: 'jeton', ...ENTRA, MATRIX_ACCES_CLAVIS: 'ON' });
  assert.deepEqual(erreurs, []);
  assert.equal(config.port, 3000);
  assert.equal(config.production, true);
  assert.equal(config.synchroMinutes, 0);
  assert.equal(config.dureeDroitMs, 60000);
  assert.equal(config.accesClavis, true);
  assert.equal(config.token, 'jeton');
  assert.equal(config.publicUrl, 'https://matrix.epc2i.example');
  assert.equal(config.entra.active, true);
});

test('une erreur par variable invalide', () => {
  const { erreurs } = lireConfiguration({
    PORT: '70000', NODE_ENV: 'prod', MATRIX_SYNCHRO_MINUTES: 'une heure', MATRIX_ACCES_CLAVIS_SECONDES: '120',
    MATRIX_ACCES_CLAVIS: 'oui', MATRIX_DATABASE_URL: 'mysql://hote/base', MATRIX_PUBLIC_URL: 'http://matrix.epc2i.example',
    MATRIX_SESSION_SECRET: 'court', MATRIX_ENTRA_ISSUER: 'pas une adresse', MATRIX_ALERTES_DESTINATAIRES: 'dsi@epc2i.example, nimporte',
    MATRIX_ALERTES_EXPEDITEUR: 'matrix', MATRIX_ALERTES_GRAPH_URL: 'ftp://graph', MATRIX_SOURCES_DIR: join(tmpdir(), 'matrix-absent-' + Date.now()),
  });
  const attendues = [/^PORT : entre 1 et 65535/, /^NODE_ENV : /, /^MATRIX_SYNCHRO_MINUTES : nombre entier/, /^MATRIX_ACCES_CLAVIS_SECONDES : entre 0 et 60/,
    /^MATRIX_ACCES_CLAVIS : on \| off ou vide/, /^MATRIX_DATABASE_URL : postgres:\/\//, /^MATRIX_PUBLIC_URL : https:\/\/ exigé/,
    /^MATRIX_SESSION_SECRET : 32 caractères/, /^MATRIX_ENTRA_ISSUER : adresse invalide/, /^MATRIX_ALERTES_DESTINATAIRES : adresse invalide \(nimporte\)/,
    /^MATRIX_ALERTES_EXPEDITEUR : adresse invalide/, /^MATRIX_ALERTES_GRAPH_URL : https:\/\/ exigé/, /^MATRIX_SOURCES_DIR : dossier introuvable/];
  for (const a of attendues) assert.ok(erreurs.some(e => a.test(e)), `${a} absente de ${erreurs.join(' | ')}`);
  assert.equal(erreurs.length, attendues.length);
});

test('http:// admis pour localhost ; nombres décimaux refusés', () => {
  assert.deepEqual(lireConfiguration({ MATRIX_ENTRA_ISSUER: 'http://127.0.0.1:9/t/v2.0', MATRIX_PUBLIC_URL: 'http://localhost:3700' }).erreurs, []);
  assert.match(lireConfiguration({ PORT: '3700.5' }).erreurs[0], /nombre entier/);
});

test('cohérence : Clavis sans serveur commun ni connexion complète, gestion sans matrix_app', () => {
  assert.match(lireConfiguration({ MATRIX_ACCES_CLAVIS: 'on', ...ENTRA }).erreurs.join(), /MATRIX_DATABASE_URL est nécessaire/);
  assert.match(lireConfiguration({ MATRIX_ACCES_CLAVIS: 'on', MATRIX_DATABASE_URL: 'postgres://a@h/b' }).erreurs.join(), /doit être complète/);
  assert.match(lireConfiguration({ MATRIX_GESTION_DATABASE_URL: 'postgres://a@h/b' }).erreurs.join(), /MATRIX_DATABASE_URL est nécessaire aussi/);
  assert.deepEqual(lireConfiguration({ MATRIX_ACCES_CLAVIS: 'off' }).erreurs, []);
});

test('configuration incomplète : signalée, pas bloquante (comme avant)', () => {
  const r = lireConfiguration({ MATRIX_ENTRA_TENANT_ID: 't', MATRIX_ALERTES_DESTINATAIRES: 'dsi@epc2i.example' });
  assert.deepEqual(r.erreurs, []);
  assert.ok(r.avertissements.some(a => /Entra ID non activé.*MATRIX_ENTRA_CLIENT_ID manquant/.test(a)));
  assert.ok(r.avertissements.some(a => /Alertes par e-mail non activées.*EXPEDITEUR manquant/.test(a)));
  assert.match(lireConfiguration({ MATRIX_MOT_DE_PASSE: ' secret ' }).avertissements[0], /espaces/);
  assert.equal(lireConfiguration({ MATRIX_MOT_DE_PASSE: ' secret ' }).config.motDePasse, 'secret');
});

test('chargerConfiguration : une ligne par erreur, puis arrêt', () => {
  const lignes = [], codes = [];
  const log = { error: l => lignes.push(l), warn: () => {} };
  assert.equal(chargerConfiguration({ PORT: 'x', MATRIX_SYNCHRO_MINUTES: '-3' }, { sortir: c => codes.push(c), log }), null);
  assert.deepEqual(codes, [1]);
  assert.equal(lignes.length, 3);
  assert.match(lignes[0], /^configuration invalide : PORT/);
  assert.match(lignes[1], /^configuration invalide : MATRIX_SYNCHRO_MINUTES/);
  assert.match(lignes[2], /2 variable\(s\)/);
});

test('le serveur refuse de démarrer avec une variable invalide', () => {
  const data = mkdtempSync(join(tmpdir(), 'matrix-config-'));
  try {
    const r = spawnSync(process.execPath, [join(RACINE, 'serveur.mjs')], { encoding: 'utf8', timeout: 15000,
      env: { PATH: process.env.PATH, PORT: '0x10', MATRIX_DATA_DIR: data, MATRIX_ACCES_CLAVIS_SECONDES: '-1' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /configuration invalide : PORT : nombre entier attendu/);
    assert.match(r.stderr, /configuration invalide : MATRIX_ACCES_CLAVIS_SECONDES : entre 0 et 60/);
    assert.doesNotMatch(r.stdout, /écoute sur le port/);
  } finally { rmSync(data, { recursive: true, force: true }); }
});

test('.env.example décrit chaque variable, et rien d’autre', () => {
  const exemple = readFileSync(join(RACINE, '.env.example'), 'utf8');
  const posees = [...exemple.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1]);
  assert.deepEqual([...posees].sort(), VARIABLES.map(v => v.nom).sort());
});

test('aucun autre module de Matrix ne lit process.env', () => {
  const fichiers = ['serveur.mjs', ...readdirSync(join(RACINE, 'outils')).filter(f => f.endsWith('.mjs')).map(f => join('outils', f))];
  const lecteurs = fichiers.filter(f => /process\.env\b/.test(readFileSync(join(RACINE, f), 'utf8').replace(/(^|\s)\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  assert.deepEqual(lecteurs, ['outils/config.mjs']);
});
