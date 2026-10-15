// Assemble la maquette autonome : maquette/source.html + data/*.json → maquette/matrix.html (forme « fragment »,
// publiée comme artefact). La page complète servie en production est construite à la volée par serveur.mjs.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { construirePage, RACINE } from './page.mjs';

const html = construirePage({ forme: 'fragment' });
writeFileSync(join(RACINE, 'maquette/matrix.html'), html);
console.log(`maquette/matrix.html · ${(html.length / 1024).toFixed(0)} Ko`);
