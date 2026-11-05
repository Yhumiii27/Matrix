// Serveur de Matrix (Coolify ou tout hébergeur Docker, ou en local : node serveur.mjs).
//
//   GET  /                      la page de Matrix, construite avec le catalogue à jour
//   GET  /api/sante             état du serveur (utilisé par le contrôle de santé Docker)
//   GET  /api/catalogue         le catalogue courant (JSON)
//   GET  /api/declarations      dernières déclarations reçues, par outil
//   POST /api/declarations      déclaration du schéma d'un outil (contrat matrix.schema/1, voir
//                               integration/declarer-schema.mjs et docs/declaration-des-tables.md)
//   GET  /api/edition           documentation, décisions, référentiels et journal saisis dans Matrix
//   PUT  /api/documentation     documenter une table      { app, table, description, domaine, responsable, note }
//   PUT  /api/decisions         décision sur un doublon   { id, option }  (option null pour la retirer)
//   PUT  /api/referentiels/:nom remplacer un référentiel  [ … lignes … ]  (sites, organigramme, pays, zones, filiales) ;
//                               avec le serveur commun, écrit d'abord dans le schéma matrix (outils/referentiels-pg.mjs)
//   GET  /api/referentiels/:nom un référentiel publié (lu par les outils)
//   GET  /api/etat              état de santé des tables et des liens (dernière lecture du serveur commun)
//   GET  /api/liens             registre des liens entre outils, état de chaque lien, journal des décisions
//   POST /api/liens             décision sur un lien  { vue, lecteur, statut: autorise|refuse|demande, motif }
//   POST /api/synchro           relire le serveur commun maintenant
//   GET  /api/journal           journal unifié des outils (matrix.journal_unifie, D18) : outil, projet, recherche,
//                               depuis, jusqu (AAAA-MM-JJ), apres_quand + apres_ref (page suivante), limite
//   GET  /api/rex               retours d'expérience réunis (matrix.rex_unifie, D22) : outil, code, categorie, recherche
//   GET  /api/correspondances   correspondances d'identifiants (matrix.correspondances) : objet, outil, statut
//   POST /api/correspondances   décision sur une correspondance  { id, statut, pivot?, note? }
//   GET  /api/catalogue/tables  liste des tables (outil, domaine, q : recherche plein texte), pour les outils et les agents
//   GET  /api/catalogue/tables/:outil/:table  fiche d'une table : colonnes, liens, documentation, vues qui la publient, santé
//   GET  /api/export/tables.csv | colonnes.csv | dictionnaire.html | schema.mmd   exports (outil, domaine, q)
//   GET  /api/publications/depot demandes préparées dans data/publications-depot.json, et leur état face au registre
//   GET  /api/publications      registre des publications (vues pub_ des outils, M-18) et vues pas encore reprises
//   GET  /api/publications/:vue fiche d'une publication : définition, contrat, liens, journal
//   PUT  /api/publications/:vue brouillon  { mode: colonnes|sql, source, colonnes: [{ colonne, nom }], filtre, definition, description }
//   POST /api/publications/:vue/appliquer   appliquer sur le serveur (rôle matrix_gestion) : vue, contrôles, droits des liens
//   POST /api/publications/:vue/retirer     supprimer la vue (aucun lien autorisé)  { motif }
//
// Variables d'environnement :
//   PORT               port d'écoute (défaut 3000)
//   MATRIX_DATA_DIR    dossier des données vivantes : catalogue, historique, déclarations (défaut ./data ;
//                      /data dans l'image Docker, à monter sur un volume persistant)
//   MATRIX_TOKEN       jeton partagé avec les outils ; sans lui, les déclarations sont refusées (503)
//   MATRIX_SOURCES_DIR dossier contenant les dépôts keystone/, codex/, cursus/, vigie/, arche/, crucible/ (facultatif)
//   MATRIX_MOT_DE_PASSE mot de passe d'accès à Matrix (identifiant libre) : page /connexion et cookie de session pour le
//                      navigateur, en-tête Authorization: Basic pour les scripts (outils/acces.mjs). Sans lui, la
//                      consultation reste ouverte et, en production, les modifications sont refusées.
//   MATRIX_ENTRA_TENANT_ID, MATRIX_ENTRA_CLIENT_ID, MATRIX_ENTRA_CLIENT_SECRET, MATRIX_PUBLIC_URL, MATRIX_SESSION_SECRET
//                      connexion nominative par Microsoft Entra ID (M-06, E-02 ; outils/entra.mjs) : rôles applicatifs
//                      Administrateur (modifications) et Lecture. Avec elles, le mot de passe ne sert plus qu'aux scripts.
//   MATRIX_DATABASE_URL connexion au serveur PostgreSQL commun en matrix_app (postgres://matrix_app:…@hôte:5432/epc2i).
//                      Avec elle, la sonde (outils/sonde.mjs) lit elle-même les tables, liens, vues pub_ et droits
//                      de chaque outil, met le registre et les graphes à jour, calcule l'état de santé et tient le
//                      registre des liens (matrix.liens). Les référentiels saisis sont écrits dans le schéma matrix
//                      (pays, zones, filiales, sites, organigramme), que les outils lisent par les vues matrix.pub_*.
//   MATRIX_GESTION_DATABASE_URL connexion en matrix_gestion (décision M-18) : Matrix applique lui-même les publications
//                      (vues pub_ des outils) et les décisions sur les liens, tout de suite. Sans elle, les publications
//                      restent en brouillon et les liens sont appliqués par appliquer-liens.sh (15 minutes).
//                      Sans elle, Matrix vit des déclarations et du code des dépôts, et ses référentiels restent dans
//                      edition.json.
//   MATRIX_SYNCHRO_MINUTES intervalle entre deux lectures du serveur commun (défaut 60 ; 0 : au démarrage et à la
//                      demande seulement).

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { timingSafeEqual } from 'node:crypto';
import { collect, sensiblesDuServeur } from './outils/collecteur.mjs';
import { construirePage, RACINE } from './outils/page.mjs';
import { chargerEdition, documenter, decider, enregistrerReferentiel, preparerReferentiel, appliquerReferentiel, referentielsSaisis, adopterReferentiels, remplacerEdition } from './outils/edition.mjs';
import { editionDisponible, lireEditionPg, reprendreEdition, journaliserPg, documenterPg, deciderPg } from './outils/edition-pg.mjs';
import { historiqueDisponible, alignerHistorique } from './outils/historique-pg.mjs';
import { LISTES, lireReferentiels, comparer, ecrireReferentiels } from './outils/referentiels-pg.mjs';
import { lireJournal, lireRex, lireCorrespondances, deciderCorrespondance } from './outils/consultation.mjs';
import { fiches as fichesCatalogue, csvTables, csvColonnes, dictionnaireHtml, diagrammeMermaid } from './outils/export.mjs';
import { chercher } from './outils/recherche.mjs';
import { client, lireServeur, declarations, validerLien, ecrireLien, suivreMigrations, validerDemande, demanderLien, liensDuLecteur } from './outils/sonde.mjs';
import { calculerSante } from './outils/sante.mjs';
import { chargerRegles, suivreIncidents } from './outils/qualite.mjs';
import { saisiesDisponibles, lireGlossaire, enregistrerTerme, lireReglesPg, reglesActives, reprendreRegles, enregistrerRegle } from './outils/saisies-pg.mjs';
import { lireMotDePasse, motDePasseValide, identifiantBasic, creerSession, lireSession, creerJeton, lireJeton, lireCookie, enteteCookie, suiteSure, limiteur, pageConnexion, COOKIE, DUREE_SESSION_S } from './outils/acces.mjs';
import { lireDonnees } from './outils/visionneuse.mjs';
import { lireConfigEntra, roleDepuisEntra, personneDepuisJeton, debutConnexion, finConnexion, CHEMIN_RETOUR } from './outils/entra.mjs';
import { listerPublications, lirePublication, enregistrerPublication, appliquerPublication, retirerPublication, appliquerLien, etatDepot } from './outils/publications.mjs';

const PORT = +(process.env.PORT ?? 3000);
const DATA = process.env.MATRIX_DATA_DIR ?? join(RACINE, 'data');
const DECL = join(DATA, 'declarations');
const SOURCES = process.env.MATRIX_SOURCES_DIR ?? null;
const TOKEN = process.env.MATRIX_TOKEN ?? '';
const { mdp: MOT_DE_PASSE, avertissements: AVERTISSEMENTS_MDP } = lireMotDePasse(process.env.MATRIX_MOT_DE_PASSE);
// Connexion nominative par Microsoft Entra ID (M-06, E-02) ; le mot de passe reste pour les scripts (en-tête Basic) et,
// tant qu'Entra ID n'est pas configuré, pour la page de connexion.
const ENTRA = lireConfigEntra(process.env);
const ACCES_RESERVE = Boolean(MOT_DE_PASSE || ENTRA.active);
const COOKIE_OIDC = 'matrix_oidc';
const PRODUCTION = process.env.NODE_ENV === 'production';
const DB_URL = process.env.MATRIX_DATABASE_URL ?? '';
const GESTION_URL = process.env.MATRIX_GESTION_DATABASE_URL ?? '';
const SYNCHRO_MINUTES = Math.max(0, Number(process.env.MATRIX_SYNCHRO_MINUTES ?? 60) || 0);
const APPS = ['keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible'];
const MAX_OCTETS = 10 * 1024 * 1024;
const EMBARQUE = join(RACINE, 'data');

const lireJson = f => JSON.parse(readFileSync(f, 'utf8'));
const ecrireJson = (f, v) => writeFileSync(f, JSON.stringify(v, null, 1));

// ── Données vivantes ─────────────────────────────────────────────────────

// Au démarrage : le catalogue embarqué dans l'image sert de point de départ et de secours. Une nouvelle image
// (catalogue relu dans les dépôts) est comparée au catalogue vivant : les changements vont dans l'historique.
function rafraichir() {
  mkdirSync(DECL, { recursive: true });
  const fallback = lireJson(join(EMBARQUE, 'catalogue.json'));
  // Colonnes sensibles : la liste du serveur commun (droits.colonnes_sensibles), gardée par la sonde, fait foi (E-08).
  const fichierSensibles = join(DATA, 'sensibles.json');
  const sensibles = existsSync(fichierSensibles) ? lireJson(fichierSensibles).colonnes : null;
  const { catalogue, events } = collect({ root: SOURCES, dataDir: DATA, declDir: DECL, fallback, sensibles });
  if (DATA !== EMBARQUE || events.length) {
    ecrireJson(join(DATA, 'catalogue.json'), catalogue);
    const histFile = join(DATA, 'historique.json');
    if (!existsSync(histFile) && existsSync(join(EMBARQUE, 'historique.json')) && DATA !== EMBARQUE) copyFileSync(join(EMBARQUE, 'historique.json'), histFile);
    const hist = existsSync(histFile) ? lireJson(histFile) : { evenements: [] };
    hist.evenements.push(...events);
    ecrireJson(histFile, hist);
  }
  page = null;
  return { catalogue, events };
}

// Historique des schémas sur le serveur commun (E-04, partage/16) : à chaque lecture du serveur, la copie locale
// historique.json et matrix.historique_schemas sont alignées ; la table fait foi.
let historique = { actif: false, erreur: null, alignesLe: null, ajoutes: 0 };
async function alignerHistoriqueServeur(db) {
  try {
    if (!await historiqueDisponible(db)) {
      historique = { ...historique, actif: false, erreur: 'table absente : jouez partage/16-matrix-historique.sql (rôle matrix_app) ; historique dans historique.json' };
      return;
    }
    const histFile = join(DATA, 'historique.json');
    const copie = existsSync(histFile) ? lireJson(histFile) : { evenements: [] };
    const r = await alignerHistorique(db, copie);
    if (JSON.stringify(r.evenements) !== JSON.stringify(copie.evenements)) { ecrireJson(histFile, { ...copie, evenements: r.evenements }); page = null; }
    if (r.ajoutes) console.log(`historique des schémas : ${r.ajoutes} événement(s) enregistré(s) sur le serveur commun`);
    historique = { actif: true, erreur: null, alignesLe: new Date().toISOString(), ajoutes: historique.ajoutes + r.ajoutes, evenements: r.evenements.length, ignores: r.ignores };
  } catch (e) {
    historique = { ...historique, erreur: e.message, erreurLe: new Date().toISOString() };
    console.error(`historique sur le serveur commun : ${e.message}`);
  }
}

// Glossaire et règles de qualité saisis par la DSI (M-04, partage/17) : sur le serveur commun quand la table existe ;
// sinon les règles viennent de data/regles-qualite.json et le glossaire n'est pas disponible.
let saisies = { actif: false, erreur: null };
async function alignerSaisies(db) {
  try {
    if (!await saisiesDisponibles(db)) {
      saisies = { actif: false, erreur: 'tables absentes : jouez partage/17-matrix-glossaire-qualite.sql (rôle matrix_app) ; règles lues dans data/regles-qualite.json, glossaire indisponible' };
      return;
    }
    const n = await reprendreRegles(db, lireJson(join(RACINE, 'data', 'regles-qualite.json')));
    if (n !== null) console.log(`règles de qualité reprises sur le serveur commun : ${n}`);
    saisies = { actif: true, erreur: null };
  } catch (e) {
    saisies = { ...saisies, erreur: e.message };
    console.error(`glossaire et règles sur le serveur commun : ${e.message}`);
  }
}
// Règles à contrôler : celles du serveur commun (actives) si elles y sont, sinon le fichier du dépôt.
async function reglesAControler(db) {
  if (saisies.actif) {
    const { regles, erreurs } = await reglesActives(db);
    for (const e of erreurs) console.error(`règle de qualité écartée : ${e}`);
    return regles;
  }
  try { return chargerRegles(lireJson(join(RACINE, 'data', 'regles-qualite.json'))); }
  catch (e) { console.error(`règles de qualité ignorées : ${e.message}`); return []; }
}

function ajouterHistorique(evenements) {
  const histFile = join(DATA, 'historique.json');
  const hist = existsSync(histFile) ? lireJson(histFile) : { evenements: [] };
  hist.evenements.push(...evenements);
  ecrireJson(histFile, hist);
  page = null;
}

let page = null;
const pageCourante = () => (page ??= construirePage({ forme: 'document', dataDir: DATA, serveurCommun: Boolean(DB_URL) }));

// ── Référentiels sur le serveur commun (E-01) ─────────────────────────────

// Une écriture de référentiel à la fois : valider, écrire sur le serveur, puis enregistrer edition.json, sans qu'une
// autre écriture ne s'intercale entre ces étapes.
let fileReferentiels = Promise.resolve();
const enSerie = tache => { const p = fileReferentiels.then(tache); fileReferentiels = p.catch(() => {}); return p; };

async function avecServeur(tache, url = DB_URL) {
  const db = client(url);
  try { await db.connect(); return await tache(db); } finally { await db.end().catch(() => {}); }
}
// Administration (M-18) : une seule opération à la fois, pour qu'une publication et un lien ne se croisent pas.
let fileGestion = Promise.resolve();
const avecGestion = tache => { const p = fileGestion.then(() => avecServeur(tache, GESTION_URL)); fileGestion = p.catch(() => {}); return p; };

// ── Saisies de Matrix sur le serveur commun (E-04) ─────────────────────────
// Avec partage/15 joué, documentation, décisions et journal vivent dans le schéma matrix (verrou et version : outils/
// edition-pg.mjs) ; edition.json en est la copie locale, rafraîchie après chaque écriture et à chaque lecture du serveur.
// Au premier passage, des tables vides reprennent le contenu d'edition.json. Sans serveur, edition.json reste la source.
let edition = { actif: false, erreur: null, reprisLe: null };
async function copierEdition(db) { remplacerEdition(DATA, await lireEditionPg(db)); page = null; }
async function alignerEdition(db, demarrage) {
  return enSerie(async () => {
    try {
      if (!await editionDisponible(db)) {
        edition = { actif: false, erreur: 'tables absentes : jouez partage/15-matrix-edition.sql (rôle matrix_app) ; saisies dans edition.json', reprisLe: null };
        return;
      }
      if (demarrage) {
        const n = await reprendreEdition(db, chargerEdition(DATA));
        if (n !== null) { edition.reprisLe = new Date().toISOString(); console.log(`saisies d'edition.json reprises sur le serveur commun : ${n} ligne(s)`); }
      }
      await copierEdition(db);
      edition = { ...edition, actif: true, erreur: null, copieLe: new Date().toISOString() };
    } catch (e) {
      edition = { ...edition, erreur: e.message, erreurLe: new Date().toISOString() };
      console.error(`saisies sur le serveur commun : ${e.message}`);
    }
  });
}
// Documentation et décision : en base si possible (verrou, version, journal), sinon dans edition.json.
async function ecrireSaisie(quoi, corps, auteur) {
  if (!edition.actif) {
    return quoi === 'documentation' ? documenter(DATA, lireJson(join(DATA, 'catalogue.json')), corps, auteur) : decider(DATA, corps, auteur);
  }
  return enSerie(() => avecServeur(async db => {
    const r = quoi === 'documentation' ? await documenterPg(db, lireJson(join(DATA, 'catalogue.json')), corps, auteur) : await deciderPg(db, corps, auteur);
    await copierEdition(db);
    return r;
  }));
}

async function ecrireReferentiel(liste, lignes, auteur) {
  if (!DB_URL) return enregistrerReferentiel(DATA, liste, lignes, auteur);
  return enSerie(async () => {
    const p = preparerReferentiel(DATA, liste, lignes);
    if (p.inchange) return p.lignes;
    const bilan = await avecServeur(db => ecrireReferentiels(db, { [liste]: p.lignes }));
    const b = bilan[liste];
    const r = appliquerReferentiel(DATA, p, auteur, ` · serveur commun : ${b.ecrites} ligne(s) écrite(s)${b.desactivees ? `, ${b.desactivees} désactivée(s)` : ''}`);
    referentiels = { ...referentiels, ecarts: { ...referentiels.ecarts, [liste]: undefined } };
    // E-04 : le journal est sur le serveur commun ; l'entrée qu'appliquerReferentiel vient d'écrire y est reportée.
    if (edition.actif) await avecServeur(async db => { await journaliserPg(db, chargerEdition(DATA).journal.at(-1)); await copierEdition(db); }).catch(e => console.error(`journal : ${e.message}`));
    return r;
  });
}

// Compare les référentiels de Matrix à ceux du schéma matrix. Au démarrage (aligner), une liste déjà saisie dans Matrix
// est écrite sur le serveur (Matrix fait foi : D14, D15, D17, D21) ; une liste jamais saisie est reprise du serveur
// (amorçage de 10-matrix-referentiels.sql, ou saisie antérieure). Ensuite, à chaque lecture planifiée, l'écart est
// seulement constaté (/api/etat, /api/sante) : rien n'est réécrit sans une saisie.
let referentiels = { actif: Boolean(DB_URL), alignesLe: null, ecarts: {}, erreur: null };
async function alignerReferentiels(db, aligner) {
  return enSerie(async () => {
    try {
      const serveur = await lireReferentiels(db);
      const ed = chargerEdition(DATA), saisis = referentielsSaisis(DATA);
      const ecarts = {}, aEcrire = {}, aReprendre = {};
      for (const liste of LISTES) {
        const c = comparer(liste, ed.referentiels[liste], serveur[liste]);
        if (c.egal) continue;
        if (aligner && saisis.has(liste)) aEcrire[liste] = ed.referentiels[liste];
        else if (aligner) aReprendre[liste] = serveur[liste];
        else ecarts[liste] = { aEcrire: c.aEcrire, aDesactiver: c.aDesactiver };
      }
      if (Object.keys(aEcrire).length) {
        const bilan = await ecrireReferentiels(db, aEcrire);
        console.log(`référentiels écrits sur le serveur commun : ${Object.entries(bilan).map(([l, b]) => `${l} ${b.ecrites} écrite(s), ${b.desactivees} désactivée(s)`).join(' · ')}`);
      }
      if (Object.keys(aReprendre).length) {
        const avant = chargerEdition(DATA).journal.length;
        adopterReferentiels(DATA, aReprendre, 'serveur commun');
        if (edition.actif) for (const j of chargerEdition(DATA).journal.slice(avant)) await journaliserPg(db, j);
        page = null;
        console.log(`référentiels repris du serveur commun : ${Object.keys(aReprendre).join(', ')}`);
      }
      referentiels = { actif: true, alignesLe: new Date().toISOString(), ecarts, erreur: null, ecrits: Object.keys(aEcrire), repris: Object.keys(aReprendre) };
    } catch (e) {
      referentiels = { ...referentiels, erreur: e.message, erreurLe: new Date().toISOString() };
      console.error(`référentiels du serveur commun : ${e.message}`);
    }
    return referentiels;
  });
}

// ── Sonde du serveur commun ───────────────────────────────────────────────

// Lit le serveur commun, remplace la déclaration de chaque outil dont le schéma a changé (empreinte), recalcule le
// catalogue (historique, nouvelles tables, doublons possibles), puis l'état de santé (data/sante.json).
let sonde = { active: Boolean(DB_URL), intervalleMinutes: SYNCHRO_MINUTES, enCours: false, derniere: null, erreur: null };
let vuesConnues = null;
async function synchroniser(declencheur) {
  if (!DB_URL || sonde.enCours) return sonde;
  sonde = { ...sonde, enCours: true };
  const db = client(DB_URL);
  try {
    await db.connect();
    await alignerEdition(db, declencheur === 'démarrage');
    await alignerReferentiels(db, declencheur === 'démarrage');
    const references = lireJson(join(RACINE, 'data', 'references.json')).references;
    // Règles de qualité (E-09) : du serveur commun (M-04) ou du dépôt ; une règle invalide est écartée et signalée.
    await alignerSaisies(db);
    const regles = await reglesAControler(db);
    const lecture = await lireServeur(db, { references, regles });
    vuesConnues = new Set([...lecture.vues.map(v => v.vue), ...(lecture.fonctions ?? []).map(f => f.fonction)]);
    const changes = [];
    mkdirSync(DECL, { recursive: true });
    // Lecture du serveur : declarations/<outil>.serveur.json, à côté de la déclaration envoyée par l'outil
    // (<outil>.json) ; le collecteur fait passer le serveur en premier (E-14). Une ancienne lecture du serveur écrite
    // dans <outil>.json (avant le 31/10/2026) est déplacée.
    // Migrations (E-06) : nouvelles migrations appliquées, ou structure changée sans migration, d'une lecture à l'autre.
    const suivi = [];
    for (const d of declarations(lecture)) {
      const file = join(DECL, `${d.app}.serveur.json`), ancien = join(DECL, `${d.app}.json`);
      if (existsSync(ancien) && lireJson(ancien).origine === 'serveur') { unlinkSync(ancien); changes.push(d.app); }
      const avant = existsSync(file) ? lireJson(file) : null;
      const { evenements, horsMigration } = suivreMigrations(avant, d, lecture.luLe);
      suivi.push(...evenements);
      if (horsMigration) d.horsMigration = horsMigration;
      if (avant && avant.empreinte === d.empreinte && JSON.stringify(avant.migrations ?? null) === JSON.stringify(d.migrations ?? null)
          && JSON.stringify(avant.horsMigration ?? null) === JSON.stringify(d.horsMigration ?? null)) continue;
      ecrireJson(file, d);
      if (avant?.empreinte !== d.empreinte && !changes.includes(d.app)) changes.push(d.app);
    }
    // Colonnes sensibles lues sur le serveur (E-08) : une liste changée recalcule le catalogue.
    let sensiblesChangees = false;
    if (!lecture.sensiblesErreur) {
      const colonnes = sensiblesDuServeur(lecture.sensibles), f = join(DATA, 'sensibles.json');
      if (!existsSync(f) || JSON.stringify(lireJson(f).colonnes) !== JSON.stringify(colonnes)) {
        ecrireJson(f, { luLe: lecture.luLe, colonnes });
        sensiblesChangees = true;
      }
    } else console.warn(`colonnes sensibles du serveur illisibles (${lecture.sensiblesErreur}) : liste précédente gardée`);
    const { events } = changes.length || sensiblesChangees ? rafraichir() : { events: [] };
    if (suivi.length) ajouterHistorique(suivi);
    await alignerHistoriqueServeur(db);
    const horsMigration = Object.fromEntries(declarations(lecture).map(d => {
      const f = join(DECL, `${d.app}.serveur.json`);
      return [d.app, existsSync(f) ? lireJson(f).horsMigration ?? null : null];
    }));
    const sante = calculerSante(lecture, { catalogue: lireJson(join(DATA, 'catalogue.json')), edition: chargerEdition(DATA), horsMigration });
    // Incidents de qualité : ouverts au premier constat, clos au premier contrôle conforme (data/incidents-qualite.json).
    const fichierIncidents = join(DATA, 'incidents-qualite.json');
    const incidents = suivreIncidents(existsSync(fichierIncidents) ? lireJson(fichierIncidents) : null, lecture.qualite ?? [], lecture.luLe);
    ecrireJson(fichierIncidents, incidents);
    sante.incidentsQualite = incidents.incidents;
    ecrireJson(join(DATA, 'sante.json'), sante);
    page = null;
    sonde = { ...sonde, derniere: lecture.luLe, erreur: null, declencheur, outils: Object.keys(lecture.outils), schemasModifies: changes, changements: events.length, etat: sante.etat };
    console.log(`[${lecture.luLe}] sonde (${declencheur}) : ${Object.keys(lecture.outils).join(', ') || 'aucun outil'} · ${events.length} changement(s) · état ${sante.etat}`);
  } catch (e) {
    sonde = { ...sonde, erreur: e.message, erreurLe: new Date().toISOString() };
    console.error(`sonde du serveur commun : ${e.message}`);
  } finally {
    sonde = { ...sonde, enCours: false };
    await db.end().catch(() => {});
  }
  return sonde;
}

async function deciderLien(corps, auteur) {
  if (!DB_URL) throw new Error('MATRIX_DATABASE_URL n’est pas défini : le registre des liens est sur le serveur commun.');
  if (!vuesConnues) await synchroniser('avant une décision');
  const lien = validerLien(corps ?? {}, vuesConnues);
  const db = client(DB_URL);
  try { await db.connect(); var ecrit = await ecrireLien(db, lien, auteur); } finally { await db.end().catch(() => {}); }
  // M-18 : la décision est appliquée tout de suite par matrix_gestion ; sinon par appliquer-liens.sh (15 minutes).
  ecrit.application = GESTION_URL
    ? await avecGestion(db => appliquerLien(db, lien)).catch(e => ({ applique: false, raison: e.message }))
    : { applique: false, raison: 'MATRIX_GESTION_DATABASE_URL absent : appliqué par appliquer-liens.sh dans les 15 minutes' };
  await synchroniser('décision sur un lien');
  return ecrit;
}

const lireSante = () => existsSync(join(DATA, 'sante.json')) ? lireJson(join(DATA, 'sante.json')) : null;

// ── Déclarations ─────────────────────────────────────────────────────────

function jetonValide(req) {
  const recu = String(req.headers['x-matrix-token'] ?? String(req.headers.authorization ?? '').replace(/^Bearer /, ''));
  const a = Buffer.from(recu), b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function valider(doc) {
  if (doc?.schema !== 'matrix.schema/1') return 'schema doit valoir matrix.schema/1';
  if (!APPS.includes(doc.app)) return `outil inconnu : ${doc.app}`;
  if (!Array.isArray(doc.tables)) return 'tables doit être un tableau';
  for (const t of doc.tables) {
    if (typeof t?.name !== 'string' || !/^\w+$/.test(t.name)) return `nom de table invalide : ${t?.name}`;
    if (!Array.isArray(t.columns) || !Array.isArray(t.fks ?? []) || !Array.isArray(t.pk ?? []) || !Array.isArray(t.uniques ?? [])) return `table ${t.name} : structure incomplète`;
    for (const c of t.columns) if (typeof c?.name !== 'string' || !/^\w+$/.test(c.name)) return `table ${t.name} : nom de colonne invalide`;
  }
  return null;
}

function recevoir(doc) {
  const file = join(DECL, `${doc.app}.json`);
  if (doc.empreinte && existsSync(file) && lireJson(file).empreinte === doc.empreinte) return { app: doc.app, inchange: true, nouvellesTables: [], changements: [] };
  const tables = doc.tables.map(t => ({ name: t.name, columns: t.columns, pk: t.pk ?? [], fks: t.fks ?? [], uniques: t.uniques ?? [] }));
  ecrireJson(file, { schema: doc.schema, app: doc.app, version: doc.version ?? null, declareLe: doc.declareLe ?? new Date().toISOString(), empreinte: doc.empreinte ?? null, tables });
  const { events } = rafraichir();
  const miens = events.filter(e => e.app === doc.app);
  console.log(`[${new Date().toISOString()}] déclaration de ${doc.app} : ${tables.length} tables, ${miens.length} changement(s)`);
  return { app: doc.app, inchange: false, nouvellesTables: miens.filter(e => e.type === 'table_ajoutee').map(e => e.table), changements: miens };
}

// ── Accès ─────────────────────────────────────────────────────────────────

const connexions = limiteur();
const adresse = req => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?';
const enHttps = req => String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';

// Renvoie la personne connectée { nom, role, via }, ou null si l'accès est refusé. Rôles : admin (la DSI, qui modifie,
// M-04) ou lecture (consultation seule). Sans mot de passe ni Entra ID, l'accès est libre (nom vide, rôle admin ;
// en production, les modifications restent refusées). Un en-tête Basic valide (scripts) vaut administrateur ; sinon la
// session décide : celle d'Entra ID quand il est configuré, celle de la page à mot de passe sinon.
function utilisateur(req) {
  if (!ACCES_RESERVE) return { nom: '', role: 'admin', via: 'libre' };
  const basic = MOT_DE_PASSE ? identifiantBasic(req.headers.authorization, MOT_DE_PASSE) : null;
  if (basic) return { nom: basic, role: 'admin', via: 'basic' };
  const cookie = lireCookie(req.headers.cookie, COOKIE);
  if (ENTRA.active) {
    const s = lireJeton(cookie, ENTRA.secret);
    return s?.n && ['admin', 'lecture'].includes(s.r) ? { nom: s.n, role: s.r, via: 'entra', oid: s.o } : null;
  }
  const nom = lireSession(cookie, MOT_DE_PASSE);
  return nom ? { nom, role: 'admin', via: 'mot de passe' } : null;
}

// Connexion par Microsoft Entra ID : /auth/entra part chez Microsoft (contrôles gardés 10 minutes dans un cookie signé),
// /auth/retour contrôle la réponse, lit le rôle applicatif et ouvre la session (cookie signé, 12 heures).
async function routeEntra(req, res, url) {
  const secure = enHttps(req) || ENTRA.publicUrl.startsWith('https://');
  if (url.pathname === '/auth/entra') {
    try {
      const { url: vers, controle } = await debutConnexion(ENTRA);
      res.writeHead(302, { ...ENTETES, location: vers.href, 'cache-control': 'no-store',
        'set-cookie': enteteCookie(creerJeton({ ...controle, suite: suiteSure(url.searchParams.get('suite')) }, ENTRA.secret, 600), { secure, maxAge: 600, nom: COOKIE_OIDC }) });
      return res.end();
    } catch (e) {
      console.error(`connexion Entra ID : ${e.message}`);
      return html(res, 502, pageConnexion({ entra: true, erreur: 'Microsoft Entra ID ne répond pas : réessayez dans un instant.' }));
    }
  }
  // Retour de Microsoft.
  const effacer = enteteCookie('', { secure, maxAge: 0, nom: COOKIE_OIDC });
  const controle = lireJeton(lireCookie(req.headers.cookie, COOKIE_OIDC), ENTRA.secret);
  if (url.searchParams.get('error')) {
    console.warn(`[${new Date().toISOString()}] connexion Entra ID refusée par Microsoft : ${url.searchParams.get('error')} ${url.searchParams.get('error_description') ?? ''}`);
    return html(res, 403, pageConnexion({ entra: true, erreur: `Microsoft a refusé la connexion (${String(url.searchParams.get('error_description') ?? url.searchParams.get('error')).split(/\r?\n/)[0].slice(0, 200)}).` }), { 'set-cookie': effacer });
  }
  if (!controle) return html(res, 400, pageConnexion({ entra: true, erreur: 'La connexion a expiré ou a été ouverte dans un autre onglet : recommencez.' }), { 'set-cookie': effacer });
  try {
    const c = await finConnexion(ENTRA, url.search, controle);
    const p = personneDepuisJeton(c), role = roleDepuisEntra(c.roles, ENTRA);
    if (!role) {
      console.warn(`[${new Date().toISOString()}] connexion Entra ID refusée pour « ${p.nom} » (${p.oid}) : aucun rôle Matrix`);
      return html(res, 403, pageConnexion({ entra: true, refus: true }), { 'set-cookie': effacer });
    }
    console.log(`[${new Date().toISOString()}] connexion Entra ID de « ${p.nom} » (${role}) depuis ${adresse(req)}`);
    res.writeHead(303, { ...ENTETES, location: suiteSure(controle.suite), 'cache-control': 'no-store',
      'set-cookie': [effacer, enteteCookie(creerJeton({ n: p.nom, r: role, o: p.oid }, ENTRA.secret, DUREE_SESSION_S), { secure })] });
    return res.end();
  } catch (e) {
    console.warn(`[${new Date().toISOString()}] connexion Entra ID en échec : ${e.message}`);
    return html(res, 401, pageConnexion({ entra: true, erreur: 'La connexion n’a pas pu être vérifiée : recommencez.' }), { 'set-cookie': effacer });
  }
}

// Corps d'un formulaire HTML (application/x-www-form-urlencoded), 16 Ko au plus.
function lireFormulaire(req, res, suite) {
  let taille = 0; const morceaux = [];
  req.on('data', m => { taille += m.length; if (taille > 16384) { res.writeHead(413).end(); req.destroy(); } else morceaux.push(m); });
  req.on('end', () => { if (!res.writableEnded) suite(new URLSearchParams(Buffer.concat(morceaux).toString('utf8'))); });
}

const html = (res, code, corps, entetes = {}) => { res.writeHead(code, { ...ENTETES, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...entetes }); res.end(corps); };

// GET /connexion (page), POST /connexion (vérification, cookie), GET /deconnexion.
function routeConnexion(req, res, url) {
  if (url.pathname === '/deconnexion') {
    res.writeHead(303, { ...ENTETES, location: '/connexion', 'set-cookie': enteteCookie('', { secure: enHttps(req), maxAge: 0 }) });
    return res.end();
  }
  if (!ACCES_RESERVE) { res.writeHead(303, { ...ENTETES, location: '/' }); return res.end(); }
  if (ENTRA.active) return req.method === 'GET' ? html(res, 200, pageConnexion({ entra: true, suite: url.searchParams.get('suite') ?? '/' })) : json(res, 405, { erreur: 'connexion par Microsoft Entra ID' });
  if (req.method === 'GET') return html(res, 200, pageConnexion({ suite: url.searchParams.get('suite') ?? '/' }));
  if (req.method !== 'POST') return json(res, 405, { erreur: 'méthode non autorisée' });
  const origine = req.headers.origin;
  if (origine && origine !== 'null' && new URL(origine).host !== req.headers.host) return json(res, 403, { erreur: 'origine refusée' });
  lireFormulaire(req, res, f => {
    const ip = adresse(req);
    const identifiant = (f.get('identifiant') ?? '').trim().slice(0, 120);
    const suite = suiteSure(f.get('suite'));
    if (connexions.bloque(ip)) {
      console.warn(`[${new Date().toISOString()}] connexion bloquée (trop d'échecs) depuis ${ip}`);
      return html(res, 429, pageConnexion({ erreur: 'Trop de tentatives : réessayez dans un quart d’heure.', suite, identifiant }));
    }
    const mdp = f.get('mot_de_passe') ?? '';
    if (!identifiant || !motDePasseValide(mdp, MOT_DE_PASSE)) {
      connexions.echec(ip);
      console.warn(`[${new Date().toISOString()}] connexion refusée pour « ${identifiant || '(vide)'} » depuis ${ip} : ${identifiant ? 'mot de passe incorrect' : 'identifiant vide'}`);
      return html(res, 401, pageConnexion({ erreur: identifiant ? 'Mot de passe incorrect.' : 'Indiquez votre identifiant.', suite, identifiant }));
    }
    connexions.reussite(ip);
    console.log(`[${new Date().toISOString()}] connexion de « ${identifiant} » depuis ${ip}`);
    res.writeHead(303, { ...ENTETES, location: suite, 'set-cookie': enteteCookie(creerSession(identifiant, MOT_DE_PASSE), { secure: enHttps(req) }) });
    res.end();
  });
}

function lireCorps(req, res, suite) {
  let taille = 0; const morceaux = [];
  req.on('data', m => { taille += m.length; if (taille > MAX_OCTETS) { json(res, 413, { erreur: 'requête trop volumineuse' }); req.destroy(); } else morceaux.push(m); });
  req.on('end', () => {
    if (res.writableEnded) return;
    let corps;
    try { corps = JSON.parse(Buffer.concat(morceaux).toString('utf8')); } catch { return json(res, 400, { erreur: 'JSON invalide' }); }
    suite(corps);
  });
}

// ── HTTP ─────────────────────────────────────────────────────────────────

const require = createRequire(import.meta.url);
let cytoscape = null;
try { cytoscape = readFileSync(require.resolve('cytoscape/dist/cytoscape.min.js')); } catch { console.warn('cytoscape introuvable : lancez npm install (le graphe ne s’affichera pas).'); }

const ENTETES = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'SAMEORIGIN' };
const json = (res, code, corps) => { res.writeHead(code, { ...ENTETES, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(corps)); };

const demarrage = rafraichir();

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/connexion' || url.pathname === '/deconnexion') return routeConnexion(req, res, url);
    if (ENTRA.active && req.method === 'GET' && (url.pathname === '/auth/entra' || url.pathname === CHEMIN_RETOUR)) { routeEntra(req, res, url).catch(e => { console.error(e); if (!res.headersSent) json(res, 500, { erreur: 'erreur interne' }); }); return; }
    const libre = url.pathname === '/api/sante' || (req.method === 'POST' && url.pathname === '/api/declarations') || url.pathname === '/api/demandes';
    const acces = libre ? { nom: '', role: 'lecture', via: 'libre' } : utilisateur(req);
    const qui = acces?.nom ?? null;
    if (acces === null) {
      // Jamais de WWW-Authenticate : le navigateur n'ouvre plus sa fenêtre d'identification (elle revenait en boucle
      // quand le mot de passe ne correspondait pas). Une page demandée par le navigateur mène à /connexion.
      if (req.method === 'GET' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/vendor/')) {
        res.writeHead(303, { ...ENTETES, location: `/connexion?suite=${encodeURIComponent(url.pathname + url.search)}`, 'cache-control': 'no-store' });
        return res.end();
      }
      if (req.headers.authorization) console.warn(`[${new Date().toISOString()}] accès refusé à ${req.method} ${url.pathname} depuis ${adresse(req)} : en-tête Authorization invalide`);
      return json(res, 401, { erreur: 'Accès réservé : connectez-vous (/connexion) ou envoyez l’en-tête Authorization: Basic avec le mot de passe de Matrix.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/donnees') {
      // Visionneuse des données : réservée au rôle Administrateur (la DSI, M-04) ; lecture seule, colonnes ouvertes à
      // Matrix seulement ; chaque consultation est écrite dans le journal du conteneur.
      if (!DB_URL) return json(res, 409, { erreur: 'MATRIX_DATABASE_URL n’est pas défini : les données se lisent sur le serveur commun.' });
      if (acces.role !== 'admin') return json(res, 403, { erreur: 'La visionneuse des données est réservée au rôle Administrateur de Matrix (DSI).' });
      const q = Object.fromEntries(url.searchParams);
      avecServeur(db => lireDonnees(db, q)).then(r => {
        console.log(`[${new Date().toISOString()}] visionneuse : ${acces.nom || 'anonyme'} lit ${r.outil}.${r.table} (page ${r.page}${r.contient ? `, filtre sur ${r.colonne}` : ''})`);
        json(res, 200, r);
      }, e => json(res, e.code === 404 ? 404 : /invalide|inconnu|impossible/.test(e.message) ? 422 : 502, { erreur: e.message }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/moi') return json(res, 200, { nom: acces.nom, role: acces.role, via: acces.via, entra: ENTRA.active });
    if (req.method === 'GET' && url.pathname === '/api/edition') return json(res, 200, chargerEdition(DATA));
    const ref = url.pathname.match(/^\/api\/referentiels\/(sites|organigramme|pays|zones|filiales)$/);
    if (req.method === 'GET' && ref) return json(res, 200, chargerEdition(DATA).referentiels[ref[1]].filter(x => x.actif !== false || url.searchParams.get('tous') === '1'));
    if (req.method === 'GET' && url.pathname === '/api/etat') return json(res, 200, { sonde, referentiels, edition, historique, sante: lireSante() });
    if (req.method === 'GET' && url.pathname === '/api/qualite') {
      // Qualité des données (E-09) : règles, derniers résultats, incidents ouverts et clos.
      const s = lireSante();
      const reponse = (regles, source, erreur = null) => json(res, 200, { regles, source, erreur, modifiable: source === 'serveur', resultats: s?.qualite ?? [], incidents: s?.incidentsQualite ?? [], luLe: s?.luLe ?? null });
      if (DB_URL && saisies.actif) {
        avecServeur(db => lireReglesPg(db)).then(r => reponse(r, 'serveur'), e => json(res, 502, { erreur: e.message }));
        return;
      }
      try { return reponse(chargerRegles(lireJson(join(RACINE, 'data', 'regles-qualite.json'))).map(r => ({ ...r, actif: true })), 'fichier', saisies.erreur); }
      catch (e) { return reponse([], 'fichier', e.message); }
    }
    if (req.method === 'GET' && url.pathname === '/api/glossaire') {
      // Glossaire métier (E-08) : sur le serveur commun seulement.
      if (!DB_URL || !saisies.actif) return json(res, 200, { disponible: false, raison: DB_URL ? saisies.erreur ?? 'serveur commun pas encore lu' : 'MATRIX_DATABASE_URL absent : le glossaire est sur le serveur commun.', termes: [] });
      avecServeur(db => lireGlossaire(db)).then(t => json(res, 200, { disponible: true, termes: t }), e => json(res, 502, { erreur: e.message }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/liens') {
      const s = lireSante();
      return json(res, 200, { sonde, liens: s?.liens ?? [], journal: s?.journalLiens ?? [], etats: s?.etatsLien ?? {} });
    }
    // Catalogue en lecture et exports (E-12) : structure seulement, jamais de données des tables.
    if (req.method === 'GET' && (url.pathname.startsWith('/api/catalogue/') || url.pathname.startsWith('/api/export/'))) {
      const q = Object.fromEntries(url.searchParams);
      if (q.outil && !APPS.includes(q.outil)) return json(res, 404, { erreur: `outil inconnu : ${q.outil}` });
      const sante = lireSante();
      let liste = fichesCatalogue(lireJson(join(DATA, 'catalogue.json')), { edition: chargerEdition(DATA), sante, outil: q.outil || null });
      if (q.domaine) liste = liste.filter(f => f.domaine === q.domaine);
      if (q.q) {
        // Mêmes fiches que la recherche de la page (maquette/source.html, ficheRecherche) : flux et lectures compris.
        const flux = lireJson(join(EMBARQUE, 'flux.json')).flux ?? [];
        const fluxDe = f => flux.filter(x => (x.de === f.outil && x.source.includes(f.table)) || (x.vers === f.outil && x.cible.includes(f.table))).map(x => `${x.id} ${x.nom}`);
        const lectures = new Map((sante?.tables ?? []).map(s => [`${s.app}.${s.table}`, (s.stats?.lecturesSequentielles || 0) + (s.stats?.lecturesIndex || 0)]));
        const ordre = chercher(liste.map(f => ({ cle: f.cle, nom: f.table, domaine: f.domaine, description: f.description, documentation: { description: f.description, note: f.note, responsable: f.responsable },
          colonnes: f.colonnes.map(c => ({ nom: c.nom, description: c.description })), flux: fluxDe(f), lectures: lectures.get(f.cle) ?? 0 })), q.q);
        const par = new Map(liste.map(f => [f.cle, f]));
        liste = ordre.map(r => ({ ...par.get(r.cle), pertinence: r.score, trouvee_par: r.raisons }));
      }
      const fiche = url.pathname.match(/^\/api\/catalogue\/tables\/(\w+)\/(\w+)$/);
      if (fiche) {
        const f = liste.find(x => x.outil === fiche[1] && x.table === fiche[2]);
        if (!f) return json(res, 404, { erreur: 'table inconnue' });
        const s = sante?.tables?.find(t => t.app === f.outil && t.table === f.table);
        return json(res, 200, { ...f, sante: s ? { etat: s.etat, constats: s.constats, stats: s.stats } : null });
      }
      const nomFichier = n => `matrix-${q.outil || 'tous-les-outils'}${q.domaine ? '-' + q.domaine.normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase() : ''}-${n}`;
      const fichier = (type, nom, corps) => { res.writeHead(200, { ...ENTETES, 'content-type': type, 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${nomFichier(nom)}"` }); res.end(corps); };
      if (url.pathname === '/api/catalogue/tables')
        return json(res, 200, liste.map(({ colonnes, liens, publiee_par, unicites, ...f }) => ({ ...f, colonnes: colonnes.length, liens: liens.length, publiee_par: publiee_par.map(v => v.vue) })));
      if (url.pathname === '/api/export/tables.csv') return fichier('text/csv; charset=utf-8', 'tables.csv', csvTables(liste));
      if (url.pathname === '/api/export/colonnes.csv') return fichier('text/csv; charset=utf-8', 'colonnes.csv', csvColonnes(liste));
      if (url.pathname === '/api/export/schema.mmd') return fichier('text/plain; charset=utf-8', 'schema.mmd', diagrammeMermaid(liste));
      if (url.pathname === '/api/export/dictionnaire.html') {
        res.writeHead(200, { ...ENTETES, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(dictionnaireHtml(liste, { titre: `Dictionnaire des données${q.outil ? ' · ' + q.outil : ''}${q.domaine ? ' · ' + q.domaine : ''}` }));
      }
      return json(res, 404, { erreur: 'introuvable' });
    }
    // Dépôt des demandes (data/publications-depot.json) : leur état face au registre, pour l'écran Publications.
    if (req.method === 'GET' && url.pathname === '/api/publications/depot') {
      const depot = lireJson(join(EMBARQUE, 'publications-depot.json'));
      if (!DB_URL) return json(res, 200, { serveur: false, ...depot });
      avecServeur(db => etatDepot(db, depot)).then(r => json(res, 200, { serveur: true, gestion: Boolean(GESTION_URL), ...r }), e => json(res, 502, { erreur: e.message }));
      return;
    }
    // Publications (M-18) : lecture du registre en matrix_app.
    const publication = url.pathname.match(/^\/api\/publications(?:\/([a-z]+\.pub_[a-z0-9_]+))?(?:\/(appliquer|retirer))?$/);
    if (req.method === 'GET' && publication && !publication[2]) {
      if (!DB_URL) return json(res, 409, { erreur: 'MATRIX_DATABASE_URL n’est pas défini : les publications sont sur le serveur commun.' });
      const lire = publication[1] ? db => lirePublication(db, publication[1]) : db => listerPublications(db);
      avecServeur(lire).then(r => r ? json(res, 200, { gestion: Boolean(GESTION_URL), ...(publication[1] ? { publication: r } : r) }) : json(res, 404, { erreur: 'publication inconnue' }),
        e => json(res, e.code ? 502 : 422, { erreur: e.message }));
      return;
    }
    const consultation = url.pathname.match(/^\/api\/(journal|rex|correspondances)$/);
    if (req.method === 'GET' && consultation) {
      if (!DB_URL) return json(res, 409, { erreur: 'MATRIX_DATABASE_URL n’est pas défini : le journal, le REX et les correspondances sont sur le serveur commun.' });
      const q = Object.fromEntries(url.searchParams);
      const lire = { journal: db => lireJournal(db, { ...q, apres: q.apres_quand ? { quand: q.apres_quand, ref_source: q.apres_ref } : null }), rex: db => lireRex(db, q), correspondances: db => lireCorrespondances(db, q) }[consultation[1]];
      avecServeur(lire).then(r => json(res, 200, r), e => json(res, /date|outil|pagination/.test(e.message) && !e.code ? 422 : 502, { erreur: e.message }));
      return;
    }
    const saisieDsi = req.method === 'PUT' && (url.pathname === '/api/glossaire' || url.pathname === '/api/qualite/regles');
    const ecriture = saisieDsi || (req.method === 'PUT' && (ref || url.pathname === '/api/documentation' || url.pathname === '/api/decisions' || (publication?.[1] && !publication[2])))
      || (req.method === 'POST' && (url.pathname === '/api/liens' || url.pathname === '/api/synchro' || url.pathname === '/api/correspondances' || publication?.[2]));
    if (ecriture) {
      if (PRODUCTION && !ACCES_RESERVE) return json(res, 403, { erreur: 'Définissez MATRIX_MOT_DE_PASSE ou Microsoft Entra ID sur le serveur pour autoriser les modifications.' });
      if (acces.role !== 'admin') return json(res, 403, { erreur: 'Consultation seule : les modifications sont réservées au rôle Administrateur de Matrix (DSI, décision M-04).' });
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { erreur: 'contenu JSON attendu' });
      const origine = req.headers.origin;
      if (origine && new URL(origine).host !== req.headers.host) return json(res, 403, { erreur: 'origine refusée' });
      const auteur = qui || 'anonyme';
      // Glossaire et règles de qualité (M-04 : la DSI seule, c'est-à-dire les personnes qui ont le mot de passe de Matrix).
      if (saisieDsi) return lireCorps(req, res, async corps => {
        try {
          if (!DB_URL || !saisies.actif) return json(res, 409, { erreur: `Glossaire et règles de qualité sont saisis sur le serveur commun : ${DB_URL ? saisies.erreur ?? 'serveur pas encore lu' : 'MATRIX_DATABASE_URL absent'}.` });
          if (url.pathname === '/api/glossaire') return json(res, 200, { ok: true, terme: await avecServeur(db => enregistrerTerme(db, lireJson(join(DATA, 'catalogue.json')), corps ?? {}, auteur)) });
          const regle = await avecServeur(db => enregistrerRegle(db, corps ?? {}, auteur));
          synchroniser('règle de qualité modifiée').catch(() => {});
          json(res, 200, { ok: true, regle });
        } catch (e) { json(res, e.code === 'conflit' ? 409 : 422, { erreur: e.message, ...(e.code === 'conflit' ? { actuel: e.actuel } : {}) }); }
      });
      if (publication?.[1]) return lireCorps(req, res, async corps => {
        try {
          if (!DB_URL) return json(res, 409, { erreur: 'MATRIX_DATABASE_URL n’est pas défini : les publications sont sur le serveur commun.' });
          const vue = publication[1];
          if (req.method === 'PUT') return json(res, 200, { ok: true, publication: await avecServeur(db => enregistrerPublication(db, { ...(corps ?? {}), vue }, auteur)) });
          if (!GESTION_URL) return json(res, 409, { erreur: 'MATRIX_GESTION_DATABASE_URL n’est pas défini : Matrix ne peut pas appliquer les publications (rôle matrix_gestion).' });
          const r = publication[2] === 'appliquer'
            ? await avecGestion(db => appliquerPublication(db, vue, auteur))
            : await avecGestion(db => retirerPublication(db, vue, auteur, corps?.motif));
          await synchroniser(`publication ${vue}`);
          json(res, 200, { ok: true, resultat: r });
        } catch (e) { json(res, 422, { erreur: e.message }); }
      });
      if (req.method === 'POST') return lireCorps(req, res, async corps => {
        try {
          if (url.pathname === '/api/synchro') {
            if (!DB_URL) return json(res, 409, { erreur: 'MATRIX_DATABASE_URL n’est pas défini : pas de serveur commun à lire.' });
            const r = await synchroniser(`demandée par ${auteur}`);
            return json(res, r.erreur ? 502 : 200, { sonde: r, sante: lireSante() });
          }
          if (url.pathname === '/api/correspondances') {
            if (!DB_URL) return json(res, 409, { erreur: 'MATRIX_DATABASE_URL n’est pas défini : les correspondances sont sur le serveur commun.' });
            return json(res, 200, { ok: true, correspondance: await avecServeur(db => deciderCorrespondance(db, corps ?? {}, auteur)) });
          }
          const lien = await deciderLien(corps, auteur);
          json(res, 200, { ok: true, lien, sonde, liens: lireSante()?.liens ?? [] });
        } catch (e) { json(res, 422, { erreur: e.message }); }
      });
      return lireCorps(req, res, async corps => {
        try {
          let r;
          if (ref) r = await ecrireReferentiel(ref[1], corps, auteur);
          else if (url.pathname === '/api/documentation') r = await ecrireSaisie('documentation', corps ?? {}, auteur);
          else r = await ecrireSaisie('decision', corps ?? {}, auteur);
          page = null;
          json(res, 200, { ok: true, resultat: r, edition: chargerEdition(DATA) });
        } catch (e) { json(res, e.code === 'conflit' ? 409 : 422, { erreur: e.message, ...(e.code === 'conflit' ? { actuel: e.actuel } : {}) }); }
      });
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { ...ENTETES, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(pageCourante());
    }
    if (req.method === 'GET' && url.pathname === '/vendor/cytoscape.min.js' && cytoscape) {
      res.writeHead(200, { ...ENTETES, 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=604800, immutable' });
      return res.end(cytoscape);
    }
    if (req.method === 'GET' && url.pathname === '/api/sante') {
      const c = lireJson(join(DATA, 'catalogue.json'));
      return json(res, 200, { ok: true, tables: c.apps.reduce((n, a) => n + a.tables.length, 0), collecteLe: c.generatedAt, declarations: TOKEN ? 'actives' : 'désactivées (MATRIX_TOKEN absent)',
        sonde: DB_URL ? { derniere: sonde.derniere, erreur: sonde.erreur, etat: sonde.etat } : 'désactivée (MATRIX_DATABASE_URL absent)',
        glossaire: DB_URL ? (saisies.actif ? 'serveur commun (matrix.glossaire, matrix.regles_qualite)' : `indisponible${saisies.erreur ? ` (${saisies.erreur})` : ''}`) : 'indisponible (MATRIX_DATABASE_URL absent)',
        historique: DB_URL ? (historique.actif ? 'serveur commun (matrix.historique_schemas)' : `historique.json${historique.erreur ? ` (${historique.erreur})` : ''}`) : 'historique.json',
        saisies: edition.actif ? 'serveur commun (matrix.documentation, decisions_doublons, journal)' : `edition.json${edition.erreur ? ` (${edition.erreur})` : ''}`,
        referentiels: DB_URL ? { alignesLe: referentiels.alignesLe, ecarts: Object.keys(referentiels.ecarts).filter(l => referentiels.ecarts[l]), erreur: referentiels.erreur } : 'dans edition.json (MATRIX_DATABASE_URL absent)' });
    }
    if (req.method === 'GET' && url.pathname === '/api/catalogue') return json(res, 200, lireJson(join(DATA, 'catalogue.json')));
    if (req.method === 'GET' && url.pathname === '/api/declarations') {
      // Par outil, la lecture du serveur et la déclaration de l'outil, quand elles existent.
      return json(res, 200, APPS.flatMap(a => [`${a}.serveur.json`, `${a}.json`].filter(f => existsSync(join(DECL, f))).map(f => {
        const d = lireJson(join(DECL, f));
        return { app: a, origine: d.origine ?? 'outil', declareLe: d.declareLe, version: d.version, empreinte: d.empreinte, tables: d.tables.length };
      })));
    }
    // Demandes d'accès des outils (E-10), avec le jeton MATRIX_TOKEN : POST pour demander, GET pour suivre ses demandes.
    if (url.pathname === '/api/demandes') {
      if (!TOKEN) return json(res, 503, { erreur: 'MATRIX_TOKEN n’est pas défini sur le serveur Matrix : les demandes des outils sont désactivées.' });
      if (!jetonValide(req)) return json(res, 401, { erreur: 'jeton manquant ou invalide' });
      if (!DB_URL) return json(res, 409, { erreur: 'MATRIX_DATABASE_URL n’est pas défini : le registre des liens est sur le serveur commun.' });
      if (req.method === 'GET') {
        const outil = url.searchParams.get('outil') ?? '';
        if (!APPS.includes(outil)) return json(res, 422, { erreur: `outil inconnu : « ${outil} »` });
        avecServeur(db => liensDuLecteur(db, `${outil}_app`)).then(l => json(res, 200, { outil, liens: l }), e => json(res, 502, { erreur: e.message }));
        return;
      }
      if (req.method !== 'POST') return json(res, 405, { erreur: 'GET ou POST' });
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(res, 415, { erreur: 'contenu JSON attendu' });
      return lireCorps(req, res, async corps => {
        let lien;
        try { lien = validerDemande(corps ?? {}); } catch (e) { return json(res, 422, { erreur: e.message }); }
        try {
          const outil = lien.lecteur.replace(/_app$/, '');
          const r = await avecServeur(db => demanderLien(db, lien, `${outil} (API)`));
          if (!r.inchange) {
            console.log(`[${new Date().toISOString()}] demande d'accès de ${outil} : ${lien.vue} (${lien.nature})`);
            if (edition.actif) await avecServeur(db => journaliserPg(db, { qui: `${outil} (API)`, action: 'Demande d’accès reçue', objet: `${lien.lecteur} → ${lien.vue}`, detail: lien.motif })).catch(() => {});
            synchroniser('demande d’accès d’un outil').catch(() => {});
          }
          json(res, r.inchange ? 200 : 201, { demande: r, message: r.inchange ? 'lien déjà autorisé : rien à demander' : 'demande enregistrée : la DSI la tranche dans Matrix (« Liens entre outils »)' });
        } catch (e) { json(res, 502, { erreur: e.message }); }
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/declarations') {
      if (!TOKEN) return json(res, 503, { erreur: 'MATRIX_TOKEN n’est pas défini sur le serveur Matrix : les déclarations sont désactivées.' });
      if (!jetonValide(req)) return json(res, 401, { erreur: 'jeton manquant ou invalide' });
      let taille = 0; const morceaux = [];
      req.on('data', m => { taille += m.length; if (taille > MAX_OCTETS) { json(res, 413, { erreur: 'déclaration trop volumineuse' }); req.destroy(); } else morceaux.push(m); });
      req.on('end', () => {
        if (res.writableEnded) return;
        let doc;
        try { doc = JSON.parse(Buffer.concat(morceaux).toString('utf8')); } catch { return json(res, 400, { erreur: 'JSON invalide' }); }
        const erreur = valider(doc);
        if (erreur) return json(res, 422, { erreur });
        try { json(res, 200, recevoir(doc)); } catch (e) { console.error(e); json(res, 500, { erreur: 'échec de l’enregistrement de la déclaration' }); }
      });
      return;
    }
    json(res, 404, { erreur: 'introuvable' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { erreur: 'erreur interne' });
  }
}).listen(PORT, '0.0.0.0', () => {
  const { catalogue, events } = demarrage;
  const n = catalogue.apps.reduce((s, a) => s + a.tables.length, 0);
  console.log(`Matrix écoute sur le port ${PORT} · ${n} tables · données dans ${DATA}${events.length ? ` · ${events.length} changement(s) depuis la dernière collecte` : ''}`);
  for (const a of AVERTISSEMENTS_MDP) console.warn(a);
  if (ENTRA.active) console.log(`Connexion par Microsoft Entra ID (émetteur ${ENTRA.issuer}, rôles ${ENTRA.roleAdmin} et ${ENTRA.roleLecture}).`);
  else if (ENTRA.erreurs.length) console.warn(`Microsoft Entra ID non activé, configuration incomplète : ${ENTRA.erreurs.join(' ; ')}.`);
  if (!TOKEN) console.warn('MATRIX_TOKEN absent : les outils ne peuvent pas déclarer leurs tables.');
  if (DB_URL) {
    setTimeout(() => synchroniser('démarrage'), 1000).unref();
    if (SYNCHRO_MINUTES) setInterval(() => synchroniser('planifiée'), SYNCHRO_MINUTES * 60000).unref();
  } else console.warn('MATRIX_DATABASE_URL absent : la sonde du serveur commun est désactivée.');
});
