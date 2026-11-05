// Connexion par Microsoft Entra ID (E-02, décision M-06 ; outils/entra.mjs, serveur.mjs). Configuration, rôles, jetons
// signés ; puis parcours complet contre un fournisseur OpenID factice (test/oidc-factice.mjs) et le vrai serveur.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lireConfigEntra, roleDepuisEntra, personneDepuisJeton } from '../outils/entra.mjs';
import { creerJeton, lireJeton } from '../outils/acces.mjs';
import { demarrerFournisseur } from './oidc-factice.mjs';

const SECRET = 'secret-de-session-de-test-assez-long-42';
const COMPLET = { MATRIX_ENTRA_TENANT_ID: 'tenant', MATRIX_ENTRA_CLIENT_ID: 'matrix', MATRIX_ENTRA_CLIENT_SECRET: 's', MATRIX_PUBLIC_URL: 'https://matrix.exemple.fr/', MATRIX_SESSION_SECRET: SECRET };

test('configuration : complète, absente, partielle, adresses et secret contrôlés', () => {
  const c = lireConfigEntra(COMPLET);
  assert.equal(c.active, true);
  assert.equal(c.issuer, 'https://login.microsoftonline.com/tenant/v2.0');
  assert.equal(c.publicUrl, 'https://matrix.exemple.fr');
  assert.deepEqual([c.roleAdmin, c.roleLecture], ['Matrix.Administrateur', 'Matrix.Lecture']);
  assert.deepEqual(lireConfigEntra({}), { active: false, erreurs: [] });
  const partielle = lireConfigEntra({ MATRIX_ENTRA_TENANT_ID: 't' });
  assert.equal(partielle.active, false);
  assert.ok(partielle.erreurs.includes('MATRIX_ENTRA_CLIENT_ID manquant'));
  assert.match(lireConfigEntra({ ...COMPLET, MATRIX_PUBLIC_URL: 'http://matrix.exemple.fr' }).erreurs.join(), /https:\/\/ exigé/);
  assert.equal(lireConfigEntra({ ...COMPLET, MATRIX_PUBLIC_URL: 'http://localhost:3000', MATRIX_ENTRA_ISSUER: 'http://127.0.0.1:9/t/v2.0' }).active, true);
  assert.match(lireConfigEntra({ ...COMPLET, MATRIX_SESSION_SECRET: 'court' }).erreurs.join(), /32 caractères/);
});

test('rôle : le plus élevé des rôles applicatifs, sinon aucun', () => {
  const c = lireConfigEntra(COMPLET);
  assert.equal(roleDepuisEntra(['Matrix.Lecture', 'Matrix.Administrateur'], c), 'admin');
  assert.equal(roleDepuisEntra(['Matrix.Lecture'], c), 'lecture');
  assert.equal(roleDepuisEntra(['Vigie.Salarie'], c), null);
  assert.equal(roleDepuisEntra(undefined, c), null);
  assert.deepEqual(personneDepuisJeton({ name: ' Claire Bardet ', oid: 'o1', preferred_username: 'c.bardet@epc2i.fr' }), { nom: 'Claire Bardet', oid: 'o1', email: 'c.bardet@epc2i.fr' });
});

test('jeton signé : données, échéance, clé', () => {
  const t = Date.UTC(2026, 10, 5, 9);
  const j = creerJeton({ n: 'Claire', r: 'admin' }, SECRET, 60, t);
  assert.deepEqual(lireJeton(j, SECRET, t + 1000), { n: 'Claire', r: 'admin' });
  assert.equal(lireJeton(j, 'autre-secret-de-session-assez-long-00', t), null);
  assert.equal(lireJeton(j, SECRET, t + 61000), null);
  const [, exp, sig] = j.split('.');
  assert.equal(lireJeton(`${Buffer.from(JSON.stringify({ n: 'Pirate', r: 'admin' })).toString('base64url')}.${exp}.${sig}`, SECRET, t), null);
});

// ── Parcours complet ──────────────────────────────────────────────────────
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
let fournisseur, base, proc, data;
before(async () => {
  fournisseur = await demarrerFournisseur({ comptes: {
    admin: { name: 'Claire Bardet', oid: 'oid-claire', email: 'c.bardet@epc2i.example', roles: ['Matrix.Administrateur'] },
    lecteur: { name: 'Marc Petit', oid: 'oid-marc', email: 'm.petit@epc2i.example', roles: ['Matrix.Lecture'] },
    sansRole: { name: 'Sans Rôle', oid: 'oid-x', email: 'x@epc2i.example', roles: ['Vigie.Salarie'] },
    nonAffecte: { name: 'Hors appli', oid: 'oid-y', nonAffecte: true },
  } });
  data = mkdtempSync(join(tmpdir(), 'matrix-entra-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  base = `http://localhost:${port}`;
  proc = spawn(process.execPath, [join(RACINE, 'serveur.mjs')], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, PORT: String(port), MATRIX_DATA_DIR: data,
    MATRIX_ENTRA_TENANT_ID: 'tenant', MATRIX_ENTRA_CLIENT_ID: fournisseur.clientId, MATRIX_ENTRA_CLIENT_SECRET: fournisseur.clientSecret,
    MATRIX_ENTRA_ISSUER: fournisseur.issuer, MATRIX_PUBLIC_URL: base, MATRIX_SESSION_SECRET: SECRET, MATRIX_MOT_DE_PASSE: 'mdp-scripts' } });
  await new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error('le serveur ne démarre pas')), 15000);
    proc.stdout.on('data', b => { if (String(b).includes('écoute sur le port')) { clearTimeout(t); ok(); } });
  });
});
after(async () => { proc?.kill(); await fournisseur?.fermer(); rmSync(data, { recursive: true, force: true }); });

// Parcours du navigateur : redirections suivies à la main, cookies gardés par hôte.
async function connecter(cle, suite = '/?vue=liens') {
  fournisseur.choisir(cle);
  const cookies = new Map();
  let url = `${base}/auth/entra?suite=${encodeURIComponent(suite)}`, r;
  for (let i = 0; i < 6; i++) {
    const u = new URL(url);
    const jar = [...cookies].filter(([k]) => k.startsWith(u.host + '|')).map(([k, v]) => `${k.split('|')[1]}=${v}`).join('; ');
    r = await fetch(url, { redirect: 'manual', headers: jar ? { cookie: jar } : {} });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k, ...v] = kv.split('='); cookies.set(`${u.host}|${k}`, v.join('=')); }
    if (r.status !== 302 && r.status !== 303) break;
    url = new URL(r.headers.get('location'), url).href;
    if (url.startsWith(base) && !url.includes('/auth/')) break;
  }
  const session = cookies.get(`${new URL(base).host}|matrix_session`);
  return { r, url, session: session ? `matrix_session=${session}` : null };
}

test('connexion Microsoft : page, administrateur, lecteur, refus sans rôle, refus de Microsoft', async () => {
  const page = await fetch(base + '/connexion');
  assert.match(await page.text(), /Se connecter avec Microsoft/);
  assert.equal((await fetch(base + '/', { redirect: 'manual' })).headers.get('location'), '/connexion?suite=%2F');

  // Administrateur : retour à la page demandée, session, écriture permise et signée de son nom.
  const a = await connecter('admin');
  assert.equal(a.url, `${base}/?vue=liens`);
  assert.ok(a.session);
  assert.deepEqual(await (await fetch(base + '/api/moi', { headers: { cookie: a.session } })).json(), { nom: 'Claire Bardet', role: 'admin', via: 'entra', entra: true });
  const w = await fetch(base + '/api/referentiels/zones', { method: 'PUT', headers: { cookie: a.session, 'content-type': 'application/json' }, body: JSON.stringify([{ code: 'MAG', libelle: 'Maghreb' }]) });
  assert.equal(w.status, 200);
  assert.equal((await w.json()).edition.journal.at(-1).qui, 'Claire Bardet');

  // Lecteur : consultation, écriture refusée.
  const l = await connecter('lecteur');
  assert.equal((await fetch(base + '/', { headers: { cookie: l.session } })).status, 200);
  const refus = await fetch(base + '/api/referentiels/zones', { method: 'PUT', headers: { cookie: l.session, 'content-type': 'application/json' }, body: '[]' });
  assert.equal(refus.status, 403);
  assert.match((await refus.json()).erreur, /Consultation seule/);
  // Visionneuse ouverte au rôle Lecture (M-20) : pas de 403 (ici 409, faute de serveur commun) ; son éditeur reste fermé.
  const v = await fetch(base + '/api/donnees?outil=keystone&table=projects', { headers: { cookie: l.session } });
  assert.equal(v.status, 409);
  assert.match((await v.json()).erreur, /MATRIX_DATABASE_URL/);
  const ed = await fetch(base + '/api/donnees/editer', { method: 'POST', headers: { cookie: l.session, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(ed.status, 403);

  // Sans rôle Matrix : page « pas accès », pas de session.
  const s = await connecter('sansRole');
  assert.equal(s.r.status, 403);
  assert.match(await s.r.text(), /n’a pas accès à Matrix/);
  assert.equal(s.session, null);

  // Refus de Microsoft (utilisateur non affecté à l'application) : message, pas de session.
  const n = await connecter('nonAffecte');
  assert.equal(n.r.status, 403);
  assert.match(await n.r.text(), /AADSTS50105/);
  assert.equal(n.session, null);

  // Retour sans les contrôles du départ (onglet expiré, rejeu) : refusé.
  assert.equal((await fetch(base + '/auth/retour?code=x&state=y')).status, 400);
  // Le formulaire à mot de passe n'est plus proposé ; l'en-tête Basic des scripts reste accepté.
  assert.equal((await fetch(base + '/connexion', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/api/edition', { headers: { authorization: 'Basic ' + Buffer.from('script:mdp-scripts').toString('base64') } })).status, 200);
  // Session forgée avec une autre clé : refusée.
  const fausse = creerJeton({ n: 'Pirate', r: 'admin' }, 'une-autre-cle-de-session-tres-longue-00', 3600);
  assert.equal((await fetch(base + '/api/edition', { headers: { cookie: `matrix_session=${fausse}` } })).status, 401);
});
