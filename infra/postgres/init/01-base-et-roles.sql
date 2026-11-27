-- Serveur PostgreSQL commun de la suite Atrium, étape 1 sur 3 : base atrium et rôles.
--
-- Renommage de la suite en Atrium (décision du propriétaire du 27/11/2026, docs/renommage-atrium.md) : la base s'appelle
-- atrium et le rôle des sauvegardes atrium_sauvegarde. Le temps du renommage du serveur en service, ce fichier s'adapte à
-- ce qu'il trouve : base atrium si elle existe, sinon la base epc2i d'avant le renommage, sinon il crée atrium ; de même
-- pour le rôle des sauvegardes (atrium_sauvegarde, sinon epc2i_sauvegarde, sinon il crée atrium_sauvegarde). Il ne
-- renomme jamais rien lui-même : le renommage est une étape de docs/renommage-atrium.md. -v base=<nom> impose la base.
--
-- Lancement :
--   - automatique au premier démarrage du conteneur (image officielle, dossier /docker-entrypoint-initdb.d) ;
--   - à la main, en superutilisateur, avec psql 15 ou plus (commande \getenv) :
--       psql -h <hôte> -U postgres -d postgres -v ON_ERROR_STOP=1 -f init/01-base-et-roles.sql
--     N'ajoutez pas -e ni -a : psql afficherait les mots de passe.
--
-- Rejouable : le script crée ce qui manque, puis remet les attributs, les appartenances et les mots de passe
-- aux valeurs ci-dessous. Les mots de passe sont lus dans l'environnement, et aucun ne peut être vide :
--   KEYSTONE_APP_PASSWORD  CODEX_APP_PASSWORD  CURSUS_APP_PASSWORD  VIGIE_APP_PASSWORD  ARCHE_APP_PASSWORD
--   CRUCIBLE_APP_PASSWORD  MATRIX_APP_PASSWORD  MATRIX_GESTION_PASSWORD  ATRIUM_SAUVEGARDE_PASSWORD
--   (ATRIUM_SAUVEGARDE_PASSWORD : à défaut, l'ancienne variable EPC2I_SAUVEGARDE_PASSWORD, le temps du renommage)
--
-- Rôles créés :
--   keystone_app, codex_app, cursus_app, vigie_app, arche_app, crucible_app
--                                                   connexion d'un outil, propriétaire de son seul schéma
--   matrix_app                                      connexion de Matrix, propriétaire du schéma matrix,
--                                                   membre de matrix_lecture
--   matrix_gestion                                  connexion de Matrix pour l'administration (M-18) : crée et gère les
--                                                   vues pub_ des outils, pose et retire les liens ; ni superutilisateur,
--                                                   ni écriture dans les tables (droits : init/03-droits.sql)
--   clavis_app                                      connexion de Clavis (annuaire et accès aux outils), propriétaire du
--                                                   schéma clavis ; sans CLAVIS_APP_PASSWORD, le rôle existe sans pouvoir
--                                                   se connecter (serveur où Clavis n'est pas déployé)
--   modulus_app                                     connexion de Modulus (commercial et chiffrage), propriétaire du
--                                                   schéma modulus ; sans MODULUS_APP_PASSWORD, le rôle existe sans
--                                                   pouvoir se connecter (serveur où Modulus n'est pas déployé)
--   vector_app                                      connexion de Vector (expéditions), propriétaire du schéma vector ;
--                                                   sans VECTOR_APP_PASSWORD, le rôle existe sans pouvoir se connecter
--                                                   (serveur où Vector n'est pas déployé)
--   ingenium_app                                    connexion d'Ingenium (ingénierie), propriétaire du schéma ingenium ;
--                                                   sans INGENIUM_APP_PASSWORD, le rôle existe sans pouvoir se
--                                                   connecter (serveur où Ingenium n'est pas déployé)
--   bi_reader                                       connexion de Power BI (demande M-14 d'Arche) : lecture seule, rien
--                                                   d'autre que les vues pub_ que le registre des liens lui accorde ;
--                                                   sans BI_READER_PASSWORD, le rôle existe sans pouvoir se connecter
--   cursus_purge                                    connexion de la purge du journal des actions de Cursus (décision M-24) :
--                                                   seul rôle qui supprime des lignes de cursus.journal, les seules lignes
--                                                   échues, par cursus.purger_journal() (droits : init/03-droits.sql) ;
--                                                   sans CURSUS_PURGE_PASSWORD, le rôle existe sans pouvoir se connecter
--   matrix_lecture  (groupe)                        SELECT sur les schémas des outils, colonnes sensibles exclues
--   matrix_admin    (groupe)                        tous les droits ; attribué nominativement (droits.declarer_admin)
--   atrium_sauvegarde                               connexion des sauvegardes, membre de pg_read_all_data (epc2i_sauvegarde
--                                                   avant le renommage : le rôle en place garde son nom jusqu'à l'étape)

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Lancez ce script avec un superutilisateur (par exemple postgres), pas avec %.', current_user;
  END IF;
END $$;

-- ── 1. Mots de passe lus dans l'environnement ───────────────────────────
\getenv mdp_keystone_app KEYSTONE_APP_PASSWORD
\getenv mdp_codex_app CODEX_APP_PASSWORD
\getenv mdp_cursus_app CURSUS_APP_PASSWORD
\getenv mdp_vigie_app VIGIE_APP_PASSWORD
\getenv mdp_arche_app ARCHE_APP_PASSWORD
\getenv mdp_crucible_app CRUCIBLE_APP_PASSWORD
\getenv mdp_matrix_app MATRIX_APP_PASSWORD
\getenv mdp_matrix_gestion MATRIX_GESTION_PASSWORD
\getenv mdp_atrium_sauvegarde ATRIUM_SAUVEGARDE_PASSWORD
\getenv mdp_ancien_sauvegarde EPC2I_SAUVEGARDE_PASSWORD
\getenv mdp_bi_reader BI_READER_PASSWORD
\getenv mdp_clavis_app CLAVIS_APP_PASSWORD
\getenv mdp_modulus_app MODULUS_APP_PASSWORD
\getenv mdp_vector_app VECTOR_APP_PASSWORD
\getenv mdp_ingenium_app INGENIUM_APP_PASSWORD
\getenv mdp_cursus_purge CURSUS_PURGE_PASSWORD
\if :{?mdp_keystone_app}
\else
  \set mdp_keystone_app ''
\endif
\if :{?mdp_codex_app}
\else
  \set mdp_codex_app ''
\endif
\if :{?mdp_cursus_app}
\else
  \set mdp_cursus_app ''
\endif
\if :{?mdp_vigie_app}
\else
  \set mdp_vigie_app ''
\endif
\if :{?mdp_arche_app}
\else
  \set mdp_arche_app ''
\endif
\if :{?mdp_crucible_app}
\else
  \set mdp_crucible_app ''
\endif
\if :{?mdp_matrix_app}
\else
  \set mdp_matrix_app ''
\endif
\if :{?mdp_matrix_gestion}
\else
  \set mdp_matrix_gestion ''
\endif
\if :{?mdp_atrium_sauvegarde}
\else
  \set mdp_atrium_sauvegarde ''
\endif
\if :{?mdp_ancien_sauvegarde}
\else
  \set mdp_ancien_sauvegarde ''
\endif
-- Renommage en Atrium : ATRIUM_SAUVEGARDE_PASSWORD, sinon l'ancienne EPC2I_SAUVEGARDE_PASSWORD (même mot de passe).
SELECT CASE WHEN :'mdp_atrium_sauvegarde' <> '' THEN :'mdp_atrium_sauvegarde' ELSE :'mdp_ancien_sauvegarde' END AS mdp_sauvegarde \gset
\unset mdp_atrium_sauvegarde
\unset mdp_ancien_sauvegarde
-- Rôle des sauvegardes : atrium_sauvegarde, ou epc2i_sauvegarde tant que le serveur en service n'est pas renommé.
SELECT coalesce((SELECT rolname FROM pg_roles WHERE rolname IN ('atrium_sauvegarde', 'epc2i_sauvegarde')
                 ORDER BY rolname <> 'atrium_sauvegarde' LIMIT 1), 'atrium_sauvegarde') AS role_sauvegarde \gset
-- Base commune : atrium, ou epc2i tant que le serveur en service n'est pas renommé (sauf -v base=…).
\if :{?base}
\else
  SELECT coalesce((SELECT datname FROM pg_database WHERE datname IN ('atrium', 'epc2i')
                   ORDER BY datname <> 'atrium' LIMIT 1), 'atrium') AS base \gset
\endif
SELECT :'base' <> 'atrium' OR :'role_sauvegarde' <> 'atrium_sauvegarde' AS avant_renommage \gset
\if :avant_renommage
  \echo 'Renommage en Atrium pas encore fait sur ce serveur : base' :base ', rôle des sauvegardes' :role_sauvegarde '(docs/renommage-atrium.md).'
\endif

SELECT string_agg(variable, ', ' ORDER BY variable) AS mdp_manquants
FROM (VALUES ('KEYSTONE_APP_PASSWORD', :'mdp_keystone_app'), ('CODEX_APP_PASSWORD', :'mdp_codex_app'),
             ('CURSUS_APP_PASSWORD', :'mdp_cursus_app'), ('VIGIE_APP_PASSWORD', :'mdp_vigie_app'),
             ('ARCHE_APP_PASSWORD', :'mdp_arche_app'), ('CRUCIBLE_APP_PASSWORD', :'mdp_crucible_app'),
             ('MATRIX_APP_PASSWORD', :'mdp_matrix_app'), ('MATRIX_GESTION_PASSWORD', :'mdp_matrix_gestion'),
             ('ATRIUM_SAUVEGARDE_PASSWORD', :'mdp_sauvegarde')) AS v(variable, mdp)
WHERE mdp = '' \gset
\if :{?mdp_manquants}
  \echo 'Variables d''environnement absentes ou vides :' :mdp_manquants
  DO $$ BEGIN RAISE EXCEPTION 'Mots de passe manquants : rien n''a été modifié.'; END $$;
\endif

SELECT string_agg(variable, ', ' ORDER BY variable) AS mdp_courts
FROM (VALUES ('KEYSTONE_APP_PASSWORD', :'mdp_keystone_app'), ('CODEX_APP_PASSWORD', :'mdp_codex_app'),
             ('CURSUS_APP_PASSWORD', :'mdp_cursus_app'), ('VIGIE_APP_PASSWORD', :'mdp_vigie_app'),
             ('ARCHE_APP_PASSWORD', :'mdp_arche_app'), ('CRUCIBLE_APP_PASSWORD', :'mdp_crucible_app'),
             ('MATRIX_APP_PASSWORD', :'mdp_matrix_app'), ('MATRIX_GESTION_PASSWORD', :'mdp_matrix_gestion'),
             ('ATRIUM_SAUVEGARDE_PASSWORD', :'mdp_sauvegarde')) AS v(variable, mdp)
WHERE length(mdp) < 16 \gset
\if :{?mdp_courts}
  \echo 'Attention : mots de passe de moins de 16 caractères :' :mdp_courts
\endif

-- ── 2. Base atrium ───────────────────────────────────────────────────────
-- Tri binaire (C) et classes de caractères Unicode (C.UTF-8) : les mêmes réglages que PGlite, pour que les
-- outils trient comme aujourd'hui. Sans locale C.UTF-8 sur le système, repli sur C (avec un avertissement).
SELECT coalesce((SELECT collctype FROM pg_collation
                 WHERE collprovider = 'c' AND lower(collname) IN ('c.utf8', 'c.utf-8') ORDER BY collname LIMIT 1),
                'C') AS ctype_base \gset
\if :{?ctype_base}
\else
  \set ctype_base C
\endif
SELECT :'ctype_base' = 'C' AS ctype_repli \gset
\if :ctype_repli
  \echo 'Attention : locale C.UTF-8 absente, la base' :base 'est créée avec LC_CTYPE = C.'
\endif

SELECT format('CREATE DATABASE %I WITH TEMPLATE template0 ENCODING %L LC_COLLATE %L LC_CTYPE %L',
              :'base', 'UTF8', 'C', :'ctype_base')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'base') \gexec

-- Fuseau UTC et format ISO, comme PGlite : les dates et horodatages lus par les outils ne changent pas.
ALTER DATABASE :"base" SET timezone TO 'UTC';
ALTER DATABASE :"base" SET datestyle TO 'ISO, MDY';
COMMENT ON DATABASE :"base" IS 'Serveur commun de la suite Atrium : un schéma par outil (keystone, codex, cursus, vigie, arche, crucible, clavis, modulus, vector, ingenium, matrix). Voir infra/postgres/README.md dans Matrix.';

-- ── 3. Rôles ─────────────────────────────────────────────────────────────
BEGIN;

SELECT format('CREATE ROLE %I', nom)
FROM unnest(ARRAY['keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app',
                  'crucible_app', 'matrix_app', 'matrix_gestion', 'matrix_lecture', 'matrix_admin', :'role_sauvegarde', 'bi_reader',
                  'clavis_app', 'modulus_app', 'vector_app', 'ingenium_app', 'cursus_purge']) AS nom
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = nom) \gexec

-- Rôles de groupe : pas de connexion directe.
ALTER ROLE matrix_lecture WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
ALTER ROLE matrix_admin   WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;

-- Rôles de connexion : aucun attribut d'administration, mot de passe chiffré en SCRAM (défaut depuis PostgreSQL 14).
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD %L',
              nom, mdp)
FROM (VALUES ('keystone_app', :'mdp_keystone_app'), ('codex_app', :'mdp_codex_app'),
             ('cursus_app', :'mdp_cursus_app'), ('vigie_app', :'mdp_vigie_app'), ('arche_app', :'mdp_arche_app'),
             ('crucible_app', :'mdp_crucible_app'),
             ('matrix_app', :'mdp_matrix_app'), ('matrix_gestion', :'mdp_matrix_gestion'),
             (:'role_sauvegarde', :'mdp_sauvegarde')) AS v(nom, mdp) \gexec

-- Power BI (bi_reader) : connexion seulement si BI_READER_PASSWORD est fourni (facultatif, contrairement aux autres).
\if :{?mdp_bi_reader}
\else
  \set mdp_bi_reader ''
\endif
SELECT CASE WHEN :'mdp_bi_reader' = '' THEN 'ALTER ROLE bi_reader WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD NULL'
            ELSE format('ALTER ROLE bi_reader WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD %L', :'mdp_bi_reader') END \gexec

-- Clavis (annuaire et accès, 23/11/2026) : connexion seulement si CLAVIS_APP_PASSWORD est fourni, comme bi_reader, pour
-- que le socle se rejoue sans elle sur un serveur où Clavis n'est pas déployé.
\if :{?mdp_clavis_app}
\else
  \set mdp_clavis_app ''
\endif
SELECT CASE WHEN :'mdp_clavis_app' = '' THEN 'ALTER ROLE clavis_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD NULL'
            ELSE format('ALTER ROLE clavis_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD %L', :'mdp_clavis_app') END \gexec

-- Modulus (commercial et chiffrage, « validé » du propriétaire du 24/11/2026) : de même, connexion seulement si
-- MODULUS_APP_PASSWORD est fourni, pour que le socle se rejoue sans elle sur un serveur où Modulus n'est pas déployé.
\if :{?mdp_modulus_app}
\else
  \set mdp_modulus_app ''
\endif
SELECT CASE WHEN :'mdp_modulus_app' = '' THEN 'ALTER ROLE modulus_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD NULL'
            ELSE format('ALTER ROLE modulus_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD %L', :'mdp_modulus_app') END \gexec

-- Vector (expéditions nationales et internationales, « validé » du propriétaire du 25/11/2026) : de même, connexion
-- seulement si VECTOR_APP_PASSWORD est fourni, pour que le socle se rejoue sans elle sur un serveur où Vector n'est pas déployé.
\if :{?mdp_vector_app}
\else
  \set mdp_vector_app ''
\endif
SELECT CASE WHEN :'mdp_vector_app' = '' THEN 'ALTER ROLE vector_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD NULL'
            ELSE format('ALTER ROLE vector_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD %L', :'mdp_vector_app') END \gexec

-- Ingenium (ingénierie : registre des disciplines, P&ID, référentiel technique, nomenclatures d'ingénierie, plans, pack et
-- dossier technique ; « validé » du propriétaire du 27/11/2026, demande DI-M1 d'Ingenium) : de même, connexion seulement si
-- INGENIUM_APP_PASSWORD est fourni, pour que le socle se rejoue sans elle sur un serveur où Ingenium n'est pas déployé.
\if :{?mdp_ingenium_app}
\else
  \set mdp_ingenium_app ''
\endif
SELECT CASE WHEN :'mdp_ingenium_app' = '' THEN 'ALTER ROLE ingenium_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD NULL'
            ELSE format('ALTER ROLE ingenium_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD %L', :'mdp_ingenium_app') END \gexec

-- Purge du journal des actions de Cursus (« ok pour la purge par rôle dédié sur Cursus », décision M-24 du 25/11/2026) :
-- connexion seulement si CURSUS_PURGE_PASSWORD est fourni, comme bi_reader ; jamais membre d'un autre rôle. Ses droits
-- (aucun autre que la purge des lignes échues) sont posés par init/03-droits.sql une fois la migration 0035 de Cursus passée.
\if :{?mdp_cursus_purge}
\else
  \set mdp_cursus_purge ''
\endif
SELECT CASE WHEN :'mdp_cursus_purge' = '' THEN 'ALTER ROLE cursus_purge WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD NULL'
            ELSE format('ALTER ROLE cursus_purge WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD %L', :'mdp_cursus_purge') END \gexec
SELECT format('REVOKE %I FROM cursus_purge', g.rolname)
FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid JOIN pg_roles r ON r.oid = m.member
WHERE r.rolname = 'cursus_purge' \gexec

-- Matrix lit les schémas des outils par le groupe matrix_lecture.
GRANT matrix_lecture TO matrix_app;
-- Sauvegardes : lecture de toutes les données, colonnes sensibles comprises (pg_dump).
GRANT pg_read_all_data TO :"role_sauvegarde";
-- Administration : un membre de matrix_admin peut prendre le rôle d'un outil (SET ROLE) pour une opération de
-- structure exceptionnelle, sans en hériter les droits au quotidien. Ses requêtes sont journalisées.
GRANT keystone_app, codex_app, cursus_app, vigie_app, arche_app, crucible_app, clavis_app, modulus_app, vector_app, ingenium_app, matrix_app, matrix_gestion TO matrix_admin WITH INHERIT FALSE, SET TRUE;

COMMENT ON ROLE keystone_app IS 'Connexion de Keystone : propriétaire du schéma keystone ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/).';
COMMENT ON ROLE codex_app IS 'Connexion de Codex : propriétaire du schéma codex ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/).';
COMMENT ON ROLE cursus_app IS 'Connexion de Cursus : propriétaire du schéma cursus ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/).';
COMMENT ON ROLE vigie_app IS 'Connexion de Vigie : propriétaire du schéma vigie ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/).';
COMMENT ON ROLE arche_app IS 'Connexion d''Arche (CAPEX des filiales) : propriétaire du schéma arche ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/).';
COMMENT ON ROLE crucible_app IS 'Connexion de Crucible (moyens d''essais R&D partagés) : propriétaire du schéma crucible ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/).';
COMMENT ON ROLE clavis_app IS 'Connexion de Clavis (annuaire et accès aux outils) : propriétaire du schéma clavis ; ailleurs, seulement SELECT sur les vues pub_ accordées. matrix_lecture ne lit ni les comptes ni les clients et codes de connexion (tables fermées, droits.colonnes_sensibles). Sans CLAVIS_APP_PASSWORD : NOLOGIN.';
COMMENT ON ROLE modulus_app IS 'Connexion de Modulus (commercial et chiffrage : catalogue machines, BOM standard, prix, affaires, savoir-faire) : propriétaire du schéma modulus ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/). Sans MODULUS_APP_PASSWORD : NOLOGIN.';
COMMENT ON ROLE vector_app IS 'Connexion de Vector (expéditions nationales et internationales : demandes, colisage, transport, douane, documents, suivi, coûts) : propriétaire du schéma vector ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/). Sans VECTOR_APP_PASSWORD : NOLOGIN.';
COMMENT ON ROLE ingenium_app IS 'Connexion d''Ingenium (ingénierie : registre des disciplines, P&ID, référentiel technique, nomenclatures d''ingénierie, plans, pack et dossier technique) : propriétaire du schéma ingenium ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/). Sans INGENIUM_APP_PASSWORD : NOLOGIN.';
COMMENT ON ROLE matrix_app IS 'Connexion de Matrix : propriétaire du schéma matrix, lit les outils par matrix_lecture.';
COMMENT ON ROLE matrix_gestion IS 'Connexion de Matrix pour l''administration (décision M-18) : propriétaire des vues pub_ des outils, USAGE et CREATE sur leurs schémas, SELECT sur leurs tables, GRANT et REVOKE des liens ; aucune écriture dans les tables, aucun attribut d''administration.';
COMMENT ON ROLE bi_reader IS 'Connexion de Power BI (demande M-14 d''Arche) : transactions en lecture seule, SELECT sur les seules vues pub_ que le registre des liens de Matrix lui accorde (lecteur bi_reader), rien d''autre. Sans BI_READER_PASSWORD : NOLOGIN.';
COMMENT ON ROLE matrix_lecture IS 'Groupe : SELECT sur keystone, codex, cursus, vigie, arche, crucible, clavis, modulus, vector, ingenium, sauf les colonnes de droits.colonnes_sensibles.';
COMMENT ON ROLE matrix_admin IS 'Groupe : tous les droits sur les schémas des outils. Attribué nominativement par droits.declarer_admin (requêtes journalisées).';
COMMENT ON ROLE cursus_purge IS 'Connexion de la purge du journal des actions de Cursus (décision M-24) : supprime les seules lignes échues de cursus.journal (12 mois, 36 pour la paie) par cursus.purger_journal() ; droits : CONNECT, USAGE sur cursus, SELECT (id, at, action, paie) et DELETE sur journal, SELECT sur journal_actions_paie, INSERT et SELECT (id) sur journal_purges, EXECUTE sur purger_journal(), rien d''autre (init/03-droits.sql). Sans CURSUS_PURGE_PASSWORD : NOLOGIN.';
COMMENT ON ROLE :"role_sauvegarde" IS 'Connexion des sauvegardes (pg_dump) : membre de pg_read_all_data.';

-- ── 4. Accès à la base ───────────────────────────────────────────────────
-- Personne ne se connecte à la base commune sans droit explicite ; aucun rôle (hors superutilisateur) n'y crée de schéma.
REVOKE ALL ON DATABASE :"base" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"base"
  TO keystone_app, codex_app, cursus_app, vigie_app, arche_app, crucible_app, clavis_app, modulus_app, vector_app, ingenium_app, matrix_app, matrix_gestion, matrix_lecture, matrix_admin, :"role_sauvegarde", bi_reader, cursus_purge;

COMMIT;

\echo 'Étape 1 terminée : base' :base 'et rôles en place.'
