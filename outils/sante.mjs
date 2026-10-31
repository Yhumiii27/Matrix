// État de santé des tables et des liens, calculé à partir de la lecture du serveur commun (outils/sonde.mjs).
//
// Chaque constat a une gravité : erreur (à corriger), attention (à surveiller), info (à savoir, sans effet sur l'état).
// L'état d'une table, d'un lien ou d'un outil est celui de son constat le plus grave : erreur, attention, sinon ok.
// Les règles et leurs seuils sont ici, et seulement ici ; l'écran « Santé » les affiche telles quelles.

import { LECTEURS } from './sonde.mjs';

export const REGLES = {
  sans_cle: { gravite: 'attention', libelle: 'Table sans clé', aide: 'Ni clé primaire ni contrainte d’unicité sur des colonnes obligatoires : une ligne ne peut pas être désignée sans ambiguïté.' },
  cle_unique_seulement: { gravite: 'info', libelle: 'Clé unique sans clé primaire', aide: 'Une contrainte d’unicité sur des colonnes obligatoires identifie les lignes ; une clé primaire le dirait explicitement.' },
  lien_non_valide: { gravite: 'erreur', libelle: 'Clé étrangère non validée', aide: 'Créée avec NOT VALID et jamais validée : des lignes existantes peuvent pointer vers rien.' },
  lien_entre_schemas: { gravite: 'erreur', libelle: 'Clé étrangère vers un autre outil', aide: 'Interdite par la convention de partage : une référence croisée est une colonne texte contrôlée par Matrix.' },
  lien_sans_index: { gravite: 'attention', libelle: 'Clé étrangère sans index', aide: 'Jointures et suppressions en cascade parcourent toute la table : attention à partir de 10 000 lignes, simple info en dessous.' },
  lignes_mortes: { gravite: 'attention', libelle: 'Beaucoup de lignes mortes', aide: 'Plus de 20 % de lignes mortes et plus de 1 000 : le nettoyage automatique ne suit pas.' },
  jamais_analysee: { gravite: 'info', libelle: 'Jamais analysée', aide: 'Pas encore de statistiques : normal pour une table neuve ou vide.' },
  non_documentee: { gravite: 'info', libelle: 'Table non documentée', aide: 'Ni commentaire en base ni description dans Matrix.' },
  colonnes_fermees: { gravite: 'info', libelle: 'Colonnes fermées à Matrix', aide: 'Colonnes sensibles (droits.colonnes_sensibles) : Matrix connaît leur existence, pas leur contenu.' },
};

export const ETATS_LIEN = {
  applique: { gravite: 'ok', libelle: 'Autorisé et appliqué' },
  refuse: { gravite: 'ok', libelle: 'Refusé, aucun droit' },
  en_attente: { gravite: 'info', libelle: 'Demande en attente de décision' },
  outil_absent: { gravite: 'info', libelle: 'Autorisé, outil pas encore migré sur le serveur' },
  vue_absente: { gravite: 'attention', libelle: 'Autorisé, vue pas encore publiée par l’outil' },
  a_appliquer: { gravite: 'attention', libelle: 'Autorisé, droit pas encore posé (rejouer 90-droits.sql)' },
  a_retirer: { gravite: 'erreur', libelle: 'Droit posé alors que le lien n’est pas autorisé (rejouer 90-droits.sql)' },
  hors_registre: { gravite: 'erreur', libelle: 'Droit posé hors du registre de Matrix (rejouer 90-droits.sql)' },
};

// Migrations de chaque outil (E-06) : journal lu sur le serveur, et structure changée sans nouvelle migration.
export const ETATS_MIGRATIONS = {
  suivi: { gravite: 'ok', libelle: 'Structure conforme aux migrations appliquées' },
  hors_migration: { gravite: 'attention', libelle: 'Structure changée sans nouvelle migration (ALTER passé à la main ?) : à reporter dans une migration de l’outil' },
  sans_journal: { gravite: 'info', libelle: 'Aucun journal de migrations lisible dans le schéma de l’outil' },
  illisible: { gravite: 'info', libelle: 'Journal de migrations illisible pour Matrix' },
};

const pire = gravites => gravites.includes('erreur') ? 'erreur' : gravites.includes('attention') ? 'attention' : 'ok';

function constatsTable(t, documentee) {
  const c = [];
  if (!t.pk.length) {
    const obligatoire = new Set(t.columns.filter(x => !x.nullable).map(x => x.name));
    const cleUnique = t.uniques.find(u => u.every(col => obligatoire.has(col)));
    c.push(cleUnique ? { regle: 'cle_unique_seulement', detail: cleUnique.join(', ') } : { regle: 'sans_cle' });
  }
  for (const f of t.fks) {
    if (f.schema) c.push({ regle: 'lien_entre_schemas', detail: `${f.columns.join(', ')} → ${f.schema}.${f.table}` });
    if (f.valide === false) c.push({ regle: 'lien_non_valide', detail: f.nom });
    if (f.indexe === false) c.push({ regle: 'lien_sans_index', detail: `${f.columns.join(', ')} → ${f.table}`, gravite: (t.stats?.lignes ?? 0) >= 10000 ? 'attention' : 'info' });
  }
  const s = t.stats ?? {};
  if (s.lignesMortes > 1000 && s.lignesMortes > 0.2 * Math.max(1, s.lignes ?? 0)) c.push({ regle: 'lignes_mortes', detail: `${s.lignesMortes} mortes pour ${s.lignes} vivantes` });
  if (!s.analyseLe) c.push({ regle: 'jamais_analysee' });
  if (!documentee) c.push({ regle: 'non_documentee' });
  const fermees = t.columns.filter(x => x.fermee).map(x => x.name);
  if (fermees.length) c.push({ regle: 'colonnes_fermees', detail: fermees.join(', ') });
  return c.map(x => ({ ...x, gravite: x.gravite ?? REGLES[x.regle].gravite }));
}

/** Calcule l'état de santé. `catalogue` et `edition` servent à savoir si une table est documentée dans Matrix. */
export function calculerSante(lecture, { catalogue = null, edition = null, horsMigration = {} } = {}) {
  const docCatalogue = new Set((catalogue?.apps ?? []).flatMap(a => a.tables.filter(t => t.description).map(t => `${a.id}.${t.name}`)));
  const docEdition = new Set(Object.keys(edition?.documentation ?? {}));

  // Tables
  const tables = [];
  for (const [app, o] of Object.entries(lecture.outils)) {
    for (const t of o.tables) {
      const k = `${app}.${t.name}`;
      const constats = constatsTable(t, Boolean(t.description || docCatalogue.has(k) || docEdition.has(k)));
      tables.push({ app, table: t.name, etat: pire(constats.map(c => c.gravite)), constats, stats: t.stats, colonnes: t.columns.length, liens: t.fks.length });
    }
  }

  // Liens entre outils : registre de Matrix face aux droits réellement posés sur les vues pub_.
  const vues = new Map(lecture.vues.map(v => [v.vue, v]));
  const poses = new Set(lecture.vues.flatMap(v => v.lecteurs.filter(l => LECTEURS.includes(l) && `${v.vue.split('.')[0]}_app` !== l).map(l => `${v.vue}|${l}`)));
  const registreLu = !lecture.liens.erreur;
  const outilsPresents = new Set([...Object.keys(lecture.outils), 'matrix']);
  const liens = [];
  const vus = new Set();
  for (const r of lecture.liens.registre) {
    const k = `${r.vue}|${r.lecteur}`; vus.add(k);
    const pose = poses.has(k);
    let etat;
    if (r.statut === 'autorise') etat = !vues.has(r.vue) ? (outilsPresents.has(r.vue.split('.')[0]) ? 'vue_absente' : 'outil_absent') : pose ? 'applique' : 'a_appliquer';
    else if (pose) etat = 'a_retirer';
    else etat = r.statut === 'refuse' ? 'refuse' : 'en_attente';
    liens.push({ ...r, pose, vueExiste: vues.has(r.vue), etat, gravite: ETATS_LIEN[etat].gravite });
  }
  if (registreLu) for (const k of poses) if (!vus.has(k)) {
    const [vue, lecteur] = k.split('|');
    liens.push({ vue, lecteur, statut: null, origine: null, pose: true, vueExiste: true, etat: 'hors_registre', gravite: ETATS_LIEN.hors_registre.gravite });
  }
  liens.sort((a, b) => a.vue.localeCompare(b.vue) || a.lecteur.localeCompare(b.lecteur));

  // Références entre outils (valeurs orphelines).
  const references = lecture.references.map(r => ({ ...r, gravite: r.etat === 'orphelins' ? 'attention' : r.etat === 'ok' ? 'ok' : 'info' }));

  // Contrôle du socle (droits.verifier()).
  const socle = lecture.verifier.lignes.map(v => ({ ...v }));

  // Migrations, par outil présent sur le serveur.
  const migrations = Object.keys(lecture.outils).map(app => {
    const m = lecture.migrations?.[app], h = horsMigration?.[app] ?? null;
    const etat = !m ? 'sans_journal' : m.erreur ? 'illisible' : h ? 'hors_migration' : 'suivi';
    return { app, ...(m ?? {}), horsMigration: h, etat, gravite: ETATS_MIGRATIONS[etat].gravite };
  });

  const compte = l => l.reduce((n, x) => { n[x.gravite] = (n[x.gravite] ?? 0) + 1; return n; }, {});
  const parOutil = {};
  for (const t of tables) {
    const p = (parOutil[t.app] ??= { tables: 0, erreur: 0, attention: 0, ok: 0, lignes: 0, taille: 0 });
    p.tables++; p[t.etat === 'ok' ? 'ok' : t.etat]++; p.lignes += t.stats?.lignes ?? 0; p.taille += t.stats?.taille ?? 0;
  }
  for (const p of Object.values(parOutil)) p.etat = p.erreur ? 'erreur' : p.attention ? 'attention' : 'ok';

  const etatGlobal = pire([
    ...tables.map(t => t.etat), ...liens.map(l => l.gravite), ...references.map(r => r.gravite),
    ...socle.map(s => s.gravite), ...migrations.map(m => m.gravite),
  ]);
  return {
    calculeLe: new Date().toISOString(),
    luLe: lecture.luLe,
    etat: etatGlobal,
    resume: {
      tables: compte(tables.map(t => ({ gravite: t.etat }))),
      liens: compte(liens), references: compte(references), socle: compte(socle),
      registre: registreLu ? 'lu' : `illisible (${lecture.liens.erreur})`,
    },
    parOutil, tables, liens, references, socle, migrations,
    vues: lecture.vues.map(v => ({ vue: v.vue, lecteurs: v.lecteurs, description: v.description })),
    journalLiens: lecture.liens.journal,
    regles: REGLES, etatsLien: ETATS_LIEN, etatsMigrations: ETATS_MIGRATIONS,
  };
}
