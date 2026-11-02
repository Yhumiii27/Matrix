// Historique des schémas sur le serveur commun (écart E-04, suite ; partage/16-matrix-historique.sql, rôle matrix_app).
//
// historique.json reste la copie locale : le collecteur et la sonde y ajoutent les événements (E-06), la page la lit, et
// Matrix fonctionne sans serveur commun. À chaque lecture du serveur, alignerHistorique envoie dans
// matrix.historique_schemas les événements de la copie qu'il n'a pas encore (empreinte SHA-256, envoi rejouable), puis
// renvoie le contenu de la table, qui fait foi : un historique.json perdu (volume recréé) se reconstitue ainsi.

import { createHash } from 'node:crypto';

const PAQUET = 500;

/** Empreinte d'un événement : SHA-256 de son JSON, clés triées (même événement, même empreinte). */
export function empreinteEvenement(e) {
  const trie = v => Array.isArray(v) ? v.map(trie) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, trie(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(trie(e))).digest('hex');
}

/** Un événement s'enregistre s'il a une date valide, un outil et un type ; les autres sont laissés dans la copie. */
export function evenementValide(e) {
  return !!e && typeof e === 'object' && !Number.isNaN(Date.parse(e.date)) && /^[a-z][a-z0-9_]{0,40}$/.test(String(e.app ?? ''))
    && /^[a-z][a-z0-9_]{0,60}$/.test(String(e.type ?? ''));
}

/** La table de partage/16 existe-t-elle ? (sinon l'historique reste dans historique.json) */
export async function historiqueDisponible(db) {
  const { rows: [r] } = await db.query(`SELECT to_regclass('matrix.historique_schemas') IS NOT NULL AS ok`);
  return r.ok;
}

/** Envoie les événements absents de la table, par paquets ; renvoie le nombre de lignes ajoutées. */
export async function envoyerHistorique(db, evenements) {
  const valides = evenements.filter(evenementValide);
  let ajoutes = 0;
  for (let i = 0; i < valides.length; i += PAQUET) {
    const paquet = valides.slice(i, i + PAQUET).map(e => ({ e, h: empreinteEvenement(e) }));
    const { rowCount } = await db.query(
      `INSERT INTO matrix.historique_schemas (quand, outil, type, nom_table, colonne, evenement, empreinte)
       SELECT (x.e->>'date')::timestamptz, x.e->>'app', x.e->>'type', x.e->>'table', x.e->>'colonne', x.e, x.h
         FROM jsonb_to_recordset($1::jsonb) AS x(e jsonb, h text)
       ORDER BY (x.e->>'date')::timestamptz
       ON CONFLICT (empreinte) DO NOTHING`, [JSON.stringify(paquet)]);
    ajoutes += rowCount;
  }
  return ajoutes;
}

/** Tout l'historique de la table, dans l'ordre d'arrivée, au format de historique.json. */
export async function lireHistoriquePg(db) {
  const { rows } = await db.query('SELECT evenement FROM matrix.historique_schemas ORDER BY quand, id');
  return { evenements: rows.map(r => r.evenement) };
}

/**
 * Aligne la copie locale et la table : envoi de ce qui manque, puis lecture de la table. Renvoie
 * { ajoutes, evenements, ignores } ; `ignores` compte les événements de la copie qui ne s'enregistrent pas (gardés).
 */
export async function alignerHistorique(db, copie) {
  const evenements = copie?.evenements ?? [];
  const ajoutes = await envoyerHistorique(db, evenements);
  const table = await lireHistoriquePg(db);
  const ignores = evenements.filter(e => !evenementValide(e));
  return { ajoutes, evenements: [...table.evenements, ...ignores], ignores: ignores.length };
}
