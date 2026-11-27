// Accès à Matrix par mot de passe (MATRIX_MOT_DE_PASSE) : page de connexion et session, ou en-tête HTTP Basic pour les
// clients de l'API.
//
// Matrix demandait jusqu'ici le mot de passe par la fenêtre HTTP Basic du navigateur. Quand le mot de passe saisi ne
// correspondait pas exactement à la variable du serveur (espace ou guillemets ajoutés à la saisie dans Coolify, « $ »
// interprété, authentification HTTP de Coolify activée en plus, qui utilise le même en-tête), la fenêtre revenait sans
// fin, sans dire pourquoi. Désormais :
//   - le navigateur est envoyé sur /connexion, une page qui dit « mot de passe incorrect » ; une connexion réussie pose
//     un cookie de session signé (12 heures), lié au mot de passe : changer le mot de passe ferme toutes les sessions ;
//   - l'en-tête Authorization: Basic reste accepté (scripts, curl -u, outils), mais Matrix n'envoie plus jamais
//     WWW-Authenticate : plus aucune fenêtre du navigateur ;
//   - un en-tête Basic refusé (celui de l'authentification de Coolify, par exemple) ne bloque plus : la session décide ;
//   - chaque refus est écrit dans le journal du conteneur, et le démarrage signale une variable suspecte.

import { FR, traduire, langOf } from './i18n.mjs';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'matrix_session';
export const DUREE_SESSION_S = 12 * 3600;
const ECHECS_MAX = 10;
const FENETRE_ECHECS_MS = 15 * 60 * 1000;

/** Mot de passe lu dans la variable, sans les espaces et retours à la ligne qui l'entourent, et ses avertissements. */
export function lireMotDePasse(brut) {
  const valeur = String(brut ?? '');
  const mdp = valeur.trim();
  const avertissements = [];
  if (mdp !== valeur) avertissements.push('MATRIX_MOT_DE_PASSE commence ou finit par des espaces ou un retour à la ligne : ils sont ignorés.');
  if (/^(["']).*\1$/s.test(mdp) && mdp.length >= 2) avertissements.push('MATRIX_MOT_DE_PASSE est entouré de guillemets : ils font partie du mot de passe. Retirez-les dans la variable si vous ne les tapez pas.');
  if (mdp.includes('$')) avertissements.push('MATRIX_MOT_DE_PASSE contient « $ » : certains hébergeurs (Coolify sans l’option « littéral ») remplacent « $mot » par une variable vide. En cas de refus, choisissez un mot de passe sans « $ ».');
  return { mdp, avertissements };
}

const egal = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Mot de passe saisi dans la page de connexion, tel quel ou sans les espaces qui l'entourent (copier-coller). */
export const motDePasseValide = (saisi, mdp) => !!mdp && (egal(String(saisi ?? ''), mdp) || egal(String(saisi ?? '').trim(), mdp));

/**
 * Identifiant porté par un en-tête Authorization: Basic valide, ou null. Le mot de passe est comparé décodé en UTF-8
 * puis en Latin-1 (certains navigateurs et clients encodent encore les accents en Latin-1).
 */
export function identifiantBasic(entete, mdp) {
  const m = String(entete ?? '').match(/^Basic\s+(\S+)$/i);
  if (!m || !mdp) return null;
  const octets = Buffer.from(m[1], 'base64');
  for (const encodage of ['utf8', 'latin1']) {
    const brut = octets.toString(encodage);
    const i = brut.indexOf(':');
    if (i >= 0 && egal(brut.slice(i + 1), mdp)) return brut.slice(0, i).trim() || 'administrateur';
  }
  return null;
}

const cle = mdp => createHmac('sha256', 'matrix-session').update(mdp).digest();
const signature = (mdp, corps) => createHmac('sha256', cle(mdp)).update(corps).digest('base64url');

/**
 * Jeton signé générique (session Entra ID, contrôles du retour de Microsoft) : données JSON, échéance, signature
 * HMAC-SHA256 sous la clé donnée (MATRIX_SESSION_SECRET). `lireJeton` renvoie les données, ou null (signature fausse,
 * échu, illisible).
 */
export function creerJeton(donnees, secret, dureeS, maintenantMs = Date.now()) {
  const corps = `${Buffer.from(JSON.stringify(donnees), 'utf8').toString('base64url')}.${Math.floor(maintenantMs / 1000) + dureeS}`;
  return `${corps}.${signature(`jeton|${secret}`, corps)}`;
}
export function lireJeton(valeur, secret, maintenantMs = Date.now()) {
  const p = String(valeur ?? '').split('.');
  if (p.length !== 3 || !secret) return null;
  const corps = `${p[0]}.${p[1]}`;
  if (!egal(p[2], signature(`jeton|${secret}`, corps))) return null;
  if (!(Number(p[1]) * 1000 > maintenantMs)) return null;
  try { return JSON.parse(Buffer.from(p[0], 'base64url').toString('utf8')); } catch { return null; }
}

/** Valeur du cookie de session : identifiant, échéance (secondes), signature. */
export function creerSession(identifiant, mdp, maintenantMs = Date.now()) {
  const corps = `${Buffer.from(identifiant, 'utf8').toString('base64url')}.${Math.floor(maintenantMs / 1000) + DUREE_SESSION_S}`;
  return `${corps}.${signature(mdp, corps)}`;
}

/** Identifiant d'une session valide et non échue, ou null. */
export function lireSession(valeur, mdp, maintenantMs = Date.now()) {
  const p = String(valeur ?? '').split('.');
  if (p.length !== 3 || !mdp) return null;
  const corps = `${p[0]}.${p[1]}`;
  if (!egal(p[2], signature(mdp, corps))) return null;
  if (!(Number(p[1]) * 1000 > maintenantMs)) return null;
  return Buffer.from(p[0], 'base64url').toString('utf8') || null;
}

export function lireCookie(entete, nom) {
  for (const morceau of String(entete ?? '').split(';')) {
    const i = morceau.indexOf('=');
    if (i > 0 && morceau.slice(0, i).trim() === nom) return morceau.slice(i + 1).trim();
  }
  return null;
}

export function enteteCookie(valeur, { secure, maxAge = DUREE_SESSION_S, nom = COOKIE }) {
  return `${nom}=${valeur}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

/** Page de retour après connexion : un chemin de Matrix seulement (jamais une autre adresse). */
export function suiteSure(suite) {
  const s = String(suite ?? '');
  return /^\/(?![\/\\])[^\s]*$/.test(s) && !s.startsWith('/connexion') ? s : '/';
}

/** Limite des échecs de connexion par adresse : 10 par quart d'heure. */
export function limiteur({ max = ECHECS_MAX, fenetreMs = FENETRE_ECHECS_MS } = {}) {
  const echecs = new Map();
  const recents = (ip, t) => (echecs.get(ip) ?? []).filter(x => t - x < fenetreMs);
  return {
    bloque: (ip, t = Date.now()) => recents(ip, t).length >= max,
    echec: (ip, t = Date.now()) => { const l = recents(ip, t); l.push(t); echecs.set(ip, l); if (echecs.size > 10000) echecs.delete(echecs.keys().next().value); },
    reussite: ip => echecs.delete(ip),
  };
}

const echapper = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Page de connexion (HTML autonome, sans script). `entra` : bouton « Se connecter avec Microsoft » (E-02) à la place du
 * formulaire à mot de passe ; `refus` : page d'accès refusé (compte sans rôle Matrix).
 */
export function pageConnexion({ erreur = '', erreurVars, suite = '/', identifiant = '', entra = false, refus = false, lang = 'fr' } = {}) {
  // Langue de la page (cookie matrix-lang lu par serveur.mjs) ; l'erreur est une chaîne source anglaise du dictionnaire.
  const t = (source, vars) => traduire(FR, lang, source, vars);
  return `<!doctype html>
<html lang="${langOf(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t('Sign-in')} · Matrix</title>
<link rel="stylesheet" href="/charte/nocturne.css">
<style>
  @font-face { font-family: "Inter"; font-style: normal; font-weight: 100 900; font-display: swap; src: url(/fonts/inter-latin-wght.woff2) format("woff2"); }
  /* Charte Nocturne (norma/charte/nocturne.css, servie par Matrix) : sombre par défaut, clair par <html data-theme="light">
     (cookie atrium-theme, posé par serveur.mjs). Jetons de la charte seulement. */
  :root { --fond: var(--color-bg); --carte: var(--color-surface); --texte: var(--color-text); --doux: color-mix(in srgb, var(--color-text) 62%, transparent); --bord: var(--color-divider); --accent: var(--color-accent); --sur-accent: var(--color-bg); --erreur: var(--color-accent-300); }
  :root[data-theme="light"] { --doux: color-mix(in srgb, var(--color-text) 68%, transparent); --sur-accent: var(--color-surface); }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--fond); color: var(--texte); font: 15px/1.5 "Inter", system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; }
  form { width: 100%; max-width: 360px; background: var(--carte); border: 1px solid var(--bord); border-radius: 10px; padding: 28px 24px; display: grid; gap: 14px; }
  h1 { margin: 0; font-size: 20px; } p { margin: 0; color: var(--doux); font-size: 14px; }
  label { display: grid; gap: 4px; font-size: 13px; color: var(--doux); }
  input { font: inherit; padding: 9px 10px; border-radius: 6px; border: 1px solid var(--bord); background: transparent; color: var(--texte); }
  input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button { font: inherit; font-weight: 600; padding: 10px; border: 0; border-radius: 6px; background: var(--accent); color: var(--sur-accent); cursor: pointer; }
  .erreur { color: var(--erreur); font-size: 14px; }
  a.bouton { display: block; text-align: center; text-decoration: none; font-weight: 600; padding: 10px; border-radius: 6px; background: var(--accent); color: var(--sur-accent); }
</style>
</head>
<body>
${entra ? `<form>
  <h1>Matrix</h1>
  ${refus ? `<p>${t('Your Microsoft account has no access to Matrix. Ask the IT department to give you the “Read” or “Administrator” role in the Matrix application of Entra ID.')}</p>`
    : `<p>${t('Data map of the Atrium suite. Sign in with your company Microsoft account; your name signs your changes in the log.')}</p>`}
  ${erreur ? `<div class="erreur" role="alert">${echapper(t(erreur, erreurVars))}</div>` : ''}
  <a class="bouton" href="/auth/entra?suite=${encodeURIComponent(suiteSure(suite))}">${refus ? t('Sign in with another account') : t('Sign in with Microsoft')}</a>
</form>` : `<form method="post" action="/connexion">
  <h1>Matrix</h1>
  <p>${t('Data map of the Atrium suite. Identify yourself with the Matrix password; your identifier signs your changes in the log.')}</p>
  ${erreur ? `<div class="erreur" role="alert">${echapper(t(erreur, erreurVars))}</div>` : ''}
  <input type="hidden" name="suite" value="${echapper(suiteSure(suite))}">
  <label>${t('Identifier')}<input name="identifiant" autocomplete="username" required maxlength="120" value="${echapper(identifiant)}" ${identifiant ? '' : 'autofocus'}></label>
  <label>${t('Password')}<input name="mot_de_passe" type="password" autocomplete="current-password" required ${identifiant ? 'autofocus' : ''}></label>
  <button type="submit">${t('Sign in')}</button>
</form>`}
</body>
</html>`;
}
