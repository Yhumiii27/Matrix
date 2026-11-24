// Configuration de Matrix (REGLES § 9 de Norma) : toutes les variables d'environnement que Matrix lit, avec leur type, leurs
// bornes et leurs valeurs par défaut, lues et contrôlées ici seulement. Une variable invalide arrête Matrix au démarrage,
// une ligne par erreur (`chargerConfiguration`). Le reste du code reçoit la configuration, il ne lit jamais process.env.
//
// Exceptions (aucune n'est une variable de Matrix) : integration/*.mjs, bibliothèques que les autres outils copient et
// appellent avec leur propre environnement (MATRIX_URL, MATRIX_TOKEN de l'outil) ; test/*.mjs (MATRIX_TEST_*, bases
// d'essai) ; le HEALTHCHECK du Dockerfile, ligne de commande qui relit PORT dans le conteneur.
//
// Une configuration incomplète (Entra ID ou alertes à moitié posées) n'est pas invalide : elle est signalée et laissée
// inactive, comme avant. Une valeur mal formée (nombre, adresse, secret trop court) est une erreur.

import { existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lireMotDePasse } from './acces.mjs';
import { lireConfigEntra } from './entra.mjs';
import { lireConfigAlertes } from './alertes.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

const ADRESSE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const local = u => ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);

/**
 * Les variables de Matrix. `type` : entier (min, max, defaut), choix (valeurs), dossier, texte, secret (min), url (https
 * exigé hors localhost), postgres (postgres:// ou postgresql://), adresses (e-mails séparés par , ; ou espace), adresse.
 * `.env.example` les décrit toutes (test/config.test.mjs le vérifie).
 */
export const VARIABLES = [
  { nom: 'PORT', type: 'entier', min: 1, max: 65535, defaut: 3700, aide: 'port d’écoute (3700 au registre de Norma ; 3000 dans l’image Docker)' },
  { nom: 'NODE_ENV', type: 'choix', valeurs: ['', 'development', 'production', 'test'], defaut: '', aide: 'production : modifications refusées sans accès réservé' },
  { nom: 'MATRIX_DATA_DIR', type: 'dossier', defaut: null, aide: 'données vivantes (défaut ./data)' },
  { nom: 'MATRIX_DECLARATIONS_DIR', type: 'dossier', defaut: null, aide: 'déclarations lues par le collecteur en ligne de commande (défaut ./declarations)' },
  { nom: 'MATRIX_SOURCES_DIR', type: 'dossier', existe: true, defaut: null, aide: 'dossier des dépôts des outils (facultatif, doit exister)' },
  { nom: 'MATRIX_TOKEN', type: 'texte', defaut: '', aide: 'jeton partagé avec les outils (déclarations, demandes d’accès)' },
  { nom: 'MATRIX_MOT_DE_PASSE', type: 'texte', defaut: '', aide: 'mot de passe d’accès (page /connexion, en-tête Basic)' },
  { nom: 'MATRIX_DATABASE_URL', type: 'postgres', defaut: '', aide: 'serveur commun, rôle matrix_app' },
  { nom: 'MATRIX_GESTION_DATABASE_URL', type: 'postgres', defaut: '', aide: 'serveur commun, rôle matrix_gestion (M-18)' },
  { nom: 'MATRIX_SYNCHRO_MINUTES', type: 'entier', min: 0, max: 1440, defaut: 60, aide: 'minutes entre deux lectures du serveur commun (0 : au démarrage et à la demande)' },
  { nom: 'MATRIX_PUBLIC_URL', type: 'url', defaut: '', aide: 'adresse publique (retour de connexion, liens des alertes)' },
  { nom: 'MATRIX_SESSION_SECRET', type: 'secret', min: 32, defaut: '', aide: 'clé des cookies de session (32 caractères au moins)' },
  { nom: 'MATRIX_ENTRA_TENANT_ID', type: 'texte', defaut: '', aide: 'locataire Entra ID (ou « clavis »)' },
  { nom: 'MATRIX_ENTRA_CLIENT_ID', type: 'texte', defaut: '', aide: 'identifiant de l’application' },
  { nom: 'MATRIX_ENTRA_CLIENT_SECRET', type: 'texte', defaut: '', aide: 'secret de l’application' },
  { nom: 'MATRIX_ENTRA_ISSUER', type: 'url', defaut: '', aide: 'émetteur (Clavis), sinon Entra ID d’après le locataire' },
  { nom: 'MATRIX_ENTRA_ROLE_ADMIN', type: 'texte', defaut: 'Matrix.Administrateur', aide: 'rôle applicatif de la DSI' },
  { nom: 'MATRIX_ENTRA_ROLE_LECTURE', type: 'texte', defaut: 'Matrix.Lecture', aide: 'rôle applicatif de consultation' },
  { nom: 'MATRIX_ACCES_CLAVIS', type: 'choix', valeurs: ['', 'on', 'off'], defaut: '', aide: 'on : rôle lu dans clavis.pub_acces' },
  { nom: 'MATRIX_ACCES_CLAVIS_SECONDES', type: 'entier', min: 0, max: 60, defaut: 60, aide: 'relecture du droit au plus toutes les N secondes (Norma § 6 : au plus chaque minute)' },
  { nom: 'MATRIX_ALERTES_DESTINATAIRES', type: 'adresses', defaut: '', aide: 'adresses de la DSI (active les alertes)' },
  { nom: 'MATRIX_ALERTES_EXPEDITEUR', type: 'adresse', defaut: '', aide: 'boîte d’envoi (droit Mail.Send)' },
  { nom: 'MATRIX_ALERTES_LOGIN_URL', type: 'url', defaut: '', aide: 'point de connexion de Microsoft (défaut https://login.microsoftonline.com)' },
  { nom: 'MATRIX_ALERTES_GRAPH_URL', type: 'url', defaut: '', aide: 'Microsoft Graph (défaut https://graph.microsoft.com)' },
];

/** Contrôle d'une valeur : [valeur lue, erreur ou null]. Une variable vide (ou absente) vaut sa valeur par défaut. */
function lireValeur(v, brut) {
  const s = String(brut ?? '').trim();
  if (v.type === 'texte') return [brut === undefined ? v.defaut : String(brut), null];
  if (!s) return [v.defaut, null];
  switch (v.type) {
    case 'entier': {
      if (!/^-?\d+$/.test(s)) return [v.defaut, `${v.nom} : nombre entier attendu (reçu « ${s} »)`];
      const n = Number(s);
      if (n < v.min || n > v.max) return [v.defaut, `${v.nom} : entre ${v.min} et ${v.max} (reçu ${n})`];
      return [n, null];
    }
    case 'choix': {
      const c = s.toLowerCase();
      return v.valeurs.includes(c) ? [c, null] : [v.defaut, `${v.nom} : ${v.valeurs.filter(Boolean).join(' | ')} ou vide (reçu « ${s} »)`];
    }
    case 'dossier': {
      const d = isAbsolute(s) ? s : resolve(s);
      if (v.existe && !(existsSync(d) && statSync(d).isDirectory())) return [null, `${v.nom} : dossier introuvable (${s})`];
      return [d, null];
    }
    case 'secret':
      return s.length < v.min ? [v.defaut, `${v.nom} : ${v.min} caractères au moins`] : [s, null];
    case 'url': {
      let u; try { u = new URL(s); } catch { return [v.defaut, `${v.nom} : adresse invalide`]; }
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local(u))) return [v.defaut, `${v.nom} : https:// exigé (http:// pour localhost seulement)`];
      return [s.replace(/\/+$/, ''), null];
    }
    case 'postgres': {
      let u; try { u = new URL(s); } catch { return [v.defaut, `${v.nom} : adresse invalide (postgres://rôle:mot de passe@hôte:5432/base)`]; }
      if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.hostname) return [v.defaut, `${v.nom} : postgres://rôle:mot de passe@hôte:5432/base attendu`];
      return [s, null];
    }
    case 'adresse':
      return ADRESSE.test(s) ? [s, null] : [v.defaut, `${v.nom} : adresse invalide (${s})`];
    case 'adresses': {
      const fausses = s.split(/[,;\s]+/).filter(Boolean).filter(a => !ADRESSE.test(a));
      return fausses.length ? [v.defaut, `${v.nom} : adresse invalide (${fausses.join(', ')})`] : [s, null];
    }
    default: throw new Error(`type inconnu : ${v.type}`);
  }
}

/**
 * Configuration lue dans `env` : { config, erreurs, avertissements }. `erreurs` non vide = Matrix ne démarre pas.
 * Fonction pure (aucun effet hors la lecture du disque pour MATRIX_SOURCES_DIR).
 */
export function lireConfiguration(env) {
  const erreurs = [], avertissements = [], valeurs = {};
  for (const v of VARIABLES) {
    const [valeur, erreur] = lireValeur(v, env[v.nom]);
    valeurs[v.nom] = valeur;
    if (erreur) erreurs.push(erreur);
  }
  const { mdp, avertissements: avMdp } = lireMotDePasse(env.MATRIX_MOT_DE_PASSE);
  avertissements.push(...avMdp);

  // Groupes : formats déjà contrôlés ci-dessus ; il ne reste que les variables manquantes, signalées sans arrêter.
  const entra = lireConfigEntra(env), alertes = lireConfigAlertes(env);
  if (!erreurs.length) {
    if (entra.erreurs.length) avertissements.push(`Microsoft Entra ID non activé, configuration incomplète : ${entra.erreurs.join(' ; ')}.`);
    if (alertes.erreurs.length) avertissements.push(`Alertes par e-mail non activées, configuration incomplète : ${alertes.erreurs.join(' ; ')}.`);
  }

  const accesClavis = valeurs.MATRIX_ACCES_CLAVIS === 'on';
  if (accesClavis && !valeurs.MATRIX_DATABASE_URL) erreurs.push('MATRIX_ACCES_CLAVIS=on : MATRIX_DATABASE_URL est nécessaire (clavis.pub_acces est sur le serveur commun)');
  if (accesClavis && !erreurs.length && !entra.active) erreurs.push('MATRIX_ACCES_CLAVIS=on : la connexion par Clavis (variables MATRIX_ENTRA_* et MATRIX_SESSION_SECRET) doit être complète');
  if (valeurs.MATRIX_GESTION_DATABASE_URL && !valeurs.MATRIX_DATABASE_URL) erreurs.push('MATRIX_GESTION_DATABASE_URL : MATRIX_DATABASE_URL est nécessaire aussi');

  const config = {
    port: valeurs.PORT,
    production: valeurs.NODE_ENV === 'production',
    dataDir: valeurs.MATRIX_DATA_DIR ?? join(RACINE, 'data'),
    declarationsDir: valeurs.MATRIX_DECLARATIONS_DIR ?? join(RACINE, 'declarations'),
    sourcesDir: valeurs.MATRIX_SOURCES_DIR,
    token: valeurs.MATRIX_TOKEN,
    motDePasse: mdp,
    dbUrl: valeurs.MATRIX_DATABASE_URL,
    gestionUrl: valeurs.MATRIX_GESTION_DATABASE_URL,
    synchroMinutes: valeurs.MATRIX_SYNCHRO_MINUTES,
    publicUrl: valeurs.MATRIX_PUBLIC_URL,
    accesClavis,
    dureeDroitMs: valeurs.MATRIX_ACCES_CLAVIS_SECONDES * 1000,
    entra,
    alertes,
  };
  return { config, erreurs, avertissements };
}

/**
 * Configuration du processus : le seul endroit où Matrix lit process.env. Une erreur arrête le processus (code 1), une
 * ligne par erreur sur la sortie d'erreur ; les avertissements sont affichés et Matrix démarre.
 */
export function chargerConfiguration(env = process.env, { sortir = code => process.exit(code), log = console } = {}) {
  const r = lireConfiguration(env);
  if (r.erreurs.length) {
    for (const e of r.erreurs) log.error(`configuration invalide : ${e}`);
    log.error(`Matrix ne démarre pas : ${r.erreurs.length} variable(s) d’environnement à corriger (voir .env.example).`);
    sortir(1);
    return null;
  }
  for (const a of r.avertissements) log.warn(a);
  return r.config;
}
