#!/usr/bin/env node
// Renommage du serveur commun en Atrium (docs/renommage-atrium.md, étapes 1 et 5) : relève puis réécrit, dans les
// variables d'environnement des ressources Coolify, l'hôte (epc2i-postgres → atrium-postgres), la base
// (…/epc2i → …/atrium), le rôle des sauvegardes et les chemins (/etc/epc2i, /opt/epc2i…), sans jamais afficher une
// valeur : le script n'écrit que le nom de la ressource, le nom de la variable et la nature du changement.
//
//   COOLIFY_URL=https://coolify.… COOLIFY_TOKEN=… node scripts/renommage-envs-coolify.mjs            # relevé seul
//   COOLIFY_URL=… COOLIFY_TOKEN=… node scripts/renommage-envs-coolify.mjs --appliquer                # écrit
//   … --ressources=keystone,codex   limite aux ressources dont le nom contient l'un de ces mots
//   … --parties=hote,base           limite les changements (hote, base, role, chemins ; défaut : tous)
//   … --cles                        copie aussi chaque variable EPC2I_<X> vers ATRIUM_<X> (même valeur, l'ancienne gardée)
//   … --poser=ATRIUM_PG_DATABASE=atrium,ATRIUM_PG_HOST=atrium-postgres
//                                   pose ces variables (valeurs non secrètes, affichées) dans les ressources retenues par
//                                   --ressources : outils dont le compose écrit lui-même DATABASE_URL (Clavis, Arche,
//                                   Crucible, Modulus), une fois leur compose passé aux variables (prérequis P3 de la fiche)
//
// Le jeton Coolify (« API tokens », droit d'écriture) ne s'écrit jamais dans le dépôt ni dans une commande gardée dans
// l'historique : le passer par l'environnement. L'écriture garde les options de chaque variable (« Available at Build
// Time », littérale, multiligne). Ressources lues : applications et services de l'API v1 de Coolify ; une ressource que
// l'API ne sait pas lire est signalée, jamais ignorée en silence. Rien n'est redémarré : l'opérateur redéploie (étape 6).
// Non essayé contre le Coolify en service à la date de sa création (27/11/2026) : lancer d'abord sans --appliquer.

const PARTIES = ['hote', 'base', 'role', 'chemins'];
const CHEMINS = [['/etc/epc2i/', '/etc/atrium/'], ['/opt/epc2i/', '/opt/atrium/'], ['/var/lib/epc2i/', '/var/lib/atrium/'],
  ['/var/backups/epc2i/', '/var/backups/atrium/'], ['/var/log/epc2i-', '/var/log/atrium-']];

/**
 * Nouvelle valeur d'une variable, et la liste des changements faits ; `reste` vaut true quand « epc2i » subsiste
 * (cas à traiter à la main : il est signalé par son seul nom de variable).
 */
export function reecrire(valeur, parties = PARTIES) {
  const avec = new Set(parties);
  const changements = [];
  let v = String(valeur ?? '');
  const url = /^(postgres(?:ql)?:\/\/)([^@/?#]*@)?([^/?#]*)(\/[^?#]*)?(.*)$/s.exec(v);
  if (url) {
    let [, schema, auth = '', hote, chemin = '', suite] = url;
    if (avec.has('hote') && /(^|,)epc2i-postgres(:|,|$)/.test(hote)) { hote = hote.replace(/(^|,)epc2i-postgres(?=:|,|$)/g, '$1atrium-postgres'); changements.push('hôte'); }
    if (avec.has('base') && chemin === '/epc2i') { chemin = '/atrium'; changements.push('base'); }
    if (avec.has('role') && /^epc2i_sauvegarde(:|@)/.test(auth)) { auth = auth.replace(/^epc2i_sauvegarde/, 'atrium_sauvegarde'); changements.push('rôle'); }
    v = schema + auth + hote + chemin + suite;
  } else {
    if (avec.has('hote') && /\bepc2i-postgres\b/.test(v)) { v = v.replace(/\bepc2i-postgres\b/g, 'atrium-postgres'); changements.push('hôte'); }
    if (avec.has('chemins')) for (const [a, b] of CHEMINS) if (v.includes(a)) { v = v.split(a).join(b); changements.push('chemin'); }
  }
  return { valeur: v, changements: [...new Set(changements)], reste: /epc2i/i.test(v) };
}

/** Nouveau nom d'une clé EPC2I_<X> (null si la clé ne porte pas l'ancien préfixe). */
export function nouvelleCle(cle) {
  return /^EPC2I_/.test(cle) ? cle.replace(/^EPC2I_/, 'ATRIUM_') : null;
}

async function principal(argv) {
  const opt = Object.fromEntries(argv.filter(a => a.startsWith('--')).map(a => { const [k, ...r] = a.slice(2).split('='); return [k, r.length ? r.join('=') : true]; }));
  const base = String(process.env.COOLIFY_URL ?? '').replace(/\/+$/, '');
  const jeton = process.env.COOLIFY_TOKEN;
  if (!base || !jeton) { console.error('COOLIFY_URL et COOLIFY_TOKEN sont requis (variables d\'environnement).'); process.exit(2); }
  const parties = opt.parties ? String(opt.parties).split(',').filter(p => PARTIES.includes(p)) : PARTIES;
  const filtre = opt.ressources ? String(opt.ressources).toLowerCase().split(',') : null;
  const appliquer = opt.appliquer === true;
  const api = async (chemin, init = {}) => {
    const r = await fetch(`${base}/api/v1${chemin}`, { ...init, headers: { authorization: `Bearer ${jeton}`, accept: 'application/json', 'content-type': 'application/json', ...init.headers } });
    if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${chemin} : HTTP ${r.status}`);
    return r.status === 204 ? null : r.json();
  };
  const ressources = [];
  for (const genre of ['applications', 'services']) {
    try { for (const x of await api(`/${genre}`)) ressources.push({ genre, uuid: x.uuid, nom: x.name ?? x.uuid }); }
    catch (e) { console.log(`! liste des ${genre} illisible (${e.message})`); }
  }
  const aPoser = opt.poser ? String(opt.poser).split(',').map(x => x.split('=')).filter(([k, v]) => /^[A-Z][A-Z0-9_]*$/.test(k ?? '') && v) : [];
  if (aPoser.length && !filtre) { console.error('--poser demande --ressources (les ressources à modifier, nommées).'); process.exit(2); }
  let aEcrire = 0, aVoir = 0;
  for (const res of ressources) {
    if (filtre && !filtre.some(f => res.nom.toLowerCase().includes(f))) continue;
    let envs;
    try { envs = await api(`/${res.genre}/${res.uuid}/envs`); }
    catch (e) { console.log(`! ${res.nom} : variables illisibles (${e.message}), à relever dans l'interface`); aVoir++; continue; }
    for (const [k, v] of aPoser) {
      const existe = (envs ?? []).find(x => x.key === k && !x.is_preview);
      aEcrire++;
      console.log(`${appliquer ? '✓' : '→'} ${res.nom} · ${k}=${v} (${existe ? 'modifiée' : 'ajoutée'})`);
      if (appliquer) await api(`/${res.genre}/${res.uuid}/envs`, { method: existe ? 'PATCH' : 'POST', body: JSON.stringify({ key: k, value: v, is_build_time: true }) });
    }
    for (const e of envs ?? []) {
      if (e.is_preview) continue;
      const valeur = e.real_value ?? e.value ?? '';
      const cle = e.key;
      const options = { is_build_time: e.is_build_time, is_literal: e.is_literal, is_multiline: e.is_multiline, is_shown_once: e.is_shown_once };
      const ecrire = async (k, v) => api(`/${res.genre}/${res.uuid}/envs`, { method: 'PATCH', body: JSON.stringify({ key: k, value: v, ...options }) });
      if (/epc2i/i.test(valeur)) {
        const r = reecrire(valeur, parties);
        if (r.changements.length) {
          aEcrire++;
          console.log(`${appliquer ? '✓' : '→'} ${res.nom} · ${cle} : ${r.changements.join(', ')}${r.reste ? ' (il reste « epc2i » : à voir à la main)' : ''}`);
          if (appliquer) await ecrire(cle, r.valeur);
        } else if (r.reste) { aVoir++; console.log(`? ${res.nom} · ${cle} : contient « epc2i » hors des cas connus, à voir à la main (valeur non affichée)`); }
      }
      const nk = nouvelleCle(cle);
      if (nk) {
        if (opt.cles === true && !(envs ?? []).some(x => x.key === nk)) {
          aEcrire++;
          console.log(`${appliquer ? '✓' : '→'} ${res.nom} · ${cle} : copiée vers ${nk} (même valeur, ${cle} gardée jusqu'au nettoyage)`);
          if (appliquer) await api(`/${res.genre}/${res.uuid}/envs`, { method: 'POST', body: JSON.stringify({ key: nk, value: valeur, ...options }) });
        } else console.log(`· ${res.nom} · ${cle} : clé à l'ancien nom${(envs ?? []).some(x => x.key === nk) ? ` (${nk} existe déjà)` : ' (--cles pour la copier)'}`);
      }
    }
  }
  console.log(`${appliquer ? 'Écrit' : 'À écrire'} : ${aEcrire} · à voir à la main : ${aVoir}${appliquer ? ' · redéployer les ressources touchées (docs/renommage-atrium.md, étape 6)' : ' · relancer avec --appliquer'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) principal(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
