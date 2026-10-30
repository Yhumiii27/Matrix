// Journal unifié, REX et correspondances (outils/consultation.mjs, écart E-11). Les filtres sont éprouvés sur un client
// SQL simulé ; les décisions sur les correspondances, sur un vrai serveur quand MATRIX_TEST_DATABASE_URL est fourni.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireJournal, lireRex, deciderCorrespondance } from '../outils/consultation.mjs';
import { client } from '../outils/sonde.mjs';

// Client simulé : la vue existe, chaque requête est notée, les lignes rendues sont celles données.
function faux(lignes = [], existe = true) {
  const requetes = [];
  return { requetes, query: async (sql, params = []) => {
    requetes.push({ sql, params });
    return sql.includes('to_regclass') ? { rows: [{ existe }] } : { rows: lignes };
  } };
}

test('journal : vue absente signalée sans erreur', async () => {
  assert.deepEqual(await lireJournal(faux([], false)), { absente: true, lignes: [], suite: null });
});

test('journal : filtres en paramètres, recherche littérale, jours de Paris', async () => {
  const db = faux();
  await lireJournal(db, { outil: 'keystone', projet: ' K-2601 ', recherche: '50%_', depuis: '2026-10-01', jusqu: '2026-10-31' });
  const { sql, params } = db.requetes.at(-1);
  assert.deepEqual(params, ['keystone', 'K-2601', '%50\\%\\_%', '2026-10-01', '2026-10-31']);
  assert.match(sql, /AT TIME ZONE 'Europe\/Paris'/);
  assert.doesNotMatch(sql, /50%/);
});

test('journal : valeurs refusées avant toute requête de lecture', async () => {
  await assert.rejects(lireJournal(faux(), { outil: 'bidon' }), /outil inconnu/);
  await assert.rejects(lireJournal(faux(), { depuis: '30/10/2026' }), /AAAA-MM-JJ/);
  await assert.rejects(lireJournal(faux(), { apres: { quand: 'hier' } }), /pagination/);
});

test('journal : page suivante quand il reste des lignes, bornée à 200', async () => {
  const ligne = i => ({ quand: new Date(Date.UTC(2026, 9, 30, 12, 0, 60 - i)), ref_source: `a:${i}` });
  const r = await lireJournal(faux([0, 1, 2].map(ligne)), { limite: 2 });
  assert.equal(r.lignes.length, 2);
  assert.deepEqual(r.suite, { quand: ligne(1).quand.toISOString(), ref_source: 'a:1' });
  const db = faux();
  await lireJournal(db, { limite: 5000 });
  assert.match(db.requetes.at(-1).sql, /LIMIT 201/);
});

test('REX : code projet ou CAPEX, catégories lues', async () => {
  const db = faux([{ categorie: 'site' }]);
  const r = await lireRex(db, { code: 'CPX-APM-2026-01', outil: 'arche' });
  assert.deepEqual(db.requetes[1].params, ['arche', 'CPX-APM-2026-01']);
  assert.match(db.requetes[1].sql, /projet_code = \$2 OR capex_code = \$2/);
  assert.deepEqual(r.categories, ['site']);
});

test('décision : contrôles avant la base', async () => {
  await assert.rejects(deciderCorrespondance(faux(), { id: 'x', statut: 'valide' }, 'claire'), /inconnue/);
  await assert.rejects(deciderCorrespondance(faux(), { id: 1, statut: 'bidon' }, 'claire'), /statut inconnu/);
  await assert.rejects(deciderCorrespondance(faux(), { id: 1, statut: 'rejete' }, 'claire'), /motif obligatoire/);
});

const URL = process.env.MATRIX_TEST_DATABASE_URL;
test('décisions sur une vraie table : transitions, pivot, motif, contraintes', { skip: !URL && 'MATRIX_TEST_DATABASE_URL absent' }, async () => {
  const db = client(URL);
  await db.connect();
  const ids = [];
  try {
    const ajout = async (objet, pivot, statut = 'propose') => {
      const { rows: [r] } = await db.query(
        `INSERT INTO matrix.correspondances (objet, outil, table_locale, id_local, pivot, methode, statut)
         VALUES ($1, 'codex', 'essai', 'essai-' || gen_random_uuid(), $2, 'manuel', $3) RETURNING id`, [objet, pivot, statut]);
      ids.push(r.id); return r.id;
    };
    const p = await ajout('personne', 'EMP-0001');
    let r = await deciderCorrespondance(db, { id: p, statut: 'valide', pivot: 'PRV-0002' }, 'rh');
    assert.deepEqual([r.statut, r.pivot, r.pivot_provisoire, r.decide_par], ['valide', 'PRV-0002', true, 'rh']);
    await assert.rejects(deciderCorrespondance(db, { id: p, statut: 'valide' }, 'rh'), /ne peut pas passer/);
    r = await deciderCorrespondance(db, { id: p, statut: 'retire', note: 'doublon' }, 'rh');
    assert.equal(r.statut, 'retire');
    const s = await ajout('site', 'lyon');
    await assert.rejects(deciderCorrespondance(db, { id: s, statut: 'valide', pivot: 'Lyon Centre' }, 'dsi'), /refuse la décision/);
    assert.equal((await db.query('SELECT statut FROM matrix.correspondances WHERE id = $1', [s])).rows[0].statut, 'propose');
    const c = await ajout('projet', null, 'a_creer');
    await assert.rejects(deciderCorrespondance(db, { id: c, statut: 'valide' }, 'dsi'), /pivot\) est obligatoire/);
    assert.equal((await deciderCorrespondance(db, { id: c, statut: 'valide', pivot: 'K-2614' }, 'dsi')).pivot, 'K-2614');
  } finally {
    // Lignes d'essai retirées (la table n'est pas en ajout seul) ; ne jamais lancer sur le serveur en service.
    if (ids.length) await db.query('DELETE FROM matrix.correspondances WHERE id = ANY ($1)', [ids]).catch(() => {});
    await db.end();
  }
});
