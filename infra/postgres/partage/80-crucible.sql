-- Partage des données EPC2I, fichier 80 : vues publiées par Crucible (schéma crucible, moyens d'essais R&D partagés).
--
-- Copie qualifiée des vues pub_ créées par les migrations de Crucible (dépôt Yhumiii27/Crucible, règle P-02 : c'est
-- Crucible qui crée ses vues, à sa migration ; ce fichier les recrée à l'identique) :
--   - crucible.pub_journal : drizzle/0002_share_journal.sql (contrat D18, réunie par 95-matrix-journal-unifie.sql) ;
--   - crucible.pub_moyens, pub_reservations : drizzle/0005_share_resources.sql (lues par Keystone, Vigie et Matrix ;
--     demande M-7 de Crucible) ;
--   - crucible.pub_occupation_hebdo : drizzle/0009_share_weekly.sql (lue par Matrix ; demande M-8 de Crucible).
-- Demandes M-4, M-7 et M-8 de Crucible (REQUESTS.md de Matrix). Une vue pub_ est un contrat : on n'en retire ni ne
-- renomme de colonne (sinon _v2).
-- Exécution : en tant que crucible_app, après les migrations de Crucible :
--   psql "postgres://crucible_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/80-crucible.sql
-- Rejouable. Droits des lecteurs : 90-droits.sql.

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

-- ═══ Prérequis : migrations de Crucible passées ═══
DO $prerequis$
BEGIN
  IF to_regclass('crucible.audit_entries') IS NULL OR to_regclass('crucible.activity_events') IS NULL
     OR to_regclass('crucible.bookings') IS NULL OR to_regclass('crucible.weekly_snapshots') IS NULL THEN
    RAISE EXCEPTION 'Crucible n''a pas encore appliqué ses migrations sur ce serveur (0000 à 0009) : lancez npm run db:migrate de Crucible avec DATABASE_URL (rôle crucible_app), puis rejouez ce fichier.';
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

-- ═══ Moyens d'essai et réservations (copie de drizzle/0005_share_resources.sql) ═══
-- pub_reservations : réservations qui tiennent un moyen (confirmées, en cours, terminées) ; pour un projet confidentiel,
-- projet, projet Keystone et objet sont nuls (décision S-7 de Crucible).
CREATE OR REPLACE VIEW "crucible"."pub_moyens" WITH (security_barrier) AS
SELECT r.code                  AS code,
       r.name                  AS nom,
       r.kind                  AS nature,
       r.facility_code         AS installation_code,
       f.name                  AS installation,
       f.site_code             AS site_code,
       f.operator_entity_code  AS entite_exploitante,
       r.capacity              AS capacite,
       r.granularity           AS granularite,
       r.status                AS etat,
       r.updated_at            AS maj_le
FROM "crucible"."resources" r
JOIN "crucible"."facilities" f ON f.code = r.facility_code;
COMMENT ON VIEW "crucible"."pub_moyens" IS 'Contrat v1 : moyens d''essai de Crucible (installation, site, entité exploitante, état). Lecteurs : keystone_app, vigie_app, matrix_app.';

CREATE OR REPLACE VIEW "crucible"."pub_reservations" WITH (security_barrier) AS
SELECT b.ref                   AS ref,
       r.code                  AS moyen_code,
       r.facility_code         AS installation_code,
       f.site_code             AS site_code,
       b.entity_code           AS entite_code,
       CASE WHEN p.confidential THEN NULL ELSE b.project_code END AS projet_code,
       CASE WHEN p.confidential THEN NULL ELSE p.keystone_code END AS projet_keystone,
       CASE WHEN p.confidential THEN NULL ELSE b.title END        AS objet,
       p.confidential          AS confidentiel,
       b.status                AS statut,
       b.starts_at             AS debut,
       b.ends_at               AS fin,
       b.actual_start_at       AS debut_reel,
       b.actual_end_at         AS fin_reel,
       b.updated_at            AS maj_le
FROM "crucible"."bookings" b
JOIN "crucible"."resources" r ON r.id = b.resource_id
JOIN "crucible"."facilities" f ON f.code = r.facility_code
JOIN "crucible"."projects" p ON p.code = b.project_code
WHERE b.status IN ('confirmed', 'in_progress', 'done');
COMMENT ON VIEW "crucible"."pub_reservations" IS 'Contrat v1 : réservations qui tiennent un moyen (confirmées, en cours, terminées) ; projet et objet masqués pour un projet confidentiel. Lecteurs : keystone_app, vigie_app, matrix_app.';

-- ═══ Occupation hebdomadaire (copie de drizzle/0009_share_weekly.sql) ═══
-- Une ligne par semaine terminée et par moyen, calculée une fois puis jamais recalculée ; taux en % des heures
-- ouvertes nettes, nul sans heures ouvertes.
CREATE OR REPLACE VIEW "crucible"."pub_occupation_hebdo" WITH (security_barrier) AS
SELECT s.monday                AS semaine,
       r.code                  AS moyen_code,
       r.facility_code         AS installation_code,
       s.net_open_hours        AS heures_ouvertes_nettes,
       s.booked_hours          AS heures_reservees,
       s.realised_hours        AS heures_realisees,
       s.realised_with_prep_hours AS heures_realisees_preparation,
       s.blocked_hours         AS heures_bloquees,
       s.no_shows              AS reservations_non_tenues,
       CASE WHEN s.net_open_hours > 0 THEN round((100 * s.realised_with_prep_hours / s.net_open_hours)::numeric, 1) END AS taux_realise_pct,
       s.computed_at           AS maj_le
FROM "crucible"."weekly_snapshots" s
JOIN "crucible"."resources" r ON r.id = s.resource_id;
COMMENT ON VIEW "crucible"."pub_occupation_hebdo" IS 'Contrat v1 : occupation hebdomadaire par moyen (instantanés X-4). Lecteurs : matrix_app.';

\echo 'Partage de Crucible : pub_journal, pub_moyens, pub_reservations et pub_occupation_hebdo en place.'
