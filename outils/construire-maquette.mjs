// Assemble la maquette autonome : maquette/source.html + data/*.json → maquette/matrix.html
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(root, p), 'utf8');
const data = {
  catalogue: JSON.parse(read('data/catalogue.json')),
  flux: JSON.parse(read('data/flux.json')),
  usages: JSON.parse(read('data/usages.json')),
  doublons: JSON.parse(read('data/doublons.json')),
  historique: existsSync(join(root, 'data/historique.json')) ? JSON.parse(read('data/historique.json')) : { evenements: [] },
};
const json = JSON.stringify(data).replace(/</g, '\\u003c');
const html = read('maquette/source.html').replace('/*DONNEES*/', () => json);
writeFileSync(join(root, 'maquette/matrix.html'), html);
console.log(`maquette/matrix.html · ${(html.length / 1024).toFixed(0)} Ko`);
