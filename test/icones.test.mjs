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

test('logo de Matrix (Norma 2.3) : marque de la barre latérale et de la barre supérieure, favicon, dans les deux formes', () => {
  const logo = readFileSync(new URL('../norma/charte/logos/matrix.svg', import.meta.url), 'utf8').trim();
  for (const forme of ['document', 'fragment']) {
    const page = construirePage({ forme });
    assert.doesNotMatch(page, /<!--(LOGO-MARQUE|LOGO-BARRE|FAVICON)-->/);
    assert.match(page, /<span class="coque-logo coque-logo-mark"><svg [^>]*aria-hidden="true"[^>]*>[\s\S]*?url\(#g-matrix-marque\)/);
    assert.match(page, /<span class="coque-topbar-mark"><svg [^>]*aria-hidden="true"[^>]*>[\s\S]*?url\(#g-matrix-barre\)/);
    assert.ok(page.includes(`<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(logo)}">`), forme);
    assert.equal(page.match(/id="g-matrix-marque"/g).length, 1);
  }
});
