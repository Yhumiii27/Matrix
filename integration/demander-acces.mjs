// Demande d'accès d'un outil à une vue (ou fonction) pub_ d'un autre outil, auprès de Matrix (écart E-10).
//
// À copier dans l'outil qui veut lire (ou écrire par une fonction pub_) chez un autre, à côté de declarer-schema.mjs :
//
//   import { demanderAcces, suivreAcces } from './demander-acces.mjs';
//
//   // Demander à lire la vue des projets de Keystone (Arche, par exemple) :
//   await demanderAcces({ app: 'arche', vue: 'keystone.pub_projets', motif: 'Rattacher chaque CAPEX à son projet (AR-012)' });
//
//   // Écrire chez Vigie par sa fonction pub_ (lien « écriture ») :
//   await demanderAcces({ app: 'keystone', vue: 'vigie.pub_creer_ncr', nature: 'execution', motif: 'Ouvrir une NCR depuis le punch list' });
//
//   // Suivre ses demandes (statut décidé dans Matrix, droit réellement posé sur le serveur) :
//   const { liens } = await suivreAcces({ app: 'arche' });
//
// La demande n'est qu'une demande : la DSI l'autorise ou la refuse dans Matrix (« Liens entre outils »), qui pose alors
// le droit. Un lien déjà autorisé n'est pas touché ; un lien refusé repasse en demande avec le nouveau motif.
//
// Variables d'environnement (les mêmes que declarer-schema.mjs) :
//   MATRIX_URL    adresse de Matrix (https://user:mdp@… derrière une authentification HTTP de l'hébergeur)
//   MATRIX_TOKEN  jeton partagé avec Matrix, envoyé dans l'en-tête X-Matrix-Token
//
// Les deux fonctions ne lèvent jamais d'erreur : elles renvoient { ok: false, erreur } et écrivent un avertissement.

function requete(chemin, env) {
  const url = new URL(chemin, env.MATRIX_URL);
  const headers = { 'content-type': 'application/json' };
  if (env.MATRIX_TOKEN) headers['x-matrix-token'] = env.MATRIX_TOKEN;
  if (url.username) {
    headers.authorization = 'Basic ' + Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64');
    url.username = ''; url.password = '';
  }
  return { url, headers };
}

async function appeler(chemin, { method = 'GET', corps, env, log }) {
  if (!env.MATRIX_URL) return { ok: false, erreur: 'MATRIX_URL absent' };
  try {
    const { url, headers } = requete(chemin, env);
    const res = await fetch(url, { method, headers, body: corps ? JSON.stringify(corps) : undefined, signal: AbortSignal.timeout(10000) });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Matrix a répondu ${res.status} : ${r.erreur ?? ''}`);
    return { ok: true, ...r };
  } catch (e) {
    log.warn?.(`[matrix] ${e.message}`);
    return { ok: false, erreur: e.message };
  }
}

/** Demande l'accès à `vue` (schéma.pub_nom) pour l'outil `app`. `nature` : lecture (défaut) ou execution. */
export function demanderAcces({ app, vue, motif, nature = 'lecture', env = process.env, log = console }) {
  return appeler('/api/demandes', { method: 'POST', corps: { outil: app, vue, motif, nature }, env, log });
}

/** Liens de l'outil `app` dans le registre de Matrix : vue, statut, nature, droit posé. */
export function suivreAcces({ app, env = process.env, log = console }) {
  return appeler(`/api/demandes?outil=${encodeURIComponent(app)}`, { env, log });
}
