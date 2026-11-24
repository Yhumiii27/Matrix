// Langue de l'interface (Norma § 2 et § 7) : chaînes sources anglaises, français par défaut, cookie matrix-lang.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FR, langOf, langCookie, langueDeRequete, avecLangue, traduire } from '../outils/i18n.mjs';

const source = readFileSync(new URL('../maquette/source.html', import.meta.url), 'utf8');

test('langue : français par défaut, anglais seulement sur demande', () => {
  assert.equal(langOf(undefined), 'fr');
  assert.equal(langOf('de'), 'fr');
  assert.equal(langOf('en'), 'en');
  assert.equal(langueDeRequete(''), 'fr');
  assert.equal(langueDeRequete('epc2i-theme=light; matrix-lang=en'), 'en');
  assert.match(langCookie('en'), /^matrix-lang=en; path=\/; max-age=31536000; samesite=lax$/);
  assert.equal(avecLangue('<html lang="fr" data-theme="dark">', 'en'), '<html lang="en" data-theme="dark">');
  assert.equal(avecLangue('<html data-theme="dark">', 'fr'), '<html data-theme="dark" lang="fr">');
  assert.equal(traduire(FR, 'fr', 'Schemas read on {date}', { date: '2 nov.' }), 'Schémas lus le 2 nov.');
  assert.equal(traduire(FR, 'en', 'Schemas read on {date}', { date: '2 Nov' }), 'Schemas read on 2 Nov');
});

// Chaînes sources de la page : appels tr('…') et textes / attributs marqués data-i18n et data-i18n-attrs.
function chainesSources() {
  const chaines = new Set();
  for (const m of source.matchAll(/(?<![\w.$])tr\('((?:[^'\\]|\\.)*)'/g)) chaines.add(m[1]);
  for (const m of source.matchAll(/<[^>]*\sdata-i18n(?=[\s>])[^>]*>([^<]+)</g)) chaines.add(m[1].trim());
  for (const m of source.matchAll(/<[^>]*data-i18n-attrs="([^"]+)"[^>]*>/g)) {
    for (const a of m[1].split(' ')) { const v = new RegExp(`\\s${a}="([^"]*)"`).exec(m[0]); if (v) chaines.add(v[1]); }
  }
  for (const m of source.matchAll(/<section class="screen[^"]*" id="s-\w+" data-title="([^"]+)"/g)) chaines.add(m[1]);
  return chaines;
}

test('toute chaîne source de la page a sa traduction française', () => {
  const chaines = chainesSources();
  assert.ok(chaines.size > 40, `${chaines.size} chaînes trouvées`);
  const manquantes = [...chaines].filter(c => !(c in FR));
  assert.deepEqual(manquantes, []);
  // Une traduction différente de l'anglais, sauf les mots identiques dans les deux langues.
  const memes = new Set(['Administration', 'Publications', 'Description', 'Note', 'Menu', 'Catalogue']);
  assert.deepEqual(Object.entries(FR).filter(([en, fr]) => en === fr && !memes.has(en)).map(([en]) => en), []);
});

test('la paire langue / affichage est empilée, FR / EN au-dessus de sombre / clair, à la fin des outils de l’en-tête', () => {
  const outils = source.slice(source.indexOf('<div class="entete-outils"'), source.indexOf('<div class="app-main">'));
  const prefs = outils.indexOf('<div class="coque-prefs">');
  assert.ok(prefs > outils.indexOf('class="coque-header-tools"'));
  assert.ok(outils.indexOf('id="langue"') > prefs && outils.indexOf('id="langue"') < outils.indexOf('id="affichage"'));
});
