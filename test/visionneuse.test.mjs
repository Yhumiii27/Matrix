// Visionneuse des données (outils/visionneuse.mjs). Validation toujours ; lecture sur PostgreSQL avec
// MATRIX_TEST_DATABASE_URL (matrix_app) et MATRIX_TEST_ADMIN_URL (table d'essai dans le schéma crucible, supprimée ensuite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from '../outils/sonde.mjs';
import { validerDemande, lireDonnees } from '../outils/visionneuse.mjs';

test('demande : outil, table, page, taille, tri et filtre contrôlés', () => {
  assert.deepEqual(validerDemande({ outil: 'keystone', table: 'projects' }),
    { outil: 'keystone', table: 'projects', par: 50, page: 1, tri: null, sens: 'asc', colonne: null, contient: '' });
  assert.equal(validerDemande({ outil: 'vigie', table: 'events', par: '100', page: '3', sens: 'desc' }).par, 100);
  assert.equal(validerDemande({ outil: 'vigie', table: 'events', par: '7' }).par, 50);
  assert.equal(validerDemande({ outil: 'vigie', table: 'events', page: '-4' }).page, 1);
  assert.equal(validerDemande({ outil: 'vigie', table: 'events', colonne: 'title' }).colonne, null);   // sans texte, pas de filtre
  for (const [q, re] of [[{ outil: 'droits', table: 'x' }, /outil inconnu/], [{ outil: 'vigie', table: 'events; drop' }, /table invalide/],
    [{ outil: 'vigie', table: 'events', tri: 'a"b' }, /tri invalide/], [{ outil: 'vigie', table: 'events', colonne: 'x y', contient: 'a' }, /filtre invalide/]])
    assert.throws(() => validerDemande(q), re);
});

const BASE = process.env.MATRIX_TEST_DATABASE_URL, ADMIN = process.env.MATRIX_TEST_ADMIN_URL;
test('serveur : colonnes fermées jamais lues, tri, filtre, pages, binaire, texte long', { skip: !(BASE && ADMIN) && 'MATRIX_TEST_DATABASE_URL ou MATRIX_TEST_ADMIN_URL absent' }, async () => {
  const admin = client(ADMIN), db = client(BASE);
  await Promise.all([admin.connect(), db.connect()]);
  const t = `vis_essai_${Date.now().toString(36)}`, f = `vis_ferme_${Date.now().toString(36)}`;
  try {
    // Colonnes sensibles déclarées au socle avant la création : le déclencheur droits_ddl les ferme à matrix_lecture.
    await admin.query(`INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif) VALUES
      ('crucible', '${t}', 'secret', 'essai de la visionneuse'), ('crucible', '${f}', '*', 'essai de la visionneuse');
      CREATE TABLE crucible.${t} (id int PRIMARY KEY, nom text, note text, photo bytea, secret text);
      INSERT INTO crucible.${t} SELECT g, 'nom ' || g, CASE WHEN g = 3 THEN repeat('x', 700) END, CASE WHEN g = 1 THEN '\\x0102'::bytea END, 's' FROM generate_series(1, 7) g;
      CREATE TABLE crucible.${f} (x text);`);
    const r = await lireDonnees(db, { outil: 'crucible', table: t, par: 25, tri: 'id', sens: 'desc' });
    assert.equal(r.genre, 'table');
    assert.deepEqual(r.colonnes.map(c => [c.nom, c.lisible]), [['id', true], ['nom', true], ['note', true], ['photo', true], ['secret', false]]);
    assert.equal(r.total, 7);
    assert.deepEqual(r.lignes[0], ['7', 'nom 7', null, null, { ferme: true }]);
    const l3 = r.lignes.find(l => l[0] === '3'), l1 = r.lignes.find(l => l[0] === '1');
    assert.equal(l3[2].length, 501);
    assert.ok(l3[2].endsWith('…'));
    assert.equal(l1[3], '(binaire, 2 octets)');
    // Pages de 25 : une seule ; filtre (accents, joker échappé) ; colonne fermée refusée au tri et au filtre.
    assert.equal(r.suivante, false);
    const p = await lireDonnees(db, { outil: 'crucible', table: t, par: 25, colonne: 'nom', contient: 'NOM 5' });
    assert.deepEqual([p.total, p.lignes.length, p.lignes[0][0]], [1, 1, '5']);
    assert.equal((await lireDonnees(db, { outil: 'crucible', table: t, colonne: 'nom', contient: '%' })).total, 0);
    await assert.rejects(lireDonnees(db, { outil: 'crucible', table: t, tri: 'secret' }), /fermée/);
    await assert.rejects(lireDonnees(db, { outil: 'crucible', table: t, colonne: 'secret', contient: 's' }), /fermée/);
    // Table entièrement fermée : rien n'est lu. Table absente : 404.
    const fermee = await lireDonnees(db, { outil: 'crucible', table: f });
    assert.deepEqual([fermee.fermee, fermee.lignes], [true, []]);
    await assert.rejects(lireDonnees(db, { outil: 'crucible', table: 'nexiste_pas' }), e => e.code === 404);
    // La connexion ressort hors transaction.
    assert.equal((await db.query('SELECT 1 AS un')).rows[0].un, 1);
  } finally {
    await admin.query(`DROP TABLE IF EXISTS crucible.${t}; DROP TABLE IF EXISTS crucible.${f}; DELETE FROM droits.colonnes_sensibles WHERE table_nom IN ('${t}', '${f}')`).catch(() => {});
    await Promise.all([admin.end(), db.end()]);
  }
});

import { validerEdition, etatEdition, editerLigne } from '../outils/visionneuse.mjs';

test('édition : action, clé, valeurs et motif contrôlés', () => {
  assert.deepEqual(validerEdition({ outil: 'crucible', table: 'types', action: 'ajouter', valeurs: { code: 'A' }, motif: 'nouvelle option' }),
    { outil: 'crucible', table: 'types', action: 'ajouter', cle: null, valeurs: { code: 'A' }, motif: 'nouvelle option' });
  assert.equal(validerEdition({ outil: 'crucible', table: 'types', action: 'retirer', cle: { code: 'A' }, valeurs: { x: 1 }, motif: 'doublon' }).valeurs, null);
  for (const [e, re] of [[{ action: 'effacer' }, /action inconnue/], [{ action: 'corriger', valeurs: { a: 1 } }, /clé/], [{ action: 'ajouter' }, /valeurs/],
    [{ action: 'ajouter', valeurs: { 'a;b': 1 } }, /colonne invalide/], [{ action: 'ajouter', valeurs: { a: 1 }, motif: 'x' }, /motif/]])
    assert.throws(() => validerEdition({ outil: 'crucible', table: 'types', motif: 'motif valable', ...e }), re);
});

const GESTION = process.env.MATRIX_TEST_GESTION_URL;
test('serveur : édition par la fonction de l’outil, lien d’écriture exigé, refus de l’outil transmis', { skip: !(BASE && ADMIN && GESTION) && 'bases de test absentes' }, async () => {
  const admin = client(ADMIN), db = client(BASE), gestion = client(GESTION);
  await Promise.all([admin.connect(), db.connect(), gestion.connect()]);
  const t = `ed_essai_${Date.now().toString(36)}`, f = `crucible.pub_editer_${t}`;
  try {
    await admin.query(`CREATE TABLE crucible.${t} (code text PRIMARY KEY, libelle text NOT NULL, actif boolean NOT NULL DEFAULT true, par text, motif text);
      ALTER TABLE crucible.${t} OWNER TO crucible_app;
      INSERT INTO crucible.${t} (code, libelle) VALUES ('A', 'Option A');
      CREATE FUNCTION ${f}(p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text) RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = crucible, pg_temp AS $f$
        DECLARE r crucible.${t};
        BEGIN
          IF p_action = 'ajouter' THEN
            IF p_valeurs->>'libelle' IS NULL THEN RAISE EXCEPTION 'libellé obligatoire'; END IF;
            INSERT INTO ${t} (code, libelle, par, motif) VALUES (p_valeurs->>'code', p_valeurs->>'libelle', p_par, p_motif) RETURNING * INTO r;
          ELSIF p_action = 'corriger' THEN
            UPDATE ${t} SET libelle = coalesce(p_valeurs->>'libelle', libelle), par = p_par, motif = p_motif WHERE code = p_cle->>'code' RETURNING * INTO r;
          ELSE
            UPDATE ${t} SET actif = false, par = p_par, motif = p_motif WHERE code = p_cle->>'code' RETURNING * INTO r;
          END IF;
          RETURN to_jsonb(r);
        END $f$;
      ALTER FUNCTION ${f}(text, jsonb, jsonb, text, text) OWNER TO crucible_app;
      REVOKE EXECUTE ON FUNCTION ${f}(text, jsonb, jsonb, text, text) FROM PUBLIC;`);
    // Sans lien autorisé : lecture seule, modification refusée.
    const avant = await etatEdition(db, 'crucible', t);
    assert.deepEqual([avant.existe, avant.conforme, avant.executable], [true, true, false]);
    assert.match(avant.raison, /lien d’écriture/);
    await assert.rejects(editerLigne(db, { outil: 'crucible', table: t, action: 'ajouter', valeurs: { code: 'B', libelle: 'B' }, motif: 'essai sans lien' }, 'Claire'), e => e.code === 409);
    // Lien autorisé dans le registre, droit posé par le socle (matrix_gestion ne reçoit jamais EXECUTE).
    await db.query(`INSERT INTO matrix.liens (vue, lecteur, statut, nature, motif, decide_par, decide_le) VALUES ($1, 'matrix_app', 'autorise', 'execution', 'essai', 'test', now())`, [f]);
    await gestion.query('SELECT droits.accorder_execution($1, $2)', [f, 'matrix_app']);
    assert.equal((await etatEdition(db, 'crucible', t)).executable, true);
    const r = await lireDonnees(db, { outil: 'crucible', table: t });
    assert.deepEqual([r.cle, r.edition.executable], [['code'], true]);
    // Ajouter, corriger, retirer (archivage par l'outil) ; nom et motif transmis à l'outil.
    assert.equal((await editerLigne(db, { outil: 'crucible', table: t, action: 'ajouter', valeurs: { code: 'B', libelle: 'Option B' }, motif: 'nouvelle option' }, 'Claire')).resultat.code, 'B');
    const c = await editerLigne(db, { outil: 'crucible', table: t, action: 'corriger', cle: { code: 'A' }, valeurs: { libelle: 'Option A corrigée' }, motif: 'faute de frappe' }, 'Claire');
    assert.deepEqual([c.resultat.libelle, c.resultat.par, c.resultat.motif], ['Option A corrigée', 'Claire', 'faute de frappe']);
    assert.equal((await editerLigne(db, { outil: 'crucible', table: t, action: 'retirer', cle: { code: 'B' }, motif: 'doublon de A' }, 'Claire')).resultat.actif, false);
    // Refus de l'outil : son message est transmis.
    await assert.rejects(editerLigne(db, { outil: 'crucible', table: t, action: 'ajouter', valeurs: { code: 'C' }, motif: 'sans libellé' }, 'Claire'), /libellé obligatoire/);
    // Jamais d'écriture directe : matrix_app n'a aucun droit d'écriture sur la table.
    await assert.rejects(db.query(`UPDATE crucible.${t} SET libelle = 'x'`), /permission denied/);
  } finally {
    await db.query('DELETE FROM matrix.liens WHERE vue = $1', [f]).catch(() => {});
    await admin.query(`DROP FUNCTION IF EXISTS ${f}(text, jsonb, jsonb, text, text); DROP TABLE IF EXISTS crucible.${t}`).catch(() => {});
    await Promise.all([admin.end(), db.end(), gestion.end()]);
  }
});

test('serveur : fonction générique de l’outil pour toutes ses tables, colonne sensible jamais modifiée', { skip: !(BASE && ADMIN && GESTION) && 'bases de test absentes' }, async () => {
  const admin = client(ADMIN), db = client(BASE), gestion = client(GESTION);
  await Promise.all([admin.connect(), db.connect(), gestion.connect()]);
  const t = `gen_essai_${Date.now().toString(36)}`, f = 'crucible.pub_editer';
  try {
    await admin.query(`INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif) VALUES ('crucible', '${t}', 'sante', 'essai RGPD');
      CREATE TABLE crucible.${t} (id int PRIMARY KEY, libelle text, sante text);
      ALTER TABLE crucible.${t} OWNER TO crucible_app;
      INSERT INTO crucible.${t} VALUES (1, 'un', 'secret');
      CREATE OR REPLACE FUNCTION ${f}(p_table text, p_action text, p_cle jsonb, p_valeurs jsonb, p_par text, p_motif text) RETURNS jsonb
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = crucible, pg_temp AS $f$
        DECLARE r jsonb;
        BEGIN
          IF p_table <> '${t}' THEN RAISE EXCEPTION 'table % non modifiable', p_table; END IF;
          IF p_action = 'corriger' THEN
            UPDATE ${t} SET libelle = coalesce(p_valeurs->>'libelle', libelle), sante = coalesce(p_valeurs->>'sante', sante) WHERE id = (p_cle->>'id')::int;
          END IF;
          SELECT to_jsonb(x) - 'sante' INTO r FROM ${t} x WHERE id = (p_cle->>'id')::int;
          RETURN r;
        END $f$;
      ALTER FUNCTION ${f}(text, text, jsonb, jsonb, text, text) OWNER TO crucible_app;
      REVOKE EXECUTE ON FUNCTION ${f}(text, text, jsonb, jsonb, text, text) FROM PUBLIC;`);
    // Nom fixe (crucible.pub_editer) : le lien d'essai peut exister d'un passage précédent (le registre ne se vide pas).
    await db.query(`INSERT INTO matrix.liens (vue, lecteur, statut, nature, motif, decide_par, decide_le) VALUES ($1, 'matrix_app', 'autorise', 'execution', 'essai', 'test', now())
      ON CONFLICT (vue, lecteur) DO UPDATE SET statut = 'autorise', nature = 'execution', decide_par = 'test', decide_le = now()`, [f]);
    await gestion.query('SELECT droits.accorder_execution($1, $2)', [f, 'matrix_app']);
    const etat = await etatEdition(db, 'crucible', t);
    assert.deepEqual([etat.fonction, etat.generique, etat.executable], [f, true, true]);
    const ok = await editerLigne(db, { outil: 'crucible', table: t, action: 'corriger', cle: { id: '1' }, valeurs: { libelle: 'un corrigé' }, motif: 'correction' }, 'Claire');
    assert.equal(ok.resultat.libelle, 'un corrigé');
    // Colonne déclarée sensible (RGPD) : refusée par Matrix avant tout appel, même si la fonction l'accepterait.
    await assert.rejects(editerLigne(db, { outil: 'crucible', table: t, action: 'corriger', cle: { id: '1' }, valeurs: { sante: 'x' }, motif: 'essai RGPD' }, 'Claire'), /sensible/);
    assert.equal((await admin.query(`SELECT sante FROM crucible.${t}`)).rows[0].sante, 'secret');
  } finally {
    await db.query(`UPDATE matrix.liens SET statut = 'refuse', motif = 'fin de l’essai', decide_par = 'test', decide_le = now() WHERE vue = $1 AND lecteur = 'matrix_app'`, [f]).catch(() => {});
    await admin.query(`DROP FUNCTION IF EXISTS ${f}(text, text, jsonb, jsonb, text, text); DROP TABLE IF EXISTS crucible.${t}; DELETE FROM droits.colonnes_sensibles WHERE table_nom = '${t}'`).catch(() => {});
    await Promise.all([admin.end(), db.end(), gestion.end()]);
  }
});
