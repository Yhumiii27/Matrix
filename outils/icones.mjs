// Icônes de la page : Phosphor (charte Nocturne, Norma § 7), tirées de la dépendance autorisée @phosphor-icons/web
// (norma/dependances.json), jamais d'un CDN. Le paquet fournit le tracé de chaque glyphe (selection.json, grille de
// 1024) : la page n'embarque que les icônes qu'elle nomme, en SVG, dans la page servie comme dans la maquette publiée.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Nom d'icône de la page → nom Phosphor (graisse regular). */
export const ICONES = {
  home: 'house',
  search: 'magnifying-glass',
  db: 'database',
  table: 'table',
  graph: 'graph',
  flux: 'arrows-left-right',
  ref: 'link',
  pulse: 'pulse',
  shield: 'shield-check',
  matrix: 'squares-four',
  close: 'x',
  chevronRight: 'caret-right',
  chevronDown: 'caret-down',
  key: 'key',
  link: 'arrow-square-out',
  eye: 'eye',
  lock: 'lock',
  tick: 'check',
  dash: 'minus',
  fit: 'corners-out',
  copy: 'copy',
  refresh: 'arrow-clockwise',
  pen: 'pencil-simple',
  list: 'list',
  plus: 'plus',
  moon: 'moon',
  sun: 'sun',
  calendar: 'calendar-blank',
};

let cache = null;

/** Tracés des icônes de la page : { nom: { d, largeur } } (largeur de la grille, 1024 par défaut). */
export function tracesIcones() {
  if (cache) return cache;
  const selection = JSON.parse(readFileSync(require.resolve('@phosphor-icons/web/regular/selection.json'), 'utf8'));
  const parNom = new Map();
  for (const i of selection.icons) for (const n of String(i.properties.name).split(',')) parNom.set(n.trim(), i.icon);
  cache = {};
  for (const [nom, phosphor] of Object.entries(ICONES)) {
    const g = parNom.get(phosphor);
    if (!g) throw new Error(`icône Phosphor introuvable : ${phosphor}`);
    cache[nom] = { d: g.paths.join(' '), largeur: g.width || selection.height || 1024 };
  }
  return cache;
}
