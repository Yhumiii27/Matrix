-- Retour arrière du renommage en Atrium (docs/renommage-atrium.md, « Retour arrière ») : base atrium → epc2i, rôle
-- atrium_sauvegarde → epc2i_sauvegarde. Les fichiers du dépôt marchent avec les deux noms : rien d'autre à rejouer.
--
-- En superutilisateur, connecté à la base postgres, les outils arrêtés :
--   psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /opt/atrium/renommage/retour-epc2i.sql
-- Rejouable ; remet aussi les connexions si un renommage s'est arrêté entre ALLOW_CONNECTIONS false et la fin.

\set ON_ERROR_STOP on
\pset pager off

SELECT current_database() IN ('atrium', 'epc2i') AS sur_la_base \gset
\if :sur_la_base
  \echo 'Connectez-vous à la base postgres (-d postgres).'
  SELECT 1/0 AS arret;
\endif

DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Lancez ce script avec un superutilisateur (postgres), pas avec %.', current_user;
  END IF;
  IF EXISTS (SELECT FROM pg_database WHERE datname = 'epc2i') AND EXISTS (SELECT FROM pg_database WHERE datname = 'atrium') THEN
    RAISE EXCEPTION 'Les bases epc2i et atrium existent toutes les deux : rien n''est fait, à examiner.';
  END IF;
  IF EXISTS (SELECT FROM pg_authid WHERE rolname = 'atrium_sauvegarde' AND rolpassword LIKE 'md5%') THEN
    RAISE EXCEPTION 'Le mot de passe de atrium_sauvegarde est en MD5 : le renommage l''effacerait.';
  END IF;
END $$;

SELECT 'ALTER DATABASE atrium WITH ALLOW_CONNECTIONS false' WHERE EXISTS (SELECT FROM pg_database WHERE datname = 'atrium') \gexec
SELECT count(pg_terminate_backend(pid)) AS sessions_coupees
FROM pg_stat_activity WHERE datname = 'atrium' AND pid <> pg_backend_pid();
DO $$
DECLARE i int := 0;
BEGIN
  WHILE EXISTS (SELECT FROM pg_stat_activity WHERE datname = 'atrium' AND pid <> pg_backend_pid()) AND i < 100 LOOP
    PERFORM pg_sleep(0.1); i := i + 1;
  END LOOP;
END $$;
SELECT 'ALTER DATABASE atrium RENAME TO epc2i' WHERE EXISTS (SELECT FROM pg_database WHERE datname = 'atrium') \gexec
ALTER DATABASE epc2i WITH ALLOW_CONNECTIONS true;
SELECT 'ALTER ROLE atrium_sauvegarde RENAME TO epc2i_sauvegarde' WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'atrium_sauvegarde') \gexec

SELECT datname, datallowconn FROM pg_database WHERE datname IN ('epc2i', 'atrium');
SELECT rolname, left(rolpassword, 13) = 'SCRAM-SHA-256' AS mot_de_passe_scram FROM pg_authid WHERE rolname IN ('epc2i_sauvegarde', 'atrium_sauvegarde');
\echo 'Retour fait : base epc2i, rôle epc2i_sauvegarde. Remettre les anciennes DATABASE_URL des outils (docs/renommage-atrium.md).'
