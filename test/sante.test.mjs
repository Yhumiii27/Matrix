// Règles de l'état de santé (outils/sante.mjs) sur une lecture du serveur construite à la main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculerSante } from '../outils/sante.mjs';

const col = (name, nullable = false, extra = {}) => ({ name, type: 'text', nullable, ...extra });
const table = (name, extra = {}) => ({
  name, description: 'documentée', columns: [col('id')], pk: ['id'], uniques: [], fks: [],
  stats: { lignes: 10, lignesMortes: 0, analyseLe: '2026-10-01T00:00:00Z' }, ...extra,
});
const lecture = (tables, { vues = [], registre = [], erreur = null, verifier = [], references = [] } = {}) => ({
  luLe: '2026-10-30T00:00:00Z', outils: { keystone: { tables } }, vues,
  liens: { registre, journal: [], ...(erreur ? { erreur } : {}) }, references, verifier: { lignes: verifier },
});
const regles = s => Object.fromEntries(s.tables.map(t => [t.table, t.constats.map(c => `${c.regle}:${c.gravite}`)]));

test('table saine : état ok', () => {
  const s = calculerSante(lecture([table('projects')]));
  assert.equal(s.etat, 'ok');
  assert.deepEqual(regles(s), { projects: [] });
});

test('clés : sans clé (attention), clé unique sur colonnes obligatoires (info)', () => {
  const s = calculerSante(lecture([
    table('sans_cle', { pk: [] }),
    table('cle_unique', { pk: [], uniques: [['code']], columns: [col('code')] }),
    table('unique_nullable', { pk: [], uniques: [['code']], columns: [col('code', true)] }),
  ]));
  assert.deepEqual(regles(s), {
    sans_cle: ['sans_cle:attention'], cle_unique: ['cle_unique_seulement:info'], unique_nullable: ['sans_cle:attention'],
  });
  assert.equal(s.etat, 'attention');
});

test('clés étrangères : vers un autre schéma et non validée (erreur), sans index selon la taille', () => {
  const fk = (extra) => ({ columns: ['p'], table: 'projects', nom: 'fk', valide: true, indexe: true, ...extra });
  const s = calculerSante(lecture([
    table('croisee', { fks: [fk({ schema: 'cursus' })] }),
    table('non_valide', { fks: [fk({ valide: false })] }),
    table('petite', { fks: [fk({ indexe: false })] }),
    table('grande', { fks: [fk({ indexe: false })], stats: { lignes: 20000, lignesMortes: 0, analyseLe: 'x' } }),
  ]));
  assert.deepEqual(regles(s), {
    croisee: ['lien_entre_schemas:erreur'], non_valide: ['lien_non_valide:erreur'],
    petite: ['lien_sans_index:info'], grande: ['lien_sans_index:attention'],
  });
  assert.equal(s.etat, 'erreur');
});

test('entretien et documentation : lignes mortes, jamais analysée, non documentée, colonnes fermées', () => {
  const s = calculerSante(lecture([
    table('mortes', { stats: { lignes: 3000, lignesMortes: 2000, analyseLe: 'x' } }),
    table('peu_de_mortes', { stats: { lignes: 100000, lignesMortes: 2000, analyseLe: 'x' } }),
    table('neuve', { stats: { lignes: 0, lignesMortes: 0, analyseLe: null } }),
    table('muette', { description: null }),
    table('sensible', { columns: [col('id'), col('salaire', true, { fermee: true })] }),
  ]));
  assert.deepEqual(regles(s), {
    mortes: ['lignes_mortes:attention'], peu_de_mortes: [], neuve: ['jamais_analysee:info'],
    muette: ['non_documentee:info'], sensible: ['colonnes_fermees:info'],
  });
});

test('documentation tenue dans Matrix (catalogue ou édition) : pas de constat', () => {
  const t = [table('a', { description: null }), table('b', { description: null })];
  const s = calculerSante(lecture(t), {
    catalogue: { apps: [{ id: 'keystone', tables: [{ name: 'a', description: 'dans le catalogue' }] }] },
    edition: { documentation: { 'keystone.b': { description: 'saisie' } } },
  });
  assert.deepEqual(regles(s), { a: [], b: [] });
});

test('liens : registre face aux droits posés', () => {
  const vues = [
    { vue: 'keystone.pub_projets', lecteurs: ['keystone_app', 'codex_app', 'vigie_app', 'cursus_app'] },
    { vue: 'keystone.pub_clients', lecteurs: [] },
  ];
  const registre = [
    { vue: 'keystone.pub_projets', lecteur: 'codex_app', statut: 'autorise' },   // appliqué
    { vue: 'keystone.pub_clients', lecteur: 'codex_app', statut: 'autorise' },   // à appliquer
    { vue: 'keystone.pub_projets', lecteur: 'vigie_app', statut: 'refuse' },     // à retirer
    { vue: 'keystone.pub_clients', lecteur: 'vigie_app', statut: 'refuse' },     // refusé
    { vue: 'keystone.pub_clients', lecteur: 'arche_app', statut: 'demande' },    // en attente
    { vue: 'keystone.pub_absente', lecteur: 'codex_app', statut: 'autorise' },   // vue absente (keystone présent)
    { vue: 'crucible.pub_moyens', lecteur: 'codex_app', statut: 'autorise' },    // outil absent
  ];
  const s = calculerSante(lecture([table('projects')], { vues, registre }));
  const etat = Object.fromEntries(s.liens.map(l => [`${l.vue}|${l.lecteur}`, l.etat]));
  assert.deepEqual(etat, {
    'crucible.pub_moyens|codex_app': 'outil_absent',
    'keystone.pub_absente|codex_app': 'vue_absente',
    'keystone.pub_clients|arche_app': 'en_attente',
    'keystone.pub_clients|codex_app': 'a_appliquer',
    'keystone.pub_clients|vigie_app': 'refuse',
    'keystone.pub_projets|codex_app': 'applique',
    'keystone.pub_projets|cursus_app': 'hors_registre',   // droit posé, absent du registre
    'keystone.pub_projets|vigie_app': 'a_retirer',
  });
  assert.equal(s.etat, 'erreur');
});

test('registre illisible : aucun lien « hors registre » inventé', () => {
  const vues = [{ vue: 'keystone.pub_projets', lecteurs: ['codex_app'] }];
  const s = calculerSante(lecture([table('projects')], { vues, erreur: 'permission denied' }));
  assert.equal(s.liens.length, 0);
  assert.match(s.resume.registre, /illisible/);
});

test('références orphelines et écarts du socle comptent dans l\'état global', () => {
  const s = calculerSante(lecture([table('projects')], {
    references: [{ id: 'R01', etat: 'orphelins' }], verifier: [{ gravite: 'info', constat: 'x' }],
  }));
  assert.equal(s.etat, 'attention');
});
