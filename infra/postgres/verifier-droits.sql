-- Contrôle des droits du serveur commun EPC2I, en conditions réelles.
--
-- Lancement, en superutilisateur, après les scripts d'initialisation :
--   psql -h <hôte> -U postgres -d postgres -v ON_ERROR_STOP=1 -f verifier-droits.sql
-- Le script crée des tables d'essai (préfixe zz_) dans les schémas des outils, joue chaque rôle (SET ROLE) et
-- compare le résultat obtenu au résultat attendu. Tout se passe dans une transaction annulée à la fin : rien ne
-- reste dans la base, et les tables des outils ne sont pas touchées. Code de sortie 3 si un cas échoue.

\set ON_ERROR_STOP on
\connect epc2i

BEGIN;

CREATE FUNCTION pg_temp.essai(p_role text, p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RETURN 'refusé';
  END;
  RESET ROLE;
  RETURN 'autorisé';
END $$;

CREATE TEMP TABLE resultats (n integer, cas text, role text, attendu text, obtenu text);

-- Colonnes sensibles des tables d'essai (annulées avec le reste).
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif, origine) VALUES
  ('vigie', 'zz_essai', 'secret', 'essai', 'ajout'),
  ('vigie', 'zz_part', 'secret', 'essai', 'ajout');

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    -- Chaque outil chez soi.
    (1,  'créer une table dans son schéma', 'keystone_app', 'CREATE TABLE keystone.zz_k (id integer)', 'autorisé'),
    (2,  'créer une table dans le schéma d''un autre outil', 'keystone_app', 'CREATE TABLE codex.zz_x (id integer)', 'refusé'),
    (3,  'créer un schéma', 'keystone_app', 'CREATE SCHEMA zz_schema', 'refusé'),
    (4,  'créer une table dans public', 'keystone_app', 'CREATE TABLE public.zz_x (id integer)', 'refusé'),
    (5,  'créer une table temporaire', 'keystone_app', 'CREATE TEMP TABLE zz_t (id integer)', 'refusé'),
    (6,  'lire la liste des colonnes sensibles', 'keystone_app', 'SELECT 1 FROM droits.colonnes_sensibles', 'refusé'),
    (7,  'créer une table dans son schéma', 'cursus_app', 'CREATE TABLE cursus.zz_ouverte (id integer, libelle text)', 'autorisé'),
    (8,  'lire une table d''un autre outil', 'keystone_app', 'SELECT 1 FROM cursus.zz_ouverte', 'refusé'),
    (9,  'appeler une fonction du schéma droits', 'keystone_app', 'SELECT droits.verifier()', 'refusé'),
    -- Matrix lit tout, n'écrit que chez lui.
    (10, 'lire une table créée après l''initialisation', 'matrix_app', 'SELECT id FROM keystone.zz_k', 'autorisé'),
    (11, 'lire une table de Cursus sans colonne sensible', 'matrix_app', 'SELECT * FROM cursus.zz_ouverte', 'autorisé'),
    (12, 'écrire dans une table d''outil', 'matrix_app', 'INSERT INTO keystone.zz_k VALUES (1)', 'refusé'),
    (13, 'vider une table d''outil', 'matrix_app', 'TRUNCATE cursus.zz_ouverte', 'refusé'),
    (14, 'créer une table dans matrix', 'matrix_app', 'CREATE TABLE matrix.zz_m (id integer)', 'autorisé'),
    (15, 'créer une table dans un schéma d''outil', 'matrix_app', 'CREATE TABLE cursus.zz_m (id integer)', 'refusé'),
    (16, 'lire la liste des colonnes sensibles', 'matrix_app', 'SELECT 1 FROM droits.colonnes_sensibles', 'autorisé'),
    (17, 'lancer la vérification', 'matrix_app', 'SELECT droits.verifier()', 'autorisé'),
    (18, 'réappliquer les droits', 'matrix_app', 'SELECT droits.appliquer_droits()', 'refusé'),
    -- Colonnes sensibles : une table créée par l'outil est réduite aux colonnes autorisées dès sa création.
    (20, 'créer une table à colonne sensible', 'vigie_app', 'CREATE TABLE vigie.zz_essai (id integer PRIMARY KEY, libelle text, secret text)', 'autorisé'),
    (21, 'lire les colonnes autorisées', 'matrix_app', 'SELECT id, libelle FROM vigie.zz_essai', 'autorisé'),
    (22, 'compter les lignes', 'matrix_app', 'SELECT count(*) FROM vigie.zz_essai', 'autorisé'),
    (23, 'lire la colonne sensible', 'matrix_app', 'SELECT secret FROM vigie.zz_essai', 'refusé'),
    (24, 'lire toutes les colonnes (SELECT *)', 'matrix_app', 'SELECT * FROM vigie.zz_essai', 'refusé'),
    (25, 'ajouter une colonne', 'vigie_app', 'ALTER TABLE vigie.zz_essai ADD COLUMN cree_le date', 'autorisé'),
    (26, 'lire la nouvelle colonne', 'matrix_app', 'SELECT cree_le FROM vigie.zz_essai', 'autorisé'),
    (27, 'l''outil accorde la table entière à matrix_lecture', 'vigie_app', 'GRANT SELECT ON vigie.zz_essai TO matrix_lecture', 'autorisé'),
    (28, 'lire la colonne sensible après ce GRANT', 'matrix_app', 'SELECT secret FROM vigie.zz_essai', 'refusé'),
    (29, 'l''outil accorde la table à PUBLIC', 'vigie_app', 'GRANT SELECT ON vigie.zz_essai TO PUBLIC', 'autorisé'),
    (30, 'lire la colonne sensible après ce GRANT', 'matrix_app', 'SELECT secret FROM vigie.zz_essai', 'refusé'),
    -- Vues : une vue lit avec les droits de son propriétaire.
    (31, 'créer une vue sans colonne sensible', 'vigie_app', 'CREATE VIEW vigie.zz_vue_ok AS SELECT id, libelle FROM vigie.zz_essai', 'autorisé'),
    (32, 'créer une vue avec la colonne sensible', 'vigie_app', 'CREATE VIEW vigie.zz_vue_sensible AS SELECT id, secret FROM vigie.zz_essai', 'autorisé'),
    (33, 'créer une vue sur la ligne entière', 'vigie_app', 'CREATE VIEW vigie.zz_vue_ligne AS SELECT t AS ligne FROM vigie.zz_essai t', 'autorisé'),
    (34, 'créer une vue sur une vue sensible', 'vigie_app', 'CREATE VIEW vigie.zz_vue_de_vue AS SELECT id FROM vigie.zz_vue_sensible', 'autorisé'),
    (35, 'lire la vue sans colonne sensible', 'matrix_app', 'SELECT * FROM vigie.zz_vue_ok', 'autorisé'),
    (36, 'lire la vue avec la colonne sensible', 'matrix_app', 'SELECT id FROM vigie.zz_vue_sensible', 'refusé'),
    (37, 'lire la vue sur la ligne entière', 'matrix_app', 'SELECT 1 FROM vigie.zz_vue_ligne', 'refusé'),
    (38, 'lire la vue sur une vue sensible', 'matrix_app', 'SELECT id FROM vigie.zz_vue_de_vue', 'refusé'),
    -- Partitions : elles suivent la liste de leur table mère.
    (40, 'créer une table partitionnée', 'vigie_app', 'CREATE TABLE vigie.zz_part (id integer, secret text) PARTITION BY RANGE (id)', 'autorisé'),
    (41, 'créer une partition', 'vigie_app', 'CREATE TABLE vigie.zz_part_1 PARTITION OF vigie.zz_part FOR VALUES FROM (0) TO (100)', 'autorisé'),
    (42, 'lire la colonne sensible d''une partition', 'matrix_app', 'SELECT secret FROM vigie.zz_part_1', 'refusé'),
    (43, 'lire la colonne autorisée d''une partition', 'matrix_app', 'SELECT id FROM vigie.zz_part_1', 'autorisé'),
    -- Sauvegarde et administration.
    (50, 'sauvegarde : lire la colonne sensible', 'epc2i_sauvegarde', 'SELECT secret FROM vigie.zz_essai', 'autorisé'),
    (51, 'sauvegarde : écrire', 'epc2i_sauvegarde', 'INSERT INTO vigie.zz_essai (id) VALUES (2)', 'refusé'),
    (52, 'administration : lire la colonne sensible', 'matrix_admin', 'SELECT secret FROM vigie.zz_essai', 'autorisé'),
    (53, 'administration : écrire', 'matrix_admin', 'INSERT INTO vigie.zz_essai (id, secret) VALUES (3, ''x'')', 'autorisé'),
    (54, 'administration : réappliquer les droits', 'matrix_admin', 'SELECT droits.appliquer_droits()', 'autorisé'),
    (55, 'administration : retirer une colonne de la convention', 'matrix_admin', 'DELETE FROM droits.colonnes_sensibles WHERE schema_nom = ''vigie'' AND table_nom = ''events'' AND colonne_nom = ''injury''', 'refusé'),
    (56, 'administration : retirer une colonne ajoutée', 'matrix_admin', 'DELETE FROM droits.colonnes_sensibles WHERE table_nom = ''zz_part''', 'autorisé'),
    (57, 'lire la colonne retirée de la liste', 'matrix_app', 'SELECT secret FROM vigie.zz_part_1', 'autorisé'),
    -- Renommages : la table se ferme jusqu'à la mise à jour de la liste.
    (60, 'renommer la colonne sensible', 'vigie_app', 'ALTER TABLE vigie.zz_essai RENAME COLUMN secret TO cache', 'autorisé'),
    (61, 'lire la colonne renommée', 'matrix_app', 'SELECT cache FROM vigie.zz_essai', 'refusé'),
    (62, 'lire une colonne autorisée (table fermée)', 'matrix_app', 'SELECT id FROM vigie.zz_essai', 'refusé'),
    (63, 'mettre la liste à jour', 'postgres', 'UPDATE droits.colonnes_sensibles SET colonne_nom = ''cache'' WHERE table_nom = ''zz_essai''', 'autorisé'),
    (64, 'lire une colonne autorisée (liste à jour)', 'matrix_app', 'SELECT id FROM vigie.zz_essai', 'autorisé'),
    (65, 'lire la colonne renommée (liste à jour)', 'matrix_app', 'SELECT cache FROM vigie.zz_essai', 'refusé'),
    (66, 'renommer la table', 'vigie_app', 'ALTER TABLE vigie.zz_essai RENAME TO zz_essai_bis', 'autorisé'),
    (67, 'lire la table renommée', 'matrix_app', 'SELECT id FROM vigie.zz_essai_bis', 'refusé'),
    (68, 'mettre la liste à jour', 'postgres', 'UPDATE droits.colonnes_sensibles SET table_nom = ''zz_essai_bis'' WHERE table_nom = ''zz_essai''', 'autorisé'),
    (69, 'lire la table renommée (liste à jour)', 'matrix_app', 'SELECT id FROM vigie.zz_essai_bis', 'autorisé'),
    (70, 'lire la colonne sensible (liste à jour)', 'matrix_app', 'SELECT cache FROM vigie.zz_essai_bis', 'refusé')
  ) AS t(n, cas, role, q, attendu) ORDER BY n LOOP
    INSERT INTO resultats VALUES (c.n, c.cas, c.role, c.attendu, pg_temp.essai(c.role, c.q));
  END LOOP;
END $$;

-- Appartenances.
INSERT INTO resultats
SELECT n, cas, role, attendu, CASE WHEN ok THEN 'oui' ELSE 'non' END
FROM (VALUES
  (80, 'matrix_admin peut prendre le rôle vigie_app (SET ROLE)', 'matrix_admin', 'oui', pg_has_role('matrix_admin', 'vigie_app', 'SET')),
  (81, 'matrix_admin n''hérite pas des droits de vigie_app', 'matrix_admin', 'non', pg_has_role('matrix_admin', 'vigie_app', 'USAGE')),
  (82, 'keystone_app est étranger à codex_app', 'keystone_app', 'non', pg_has_role('keystone_app', 'codex_app', 'MEMBER')),
  (83, 'matrix_app hérite de matrix_lecture', 'matrix_app', 'oui', pg_has_role('matrix_app', 'matrix_lecture', 'USAGE')),
  (84, 'epc2i_sauvegarde hérite de pg_read_all_data', 'epc2i_sauvegarde', 'oui', pg_has_role('epc2i_sauvegarde', 'pg_read_all_data', 'USAGE')),
  (85, 'keystone_app sans droit CREATE sur la base', 'keystone_app', 'non', has_database_privilege('keystone_app', 'epc2i', 'CREATE'))
) AS t(n, cas, role, attendu, ok);

-- Administrateur nominatif.
CALL droits.declarer_admin('zz_admin_essai');
INSERT INTO resultats
SELECT 90, 'administrateur nominatif membre de matrix_admin et journalisé', 'zz_admin_essai', 'oui',
       CASE WHEN pg_has_role('zz_admin_essai', 'matrix_admin', 'USAGE')
             AND EXISTS (SELECT FROM pg_db_role_setting d JOIN pg_roles r ON r.oid = d.setrole
                         WHERE r.rolname = 'zz_admin_essai' AND 'log_statement=all' = ANY (d.setconfig))
            THEN 'oui' ELSE 'non' END;

-- droits.verifier() ne doit signaler aucune erreur.
INSERT INTO resultats
SELECT 99, 'droits.verifier() sans erreur', 'postgres', '0', count(*)::text FROM droits.verifier() WHERE gravite = 'erreur';

\echo
\echo 'Résultats (✓ conforme, ✗ écart) :'
SELECT CASE WHEN attendu = obtenu THEN '✓' ELSE '✗' END AS etat, n, role, cas, attendu, obtenu
FROM resultats ORDER BY n;

SELECT count(*) FILTER (WHERE attendu <> obtenu) > 0 AS echec, count(*) AS cas FROM resultats \gset
\if :echec
  \echo 'Erreurs de droits : voir les lignes ✗ ci-dessus.'
  SELECT gravite, objet, constat FROM droits.verifier() WHERE gravite = 'erreur';
  DO $$ BEGIN RAISE EXCEPTION 'Vérification des droits : écarts constatés.'; END $$;
\endif
\echo 'Tous les cas sont conformes :' :cas 'cas.'

ROLLBACK;
