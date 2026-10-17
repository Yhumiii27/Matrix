// Construit la page de Matrix à partir de maquette/source.html et des données.
//
// Deux formes :
//   - 'fragment' : sans <!doctype>, <html> ni <head> (publication comme artefact, maquette/matrix.html) ;
//   - 'document' : page complète servie par serveur.mjs, avec la bibliothèque de graphe servie localement
//     (/vendor/cytoscape.min.js) au lieu du CDN.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { chargerEdition } from './edition.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const CDN_CYTOSCAPE = 'https://cdn.jsdelivr.net/npm/cytoscape@3.33.1/dist/cytoscape.min.js';

const lire = f => JSON.parse(readFileSync(f, 'utf8'));

/** Rassemble les données de la page. Le catalogue et l'historique viennent de dataDir ; le reste du dépôt. */
export function donnees({ dataDir = join(RACINE, 'data'), serveur = false } = {}) {
  const connaissance = join(RACINE, 'data');
  const historique = join(dataDir, 'historique.json');
  const edition = chargerEdition(dataDir);
  const declDir = join(dataDir, 'declarations');
  const declarations = existsSync(declDir) ? readdirSync(declDir).filter(f => f.endsWith('.json')).map(f => {
    const d = lire(join(declDir, f));
    return { app: d.app, declareLe: d.declareLe, version: d.version, tables: d.tables.length };
  }) : [];
  return {
    serveur,
    edition: { ...edition, journal: edition.journal.slice(-300) },
    declarations,
    catalogue: lire(join(dataDir, 'catalogue.json')),
    flux: lire(join(connaissance, 'flux.json')),
    usages: lire(join(connaissance, 'usages.json')),
    doublons: lire(join(connaissance, 'doublons.json')),
    historique: existsSync(historique) ? lire(historique) : { evenements: [] },
  };
}

export function construirePage({ forme = 'fragment', dataDir } = {}) {
  const json = JSON.stringify(donnees({ dataDir, serveur: forme === 'document' })).replace(/</g, '\\u003c');
  const source = readFileSync(join(RACINE, 'maquette/source.html'), 'utf8').replace('/*DONNEES*/', () => json);
  if (forme === 'fragment') return source;
  const fin = source.indexOf('</style>') + '</style>'.length;
  const tete = source.slice(0, fin);
  const corps = source.slice(fin).replace(CDN_CYTOSCAPE, '/vendor/cytoscape.min.js');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${tete}
</head>
<body>
${corps}
</body>
</html>
`;
}
