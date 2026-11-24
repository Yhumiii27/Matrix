// Outils de la suite EPC2I, d'après le registre de Norma (norma/registre/outils.json, copie contrôlée par
// npm run norma:check) : la seule source des listes d'outils de Matrix. Un outil ajouté au registre (Clavis, Modulus…)
// entre dans ces listes à la reprise de la copie de Norma, sans liste à recopier dans chaque module.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'norma', 'registre', 'outils.json'), 'utf8')).outils;

// Ordre de Matrix : les six premiers outils comme depuis l'origine (catalogue, graphe), puis les suivants du registre.
const ORDRE = ['keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible'];
const rang = c => (ORDRE.includes(c) ? ORDRE.indexOf(c) : ORDRE.length + REGISTRE.findIndex(o => o.code === c));

/** Tous les outils du registre : { code, nom, schema, role_pg, … }, dans l'ordre de Matrix. */
export const OUTILS_REGISTRE = [...REGISTRE].sort((a, b) => rang(a.code) - rang(b.code));
/** Codes de tous les outils (Matrix compris). */
export const TOUS_LES_OUTILS = OUTILS_REGISTRE.map(o => o.code);
/** Codes des outils autres que Matrix : ceux dont Matrix décrit, publie et documente les données. */
export const AUTRES_OUTILS = TOUS_LES_OUTILS.filter(c => c !== 'matrix');
/** Nom affiché de chaque outil. */
export const NOMS_OUTILS = Object.fromEntries(OUTILS_REGISTRE.map(o => [o.code, o.nom]));
