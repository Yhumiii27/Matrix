// Serveur de Matrix (Coolify ou tout hébergeur Docker, ou en local : node serveur.mjs).
//
//   GET  /                      la page de Matrix, construite avec le catalogue à jour
//   GET  /api/sante             état du serveur (utilisé par le contrôle de santé Docker)
//   GET  /api/catalogue         le catalogue courant (JSON)
//   GET  /api/declarations      dernières déclarations reçues, par outil
//   POST /api/declarations      déclaration du schéma d'un outil (contrat matrix.schema/1, voir
//                               integration/declarer-schema.mjs et docs/declaration-des-tables.md)
//   GET  /api/edition           documentation, décisions, référentiels et journal saisis dans Matrix
//   PUT  /api/documentation     documenter une table      { app, table, description, domaine, responsable, note }
//   PUT  /api/decisions         décision sur un doublon   { id, option }  (option null pour la retirer)
//   PUT  /api/referentiels/:nom remplacer un référentiel  [ … lignes … ]  (sites, organigramme, pays, zones, filiales) ;
//                               avec le serveur commun, écrit d'abord dans le schéma matrix (outils/referentiels-pg.mjs)
//   GET  /api/referentiels/:nom un référentiel publié (lu par les outils)
//   GET  /api/etat              état de santé des tables et des liens (dernière lecture du serveur commun)
//   GET  /api/liens             registre des liens entre outils, état de chaque lien, journal des décisions
//   POST /api/liens             décision sur un lien  { vue, lecteur, statut: autorise|refuse|demande, motif }
//   POST /api/synchro           relire le serveur commun maintenant
//   GET  /api/journal           journal unifié des outils (matrix.journal_unifie, D18) : outil, projet, recherche,
//                               depuis, jusqu (AAAA-MM-JJ), apres_quand + apres_ref (page suivante), limite
//   GET  /api/rex               retours d'expérience réunis (matrix.rex_unifie, D22) : outil, code, categorie, recherche
//   GET  /api/correspondances   correspondances d'identifiants (matrix.correspondances) : objet, outil, statut
//   POST /api/correspondances   décision sur une correspondance  { id, statut, pivot?, note? }
//   GET  /api/catalogue/tables  liste des tables (outil, domaine, q : recherche plein texte), pour les outils et les agents
//   GET  /api/catalogue/tables/:outil/:table  fiche d'une table : colonnes, liens, documentation, vues qui la publient, santé
//   GET  /api/export/tables.csv | colonnes.csv | dictionnaire.html | schema.mmd   exports (outil, domaine, q)
//   GET  /api/publications      registre des publications (vues pub_ des outils, M-18) et vues pas encore reprises
//   GET  /api/publications/:vue fiche d'une publication : définition, contrat, liens, journal
//   PUT  /api/publications/:vue brouillon  { mode: colonnes|sql, source, colonnes: [{ colonne, nom }], filtre, definition, description }
//   POST /api/publications/:vue/appliquer   appliquer sur le serveur (rôle matrix_gestion) : vue, contrôles, droits des liens
//   POST /api/publications/:vue/retirer     supprimer la vue (aucun lien autorisé)  { motif }
//
// Variables d'environnement :
//   PORT               port d'écoute (défaut 3000)
//   MATRIX_DATA_DIR    dossier des données vivantes : catalogue, historique, déclarations (défaut ./data ;
//                      /data dans l'image Docker, à monter sur un volume persistant)
//   MATRIX_TOKEN       jeton partagé avec les outils ; sans lui, les déclarations sont refusées (503)
//   MATRIX_SOURCES_DIR dossier contenant les dépôts keystone/, codex/, cursus/, vigie/, arche/, crucible/ (facultatif)
//   MATRIX_MOT_DE_PASSE mot de passe d'accès à Matrix (identifiant libre, authentification HTTP Basic). Sans lui,
//                      la consultation reste ouverte et, en production, les modifications sont refusées.
//   MATRIX_DATABASE_URL connexion au serveur PostgreSQL commun en matrix_app (postgres://matrix_app:…@hôte:5432/epc2i).
//                      Avec elle, la sonde (outils/sonde.mjs) lit elle-même les tables, liens, vues pub_ et droits
//                      de chaque outil, met le registre et les graphes à jour, calcule l'état de santé et tient le
//                      registre des liens (matrix.liens). Les référentiels saisis sont écrits dans le schéma matrix
//                      (pays, zones, filiales, sites, organigramme), que les outils lisent par les vues matrix.pub_*.
//   MATRIX_GESTION_DATABASE_URL connexion en matrix_gestion (décision M-18) : Matrix applique lui-même les publications
//                      (vues pub_ des outils) et les décisions sur les liens, tout de suite. Sans elle, les publications
//                      restent en brouillon et les liens sont appliqués par appliquer-liens.sh (15 minutes).
//                      Sans elle, Matrix vit des déclarations et du code des dépôts, et ses référentiels restent dans
//                      edition.json.
//   MATRIX_SYNCHRO_MINUTES intervalle entre deux lectures du serveur commun (défaut 60 ; 0 : au démarrage et à la
//                      demande seulement).

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { timingSafeEqual } from 'node:crypto';
import { collect } from './outils/collecteur.mjs';
import { construirePage, RACINE } from './outils/page.mjs';
import { chargerEdition, documenter, decider, enregistrerReferentiel, preparerReferentiel, appliquerReferentiel, referentielsSaisis, adopterReferentiels, remplacerEdition } from './outils/edition.mjs';
import { editionDisponible, lireEditionPg, reprendreEdition, journaliserPg, documenterPg, deciderPg } from './outils/edition-pg.mjs';
import { LISTES, lireReferentiels, comparer, ecrireReferentiels } from './outils/referentiels-pg.mjs';
import { lireJournal, lireRex, lireCorrespondances, deciderCorrespondance } from './outils/consultation.mjs';
import { fiches as fichesCatalogue, csvTables, csvColonnes, dictionnaireHtml, diagrammeMermaid } from './outils/export.mjs';
import { chercher } from './outils/recherche.mjs';
import { client, lireServeur, declarations, validerLien, ecrireLien, suivreMigrations } from './outils/sonde.mjs';
import { calculerSante } from './outils/sante.mjs';
import { listerPublications, lirePublication, enregistrerPublication, appliquerPublication, retirerPublication, appliquerLien } from './outils/publications.mjs';

const PORT = +(process.env.PORT ?? 3000);
const DATA = process.env.MATRIX_DATA_DIR ?? join(RACINE, 'data');
const DECL = join(DATA, 'declarations');
const SOURCES = process.env.MATRIX_SOURCES_DIR ?? null;
const TOKEN = process.env.MATRIX_TOKEN ?? '';
const MOT_DE_PASSE = process.env.MATRIX_MOT_DE_PASSE ?? '';
const PRODUCTION = process.env.NODE_ENV === 'production';
const DB_URL = process.env.MATRIX_DATABASE_URL ?? '';
const GESTION_URL = process.env.MATRIX_GESTION_DATABASE_URL ?? '';
const SYNCHRO_MINUTES = Math.max(0, Number(process.env.MATRIX_SYNCHRO_MINUTES ?? 60) || 0);
const APPS = ['keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible'];
const MAX_OCTETS = 10 * 1024 * 1024;
const EMBARQUE = join(RACINE, 'data');

const lireJson = f => JSON.parse(readFileSync(f, 'utf8'));
const ecrireJson = (f, v) => writeFileSync(f, JSON.stringify(v, null, 1));

// ── Données vivantes ─────────────────────────────────────────────────────

// Au démarrage : le catalogue embarqué dans l'image sert de point de départ et de secours. Une nouvelle image
// (catalogue relu dans les dépôts) est comparée au catalogue vivant : les changements vont dans l'historique.
function rafraichir() {
  mkdirSync(DECL, { recursive: true });
  const fallback = lireJson(join(EMBARQUE, 'catalogue.json'));
  const { catalogue, events } = collect({ root: SOURCES, dataDir: DATA, declDir: DECL, fallback });
  if (DATA !== EMBARQUE || events.length) {
    ecrireJson(join(DATA, 'catalogue.json'), catalogue);
    const histFile = join(DATA, 'historique.json');
    if (!existsSync(histFile) && existsSync(join(EMBARQUE, 'historique.json')) && DATA !== EMBARQUE) copyFileSync(join(EMBARQUE, 'historique.json'), histFile);
    const hist = existsSync(histFile) ? lireJson(histFile) : { evenements: [] };
    hist.evenements.push(...events);
    ecrireJson(histFile, hist);
  }
  page = null;
  return { catalogue, events };
}

function ajouterHistorique(evenements) {
  const histFile = join(DATA, 'historique.json');
  const hist = existsSync(histFile) ? lireJson(histFile) : { evenements: [] };
  hist.evenements.push(...evenements);
  ecrireJson(histFile, hist);
  page = null;
}

let page = null;
const pageCourante = () => (page ??= construirePage({ forme: 'document', dataDir: DATA, serveurCommun: Boolean(DB_URL) }));

// ── Référentiels sur le serveur commun (E-01) ─────────────────────────────

// Une écriture de référentiel à la fois : valider, écrire sur le serveur, puis enregistrer edition.json, sans qu'une
// autre écriture ne s'intercale entre ces étapes.
let fileReferentiels = Promise.resolve();
const enSerie = tache => { const p = fileReferentiels.then(tache); fileReferentiels = p.catch(() => {}); return p; };

async function avecServeur(tache, url = DB_URL) {
  const db = client(url);
  try { await db.connect(); return await tache(db); } finally { await db.end().catch(() => {}); }
}
// Administration (M-18) : une seule opération à la fois, pour qu'une publication et un lien ne se croisent pas.
let fileGestion = Promise.resolve();
const avecGestion = tache => { const p = fileGestion.then(() => avecServeur(tache, GESTION_URL)); fileGestion = p.catch(() => {}); return p; };

// ── Saisies de Matrix sur le serveur commun (E-04) ─────────────────────────
// Avec partage/15 joué, documentation, décisions et journal vivent dans le schéma matrix (verrou et version : outils/
// edition-pg.mjs) ; edition.json en est la copie locale, rafraîchie après chaque écriture et à chaque lecture du serveur.
// Au premier passage, des tables vides reprennent le contenu d'edition.json. Sans serveur, edition.json reste la source.
let edition = { actif: false, erreur: null, reprisLe: null };
async function copierEdition(db) { remplacerEdition(DATA, await lireEditionPg(db)); page = null; }
async function alignerEdition(db, demarrage) {
  return enSerie(async () => {
    try {
      if (!await editionDisponible(db)) {
        edition = { actif: false, erreur: 'tables absentes : jouez partage/15-matrix-edition.sql (rôle matrix_app) ; saisies dans edition.json', reprisLe: null };
        return;
      }
      if (demarrage) {
        const n = await reprendreEdition(db, chargerEdition(DATA));
        if (n !== null) { edition.reprisLe = new Date().toISOString(); console.log(`saisies d'edition.json reprises sur le serveur commun : ${n} ligne(s)`); }
      }
      await copierEdition(db);
      edition = { ...edition, actif: true, erreur: null, copieLe: new Date().toISOString() };
    } catch (e) {
      edition = { ...edition, erreur: e.message, erreurLe: new Date().toISOString() };
      console.error(`saisies sur le serveur commun : ${e.message}`);
    }
  });
}
// Documentation et décision : en base si possible (verrou, version, journal), sinon dans edition.json.
async function ecrireSaisie(quoi, corps, auteur) {
  if (!edition.actif) {
    return quoi === 'documentation' ? documenter(DATA, lireJson(join(DATA, 'catalogue.json')), corps, auteur) : decider(DATA, corps, auteur);
  }
  return enSerie(() => avecServeur(async db => {
    const r = quoi === 'documentation' ? await documenterPg(db, lireJson(join(DATA, 'catalogue.json')), corps, auteur) : await deciderPg(db, corps, auteur);
    await copierEdition(db);
    return r;
  }));
}

async function ecrireReferentiel(liste, lignes, auteur) {
  if (!DB_URL) return enregistrerReferentiel(DATA, liste, lignes, auteur);
  return enSerie(async () => {
    const p = preparerReferentiel(DATA, liste, lignes);
    if (p.inchange) return p.lignes;
    const bilan = await avecServeur(db => ecrireReferentiels(db, { [liste]: p.lignes }));
    const b = bilan[liste];
    const r = appliquerReferentiel(DATA, p, auteur, ` · serveur commun : ${b.ecrites} ligne(s) écrite(s)${b.desactivees ? `, ${b.desactivees} désactivée(s)` : ''}`);
    referentiels = { ...referentiels, ecarts: { ...referentiels.ecarts, [liste]: undefined } };
    // E-04 : le journal est sur le serveur commun ; l'entrée qu'appliquerReferentiel vient d'écrire y est reportée.
    if (edition.actif) await avecServeur(async db => { await journaliserPg(db, chargerEdition(DATA).journal.at(-1)); await copierEdition(db); }).catch(e => console.error(`journal : ${e.message}`));
    return r;
  });
}

// Compare les référentiels de Matrix à ceux du schéma matrix. Au démarrage (aligner), une liste déjà saisie dans Matrix
// est écrite sur le serveur (Matrix fait foi : D14, D15, D17, D21) ; une liste jamais saisie est reprise du serveur
// (amorçage de 10-matrix-referentiels.sql, ou saisie antérieure). Ensuite, à chaque lecture planifiée, l'écart est
// seulement constaté (/api/etat, /api/sante) : rien n'est réécrit sans une saisie.
let referentiels = { actif: Boolean(DB_URL), alignesLe: null, ecarts: {}, erreur: null };
async function alignerReferentiels(db, aligner) {
  return enSerie(async () => {
    try {
      const serveur = await lireReferentiels(db);
      const ed = chargerEdition(DATA), saisis = referentielsSaisis(DATA);
      const ecarts = {}, aEcrire = {}, aReprendre = {};
      for (const liste of LISTES) {
        const c = comparer(liste, ed.referentiels[liste], serveur[liste]);
        if (c.egal) continue;
        if (aligner && saisis.has(liste)) aEcrire[liste] = ed.referentiels[liste];
        else if (aligner) aReprendre[liste] = serveur[liste];
        else ecarts[liste] = { aEcrire: c.aEcrire, aDesactiver: c.aDesactiver };
      }
      if (Object.keys(aEcrire).length) {
        const bilan = await ecrireReferentiels(db, aEcrire);
        console.log(`référentiels écrits sur le serveur commun : ${Object.entries(bilan).map(([l, b]) => `${l} ${b.ecrites} écrite(s), ${b.desactivees} désactivée(s)`).join(' · ')}`);
      }
      if (Object.keys(aReprendre).length) {
        const avant = chargerEdition(DATA).journal.length;
        adopterReferentiels(DATA, aReprendre, 'serveur commun');
        if (edition.actif) for (const j of chargerEdition(DATA).journal.slice(avant)) await journaliserPg(db, j);
        page = null;
        console.log(`référentiels repris du serveur commun : ${Object.keys(aReprendre).join(', ')}`);
      }
      referentiels = { actif: true, alignesLe: new Date().toISOString(), ecarts, erreur: null, ecrits: Object.keys(aEcrire), repris: Object.keys(aReprendre) };
    } catch (e) {
      referentiels = { ...referentiels, erreur: e.message, erreurLe: new Date().toISOString() };
      console.error(`référentiels du serveur commun : ${e.message}`);
    }
    return referentiels;
  });
}

// ── Sonde du serveur commun ───────────────────────────────────────────────

// Lit le serveur commun, remplace la déclaration de chaque outil dont le schéma a changé (empreinte), recalcule le
// catalogue (historique, nouvelles tables, doublons possibles), puis l'état de santé (data/sante.json).
let sonde = { active: Boolean(DB_URL), intervalleMinutes: SYNCHRO_MINUTES, enCours: false, derniere: null, erreur: null };
let vuesConnues = null;
async function synchroniser(declencheur) {
  if (!DB_URL || sonde.enCours) return sonde;
  sonde = { ...sonde, enCours: true };
  const db = client(DB_URL);
  try {
    await db.connect();
    await alignerEdition(db, declencheur === 'démarrage');
    await alignerReferentiels(db, declencheur === 'démarrage');
    const references = lireJson(join(RACINE, 'data', 'references.json')).references;
    const lecture = await lireServeur(db, { references });
    vuesConnues = new Set([...lecture.vues.map(v => v.vue), ...(lecture.fonctions ?? []).map(f => f.fonction)]);
    const changes = [];
    mkdirSync(DECL, { recursive: true });
    // Lecture du serveur : declarations/<outil>.serveur.json, à côté de la déclaration envoyée par l'outil
    // (<outil>.json) ; le collecteur fait passer le serveur en premier (E-14). Une ancienne lecture du serveur écrite
    // dans <outil>.json (avant le 31/10/2026) est déplacée.
    // Migrations (E-06) : nouvelles migrations appliquées, ou structure changée sans migration, d'une lecture à l'autre.
    const suivi = [];
    for (const d of declarations(lecture)) {
      const file = join(DECL, `${d.app}.serveur.json`), ancien = join(DECL, `${d.app}.json`);
      if (existsSync(ancien) && lireJson(ancien).origine === 'serveur') { unlinkSync(ancien); changes.push(d.app); }
      const avant = existsSync(file) ? lireJson(file) : null;
      const { evenements, horsMigration } = suivreMigrations(avant, d, lecture.luLe);
      suivi.push(...evenements);
      if (horsMigration) d.horsMigration = horsMigration;
      if (avant && avant.empreinte === d.empreinte && JSON.stringify(avant.migrations ?? null) === JSON.stringify(d.migrations ?? null)
          && JSON.stringify(avant.horsMigration ?? null) === JSON.stringify(d.horsMigration ?? null)) continue;
      ecrireJson(file, d);
      if (avant?.empreinte !== d.empreinte && !changes.includes(d.app)) changes.push(d.app);
    }
    const { events } = changes.length ? rafraichir() : { events: [] };
    if (suivi.length) ajouterHistorique(suivi);
    const horsMigration = Object.fromEntries(declarations(lecture).map(d => {
      const f = join(DECL, `${d.app}.serveur.json`);
      return [d.app, existsSync(f) ? lireJson(f).horsMigration ?? null : null];
    }));
    const sante = calculerSante(lecture, { catalogue: lireJson(join(DATA, 'catalogue.json')), edition: chargerEdition(DATA), horsMigration });
    ecrireJson(join(DATA, 'sante.json'), sante);
    page = null;
    sonde = { ...sonde, derniere: lecture.luLe, erreur: null, declencheur, outils: Object.keys(lecture.outils), schemasModifies: changes, changements: events.length, etat: sante.etat };
    console.log(`[${lecture.luLe}] sonde (${declencheur}) : ${Object.keys(lecture.outils).join(', ') || 'aucun outil'} · ${events.length} changement(s) · état ${sante.etat}`);
  } catch (e) {
    sonde = { ...sonde, erreur: e.message, erreurLe: new Date().toISOString() };
    console.error(`sonde du serveur commun : ${e.message}`);
  } finally {
    sonde = { ...sonde, enCours: false };
    await db.end().catch(() => {});
  }
  return sonde;
}

async function deciderLien(corps, auteur) {
  if (!DB_URL) throw new Error('MATRIX_DATABASE_URL n’est pas défini : le registre des liens est sur le serveur commun.');
  if (!vuesConnues) await synchroniser('avant une décision');
  const lien = validerLien(corps ?? {}, vuesConnues);
  const db = client(DB_URL);
  try { await db.connect(); var ecrit = await ecrireLien(db, lien, auteur); } finally { await db.end().catch(() => {}); }
  // M-18 : la décision est appliquée tout de suite par matrix_gestion ; sinon par appliquer-liens.sh (15 minutes).
  ecrit.application = GESTION_URL
    ? await avecGestion(db => appliquerLien(db, lien)).catch(e => ({ applique: false, raison: e.message }))
    : { applique: false, raison: 'MATRIX_GESTION_DATABASE_URL absent : appliqué par appliquer-liens.sh dans les 15 minutes' };
  await synchroniser('décision sur un lien');
  return ecrit;
}

const lireSante = () => existsSync(join(DATA, 'sante.json')) ? lireJson(join(DATA, 'sante.json')) : null;

// ── Déclarations ─────────────────────────────────────────────────────────

function jetonValide(req) {
  const recu = String(req.headers['x-matrix-token'] ?? String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
  const a = Buffer.from(recu), b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function valider(doc) {
  if (doc?.schema !== 'matrix.schema/1') return 'schema doit valoir matrix.schema/1';
  if (!APPS.includes(doc.app)) return `outil inconnu : ${doc.app}`;
  if (!Array.isArray(doc.tables)) return 'tables doit être un tableau';
  for (const t of doc.tables) {
    if (typeof t?.name !== 'string' || !/^\w+$/.test(t.name)) return `nom de table invalide : ${t?.name}`;
    if (!Array.isArray(t.columns) || !Array.isArray(t.fks ?? []) || !Array.isArray(t.pk ?? []) || !Array.isArray(t.uniques ?? [])) return `table ${t.name} : structure incomplète`;
    for (const c of t.columns) if (typeof c?.name !== 'string' || !/^\w+$/.test(c.name)) return `table ${t.name} : nom de colonne invalide`;
  }
  return null;
}

function recevoir(doc) {
  const file = join(DECL, `${doc.app}.json`);
  if (doc.empreinte && existsSync(file) && lireJson(file).empreinte === doc.empreinte) return { app: doc.app, inchange: true, nouvellesTables: [], changements: [] };
  const tables = doc.tables.map(t => ({ name: t.name, columns: t.columns, pk: t.pk ?? [], fks: t.fks ?? [], uniques: t.uniques ?? [] }));
  ecrireJson(file, { schema: doc.schema, app: doc.app, version: doc.version ?? null, declareLe: doc.declareLe ?? new Date().toISOString(), empreinte: doc.empreinte ?? null, tables });
  const { events } = rafraichir();
  const miens = events.filter(e => e.app === doc.app);
  console.log(`[${new Date().toISOString()}] déclaration de ${doc.app} : ${tables.length} tables, ${miens.length} changement(s)`);
  return { app: doc.app, inchange: false, nouvellesTables: miens.filter(e => e.type === 'table_ajoutee').map(e => e.table), changements: miens };
}

// ── Accès ─────────────────────────────────────────────────────────────────

const egal = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

// Renvoie l'identifiant de la personne connectée, '' si l'accès est libre, ou null si l'accès est refusé.
function utilisateur(req) {
  if (!MOT_DE_PASSE) return '';
  const m = String(req.headers.authorization ?? '').match(/^Basic (.+)$/);
  if (!m) return null;
  const brut = Buffer.from(m[1], 'base64').toString('utf8');
  const i = brut.indexOf(':');
  if (i < 0 || !egal(brut.slice(i + 1), MOT_DE_PASSE)) return null;
  return brut.slice(0, i).trim() || 'administrateur';
}

function lireCorps(req, res, suite) {
  let taille = 0; const morceaux = [];
  req.on('data', m => { taille += m.length; if (taille > MAX_OCTETS) { json(res, 413, { erreur: 'requête trop volumineuse' }); req.destroy(); } else morceaux.push(m); });
  req.on('end', () => {
    if (res.writableEnded) return;
    let corps;
    try { corps = JSON.parse(Buffer.concat(morceaux).toString('utf8')); } catch { return json(res, 400, { erreur: 'JSON invalide' }); }
    suite(corps);
  });
}

// ── HTTP ─────────────────────────────────────────────────────────────────

const require = createRequire(import.meta.url);
let cytoscape = null;
try { cytoscape = readFileSync(require.resolve('cytoscape/dist/cytoscape.min.js')); } catch { console.warn('cytoscape introuvable : lancez npm install (le graphe ne s’affichera pas).'); }

const ENTETES = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'SAMEORIGIN' };
const json = (res, code, corps) => { res.writeHead(code, { ...ENTETES, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(corps)); };

const demarrage = rafraichir();

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const libre = url.pathname === '/api/sante' || (req.method === 'POST' && url.pathname === '/api/declarations');
    const qui = libre ? '' : utilisateur(req);
    if (qui === null) {
      res.writeHead(401, { ...ENTETES, 'www-authenticate': 'Basic realm="Matrix", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Accès réservé : identifiez-vous avec le mot de passe de Matrix.');
    }
    if (req.method === 'GET' && url.pathname === '/api/edition') return json(res, 200, chargerEdition(DATA));
    const ref = url.pathname.match(/^\/api\/referentiels\/(sites|organigramme|pays|zones|filiales)$/);
    if (req.method === 'GET' && ref) return json(res, 200, chargerEdition(DATA).referentiels[ref[1]].filter(x => x.actif !== false || url.searchParams.get('tous') === '1'));
    if (req.method === 'GET' && url.pathname === '/api/etat') return json(res, 200, { sonde, referentiels, edition, sante: lireSante() });
    if (req.method === 'GET' && url.pathname === '/api/liens') {
      const s = lireSante();
      return json(res, 200, { sonde, liens: s?.liens ?? [], journal: s?.journalLiens ?? [], etats: s?.etatsLien ?? {} });
    }
    // Catalogue en lecture et exports (E-12) : structure seulement, jamais de données des tables.
    if (req.method === 'GET' && (url.pathname.startsWith('/api/catalogue/') || url.pathname.startsWith('/api/export/'))) {
      const q = Object.fromEntries(url.searchParams);
      if (q.outil && !APPS.includes(q.outil)) return json(res, 404, { erreur: `outil inconnu : ${q.outil}` });
      const sante = lireSante();
      let liste = fichesCatalogue(lireJson(join(DATA, 'catalogue.json')), { edition: chargerEdition(DATA), sante, outil: q.outil || null });
      if (q.domaine) liste = liste.filter(f => f.domaine === q.domaine);
      if (q.q) {
        // Mêmes fiches que la recherche de la page (maquette/source.html, ficheRecherche) : flux et lectures compris.
        const flux = lireJson(join(EMBARQUE, 'flux.json')).flux ?? [];
        const fluxDe = f => flux.filter(x => (x.de === f.outil && x.source.includes(f.table)) || (x.vers === f.outil && x.cible.includes(f.table))).map(x => `${x.id} ${x.nom}`);
        const lectures = new Map((sante?.tables ?? []).map(s => [`${s.app}.${s.table}`, (s.stats?.lecturesSequentielles || 0) + (s.stats?.lecturesIndex || 0)]));
        const ordre = chercher(liste.map(f => ({ cle: f.cle, nom: f.table, domaine: f.domaine, description: f.description, documentation: { description: f.description, note: f.note, responsable: f.responsable },
          colonnes: f.colonnes.map(c => ({ nom: c.nom, description: c.description })), flux: fluxDe(f), lectures: lectures.get(f.cle) ?? 0 })), q.q);
        const par = new Map(liste.map(f => [f.cle, f]));
        liste = ordre.map(r => ({ ...par.get(r.cle), pertinence: r.score, trouvee_par: r.raisons }));
      }
      const fiche = url.pathname.match(/^\/api\/catalogue\/tables\/(\w+)\/(\w+)$/);
      if (fiche) {
        const f = liste.find(x => x.outil === fiche[1] && x.table === fiche[2]);
        if (!f) return json(res, 404, { erreur: 'table inconnue' });
        const s = sante?.tables?.find(t => t.app === f.outil && t.table === f.table);
        return json(res, 200, { ...f, sante: s ? { etat: s.etat, constats: s.constats, stats: s.stats } : null });
      }
      const nomFichier = n => `matrix-${q.outil || 'tous-les-outils'}${q.domaine ? '-' + q.domaine.normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase() : ''}-${n}`;
      const fichier = (type, nom, corps) => { res.writeHead(200, { ...ENTETES, 'content-type': type, 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${nomFichier(nom)}"` }); res.end(corps); };
      if (url.pathname === '/api/catalogue/tables')
        return json(res, 200, liste.map(({ colonnes, liens, publiee_par, unicites, ...f }) => ({ ...f, colonnes: colonnes.length, liens: liens.length, publiee_par: publiee_par.map(v => v.vue) })));
      if (url.pathname === '/api/export/tables.csv') return fichier('text/csv; charset=utf-8', 'tables.csv', csvTables(liste));
      if (url.pathname === '/api/export/colonnes.csv') return fichier('text/csv; charset=utf-8', 'colonnes.csv', csvColonnes(liste));
      if (url.pathname === '/api/export/schema.mmd') return fichier('text/plain; charset=utf-8', 'schema.mmd', diagrammeMermaid(liste));
      if (url.pathname === '/api/export/dictionnaire.html') {
        res.writeHead(200, { ...ENTETES, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(dictionnaireHtml(liste, { titre: `Dictionnaire des données${q.outil ? ' · ' + q.outil : ''}${q.domaine ? ' · ' + q.domaine : ''}` }));
      }
      return json(res, 404, { erreur: 'introuvable' });
    }
    // Publications (M-18) : lecture du registre en matrix_app.
    const publication = url.pathname.match(/^\/api\/publications(?:\/([a-z]+\.pub_[a-z0-9_]+))?(?:\/(appliquer|retirer))?$/);
    if (req.method === 'GET' && publication && !publication[2]) {
      if (!DB_URL) return json(res, 409, { erreur: 'MATRIX_DATABASE_URL n’est pas défini : les publications sont sur le serveur commun.' });
      const lire = publication[1] ? db => lirePublication(db, publication[1]) : db => listerPublications(db);
      avecServeur(lire).then(r => r ? json(res, 200, { gestion: Boolean(GESTION_URL), ...(publication[1] ? { publication: r } : r) }) : json(res, 404, { erreur: 'publication inconnue' }),
        e => json(res, e.code ? 502 : 422, { erreur: e.message }));
      return;
    }
    const consultation = url.pathname.match(/^\/api\/(journal|rex|correspondances)$/);
    if (req.method === 'GET' && consultation) {
      if (!DB_URL) return json(res, 409, { erreur: 'MATRIX_DATABASE_URL n’est pas défini : le journal, le REX et les correspondances sont sur le serveur commun.' });
      const q = Object.fromEntries(url.searchParams);
      const lire = { journal: db => lireJournal(db, { ...q, apres: q.apres_quand ? { quand: q.apres_quand, ref_source: q.apres_ref } : null }), rex: db => lireRex(db, q), correspondances: db => lireCorrespondances(db, q) }[consultation[1]];
      avecServeur(lire).then(r => json(res, 200, r), e => json(res, /date|outil|pagination/.test(e.message) && !e.code ? 422 : 502, { erreur: e.message }));
      return;
    }
    const ecriture = (req.method === 'PUT' && (ref || url.pathname === '/api/documentation' || url.pathname === '/api/decisions' || (publication?.[1] && !publication[2])))
      || (req.method === 'POST' && (url.pathname === '/api/liens' || url.pathname === '/api/synchro' || url.pathname === '/api/correspondances' || publication?.[2]));
    if (ecriture) {
      if (PRODUCTION && !MOT_DE_PASSE) return json(res, 403, { erreur: 'Définissez MATRIX_MOT_DE_PASSE sur le serveur pour autoriser les modifications.' });
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { erreur: 'contenu JSON attendu' });
      const origine = req.headers.origin;
      if (origine && new URL(origine).host !== req.headers.host) return json(res, 403, { erreur: 'origine refusée' });
      const auteur = qui || 'anonyme';
      if (publication?.[1]) return lireCorps(req, res, async corps => {
        try {
          if (!DB_URL) return json(res, 409, { erreur: 'MATRIX_DATABASE_URL n’est pas défini : les publications sont sur le serveur commun.' });
          const vue = publication[1];
          if (req.method === 'PUT') return json(res, 200, { ok: true, publication: await avecServeur(db => enregistrerPublication(db, { ...(corps ?? {}), vue }, auteur)) });
          if (!GESTION_URL) return json(res, 409, { erreur: 'MATRIX_GESTION_DATABASE_URL n’est pas défini : Matrix ne peut pas appliquer les publications (rôle matrix_gestion).' });
          const r = publication[2] === 'appliquer'
            ? await avecGestion(db => appliquerPublication(db, vue, auteur))
            : await avecGestion(db => retirerPublication(db, vue, auteur, corps?.motif));
          await synchroniser(`publication ${vue}`);
          json(res, 200, { ok: true, resultat: r });
        } catch (e) { json(res, 422, { erreur: e.message }); }
      });
      if (req.method === 'POST') return lireCorps(req, res, async corps => {
        try {
          if (url.pathname === '/api/synchro') {
            if (!DB_URL) return json(res, 409, { erreur: 'MATRIX_DATABASE_URL n’est pas défini : pas de serveur commun à lire.' });
            const r = await synchroniser(`demandée par ${auteur}`);
            return json(res, r.erreur ? 502 : 200, { sonde: r, sante: lireSante() });
          }
          if (url.pathname === '/api/correspondances') {
            if (!DB_URL) return json(res, 409, { erreur: 'MATRIX_DATABASE_URL n’est pas défini : les correspondances sont sur le serveur commun.' });
            return json(res, 200, { ok: true, correspondance: await avecServeur(db => deciderCorrespondance(db, corps ?? {}, auteur)) });
          }
          const lien = await deciderLien(corps, auteur);
          json(res, 200, { ok: true, lien, sonde, liens: lireSante()?.liens ?? [] });
        } catch (e) { json(res, 422, { erreur: e.message }); }
      });
      return lireCorps(req, res, async corps => {
        try {
          let r;
          if (ref) r = await ecrireReferentiel(ref[1], corps, auteur);
          else if (url.pathname === '/api/documentation') r = await ecrireSaisie('documentation', corps ?? {}, auteur);
          else r = await ecrireSaisie('decision', corps ?? {}, auteur);
          page = null;
          json(res, 200, { ok: true, resultat: r, edition: chargerEdition(DATA) });
        } catch (e) { json(res, e.code === 'conflit' ? 409 : 422, { erreur: e.message, ...(e.code === 'conflit' ? { actuel: e.actuel } : {}) }); }
      });
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { ...ENTETES, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(pageCourante());
    }
    if (req.method === 'GET' && url.pathname === '/vendor/cytoscape.min.js' && cytoscape) {
      res.writeHead(200, { ...ENTETES, 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=604800, immutable' });
      return res.end(cytoscape);
    }
    if (req.method === 'GET' && url.pathname === '/api/sante') {
      const c = lireJson(join(DATA, 'catalogue.json'));
      return json(res, 200, { ok: true, tables: c.apps.reduce((n, a) => n + a.tables.length, 0), collecteLe: c.generatedAt, declarations: TOKEN ? 'actives' : 'désactivées (MATRIX_TOKEN absent)',
        sonde: DB_URL ? { derniere: sonde.derniere, erreur: sonde.erreur, etat: sonde.etat } : 'désactivée (MATRIX_DATABASE_URL absent)',
        saisies: edition.actif ? 'serveur commun (matrix.documentation, decisions_doublons, journal)' : `edition.json${edition.erreur ? ` (${edition.erreur})` : ''}`,
        referentiels: DB_URL ? { alignesLe: referentiels.alignesLe, ecarts: Object.keys(referentiels.ecarts).filter(l => referentiels.ecarts[l]), erreur: referentiels.erreur } : 'dans edition.json (MATRIX_DATABASE_URL absent)' });
    }
    if (req.method === 'GET' && url.pathname === '/api/catalogue') return json(res, 200, lireJson(join(DATA, 'catalogue.json')));
    if (req.method === 'GET' && url.pathname === '/api/declarations') {
      // Par outil, la lecture du serveur et la déclaration de l'outil, quand elles existent.
      return json(res, 200, APPS.flatMap(a => [`${a}.serveur.json`, `${a}.json`].filter(f => existsSync(join(DECL, f))).map(f => {
        const d = lireJson(join(DECL, f));
        return { app: a, origine: d.origine ?? 'outil', declareLe: d.declareLe, version: d.version, empreinte: d.empreinte, tables: d.tables.length };
      })));
    }
    if (req.method === 'POST' && url.pathname === '/api/declarations') {
      if (!TOKEN) return json(res, 503, { erreur: 'MATRIX_TOKEN n’est pas défini sur le serveur Matrix : les déclarations sont désactivées.' });
      if (!jetonValide(req)) return json(res, 401, { erreur: 'jeton manquant ou invalide' });
      let taille = 0; const morceaux = [];
      req.on('data', m => { taille += m.length; if (taille > MAX_OCTETS) { json(res, 413, { erreur: 'déclaration trop volumineuse' }); req.destroy(); } else morceaux.push(m); });
      req.on('end', () => {
        if (res.writableEnded) return;
        let doc;
        try { doc = JSON.parse(Buffer.concat(morceaux).toString('utf8')); } catch { return json(res, 400, { erreur: 'JSON invalide' }); }
        const erreur = valider(doc);
        if (erreur) return json(res, 422, { erreur });
        try { json(res, 200, recevoir(doc)); } catch (e) { console.error(e); json(res, 500, { erreur: 'échec de l’enregistrement de la déclaration' }); }
      });
      return;
    }
    json(res, 404, { erreur: 'introuvable' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { erreur: 'erreur interne' });
  }
}).listen(PORT, '0.0.0.0', () => {
  const { catalogue, events } = demarrage;
  const n = catalogue.apps.reduce((s, a) => s + a.tables.length, 0);
  console.log(`Matrix écoute sur le port ${PORT} · ${n} tables · données dans ${DATA}${events.length ? ` · ${events.length} changement(s) depuis la dernière collecte` : ''}`);
  if (!TOKEN) console.warn('MATRIX_TOKEN absent : les outils ne peuvent pas déclarer leurs tables.');
  if (DB_URL) {
    setTimeout(() => synchroniser('démarrage'), 1000).unref();
    if (SYNCHRO_MINUTES) setInterval(() => synchroniser('planifiée'), SYNCHRO_MINUTES * 60000).unref();
  } else console.warn('MATRIX_DATABASE_URL absent : la sonde du serveur commun est désactivée.');
});
