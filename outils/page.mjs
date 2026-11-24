// Construit la page de Matrix à partir de maquette/source.html et des données.
//
// Deux formes :
//   - 'fragment' : sans <!doctype>, <html> ni <head> (publication comme artefact, maquette/matrix.html) ;
//   - 'document' : page complète servie par serveur.mjs, avec la bibliothèque de graphe servie localement
//     (/vendor/cytoscape.min.js) au lieu du CDN.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { chargerEdition } from './edition.mjs';
import { fluxObserves } from './lignage.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const CDN_CYTOSCAPE = 'https://cdn.jsdelivr.net/npm/cytoscape@3.33.1/dist/cytoscape.min.js';

// Inter (fichiers de norma/charte/fonts/inter, servis par serveur.mjs) : sous-ensembles latin et latin étendu, plage
// unicode de Google Fonts, graisse variable 100–900.
const POLICES = `
<style>
@font-face { font-family: "Inter"; font-style: normal; font-weight: 100 900; font-display: swap; src: url(/fonts/inter-latin-wght.woff2) format("woff2"); unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
@font-face { font-family: "Inter"; font-style: normal; font-weight: 100 900; font-display: swap; src: url(/fonts/inter-latin-ext-wght.woff2) format("woff2"); unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF; }
</style>`;

const lire = f => JSON.parse(readFileSync(f, 'utf8'));

/** Rassemble les données de la page. Le catalogue et l'historique viennent de dataDir ; le reste du dépôt. */
export function donnees({ dataDir = join(RACINE, 'data'), serveur = false, serveurCommun = false } = {}) {
  const connaissance = join(RACINE, 'data');
  const historique = join(dataDir, 'historique.json');
  const edition = chargerEdition(dataDir);
  const declDir = join(dataDir, 'declarations');
  const declarations = existsSync(declDir) ? readdirSync(declDir).filter(f => f.endsWith('.json')).map(f => {
    const d = lire(join(declDir, f));
    return { app: d.app, origine: d.origine ?? 'outil', declareLe: d.declareLe, version: d.version, tables: d.tables.length };
  }) : [];
  const sante = existsSync(join(dataDir, 'sante.json')) ? lire(join(dataDir, 'sante.json')) : null;
  const flux = lire(join(connaissance, 'flux.json'));
  return {
    serveur,
    // Référentiels écrits dans le schéma matrix du serveur commun (MATRIX_DATABASE_URL, outils/referentiels-pg.mjs).
    serveurCommun,
    edition: { ...edition, journal: edition.journal.slice(-300) },
    declarations,
    catalogue: lire(join(dataDir, 'catalogue.json')),
    flux,
    usages: lire(join(connaissance, 'usages.json')),
    doublons: lire(join(connaissance, 'doublons.json')),
    historique: existsSync(historique) ? lire(historique) : { evenements: [] },
    // État de santé des tables et des liens : écrit par la sonde du serveur commun (serveur.mjs, MATRIX_DATABASE_URL).
    sante,
    // Flux observés sur le serveur (liens appliqués et lignage des vues pub_), rapprochés des flux saisis (E-07).
    lignage: sante ? fluxObserves({ vues: sante.vues, liens: sante.liens, flux: flux.flux }) : null,
  };
}

export function construirePage({ forme = 'fragment', dataDir, serveurCommun = false } = {}) {
  const json = JSON.stringify(donnees({ dataDir, serveur: forme === 'document', serveurCommun })).replace(/</g, '\\u003c');
  // Recherche plein texte (E-13) : outils/recherche.mjs recopié tel quel dans la page, sans ses « export ».
  const recherche = readFileSync(join(RACINE, 'outils/recherche.mjs'), 'utf8').replace(/^export /gm, '');
  const source = readFileSync(join(RACINE, 'maquette/source.html'), 'utf8').replace('/*DONNEES*/', () => json).replace('/*RECHERCHE*/', () => recherche);
  if (forme === 'fragment') return source;
  const fin = source.indexOf('</style>') + '</style>'.length;
  const tete = source.slice(0, fin);
  const corps = source.slice(fin).replace(CDN_CYTOSCAPE, '/vendor/cytoscape.min.js');
  // Servie par Matrix : Inter depuis la copie de Norma (norma/charte/fonts, /fonts/…), sans Google Fonts (REGLES § 7 et
  // § 9 : rien ne sort du serveur interne). La publication comme artefact (fragment) garde les liens de Google Fonts.
  const teteServie = tete.replace(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts\.[^"]*"[^>]*>\n?/g, '') + POLICES;
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${teteServie}
</head>
<body>
${corps}
</body>
</html>
`;
}
