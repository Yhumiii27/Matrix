// Serveur Matrix démarré pour de vrai (sans serveur commun) : page, API, accès par mot de passe, saisie d'un référentiel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const serveurs = [];

async function demarrer(env) {
  const data = mkdtempSync(join(tmpdir(), 'matrix-serveur-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn(process.execPath, [join(RACINE, 'serveur.mjs')], {
    env: { PATH: process.env.PATH, PORT: String(port), MATRIX_DATA_DIR: data, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  serveurs.push({ p, data });
  await new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error('le serveur ne démarre pas')), 15000);
    p.stdout.on('data', b => { if (String(b).includes('écoute sur le port')) { clearTimeout(t); ok(); } });
    p.on('exit', c => { clearTimeout(t); ko(new Error(`serveur arrêté (code ${c})`)); });
  });
  return `http://127.0.0.1:${port}`;
}
after(() => { for (const { p, data } of serveurs) { p.kill(); rmSync(data, { recursive: true, force: true }); } });

let libre, protege, jeton;
before(async () => { [libre, protege, jeton] = await Promise.all([demarrer({}), demarrer({ MATRIX_MOT_DE_PASSE: 'secret' }), demarrer({ MATRIX_TOKEN: 'jeton-essai' })]); });

const put = (base, chemin, corps, entetes = {}) => fetch(base + chemin, { method: 'PUT', headers: { 'content-type': 'application/json', ...entetes }, body: JSON.stringify(corps) });

test('page et API de lecture', async () => {
  const page = await fetch(libre + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<!doctype html>/);
  const sante = await (await fetch(libre + '/api/sante')).json();
  assert.equal(sante.ok, true);
  assert.ok(sante.tables > 0);
  assert.match(String(sante.referentiels), /edition\.json/);
  assert.equal((await fetch(libre + '/api/inconnue')).status, 404);
});

test('saisie d\'un référentiel : contrôlée, enregistrée, publiée par GET', async () => {
  const mauvais = await put(libre, '/api/referentiels/zones', [{ code: 'm', libelle: 'x' }]);
  assert.equal(mauvais.status, 422);
  assert.match((await mauvais.json()).erreur, /code invalide/);
  const r = await put(libre, '/api/referentiels/zones', [{ code: 'MAG', libelle: 'Maghreb', actif: true }, { code: 'OLD', libelle: 'Ancienne', actif: false }]);
  assert.equal(r.status, 200);
  assert.deepEqual((await (await fetch(libre + '/api/referentiels/zones')).json()).map(z => z.code), ['MAG']);
  assert.equal((await (await fetch(libre + '/api/referentiels/zones?tous=1')).json()).length, 2);
});

test('écritures : JSON exigé, origine étrangère refusée', async () => {
  const texte = await fetch(libre + '/api/referentiels/zones', { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '[]' });
  assert.equal(texte.status, 415);
  assert.equal((await put(libre, '/api/referentiels/zones', [], { origin: 'https://ailleurs.example' })).status, 403);
});

test('mot de passe : jamais de fenêtre du navigateur, page de connexion, Basic pour les scripts, /api/sante libre', async () => {
  const basic = mdp => ({ authorization: 'Basic ' + Buffer.from(`claire:${mdp}`).toString('base64') });
  // Page demandée sans session : renvoi vers /connexion, jamais WWW-Authenticate (la fenêtre revenait en boucle).
  const page = await fetch(protege + '/?vue=liens', { redirect: 'manual' });
  assert.equal(page.status, 303);
  assert.equal(page.headers.get('location'), '/connexion?suite=%2F%3Fvue%3Dliens');
  assert.equal(page.headers.get('www-authenticate'), null);
  const api = await fetch(protege + '/api/edition', { headers: basic('faux') });
  assert.equal(api.status, 401);
  assert.equal(api.headers.get('www-authenticate'), null);
  assert.match((await api.json()).erreur, /connexion/);
  // Scripts : Basic accepté.
  assert.equal((await fetch(protege + '/api/edition', { headers: basic('secret') })).status, 200);
  assert.equal((await fetch(protege + '/api/sante')).status, 200);
  const r = await put(protege, '/api/referentiels/zones', [{ code: 'MAG', libelle: 'Maghreb' }], basic('secret'));
  assert.equal((await r.json()).edition.journal.at(-1).qui, 'claire');
});

test('page de connexion : erreur dite, session posée, retour à la page demandée, déconnexion', async () => {
  const formulaire = corps => fetch(protege + '/connexion', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(corps) });
  assert.match(await (await fetch(protege + '/connexion?suite=/')).text(), /<form method="post" action="\/connexion">/);
  const refus = await formulaire({ identifiant: 'claire', mot_de_passe: 'faux', suite: '/' });
  assert.equal(refus.status, 401);
  assert.match(await refus.text(), /Mot de passe incorrect/);
  assert.equal(refus.headers.get('set-cookie'), null);
  // Retour vers une autre adresse refusé : on revient sur Matrix.
  assert.equal((await formulaire({ identifiant: 'claire', mot_de_passe: 'secret', suite: '//ailleurs.example/' })).headers.get('location'), '/');
  const ok = await formulaire({ identifiant: 'Claire Bardet', mot_de_passe: ' secret ', suite: '/?vue=liens' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/?vue=liens');
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /^matrix_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200$/);
  const session = { cookie: cookie.split(';')[0] };
  assert.equal((await fetch(protege + '/', { headers: session })).status, 200);
  // Un en-tête Basic étranger (authentification de l'hébergeur placée devant Matrix) ne bloque pas la session.
  assert.equal((await fetch(protege + '/api/edition', { headers: { ...session, authorization: 'Basic ' + Buffer.from('coolify:autre').toString('base64') } })).status, 200);
  const r = await put(protege, '/api/referentiels/zones', [{ code: 'MAG', libelle: 'Maghreb' }, { code: 'EUR', libelle: 'Europe' }], session);
  assert.equal((await r.json()).edition.journal.at(-1).qui, 'Claire Bardet');
  // Écriture avec la session depuis une autre origine : refusée.
  assert.equal((await put(protege, '/api/referentiels/zones', [], { ...session, origin: 'https://ailleurs.example' })).status, 403);
  const sortie = await fetch(protege + '/deconnexion', { redirect: 'manual' });
  assert.equal(sortie.headers.get('location'), '/connexion');
  assert.match(sortie.headers.get('set-cookie'), /Max-Age=0/);
  // Cookie forgé : refusé.
  assert.equal((await fetch(protege + '/api/edition', { headers: { cookie: 'matrix_session=' + Buffer.from('pirate').toString('base64url') + '.9999999999.xxx' } })).status, 401);
});

test('journal, REX et correspondances : 409 sans serveur commun', async () => {
  for (const chemin of ['/api/journal', '/api/rex', '/api/correspondances']) {
    const r = await fetch(libre + chemin);
    assert.equal(r.status, 409);
    assert.match((await r.json()).erreur, /MATRIX_DATABASE_URL/);
  }
  const p = await fetch(libre + '/api/correspondances', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(p.status, 409);
});

test('publications (M-18) : 409 sans serveur commun, chemin invalide introuvable', async () => {
  for (const chemin of ['/api/publications', '/api/publications/keystone.pub_projets']) {
    const r = await fetch(libre + chemin);
    assert.equal(r.status, 409);
    assert.match((await r.json()).erreur, /MATRIX_DATABASE_URL/);
  }
  const ecrire = (chemin, methode = 'POST') => fetch(libre + chemin, { method: methode, headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal((await ecrire('/api/publications/keystone.pub_projets/appliquer')).status, 409);
  assert.equal((await ecrire('/api/publications/keystone.pub_projets', 'PUT')).status, 409);
  assert.equal((await fetch(libre + '/api/publications/keystone.projets')).status, 404);
});

test('dépôt des demandes : publications et liens préparés, lisibles sans serveur commun', async () => {
  const d = await (await fetch(libre + '/api/publications/depot')).json();
  assert.equal(d.serveur, false);
  assert.ok(d.publications.some(p => p.vue === 'keystone.pub_projets' && /categorie/.test(p.definition)));
  assert.ok(d.publications.some(p => p.vue === 'vigie.pub_etudes_securite' && p.attendue));
  assert.ok(d.liens.some(l => l.lecteur === 'bi_reader' && l.vue === 'arche.pub_capex'));
});

test('déclaration d’un outil : jeton exigé, jamais prise pour une lecture du serveur', async () => {
  const doc = { schema: 'matrix.schema/1', app: 'vigie', origine: 'serveur', declareLe: '2026-10-31T00:00:00Z',
    tables: [{ name: 'events', pk: ['id'], fks: [], uniques: [], columns: [{ name: 'id', type: 'integer' }] }] };
  const envoyer = entetes => fetch(jeton + '/api/declarations', { method: 'POST', headers: { 'content-type': 'application/json', ...entetes }, body: JSON.stringify(doc) });
  assert.equal((await envoyer({ 'x-matrix-token': 'faux' })).status, 401);
  assert.equal((await envoyer({ 'x-matrix-token': 'jeton-essai' })).status, 200);
  const liste = await (await fetch(jeton + '/api/declarations')).json();
  assert.deepEqual(liste.map(d => [d.app, d.origine]), [['vigie', 'outil']]);
  const vigie = (await (await fetch(jeton + '/api/catalogue')).json()).apps.find(a => a.id === 'vigie');
  assert.match(vigie.source, /^déclaration du/);
});

test('catalogue en lecture et exports : JSON, recherche, fiche, CSV, dictionnaire, Mermaid', async () => {
  const liste = await (await fetch(libre + '/api/catalogue/tables?outil=keystone')).json();
  assert.ok(liste.length > 100 && liste.every(t => t.outil === 'keystone'));
  const q = await (await fetch(libre + '/api/catalogue/tables?q=' + encodeURIComponent('matricule'))).json();
  assert.ok(q.length > 0 && q[0].trouvee_par.length > 0);
  const f = await fetch(libre + '/api/catalogue/tables/keystone/projects');
  assert.equal(f.status, 200);
  assert.ok((await f.json()).colonnes.some(c => c.nom === 'code'));
  assert.equal((await fetch(libre + '/api/catalogue/tables/keystone/inexistante')).status, 404);
  assert.equal((await fetch(libre + '/api/catalogue/tables?outil=bidon')).status, 404);
  const csv = await fetch(libre + '/api/export/colonnes.csv?outil=codex');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /matrix-codex-colonnes\.csv/);
  const octets = new Uint8Array(await csv.arrayBuffer());
  assert.deepEqual([...octets.slice(0, 3)], [0xEF, 0xBB, 0xBF]);   // BOM : Excel lit l'UTF-8
  assert.match(new TextDecoder('utf-8', { ignoreBOM: true }).decode(octets.slice(3)), /^outil;table;colonne/);
  assert.match(await (await fetch(libre + '/api/export/dictionnaire.html?outil=vigie')).text(), /<h2>Vigie/);
  assert.match(await (await fetch(libre + '/api/export/schema.mmd?outil=crucible')).text(), /^erDiagram/);
  assert.equal((await fetch(protege + '/api/export/tables.csv')).status, 401);
});

test('déclarations : refusées sans jeton configuré', async () => {
  const r = await fetch(libre + '/api/declarations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 503);
});
