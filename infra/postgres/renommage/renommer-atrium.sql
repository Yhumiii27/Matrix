-- Renommage du serveur commun en Atrium (décision du propriétaire du 27/11/2026) : base epc2i → atrium, rôle
-- epc2i_sauvegarde → atrium_sauvegarde. Étape 4 de docs/renommage-atrium.md, à jouer seulement après un « validé »,
-- une sauvegarde vérifiée de moins d'une heure et l'arrêt de tous les outils.
--
-- En superutilisateur, connecté à la base postgres (jamais à epc2i, que l'on renomme) :
--   psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /opt/atrium/renommage/renommer-atrium.sql
--
-- Ce que le renommage garde (PostgreSQL rattache tout à l'identifiant interne de la base et du rôle, pas au nom) :
-- schémas, tables, données, propriétaires, droits CONNECT de la base (datacl), réglages ALTER DATABASE … SET et
-- ALTER ROLE … IN DATABASE … SET (pg_db_role_setting), déclencheurs d'événement, appartenances, et le mot de passe du
-- rôle s'il est chiffré en SCRAM (un mot de passe MD5 serait effacé par le renommage : le script le refuse avant).
-- Rejouable : sur un serveur déjà renommé, il ne change rien et le dit. Retour arrière : retour-epc2i.sql.

\set ON_ERROR_STOP on
\pset pager off

SELECT current_database() = 'epc2i' AS sur_epc2i \gset
\if :sur_epc2i
  \echo 'Connectez-vous à la base postgres (-d postgres) : la base epc2i ne peut pas être renommée depuis elle-même.'
  SELECT 1/0 AS arret;
\endif

DO $$
DECLARE
  v_db_ancienne boolean := EXISTS (SELECT FROM pg_database WHERE datname = 'epc2i');
  v_db_nouvelle boolean := EXISTS (SELECT FROM pg_database WHERE datname = 'atrium');
  v_role_md5 boolean := EXISTS (SELECT FROM pg_authid WHERE rolname = 'epc2i_sauvegarde' AND rolpassword LIKE 'md5%');
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Lancez ce script avec un superutilisateur (postgres), pas avec %.', current_user;
  END IF;
  IF v_db_ancienne AND v_db_nouvelle THEN
    RAISE EXCEPTION 'Les bases epc2i et atrium existent toutes les deux : rien n''est fait, à examiner (une base atrium vide créée par un init/ joué sur un volume neuf ?).';
  END IF;
  IF NOT v_db_ancienne AND NOT v_db_nouvelle THEN
    RAISE EXCEPTION 'Ni epc2i ni atrium : ce n''est pas le serveur commun.';
  END IF;
  IF v_role_md5 THEN
    RAISE EXCEPTION 'Le mot de passe de epc2i_sauvegarde est en MD5 : le renommage l''effacerait. Rejouer d''abord init/01-base-et-roles.sql (SCRAM).';
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'epc2i_sauvegarde') AND EXISTS (SELECT FROM pg_roles WHERE rolname = 'atrium_sauvegarde') THEN
    RAISE EXCEPTION 'Les rôles epc2i_sauvegarde et atrium_sauvegarde existent tous les deux : rien n''est fait, à examiner.';
  END IF;
END $$;

-- Sessions encore ouvertes sur epc2i, par application (aucune attendue : les outils sont arrêtés).
SELECT coalesce(application_name, '') AS application, usename AS role, count(*) AS sessions
FROM pg_stat_activity WHERE datname = 'epc2i' AND pid <> pg_backend_pid()
GROUP BY 1, 2 ORDER BY 1, 2;

-- 1. Base : plus aucune connexion nouvelle, sessions restantes coupées, renommage, connexions rouvertes.
SELECT format('ALTER DATABASE epc2i WITH ALLOW_CONNECTIONS false') WHERE EXISTS (SELECT FROM pg_database WHERE datname = 'epc2i') \gexec
SELECT count(pg_terminate_backend(pid)) AS sessions_coupees
FROM pg_stat_activity WHERE datname = 'epc2i' AND pid <> pg_backend_pid();
-- Les sessions coupées mettent un instant à se fermer : le renommage les attend (au plus 10 s).
DO $$
DECLARE i int := 0;
BEGIN
  WHILE EXISTS (SELECT FROM pg_stat_activity WHERE datname = 'epc2i' AND pid <> pg_backend_pid()) AND i < 100 LOOP
    PERFORM pg_sleep(0.1); i := i + 1;
  END LOOP;
END $$;
SELECT 'ALTER DATABASE epc2i RENAME TO atrium' WHERE EXISTS (SELECT FROM pg_database WHERE datname = 'epc2i') \gexec
ALTER DATABASE atrium WITH ALLOW_CONNECTIONS true;
COMMENT ON DATABASE atrium IS 'Serveur commun de la suite Atrium : un schéma par outil (keystone, codex, cursus, vigie, arche, crucible, clavis, modulus, vector, matrix). Voir infra/postgres/README.md dans Matrix.';

-- 2. Rôle des sauvegardes (le mot de passe SCRAM est gardé).
SELECT 'ALTER ROLE epc2i_sauvegarde RENAME TO atrium_sauvegarde' WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'epc2i_sauvegarde') \gexec
COMMENT ON ROLE atrium_sauvegarde IS 'Connexion des sauvegardes (pg_dump) : membre de pg_read_all_data.';

-- 3. Contrôles : la base, ses droits et réglages, le rôle et son mot de passe.
SELECT datname, datallowconn, pg_catalog.array_length(datacl, 1) AS droits_connect FROM pg_database WHERE datname IN ('epc2i', 'atrium');
SELECT count(*) AS reglages_de_la_base FROM pg_db_role_setting d JOIN pg_database b ON b.oid = d.setdatabase WHERE b.datname = 'atrium';
SELECT rolname, rolcanlogin, left(rolpassword, 13) = 'SCRAM-SHA-256' AS mot_de_passe_scram,
       pg_has_role(rolname, 'pg_read_all_data', 'USAGE') AS lit_tout,
       has_database_privilege(rolname, 'atrium', 'CONNECT') AS connect_atrium
FROM pg_authid WHERE rolname IN ('epc2i_sauvegarde', 'atrium_sauvegarde');
\echo 'Renommage fait : base atrium, rôle atrium_sauvegarde. Suite : étape 5 de docs/renommage-atrium.md.'
