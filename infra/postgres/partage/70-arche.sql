-- Partage des données EPC2I, fichier 70 : vues publiées par Arche (schéma arche, CAPEX des filiales).
--
-- Copie qualifiée des vues pub_ créées par les migrations d'Arche (dépôt Yhumiii27/Arche, règle P-02 : c'est Arche qui
-- crée ses vues, à sa migration ; ce fichier les recrée à l'identique) :
--   - arche.pub_journal : drizzle/0002_share_journal.sql (contrat D18, réunie par 95-matrix-journal-unifie.sql) ;
--   - arche.pub_capex   : drizzle/0005_share_capex.sql (CAPEX ouverts, hors brouillons) ;
--   - arche.pub_besoins_machines : drizzle/0009_share_needs.sql (besoins soumis, hors brouillons ; demande M-10 d'Arche).
-- À venir avec les livraisons d'Arche : pub_rampup, pub_rex (D22). Demande M-4 d'Arche
-- (docs/DEMANDES-MATRIX.md). Une vue pub_ est un contrat : on n'en retire ni ne renomme de colonne (sinon _v2).
-- Exécution : en tant que arche_app, après les migrations d'Arche :
--   psql "postgres://arche_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/70-arche.sql
-- Rejouable. Droits des lecteurs : 90-droits.sql.

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

-- ═══ Prérequis : migrations d'Arche passées ═══
DO $prerequis$
BEGIN
  IF to_regclass('arche.audit_entries') IS NULL OR to_regclass('arche.activity_events') IS NULL
     OR to_regclass('arche.capex') IS NULL OR to_regclass('arche.gates') IS NULL
     OR to_regclass('arche.machine_needs') IS NULL THEN
    RAISE EXCEPTION 'Arche n''a pas encore appliqué ses migrations sur ce serveur (0000 à 0009) : démarrez Arche avec DATABASE_URL (rôle arche_app), puis rejouez ce fichier.';
  END IF;
END $prerequis$;

-- ═══ D18 · Journal ═══
CREATE OR REPLACE VIEW "arche"."pub_journal" WITH (security_barrier) AS
SELECT 'audit_entries:' || a.id::text AS ref_source,
       'audit'::text            AS nature,
       a.occurred_at            AS quand,
       a.actor_name             AS qui,
       a.actor_user_id::text    AS qui_ref,
       a.actor_role             AS qui_role,
       a.area                   AS action,
       a.object_ref             AS objet,
       a.change                 AS detail,
       c.code                   AS projet,
       NULL::text               AS qui_matricule
FROM "arche"."audit_entries" a
LEFT JOIN "arche"."capex" c ON c.id = a.capex_id
UNION ALL
SELECT 'activity_events:' || e.id::text, 'activite', e.occurred_at, e.actor_name, e.actor_user_id::text, NULL,
       'activity.' || e.kind, NULL, e.text, c.code, NULL::text
FROM "arche"."activity_events" e
LEFT JOIN "arche"."capex" c ON c.id = e.capex_id;
COMMENT ON VIEW "arche"."pub_journal" IS 'Contrat D18 v1 : piste d''audit et fil d''activité d''Arche aux colonnes communes. Lecteur : matrix_app (matrix.journal_unifie).';

-- ═══ CAPEX ouverts ═══
CREATE OR REPLACE VIEW "arche"."pub_capex" WITH (security_barrier) AS
SELECT c.code                          AS code,
       c.subsidiary_code               AS filiale_code,
       s.name                          AS filiale,
       z.name                          AS zone,
       si.name                         AS site,
       s.country_iso2                  AS pays_iso2,
       c.title                         AS intitule,
       c.investment_type               AS type_investissement,
       c.status                        AS statut,
       c.phase                         AS phase_code,
       c.typology                      AS typologie,
       sp.display_name                 AS sponsor_nom,
       sp.email                        AS sponsor_email,
       ld.display_name                 AS chef_projet_nom,
       ld.email                        AS chef_projet_email,
       (SELECT min(g.decided_at)::date FROM "arche"."gates" g
         WHERE g.capex_id = c.id AND g.code = 'G1' AND g.decision IN ('go', 'go_with_conditions')) AS g1_le,
       (SELECT min(g.decided_at)::date FROM "arche"."gates" g
         WHERE g.capex_id = c.id AND g.code = 'G2' AND g.decision IN ('go', 'go_with_conditions')) AS g2_le,
       (SELECT min(g.decided_at)::date FROM "arche"."gates" g
         WHERE g.capex_id = c.id AND g.code = 'G3' AND g.decision IN ('go', 'go_with_conditions')) AS g3_le,
       c.mes_started_on                AS debut_mes_le,
       c.updated_at                    AS maj_le
FROM "arche"."capex" c
JOIN "arche"."subsidiaries" s ON s.code = c.subsidiary_code
JOIN "arche"."zones" z ON z.code = s.zone_code
LEFT JOIN "arche"."sites" si ON si.id = c.site_id
LEFT JOIN "arche"."users" sp ON sp.id = c.sponsor_user_id
LEFT JOIN "arche"."users" ld ON ld.id = c.lead_user_id
WHERE c.status <> 'draft';
COMMENT ON VIEW "arche"."pub_capex" IS 'Contrat v1 : CAPEX ouverts d''Arche (hors brouillons). Lecteurs : keystone_app, matrix_app.';

-- ═══ Besoins machines (copie de drizzle/0009_share_needs.sql) ═══
CREATE OR REPLACE VIEW "arche"."pub_besoins_machines" WITH (security_barrier) AS
SELECT c.code || '/B' || lpad(n.number::text, 2, '0') AS besoin_ref,
       c.code                          AS capex_code,
       'B' || lpad(n.number::text, 2, '0') AS ligne,
       n.catalogue_code                AS catalogue_code,
       n.catalogue_version             AS catalogue_version,
       n.free_label                    AS libelle_libre,
       n.quantity                      AS quantite,
       n.options                       AS options,
       n.target_capacity               AS capacite_visee,
       n.capacity_unit                 AS unite_capacite,
       n.need_date                     AS date_besoin,
       si.name                         AS site,
       n.status                        AS statut,
       n.comment                       AS commentaire,
       n.submitted_at                  AS soumis_le,
       n.ordered_on                    AS commande_le,
       n.updated_at                    AS maj_le
FROM "arche"."machine_needs" n
JOIN "arche"."capex" c ON c.id = n.capex_id
LEFT JOIN "arche"."sites" si ON si.id = c.site_id
WHERE n.status <> 'draft';
COMMENT ON VIEW "arche"."pub_besoins_machines" IS 'Contrat v1 : besoins machines soumis à EPC2i (hors brouillons). Lecteurs : keystone_app, matrix_app.';

\echo 'Partage d''Arche : pub_journal, pub_capex et pub_besoins_machines en place.'
