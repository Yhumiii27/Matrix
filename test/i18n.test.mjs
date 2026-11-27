// Langue de l'interface (Norma § 2 et § 7) : chaînes sources anglaises, français par défaut, cookie matrix-lang.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FR, langOf, langCookie, langueDeRequete, avecLangue, traduire, sansContexte } from '../outils/i18n.mjs';

const source = readFileSync(new URL('../maquette/source.html', import.meta.url), 'utf8');
const dictionnaire = readFileSync(new URL('../outils/i18n.mjs', import.meta.url), 'utf8');
const acces = readFileSync(new URL('../outils/acces.mjs', import.meta.url), 'utf8');
const serveur = readFileSync(new URL('../serveur.mjs', import.meta.url), 'utf8');

test('langue : français par défaut, anglais seulement sur demande', () => {
  assert.equal(langOf(undefined), 'fr');
  assert.equal(langOf('de'), 'fr');
  assert.equal(langOf('en'), 'en');
  assert.equal(langueDeRequete(''), 'fr');
  assert.equal(langueDeRequete('atrium-theme=light; matrix-lang=en'), 'en');
  assert.match(langCookie('en'), /^matrix-lang=en; path=\/; max-age=31536000; samesite=lax$/);
  assert.equal(avecLangue('<html lang="fr" data-theme="dark">', 'en'), '<html lang="en" data-theme="dark">');
  assert.equal(avecLangue('<html data-theme="dark">', 'fr'), '<html data-theme="dark" lang="fr">');
  assert.equal(traduire(FR, 'fr', 'Schemas read on {date}', { date: '2 nov.' }), 'Schémas lus le 2 nov.');
  assert.equal(traduire(FR, 'en', 'Schemas read on {date}', { date: '2 Nov' }), 'Schemas read on 2 Nov');
  // Contexte en fin de source : retiré de l'anglais, il départage deux traductions françaises.
  assert.equal(sansContexte('Applied#publication'), 'Applied');
  assert.equal(traduire(FR, 'en', 'Applied#publication'), 'Applied');
  assert.equal(traduire(FR, 'fr', 'Applied#publication'), 'Appliquée');
  assert.equal(traduire(FR, 'fr', 'Applied'), 'Appliqués');
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
  // Page de connexion : t('…') de outils/acces.mjs et erreurs que serveur.mjs lui passe.
  for (const m of acces.matchAll(/(?<![\w.$])t\('((?:[^'\\]|\\.)*)'/g)) chaines.add(m[1]);
  for (const m of serveur.matchAll(/pageConnexion\(\{[^\n]*/g)) for (const e of m[0].matchAll(/'([A-Z][^'\\]*)'/g)) chaines.add(e[1]);
  return chaines;
}

test('toute chaîne source de la page a sa traduction française', () => {
  const chaines = chainesSources();
  assert.ok(chaines.size > 40, `${chaines.size} chaînes trouvées`);
  const manquantes = [...chaines].filter(c => !(c in FR));
  assert.deepEqual(manquantes, []);
  // Une traduction différente de l'anglais, sauf les mots identiques dans les deux langues.
  const memes = new Set(['Administration', 'Publications', 'Publication', 'Description', 'Note', 'Menu', 'Catalogue', 'Applications', 'Application',
    'Tables', 'tables', 'Table', 'Tables (CSV)', 'tables {tables}', 'Mode', 'Nature', 'Options', 'option {id} ({label})', 'Service', 'Sites', 'Site',
    'Sites (D14)', 'Code', 'Latitude', 'Longitude', 'Zones', 'Zone', 'Page {n}', 'Type', 'Info', 'Migrations', 'migration(s)', 'absent', 'convention',
    'Action', 'Impact', 'Documents (D10)', 'Version', 'port {port}']);
  assert.deepEqual(Object.entries(FR).filter(([en, fr]) => en === fr && !memes.has(en)).map(([en]) => en), []);
  // Chaque entrée du dictionnaire sert dans la page (pas de traduction orpheline).
  assert.deepEqual(Object.keys(FR).filter(en => !chaines.has(en)), []);
});

test('le dictionnaire : une clé, une traduction ; mêmes variables {…} dans les deux langues', () => {
  const cles = [...dictionnaire.matchAll(/^  '((?:[^'\\]|\\.)*)': /gm)].map(m => m[1]);
  assert.deepEqual(cles.filter((c, i) => cles.indexOf(c) !== i), []);
  const variables = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  assert.deepEqual(Object.entries(FR).filter(([en, fr]) => variables(en) !== variables(fr)).map(([en]) => en), []);
});

test('plus de texte français écrit en dur dans la page (hors données et commentaires)', () => {
  // Lignes du script et du HTML de la coque, sans commentaires ni appels tr('…') : aucun mot accentué ne doit rester.
  const corps = source.slice(source.indexOf('</style>')).replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const restes = corps.split('\n').filter(l => !/^\s*(\/\/|<!--)/.test(l))
    .map(l => l.replace(/(?<![\w.$])tr\('(?:[^'\\]|\\.)*'/g, '').replace(/\/\/ .*$/, '').replace(/<!--.*?-->/g, ''))
    .filter(l => /[éèàùâêîôûçÉÈÀ]/.test(l) && !/title="Français"|normalize\('NFD'\)|'entrée'/.test(l));
  assert.deepEqual(restes.map(l => l.trim().slice(0, 120)), []);
});

test('la paire langue / affichage est empilée, FR / EN au-dessus de sombre / clair, à la fin des outils de l’en-tête', () => {
  const outils = source.slice(source.indexOf('<div class="entete-outils"'), source.indexOf('<div class="app-main">'));
  const prefs = outils.indexOf('<div class="coque-prefs">');
  assert.ok(prefs > outils.indexOf('class="coque-header-tools"'));
  assert.ok(outils.indexOf('id="langue"') > prefs && outils.indexOf('id="langue"') < outils.indexOf('id="affichage"'));
});

test('la page de connexion suit la langue : français par défaut, anglais sur demande', async () => {
  const { pageConnexion } = await import('../outils/acces.mjs');
  const fr = pageConnexion({ erreur: 'Incorrect password.' }), en = pageConnexion({ lang: 'en', erreur: 'Incorrect password.' });
  assert.match(fr, /<html lang="fr">/); assert.match(fr, /Mot de passe incorrect\./); assert.match(fr, />Se connecter</);
  assert.match(en, /<html lang="en">/); assert.match(en, /Incorrect password\./); assert.match(en, />Sign in</);
});
