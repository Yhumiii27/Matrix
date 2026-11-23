// Connexion par Clavis avec les droits lus dans la base (MATRIX_ACCES_CLAVIS=on ; décision du propriétaire du 23/11/2026 :
// une seule base, Matrix vérifie dans clavis.pub_acces ce que la DSI a réglé dans Clavis). Parcours complet contre le
// fournisseur OpenID factice et le vrai serveur, sur le serveur commun d'essai (MATRIX_TEST_DATABASE_URL et
// MATRIX_TEST_ADMIN_URL ; sans eux, le fichier est sauté). Une table clavis.pub_acces d'essai, créée au nom de clavis_app
// (mêmes colonnes que la publication), tient lieu de la vue que Matrix applique ; elle est supprimée à la fin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { demarrerFournisseur } from './oidc-factice.mjs';

const APP_URL = process.env.MATRIX_TEST_DATABASE_URL, ADMIN_URL = process.env.MATRIX_TEST_ADMIN_URL;
const actif = Boolean(APP_URL && ADMIN_URL);
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = '6f1d2c3b-4a5e-4f60-8172-8394a5b6c7d8', LECTEUR = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
let fournisseur, base, proc, data, admin, creee = false, vueReelle = false;

const sql = q => admin.query(q);

before(async () => {
  if (!actif) return;
  admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  // La vraie publication est déjà appliquée sur ce serveur : on n'y touche pas, le parcours est sauté.
  vueReelle = (await sql(`SELECT relkind FROM pg_class WHERE oid = to_regclass('clavis.pub_acces')`)).rows[0]?.relkind === 'v';
  if (vueReelle) return;
  if (!(await sql(`SELECT to_regclass('clavis.pub_acces') AS v`)).rows[0].v) {
    await sql(`SET ROLE clavis_app; CREATE TABLE clavis.pub_acces (personne_id uuid, application text, autorise boolean, niveau text, domaine text, role text, ouvert boolean, maj_le timestamptz); RESET ROLE`);
    creee = true;
  }
  await sql(`SET ROLE clavis_app; INSERT INTO clavis.pub_acces VALUES
    ('${ADMIN}', 'matrix', true, 'admin', null, 'Matrix.Administrateur', true, now()),
    ('${LECTEUR}', 'matrix', true, 'reader', null, 'Matrix.Lecture', true, now()),
    ('${LECTEUR}', 'keystone', true, 'admin', null, 'director', true, now()); RESET ROLE`);
  fournisseur = await demarrerFournisseur({ comptes: {
    // Les rôles du jeton sont ignorés : seul compte ce que dit clavis.pub_acces.
    admin: { name: 'Claire Bardet', oid: ADMIN, email: 'c.bardet@epc2i.example', roles: ['Matrix.Lecture'] },
    lecteur: { name: 'Marc Petit', oid: LECTEUR, email: 'm.petit@epc2i.example', roles: ['Matrix.Administrateur'] },
  } });
  data = mkdtempSync(join(tmpdir(), 'matrix-clavis-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  base = `http://localhost:${port}`;
  proc = spawn(process.execPath, [join(RACINE, 'serveur.mjs')], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, PORT: String(port), MATRIX_DATA_DIR: data,
    MATRIX_ENTRA_TENANT_ID: 'tenant', MATRIX_ENTRA_CLIENT_ID: fournisseur.clientId, MATRIX_ENTRA_CLIENT_SECRET: fournisseur.clientSecret,
    MATRIX_ENTRA_ISSUER: fournisseur.issuer, MATRIX_PUBLIC_URL: base, MATRIX_SESSION_SECRET: 'secret-de-session-de-test-assez-long-42',
    MATRIX_DATABASE_URL: APP_URL, MATRIX_ACCES_CLAVIS: 'on', MATRIX_ACCES_CLAVIS_SECONDES: '0' } });
  await new Promise((ok, ko) => {
    const t = setTimeout(() => ko(new Error('le serveur ne démarre pas')), 20000);
    proc.stdout.on('data', b => { if (String(b).includes('écoute sur le port')) { clearTimeout(t); ok(); } });
  });
});
after(async () => {
  proc?.kill();
  await fournisseur?.fermer();
  if (data) rmSync(data, { recursive: true, force: true });
  if (admin) {
    if (vueReelle) { await admin.end(); return; }
    if (creee) await sql('DROP TABLE clavis.pub_acces');
    else await sql(`SET ROLE clavis_app; DELETE FROM clavis.pub_acces WHERE personne_id IN ('${ADMIN}', '${LECTEUR}'); RESET ROLE`).catch(() => {});
    await admin.end();
  }
});

async function connecter(cle) {
  fournisseur.choisir(cle);
  const cookies = new Map();
  let url = `${base}/auth/entra?suite=%2F`, r;
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
  return { r, session: session ? `matrix_session=${session}` : null };
}

const moi = async session => {
  const r = await fetch(base + '/api/moi', { headers: { cookie: session } });
  return r.status === 200 ? (await r.json()).role : r.status;
};

test('connexion par Clavis : rôle lu dans clavis.pub_acces, changement et retrait appliqués en cours de session', { skip: !actif && 'MATRIX_TEST_DATABASE_URL et MATRIX_TEST_ADMIN_URL absents' }, async t => {
  if (vueReelle) return t.skip('clavis.pub_acces est déjà la vraie publication sur ce serveur');
  // Le rôle vient de Clavis, pas du jeton (le jeton dit l'inverse).
  const a = await connecter('admin');
  assert.ok(a.session);
  assert.equal(await moi(a.session), 'admin');
  const l = await connecter('lecteur');
  assert.equal(await moi(l.session), 'lecture');
  // La DSI change le rôle dans Clavis : appliqué à la requête suivante (relecture immédiate dans cet essai).
  await sql(`SET ROLE clavis_app; UPDATE clavis.pub_acces SET role = 'Matrix.Lecture' WHERE personne_id = '${ADMIN}'; RESET ROLE`);
  assert.equal(await moi(a.session), 'lecture');
  // Accès retiré : la session ne vaut plus rien, une nouvelle connexion est refusée.
  await sql(`SET ROLE clavis_app; UPDATE clavis.pub_acces SET ouvert = false WHERE personne_id = '${ADMIN}'; RESET ROLE`);
  assert.equal(await moi(a.session), 401);
  const refus = await connecter('admin');
  assert.equal(refus.r.status, 403);
  assert.equal(refus.session, null);
});
