// Qualité des données (écart E-09) : règles déclarées par table, exécutées par la sonde sur le serveur commun, en
// lecture seule, en nommant les colonnes (jamais SELECT *), jamais sur une colonne sensible ou fermée à Matrix.
//
// Règles (data/regles-qualite.json) :
//   fraicheur  { colonne, maxJours }       la valeur la plus récente de `colonne` a moins de maxJours jours
//   non_nul    { colonne, seuil = 0 }      part de valeurs vides (NULL ou '') au plus `seuil` (0 à 1)
//   unicite    { colonnes: [...] }         aucune combinaison de valeurs non vides en double
//   plage      { colonne, min?, max? }     valeurs dans [min, max] ; « aujourd'hui » pour une date (pas de date future)
//   valeurs    { colonne, liste: [...] }   valeurs dans la liste
// Chaque règle a un id (Q01…), une table (outil.table), un libellé et une gravité (info, attention, erreur) appliquée
// quand elle n'est pas respectée. Résultat : ok, incident (avec mesure et exemples) ou non contrôlable (colonne absente,
// fermée, erreur). Les incidents s'ouvrent au premier constat et se closent au premier contrôle conforme.

export const TYPES = ['fraicheur', 'non_nul', 'unicite', 'plage', 'valeurs'];
const GRAVITES = ['info', 'attention', 'erreur'];
const OUTILS = ['keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible'];
const NOM = /^[a-z_][a-z0-9_]*$/;
const AUJOURDHUI = 'aujourd\'hui';

const ident = s => `"${String(s).replace(/"/g, '""')}"`;

/** Contrôle une règle et la renvoie normalisée, ou lève une erreur lisible. */
export function validerRegle(r) {
  const err = m => { throw new Error(`règle ${r?.id ?? '?'} : ${m}`); };
  if (!/^Q\d{2,3}$/.test(String(r?.id ?? ''))) err('id attendu Q01, Q02…');
  const [outil, table, reste] = String(r.table ?? '').split('.');
  if (!OUTILS.includes(outil) || !NOM.test(table ?? '') || reste !== undefined) err(`table invalide (« ${r.table} ») : outil.table attendu`);
  if (!TYPES.includes(r.type)) err(`type inconnu : ${r.type} (attendu : ${TYPES.join(', ')})`);
  const gravite = r.gravite ?? 'attention';
  if (!GRAVITES.includes(gravite)) err(`gravité : ${GRAVITES.join(', ')}`);
  const libelle = String(r.libelle ?? '').trim();
  if (!libelle) err('libellé obligatoire');
  const colonnes = r.type === 'unicite' ? r.colonnes : [r.colonne];
  if (!Array.isArray(colonnes) || !colonnes.length || colonnes.some(c => !NOM.test(String(c ?? '')))) err('colonne(s) invalide(s)');
  const n = { id: r.id, table: r.table, outil, nomTable: table, type: r.type, colonnes, libelle, gravite };
  if (r.type === 'fraicheur') {
    if (!(Number.isInteger(r.maxJours) && r.maxJours > 0)) err('maxJours : entier positif');
    n.maxJours = r.maxJours;
  } else if (r.type === 'non_nul') {
    const s = r.seuil ?? 0;
    if (!(typeof s === 'number' && s >= 0 && s < 1)) err('seuil : nombre de 0 (aucune valeur vide) à moins de 1');
    n.seuil = s;
  } else if (r.type === 'plage') {
    if (r.min == null && r.max == null) err('min ou max attendu');
    for (const k of ['min', 'max']) {
      const v = r[k];
      if (v == null) continue;
      if (!(typeof v === 'number' && Number.isFinite(v)) && v !== AUJOURDHUI && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) err(`${k} : nombre, date AAAA-MM-JJ ou « ${AUJOURDHUI} »`);
      n[k] = v;
    }
  } else if (r.type === 'valeurs') {
    if (!Array.isArray(r.liste) || !r.liste.length || r.liste.some(v => typeof v !== 'string' && typeof v !== 'number')) err('liste : valeurs attendues');
    n.liste = r.liste.map(String);
  }
  return n;
}

/** Lit et contrôle la liste des règles (doublons d'id refusés). */
export function chargerRegles(doc) {
  const regles = (doc?.regles ?? []).map(validerRegle);
  const vus = new Set();
  for (const r of regles) { if (vus.has(r.id)) throw new Error(`règle ${r.id} en double`); vus.add(r.id); }
  return regles;
}

// Borne d'une plage : nombre, date, ou la date du jour du serveur.
const borne = (v, params) => {
  if (v === AUJOURDHUI) return 'current_date';
  params.push(String(v));
  return typeof v === 'number' ? `$${params.length}::numeric` : `$${params.length}::date`;
};

/** Requête d'une règle : { sql, params }. Une ligne : mesure, total, exemples. Identifiants cités, valeurs en paramètres. */
export function requeteRegle(r) {
  const t = `${ident(r.outil)}.${ident(r.nomTable)}`;
  const c = ident(r.colonnes[0]);
  const params = [];
  if (r.type === 'fraicheur') {
    return { sql: `SELECT max(${c})::timestamptz AS derniere, count(${c})::bigint AS total FROM ${t}`, params };
  }
  if (r.type === 'non_nul') {
    return { sql: `SELECT count(*) FILTER (WHERE ${c} IS NULL OR ${c}::text = '')::bigint AS mesure, count(*)::bigint AS total FROM ${t}`, params };
  }
  if (r.type === 'unicite') {
    const cs = r.colonnes.map(ident);
    const nonVides = cs.map(x => `${x} IS NOT NULL AND ${x}::text <> ''`).join(' AND ');
    return { sql: `SELECT count(*)::bigint AS mesure, coalesce(sum(n), 0)::bigint AS total, (array_agg(cle ORDER BY n DESC))[1:5] AS exemples
                     FROM (SELECT concat_ws(' · ', ${cs.map(x => `${x}::text`).join(', ')}) AS cle, count(*) AS n FROM ${t}
                            WHERE ${nonVides} GROUP BY ${cs.join(', ')} HAVING count(*) > 1) d`, params };
  }
  if (r.type === 'plage') {
    const hors = [];
    const numerique = typeof r.min === 'number' || typeof r.max === 'number';
    const v = numerique ? `${c}::numeric` : `${c}::date`;
    if (r.min != null) hors.push(`${v} < ${borne(r.min, params)}`);
    if (r.max != null) hors.push(`${v} > ${borne(r.max, params)}`);
    const f = hors.join(' OR ');
    return { sql: `SELECT count(*) FILTER (WHERE ${f})::bigint AS mesure, count(${c})::bigint AS total,
                          (array_agg(DISTINCT ${c}::text) FILTER (WHERE ${f}))[1:5] AS exemples FROM ${t} WHERE ${c} IS NOT NULL`, params };
  }
  params.push(r.liste);
  return { sql: `SELECT count(*) FILTER (WHERE NOT (${c}::text = ANY ($1::text[])))::bigint AS mesure, count(${c})::bigint AS total,
                        (array_agg(DISTINCT ${c}::text) FILTER (WHERE NOT (${c}::text = ANY ($1::text[]))))[1:5] AS exemples
                   FROM ${t} WHERE ${c} IS NOT NULL`, params };
}

/** Résultat d'une règle d'après la ligne lue (maintenant : instant du contrôle, pour la fraîcheur). */
export function evaluer(r, ligne, maintenant = new Date()) {
  const total = Number(ligne?.total ?? 0);
  if (r.type === 'fraicheur') {
    if (!ligne?.derniere) return { etat: 'incident', mesure: null, total, detail: 'aucune valeur' };
    const jours = Math.floor((maintenant - new Date(ligne.derniere)) / 86400000);
    return { etat: jours > r.maxJours ? 'incident' : 'ok', mesure: jours, total, detail: `dernière valeur il y a ${jours} jour(s) (au plus ${r.maxJours})`, derniere: new Date(ligne.derniere).toISOString() };
  }
  const mesure = Number(ligne?.mesure ?? 0);
  const exemples = ligne?.exemples ?? [];
  if (r.type === 'non_nul') {
    const part = total ? mesure / total : 0;
    return { etat: part > r.seuil ? 'incident' : 'ok', mesure, total, detail: `${mesure} valeur(s) vide(s) sur ${total} (${(part * 100).toFixed(1)} %, au plus ${(r.seuil * 100).toFixed(1)} %)` };
  }
  if (r.type === 'unicite') return { etat: mesure ? 'incident' : 'ok', mesure, total, exemples, detail: mesure ? `${mesure} valeur(s) en double (${total} lignes concernées)` : 'aucun doublon' };
  return { etat: mesure ? 'incident' : 'ok', mesure, total, exemples, detail: `${mesure} valeur(s) hors ${r.type === 'plage' ? 'plage' : 'liste'} sur ${total}` };
}

/**
 * Exécute les règles sur le serveur (rôle matrix_app). `colonnes` : colonnes lues par la sonde ({ schema, table, nom,
 * lisible }) ; une règle sur une colonne absente ou fermée n'est pas exécutée. Chaque requête tourne dans une transaction
 * en lecture seule bornée à `delaiMs`.
 */
export async function controlerQualite(db, regles, colonnes, { delaiMs = 15000, maintenant = new Date() } = {}) {
  const existe = new Set(colonnes.map(c => `${c.schema}.${c.table}.${c.nom}`));
  const lisible = new Set(colonnes.filter(c => c.lisible).map(c => `${c.schema}.${c.table}.${c.nom}`));
  const out = [];
  for (const r of regles) {
    const base = { id: r.id, table: r.table, type: r.type, colonnes: r.colonnes, libelle: r.libelle, gravite: r.gravite };
    const cles = r.colonnes.map(c => `${r.table}.${c}`);
    const absentes = cles.filter(k => !existe.has(k)), fermees = cles.filter(k => existe.has(k) && !lisible.has(k));
    if (absentes.length || fermees.length) {
      out.push({ ...base, etat: 'non_controlable', detail: absentes.length ? `absent du serveur : ${absentes.join(', ')}` : `colonne fermée à Matrix (sensible) : ${fermees.join(', ')}` });
      continue;
    }
    const { sql, params } = requeteRegle(r);
    try {
      await db.query('BEGIN READ ONLY');
      await db.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.floor(delaiMs))}`);
      const { rows: [ligne] } = await db.query(sql, params);
      await db.query('ROLLBACK');
      out.push({ ...base, ...evaluer(r, ligne, maintenant) });
    } catch (e) {
      await db.query('ROLLBACK').catch(() => {});
      out.push({ ...base, etat: 'non_controlable', detail: e.message });
    }
  }
  return out;
}

/** Gravité affichée d'un résultat : celle de la règle si incident, ok si conforme, info si non contrôlable. */
export const graviteResultat = r => r.etat === 'incident' ? r.gravite : r.etat === 'ok' ? 'ok' : 'info';

/**
 * Suivi des incidents d'une lecture à l'autre : un incident s'ouvre au premier constat, garde sa date d'ouverture tant
 * qu'il dure (mesure mise à jour), se clôt au premier contrôle conforme. Une règle non contrôlable ne change rien.
 * Les 200 derniers incidents clos sont gardés.
 */
export function suivreIncidents(precedent, resultats, date) {
  const incidents = (precedent?.incidents ?? []).map(i => ({ ...i }));
  const ouvert = id => incidents.find(i => i.regle === id && !i.closLe);
  for (const r of resultats) {
    const i = ouvert(r.id);
    if (r.etat === 'incident') {
      if (i) Object.assign(i, { vuLe: date, mesure: r.mesure ?? null, detail: r.detail, gravite: r.gravite });
      else incidents.push({ regle: r.id, table: r.table, libelle: r.libelle, gravite: r.gravite, ouvertLe: date, vuLe: date, mesure: r.mesure ?? null, detail: r.detail });
    } else if (r.etat === 'ok' && i) Object.assign(i, { closLe: date });
  }
  const ouverts = incidents.filter(i => !i.closLe);
  const clos = incidents.filter(i => i.closLe).sort((a, b) => b.closLe.localeCompare(a.closLe)).slice(0, 200);
  return { incidents: [...ouverts, ...clos] };
}
