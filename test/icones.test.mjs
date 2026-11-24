// Icônes Phosphor (Norma § 7), tirées de @phosphor-icons/web (dépendance autorisée), embarquées dans la page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICONES, tracesIcones } from '../outils/icones.mjs';
import { construirePage } from '../outils/page.mjs';

const source = readFileSync(new URL('../maquette/source.html', import.meta.url), 'utf8');

test('chaque icône nommée par la page est une icône Phosphor', () => {
  const traces = tracesIcones();
  for (const nom of Object.keys(ICONES)) assert.match(traces[nom].d, /^M/, nom);
  const utilisees = new Set([...source.matchAll(/icon\('(\w+)'/g), ...source.matchAll(/data-icon="(\w+)"/g)].map(m => m[1]));
  utilisees.add('chevronDown').add('chevronRight');
  assert.deepEqual([...utilisees].filter(n => !(n in ICONES)), []);
});

test('la page embarque les tracés, sans police ni feuille d’icônes d’un CDN', () => {
  const page = construirePage({ forme: 'document' });
  assert.doesNotMatch(page, /\/\*ICONES\*\//);
  assert.match(page, /<script id="matrix-icones" type="application\/json">\{"home":\{"d":"M/);
  assert.doesNotMatch(page, /phosphor[^"']*\.(css|woff2?)/i);
});
