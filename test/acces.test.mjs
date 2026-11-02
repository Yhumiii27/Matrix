// Accès par mot de passe (outils/acces.mjs) : variable lue, en-tête Basic, session signée, retour sûr, limiteur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireMotDePasse, motDePasseValide, identifiantBasic, creerSession, lireSession, lireCookie, suiteSure, limiteur, pageConnexion, DUREE_SESSION_S } from '../outils/acces.mjs';

const basic = (texte, enc = 'utf8') => 'Basic ' + Buffer.from(texte, enc).toString('base64');

test('variable : espaces et retour à la ligne ignorés, guillemets et « $ » signalés', () => {
  assert.deepEqual(lireMotDePasse('secret'), { mdp: 'secret', avertissements: [] });
  const r = lireMotDePasse(' secret\n');
  assert.equal(r.mdp, 'secret');
  assert.match(r.avertissements[0], /espaces/);
  assert.match(lireMotDePasse('"secret"').avertissements[0], /guillemets/);
  assert.match(lireMotDePasse('ab$cd').avertissements[0], /\$/);
  assert.equal(lireMotDePasse(undefined).mdp, '');
});

test('mot de passe saisi : tel quel ou sans espaces autour', () => {
  assert.ok(motDePasseValide('secret', 'secret'));
  assert.ok(motDePasseValide(' secret ', 'secret'));
  assert.ok(!motDePasseValide('Secret', 'secret'));
  assert.ok(!motDePasseValide('', ''));
});

test('en-tête Basic : identifiant, deux-points dans le mot de passe, accents UTF-8 et Latin-1', () => {
  assert.equal(identifiantBasic(basic('claire:secret'), 'secret'), 'claire');
  assert.equal(identifiantBasic(basic(':secret'), 'secret'), 'administrateur');
  assert.equal(identifiantBasic(basic('claire:a:b'), 'a:b'), 'claire');
  assert.equal(identifiantBasic(basic('claire:été'), 'été'), 'claire');
  assert.equal(identifiantBasic(basic('claire:été', 'latin1'), 'été'), 'claire');
  assert.equal(identifiantBasic(basic('claire:faux'), 'secret'), null);
  assert.equal(identifiantBasic('Bearer x', 'secret'), null);
  assert.equal(identifiantBasic(undefined, 'secret'), null);
});

test('session : signée, liée au mot de passe, échue après 12 heures', () => {
  const t = Date.UTC(2026, 10, 2, 9);
  const s = creerSession('Claire Bardet', 'secret', t);
  assert.equal(lireSession(s, 'secret', t + 1000), 'Claire Bardet');
  assert.equal(lireSession(s, 'autre', t + 1000), null);
  assert.equal(lireSession(s, 'secret', t + DUREE_SESSION_S * 1000 + 1), null);
  const [nom, exp, sig] = s.split('.');
  assert.equal(lireSession(`${Buffer.from('pirate').toString('base64url')}.${exp}.${sig}`, 'secret', t), null);
  assert.equal(lireSession(`${nom}.${Number(exp) + 3600}.${sig}`, 'secret', t), null);
  assert.equal(lireSession('', 'secret', t), null);
  assert.equal(lireCookie('a=1; matrix_session=abc.def; b=2', 'matrix_session'), 'abc.def');
  assert.equal(lireCookie(undefined, 'matrix_session'), null);
});

test('retour après connexion : chemins de Matrix seulement', () => {
  assert.equal(suiteSure('/?vue=liens'), '/?vue=liens');
  for (const s of ['//ailleurs.example', '/\\ailleurs.example', 'https://ailleurs.example', '/connexion', '', undefined, '/a b']) assert.equal(suiteSure(s), '/');
});

test('limiteur : 10 échecs par quart d\'heure et par adresse', () => {
  const l = limiteur();
  for (let i = 0; i < 10; i++) l.echec('1.2.3.4', 1000 + i);
  assert.ok(l.bloque('1.2.3.4', 2000));
  assert.ok(!l.bloque('5.6.7.8', 2000));
  assert.ok(!l.bloque('1.2.3.4', 1000 + 15 * 60 * 1000 + 10));
  l.reussite('1.2.3.4');
  assert.ok(!l.bloque('1.2.3.4', 2000));
});

test('page de connexion : texte échappé', () => {
  const p = pageConnexion({ erreur: '<b>x</b>', identifiant: '"><script>', suite: '/?a=<x>' });
  assert.ok(!p.includes('<script>'));
  assert.ok(!p.includes('<b>x</b>'));
  assert.match(p, /&lt;b&gt;/);
});
