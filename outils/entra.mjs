// Connexion nominative par Microsoft Entra ID (décision M-06 du 04/11/2026, écart E-02), comme Keystone et Vigie :
// OpenID Connect, Authorization Code avec PKCE, state et nonce (openid-client v6). Le jeton d'identité est contrôlé
// (émetteur, audience, signature, expiration, nonce) ; le rôle Matrix vient des rôles applicatifs attribués dans
// l'application d'entreprise (revendication roles) :
//   - MATRIX_ENTRA_ROLE_ADMIN   (défaut Matrix.Administrateur) : la DSI, qui consulte et modifie (M-04) ;
//   - MATRIX_ENTRA_ROLE_LECTURE (défaut Matrix.Lecture)        : consultation seule.
// Une personne sans l'un de ces rôles est refusée (« Accès non autorisé »), sans session.
//
// Variables (toutes nécessaires pour activer Entra ID ; une configuration partielle est signalée et laissée inactive) :
//   MATRIX_ENTRA_TENANT_ID, MATRIX_ENTRA_CLIENT_ID, MATRIX_ENTRA_CLIENT_SECRET,
//   MATRIX_PUBLIC_URL      adresse publique de Matrix (https://…), base de l'URI de retour /auth/retour ;
//   MATRIX_SESSION_SECRET  clé des cookies de session (32 caractères au moins, aléatoire) ;
//   MATRIX_ENTRA_ISSUER    facultatif : autre émetteur (cloud souverain, fournisseur d'essai ; http:// admis pour
//                          localhost et 127.0.0.1 seulement).

import * as client from 'openid-client';

export const CHEMIN_RETOUR = '/auth/retour';
const PORTEES = 'openid profile email';
const DUREE_DECOUVERTE_MS = 24 * 3600 * 1000;

const local = u => ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);

/** Configuration Entra ID lue dans l'environnement : { active, erreurs, … }. */
export function lireConfigEntra(env = process.env) {
  const v = k => String(env[k] ?? '').trim();
  const tenant = v('MATRIX_ENTRA_TENANT_ID'), clientId = v('MATRIX_ENTRA_CLIENT_ID'), clientSecret = v('MATRIX_ENTRA_CLIENT_SECRET');
  const publicUrl = v('MATRIX_PUBLIC_URL').replace(/\/+$/, ''), secret = v('MATRIX_SESSION_SECRET');
  const noms = ['MATRIX_ENTRA_TENANT_ID', 'MATRIX_ENTRA_CLIENT_ID', 'MATRIX_ENTRA_CLIENT_SECRET', 'MATRIX_PUBLIC_URL', 'MATRIX_SESSION_SECRET'];
  const presentes = noms.filter(k => v(k));
  if (!presentes.length) return { active: false, erreurs: [] };
  const erreurs = noms.filter(k => !v(k)).map(k => `${k} manquant`);
  let issuer = v('MATRIX_ENTRA_ISSUER') || (tenant ? `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/v2.0` : '');
  for (const [nom, valeur] of [['MATRIX_PUBLIC_URL', publicUrl], ['MATRIX_ENTRA_ISSUER', issuer]]) {
    if (!valeur) continue;
    let u; try { u = new URL(valeur); } catch { erreurs.push(`${nom} : adresse invalide`); continue; }
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local(u))) erreurs.push(`${nom} : https:// exigé (http:// pour localhost seulement)`);
  }
  if (secret && secret.length < 32) erreurs.push('MATRIX_SESSION_SECRET : 32 caractères au moins');
  return {
    active: erreurs.length === 0, erreurs, tenant, clientId, clientSecret, publicUrl, secret, issuer,
    roleAdmin: v('MATRIX_ENTRA_ROLE_ADMIN') || 'Matrix.Administrateur',
    roleLecture: v('MATRIX_ENTRA_ROLE_LECTURE') || 'Matrix.Lecture',
  };
}

/** Rôle Matrix d'après les rôles applicatifs reçus : le plus élevé, ou null. */
export function roleDepuisEntra(roles, cfg) {
  const r = Array.isArray(roles) ? roles.map(String) : [];
  return r.includes(cfg.roleAdmin) ? 'admin' : r.includes(cfg.roleLecture) ? 'lecture' : null;
}

/** Nom affiché et identifiant stable tirés des revendications du jeton d'identité. */
export function personneDepuisJeton(c) {
  const nom = String(c.name ?? c.preferred_username ?? c.email ?? '').trim().slice(0, 120);
  return { nom: nom || String(c.oid ?? c.sub ?? 'inconnu'), oid: String(c.oid ?? c.sub ?? ''), email: c.email ?? c.preferred_username ?? null };
}

let decouverte = null;
/** Métadonnées de l'émetteur (gardées 24 h ; un échec n'est pas gardé). */
function configurationOidc(cfg) {
  const cle = `${cfg.issuer}\u0000${cfg.clientId}\u0000${cfg.clientSecret}`;
  if (!decouverte || decouverte.cle !== cle || Date.now() - decouverte.le > DUREE_DECOUVERTE_MS) {
    const http = cfg.issuer.startsWith('http://');
    const promesse = client.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret, undefined, http ? { execute: [client.allowInsecureRequests] } : undefined);
    const entree = { cle, le: Date.now(), promesse };
    decouverte = entree;
    promesse.catch(() => { if (decouverte === entree) decouverte = null; });
  }
  return decouverte.promesse;
}

export const uriRetour = cfg => `${cfg.publicUrl}${CHEMIN_RETOUR}`;

/** Adresse de la page de connexion Microsoft et contrôles à garder jusqu'au retour (cookie signé, 10 minutes). */
export async function debutConnexion(cfg) {
  const oidc = await configurationOidc(cfg);
  const verifier = client.randomPKCECodeVerifier(), state = client.randomState(), nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(oidc, {
    redirect_uri: uriRetour(cfg), scope: PORTEES, response_mode: 'query',
    code_challenge: await client.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256', state, nonce,
  });
  return { url, controle: { state, nonce, verifier } };
}

/** Retour de Microsoft : échange du code (PKCE), contrôle du state, du nonce et du jeton ; renvoie ses revendications. */
export async function finConnexion(cfg, recherche, controle) {
  const oidc = await configurationOidc(cfg);
  const jetons = await client.authorizationCodeGrant(oidc, new URL(`${uriRetour(cfg)}${recherche}`), {
    pkceCodeVerifier: controle.verifier, expectedState: controle.state, expectedNonce: controle.nonce, idTokenExpected: true,
  });
  const c = jetons.claims();
  if (!c) throw new Error('jeton d’identité absent');
  return c;
}
