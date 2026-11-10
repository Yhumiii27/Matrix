// Alertes de la DSI par e-mail (outils/alertes.mjs, E-05, décision M-14).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireConfigAlertes, impact, composerAlertes, rediger, envoyer, traiterAlertes } from '../outils/alertes.mjs';

const ENTRA = { MATRIX_ENTRA_TENANT_ID: 't', MATRIX_ENTRA_CLIENT_ID: 'c', MATRIX_ENTRA_CLIENT_SECRET: 's' };

test('configuration : inactive sans destinataires, erreurs signalées, active complète', () => {
  assert.deepEqual(lireConfigAlertes({}), { active: false, erreurs: [] });
  const partielle = lireConfigAlertes({ MATRIX_ALERTES_DESTINATAIRES: 'dsi@epc2i.example, pas-une-adresse' });
  assert.equal(partielle.active, false);
  assert.ok(partielle.erreurs.some(e => /adresse invalide \(pas-une-adresse\)/.test(e)));
  assert.ok(partielle.erreurs.some(e => /EXPEDITEUR manquant/.test(e)));
  assert.ok(partielle.erreurs.some(e => /MATRIX_ENTRA_CLIENT_SECRET manquant/.test(e)));
  const c = lireConfigAlertes({ ...ENTRA, MATRIX_ALERTES_DESTINATAIRES: 'a@epc2i.example; b@epc2i.example a@epc2i.example', MATRIX_ALERTES_EXPEDITEUR: 'matrix@epc2i.example' });
  assert.equal(c.active, true);
  assert.deepEqual(c.destinataires, ['a@epc2i.example', 'b@epc2i.example']);
  assert.equal(c.urlGraph, 'https://graph.microsoft.com');
});

const vues = [
  { vue: 'keystone.pub_projets', sources: ['keystone.projects.code', 'keystone.projects.name'] },
  { vue: 'keystone.pub_jalons', sources: ['keystone.milestones.due', 'keystone.projects.code'] },
  { vue: 'vigie.pub_controles', sources: ['vigie.controls.id'] },
];
const liens = [
  { vue: 'keystone.pub_projets', lecteur: 'vigie_app', statut: 'autorise' },
  { vue: 'keystone.pub_projets', lecteur: 'arche_app', statut: 'refuse' },
  { vue: 'keystone.pub_jalons', lecteur: 'crucible_app', statut: 'autorise' },
  { vue: 'codex.pub_documents', lecteur: 'arche_app', statut: 'demande', nature: 'lecture', motif: 'pièces des CAPEX' },
];

test('impact : vues qui lisent la table ou la colonne, lecteurs autorisés seulement', () => {
  assert.deepEqual(impact({ app: 'keystone', table: 'projects' }, vues, liens), { vues: ['keystone.pub_jalons', 'keystone.pub_projets'], lecteurs: ['crucible_app', 'vigie_app'] });
  assert.deepEqual(impact({ app: 'keystone', table: 'projects', colonne: 'name' }, vues, liens), { vues: ['keystone.pub_projets'], lecteurs: ['vigie_app'] });
  assert.deepEqual(impact({ app: 'keystone', table: 'proj' }, vues, liens), { vues: [], lecteurs: [] });
});

test('composition : suppressions et hors migration, demandes, incidents ; ajouts ignorés ; doublons écartés', () => {
  const evenements = [
    { date: 'd1', app: 'keystone', type: 'colonne_supprimee', table: 'projects', colonne: 'name' },
    { date: 'd1', app: 'keystone', type: 'colonne_ajoutee', table: 'projects', colonne: 'x' },
    { date: 'd1', app: 'keystone', type: 'table_ajoutee', table: 'nouvelle' },
    { date: 'd1', app: 'cursus', type: 'table_supprimee', table: 'vieille' },
    { date: 'd1', app: 'vigie', type: 'hors_migration', derniere: '0029' },
  ];
  const incidents = [{ regle: 'Q-1', table: 'keystone.projects', libelle: 'Code projet unique', gravite: 'bloquant', ouvertLe: 'd0', detail: '2 doublons' },
    { regle: 'Q-2', ouvertLe: 'd0', closLe: 'd1' }];
  const a = composerAlertes({ evenements, liens, incidents, vues });
  assert.deepEqual(a.map(x => x.type), ['schema', 'schema', 'schema', 'lien', 'qualite']);
  assert.match(a[0].titre, /Colonne supprimée : keystone\.projects\.name/);
  assert.match(a[0].detail, /Lue par keystone\.pub_projets ; lecteurs : vigie_app/);
  assert.match(a[1].detail, /Aucune vue pub_ ne la lit/);
  assert.match(a[2].titre, /vigie : structure changée sans migration/);
  assert.match(a[3].titre, /arche_app → codex\.pub_documents/);
  assert.match(a[4].detail, /keystone\.projects \(bloquant\) : 2 doublons/);
  // Déjà envoyées : rien de nouveau.
  const deja = Object.fromEntries(a.map(x => [x.cle, 'avant']));
  assert.deepEqual(composerAlertes({ evenements, liens, incidents, vues, deja }), []);
});

test('rédaction : sujet et sections', () => {
  const a = composerAlertes({ liens, incidents: [{ regle: 'Q-1', libelle: 'L', ouvertLe: 'd' }] });
  const m = rediger(a, { lien: 'https://matrix.example' });
  assert.equal(m.sujet, 'Matrix : 2 alertes (accès, qualité)');
  assert.match(m.texte, /Demandes d’accès en attente\n- /);
  assert.match(m.texte, /Ouvrir Matrix : https:\/\/matrix\.example/);
});

// Microsoft Graph simulé : jeton, puis sendMail.
function faux({ jeton = 200, envoi = 202 } = {}) {
  const appels = [];
  const fetchFn = async (url, init) => {
    appels.push({ url, init });
    if (url.endsWith('/oauth2/v2.0/token')) return { ok: jeton === 200, status: jeton, json: async () => ({ access_token: 'JETON' }) };
    return { status: envoi, ok: envoi < 300, text: async () => (envoi === 202 ? '' : '{"error":{"code":"ErrorAccessDenied"}}') };
  };
  return { appels, fetchFn };
}
const cfg = lireConfigAlertes({ ...ENTRA, MATRIX_ALERTES_DESTINATAIRES: 'dsi@epc2i.example', MATRIX_ALERTES_EXPEDITEUR: 'matrix@epc2i.example' });

test('envoi : jeton d’application puis sendMail de la boîte d’envoi', async () => {
  const f = faux();
  await envoyer(cfg, { sujet: 'S', texte: 'T' }, f.fetchFn);
  assert.equal(f.appels[0].url, 'https://login.microsoftonline.com/t/oauth2/v2.0/token');
  assert.match(String(f.appels[0].init.body), /grant_type=client_credentials/);
  assert.equal(f.appels[1].url, 'https://graph.microsoft.com/v1.0/users/matrix%40epc2i.example/sendMail');
  assert.equal(f.appels[1].init.headers.authorization, 'Bearer JETON');
  const corps = JSON.parse(f.appels[1].init.body);
  assert.deepEqual(corps.message.toRecipients, [{ emailAddress: { address: 'dsi@epc2i.example' } }]);
  assert.equal(corps.message.subject, 'S');
  await assert.rejects(envoyer(cfg, { sujet: 'S', texte: 'T' }, faux({ envoi: 403 }).fetchFn), /Mail\.Send/);
  await assert.rejects(envoyer(cfg, { sujet: 'S', texte: 'T' }, faux({ jeton: 401 }).fetchFn), /jeton Microsoft refusé/);
});

test('traitement : envoi une seule fois ; échec gardé pour la lecture suivante ; inactif n’envoie rien', async () => {
  const entree = { liens, incidents: [] };
  const echec = await traiterAlertes(cfg, null, entree, { fetchFn: faux({ envoi: 500 }).fetchFn, maintenant: 'm1' });
  assert.equal(echec.envoyees, 0);
  assert.match(echec.erreur, /500/);
  assert.equal(echec.journal.derniereErreur.le, 'm1');
  assert.deepEqual(echec.journal.envoyees, {});
  const f = faux();
  const ok = await traiterAlertes(cfg, echec.journal, entree, { fetchFn: f.fetchFn, maintenant: 'm2' });
  assert.equal(ok.envoyees, 1);
  assert.deepEqual(ok.journal.dernierEnvoi, { le: 'm2', nombre: 1 });
  assert.equal(ok.journal.derniereErreur, null);
  const encore = await traiterAlertes(cfg, ok.journal, entree, { fetchFn: f.fetchFn });
  assert.equal(encore.envoyees, 0);
  assert.equal(f.appels.length, 2);   // un seul message envoyé
  const inactif = await traiterAlertes({ active: false }, null, entree, { fetchFn: () => { throw new Error('jamais'); } });
  assert.equal(inactif.envoyees, 0);
  assert.equal(inactif.enAttente.length, 1);
});
