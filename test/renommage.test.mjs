// Renommage de la suite en Atrium (docs/renommage-atrium.md) : réécriture des variables des outils, sans afficher de valeur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reecrire, nouvelleCle } from '../scripts/renommage-envs-coolify.mjs';

test('adresse PostgreSQL : hôte et base réécrits, mot de passe et options intacts', () => {
  const r = reecrire('postgres://keystone_app:p%40ss:w0rd@epc2i-postgres:5432/epc2i?sslmode=disable');
  assert.equal(r.valeur, 'postgres://keystone_app:p%40ss:w0rd@atrium-postgres:5432/atrium?sslmode=disable');
  assert.deepEqual(r.changements, ['hôte', 'base']);
  assert.equal(r.reste, false);
  assert.equal(reecrire('postgresql://matrix_gestion:x@epc2i-postgres/epc2i').valeur, 'postgresql://matrix_gestion:x@atrium-postgres/atrium');
  assert.equal(reecrire('postgres://epc2i_sauvegarde:x@epc2i-postgres:5432/epc2i').valeur, 'postgres://atrium_sauvegarde:x@atrium-postgres:5432/atrium');
});

test('par parties : l\'hôte seul, puis la base seule', () => {
  const hote = reecrire('postgres://a:b@epc2i-postgres:5432/epc2i', ['hote']);
  assert.equal(hote.valeur, 'postgres://a:b@atrium-postgres:5432/epc2i');
  assert.equal(hote.reste, true);
  assert.equal(reecrire(hote.valeur, ['base']).valeur, 'postgres://a:b@atrium-postgres:5432/atrium');
});

test('un mot de passe qui contient « epc2i » n\'est jamais réécrit, il est signalé', () => {
  const r = reecrire('postgres://a:epc2i-postgres@hote-externe:5432/autre');
  assert.equal(r.valeur, 'postgres://a:epc2i-postgres@hote-externe:5432/autre');
  assert.deepEqual(r.changements, []);
  assert.equal(r.reste, true);
  assert.equal(reecrire('postgres://a:b@epc2i-postgres-2:5432/epc2iz').changements.length, 0);
});

test('chemins et hôte hors adresse ; clés à l\'ancien préfixe', () => {
  assert.equal(reecrire('/var/lib/epc2i/keystone').valeur, '/var/lib/atrium/keystone');
  assert.equal(reecrire('epc2i-postgres').valeur, 'atrium-postgres');
  assert.deepEqual(reecrire('sans rapport').changements, []);
  assert.equal(nouvelleCle('EPC2I_SAUVEGARDE_PASSWORD'), 'ATRIUM_SAUVEGARDE_PASSWORD');
  assert.equal(nouvelleCle('DATABASE_URL'), null);
});

test('socle : nouveaux noms par défaut, anciens acceptés le temps du renommage', () => {
  const lire = f => readFileSync(new URL(`../infra/postgres/${f}`, import.meta.url), 'utf8');
  const compose = lire('docker-compose.yml');
  assert.match(compose, /aliases:\s*- atrium-postgres\s*- epc2i-postgres/);
  // Clés des volumes jamais renommées : un autre nom serait un volume neuf et vide (base vide au redéploiement).
  assert.match(compose, /- epc2i_pgdata:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /- epc2i_sauvegardes:\/sauvegardes/);
  assert.match(lire('Dockerfile'), /ln -s \/opt\/atrium \/opt\/epc2i/);
  for (const f of ['init/01-base-et-roles.sql', 'init/02-schemas.sql', 'init/03-droits.sql', 'partage/90-droits.sql', 'verifier-droits.sql'])
    assert.match(lire(f), /datname IN \('atrium', 'epc2i'\)/, f);
  assert.match(lire('sauvegarde/sauvegarder.sh'), /atrium_sauvegarde epc2i_sauvegarde/);
  assert.match(lire('partage/appliquer-liens.sh'), /datname IN \('atrium', 'epc2i'\)/);
});
