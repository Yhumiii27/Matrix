// Listes d'outils tirées du registre de Norma (MX-N05) : Clavis, Matrix, Modulus, Vector et Ingenium y figurent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOUS_LES_OUTILS, AUTRES_OUTILS, NOMS_OUTILS } from '../outils/registre.mjs';
import { OUTILS as PUBLIES } from '../outils/publications.mjs';
import { LECTEURS, SCHEMAS_LIENS } from '../outils/sonde.mjs';
import { OUTILS_JOURNAL } from '../outils/consultation.mjs';

test('les listes d’outils suivent le registre de Norma', () => {
  const registre = JSON.parse(readFileSync(new URL('../norma/registre/outils.json', import.meta.url), 'utf8')).outils.map(o => o.code);
  assert.deepEqual([...TOUS_LES_OUTILS].sort(), [...registre].sort());
  assert.deepEqual(TOUS_LES_OUTILS.slice(0, 6), ['keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible']);
  for (const o of ['clavis', 'modulus', 'vector', 'ingenium']) { assert.ok(AUTRES_OUTILS.includes(o)); assert.ok(PUBLIES.includes(o)); assert.ok(OUTILS_JOURNAL.includes(o)); }
  assert.ok(!AUTRES_OUTILS.includes('matrix'));
  for (const o of ['clavis', 'matrix', 'modulus', 'vector', 'ingenium']) { assert.ok(SCHEMAS_LIENS.includes(o)); assert.ok(LECTEURS.includes(`${o}_app`)); }
  assert.equal(NOMS_OUTILS.modulus, 'Modulus');
  assert.equal(NOMS_OUTILS.vector, 'Vector');
  assert.equal(NOMS_OUTILS.ingenium, 'Ingenium');
});

test('la page connaît chaque outil du registre (pastille, couleur des deux thèmes)', () => {
  const source = readFileSync(new URL('../maquette/source.html', import.meta.url), 'utf8');
  for (const o of TOUS_LES_OUTILS) {
    assert.match(source, new RegExp(`\\n  ${o}: \\{ nom: '`), o);
    assert.equal(source.match(new RegExp(`--app-${o}:`, 'g'))?.length, 2, o);
  }
});

test('le socle du serveur commun crée le schéma et le rôle de chaque outil du registre', () => {
  const lire = f => readFileSync(new URL(`../infra/postgres/${f}`, import.meta.url), 'utf8');
  const [roles, schemas, droits, sauvegarde] = ['init/01-base-et-roles.sql', 'init/02-schemas.sql', 'init/03-droits.sql', 'sauvegarde/sauvegarder.sh'].map(lire);
  const registre = JSON.parse(readFileSync(new URL('../norma/registre/outils.json', import.meta.url), 'utf8')).outils;
  for (const { schema, role_pg: role } of registre) {
    assert.match(roles, new RegExp(`'${role}'`), `${role} créé (init/01)`);
    assert.match(roles, new RegExp(`GRANT CONNECT ON DATABASE :"base"\\s+TO [^;]*\\b${role}\\b`), `${role} : CONNECT`);
    assert.match(schemas, new RegExp(`CREATE SCHEMA IF NOT EXISTS ${schema}\\s+AUTHORIZATION ${role};`), `schéma ${schema}`);
    assert.match(schemas, new RegExp(`ALTER ROLE ${role}\\s+IN DATABASE :"base" SET search_path TO ${schema};`), `search_path de ${role}`);
    assert.match(droits, new RegExp(`\\('${role}', ARRAY\\['${schema}'`), `${role} dans droits.verifier()`);
    assert.match(sauvegarde, new RegExp(`for schema in [^;]*\\b${schema}\\b`), `${schema} sauvegardé`);
  }
});
