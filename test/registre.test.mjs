// Listes d'outils tirées du registre de Norma (MX-N05) : Clavis, Matrix et Modulus y figurent.
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
  for (const o of ['clavis', 'modulus']) { assert.ok(AUTRES_OUTILS.includes(o)); assert.ok(PUBLIES.includes(o)); assert.ok(OUTILS_JOURNAL.includes(o)); }
  assert.ok(!AUTRES_OUTILS.includes('matrix'));
  for (const o of ['clavis', 'matrix', 'modulus']) { assert.ok(SCHEMAS_LIENS.includes(o)); assert.ok(LECTEURS.includes(`${o}_app`)); }
  assert.equal(NOMS_OUTILS.modulus, 'Modulus');
});

test('la page connaît chaque outil du registre (pastille, couleur des deux thèmes)', () => {
  const source = readFileSync(new URL('../maquette/source.html', import.meta.url), 'utf8');
  for (const o of TOUS_LES_OUTILS) {
    assert.match(source, new RegExp(`\\n  ${o}: \\{ nom: '`), o);
    assert.equal(source.match(new RegExp(`--app-${o}:`, 'g'))?.length, 2, o);
  }
});
