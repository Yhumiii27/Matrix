// Ce que le service informatique saisit dans Matrix : documentation des tables, décisions sur les doublons,
// référentiels publiés (sites, organigramme, pays, zones et filiales du groupe) et journal des modifications.
//
// Tout est enregistré dans un seul fichier, <MATRIX_DATA_DIR>/edition.json, écrit de façon atomique (fichier
// temporaire puis renommage). Les référentiels partent de data/referentiels.json tant que rien n'a été saisi.
// Les règles de validation reprennent les contraintes du schéma matrix (infra/postgres/partage/10-matrix-referentiels.sql),
// pour que ce qui est saisi ici puisse y être chargé tel quel.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE } from './page.mjs';

const APPS = ['keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible'];
const JOURNAL_MAX = 2000;
const lire = f => JSON.parse(readFileSync(f, 'utf8'));

export function chargerEdition(dataDir) {
  const f = join(dataDir, 'edition.json');
  const e = existsSync(f) ? lire(f) : {};
  const depart = lire(join(RACINE, 'data/referentiels.json'));
  return {
    documentation: e.documentation ?? {},
    decisions: e.decisions ?? {},
    referentiels: {
      sites: e.referentiels?.sites ?? depart.sites,
      organigramme: e.referentiels?.organigramme ?? depart.organigramme,
      pays: e.referentiels?.pays ?? depart.pays,
      zones: e.referentiels?.zones ?? depart.zones ?? [],
      filiales: e.referentiels?.filiales ?? depart.filiales ?? [],
    },
    journal: e.journal ?? [],
  };
}

function enregistrer(dataDir, ed) {
  const f = join(dataDir, 'edition.json');
  writeFileSync(f + '.tmp', JSON.stringify(ed, null, 1));
  renameSync(f + '.tmp', f);
}

function tracer(ed, qui, action, objet, detail = '') {
  ed.journal.push({ quand: new Date().toISOString(), qui, action, objet, detail });
  if (ed.journal.length > JOURNAL_MAX) ed.journal.splice(0, ed.journal.length - JOURNAL_MAX);
}

const texte = (v, max, champ) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw new Error(`${champ} doit être un texte`);
  const t = v.trim();
  if (t.length > max) throw new Error(`${champ} : ${max} caractères au plus`);
  return t || null;
};

// ── Documentation d'une table ────────────────────────────────────────────

export function documenter(dataDir, catalogue, { app, table, description, domaine, responsable, note }, qui) {
  if (!APPS.includes(app)) throw new Error(`outil inconnu : ${app}`);
  if (!catalogue.apps.find(a => a.id === app)?.tables.some(t => t.name === table)) throw new Error(`table inconnue : ${app}.${table}`);
  const fiche = {
    description: texte(description, 2000, 'La description'),
    domaine: texte(domaine, 80, 'Le domaine'),
    responsable: texte(responsable, 120, 'Le responsable'),
    note: texte(note, 4000, 'La note'),
  };
  const ed = chargerEdition(dataDir);
  const cle = `${app}.${table}`;
  const avant = ed.documentation[cle] ?? {};
  const changes = Object.keys(fiche).filter(k => (avant[k] ?? null) !== fiche[k]);
  if (!changes.length) return ed.documentation[cle] ?? null;
  ed.documentation[cle] = { ...fiche, majLe: new Date().toISOString(), majPar: qui };
  tracer(ed, qui, 'Table documentée', cle, changes.join(', '));
  enregistrer(dataDir, ed);
  return ed.documentation[cle];
}

// ── Décision sur un groupe de doublons ───────────────────────────────────

export function decider(dataDir, { id, option }, qui) {
  const { groupes } = lire(join(RACINE, 'data/doublons.json'));
  const g = groupes.find(x => x.id === id);
  if (!g) throw new Error(`groupe de doublons inconnu : ${id}`);
  if (option != null && !g.options.some(o => o.id === option)) throw new Error(`option inconnue pour ${id} : ${option}`);
  const ed = chargerEdition(dataDir);
  if (option == null) delete ed.decisions[id];
  else ed.decisions[id] = { option, le: new Date().toISOString(), par: qui };
  tracer(ed, qui, option == null ? 'Décision retirée' : 'Décision enregistrée', id, option ? `option ${option} · ${g.options.find(o => o.id === option).libelle}` : '');
  enregistrer(dataDir, ed);
  return ed.decisions[id] ?? null;
}

// ── Référentiels ─────────────────────────────────────────────────────────

const bool = v => v === true || v === 'true';
const entier = (v, champ) => { const n = Number(v ?? 0); if (!Number.isInteger(n)) throw new Error(`${champ} doit être un nombre entier`); return n; };

function validerPays(lignes) {
  const vus = new Set();
  return lignes.map((p, i) => {
    const iso2 = String(p.iso2 ?? '').trim().toUpperCase(), iso3 = String(p.iso3 ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(iso2)) throw new Error(`Pays ligne ${i + 1} : le code ISO à 2 lettres est obligatoire`);
    if (!/^[A-Z]{3}$/.test(iso3)) throw new Error(`Pays ${iso2} : le code ISO à 3 lettres est obligatoire`);
    if (vus.has(iso2)) throw new Error(`Pays ${iso2} en double`);
    vus.add(iso2);
    const nom_fr = texte(p.nom_fr, 80, `Pays ${iso2}, nom français`), nom_en = texte(p.nom_en, 80, `Pays ${iso2}, nom anglais`);
    if (!nom_fr || !nom_en) throw new Error(`Pays ${iso2} : les noms français et anglais sont obligatoires`);
    return { iso2, iso3, nom_fr, nom_en, actif: bool(p.actif ?? true) };
  });
}

function validerSites(lignes, pays, filiales = []) {
  const iso = new Set(pays.map(p => p.iso2)), fil = new Set(filiales.map(f => f.code)), vus = new Set();
  return lignes.map((s, i) => {
    const code = String(s.code ?? '').trim();
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(code) || code === 'all') throw new Error(`Site ligne ${i + 1} : code invalide (« ${code} »). Minuscules, chiffres et _, une lettre en premier, 2 à 32 caractères ; « all » est réservé.`);
    if (vus.has(code)) throw new Error(`Site ${code} en double`);
    vus.add(code);
    const libelle = texte(s.libelle, 120, `Site ${code}, libellé`);
    if (!libelle) throw new Error(`Site ${code} : le libellé est obligatoire`);
    const pays_iso2 = String(s.pays_iso2 ?? 'FR').trim().toUpperCase();
    if (!iso.has(pays_iso2)) throw new Error(`Site ${code} : pays ${pays_iso2} absent de la liste des pays`);
    // D21 : site d'une filiale du groupe (usine, terrain) ; vide pour un site d'EPC2i.
    const filiale_code = texte(s.filiale_code, 3, `Site ${code}, filiale`)?.toUpperCase() || null;
    if (filiale_code && !fil.has(filiale_code)) throw new Error(`Site ${code} : filiale ${filiale_code} absente de la liste des filiales`);
    return { code, libelle, ville: texte(s.ville, 80, `Site ${code}, ville`), pays_iso2, ordre: entier(s.ordre, `Site ${code}, ordre`), actif: bool(s.actif ?? true), filiale_code };
  });
}

function validerOrganigramme(lignes, sites) {
  const codesSites = new Set(sites.map(s => s.code));
  const niveaux = ['departement', 'service', 'equipe'];
  const out = lignes.map((u, i) => {
    const code = String(u.code ?? '').trim().toUpperCase();
    const niveau = String(u.niveau ?? '').trim();
    if (!niveaux.includes(niveau)) throw new Error(`Organigramme ligne ${i + 1} : niveau « ${niveau} » invalide (département, service ou équipe)`);
    if (niveau === 'departement' ? !/^[A-Z]{3}$/.test(code) || code === 'QMS' : !/^[A-Z]{3}(-[A-Z0-9]{2,12}){1,2}$/.test(code))
      throw new Error(`Organigramme : code « ${code} » invalide. Département : 3 majuscules (QMS réservé) ; service ou équipe : code du département suivi d'un suffixe, par exemple PRJ-CPL.`);
    const parent_code = u.parent_code ? String(u.parent_code).trim().toUpperCase() : null;
    if ((niveau === 'departement') !== (parent_code == null)) throw new Error(`Organigramme ${code} : un département n'a pas de parent ; un service ou une équipe en a toujours un`);
    const libelle_fr = texte(u.libelle_fr, 120, `${code}, libellé français`), libelle_en = texte(u.libelle_en, 120, `${code}, libellé anglais`);
    if (!libelle_fr || !libelle_en) throw new Error(`Organigramme ${code} : les libellés français et anglais sont obligatoires`);
    const responsable_matricule = texte(u.responsable_matricule, 20, `${code}, responsable`);
    if (responsable_matricule && !/^EMP-[0-9]{4,}$/.test(responsable_matricule)) throw new Error(`Organigramme ${code} : le responsable est un matricule Cursus (EMP-0012)`);
    const site_code = texte(u.site_code, 32, `${code}, site`);
    if (site_code && !codesSites.has(site_code)) throw new Error(`Organigramme ${code} : site ${site_code} absent de la liste des sites`);
    return { code, niveau, parent_code, libelle_fr, libelle_en, responsable_matricule, site_code, ordre: entier(u.ordre, `${code}, ordre`), actif: bool(u.actif ?? true) };
  });
  const parCode = new Map();
  for (const u of out) { if (parCode.has(u.code)) throw new Error(`Organigramme : ${u.code} en double`); parCode.set(u.code, u); }
  for (const u of out) {
    if (!u.parent_code) continue;
    const p = parCode.get(u.parent_code);
    if (!p) throw new Error(`Organigramme ${u.code} : parent ${u.parent_code} introuvable`);
    if (u.niveau === 'service' && p.niveau !== 'departement') throw new Error(`Organigramme ${u.code} : un service dépend d'un département`);
    if (u.niveau === 'equipe' && p.niveau === 'equipe') throw new Error(`Organigramme ${u.code} : une équipe dépend d'un département ou d'un service`);
    if (!u.code.startsWith(u.parent_code.slice(0, 3))) throw new Error(`Organigramme ${u.code} : le code doit commencer par celui de son département (${u.parent_code.slice(0, 3)})`);
  }
  return out;
}

// D21 : zones du groupe (Directeurs de Zone) et filiales, lues par Arche (CAPEX) et Keystone (clients).
function validerZones(lignes) {
  const vus = new Set();
  return lignes.map((z, i) => {
    const code = String(z.code ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,11}$/.test(code)) throw new Error(`Zone ligne ${i + 1} : code invalide (« ${code} »). Majuscules, chiffres et _, une lettre en premier, 2 à 12 caractères.`);
    if (vus.has(code)) throw new Error(`Zone ${code} en double`);
    vus.add(code);
    const libelle = texte(z.libelle, 120, `Zone ${code}, libellé`);
    if (!libelle) throw new Error(`Zone ${code} : le libellé est obligatoire`);
    return { code, libelle, responsable: texte(z.responsable, 120, `Zone ${code}, responsable`), ordre: entier(z.ordre, `Zone ${code}, ordre`), actif: bool(z.actif ?? true) };
  });
}

function validerFiliales(lignes, pays, zones) {
  const iso = new Set(pays.map(p => p.iso2)), zs = new Set(zones.map(z => z.code)), vus = new Set();
  return lignes.map((f, i) => {
    const code = String(f.code ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw new Error(`Filiale ligne ${i + 1} : code invalide (« ${code} »). Trois majuscules : il entre dans les codes CAPEX d'Arche (CPX-${code || 'APM'}-2026-01) et sert de clé à keystone.clients.code3.`);
    if (vus.has(code)) throw new Error(`Filiale ${code} en double`);
    vus.add(code);
    const nom = texte(f.nom, 120, `Filiale ${code}, nom`);
    if (!nom) throw new Error(`Filiale ${code} : le nom est obligatoire`);
    const pays_iso2 = String(f.pays_iso2 ?? '').trim().toUpperCase();
    if (!iso.has(pays_iso2)) throw new Error(`Filiale ${code} : pays ${pays_iso2 || '(vide)'} absent de la liste des pays`);
    const zone_code = String(f.zone_code ?? '').trim().toUpperCase() || null;
    if (zone_code && !zs.has(zone_code)) throw new Error(`Filiale ${code} : zone ${zone_code} absente de la liste des zones`);
    const devise = String(f.devise ?? 'EUR').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(devise)) throw new Error(`Filiale ${code} : devise ISO 4217 à 3 lettres (EUR, MAD…)`);
    return { code, nom, pays_iso2, zone_code, devise, ordre: entier(f.ordre, `Filiale ${code}, ordre`), actif: bool(f.actif ?? true) };
  });
}

export function enregistrerReferentiel(dataDir, liste, lignes, qui) {
  if (!Array.isArray(lignes)) throw new Error('la liste doit être un tableau');
  if (lignes.length > 5000) throw new Error('5 000 lignes au plus');
  const ed = chargerEdition(dataDir);
  const r = { ...ed.referentiels };
  if (liste === 'pays') {
    r.pays = validerPays(lignes);
    const iso = new Set(r.pays.map(p => p.iso2));
    const orphelin = r.sites.find(s => !iso.has(s.pays_iso2));
    if (orphelin) throw new Error(`Le pays ${orphelin.pays_iso2} est utilisé par le site ${orphelin.code} : modifiez d'abord le site`);
    const filiale = r.filiales.find(f => !iso.has(f.pays_iso2));
    if (filiale) throw new Error(`Le pays ${filiale.pays_iso2} est utilisé par la filiale ${filiale.code} : modifiez d'abord la filiale`);
  } else if (liste === 'zones') {
    r.zones = validerZones(lignes);
    const codes = new Set(r.zones.map(z => z.code));
    const orpheline = r.filiales.find(f => f.zone_code && !codes.has(f.zone_code));
    if (orpheline) throw new Error(`La zone ${orpheline.zone_code} est utilisée par la filiale ${orpheline.code} : modifiez d'abord la filiale`);
  } else if (liste === 'filiales') {
    r.filiales = validerFiliales(lignes, r.pays, r.zones);
    const codes = new Set(r.filiales.map(f => f.code));
    const orphelin = r.sites.find(s => s.filiale_code && !codes.has(s.filiale_code));
    if (orphelin) throw new Error(`La filiale ${orphelin.filiale_code} est utilisée par le site ${orphelin.code} : modifiez d'abord le site`);
  } else if (liste === 'sites') {
    r.sites = validerSites(lignes, r.pays, r.filiales);
    const codes = new Set(r.sites.map(s => s.code));
    const orphelin = r.organigramme.find(u => u.site_code && !codes.has(u.site_code));
    if (orphelin) throw new Error(`Le site ${orphelin.site_code} est utilisé par ${orphelin.code} dans l'organigramme : modifiez d'abord l'organigramme`);
  } else if (liste === 'organigramme') {
    r.organigramme = validerOrganigramme(lignes, r.sites);
  } else throw new Error(`référentiel inconnu : ${liste}`);
  const avant = ed.referentiels[liste], apres = r[liste];
  const cle = { pays: 'iso2', sites: 'code', organigramme: 'code', zones: 'code', filiales: 'code' }[liste];
  const A = new Map(avant.map(x => [x[cle], JSON.stringify(x)])), B = new Map(apres.map(x => [x[cle], JSON.stringify(x)]));
  const ajoutes = [...B.keys()].filter(k => !A.has(k)), retires = [...A.keys()].filter(k => !B.has(k));
  const modifies = [...B.keys()].filter(k => A.has(k) && A.get(k) !== B.get(k));
  if (!ajoutes.length && !retires.length && !modifies.length) return apres;
  ed.referentiels = r;
  const detail = [ajoutes.length && `ajout : ${ajoutes.join(', ')}`, modifies.length && `modification : ${modifies.join(', ')}`, retires.length && `retrait : ${retires.join(', ')}`].filter(Boolean).join(' · ');
  tracer(ed, qui, 'Référentiel modifié', { pays: 'Pays', sites: 'Sites', organigramme: 'Organigramme', zones: 'Zones', filiales: 'Filiales' }[liste], detail);
  enregistrer(dataDir, ed);
  return apres;
}
