// Lignage des vues pub_ et flux observés sur le serveur commun (écart E-07, docs/proposition.md § 6).
//
// Pour chaque vue pub_, la sonde lit deux choses que PostgreSQL tient à jour lui-même :
//   - pg_depend : les colonnes des tables dont la vue dépend (sûr, mais sans dire quelle colonne publiée vient d'où) ;
//   - pg_get_viewdef : la définition, d'où analyserVue tire, pour chaque colonne publiée, sa ou ses colonnes sources :
//       directe     : une colonne d'une table, telle quelle (p.code, p.number AS numero) ;
//       transformee : une colonne, convertie ou complétée (p.stage::text, COALESCE(c.is_internal, false)) ;
//       calculee    : une expression de plusieurs colonnes, une sous-requête, une constante.
//     Une source n'est gardée que si pg_depend la confirme : l'analyse du texte ne peut rien inventer.
// fluxObserves croise ensuite les vues, leur lignage et les liens appliqués (registre des liens, droits posés) avec les
// flux saisis à la main (data/flux.json) : un flux saisi est « confirmé » quand un lien appliqué lui correspond,
// « non observé » sinon ; un lien appliqué qu'aucun flux saisi ne décrit est un « flux observé, non décrit » (sauf les
// lectures de Matrix, qui contrôle tout).

// Découpe au niveau 0 (hors parenthèses et chaînes) : renvoie les positions où `test` réussit.
function niveauZero(texte, test) {
  const pos = [];
  let prof = 0, chaine = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (chaine) { if (c === "'") chaine = texte[i + 1] === "'" ? (i++, true) : false; continue; }
    if (c === "'") chaine = true;
    else if (c === '(') prof++;
    else if (c === ')') prof--;
    else if (prof === 0 && test(i)) pos.push(i);
  }
  return pos;
}
const motA = (texte, mot) => i => texte.slice(i, i + mot.length).toUpperCase() === mot && !/\w/.test(texte[i - 1] ?? ' ') && !/\w/.test(texte[i + mot.length] ?? ' ');

/**
 * Colonnes publiées d'une définition de vue (pg_get_viewdef), avec leurs sources supposées. Une union (UNION [ALL]) est
 * lue branche par branche : les noms viennent de la première, les sources sont réunies, le genre est le plus large.
 */
export function analyserVue(definition, schema) {
  let def = definition.trim().replace(/;$/, '');
  // WITH … : les CTE sont sautées, la requête principale est le premier SELECT de niveau 0.
  const ctes = new Set();
  if (/^WITH\b/i.test(def)) {
    for (const m of def.matchAll(/(?:WITH|,)\s+(\w+)\s+AS\s+\(/gi)) ctes.add(m[1]);
    const s = niveauZero(def, motA(def, 'SELECT'))[0];
    if (s == null) return [];
    def = def.slice(s);
  }
  const unions = niveauZero(def, motA(def, 'UNION'));
  if (unions.length) {
    const bornes = [0, ...unions, def.length];
    const branches = bornes.slice(0, -1).map((d, k) => def.slice(d, bornes[k + 1]).replace(/^UNION(\s+ALL)?\s+/i, '').trim().replace(/^\(|\)$/g, ''))
      .map(b => analyserBranche(b, schema, ctes));
    const rang = { directe: 0, transformee: 1, calculee: 2 };
    return branches[0].map((c, i) => {
      const toutes = branches.map(b => b[i]).filter(Boolean);
      const sources = [...new Map(toutes.flatMap(x => x.sources).map(r => [`${r.table}.${r.colonne}`, r])).values()];
      const genre = toutes.reduce((g, x) => rang[x.genre] > rang[g] ? x.genre : g, 'directe');
      return { colonne: c.colonne, genre, sources, simple: toutes.every(x => x.simple), sousRequete: toutes.some(x => x.sousRequete) };
    });
  }
  return analyserBranche(def, schema, ctes);
}

function analyserBranche(def, schema, ctes) {
  def = def.replace(/^SELECT\s+(DISTINCT\s+)?/i, '');
  const from = niveauZero(def, motA(def, 'FROM'))[0];
  const liste = from == null ? def : def.slice(0, from);
  const suite = from == null ? '' : def.slice(from);
  // Alias → table, dans le FROM de niveau 0 (une sous-requête LATERAL ou une CTE n'est pas une table).
  const alias = {};
  const fin = niveauZero(suite, i => /^(WHERE|GROUP BY|HAVING|ORDER BY|UNION|LIMIT)\b/i.test(suite.slice(i)) && !/\w/.test(suite[i - 1] ?? ' '))[0];
  const clauseFrom = fin == null ? suite : suite.slice(0, fin);
  for (const m of clauseFrom.matchAll(/(?:FROM|JOIN)\s+(?!LATERAL\b|\()([\w."]+)(?:\s+(?:AS\s+)?(?!ON\b|JOIN\b|LEFT\b|RIGHT\b|FULL\b|INNER\b|CROSS\b|WHERE\b)(\w+))?/gi)) {
    const nom = m[1].replace(/"/g, '');
    if (ctes.has(nom)) { alias[m[2] ?? nom] = null; continue; }
    const table = nom.includes('.') ? nom : `${schema}.${nom}`;
    alias[m[2] ?? nom.split('.').pop()] = table;
  }
  // Une seule table : pg_get_viewdef n'écrit pas l'alias (« id », pas « c.id »). Les noms nus sont alors rapportés à cette
  // table ; confirmer ne garde que ceux qui sont de vraies colonnes (pg_depend).
  const reelles = [...new Set(Object.values(alias).filter(Boolean))];
  const seule = reelles.length === 1 ? reelles[0] : null;
  const debuts = [0, ...niveauZero(liste, i => liste[i] === ',').map(i => i + 1)];
  return debuts.map((d, k) => liste.slice(d, debuts[k + 1] != null ? debuts[k + 1] - 1 : undefined).trim()).filter(Boolean).map(item => {
    const as = niveauZero(item, motA(item, 'AS')).pop();
    const expr = (as == null ? item : item.slice(0, as)).trim();
    const colonne = (as == null ? item.split('.').pop() : item.slice(as + 2)).trim().replace(/"/g, '');
    const sansChaines = expr.replace(/'(?:[^']|'')*'/g, "''");
    const refs = [...sansChaines.matchAll(/\b(\w+)\.(\w+)\b/g)]
      .filter(([, a]) => alias[a]).map(([, a, c]) => ({ table: alias[a], colonne: c }));
    if (seule) for (const [, mot] of sansChaines.replace(/::[\w ]+(\[\])?/g, '').matchAll(/(?<![\w.])([A-Za-z_]\w*)(?![\w.(])/g))
      if (!MOTS_SQL.has(mot.toUpperCase())) refs.push({ table: seule, colonne: mot });
    const uniques = [...new Map(refs.map(r => [`${r.table}.${r.colonne}`, r])).values()];
    const qualifie = /^\(?\s*(\w+)\.(\w+)\s*\)?$/.exec(expr);
    const simple = Boolean((qualifie && alias[qualifie[1]]) || (seule && /^\(?\s*\w+\s*\)?$/.test(expr) && !MOTS_SQL.has(expr.replace(/[()\s]/g, '').toUpperCase())));
    const sousRequete = /\bSELECT\b/i.test(expr);
    return { colonne, genre: genreDe(simple, sousRequete, uniques.length), sources: uniques, simple, sousRequete };
  });
}

const MOTS_SQL = new Set(['AND', 'OR', 'NOT', 'NULL', 'TRUE', 'FALSE', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AS', 'IS', 'IN', 'ANY', 'ALL',
  'ARRAY', 'DISTINCT', 'FROM', 'WHERE', 'SELECT', 'LIKE', 'ILIKE', 'BETWEEN', 'EXISTS', 'INTERVAL', 'AT', 'TIME', 'ZONE', 'OVER', 'PARTITION',
  'BY', 'ORDER', 'FILTER', 'CURRENT_DATE', 'CURRENT_TIMESTAMP', 'NOW']);
const genreDe = (simple, sousRequete, n) => simple && n === 1 ? 'directe' : !sousRequete && n === 1 ? 'transformee' : 'calculee';

/** Garde de chaque colonne les seules sources confirmées par pg_depend (dependances : « schema.table.colonne »). */
export function confirmer(colonnes, dependances) {
  const ok = new Set(dependances);
  return colonnes.map(({ simple, sousRequete, ...c }) => {
    const sources = c.sources.filter(s => ok.has(`${s.table}.${s.colonne}`));
    return { ...c, sources, genre: simple === undefined ? (sources.length ? c.genre : 'calculee') : genreDe(simple, sousRequete, sources.length) };
  });
}

/**
 * Flux observés : un lien appliqué (vue d'un outil lue par un autre) est un flux de l'outil qui publie vers l'outil qui
 * lit, portant sur les tables sources de la vue. Rapprochement avec les flux saisis (même sens, au moins une table
 * source commune, ou flux saisi sans tables sources).
 *   vues  : [{ vue, sources: ['schema.table.colonne', …] }]
 *   liens : liens de l'état de santé (vue, lecteur, etat) ; seuls les liens « applique » comptent.
 *   flux  : data/flux.json (flux : [{ id, de, vers, source: [tables], … }]).
 */
export function fluxObserves({ vues = [], liens = [], flux = [] }) {
  const sourcesVue = new Map(vues.map(v => [v.vue, [...new Set((v.sources ?? []).map(s => s.split('.').slice(0, 2).join('.')))]]));
  const observes = new Map();
  for (const l of liens.filter(l => l.etat === 'applique')) {
    const de = l.vue.split('.')[0], vers = l.lecteur.replace(/_app$/, '');
    if (de === vers) continue;
    const k = `${de}>${vers}`;
    const o = observes.get(k) ?? { de, vers, vues: [], tables: new Set() };
    o.vues.push(l.vue);
    for (const t of sourcesVue.get(l.vue) ?? []) o.tables.add(t.split('.')[1]);
    observes.set(k, o);
  }
  const saisis = flux.map(f => {
    const o = observes.get(`${f.de}>${f.vers}`);
    const communes = o ? (f.source ?? []).filter(t => o.tables.has(t)) : [];
    const confirme = Boolean(o) && (!(f.source ?? []).length || communes.length > 0);
    return { id: f.id, de: f.de, vers: f.vers, etat: confirme ? 'confirme' : 'non_observe', vues: confirme ? o.vues : [], tablesCommunes: communes };
  });
  const decrits = new Set(saisis.filter(s => s.etat === 'confirme').map(s => `${s.de}>${s.vers}`));
  // Matrix lit toutes les vues pour les contrôler (journal unifié, références) : ce n'est pas un flux entre outils.
  const nonDecrits = [...observes.values()].filter(o => o.vers !== 'matrix' && !decrits.has(`${o.de}>${o.vers}`))
    .map(o => ({ de: o.de, vers: o.vers, vues: o.vues.sort(), tables: [...o.tables].sort() }));
  return { saisis, nonDecrits, observes: [...observes.values()].map(o => ({ de: o.de, vers: o.vers, vues: o.vues.sort(), tables: [...o.tables].sort() })) };
}
