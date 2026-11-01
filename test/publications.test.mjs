// Tests des publications administrées par Matrix (M-18, lot P2) : npm test.
// La partie base de données ne tourne qu'avec trois connexions sur un serveur d'essai où le socle, partage/12 et 13 sont
// joués : MATRIX_TEST_DATABASE_URL (matrix_app), MATRIX_TEST_GESTION_URL (matrix_gestion) et MATRIX_TEST_ADMIN_URL
// (superutilisateur, pour créer une table d'essai dans le schéma keystone et lire comme un outil lecteur). Elle crée une
// table keystone.p2_essai_<n> et la vue keystone.pub_p2_essai_<n>, qu'elle supprime à la fin (la ligne du registre
// reste, retirée) : à ne jamais lancer sur le serveur en service.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genererDefinition, verifierSql, preparerPublication, ecartContrat, validerVue,
  enregistrerPublication, appliquerPublication, retirerPublication, appliquerLien, lirePublication, listerPublications } from '../outils/publications.mjs';
import { client } from '../outils/sonde.mjs';

test('nom de publication : outil et préfixe pub_ obligatoires', () => {
  assert.equal(validerVue('keystone.pub_projets'), 'keystone.pub_projets');
  for (const v of ['keystone.projets', 'matrix.pub_sites', 'Keystone.pub_x', 'keystone.pub_x;drop', 'pub_x']) assert.throws(() => validerVue(v));
});

test('mode colonnes : noms cités, renommage, filtre entre parenthèses', () => {
  assert.equal(genererDefinition({ outil: 'keystone', source: 'keystone.projects', colonnes: [{ colonne: 'id', nom: 'id' }, { colonne: 'code', nom: 'code_projet' }], filtre: "status <> 'draft'" }),
    `SELECT t."id", t."code" AS "code_projet"\n  FROM "keystone"."projects" t\n WHERE (status <> 'draft')`);
  assert.equal(genererDefinition({ outil: 'codex', source: 'codex.documents', colonnes: ['id'] }), 'SELECT t."id"\n  FROM "codex"."documents" t');
});

test('mode colonnes : refus d\'une table d\'un autre outil, d\'un nom invalide, d\'un doublon', () => {
  assert.throws(() => genererDefinition({ outil: 'keystone', source: 'codex.documents', colonnes: ['id'] }), /schéma keystone/);
  assert.throws(() => genererDefinition({ outil: 'keystone', source: 'keystone.projects', colonnes: ['id"; drop'] }), /colonne invalide/);
  assert.throws(() => genererDefinition({ outil: 'keystone', source: 'keystone.projects', colonnes: [{ colonne: 'id', nom: 'x' }, { colonne: 'code', nom: 'x' }] }), /double/);
  assert.throws(() => genererDefinition({ outil: 'keystone', source: 'keystone.projects', colonnes: [] }), /au moins une/);
});

test('filtre : une condition, sans sous-requête ni instruction en plus', () => {
  assert.equal(verifierSql("status IN ('a', 'b;c')", { filtre: true }), "status IN ('a', 'b;c')");
  for (const f of ['true) UNION SELECT 1 FROM codex.x WHERE (true', 'id IN (SELECT id FROM keystone.x)', 'true; DROP TABLE x', 'true -- x', '(true', "code = 'x"])
    assert.throws(() => verifierSql(f, { filtre: true }), f);
});

test('mode sql : une seule requête SELECT, sans commentaire', () => {
  assert.equal(verifierSql('SELECT 1;'), 'SELECT 1');
  assert.equal(verifierSql('WITH x AS (SELECT 1) SELECT * FROM x'), 'WITH x AS (SELECT 1) SELECT * FROM x');
  for (const s of ['DELETE FROM x', 'SELECT 1; SELECT 2', 'SELECT 1 /* x */', 'SELECT $$x$$', '']) assert.throws(() => verifierSql(s), s);
  assert.equal(preparerPublication({ vue: 'vigie.pub_x', mode: 'sql', definition: 'SELECT 1 AS a' }).definition, 'SELECT 1 AS a');
});

test('contrat : on ajoute en fin, on ne retire, ne renomme ni ne change de type', () => {
  const avant = [{ nom: 'id', type: 'integer' }, { nom: 'code', type: 'text' }];
  assert.equal(ecartContrat(avant, [...avant, { nom: 'note', type: 'text' }]), null);
  assert.equal(ecartContrat(null, [{ nom: 'x', type: 'text' }]), null);
  assert.match(ecartContrat(avant, [avant[0]]), /code disparaît/);
  assert.match(ecartContrat(avant, [avant[0], { nom: 'code_projet', type: 'text' }]), /s’appelle code/);
  assert.match(ecartContrat(avant, [avant[0], { nom: 'code', type: 'integer' }]), /change de type/);
});

const APP = process.env.MATRIX_TEST_DATABASE_URL, GESTION = process.env.MATRIX_TEST_GESTION_URL, ADMIN = process.env.MATRIX_TEST_ADMIN_URL;
test('serveur : publier, lier, refuser une rupture de contrat ou une colonne sensible, retirer',
  { skip: !(APP && GESTION && ADMIN) && 'MATRIX_TEST_DATABASE_URL, MATRIX_TEST_GESTION_URL ou MATRIX_TEST_ADMIN_URL absent' }, async () => {
  const n = Date.now().toString(36), table = `p2_essai_${n}`, vue = `keystone.pub_p2_essai_${n}`;
  const app = client(APP), gestion = client(GESTION), admin = client(ADMIN);
  await Promise.all([app.connect(), gestion.connect(), admin.connect()]);
  // Lecture comme un outil lecteur : SET ROLE dans une transaction annulée.
  const lit = async (role, sql) => {
    await admin.query('BEGIN');
    try { await admin.query(`SET LOCAL ROLE ${role}`); return (await admin.query(sql)).rows; }
    catch (e) { return e.code; } finally { await admin.query('ROLLBACK'); }
  };
  try {
    await admin.query(`SET ROLE keystone_app; CREATE TABLE keystone.${table} (id int PRIMARY KEY, code text NOT NULL, note text, secret text); RESET ROLE`);
    await admin.query(`INSERT INTO keystone.${table} VALUES (1, 'A', 'n', 's'), (2, 'B', null, null)`);
    await admin.query(`INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif) VALUES ('keystone', $1, 'secret', 'essai')`, [table]);

    // 1. Brouillon (matrix_app), puis application (matrix_gestion).
    await enregistrerPublication(app, { vue, mode: 'colonnes', source: `keystone.${table}`, colonnes: [{ colonne: 'id' }, { colonne: 'code', nom: 'code_essai' }], filtre: "code <> 'Z'", description: 'Essai P2' }, 'test');
    assert.equal((await lirePublication(app, vue)).etat, 'brouillon');
    const r = await appliquerPublication(gestion, vue, 'test');
    assert.deepEqual(r.contrat.map(c => c.nom), ['id', 'code_essai']);
    const p = await lirePublication(app, vue);
    assert.equal(p.etat, 'appliquee'); assert.equal(p.proprietaire, 'matrix_gestion'); assert.equal(p.existe, true);
    assert.ok(p.journal.some(j => j.action === 'application'));
    assert.equal(await lit('arche_app', `SELECT * FROM ${vue}`), '42501');   // aucun lien encore

    // 2. Lien autorisé, appliqué tout de suite.
    await app.query(`INSERT INTO matrix.liens (vue, lecteur, statut, decide_par, decide_le) VALUES ($1, 'arche_app', 'autorise', 'test', now())`, [vue]);
    assert.deepEqual(await appliquerLien(gestion, { vue, lecteur: 'arche_app' }), { applique: true, droit: 'accordé' });
    assert.equal((await lit('arche_app', `SELECT * FROM ${vue}`)).length, 2);

    // 3. Colonne ajoutée en fin : acceptée ; les lecteurs gardent leur droit.
    await enregistrerPublication(app, { vue, mode: 'colonnes', source: `keystone.${table}`, colonnes: [{ colonne: 'id' }, { colonne: 'code', nom: 'code_essai' }, { colonne: 'note' }], description: 'Essai P2' }, 'test');
    assert.deepEqual((await appliquerPublication(gestion, vue, 'test')).lecteurs, ['arche_app']);
    assert.equal((await lit('arche_app', `SELECT note FROM ${vue} WHERE id = 1`))[0].note, 'n');

    // 4. Colonne retirée : refusée, la vue reste telle quelle, la publication passe en erreur.
    await enregistrerPublication(app, { vue, mode: 'colonnes', source: `keystone.${table}`, colonnes: [{ colonne: 'id' }, { colonne: 'note' }] }, 'test');
    await assert.rejects(appliquerPublication(gestion, vue, 'test'), /contrat de .* rompu/);
    assert.equal((await lirePublication(app, vue)).etat, 'erreur');
    assert.equal((await lit('arche_app', `SELECT code_essai FROM ${vue} WHERE id = 2`))[0].code_essai, 'B');

    // 5. Colonne sensible publiée : refusée par le contrôle du serveur.
    await enregistrerPublication(app, { vue, mode: 'colonnes', source: `keystone.${table}`, colonnes: [{ colonne: 'id' }, { colonne: 'code', nom: 'code_essai' }, { colonne: 'note' }, { colonne: 'secret' }] }, 'test');
    await assert.rejects(appliquerPublication(gestion, vue, 'test'), /colonne sensible/);
    assert.equal((await lit('arche_app', `SELECT * FROM ${vue}`))[0].secret, undefined);

    // 6. Mode sql qui lit un autre schéma : refusé.
    await enregistrerPublication(app, { vue, mode: 'sql', definition: `SELECT t.id, t.code AS code_essai, t.note, (SELECT count(*) FROM matrix.liens) AS n FROM keystone.${table} t` }, 'test');
    await assert.rejects(appliquerPublication(gestion, vue, 'test'), /droit refusé|autre schéma/);

    // 7. Retour à une définition valide, puis lien refusé : droit retiré tout de suite.
    await enregistrerPublication(app, { vue, mode: 'colonnes', source: `keystone.${table}`, colonnes: [{ colonne: 'id' }, { colonne: 'code', nom: 'code_essai' }, { colonne: 'note' }] }, 'test');
    await appliquerPublication(gestion, vue, 'test');
    await assert.rejects(retirerPublication(gestion, vue, 'test', 'essai'), /encore lue par arche_app/);
    await app.query(`UPDATE matrix.liens SET statut = 'refuse', motif = 'essai', decide_par = 'test', decide_le = now() WHERE vue = $1`, [vue]);
    assert.deepEqual(await appliquerLien(gestion, { vue, lecteur: 'arche_app' }), { applique: true, droit: 'retiré' });
    assert.equal(await lit('arche_app', `SELECT * FROM ${vue}`), '42501');

    // 8. Une vue pas encore reprise (propriétaire : l'outil) n'est pas touchée.
    await admin.query(`SET ROLE keystone_app; CREATE VIEW keystone.pub_p2_outil_${n} AS SELECT id FROM keystone.${table}; RESET ROLE`);
    assert.equal((await appliquerLien(gestion, { vue: `keystone.pub_p2_outil_${n}`, lecteur: 'arche_app' })).applique, false);
    assert.ok((await listerPublications(app)).nonReprises.some(v => v.vue === `keystone.pub_p2_outil_${n}`));

    // 9. Retrait : vue supprimée, ligne du registre gardée.
    await assert.rejects(retirerPublication(gestion, vue, 'test', ''), /motif/);
    assert.deepEqual(await retirerPublication(gestion, vue, 'test', 'fin de l’essai'), { vue, etat: 'retiree' });
    const fin = await lirePublication(app, vue);
    assert.equal(fin.existe, false); assert.equal(fin.etat, 'retiree');

    // Le serveur reste conforme (aucune erreur de droits.verifier() sur ces objets).
    const { rows } = await admin.query(`SELECT * FROM droits.verifier() WHERE gravite = 'erreur'`);
    assert.deepEqual(rows, []);
  } finally {
    await admin.query('RESET ROLE').catch(() => {});
    await admin.query(`DROP VIEW IF EXISTS keystone.pub_p2_outil_${n}, ${vue}; DROP TABLE IF EXISTS keystone.${table}`).catch(() => {});
    await admin.query(`DELETE FROM droits.colonnes_sensibles WHERE table_nom = $1`, [table]).catch(() => {});
    await app.query(`UPDATE matrix.liens SET statut = 'refuse', motif = 'fin de l’essai', decide_par = 'test', decide_le = now() WHERE vue = $1 AND statut <> 'refuse'`, [vue]).catch(() => {});
    await Promise.all([app.end(), gestion.end(), admin.end()]);
  }
});

test('serveur : lien d’écriture, exécution accordée puis retirée, jamais à Matrix',
  { skip: !(APP && GESTION && ADMIN) && 'MATRIX_TEST_DATABASE_URL, MATRIX_TEST_GESTION_URL ou MATRIX_TEST_ADMIN_URL absent' }, async () => {
  const n = Date.now().toString(36), table = `p4_essai_${n}`, fn = `keystone.pub_ecrire_p4_${n}`, fnFaible = `keystone.pub_faible_p4_${n}`;
  const app = client(APP), gestion = client(GESTION), admin = client(ADMIN);
  await Promise.all([app.connect(), gestion.connect(), admin.connect()]);
  const comme = async (role, sql) => {
    await admin.query('BEGIN');
    try { await admin.query(`SET LOCAL ROLE ${role}`); return (await admin.query(sql)).rows; }
    catch (e) { return e.code; } finally { await admin.query('ROLLBACK'); }
  };
  try {
    await admin.query(`SET ROLE keystone_app;
      CREATE TABLE keystone.${table} (id serial PRIMARY KEY, texte text NOT NULL, par text NOT NULL);
      CREATE FUNCTION ${fn}(p_texte text) RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = keystone, pg_temp
        AS $$ INSERT INTO keystone.${table} (texte, par) VALUES (p_texte, session_user) RETURNING id $$;
      REVOKE EXECUTE ON FUNCTION ${fn}(text) FROM PUBLIC;
      CREATE FUNCTION ${fnFaible}() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
      REVOKE EXECUTE ON FUNCTION ${fnFaible}() FROM PUBLIC;
      RESET ROLE`);
    const lien = (vue, statut) => app.query(
      `INSERT INTO matrix.liens (vue, lecteur, statut, nature, motif, decide_par, decide_le) VALUES ($1, 'arche_app', $2, 'execution', 'essai', 'test', now())
       ON CONFLICT (vue, lecteur) DO UPDATE SET statut = EXCLUDED.statut, motif = 'essai', decide_le = now()`, [vue, statut]);

    // Avant tout lien : ni Arche ni Matrix n'exécutent la fonction.
    assert.equal(await comme('arche_app', `SELECT ${fn}('x')`), '42501');
    assert.equal((await gestion.query(`SELECT has_function_privilege('matrix_gestion', '${fn}(text)', 'EXECUTE') AS e`)).rows[0].e, false);
    // Sans lien autorisé, droits.accorder_execution ne fait que retirer.
    assert.equal((await gestion.query('SELECT droits.accorder_execution($1, $2) AS r', [fn, 'arche_app'])).rows[0].r, 'retire');

    // Lien autorisé : exécution accordée tout de suite, l'écriture passe par la fonction, jamais par la table.
    await lien(fn, 'autorise');
    assert.deepEqual(await appliquerLien(gestion, { vue: fn, lecteur: 'arche_app' }), { applique: true, droit: 'accordé' });
    assert.equal((await comme('arche_app', `SELECT ${fn}('écrit par Arche') AS id`)).length, 1);
    assert.equal(await comme('arche_app', `INSERT INTO keystone.${table} (texte, par) VALUES ('direct', 'x')`), '42501');
    assert.equal((await gestion.query(`SELECT has_function_privilege('matrix_gestion', '${fn}(text)', 'EXECUTE') AS e`)).rows[0].e, false);

    // Fonction sans SECURITY DEFINER ni search_path : jamais accordée.
    await lien(fnFaible, 'autorise');
    await assert.rejects(appliquerLien(gestion, { vue: fnFaible, lecteur: 'arche_app' }), /SECURITY DEFINER/);

    // Lien refusé : droit retiré tout de suite.
    await lien(fn, 'refuse'); await lien(fnFaible, 'refuse');
    assert.deepEqual(await appliquerLien(gestion, { vue: fn, lecteur: 'arche_app' }), { applique: true, droit: 'retiré' });
    assert.equal(await comme('arche_app', `SELECT ${fn}('x')`), '42501');

    // Le socle reste conforme, sauf l'avertissement attendu sur la fonction faible.
    const { rows } = await admin.query(`SELECT * FROM droits.verifier() WHERE gravite = 'erreur'`);
    assert.deepEqual(rows, []);
    const { rows: att } = await admin.query(`SELECT constat FROM droits.verifier() WHERE gravite = 'attention' AND objet LIKE $1`, [`%pub_faible_p4_${n}%`]);
    assert.match(att[0].constat, /SECURITY DEFINER/);
  } finally {
    await admin.query('RESET ROLE').catch(() => {});
    await admin.query(`DROP FUNCTION IF EXISTS ${fn}(text), ${fnFaible}(); DROP TABLE IF EXISTS keystone.${table}`).catch(() => {});
    await Promise.all([app.end(), gestion.end(), admin.end()]);
  }
});
