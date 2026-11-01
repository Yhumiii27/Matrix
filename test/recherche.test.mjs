// Recherche plein texte (outils/recherche.mjs, écart E-13) et son injection dans la page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliser, termes, noter, chercher } from '../outils/recherche.mjs';
import { construirePage } from '../outils/page.mjs';

const fiches = [
  { cle: 'keystone.persons', nom: 'persons', domaine: 'Organisation', description: 'Staff and external contacts', lectures: 50,
    colonnes: [{ nom: 'matricule', description: 'Matricule Cursus (EMP-xxxx)' }, { nom: 'full_name' }] },
  { cle: 'cursus.employes', nom: 'employes', domaine: 'Personnel', description: 'Fiche salarié (matricule EMP-xxxx)', lectures: 900,
    colonnes: [{ nom: 'id' }, { nom: 'nom' }], documentation: { note: 'Source de vérité RH pour les données personnelles' } },
  { cle: 'vigie.people', nom: 'people', domaine: 'Habilitations', description: 'Personnes suivies', lectures: 10,
    colonnes: [{ nom: 'matricule' }], flux: ['F07 Salariés de Cursus vers Vigie'] },
  { cle: 'codex.documents', nom: 'documents', domaine: 'Documents', description: 'Fiche maîtresse du document', lectures: 0, colonnes: [{ nom: 'id' }] },
];

test('normaliser et termes : accents, casse, expressions entre guillemets', () => {
  assert.equal(normaliser('Vérité RH'), 'verite rh');
  assert.deepEqual(termes('  Matricule  "vérité RH" matricule « fiche salarié »'), ['matricule', 'verite rh', 'fiche salarie']);
});

test('noter : chaque terme doit figurer quelque part ; le nom pèse plus que la description', () => {
  assert.equal(noter(fiches[3], termes('document salarié')), null);
  const nom = noter(fiches[1], termes('employes')), desc = noter(fiches[1], termes('salarie'));
  assert.ok(nom.score > desc.score);
  assert.deepEqual(nom.raisons, ['nom']);
  assert.deepEqual(desc.raisons, ['description']);
  assert.deepEqual(noter(fiches[0], termes('EMP')).raisons, ['commentaire de colonne matricule']);
  assert.deepEqual(noter(fiches[1], termes('verite')).raisons, ['documentation']);
  assert.deepEqual(noter(fiches[2], termes('F07')).raisons, ['flux']);
});

test('chercher : tri par pertinence, puis par lectures', () => {
  // « matricule » : colonne exacte chez persons et people (30), description chez employes (10).
  assert.deepEqual(chercher(fiches, 'matricule').map(r => r.cle), ['keystone.persons', 'vigie.people', 'cursus.employes']);
  // « emp » est aussi dans le nom de la table employes : le nom pèse le plus.
  assert.deepEqual(chercher(fiches, 'matricule emp').map(r => r.cle), ['cursus.employes', 'keystone.persons']);
  // « cursus » : commentaire de colonne chez persons (6), flux chez people (4).
  assert.deepEqual(chercher(fiches, 'matricule cursus').map(r => r.cle), ['keystone.persons', 'vigie.people']);
  assert.deepEqual(chercher(fiches, '').length, 4);
});

test('la page embarque le module de recherche, sans export', () => {
  const page = construirePage({ forme: 'fragment' });
  assert.match(page, /function chercher\(fiches, requete\)/);
  assert.doesNotMatch(page, /^export function/m);
  assert.doesNotMatch(page, /\/\*RECHERCHE\*\//);
});
