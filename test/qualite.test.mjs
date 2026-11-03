// Qualité des données (E-09, outils/qualite.mjs). Règles pures toujours ; contrôle sur PostgreSQL avec
// MATRIX_TEST_DATABASE_URL (matrix_app) et MATRIX_TEST_ADMIN_URL (création d'une table d'essai dans le schéma crucible).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validerRegle, chargerRegles, requeteRegle, evaluer, controlerQualite, suivreIncidents, graviteResultat } from '../outils/qualite.mjs';
import { client } from '../outils/sonde.mjs';

test('règles du dépôt valides', () => {
  const r = chargerRegles(JSON.parse(readFileSync(new URL('../data/regles-qualite.json', import.meta.url), 'utf8')));
  assert.ok(r.length >= 10);
});

test('validation : id, table, type, colonnes, paramètres, doublons', () => {
  const ok = { id: 'Q01', table: 'keystone.projects', type: 'unicite', colonnes: ['code'], libelle: 'x' };
  assert.equal(validerRegle(ok).gravite, 'attention');
  for (const [m, re] of [[{ id: 'X1' }, /id/], [{ table: 'keystone' }, /table/], [{ table: 'matrix.pays' }, /table/], [{ type: 'regex' }, /type/],
    [{ colonnes: ['code; drop'] }, /colonne/], [{ gravite: 'grave' }, /gravité/], [{ libelle: ' ' }, /libellé/]])
    assert.throws(() => validerRegle({ ...ok, ...m }), re);
  assert.throws(() => validerRegle({ ...ok, type: 'fraicheur', colonne: 'c', maxJours: 0 }), /maxJours/);
  assert.throws(() => validerRegle({ ...ok, type: 'non_nul', colonne: 'c', seuil: 1 }), /seuil/);
  assert.throws(() => validerRegle({ ...ok, type: 'plage', colonne: 'c' }), /min ou max/);
  assert.throws(() => validerRegle({ ...ok, type: 'plage', colonne: 'c', max: 'demain' }), /max/);
  assert.throws(() => validerRegle({ ...ok, type: 'valeurs', colonne: 'c', liste: [] }), /liste/);
  assert.throws(() => chargerRegles({ regles: [ok, ok] }), /double/);
});

test('requêtes : identifiants cités, valeurs en paramètres', () => {
  const p = requeteRegle(validerRegle({ id: 'Q02', table: 'vigie.events', type: 'valeurs', colonne: 'type', liste: ["AT'; --", 'MP'], libelle: 'x' }));
  assert.match(p.sql, /"vigie"\."events"/);
  assert.ok(!p.sql.includes("AT'"));
  assert.deepEqual(p.params, [["AT'; --", 'MP']]);
  const d = requeteRegle(validerRegle({ id: 'Q03', table: 'vigie.events', type: 'plage', colonne: 'occurred_on', min: '2020-01-01', max: "aujourd'hui", libelle: 'x' }));
  assert.match(d.sql, /\$1::date/);
  assert.match(d.sql, /current_date/);
  assert.deepEqual(d.params, ['2020-01-01']);
});

test('évaluation : fraîcheur, vides, doublons, hors plage', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const f = validerRegle({ id: 'Q01', table: 'codex.documents', type: 'fraicheur', colonne: 'issued_at', maxJours: 30, libelle: 'x' });
  assert.equal(evaluer(f, { derniere: '2026-10-30T00:00:00Z', total: 3 }, now).etat, 'ok');
  assert.equal(evaluer(f, { derniere: '2026-09-01T00:00:00Z', total: 3 }, now).etat, 'incident');
  assert.equal(evaluer(f, { derniere: null, total: 0 }, now).detail, 'aucune valeur');
  const n = validerRegle({ id: 'Q02', table: 'keystone.projects', type: 'non_nul', colonne: 'pm_person_id', seuil: 0.2, libelle: 'x' });
  assert.equal(evaluer(n, { mesure: 2, total: 10 }).etat, 'ok');
  assert.equal(evaluer(n, { mesure: 3, total: 10 }).etat, 'incident');
  assert.equal(evaluer(n, { mesure: 0, total: 0 }).etat, 'ok');
  const u = validerRegle({ id: 'Q03', table: 'keystone.projects', type: 'unicite', colonnes: ['code'], libelle: 'x', gravite: 'erreur' });
  const r = { ...evaluer(u, { mesure: 1, total: 2, exemples: ['P1'] }), gravite: 'erreur' };
  assert.deepEqual([r.etat, r.exemples], ['incident', ['P1']]);
  assert.equal(graviteResultat(r), 'erreur');
  assert.equal(graviteResultat({ etat: 'non_controlable' }), 'info');
});

test('incidents : ouverts, suivis, clos ; non contrôlable sans effet', () => {
  const r = (id, etat, mesure) => ({ id, table: 't.x', libelle: id, gravite: 'attention', etat, mesure, detail: `${mesure}` });
  let s = suivreIncidents(null, [r('Q01', 'incident', 3), r('Q02', 'ok', 0)], '2026-11-01T00:00:00Z');
  assert.deepEqual(s.incidents.map(i => [i.regle, i.ouvertLe, i.closLe]), [['Q01', '2026-11-01T00:00:00Z', undefined]]);
  s = suivreIncidents(s, [r('Q01', 'incident', 5)], '2026-11-02T00:00:00Z');
  assert.deepEqual([s.incidents.length, s.incidents[0].ouvertLe, s.incidents[0].mesure], [1, '2026-11-01T00:00:00Z', 5]);
  s = suivreIncidents(s, [r('Q01', 'non_controlable')], '2026-11-03T00:00:00Z');
  assert.equal(s.incidents[0].closLe, undefined);
  s = suivreIncidents(s, [r('Q01', 'ok', 0)], '2026-11-04T00:00:00Z');
  assert.equal(s.incidents[0].closLe, '2026-11-04T00:00:00Z');
  s = suivreIncidents(s, [r('Q01', 'incident', 1)], '2026-11-05T00:00:00Z');
  assert.deepEqual(s.incidents.map(i => [i.ouvertLe, i.closLe ?? null]), [['2026-11-05T00:00:00Z', null], ['2026-11-01T00:00:00Z', '2026-11-04T00:00:00Z']]);
});

const BASE = process.env.MATRIX_TEST_DATABASE_URL, ADMIN = process.env.MATRIX_TEST_ADMIN_URL;
test('serveur : règles exécutées en lecture seule, colonne fermée non lue', { skip: !(BASE && ADMIN) && 'MATRIX_TEST_DATABASE_URL ou MATRIX_TEST_ADMIN_URL absent' }, async () => {
  const admin = client(ADMIN), db = client(BASE);
  await Promise.all([admin.connect(), db.connect()]);
  const t = `e09_essai_${Date.now().toString(36)}`;
  try {
    await admin.query(`CREATE TABLE crucible.${t} (id int PRIMARY KEY, code text, etat text, debut date, secret text);
      INSERT INTO crucible.${t} VALUES (1, 'A', 'ouvert', '2026-01-01', 's'), (2, 'A', 'clos', '2099-01-01', 's'), (3, NULL, 'perdu', '2026-02-01', 's');
      GRANT SELECT (id, code, etat, debut) ON crucible.${t} TO matrix_lecture`);
    const colonnes = [...['id', 'code', 'etat', 'debut'].map(nom => ({ schema: 'crucible', table: t, nom, lisible: true })), { schema: 'crucible', table: t, nom: 'secret', lisible: false }];
    const regles = chargerRegles({ regles: [
      { id: 'Q01', table: `crucible.${t}`, type: 'unicite', colonnes: ['code'], libelle: 'code unique', gravite: 'erreur' },
      { id: 'Q02', table: `crucible.${t}`, type: 'non_nul', colonne: 'code', libelle: 'code renseigné' },
      { id: 'Q03', table: `crucible.${t}`, type: 'plage', colonne: 'debut', max: "aujourd'hui", libelle: 'pas de date future' },
      { id: 'Q04', table: `crucible.${t}`, type: 'valeurs', colonne: 'etat', liste: ['ouvert', 'clos'], libelle: 'états admis' },
      { id: 'Q05', table: `crucible.${t}`, type: 'fraicheur', colonne: 'debut', maxJours: 100000, libelle: 'récent' },
      { id: 'Q06', table: `crucible.${t}`, type: 'non_nul', colonne: 'secret', libelle: 'fermée' },
      { id: 'Q07', table: `crucible.${t}`, type: 'non_nul', colonne: 'absente', libelle: 'absente' },
    ] });
    const r = Object.fromEntries((await controlerQualite(db, regles, colonnes)).map(x => [x.id, x]));
    assert.deepEqual([r.Q01.etat, r.Q01.mesure, r.Q01.exemples], ['incident', 1, ['A']]);
    assert.deepEqual([r.Q02.etat, r.Q02.mesure, r.Q02.total], ['incident', 1, 3]);
    assert.deepEqual([r.Q03.etat, r.Q03.exemples], ['incident', ['2099-01-01']]);
    assert.deepEqual([r.Q04.etat, r.Q04.exemples], ['incident', ['perdu']]);
    assert.equal(r.Q05.etat, 'ok');
    assert.match(r.Q06.detail, /fermée/);
    assert.match(r.Q07.detail, /absent/);
    // La connexion n'est pas restée dans une transaction.
    assert.equal((await db.query('SELECT 1 AS un')).rows[0].un, 1);
  } finally {
    await admin.query(`DROP TABLE IF EXISTS crucible.${t}`).catch(() => {});
    await Promise.all([admin.end(), db.end()]);
  }
});
