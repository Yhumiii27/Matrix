// Lignage des vues pub_ et flux observés (outils/lignage.mjs, écart E-07).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyserVue, confirmer, fluxObserves } from '../outils/lignage.mjs';

const resume = cols => cols.map(c => `${c.colonne}:${c.genre}:${c.sources.map(s => s.table + '.' + s.colonne).join('+')}`);

test('analyserVue : directe, transformée, calculée, alias de jointure, sous-requête', () => {
  const def = ` SELECT p.code,
    p.number AS numero,
    c.name AS client,
    p.stage <> ALL (ARRAY['clos'::text, 'annule'::text]) AS imputable,
    COALESCE(pm.full_name, pm.short_name) AS chef,
    ( SELECT string_agg(su.name, ', '::text) AS string_agg
           FROM keystone.suppliers su
          WHERE su.project_id = p.id) AS fournisseurs,
    'keystone'::text AS outil,
    p.updated_at::date AS maj_le
   FROM keystone.projects p
     LEFT JOIN keystone.clients c ON c.id = p.client_id
     LEFT JOIN persons pm ON pm.id = p.pm_person_id;`;
  assert.deepEqual(resume(analyserVue(def, 'keystone')), [
    'code:directe:keystone.projects.code', 'numero:directe:keystone.projects.number', 'client:directe:keystone.clients.name',
    'imputable:transformee:keystone.projects.stage', 'chef:calculee:keystone.persons.full_name+keystone.persons.short_name',
    'fournisseurs:calculee:keystone.projects.id', 'outil:calculee:', 'maj_le:transformee:keystone.projects.updated_at',
  ]);
});

test('analyserVue : CTE sautée, union branche par branche', () => {
  const cte = ` WITH dernier AS (
         SELECT t.project_id, max(t.at) AS at FROM keystone.transitions t GROUP BY t.project_id
        )
 SELECT p.code AS projet, d.at AS depuis
   FROM keystone.projects p
     LEFT JOIN dernier d ON d.project_id = p.id;`;
  assert.deepEqual(resume(analyserVue(cte, 'keystone')), ['projet:directe:keystone.projects.code', 'depuis:calculee:']);
  const union = ` SELECT 'a:'::text || a.id AS ref, a.at AS quand
   FROM keystone.audit_entries a
UNION ALL
 SELECT 'e:'::text || e.id AS ref, e.created_at AS quand
   FROM keystone.activity_events e;`;
  assert.deepEqual(resume(analyserVue(union, 'keystone')), [
    'ref:transformee:keystone.audit_entries.id+keystone.activity_events.id', 'quand:directe:keystone.audit_entries.at+keystone.activity_events.created_at',
  ]);
});

test('analyserVue : vue d’une seule table, noms sans alias', () => {
  const def = ` SELECT id,\n    name,\n    subsidiary_code AS filiale_code,\n    COALESCE(is_internal, false) AS interne\n   FROM keystone.clients c;`;
  const cols = confirmer(analyserVue(def, 'keystone'), ['keystone.clients.id', 'keystone.clients.name', 'keystone.clients.subsidiary_code', 'keystone.clients.is_internal']);
  assert.deepEqual(resume(cols), ['id:directe:keystone.clients.id', 'name:directe:keystone.clients.name',
    'filiale_code:directe:keystone.clients.subsidiary_code', 'interne:transformee:keystone.clients.is_internal']);
});

test('confirmer : une source absente de pg_depend est retirée, la colonne devient calculée', () => {
  const cols = [{ colonne: 'a', genre: 'directe', simple: true, sousRequete: false, sources: [{ table: 's.t', colonne: 'x' }] }, { colonne: 'b', genre: 'directe', simple: true, sousRequete: false, sources: [{ table: 's.t', colonne: 'inventee' }] }];
  assert.deepEqual(resume(confirmer(cols, ['s.t.x'])), ['a:directe:s.t.x', 'b:calculee:']);
});

test('fluxObserves : flux saisis confirmés ou non observés, liens appliqués non décrits', () => {
  const vues = [
    { vue: 'keystone.pub_projets', sources: ['keystone.projects.code', 'keystone.clients.name'] },
    { vue: 'cursus.pub_salaries', sources: ['cursus.employes.matricule'] },
    { vue: 'vigie.pub_hse_projet', sources: ['vigie.events.id'] },
  ];
  const liens = [
    { vue: 'keystone.pub_projets', lecteur: 'codex_app', etat: 'applique' },
    { vue: 'cursus.pub_salaries', lecteur: 'keystone_app', etat: 'applique' },
    { vue: 'vigie.pub_hse_projet', lecteur: 'keystone_app', etat: 'applique' },
    { vue: 'keystone.pub_projets', lecteur: 'vigie_app', etat: 'a_appliquer' },
    { vue: 'keystone.pub_projets', lecteur: 'matrix_app', etat: 'applique' },
  ];
  const flux = [
    { id: 'F01', de: 'keystone', vers: 'codex', source: ['projects'] },
    { id: 'F02', de: 'cursus', vers: 'keystone', source: ['chantiers'] },
    { id: 'F03', de: 'keystone', vers: 'vigie', source: [] },
  ];
  const r = fluxObserves({ vues, liens, flux });
  assert.deepEqual(r.saisis.map(s => [s.id, s.etat]), [['F01', 'confirme'], ['F02', 'non_observe'], ['F03', 'non_observe']]);
  assert.deepEqual(r.saisis[0].vues, ['keystone.pub_projets']);
  assert.deepEqual(r.nonDecrits.map(o => `${o.de}>${o.vers}:${o.tables.join(',')}`), ['cursus>keystone:employes', 'vigie>keystone:events']);
});
