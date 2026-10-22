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
//   PUT  /api/referentiels/:nom remplacer un référentiel  [ … lignes … ]  (sites, organigramme, pays)
//   GET  /api/referentiels/:nom un référentiel publié (lu par les outils)
//
// Variables d'environnement :
//   PORT               port d'écoute (défaut 3000)
//   MATRIX_DATA_DIR    dossier des données vivantes : catalogue, historique, déclarations (défaut ./data ;
//                      /data dans l'image Docker, à monter sur un volume persistant)
//   MATRIX_TOKEN       jeton partagé avec les outils ; sans lui, les déclarations sont refusées (503)
//   MATRIX_SOURCES_DIR dossier contenant les dépôts keystone/, codex/, cursus/, vigie/, arche/ (facultatif)
//   MATRIX_MOT_DE_PASSE mot de passe d'accès à Matrix (identifiant libre, authentification HTTP Basic). Sans lui,
//                      la consultation reste ouverte et, en production, les modifications sont refusées.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { timingSafeEqual } from 'node:crypto';
import { collect } from './outils/collecteur.mjs';
import { construirePage, RACINE } from './outils/page.mjs';
import { chargerEdition, documenter, decider, enregistrerReferentiel } from './outils/edition.mjs';

const PORT = +(process.env.PORT ?? 3000);
const DATA = process.env.MATRIX_DATA_DIR ?? join(RACINE, 'data');
const DECL = join(DATA, 'declarations');
const SOURCES = process.env.MATRIX_SOURCES_DIR ?? null;
const TOKEN = process.env.MATRIX_TOKEN ?? '';
const MOT_DE_PASSE = process.env.MATRIX_MOT_DE_PASSE ?? '';
const PRODUCTION = process.env.NODE_ENV === 'production';
const APPS = ['keystone', 'codex', 'cursus', 'vigie', 'arche'];
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
const pageCourante = () => (page ??= construirePage({ forme: 'document', dataDir: DATA }));

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
    const ref = url.pathname.match(/^\/api\/referentiels\/(sites|organigramme|pays)$/);
    if (req.method === 'GET' && ref) return json(res, 200, chargerEdition(DATA).referentiels[ref[1]].filter(x => x.actif !== false || url.searchParams.get('tous') === '1'));
    if (req.method === 'PUT' && (ref || url.pathname === '/api/documentation' || url.pathname === '/api/decisions')) {
      if (PRODUCTION && !MOT_DE_PASSE) return json(res, 403, { erreur: 'Définissez MATRIX_MOT_DE_PASSE sur le serveur pour autoriser les modifications.' });
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { erreur: 'contenu JSON attendu' });
      const origine = req.headers.origin;
      if (origine && new URL(origine).host !== req.headers.host) return json(res, 403, { erreur: 'origine refusée' });
      const auteur = qui || 'anonyme';
      return lireCorps(req, res, corps => {
        try {
          let r;
          if (ref) r = enregistrerReferentiel(DATA, ref[1], corps, auteur);
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
      return json(res, 200, { ok: true, tables: c.apps.reduce((n, a) => n + a.tables.length, 0), collecteLe: c.generatedAt, declarations: TOKEN ? 'actives' : 'désactivées (MATRIX_TOKEN absent)' });
    }
    if (req.method === 'GET' && url.pathname === '/api/catalogue') return json(res, 200, lireJson(join(DATA, 'catalogue.json')));
    if (req.method === 'GET' && url.pathname === '/api/declarations') {
      return json(res, 200, APPS.filter(a => existsSync(join(DECL, `${a}.json`))).map(a => {
        const d = lireJson(join(DECL, `${a}.json`));
        return { app: a, declareLe: d.declareLe, version: d.version, empreinte: d.empreinte, tables: d.tables.length };
      }));
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
});
