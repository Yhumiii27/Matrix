-- Partage des données EPC2I, fichier 80 : vues publiées par Crucible (schéma crucible, moyens d'essais R&D partagés).
--
-- Copie qualifiée des vues pub_ créées par les migrations de Crucible (dépôt Yhumiii27/Crucible, règle P-02 : c'est
-- Crucible qui crée ses vues, à sa migration ; ce fichier les recrée à l'identique) :
--   - crucible.pub_journal : drizzle/0002_share_journal.sql (contrat D18, réunie par 95-matrix-journal-unifie.sql).
-- À venir avec la livraison L3 de Crucible : pub_moyens, pub_reservations (lues par Keystone et Vigie). Demande M-4 de
-- Crucible (docs/DEMANDES-MATRIX.md). Une vue pub_ est un contrat : on n'en retire ni ne renomme de colonne (sinon _v2).
-- Exécution : en tant que crucible_app, après les migrations de Crucible :
--   psql "postgres://crucible_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/80-crucible.sql
-- Rejouable. Droits des lecteurs : 90-droits.sql.

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

-- ═══ Prérequis : migrations de Crucible passées ═══
DO $prerequis$
BEGIN
  IF to_regclass('crucible.audit_entries') IS NULL OR to_regclass('crucible.activity_events') IS NULL THEN
    RAISE EXCEPTION 'Crucible n''a pas encore appliqué ses migrations sur ce serveur (0000 à 0002) : lancez npm run db:migrate de Crucible avec DATABASE_URL (rôle crucible_app), puis rejouez ce fichier.';
  END IF;
END $prerequis$;

-- ═══ D18 · Journal ═══
CREATE OR REPLACE VIEW "crucible"."pub_journal" WITH (security_barrier) AS
SELECT 'audit_entries:' || a.id::text AS ref_source,
       'audit'::text            AS nature,
       a.occurred_at            AS quand,
       a.actor_name             AS qui,
       a.actor_user_id::text    AS qui_ref,
       a.actor_role             AS qui_role,
       a.area                   AS action,
       a.object_ref             AS objet,
       a.change                 AS detail,
       a.project_code           AS projet,
       NULL::text               AS qui_matricule
FROM "crucible"."audit_entries" a
UNION ALL
SELECT 'activity_events:' || e.id::text, 'activite', e.occurred_at, e.actor_name, e.actor_user_id::text, NULL,
       'activity.' || e.kind, NULL, e.text, e.project_code, NULL::text
FROM "crucible"."activity_events" e;
COMMENT ON VIEW "crucible"."pub_journal" IS 'Contrat D18 v1 : piste d''audit et fil d''activité de Crucible aux colonnes communes. Lecteur : matrix_app (matrix.journal_unifie).';

\echo 'Partage de Crucible : pub_journal en place.'
