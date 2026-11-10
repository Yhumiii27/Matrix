// Alertes de la DSI par e-mail (écart E-05, décision M-14 du 10/11/2026 : « E-mail par Microsoft 365 »).
//
// À chaque lecture du serveur commun, Matrix réunit ce qui demande une action de la DSI et l'envoie en un seul message,
// par Microsoft Graph, avec l'inscription Entra ID de Matrix (E-02) :
//   - changements de schéma qui peuvent casser un lecteur : table ou colonne supprimée, structure changée hors
//     migration ; avec l'analyse d'impact (vues pub_ qui lisent la table, d'après le lignage pg_depend, et outils qui
//     lisent ces vues). Les ajouts de tables ou de colonnes ne cassent personne : ils restent dans l'historique ;
//   - demandes d'accès d'un outil en attente (registre matrix.liens, statut « demande ») ;
//   - incidents de qualité des données ouverts (E-09).
// Une alerte n'est envoyée qu'une fois : sa clé est gardée dans data/alertes.json. Sans configuration, rien n'est
// envoyé ; les mêmes éléments restent visibles dans l'écran Santé.
//
// Variables (en plus de MATRIX_ENTRA_TENANT_ID, MATRIX_ENTRA_CLIENT_ID, MATRIX_ENTRA_CLIENT_SECRET) :
//   MATRIX_ALERTES_DESTINATAIRES  adresses de la DSI, séparées par des virgules (active les alertes) ;
//   MATRIX_ALERTES_EXPEDITEUR     boîte aux lettres d'envoi (ex. matrix@epc2i.fr), à laquelle l'application Matrix a
//                                 le droit Mail.Send (permission d'application, limitée à cette boîte par une
//                                 stratégie d'accès d'Exchange Online).

const ADRESSE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const SUPPRESSIONS = new Set(['table_supprimee', 'colonne_supprimee', 'hors_migration']);
const GARDER = 2000;

/** Configuration lue dans l'environnement : { active, erreurs, destinataires, expediteur, tenant, clientId, clientSecret }. */
export function lireConfigAlertes(env = process.env) {
  const v = k => String(env[k] ?? '').trim();
  const brut = v('MATRIX_ALERTES_DESTINATAIRES');
  if (!brut) return { active: false, erreurs: [] };
  const destinataires = [...new Set(brut.split(/[,;\s]+/).filter(Boolean))];
  const expediteur = v('MATRIX_ALERTES_EXPEDITEUR');
  const erreurs = [];
  for (const a of destinataires) if (!ADRESSE.test(a)) erreurs.push(`MATRIX_ALERTES_DESTINATAIRES : adresse invalide (${a})`);
  if (!expediteur) erreurs.push('MATRIX_ALERTES_EXPEDITEUR manquant');
  else if (!ADRESSE.test(expediteur)) erreurs.push(`MATRIX_ALERTES_EXPEDITEUR : adresse invalide (${expediteur})`);
  for (const k of ['MATRIX_ENTRA_TENANT_ID', 'MATRIX_ENTRA_CLIENT_ID', 'MATRIX_ENTRA_CLIENT_SECRET'])
    if (!v(k)) erreurs.push(`${k} manquant (l'envoi passe par l'inscription Entra ID de Matrix)`);
  return {
    active: erreurs.length === 0, erreurs, destinataires, expediteur,
    tenant: v('MATRIX_ENTRA_TENANT_ID'), clientId: v('MATRIX_ENTRA_CLIENT_ID'), clientSecret: v('MATRIX_ENTRA_CLIENT_SECRET'),
    urlConnexion: v('MATRIX_ALERTES_LOGIN_URL') || 'https://login.microsoftonline.com',
    urlGraph: v('MATRIX_ALERTES_GRAPH_URL') || 'https://graph.microsoft.com',
  };
}

/** Vues pub_ qui lisent une table (ou une colonne), d'après le lignage, et lecteurs autorisés de ces vues. */
export function impact({ app, table, colonne }, vues = [], liens = []) {
  const prefixe = `${app}.${table}.`;
  const touchees = vues.filter(v => (v.sources ?? []).some(s => colonne ? s === `${prefixe}${colonne}` : s.startsWith(prefixe))).map(v => v.vue).sort();
  const lecteurs = [...new Set(liens.filter(l => touchees.includes(l.vue) && l.statut === 'autorise').map(l => l.lecteur))].sort();
  return { vues: touchees, lecteurs };
}

/**
 * Alertes nouvelles d'une lecture du serveur. `evenements` : changements de schéma de cette lecture (historique) ;
 * `liens` : registre (avec l'état calculé par la santé) ; `incidents` : incidents de qualité ; `vues` : lignage ;
 * `deja` : clés déjà envoyées. Renvoie la liste, dans l'ordre d'affichage.
 */
export function composerAlertes({ evenements = [], liens = [], incidents = [], vues = [], deja = {} }) {
  const alertes = [];
  const ajouter = a => { if (!deja[a.cle] && !alertes.some(x => x.cle === a.cle)) alertes.push(a); };
  for (const e of evenements.filter(e => SUPPRESSIONS.has(e.type))) {
    if (e.type === 'hors_migration') {
      ajouter({ cle: `schema|${e.app}|hors_migration|${e.date}`, type: 'schema', titre: `${e.app} : structure changée sans migration`,
        detail: `Le schéma de ${e.app} a changé sans nouvelle migration (dernière migration : ${e.derniere ?? 'inconnue'}).`, impact: null });
      continue;
    }
    const objet = e.colonne ? `${e.app}.${e.table}.${e.colonne}` : `${e.app}.${e.table}`;
    const i = impact(e, vues, liens);
    ajouter({ cle: `schema|${e.type}|${objet}|${e.date}`, type: 'schema',
      titre: `${e.type === 'table_supprimee' ? 'Table supprimée' : 'Colonne supprimée'} : ${objet}`,
      detail: i.vues.length ? `Lue par ${i.vues.join(', ')}${i.lecteurs.length ? ` ; lecteurs : ${i.lecteurs.join(', ')}` : ''}.` : 'Aucune vue pub_ ne la lit.',
      impact: i });
  }
  for (const l of liens.filter(l => l.statut === 'demande'))
    ajouter({ cle: `lien|${l.vue}|${l.lecteur}`, type: 'lien', titre: `Demande d'accès : ${l.lecteur} → ${l.vue}`,
      detail: `${l.nature === 'execution' ? 'Écriture (exécution de la fonction)' : 'Lecture'}${l.motif ? ` ; motif : ${l.motif}` : ''}. À décider dans « Liens entre outils ».`, impact: null });
  for (const i of incidents.filter(i => !i.closLe))
    ajouter({ cle: `qualite|${i.regle}|${i.ouvertLe}`, type: 'qualite', titre: `Incident de qualité : ${i.libelle ?? i.regle}`,
      detail: `${i.table ?? ''}${i.gravite ? ` (${i.gravite})` : ''}${i.detail ? ` : ${i.detail}` : ''}`.replace(/^ : /, ''), impact: null });
  return alertes;
}

const SECTIONS = [['schema', 'Changements de schéma qui peuvent casser un lecteur'], ['lien', 'Demandes d’accès en attente'], ['qualite', 'Incidents de qualité des données']];

/** Message texte d'un lot d'alertes : { sujet, texte }. */
export function rediger(alertes, { lien = '' } = {}) {
  const n = alertes.length;
  const sujet = `Matrix : ${n} alerte${n > 1 ? 's' : ''} (${SECTIONS.filter(([t]) => alertes.some(a => a.type === t)).map(([t]) => ({ schema: 'schéma', lien: 'accès', qualite: 'qualité' })[t]).join(', ')})`;
  const blocs = SECTIONS.map(([t, nom]) => {
    const l = alertes.filter(a => a.type === t);
    return l.length ? `${nom}\n${l.map(a => `- ${a.titre}\n  ${a.detail}`).join('\n')}` : null;
  }).filter(Boolean);
  const texte = `${blocs.join('\n\n')}\n\n${lien ? `Ouvrir Matrix : ${lien}\n` : ''}Message envoyé par Matrix (alertes E-05). Une alerte n'est envoyée qu'une fois ; l'état courant est dans l'écran Santé.\n`;
  return { sujet, texte };
}

/** Envoi par Microsoft Graph (jeton d'application, puis users/{expediteur}/sendMail). `fetchFn` remplaçable en test. */
export async function envoyer(cfg, { sujet, texte }, fetchFn = fetch) {
  const corps = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials', scope: `${cfg.urlGraph}/.default` });
  const t = await fetchFn(`${cfg.urlConnexion}/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corps });
  if (!t.ok) throw new Error(`jeton Microsoft refusé (${t.status}) : vérifiez le secret client de Matrix`);
  const { access_token: jeton } = await t.json();
  const r = await fetchFn(`${cfg.urlGraph}/v1.0/users/${encodeURIComponent(cfg.expediteur)}/sendMail`, {
    method: 'POST', headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message: { subject: sujet, body: { contentType: 'Text', content: texte }, toRecipients: cfg.destinataires.map(address => ({ emailAddress: { address } })) }, saveToSentItems: false }),
  });
  if (r.status !== 202) {
    const d = await r.text().catch(() => '');
    throw new Error(`envoi refusé par Microsoft Graph (${r.status})${r.status === 403 ? ' : accordez Mail.Send à l’application Matrix pour la boîte d’envoi' : ''}${d ? ` : ${d.slice(0, 200)}` : ''}`);
  }
}

/**
 * Traite une lecture : compose, envoie si configuré, retient les clés envoyées. `journal` : contenu de data/alertes.json.
 * Renvoie { journal, envoyees, enAttente, erreur } ; une erreur d'envoi garde les alertes pour la lecture suivante.
 */
export async function traiterAlertes(cfg, journal, entree, { lien = '', maintenant = new Date().toISOString(), fetchFn } = {}) {
  const deja = { ...(journal?.envoyees ?? {}) };
  const alertes = composerAlertes({ ...entree, deja });
  const base = { journal: { envoyees: deja, dernierEnvoi: journal?.dernierEnvoi ?? null, derniereErreur: journal?.derniereErreur ?? null }, envoyees: 0, enAttente: alertes };
  if (!cfg.active || !alertes.length) return base;
  try {
    await envoyer(cfg, rediger(alertes, { lien }), fetchFn);
  } catch (e) {
    return { ...base, journal: { ...base.journal, derniereErreur: { le: maintenant, message: e.message } }, erreur: e.message };
  }
  for (const a of alertes) deja[a.cle] = maintenant;
  const cles = Object.entries(deja).sort((a, b) => b[1].localeCompare(a[1])).slice(0, GARDER);
  return { journal: { envoyees: Object.fromEntries(cles), dernierEnvoi: { le: maintenant, nombre: alertes.length }, derniereErreur: null }, envoyees: alertes.length, enAttente: [] };
}
