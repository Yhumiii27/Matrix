-- Contrôle des droits du serveur commun EPC2I, en conditions réelles.
--
-- Lancement, en superutilisateur, après les scripts d'initialisation :
--   psql -h <hôte> -U postgres -d postgres -v ON_ERROR_STOP=1 -f verifier-droits.sql
-- Le script crée des tables d'essai (préfixe zz_) dans les schémas des outils, joue chaque rôle (SET ROLE) et
-- compare le résultat obtenu au résultat attendu. Les cas 100 à 136 éprouvent la convention de partage
-- (infra/postgres/partage/README.md) : un outil lit les vues pub_ d'un autre, et droits.verifier() signale tout
-- autre droit croisé ainsi que toute vue pub_ qui lit une colonne sensible. Les cas 140 à 152 éprouvent les tables
-- fermées en entier (colonne « * » de droits.colonnes_sensibles) et un droit posé hors du déclencheur. Les cas 200 et
-- suivants portent sur les vraies tables de Vigie, quand elles existent : chaque colonne de santé et chaque table
-- fermée de droits.colonnes_sensibles est refusée à Matrix, puis, rendue lisible dans une sous-transaction annulée,
-- signalée par droits.verifier() (deux cas par entrée ; aucun avant la première migration de Vigie).
-- Tout se passe dans une transaction annulée à la fin : rien ne reste dans la base, et les tables des outils ne sont
-- pas touchées (aucune ligne lue ni écrite). Code de sortie 3 si un cas échoue.

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
  ('vigie', 'zz_part', 'secret', 'essai', 'ajout'),
  ('vigie', 'zz_pub', 'secret', 'essai', 'ajout'),
  ('vigie', 'zz_ferme', '*', 'essai', 'ajout');

-- Joue une commande dans une sous-transaction annulée aussitôt, et dit si droits.verifier() signale alors une erreur
-- dont l'objet ressemble au motif (LIKE). Sert aux écarts à la convention de partage, qui ne doivent pas rester.
CREATE FUNCTION pg_temp.signale(p_role text, p_sql text, p_objet text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_n integer;
  v_msg text;
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
    RESET ROLE;
    SELECT count(*) INTO v_n FROM droits.verifier() WHERE gravite = 'erreur' AND objet LIKE p_objet;
    RAISE EXCEPTION USING ERRCODE = 'ZZ001', MESSAGE = v_n::text;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
      RETURN 'refusé';
    WHEN SQLSTATE 'ZZ001' THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      RETURN CASE WHEN v_msg::integer > 0 THEN 'signalé' ELSE 'non signalé' END;
  END;
END $$;

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
    (70, 'lire la colonne sensible (liste à jour)', 'matrix_app', 'SELECT cache FROM vigie.zz_essai_bis', 'refusé'),
    -- Convention de partage : un outil lit les vues pub_ d'un autre, et rien d'autre.
    (100, 'créer une table à colonne sensible', 'vigie_app', 'CREATE TABLE vigie.zz_pub (id integer PRIMARY KEY, libelle text, secret text)', 'autorisé'),
    (101, 'publier une vue pub_ sans colonne sensible', 'vigie_app', 'CREATE VIEW vigie.pub_zz_ok WITH (security_barrier) AS SELECT id, libelle FROM vigie.zz_pub', 'autorisé'),
    (102, 'accorder USAGE sur son schéma à un lecteur', 'vigie_app', 'GRANT USAGE ON SCHEMA vigie TO keystone_app', 'autorisé'),
    (103, 'accorder SELECT sur la vue pub_ au lecteur', 'vigie_app', 'GRANT SELECT ON vigie.pub_zz_ok TO keystone_app', 'autorisé'),
    (104, 'lire la vue pub_ d''un autre outil', 'keystone_app', 'SELECT * FROM vigie.pub_zz_ok', 'autorisé'),
    (105, 'lire la table source de la vue', 'keystone_app', 'SELECT id FROM vigie.zz_pub', 'refusé'),
    (106, 'écrire dans la vue pub_', 'keystone_app', 'INSERT INTO vigie.pub_zz_ok (id) VALUES (1)', 'refusé'),
    (107, 'créer une table chez l''outil lu', 'keystone_app', 'CREATE TABLE vigie.zz_k2 (id integer)', 'refusé'),
    (108, 'Matrix lit la vue pub_', 'matrix_app', 'SELECT * FROM vigie.pub_zz_ok', 'autorisé'),
    (109, 'créer une vue de contrôle *_v1 dans cursus', 'cursus_app', 'CREATE VIEW cursus.zz_controle_v1 WITH (security_barrier) AS SELECT id, libelle FROM cursus.zz_ouverte', 'autorisé'),
    (110, 'Matrix lit la vue de contrôle *_v1', 'matrix_app', 'SELECT * FROM cursus.zz_controle_v1', 'autorisé'),
    -- Table fermée en entier (colonne « * » : données de santé, journal de consultation) : rien n'est lisible.
    (140, 'créer une table fermée en entier', 'vigie_app', 'CREATE TABLE vigie.zz_ferme (id integer PRIMARY KEY, note text)', 'autorisé'),
    (141, 'lire une colonne de la table fermée', 'matrix_app', 'SELECT id FROM vigie.zz_ferme', 'refusé'),
    (142, 'compter les lignes de la table fermée', 'matrix_app', 'SELECT count(*) FROM vigie.zz_ferme', 'refusé'),
    (143, 'l''outil accorde la table fermée à matrix_lecture', 'vigie_app', 'GRANT SELECT ON vigie.zz_ferme TO matrix_lecture', 'autorisé'),
    (144, 'lire la table fermée après ce GRANT', 'matrix_app', 'SELECT id FROM vigie.zz_ferme', 'refusé'),
    (145, 'ajouter une colonne à la table fermée', 'vigie_app', 'ALTER TABLE vigie.zz_ferme ADD COLUMN ajoutee text', 'autorisé'),
    (146, 'lire la colonne ajoutée', 'matrix_app', 'SELECT ajoutee FROM vigie.zz_ferme', 'refusé'),
    (147, 'créer une vue sur la table fermée', 'vigie_app', 'CREATE VIEW vigie.zz_vue_ferme AS SELECT id FROM vigie.zz_ferme', 'autorisé'),
    (148, 'lire la vue sur la table fermée', 'matrix_app', 'SELECT id FROM vigie.zz_vue_ferme', 'refusé'),
    (149, 'administration : lire la table fermée', 'matrix_admin', 'SELECT note FROM vigie.zz_ferme', 'autorisé')
  ) AS t(n, cas, role, q, attendu) ORDER BY n LOOP
    INSERT INTO resultats VALUES (c.n, c.cas, c.role, c.attendu, pg_temp.essai(c.role, c.q));
  END LOOP;
END $$;

-- Lecteur attendu de la vue d'essai, comme l'inscrit partage/90-droits.sql (annulé avec le reste).
INSERT INTO droits.partage_lecteurs (vue, lecteur) VALUES ('vigie.pub_zz_ok', 'keystone_app') ON CONFLICT DO NOTHING;

-- Écarts à la convention de partage : chacun, joué seul puis annulé, doit être signalé par droits.verifier().
INSERT INTO resultats
SELECT n, cas, role, attendu, pg_temp.signale(role, q, motif)
FROM (VALUES
  (120, 'vue pub_ qui lit une colonne sensible', 'vigie_app', 'CREATE VIEW vigie.pub_zz_sensible AS SELECT id, secret FROM vigie.zz_pub', 'vigie.pub_zz_sensible', 'signalé'),
  (121, 'vue pub_ sur la ligne entière d''une table protégée', 'vigie_app', 'CREATE VIEW vigie.pub_zz_ligne AS SELECT t AS ligne FROM vigie.zz_pub t', 'vigie.pub_zz_ligne', 'signalé'),
  (122, 'vue pub_ en security_invoker', 'vigie_app', 'CREATE VIEW vigie.pub_zz_invoker WITH (security_invoker) AS SELECT id FROM vigie.zz_pub', 'vigie.pub_zz_invoker', 'signalé'),
  (123, 'vue pub_ qui lit un autre schéma', 'keystone_app', 'CREATE VIEW keystone.pub_zz_croise AS SELECT id FROM vigie.pub_zz_ok', 'keystone.pub_zz_croise', 'signalé'),
  (124, 'SELECT sur une table accordé à un autre outil', 'vigie_app', 'GRANT SELECT ON vigie.zz_pub TO keystone_app', 'keystone_app, vigie.zz_pub', 'signalé'),
  (125, 'SELECT sur une colonne accordé à un autre outil', 'vigie_app', 'GRANT SELECT (id) ON vigie.zz_pub TO keystone_app', 'keystone_app, vigie.zz_pub', 'signalé'),
  (126, 'SELECT sur une vue non publiée', 'vigie_app', 'CREATE VIEW vigie.zz_vue_np AS SELECT id FROM vigie.zz_pub; GRANT SELECT ON vigie.zz_vue_np TO keystone_app', 'keystone_app, vigie.zz_vue_np', 'signalé'),
  (127, 'écriture sur une vue pub_', 'vigie_app', 'GRANT INSERT ON vigie.pub_zz_ok TO keystone_app', 'keystone_app, vigie.pub_zz_ok', 'signalé'),
  (128, 'CREATE sur le schéma d''un autre outil', 'vigie_app', 'GRANT CREATE ON SCHEMA vigie TO keystone_app', 'keystone_app, schéma vigie', 'signalé'),
  (129, 'USAGE sans aucune vue pub_ accordée', 'vigie_app', 'GRANT USAGE ON SCHEMA vigie TO cursus_app', 'cursus_app, schéma vigie', 'signalé'),
  (130, 'séquence accordée à un autre outil', 'vigie_app', 'CREATE SEQUENCE vigie.zz_seq; GRANT USAGE ON SEQUENCE vigie.zz_seq TO keystone_app', 'keystone_app, vigie.zz_seq', 'signalé'),
  (131, 'table de matrix accordée à PUBLIC', 'matrix_app', 'CREATE TABLE matrix.zz_ouverte (id integer); GRANT SELECT ON matrix.zz_ouverte TO PUBLIC', '%, matrix.zz_ouverte', 'signalé'),
  (132, 'vue *_v1 de cursus accordée à un outil', 'cursus_app', 'GRANT USAGE ON SCHEMA cursus TO vigie_app; GRANT SELECT ON cursus.zz_controle_v1 TO vigie_app', 'vigie_app, %', 'signalé'),
  (133, 'vue *_v1 de cursus accordée à matrix_app', 'cursus_app', 'GRANT SELECT ON cursus.zz_controle_v1 TO matrix_app', '%', 'non signalé'),
  (134, 'vue pub_ accordée à un deuxième lecteur', 'vigie_app', 'GRANT USAGE ON SCHEMA vigie TO codex_app; GRANT SELECT ON vigie.pub_zz_ok TO codex_app', '%', 'non signalé'),
  (135, 'lecteur attendu qui perd son SELECT (restauration)', 'vigie_app', 'REVOKE SELECT ON vigie.pub_zz_ok FROM keystone_app', 'keystone_app, vigie.pub_zz_ok', 'signalé'),
  (136, 'lecteur attendu qui perd son USAGE (restauration)', 'vigie_app', 'REVOKE USAGE ON SCHEMA vigie FROM keystone_app', 'keystone_app, vigie.pub_zz_ok', 'signalé'),
  (150, 'vue pub_ qui lit une table fermée en entier', 'vigie_app', 'CREATE VIEW vigie.pub_zz_ferme AS SELECT id FROM vigie.zz_ferme', 'vigie.pub_zz_ferme', 'signalé'),
  -- Droit posé hors du déclencheur droits_ddl (drapeau de droits.appliquer_droits() levé à la main) : seul
  -- droits.verifier() le voit.
  (151, 'colonne sensible redevenue lisible (hors déclencheur)', 'postgres', 'SET LOCAL droits.application_en_cours = ''on''; GRANT SELECT (secret) ON vigie.zz_pub TO matrix_lecture', 'vigie.zz_pub.secret', 'signalé'),
  (152, 'table fermée redevenue lisible (hors déclencheur)', 'postgres', 'SET LOCAL droits.application_en_cours = ''on''; GRANT SELECT ON vigie.zz_ferme TO matrix_lecture', 'vigie.zz_ferme', 'signalé')
) AS t(n, cas, role, q, motif, attendu);

-- Vraies tables de Vigie (cas 200 et suivants) : chaque entrée vigie de droits.colonnes_sensibles dont la table et la
-- colonne existent (colonnes de santé de events, copies dans change_log, tables fermées en entier). Matrix ne la lit
-- pas (LIMIT 0 : aucune ligne n'est lue, le droit est contrôlé quand même), et droits.verifier() la signale si elle
-- redevient lisible. Aucun cas avant la première migration de Vigie.
INSERT INTO resultats
SELECT 198 + 2 * row_number() OVER (ORDER BY s.table_nom, s.colonne_nom),
       format('Matrix lit vigie.%s%s (%s)', s.table_nom, CASE WHEN s.colonne_nom = '*' THEN '' ELSE '.' || s.colonne_nom END, s.motif),
       'matrix_app', 'refusé',
       pg_temp.essai('matrix_app', CASE WHEN s.colonne_nom = '*'
                                        THEN format('SELECT 1 FROM vigie.%I LIMIT 0', s.table_nom)
                                        ELSE format('SELECT %I FROM vigie.%I LIMIT 0', s.colonne_nom, s.table_nom) END)
FROM droits.colonnes_sensibles s
WHERE s.schema_nom = 'vigie' AND s.table_nom NOT LIKE 'zz\_%'
  AND to_regclass(format('vigie.%I', s.table_nom)) IS NOT NULL
  AND (s.colonne_nom = '*' OR EXISTS (SELECT FROM pg_attribute a
                                      WHERE a.attrelid = to_regclass(format('vigie.%I', s.table_nom))
                                        AND a.attname = s.colonne_nom AND a.attnum > 0 AND NOT a.attisdropped));
INSERT INTO resultats
SELECT 199 + 2 * row_number() OVER (ORDER BY s.table_nom, s.colonne_nom),
       format('vigie.%s%s redevenue lisible : signalée par droits.verifier()', s.table_nom, CASE WHEN s.colonne_nom = '*' THEN '' ELSE '.' || s.colonne_nom END),
       'postgres', 'signalé',
       pg_temp.signale('postgres',
                       CASE WHEN s.colonne_nom = '*'
                            THEN format('SET LOCAL droits.application_en_cours = ''on''; GRANT SELECT ON vigie.%I TO matrix_lecture', s.table_nom)
                            ELSE format('SET LOCAL droits.application_en_cours = ''on''; GRANT SELECT (%I) ON vigie.%I TO matrix_lecture', s.colonne_nom, s.table_nom) END,
                       CASE WHEN s.colonne_nom = '*' THEN format('vigie.%s', s.table_nom) ELSE format('vigie.%s.%s', s.table_nom, s.colonne_nom) END)
FROM droits.colonnes_sensibles s
WHERE s.schema_nom = 'vigie' AND s.table_nom NOT LIKE 'zz\_%'
  AND to_regclass(format('vigie.%I', s.table_nom)) IS NOT NULL
  AND (s.colonne_nom = '*' OR EXISTS (SELECT FROM pg_attribute a
                                      WHERE a.attrelid = to_regclass(format('vigie.%I', s.table_nom))
                                        AND a.attname = s.colonne_nom AND a.attnum > 0 AND NOT a.attisdropped));

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

-- droits.verifier() ne doit signaler aucune erreur, partage d'essai (cas 100 à 110) compris.
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
SELECT count(*) FILTER (WHERE n >= 200) AS cas_vigie FROM resultats \gset
\echo 'Tous les cas sont conformes :' :cas 'cas (dont' :cas_vigie 'sur les tables de Vigie).'

ROLLBACK;
