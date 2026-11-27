// Affichage sombre / clair (Norma) : cookie atrium-theme (ancien epc2i-theme en repli) → thème, attribut data-theme posé sur <html>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEME_COOKIE, ANCIEN_THEME_COOKIE, DEFAULT_THEME, themeOf, themeCookie, themeDeRequete, avecTheme } from '../outils/theme.mjs';

test('cookie → thème : sombre par défaut, clair seulement sur « light »', () => {
  assert.equal(THEME_COOKIE, 'atrium-theme');
  assert.equal(ANCIEN_THEME_COOKIE, 'epc2i-theme');
  assert.equal(DEFAULT_THEME, 'dark');
  assert.equal(themeOf('light'), 'light');
  for (const v of ['dark', undefined, null, '', 'LIGHT', 'clair']) assert.equal(themeOf(v), 'dark');
  assert.equal(themeDeRequete(undefined), 'dark');
  assert.equal(themeDeRequete('matrix_session=abc; atrium-theme=light'), 'light');
  assert.equal(themeDeRequete('atrium-theme=dark;autre=1'), 'dark');
  assert.equal(themeDeRequete('xatrium-theme=light'), 'dark');
});

test('ancien cookie epc2i-theme : lu en repli, jamais devant le nouveau', () => {
  assert.equal(themeDeRequete('epc2i-theme=light'), 'light');
  assert.equal(themeDeRequete('epc2i-theme=light; atrium-theme=dark'), 'dark');
  assert.equal(themeDeRequete('atrium-theme=dark; epc2i-theme=light'), 'dark');
  assert.equal(themeDeRequete('xepc2i-theme=light'), 'dark');
});

test('en-tête du cookie : un an, tout le site', () => {
  assert.equal(themeCookie('light'), 'atrium-theme=light; path=/; max-age=31536000; samesite=lax');
  assert.equal(themeCookie('n’importe quoi'), 'atrium-theme=dark; path=/; max-age=31536000; samesite=lax');
});

test('data-theme posé sur la balise <html>, une seule fois', () => {
  assert.equal(avecTheme('<!doctype html>\n<html lang="fr"><body>', 'light'), '<!doctype html>\n<html lang="fr" data-theme="light"><body>');
  assert.equal(avecTheme('<html>', 'dark'), '<html data-theme="dark">');
  assert.equal(avecTheme('<html lang="fr" data-theme="light">', 'dark'), '<html lang="fr" data-theme="light">');
  assert.equal(avecTheme('<div>fragment</div>', 'light'), '<div>fragment</div>');
});
