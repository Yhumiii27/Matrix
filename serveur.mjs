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
import { chargerEdition, documenter, decider, enregistrerReferentiel, preparerReferentiel, appliquerReferentiel, referentielsSaisis, adopterReferentiels } from './outils/edition.mjs';
import { LISTES, lireReferentiels, comparer, ecrireReferentiels } from './outils/referentiels-pg.mjs';
import { lireJournal, lireRex, lireCorrespondances, deciderCorrespondance } from './outils/consultation.mjs';
import { client, lireServeur, declarations, validerLien, ecrireLien } from './outils/sonde.mjs';
import { calculerSante } from './outils/sante.mjs';

const PORT = +(process.env.PORT ?? 3000);
const DATA = process.env.MATRIX_DATA_DIR ?? join(RACINE, 'data');
const DECL = join(DATA, 'declarations');
const SOURCES = process.env.MATRIX_SOURCES_DIR ?? null;
const TOKEN = process.env.MATRIX_TOKEN ?? '';
const MOT_DE_PASSE = process.env.MATRIX_MOT_DE_PASSE ?? '';
const PRODUCTION = process.env.NODE_ENV === 'production';
const DB_URL = process.env.MATRIX_DATABASE_URL ?? '';
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

let page = null;
const pageCourante = () => (page ??= construirePage({ forme: 'document', dataDir: DATA, serveurCommun: Boolean(DB_URL) }));

// ── Référentiels sur le serveur commun (E-01) ─────────────────────────────

// Une écriture de référentiel à la fois : valider, écrire sur le serveur, puis enregistrer edition.json, sans qu'une
// autre écriture ne s'intercale entre ces étapes.
let fileReferentiels = Promise.resolve();
const enSerie = tache => { const p = fileReferentiels.then(tache); fileReferentiels = p.catch(() => {}); return p; };

async function avecServeur(tache) {
  const db = client(DB_URL);
  try { await db.connect(); return await tache(db); } finally { await db.end().catch(() => {}); }
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
        adopterReferentiels(DATA, aReprendre, 'serveur commun');
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
    await alignerReferentiels(db, declencheur === 'démarrage');
    const references = lireJson(join(RACINE, 'data', 'references.json')).references;
    const lecture = await lireServeur(db, { references });
    vuesConnues = new Set(lecture.vues.map(v => v.vue));
    const changes = [];
    mkdirSync(DECL, { recursive: true });
    // Lecture du serveur : declarations/<outil>.serveur.json, à côté de la déclaration envoyée par l'outil
    // (<outil>.json) ; le collecteur fait passer le serveur en premier (E-14). Une ancienne lecture du serveur écrite
    // dans <outil>.json (avant le 31/10/2026) est déplacée.
    for (const d of declarations(lecture)) {
      const file = join(DECL, `${d.app}.serveur.json`), ancien = join(DECL, `${d.app}.json`);
      if (existsSync(ancien) && lireJson(ancien).origine === 'serveur') { unlinkSync(ancien); changes.push(d.app); }
      if (existsSync(file) && lireJson(file).empreinte === d.empreinte) continue;
      ecrireJson(file, d);
      if (!changes.includes(d.app)) changes.push(d.app);
    }
    const { events } = changes.length ? rafraichir() : { events: [] };
    const sante = calculerSante(lecture, { catalogue: lireJson(join(DATA, 'catalogue.json')), edition: chargerEdition(DATA) });
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
    if (req.method === 'GET' && url.pathname === '/api/etat') return json(res, 200, { sonde, referentiels, sante: lireSante() });
    if (req.method === 'GET' && url.pathname === '/api/liens') {
      const s = lireSante();
      return json(res, 200, { sonde, liens: s?.liens ?? [], journal: s?.journalLiens ?? [], etats: s?.etatsLien ?? {} });
    }
    const consultation = url.pathname.match(/^\/api\/(journal|rex|correspondances)$/);
    if (req.method === 'GET' && consultation) {
      if (!DB_URL) return json(res, 409, { erreur: 'MATRIX_DATABASE_URL n’est pas défini : le journal, le REX et les correspondances sont sur le serveur commun.' });
      const q = Object.fromEntries(url.searchParams);
      const lire = { journal: db => lireJournal(db, { ...q, apres: q.apres_quand ? { quand: q.apres_quand, ref_source: q.apres_ref } : null }), rex: db => lireRex(db, q), correspondances: db => lireCorrespondances(db, q) }[consultation[1]];
      avecServeur(lire).then(r => json(res, 200, r), e => json(res, /date|outil|pagination/.test(e.message) && !e.code ? 422 : 502, { erreur: e.message }));
      return;
    }
    const ecriture = (req.method === 'PUT' && (ref || url.pathname === '/api/documentation' || url.pathname === '/api/decisions'))
      || (req.method === 'POST' && (url.pathname === '/api/liens' || url.pathname === '/api/synchro' || url.pathname === '/api/correspondances'));
    if (ecriture) {
      if (PRODUCTION && !MOT_DE_PASSE) return json(res, 403, { erreur: 'Définissez MATRIX_MOT_DE_PASSE sur le serveur pour autoriser les modifications.' });
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { erreur: 'contenu JSON attendu' });
      const origine = req.headers.origin;
      if (origine && new URL(origine).host !== req.headers.host) return json(res, 403, { erreur: 'origine refusée' });
      const auteur = qui || 'anonyme';
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
          else if (url.pathname === '/api/documentation') r = documenter(DATA, lireJson(join(DATA, 'catalogue.json')), corps ?? {}, auteur);
          else r = decider(DATA, corps ?? {}, auteur);
          page = null;
          json(res, 200, { ok: true, resultat: r, edition: chargerEdition(DATA) });
        } catch (e) { json(res, 422, { erreur: e.message }); }
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
