// Point de réception des déclarations de schéma : POST /api/declarations (contrat matrix.schema/1).
//
// Chaque outil appelle ce point juste après ses migrations (integration/declarer-schema.mjs).
// La déclaration est enregistrée dans declarations/<outil>.json, puis le collecteur relance la comparaison :
// une table qui n'existait pas encore est ajoutée à la bibliothèque, marquée « à documenter ».
//
// Usage : MATRIX_TOKEN=… node outils/serveur-declarations.mjs   (port MATRIX_PORT, défaut 3300)
// Ce serveur minimal tient en attendant l'application Matrix ; il sera remplacé par sa route d'API.

import { createServer } from 'node:http';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { collect } from './collecteur.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MATRIX_SOURCES_DIR ?? join(here, '..', '..');
const DATA = process.env.MATRIX_DATA_DIR ?? join(here, '..', 'data');
const DECL = process.env.MATRIX_DECLARATIONS_DIR ?? join(here, '..', 'declarations');
const TOKEN = process.env.MATRIX_TOKEN ?? '';
const PORT = +(process.env.MATRIX_PORT ?? 3300);
const APPS = ['keystone', 'codex', 'cursus', 'vigie'];
const MAX = 5 * 1024 * 1024;

const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const authorized = req => {
  if (!TOKEN) return true;
  const got = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
  const want = Buffer.from(TOKEN);
  return got.length === want.length && timingSafeEqual(got, want);
};

function validate(doc) {
  if (doc?.schema !== 'matrix.schema/1') return 'schema doit valoir matrix.schema/1';
  if (!APPS.includes(doc.app)) return `app inconnue : ${doc.app}`;
  if (!Array.isArray(doc.tables)) return 'tables doit être un tableau';
  for (const t of doc.tables) {
    if (typeof t.name !== 'string' || !/^\w+$/.test(t.name)) return `nom de table invalide : ${t.name}`;
    if (!Array.isArray(t.columns) || !Array.isArray(t.fks ?? []) ) return `table ${t.name} : columns manquant`;
  }
  return null;
}

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/api/declarations') {
    const out = APPS.filter(a => existsSync(join(DECL, `${a}.json`))).map(a => {
      const d = JSON.parse(readFileSync(join(DECL, `${a}.json`), 'utf8'));
      return { app: a, declareLe: d.declareLe, empreinte: d.empreinte, tables: d.tables.length };
    });
    return send(res, 200, out);
  }
  if (req.method !== 'POST' || req.url !== '/api/declarations') return send(res, 404, { erreur: 'introuvable' });
  if (!authorized(req)) return send(res, 401, { erreur: 'jeton manquant ou invalide' });
  let size = 0; const chunks = [];
  req.on('data', c => { size += c.length; if (size > MAX) { req.destroy(); } else chunks.push(c); });
  req.on('end', () => {
    let doc;
    try { doc = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { erreur: 'JSON invalide' }); }
    const err = validate(doc);
    if (err) return send(res, 422, { erreur: err });
    const file = join(DECL, `${doc.app}.json`);
    if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).empreinte === doc.empreinte && doc.empreinte)
      return send(res, 200, { app: doc.app, inchange: true, nouvellesTables: [] });
    mkdirSync(DECL, { recursive: true });
    writeFileSync(file, JSON.stringify(doc, null, 1));
    const { catalogue, events } = collect({ root: ROOT, dataDir: DATA, declDir: DECL });
    writeFileSync(join(DATA, 'catalogue.json'), JSON.stringify(catalogue, null, 1));
    const histFile = join(DATA, 'historique.json');
    const hist = existsSync(histFile) ? JSON.parse(readFileSync(histFile, 'utf8')) : { evenements: [] };
    hist.evenements.push(...events);
    writeFileSync(histFile, JSON.stringify(hist, null, 1));
    const mine = events.filter(e => e.app === doc.app);
    console.log(`[${new Date().toISOString()}] ${doc.app} : ${doc.tables.length} tables, ${mine.length} changement(s)`);
    send(res, 200, {
      app: doc.app, inchange: false,
      nouvellesTables: mine.filter(e => e.type === 'table_ajoutee').map(e => e.table),
      changements: mine,
    });
  });
}).listen(PORT, () => console.log(`Matrix reçoit les déclarations sur http://localhost:${PORT}/api/declarations`));
