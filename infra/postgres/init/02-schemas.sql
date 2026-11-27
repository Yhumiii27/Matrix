-- Serveur PostgreSQL commun de la suite Atrium, étape 2 sur 3 : un schéma par outil.
--
-- Lancement : automatique au premier démarrage du conteneur, ou à la main en superutilisateur, après l'étape 1 :
--   psql -h <hôte> -U postgres -d postgres -v ON_ERROR_STOP=1 -f init/02-schemas.sql
-- Rejouable : crée les schémas qui manquent et remet propriétaires et paramètres de session.
--
--   schéma    propriétaire   search_path du rôle
--   keystone  keystone_app   keystone
--   codex     codex_app      codex
--   cursus    cursus_app     cursus
--   vigie     vigie_app      vigie
--   arche     arche_app      arche
--   crucible  crucible_app   crucible
--   clavis    clavis_app     clavis   (annuaire et accès aux outils, 23/11/2026)
--   modulus   modulus_app    modulus  (commercial et chiffrage, 24/11/2026)
--   vector    vector_app     vector   (expéditions, 25/11/2026)
--   ingenium  ingenium_app   ingenium (ingénierie, 27/11/2026)
--   matrix    matrix_app     matrix
--
-- Chaque outil crée ses tables et le journal de ses migrations dans son propre schéma. Aucun rôle d'outil n'a le
-- droit CREATE sur la base : il ne peut ni créer un autre schéma, ni écrire dans public.
--
-- Extensions : schéma extensions, propriété du superutilisateur, fermé à PUBLIC. Il porte pg_trgm (paquet contrib,
-- index de recherche document_terms_term de Codex), que codex_app ne peut pas créer lui-même. Hors du schéma codex :
-- ses fonctions, exécutables par tous, y seraient un droit EXECUTE croisé pour chaque lecteur des vues codex.pub_
-- (droits.verifier()). Seul codex_app reçoit USAGE sur extensions ; Codex l'ajoute au search_path de sa seule
-- transaction de migration.

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

BEGIN;

-- public reste vide et fermé : un objet créé par erreur sans schéma échoue au lieu d'atterrir là.
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS keystone AUTHORIZATION keystone_app;
CREATE SCHEMA IF NOT EXISTS codex    AUTHORIZATION codex_app;
CREATE SCHEMA IF NOT EXISTS cursus   AUTHORIZATION cursus_app;
CREATE SCHEMA IF NOT EXISTS vigie    AUTHORIZATION vigie_app;
CREATE SCHEMA IF NOT EXISTS arche    AUTHORIZATION arche_app;
CREATE SCHEMA IF NOT EXISTS crucible AUTHORIZATION crucible_app;
CREATE SCHEMA IF NOT EXISTS clavis AUTHORIZATION clavis_app;
CREATE SCHEMA IF NOT EXISTS modulus  AUTHORIZATION modulus_app;
CREATE SCHEMA IF NOT EXISTS vector   AUTHORIZATION vector_app;
CREATE SCHEMA IF NOT EXISTS ingenium AUTHORIZATION ingenium_app;
CREATE SCHEMA IF NOT EXISTS matrix   AUTHORIZATION matrix_app;

-- Rejeu : remet le bon propriétaire si quelqu'un l'a changé.
ALTER SCHEMA keystone OWNER TO keystone_app;
ALTER SCHEMA codex    OWNER TO codex_app;
ALTER SCHEMA cursus   OWNER TO cursus_app;
ALTER SCHEMA vigie    OWNER TO vigie_app;
ALTER SCHEMA arche    OWNER TO arche_app;
ALTER SCHEMA crucible OWNER TO crucible_app;
ALTER SCHEMA clavis OWNER TO clavis_app;
ALTER SCHEMA modulus  OWNER TO modulus_app;
ALTER SCHEMA vector   OWNER TO vector_app;
ALTER SCHEMA ingenium OWNER TO ingenium_app;
ALTER SCHEMA matrix   OWNER TO matrix_app;

REVOKE ALL ON SCHEMA keystone, codex, cursus, vigie, arche, crucible, clavis, modulus, vector, ingenium, matrix FROM PUBLIC;

COMMENT ON SCHEMA keystone IS 'Keystone (gestion de projets) : tables et journal des migrations (__drizzle_migrations). Propriétaire keystone_app.';
COMMENT ON SCHEMA codex    IS 'Codex (GED) : tables et journal des migrations (__drizzle_migrations). Propriétaire codex_app.';
COMMENT ON SCHEMA cursus   IS 'Cursus (RH) : tables et journal des migrations (schema_migrations). Propriétaire cursus_app.';
COMMENT ON SCHEMA vigie    IS 'Vigie (QHSE) : tables et journal des migrations (__drizzle_migrations). Propriétaire vigie_app.';
COMMENT ON SCHEMA arche    IS 'Arche (CAPEX des filiales, méthode DIG-PRODI) : tables et journal des migrations. Propriétaire arche_app.';
COMMENT ON SCHEMA crucible IS 'Crucible (moyens d''essais R&D partagés) : tables et journal des migrations (__drizzle_migrations). Propriétaire crucible_app.';
COMMENT ON SCHEMA clavis   IS 'Clavis (annuaire et accès aux outils) : personnes, profils, accès, comptes et journal des migrations (__drizzle_migrations). Propriétaire clavis_app. Comptes, clients et codes de connexion fermés à matrix_lecture (droits.colonnes_sensibles).';
COMMENT ON SCHEMA modulus  IS 'Modulus (commercial et chiffrage : catalogue machines, BOM standard, prix, affaires, savoir-faire) : tables et journal des migrations. Propriétaire modulus_app.';
COMMENT ON SCHEMA vector   IS 'Vector (expéditions nationales et internationales : demandes, colisage, transport, douane, documents, suivi, coûts) : tables et journal des migrations. Propriétaire vector_app.';
COMMENT ON SCHEMA ingenium IS 'Ingenium (ingénierie : registre des disciplines, P&ID, référentiel technique, nomenclatures d''ingénierie, plans, pack et dossier technique) : tables et journal des migrations. Propriétaire ingenium_app.';
COMMENT ON SCHEMA matrix   IS 'Matrix (catalogue des bases) : catalogue, correspondances, historique, journal. Propriétaire matrix_app.';

-- Paramètres de session, appliqués à chaque connexion de l'outil sur la base commune (y compris derrière PgBouncer,
-- qui refuse le paramètre de démarrage « options »).
ALTER ROLE keystone_app IN DATABASE :"base" SET search_path TO keystone;
ALTER ROLE codex_app    IN DATABASE :"base" SET search_path TO codex;
ALTER ROLE cursus_app   IN DATABASE :"base" SET search_path TO cursus;
ALTER ROLE vigie_app    IN DATABASE :"base" SET search_path TO vigie;
ALTER ROLE arche_app    IN DATABASE :"base" SET search_path TO arche;
ALTER ROLE crucible_app IN DATABASE :"base" SET search_path TO crucible;
ALTER ROLE clavis_app   IN DATABASE :"base" SET search_path TO clavis;
ALTER ROLE modulus_app  IN DATABASE :"base" SET search_path TO modulus;
ALTER ROLE vector_app   IN DATABASE :"base" SET search_path TO vector;
ALTER ROLE ingenium_app IN DATABASE :"base" SET search_path TO ingenium;
ALTER ROLE matrix_app   IN DATABASE :"base" SET search_path TO matrix;

-- Une transaction ouverte et oubliée garde ses verrous, dont le verrou d'écriture de l'outil (voir
-- docs/architecture-postgres.md, § 4.5) : elle est coupée au bout de 5 minutes d'inactivité.
ALTER ROLE keystone_app IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE codex_app    IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE cursus_app   IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE vigie_app    IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE arche_app    IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE crucible_app IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE clavis_app   IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE modulus_app  IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE vector_app   IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE ingenium_app IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';
ALTER ROLE matrix_app   IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';

-- bi_reader (Power BI, demande M-14 d'Arche) : toute transaction en lecture seule ; une requête de plus de 2 minutes
-- est arrêtée, une transaction ouverte et oubliée coupée au bout de 5 minutes.
ALTER ROLE bi_reader IN DATABASE :"base" SET default_transaction_read_only TO on;
ALTER ROLE bi_reader IN DATABASE :"base" SET statement_timeout TO '120s';
ALTER ROLE bi_reader IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';

-- matrix_gestion (M-18) : sans search_path, chaque nom de table d'une vue pub_ s'écrit avec son schéma (une définition
-- ne dépend jamais du réglage de la session) ; un verrou attendu plus de 5 s abandonne la publication plutôt que de
-- bloquer les outils qui lisent ou écrivent la table.
ALTER ROLE matrix_gestion IN DATABASE :"base" SET search_path TO '';
ALTER ROLE matrix_gestion IN DATABASE :"base" SET lock_timeout TO '5s';
ALTER ROLE matrix_gestion IN DATABASE :"base" SET idle_in_transaction_session_timeout TO '5min';

-- Extensions demandées par les outils (voir l'en-tête) : pg_trgm pour Codex. Rejeu : le schéma garde son
-- propriétaire et ses droits, l'extension n'est créée que si elle manque (une restauration de codex.dump la suppose).
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION CURRENT_USER;
ALTER SCHEMA extensions OWNER TO CURRENT_USER;
REVOKE ALL ON SCHEMA extensions FROM PUBLIC;
GRANT USAGE ON SCHEMA extensions TO codex_app;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
COMMENT ON SCHEMA extensions IS 'Extensions installées par le superutilisateur pour les outils : pg_trgm (Codex). USAGE à codex_app seul. Voir infra/postgres/init/02-schemas.sql dans Matrix.';

COMMIT;

\echo 'Étape 2 terminée : schémas keystone, codex, cursus, vigie, arche, crucible, clavis, modulus, vector, ingenium, matrix et extensions (pg_trgm) en place.'
