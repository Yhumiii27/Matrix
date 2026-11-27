-- Serveur PostgreSQL commun de la suite Atrium : ajout d'Ingenium sur un serveur en service (demande DI-M1 d'Ingenium,
-- « validé » du propriétaire du 27/11/2026, décision M-29).
--
-- Ce fichier fait, pour le seul Ingenium, ce que feraient init/01-base-et-roles.sql et init/02-schemas.sql rejoués,
-- sans toucher aux mots de passe ni aux autres rôles, et réécrit les contraintes des registres de Matrix (comme
-- partage/12-matrix-liens.sql et 13-matrix-publications.sql rejoués) pour qu'ils acceptent ingenium et ingenium_app :
--   1. rôle ingenium_app, créé NOLOGIN s'il manque (sans mot de passe : il ne peut pas se connecter) ; s'il existe,
--      ses attributs d'administration sont remis à « aucun », sa connexion et son mot de passe ne sont pas touchés ;
--      CONNECT sur la base commune ; matrix_admin peut prendre son rôle (SET ROLE), sans en hériter les droits ;
--   2. schéma ingenium, propriété d'ingenium_app, fermé à PUBLIC ; search_path et délai d'inactivité du rôle sur la base ;
--   3. contraintes de matrix.liens (vue, lecteur) et matrix.publications (vue), si ces registres existent.
-- Ensuite, rejouer init/03-droits.sql (droits de matrix_lecture, matrix_gestion, matrix_admin sur le schéma,
-- privilèges par défaut, droits.verifier() qui connaît ingenium_app) : voir docs/mise-en-service.md, ligne 1.6.
--
-- Lancement : superutilisateur (postgres), sans -1 (le fichier ouvre sa transaction). Dans le conteneur Coolify :
--   docker compose exec postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /opt/atrium/ajouts/ingenium.sql
-- Installation directe (docs/installation-directe.md) :
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -f /opt/atrium/matrix/infra/postgres/ajouts/ingenium.sql
-- Rejouable : un second passage ne change rien. Aucune donnée n'est lue ni écrite dans un schéma d'outil.
-- Retour arrière (schéma encore vide) : en superutilisateur, DROP SCHEMA ingenium; REVOKE ALL ON DATABASE … FROM
-- ingenium_app; DROP ROLE ingenium_app; (après un « validé », docs/delegation-claude.md § 2).

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off
-- Base commune : atrium, ou epc2i tant que le serveur en service n'est pas renommé (docs/renommage-atrium.md) ;
-- -v base=<nom> l'impose.
\if :{?base}
\else
  SELECT coalesce((SELECT datname FROM pg_database WHERE datname IN ('atrium', 'epc2i')
                   ORDER BY datname <> 'atrium' LIMIT 1), 'atrium') AS base \gset
\endif
\connect :base

DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Lancez ajouts/ingenium.sql en superutilisateur (postgres) : % ne l''est pas.', current_user;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'matrix_admin') THEN
    RAISE EXCEPTION 'Socle absent (rôle matrix_admin introuvable) : jouez d''abord init/01 à 03.';
  END IF;
END $$;

BEGIN;

-- ── 1. Rôle ──────────────────────────────────────────────────────────────
SELECT 'CREATE ROLE ingenium_app WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT PASSWORD NULL'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ingenium_app') \gexec
ALTER ROLE ingenium_app WITH NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;
COMMENT ON ROLE ingenium_app IS 'Connexion d''Ingenium (ingénierie : registre des disciplines, P&ID, référentiel technique, nomenclatures d''ingénierie, plans, pack et dossier technique) : propriétaire du schéma ingenium ; ailleurs, seulement SELECT sur les vues pub_ accordées (convention de partage, infra/postgres/partage/). Sans INGENIUM_APP_PASSWORD : NOLOGIN.';
GRANT CONNECT ON DATABASE :"base" TO ingenium_app;
GRANT ingenium_app TO matrix_admin WITH INHERIT FALSE, SET TRUE;

-- ── 2. Schéma ────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS ingenium AUTHORIZATION ingenium_app;
ALTER SCHEMA ingenium OWNER TO ingenium_app;
REVOKE ALL ON SCHEMA ingenium FROM PUBLIC;
COMMENT ON SCHEMA ingenium IS 'Ingenium (ingénierie : registre des disciplines, P&ID, référentiel technique, nomenclatures d''ingénierie, plans, pack et dossier technique) : tables et journal des migrations. Propriétaire ingenium_app.';
ALTER ROLE ingenium_app IN DATABASE :"base" SET search_path TO ingenium;
ALTER ROLE ingenium_app IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';

-- ── 3. Registres de Matrix ───────────────────────────────────────────────
-- Mêmes contraintes que partage/12-matrix-liens.sql et 13-matrix-publications.sql (à garder identiques).
DO $$
BEGIN
  IF to_regclass('matrix.liens') IS NOT NULL THEN
    ALTER TABLE matrix.liens DROP CONSTRAINT IF EXISTS liens_vue_check;
    ALTER TABLE matrix.liens ADD CONSTRAINT liens_vue_check CHECK (vue ~ '^(keystone|codex|cursus|vigie|arche|crucible|clavis|modulus|vector|ingenium|matrix)\.pub_[a-z0-9_]+$');
    ALTER TABLE matrix.liens DROP CONSTRAINT IF EXISTS liens_lecteur_check;
    ALTER TABLE matrix.liens ADD CONSTRAINT liens_lecteur_check CHECK (lecteur IN ('keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app', 'crucible_app', 'clavis_app', 'modulus_app', 'vector_app', 'ingenium_app', 'matrix_app', 'bi_reader'));
  ELSE
    RAISE WARNING 'matrix.liens absente : contrainte posée plus tard par partage/12-matrix-liens.sql.';
  END IF;
  IF to_regclass('matrix.publications') IS NOT NULL THEN
    ALTER TABLE matrix.publications DROP CONSTRAINT IF EXISTS publications_vue_check;
    ALTER TABLE matrix.publications ADD CONSTRAINT publications_vue_check CHECK (vue ~ '^(keystone|codex|cursus|vigie|arche|crucible|clavis|modulus|vector|ingenium)\.pub_[a-z0-9_]+$');
  ELSE
    RAISE WARNING 'matrix.publications absente : contrainte posée plus tard par partage/13-matrix-publications.sql.';
  END IF;
END $$;

COMMIT;

SELECT r.rolname AS role, r.rolcanlogin AS connexion, n.nspname AS schema, pg_get_userbyid(n.nspowner) AS proprietaire,
       has_database_privilege('ingenium_app', current_database(), 'CONNECT') AS connect
FROM pg_roles r LEFT JOIN pg_namespace n ON n.nspname = 'ingenium'
WHERE r.rolname = 'ingenium_app';

\echo 'Ingenium ajouté : rôle ingenium_app et schéma ingenium en place. Rejouez maintenant init/03-droits.sql (docs/mise-en-service.md, 1.6).'
