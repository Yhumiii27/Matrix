-- Partage des données EPC2I, fichier 70 : vues publiées par Arche (schéma arche, CAPEX des filiales).
--
-- Copie qualifiée des vues pub_ créées par les migrations d'Arche (dépôt Yhumiii27/Arche, règle P-02 : c'est Arche qui
-- crée ses vues, à sa migration ; ce fichier les recrée à l'identique) :
--   - arche.pub_journal : drizzle/0002_share_journal.sql (contrat D18, réunie par 95-matrix-journal-unifie.sql) ;
--   - arche.pub_capex   : drizzle/0005_share_capex.sql (CAPEX ouverts, hors brouillons) ;
--   - arche.pub_besoins_machines : drizzle/0009_share_needs.sql (besoins soumis, hors brouillons ; demande M-10 d'Arche) ;
--   - arche.pub_rampup, arche.pub_rex (v1, plus lue) : drizzle/0014_share_rampup_rex.sql ;
--   - arche.pub_rex_v2 : drizzle/0016_share_rex_v2.sql (contrat commun du REX, D22, réunie par 96-matrix-rex-unifie.sql) ;
--     demande M-13 d'Arche. Demande M-4 d'Arche
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
     OR to_regclass('arche.machine_needs') IS NULL OR to_regclass('arche.production_lines') IS NULL
     OR to_regclass('arche.rex_entries') IS NULL THEN
    RAISE EXCEPTION 'Arche n''a pas encore appliqué ses migrations sur ce serveur (0000 à 0016) : démarrez Arche avec DATABASE_URL (rôle arche_app), puis rejouez ce fichier.';
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

-- ═══ Montée en puissance et REX (copie de drizzle/0014_share_rampup_rex.sql et 0016_share_rex_v2.sql) ═══
-- pub_rampup : une ligne par machine du parc d'une ligne de production d'un CAPEX en MES (chiffres de la ligne).
CREATE OR REPLACE VIEW "arche"."pub_rampup" WITH (security_barrier) AS
SELECT m.numero                        AS machine_numero,
       c.code                          AS capex_code,
       l.name                          AS ligne_production,
       c.mes_started_on                AS debut_mes_le,
       l.nominal_per_day               AS capacite_nominale,
       l.unit                          AS unite_capacite,
       l.avg_capacity_pct              AS capacite_atteinte_pct,
       l.avg_oee_pct                   AS trs_reception_pct,
       l.avg_scrap_pct                 AS rebuts_reception_pct,
       l.reached_on                    AS trente_jours_le,
       l.rampup_status                 AS statut,
       greatest(l.updated_at, coalesce(l.computed_at, l.updated_at)) AS maj_le
FROM "arche"."production_lines" l
JOIN "arche"."capex" c ON c.id = l.capex_id
CROSS JOIN LATERAL jsonb_array_elements_text(l.machine_numbers) AS m(numero)
WHERE c.mes_started_on IS NOT NULL;
COMMENT ON VIEW "arche"."pub_rampup" IS 'Contrat v1 : montée en puissance par machine du parc (lignes de production d''un CAPEX en MES). Lecteurs : keystone_app, matrix_app.';

-- pub_rex (v1, proposition d'Arche à 9 colonnes) : gardée telle quelle, une vue pub_ ne change jamais en place ; Matrix
-- lit pub_rex_v2.
CREATE OR REPLACE VIEW "arche"."pub_rex" WITH (security_barrier) AS
SELECT r.id::text                      AS ref_source,
       c.code                          AS capex_code,
       NULL::text                      AS projet_code,
       r.category                      AS categorie,
       r.title                         AS titre,
       r.text                          AS texte,
       r.phase                         AS phase,
       r.published_at                  AS publie_le,
       r.author_name                   AS auteur
FROM "arche"."rex_entries" r
JOIN "arche"."capex" c ON c.id = r.capex_id
WHERE r.published_at IS NOT NULL;
COMMENT ON VIEW "arche"."pub_rex" IS 'Contrat v1 (remplacé par pub_rex_v2, contrat commun de Matrix) : retours d''expérience publiés des CAPEX. Lecteur : matrix_app.';

-- pub_rex_v2 : contrat commun du REX (docs/architecture-postgres.md de Matrix, § 8 quater), phase en fin de vue.
CREATE OR REPLACE VIEW "arche"."pub_rex_v2" WITH (security_barrier) AS
SELECT 'rex_entries:' || r.id::text                      AS ref_source,
       'arche'::text                                     AS outil,
       NULL::text                                        AS projet_code,
       c.code                                            AS capex_code,
       'REX-' || lpad(r.number::text, 2, '0')            AS numero,
       r.category                                        AS categorie,
       r.title                                           AS titre,
       r.text                                            AS constat,
       NULL::text                                        AS impact,
       r.recommendation                                  AS recommandation,
       NULL::text                                        AS portee,
       'publie'::text                                    AS statut,
       r.author_name                                     AS auteur,
       r.published_at                                    AS cree_le,
       r.updated_at                                      AS maj_le,
       r.phase                                           AS phase
FROM "arche"."rex_entries" r
JOIN "arche"."capex" c ON c.id = r.capex_id
WHERE r.published_at IS NOT NULL;
COMMENT ON VIEW "arche"."pub_rex_v2" IS 'Contrat commun du REX de Matrix (D22) : retours d''expérience publiés des CAPEX, mêmes colonnes que keystone.pub_rex, phase en fin de vue. Lecteur : matrix_app.';

\echo 'Partage d''Arche : pub_journal, pub_capex, pub_besoins_machines, pub_rampup, pub_rex et pub_rex_v2 en place.'
