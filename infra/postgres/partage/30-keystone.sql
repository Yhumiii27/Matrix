-- Partage des données EPC2I, fichier 30 : vues publiées par Keystone (schéma keystone).
--
-- Décisions : D02 projets, D03 chantiers, D04 affectations, D05 tâches, D16 clients et fournisseurs (D21 : code de la
-- filiale d'un client interne), D12 et D13 (référentiels lus par Vigie : articles, nomenclatures, parc, activités,
-- livrables), D18 journal, D22 REX ; demandes d'Arche (K-01 à K-10) et de Crucible.
-- Source : les 22 vues sont créées par les migrations de Keystone (dépôt Keystone, décision P-02 du 18/10/2026) :
-- drizzle/0035_share.sql (12 vues), 0038_share_followup.sql (pub_jalons, pub_jalons_projets, pub_avancement_projets,
-- pub_avenants, pub_reserves ; colonnes ajoutées en fin de pub_projets et pub_livrables), 0040_share_installed_base.sql
-- (colonnes ajoutées en fin de pub_parc_machines), 0046_catalogue_share.sql (pub_catalogue_machines),
-- 0050_capex_needs_share.sql (pub_reponses_besoins), 0052_internal_client_share.sql (colonnes ajoutées en fin de
-- pub_projets), 0054_matrix_rex_clients_share.sql (pub_rex ; colonne ajoutée en fin de pub_clients),
-- 0060_engineering_pack_share.sql (pub_pack_ingenierie), 0064_shipments_share.sql (pub_expeditions ; pub_jalons_projets,
-- dernière définition, après celle de 0057_capex_milestone_share) et 0071_project_category_share.sql (categorie en fin
-- de pub_projets). Leurs colonnes,
-- tables et index prérequis viennent de 0034_share_prerequisites.sql (persons.matricule : 0024),
-- 0037_share_followup_columns, 0045_machine_catalogue, 0049_capex_needs, 0051_internal_clients et
-- 0053_matrix_subsidiaries, 0055_capex_milestone_code, 0058_engineering_pack, 0061_shipments et 0063_shipments_reception ;
-- le déclencheur machine_catalogue_entries_frozen, de 0046. Ce
-- fichier en est la copie, qualifiée keystone. et commentée colonne par colonne : le rejouer sur un serveur où Keystone
-- a passé ses migrations (npm run db:migrate) ne change rien (CREATE OR REPLACE VIEW, même définition). Il ne crée ni
-- colonne ni contrainte : migration de Keystone d'abord, puis ce fichier, puis 90-droits.sql. Toute évolution d'une
-- vue se fait d'abord dans une migration de Keystone, puis est recopiée ici.
-- Exécution : en tant que keystone_app, après npm run db:migrate de Keystone (voir README.md).
--   psql "postgres://keystone_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/30-keystone.sql
-- Rejouable. Les vues ne lisent que des tables du schéma keystone (aucune jointure vers matrix). Droits : 90-droits.sql.
--
-- Écarts avec la première version de ce fichier (15/10/2026), alignés sur Keystone : countries.iso2 reste facultatif
-- (pas de NOT NULL : la colonne Drizzle est nullable) ; persons.matricule n'a pas de contrainte de forme (les matricules
-- viennent de Cursus, contrôlés à l'import) ; projects.kind, departments.org_code et leurs contraintes sont ceux de 0034.
--
-- Attention aux migrations de Keystone : PostgreSQL refuse de supprimer ou de changer le type d'une colonne lue
-- par une vue (« cannot drop column … view keystone.pub_chantiers depends on it »). drizzle-kit ne connaît pas
-- ces vues : une migration qui touche une colonne listée ici doit recréer la vue (CREATE OR REPLACE VIEW).

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

-- ═══ Prérequis : migrations 0034 à 0064 de Keystone ═══
-- Ce fichier ne crée rien d'autre que les vues. Une colonne, une table ou un déclencheur absent signale une migration
-- de Keystone non passée.
DO $$
DECLARE
  v_manque text;
BEGIN
  SELECT string_agg(x.t || '.' || x.c, ', ') INTO v_manque
  FROM (VALUES ('persons', 'matricule'), ('countries', 'iso2'), ('projects', 'kind'), ('departments', 'org_code'),
               ('vigie_ecos', 'released_at'), ('vigie_ncrs', 'closed_on'), ('vigie_ncrs', 'supplier_id'),
               ('vigie_ncrs', 'owner_matricule'),
               -- 0037_share_followup_columns (pub_projets, pub_jalons, pub_avancement_projets)
               ('projects', 'capex_code'), ('projects', 'besoin_ref'), ('milestones', 'updated_at'),
               ('share_project_progress', 'progress_pct'),
               -- 0045_machine_catalogue (pub_catalogue_machines)
               ('machine_catalogue_entries', 'code'), ('project_equipments', 'catalogue_code'),
               -- 0049_capex_needs (pub_reponses_besoins)
               ('need_answers', 'updated_at'),
               -- 0051_internal_clients (pub_projets, pub_clients)
               ('clients', 'is_internal'), ('clients', 'subsidiary_code'),
               -- pub_rex (table des leçons apprises, antérieure au partage)
               ('lessons_learned', 'updated_at'),
               -- 0055_capex_milestone_code (pub_jalons_projets)
               ('milestones', 'capex_milestone_code'),
               -- 0058_engineering_pack (pub_pack_ingenierie)
               ('machine_type_pack_families', 'machine_type_code'), ('document_types', 'pack_family'),
               -- 0061_shipments et 0063_shipments_reception (pub_expeditions, pub_jalons_projets)
               ('shipments', 'received_on'), ('contracts', 'incoterm_id'), ('incoterms', 'code'),
               ('shipment_punch_items', 'shipment_id'),
               -- 0070_project_category_task_recurrence (pub_projets, colonne categorie de 0071)
               ('projects', 'category')) AS x(t, c)
  WHERE NOT EXISTS (SELECT FROM information_schema.columns ic
                    WHERE ic.table_schema = 'keystone' AND ic.table_name = x.t AND ic.column_name = x.c);
  IF v_manque IS NOT NULL THEN
    RAISE EXCEPTION 'Colonnes absentes du schéma keystone (%) : lancez npm run db:migrate de Keystone (migrations 0034_share_prerequisites à 0071_project_category_share), puis rejouez ce fichier.', v_manque;
  END IF;
  -- 0046_catalogue_share : une version publiée du catalogue est figée par ce déclencheur (R-186), condition du contrat
  -- de pub_catalogue_machines.
  IF NOT EXISTS (SELECT FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'keystone' AND c.relname = 'machine_catalogue_entries'
                   AND t.tgname = 'machine_catalogue_entries_frozen' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'Déclencheur keystone.machine_catalogue_entries_frozen absent : lancez npm run db:migrate de Keystone (migration 0046_catalogue_share), puis rejouez ce fichier.';
  END IF;
  -- Index des colonnes maj_le (K-11) : need_answers_updated_at_idx (0049, pub_reponses_besoins),
  -- lessons_learned_updated_at_idx (0053, pub_rex) et shipments_updated_at_idx (0063, pub_expeditions) ; les lecteurs
  -- filtrent sur maj_le.
  SELECT string_agg(x.i, ', ') INTO v_manque
  FROM (VALUES ('need_answers_updated_at_idx'), ('lessons_learned_updated_at_idx'), ('shipments_updated_at_idx')) AS x(i)
  WHERE to_regclass('keystone.' || x.i) IS NULL;
  IF v_manque IS NOT NULL THEN
    RAISE EXCEPTION 'Index absents du schéma keystone (%) : lancez npm run db:migrate de Keystone (migrations 0049_capex_needs, 0053_matrix_subsidiaries et 0063_shipments_reception), puis rejouez ce fichier.', v_manque;
  END IF;
END $$;

-- D17 : code ISO des pays déjà en base (même instruction que 0035_share ; sans effet une fois remplis).
UPDATE keystone.countries c SET iso2 = v.iso2
FROM (VALUES ('France', 'FR'), ('United Kingdom', 'GB'), ('Netherlands', 'NL'), ('Germany', 'DE'), ('Belgium', 'BE'),
             ('Spain', 'ES'), ('Italy', 'IT'), ('Canada', 'CA'), ('United States', 'US'), ('Morocco', 'MA'),
             ('Côte d’Ivoire', 'CI'), ('Senegal', 'SN'), ('Kenya', 'KE'), ('South Africa', 'ZA'), ('Egypt', 'EG'),
             ('Australia', 'AU'), ('Malaysia', 'MY'), ('Singapore', 'SG'), ('Indonesia', 'ID'), ('Vietnam', 'VN'),
             ('Japan', 'JP'), ('India', 'IN'), ('Ghana', 'GH'), ('Brazil', 'BR'), ('Saudi Arabia', 'SA')) AS v(name, iso2)
WHERE c.name = v.name AND c.iso2 IS NULL;

-- Non traités ici : D03 suppression de site_sheets.cursus_chantier_id ; D10 documents.codex_id NOT NULL UNIQUE
-- (après la reprise) ; D09 suppression de certifications ; D11 document_types, document_type_circuit_steps et
-- document_approver_assignments gardées comme caches de codex.pub_types_document, pub_circuits_type et
-- pub_titulaires_fonction (clés documents.type_code et document_deposits.type_code inchangées) ; D14 (facultatif)
-- storage_locations.site_code.

-- ═══ Vues publiées ═══
-- Contrat : on n'en retire ni ne renomme de colonne (sinon nouvelle vue _v2) ; ajout en fin de liste seulement.
-- security_barrier : un filtre posé par le lecteur ne s'évalue qu'après ceux de la vue.

-- D02 · Projets (clients et internes) ────────────────────────────────────
CREATE OR REPLACE VIEW keystone.pub_projets WITH (security_barrier) AS
SELECT p.code,                                   -- tous : clé (codex.projects.code, vigie.*.keystone_project_code, lignes de feuille Cursus)
       p.number             AS numero,           -- Vigie : matchProject (« n° d'affaire » #026 des plans importés)
       p.analytic_code      AS code_analytique,  -- Vigie : matchProject (HAV004) ; Cursus : imputation Sage (D06)
       p.kind               AS nature,           -- Cursus : codes internes sur la feuille ; Codex, Vigie : filtre nature = 'client'
       p.name               AS nom,              -- tous : libellé
       p.client_id,                              -- Vigie : rapprochement avec pub_clients (D16)
       c.name               AS client,           -- Codex : projects.client ; Vigie : libellé « code · client »
       c.code3              AS client_code3,     -- Vigie : rapprochement des plans de prévention importés (text.ts:252-272)
       p.stage              AS phase_code,       -- Vigie : contrôle de la clé PM d'un ECO (D12)
       ls.label             AS phase,            -- Codex : projects.stage (page.tsx:254)
       (p.stage NOT IN ('clos', 'annule')) AS imputable,  -- Cursus : options d'ajout de ligne (Temps.tsx:247)
       pm.matricule         AS chef_projet_matricule,     -- Codex : projects.manager_id par users.matricule ; Vigie : clé PM (D12)
       coalesce(pm.full_name, pm.short_name) AS chef_projet_nom,  -- Codex : panneau projet ; Vigie : affichage
       ps.city              AS ville,            -- Codex : projects.site (page.tsx:262)
       ps.country_name      AS pays,             -- Codex, Vigie : affichage
       (SELECT string_agg(DISTINCT su.name, ' · ' ORDER BY su.name)
          FROM keystone.purchase_orders po
          JOIN keystone.suppliers su ON su.id = po.supplier_id
         WHERE po.project_id = p.id AND po.status NOT IN ('draft', 'cancelled')) AS fournisseurs,  -- Codex : projects.tiers (page.tsx:263)
       p.updated_at         AS maj_le,           -- Codex : projects.synced_at (page.tsx:255) ; tous : rafraîchissement
       p.capex_code,                             -- Arche (K-05, R-190) : CAPEX du projet (CPX-XXX-AAAA-nn)
       p.besoin_ref,                             -- Arche (K-05, R-190) : besoin machine du CAPEX (CPX-…/Bnn)
       coalesce(c.is_internal, false) AS client_interne,  -- Arche (K-05, R-190) : client = filiale du groupe ; jamais nul
       c.subsidiary_code    AS filiale_code,     -- Arche, Matrix (D21) : matrix.pub_filiales.code de ce client interne
       p.category           AS categorie         -- Crucible (K-3, R-196) : client (défaut) ou rd ; jamais nulle (0070, 0071)
FROM keystone.projects p
LEFT JOIN keystone.clients c           ON c.id = p.client_id
LEFT JOIN keystone.persons pm          ON pm.id = p.pm_person_id
LEFT JOIN keystone.lifecycle_stages ls ON ls.code = p.stage
LEFT JOIN keystone.project_sites ps    ON ps.project_id = p.id;
COMMENT ON VIEW keystone.pub_projets IS 'Contrat D02 v1 + capex_code, besoin_ref (R-190, en fin de vue) + client_interne, filiale_code (R-190, client interne = filiale du groupe) + categorie (R-196 : client | rd, projet R&D pour Crucible) : tous les projets Keystone, internes compris (nature). Lecteurs : codex_app, cursus_app, vigie_app, matrix_app, arche_app, crucible_app.';

-- D03 · Fiches chantier ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW keystone.pub_chantiers WITH (security_barrier) AS
SELECT p.code               AS projet_code,      -- Cursus : clé du chantier (chantiers.projet_code, voyages.chantier, demandes_keystone.chantier)
       p.name               AS projet_nom,       -- Cursus : Chantiers.tsx, Voyages.tsx
       c.name               AS client,           -- Cursus : Chantiers.tsx:53
       s.site_name          AS lieu,             -- Cursus : Chantiers.tsx, voyages.ts:70-87
       ps.city              AS ville,            -- Cursus : affichage
       s.country            AS pays,             -- Cursus : affichage
       co.iso2              AS pays_iso2,        -- Cursus : Go / No Go (c.pays !== 'FR', destOf, domain.ts:400-401)
       s.start_on           AS debut,            -- Cursus : resourceStatus (domain.ts:383-411)
       s.end_on             AS fin,              -- Cursus : resourceStatus
       pm.matricule         AS chef_projet_matricule,     -- Cursus : chef
       coalesce(pm.full_name, pm.short_name) AS chef_projet_nom,  -- Cursus : chef (affichage)
       s.updated_at         AS maj_le            -- Cursus : rafraîchissement
FROM keystone.site_sheets s
JOIN keystone.projects p            ON p.id = s.project_id
LEFT JOIN keystone.clients c        ON c.id = p.client_id
LEFT JOIN keystone.persons pm       ON pm.id = p.pm_person_id
LEFT JOIN keystone.project_sites ps ON ps.project_id = p.id
LEFT JOIN keystone.countries co     ON co.name = s.country;
COMMENT ON VIEW keystone.pub_chantiers IS 'Contrat D03 v1 : une ligne par fiche chantier. Les exigences (habilitations, certifications) restent dans cursus.chantiers. Lecteurs : cursus_app, matrix_app.';

-- D04 · Affectations (rotations de chantier et planning) ────────────────
-- Seules les personnes qui ont un matricule sont publiées : les équipes d'entreprises sortent du Go / No Go.
-- allocations est exclue : ses lignes n'ont pas de projet (totaux par semaine, seed/resources.ts:29-34).
CREATE OR REPLACE VIEW keystone.pub_affectations WITH (security_barrier) AS
SELECT 'rotation'::text      AS source,          -- Cursus : missions = source 'rotation' ; Vigie : les deux
       r.id                  AS affectation_id,  -- Cursus, Vigie : clé des caches cursus.missions et vigie.keystone_assignments
       pe.matricule,                             -- Cursus : employes.matricule ; Vigie : people.matricule
       coalesce(pe.full_name, r.person_name) AS personne_nom,  -- Vigie : affichage
       p.code                AS projet_code,     -- Cursus : missions.projet ; Vigie : libellé « code · client »
       p.name                AS projet_nom,      -- Cursus : Missions.tsx
       c.name                AS client,          -- Vigie : libellé « code · client »
       NULL::text            AS activite_code,   -- Vigie : activité (planning seulement)
       r.role_on_site        AS activite,        -- Vigie : keystone_assignments.activity
       r.from_on             AS du,              -- Cursus : alerte « Affecté au chantier » (conges.ts:129) ; Vigie : start_on
       r.to_on               AS au,              -- Cursus, Vigie : fin
       coalesce(s.site_name, ps.city) AS lieu,   -- Cursus : missions.lieu
       coalesce(s.country, ps.country_name) AS pays,  -- Cursus : affichage
       co.iso2               AS pays_iso2,       -- Cursus : type « Déplacement international » si <> 'FR'
       NULL::numeric         AS heures_prevues   -- Vigie : charge (planning seulement)
FROM keystone.site_rotations r
JOIN keystone.projects p            ON p.id = r.project_id
JOIN keystone.persons pe            ON pe.id = r.person_id
LEFT JOIN keystone.clients c        ON c.id = p.client_id
LEFT JOIN keystone.site_sheets s    ON s.project_id = r.project_id
LEFT JOIN keystone.project_sites ps ON ps.project_id = r.project_id
LEFT JOIN keystone.countries co     ON co.name = coalesce(s.country, ps.country_name)
WHERE pe.matricule IS NOT NULL
UNION ALL
SELECT 'planning', aa.id, pe.matricule, coalesce(pe.full_name, pe.short_name), p.code, p.name, c.name,
       a.code, a.name,
       coalesce(a.start_date, a.early_start_date), coalesce(a.finish_date, a.early_finish_date),
       ps.city, ps.country_name, co.iso2, aa.planned_hours
FROM keystone.activity_assignments aa
JOIN keystone.activities a          ON a.id = aa.activity_id
JOIN keystone.projects p            ON p.id = a.project_id
JOIN keystone.persons pe            ON pe.id = aa.person_id
LEFT JOIN keystone.clients c        ON c.id = p.client_id
LEFT JOIN keystone.project_sites ps ON ps.project_id = p.id
LEFT JOIN keystone.countries co     ON co.name = ps.country_name
WHERE pe.matricule IS NOT NULL
  AND coalesce(a.start_date, a.early_start_date) IS NOT NULL
  AND coalesce(a.finish_date, a.early_finish_date) IS NOT NULL;
COMMENT ON VIEW keystone.pub_affectations IS 'Contrat D04 v1 : rotations de chantier et affectations du planning des salariés (matricule renseigné). Les lecteurs filtrent sur au >= current_date. Lecteurs : cursus_app, vigie_app, matrix_app.';

-- D05 · Tâches réparties par jour ouvré ──────────────────────────────────
-- estimate_h réparti uniformément sur les jours ouvrés (lundi à vendredi) entre start_date et due_date. Cursus
-- met ensuite à zéro fériés, absences et jours non travaillés (shared/rules/temps.ts:94-100).
CREATE OR REPLACE VIEW keystone.pub_taches_jours WITH (security_barrier) AS
SELECT t.number              AS tache_numero,    -- Cursus : LigneTemps.tacheKeystone, envoi des heures par tâche (D06)
       pe.matricule,                             -- Cursus : filtre matricule = $1
       p.code                AS projet_code,     -- Cursus : ligne.projet
       p.name                AS projet_nom,      -- Cursus : affichage
       p.kind                AS projet_nature,   -- Cursus : projet interne ou client
       a.code                AS activite_code,   -- Cursus : lot (« To assign » sinon)
       t.title               AS titre,           -- Cursus : ligne.tache
       t.status              AS statut,          -- Cursus : exclure done si besoin
       g.jour::date          AS jour,            -- Cursus : colonne h[i]
       date_trunc('week', g.jour)::date AS semaine,  -- Cursus : filtre semaine = $2 (lundi)
       round(t.estimate_h / nullif(n.jours, 0), 2) AS heures_prevues  -- Cursus : suggestion temps.suggest
FROM keystone.tasks t
JOIN keystone.projects p   ON p.id = t.project_id
JOIN keystone.persons pe   ON pe.id = t.assignee_person_id
LEFT JOIN keystone.activities a ON a.id = t.activity_id
CROSS JOIN LATERAL (
  SELECT count(*) AS jours
  FROM generate_series(t.start_date, t.due_date, interval '1 day') AS d(x)
  WHERE extract(isodow FROM d.x) < 6
) n
CROSS JOIN LATERAL generate_series(t.start_date, t.due_date, interval '1 day') AS g(jour)
WHERE pe.matricule IS NOT NULL
  AND extract(isodow FROM g.jour) < 6;
COMMENT ON VIEW keystone.pub_taches_jours IS 'Contrat D05 v1 : une ligne par tâche et jour ouvré, salariés seulement. Lecture : WHERE matricule = $1 AND semaine = $2. Lecteurs : cursus_app, matrix_app.';

-- D16 · Fournisseurs et clients ──────────────────────────────────────────
CREATE OR REPLACE VIEW keystone.pub_fournisseurs WITH (security_barrier) AS
SELECT s.id,           -- Vigie : contractors.supplier_id, events.supplier_id (NC fournisseur)
       s.name,         -- Vigie : nom affiché d'une entreprise reliée, rapprochement matchByName
       s.x3_code,      -- Vigie : aide à la saisie du lien (Achats, QHSE)
       s.is_internal   -- Vigie : ne jamais proposer un atelier Keystone comme entreprise extérieure
FROM keystone.suppliers s;
COMMENT ON VIEW keystone.pub_fournisseurs IS 'Contrat D16 v1 : fournisseurs Keystone (sans les indicateurs de performance). Lecteurs : vigie_app, matrix_app.';

CREATE OR REPLACE VIEW keystone.pub_clients WITH (security_barrier) AS
SELECT c.id,     -- Vigie, Codex, Cursus : clé (pub_projets.client_id)
       c.name,   -- tous : libellé du client
       c.code3,  -- Vigie : rapprochement des plans de prévention importés ; Codex : affichage
       c.subsidiary_code AS filiale_code  -- Matrix (D21) : matrix.pub_filiales.code d'un client interne, nul sinon
FROM keystone.clients c;
COMMENT ON VIEW keystone.pub_clients IS 'Contrat D16 v1 + filiale_code (D21, en fin de vue : code de la filiale de Matrix pour un client interne, vide pour un client extérieur) : clients Keystone. Lecteurs : codex_app, cursus_app, vigie_app, matrix_app.';

-- D12 et D13 · Référentiels lus par Vigie ────────────────────────────────
CREATE OR REPLACE VIEW keystone.pub_articles WITH (security_barrier) AS
SELECT pa.ref,        -- Vigie : eco_parts.part_ref, events.part_ref
       pa.name,       -- Vigie : libellé
       pa.revision,   -- Vigie : révision courante (from_revision d'un ECO)
       pa.status,     -- Vigie : article actif ou non
       pa.part_type,  -- Vigie : affichage
       pa.make_buy    -- Vigie : impact achats d'un ECO
FROM keystone.parts pa;
COMMENT ON VIEW keystone.pub_articles IS 'Contrat D12 v1 : articles (sans prix, fabricant ni contrôle export). Lecteurs : vigie_app, matrix_app.';

CREATE OR REPLACE VIEW keystone.pub_nomenclatures WITH (security_barrier) AS
SELECT p.code             AS project_code,  -- Vigie : effectivité automatique « projet » d'un ECO
       p.stage,                             -- Vigie : phases à nomenclature ouverte
       pa.ref             AS part_ref,      -- Vigie : cas d'emploi de l'article
       sum(b.quantity)    AS quantity       -- Vigie : affichage
FROM keystone.project_bom_lines b
JOIN keystone.projects p ON p.id = b.project_id
JOIN keystone.parts pa   ON pa.id = b.part_id
GROUP BY p.code, p.stage, pa.ref;
COMMENT ON VIEW keystone.pub_nomenclatures IS 'Contrat D12 v1 : cas d''emploi des articles par projet. Lecteurs : vigie_app, matrix_app.';

CREATE OR REPLACE VIEW keystone.pub_parc_machines WITH (security_barrier) AS
SELECT m.number,                                  -- Vigie : eco_effectivity.target_ref (cible « machine »)
       m.name,                                    -- Vigie : libellé de la cible
       m.client_name,                             -- Vigie : affichage
       m.site_text,                               -- Vigie : affichage
       coalesce(p.code, m.project_code) AS project_code,  -- Vigie : projet d'origine
       m.warranty_status,                         -- Vigie : disposition (rétrofit sous garantie)
       r.part_ref,                                -- Vigie : article monté
       r.revision         AS fitted_revision,     -- Vigie : eco_effectivity.fitted_revision
       m.machine_type_code  AS type_machine_code, -- Arche (K-07, R-193) : type de la machine, identique sur ses lignes
       m.delivered_on       AS livree_le,         -- Arche (K-07) : date de livraison
       m.updated_at         AS maj_le             -- Arche (K-07) : rafraîchissement
FROM keystone.machines m
LEFT JOIN keystone.projects p ON p.id = m.project_id
LEFT JOIN keystone.machine_part_revisions r ON r.machine_id = m.id;
COMMENT ON VIEW keystone.pub_parc_machines IS 'Contrat D12 v1 + type_machine_code, livree_le, maj_le (R-193, en fin de vue) : parc installé, une ligne par machine et article monté ; les colonnes ajoutées sont celles de la machine. Lecteurs : vigie_app, matrix_app, arche_app.';

CREATE OR REPLACE VIEW keystone.pub_activites WITH (security_barrier) AS
SELECT p.code   AS project_code,  -- Vigie : filtre de la liste de choix
       a.code,                    -- Vigie : events.keystone_activity_code (fiche NC)
       a.name                     -- Vigie : libellé
FROM keystone.activities a
JOIN keystone.projects p ON p.id = a.project_id;
COMMENT ON VIEW keystone.pub_activites IS 'Contrat D13 v1 : activités du planning, pour la fiche NC. Lecteurs : vigie_app, matrix_app.';

CREATE OR REPLACE VIEW keystone.pub_livrables WITH (security_barrier) AS
SELECT p.code   AS project_code,  -- Vigie : filtre de la liste de choix
       d.number,                  -- Vigie : events.keystone_deliverable_number (fiche NC)
       d.title,                   -- Vigie : libellé
       d.status,                  -- Vigie : affichage
       d.deliverable_type AS type,     -- Arche (K-06, R-189) : client_acceptance = PV de réception
       d.accepted_on      AS accepte_le,  -- Arche (K-06) : date d'acceptation
       d.updated_at       AS maj_le       -- Arche (K-06) : rafraîchissement
FROM keystone.deliverables d
JOIN keystone.projects p ON p.id = d.project_id;
COMMENT ON VIEW keystone.pub_livrables IS 'Contrat D13 v1 + type, accepte_le, maj_le (R-189, en fin de vue) : livrables contractuels, pour la fiche NC et les PV de réception (type client_acceptance). Lecteurs : vigie_app, matrix_app, arche_app.';

-- R-195 · Jalons du planning (Crucible) ──────────────────────────────────
-- Mois comptés depuis le début du projet ; fin de l'activité liée quand elle est datée.
CREATE OR REPLACE VIEW keystone.pub_jalons WITH (security_barrier) AS
SELECT p.code               AS projet_code,
       m.id                 AS jalon_id,
       m.name               AS nom,
       m.position,
       m.baseline_month     AS mois_reference,
       m.forecast_month     AS mois_prevu,
       m.status             AS statut,
       a.code               AS activite_code,
       a.finish_date        AS date_fin_activite,
       greatest(m.updated_at, a.updated_at, a.scheduled_at) AS maj_le
FROM keystone.milestones m
JOIN keystone.projects p        ON p.id = m.project_id
LEFT JOIN keystone.activities a ON a.id = m.activity_id;
COMMENT ON VIEW keystone.pub_jalons IS 'Contrat R-195 v1 : jalons du planning des projets (mois depuis le début du projet), avec la fin de l''activité liée quand elle est datée. Lecteurs : crucible_app, matrix_app.';

-- R-189 · Suivi des projets d'un CAPEX (Arche K-04) ──────────────────────
-- Côté vente seulement (question P-05, AC-2 d'Arche) : aucun coût interne, taux, coût réel, budget, CPI, EAC ni marge.
-- Montants en k€, convertis de la devise du contrat au taux budgétaire du projet (comme toute consolidation de Keystone,
-- src/domain/currency.ts eurRate : 1 pour l'euro, le taux budgétaire pour la devise du projet, 1 sinon).
-- pub_jalons_projets : une ligne par projet et jalon CAPEX ; définition de 0064_shipments_share (après 0057).
-- - Jalon du planning marqué du code (milestones.capex_milestone_code, 0055) : ses dates sont celles de son activité (fin
--   courante, fin réelle une fois terminée) ; reference_le = fin de la même activité dans l'instantané BL1
--   (baseline_activities), nul sans BL1 approuvée ou sans jalon marqué.
-- - Sinon, comme avant : atteint à la première entrée, toujours valable, dans une phase de rang donné ou suivante ; date
--   prévue du module qui le planifie, sinon date réelle.
-- - expedition et arrivee_site suivent les expéditions du projet (premier enlèvement réel, dernière arrivée quand toutes
--   les expéditions envoyées sont arrivées) ; maj_le suit aussi les expéditions.
CREATE OR REPLACE VIEW keystone.pub_jalons_projets WITH (security_barrier) AS
WITH standing AS (
  SELECT t.project_id, s.seq, t.effective_on, t.created_at
  FROM keystone.stage_transitions t
  JOIN keystone.lifecycle_stages s ON s.code = t.to_stage
  WHERE t.mode <> 'revert'
    AND t.validation_status IS DISTINCT FROM 'rejected'
    AND s.seq IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM keystone.stage_transitions r WHERE r.reverts_transition_id = t.id)
)
SELECT p.code              AS projet_code,
       j.jalon_code,
       coalesce(j.prevu, cm.prevu, j.ship_prevu, CASE WHEN j.ship_decides THEN j.ship_reel ELSE coalesce(j.ship_reel, j.reel, cm.reel) END) AS prevu_le,
       cm.reference        AS reference_le,
       CASE WHEN j.ship_decides THEN j.ship_reel ELSE coalesce(j.ship_reel, j.reel, cm.reel) END AS reel_le,
       greatest(p.updated_at, e.changed, j.changed, cm.changed, shp.changed) AS maj_le
FROM keystone.projects p
LEFT JOIN keystone.contracts c    ON c.project_id = p.id
LEFT JOIN keystone.site_sheets ss ON ss.project_id = p.id
CROSS JOIN LATERAL (
  SELECT min(st.effective_on) FILTER (WHERE st.seq >= 4)  AS etudes,
         min(st.effective_on) FILTER (WHERE st.seq >= 5)  AS approvisionnements,
         min(st.effective_on) FILTER (WHERE st.seq >= 8)  AS expedition,
         min(st.effective_on) FILTER (WHERE st.seq >= 9)  AS chantier,
         min(st.effective_on) FILTER (WHERE st.seq >= 12) AS clos,
         max(st.created_at) AS changed
  FROM standing st WHERE st.project_id = p.id
) e
CROSS JOIN LATERAL (
  SELECT max(i.planned_on) AS planned, max(i.updated_at) AS changed
  FROM keystone.itp_plans ip JOIN keystone.itp_inspections i ON i.plan_id = ip.id
  WHERE ip.project_id = p.id AND i.stage = 'fat'
) fat
CROSS JOIN LATERAL (
  SELECT max(cs.date_on) AS planned,
         CASE WHEN count(*) > 0 AND bool_and(cs.status = 'done') THEN max(cs.date_on) END AS done
  FROM keystone.commissioning_systems sy JOIN keystone.commissioning_steps cs ON cs.system_id = sy.id
  WHERE sy.project_id = p.id AND cs.step = 'sat'
) sat
CROSS JOIN LATERAL (
  SELECT max(sp.planned_on) AS planned, max(sp.created_at) AS changed FROM keystone.sat_plans sp WHERE sp.project_id = p.id
) satp
CROSS JOIN LATERAL (
  SELECT max(d.due_on) AS due,
         CASE WHEN count(*) > 0 AND bool_and(d.status = 'accepted') THEN max(d.accepted_on) END AS accepted,
         max(d.updated_at) AS changed
  FROM keystone.deliverables d WHERE d.project_id = p.id AND d.deliverable_type = 'client_acceptance'
) pv
CROSS JOIN LATERAL (
  SELECT max(coalesce(mc.extended_until, mc.warranty_end_on)) AS ends, max(mc.updated_at) AS changed
  FROM keystone.machines mc WHERE mc.project_id = p.id
) w
CROSS JOIN LATERAL (
  SELECT min(sh.atd) AS depart, min(sh.etd) AS etd, max(sh.eta) AS eta,
         count(*) FILTER (WHERE sh.status <> 'draft') AS sent,
         CASE WHEN count(*) FILTER (WHERE sh.status <> 'draft') > 0 AND bool_and(sh.ata IS NOT NULL) FILTER (WHERE sh.status <> 'draft')
              THEN max(sh.ata) FILTER (WHERE sh.status <> 'draft') END AS arrivee,
         max(sh.updated_at) AS changed
  FROM keystone.shipments sh WHERE sh.project_id = p.id
) shp
CROSS JOIN LATERAL (VALUES
  ('commande',     NULL::date,                         coalesce(c.signed_on, e.etudes), c.updated_at,       NULL::date, NULL::date,  false),
  ('fin_etudes',   NULL::date,                         e.approvisionnements,            NULL::timestamptz, NULL::date, NULL::date,  false),
  ('fat',          fat.planned,                        e.expedition,                    fat.changed,       NULL::date, NULL::date,  false),
  ('expedition',   NULL::date,                         e.expedition,                    NULL::timestamptz, shp.etd,    shp.depart,  false),
  ('arrivee_site', ss.start_on,                        e.chantier,                      ss.updated_at,     shp.eta,    shp.arrivee, shp.sent > 0),
  ('sat',          coalesce(sat.planned, satp.planned), sat.done,                       satp.changed,      NULL::date, NULL::date,  false),
  ('pv_reception', pv.due,                             pv.accepted,                     pv.changed,        NULL::date, NULL::date,  false),
  ('fin_garantie', w.ends,                             e.clos,                          w.changed,         NULL::date, NULL::date,  false)
) AS j(jalon_code, prevu, reel, changed, ship_prevu, ship_reel, ship_decides)
LEFT JOIN LATERAL (
  SELECT CASE WHEN a.id IS NOT NULL THEN a.finish_date
              ELSE fm.d0 + (least(greatest(1, fm.day), extract(day FROM fm.d0 + interval '1 month - 1 day')::int) - 1) END AS prevu,
         CASE WHEN a.id IS NOT NULL THEN CASE WHEN a.finish_actual OR a.percent_complete >= 100 THEN a.finish_date END
              WHEN m.status = 'done' THEN fm.d0 + (least(greatest(1, fm.day), extract(day FROM fm.d0 + interval '1 month - 1 day')::int) - 1) END AS reel,
         CASE WHEN bl1.id IS NULL THEN NULL
              WHEN a.id IS NOT NULL THEN bla.finish_date
              ELSE bm.d0 + (least(greatest(1, bm.day), extract(day FROM bm.d0 + interval '1 month - 1 day')::int) - 1) END AS reference,
         greatest(m.updated_at, a.updated_at, a.scheduled_at, bl1.updated_at) AS changed
  FROM keystone.milestones m
  LEFT JOIN keystone.activities a ON a.id = m.activity_id
  LEFT JOIN keystone.baselines bl1 ON bl1.project_id = m.project_id AND bl1.code = 'BL1' AND bl1.state <> 'proposed'
  LEFT JOIN LATERAL (
    SELECT ba.finish_date FROM keystone.baseline_activities ba
    WHERE ba.baseline_id = bl1.id AND (ba.activity_id = a.id OR ba.activity_code = a.code)
    ORDER BY (ba.activity_id = a.id) DESC NULLS LAST
    LIMIT 1
  ) bla ON true
  LEFT JOIN keystone.project_controls pc ON pc.project_id = m.project_id
  LEFT JOIN LATERAL (
    SELECT make_date((floor(v.x)::int + 1200) / 12 + 1926, (floor(v.x)::int + 1200) % 12 + 1, 1) AS d0,
           floor((v.x - floor(v.x)) * 30 + 0.5)::int AS day
    FROM (SELECT pc.start_month + m.baseline_month AS x) v
  ) bm ON true
  LEFT JOIN LATERAL (
    SELECT make_date((floor(v.x)::int + 1200) / 12 + 1926, (floor(v.x)::int + 1200) % 12 + 1, 1) AS d0,
           floor((v.x - floor(v.x)) * 30 + 0.5)::int AS day
    FROM (SELECT pc.start_month + m.forecast_month AS x) v
  ) fm ON true
  WHERE m.project_id = p.id AND m.capex_milestone_code = j.jalon_code
) cm ON true;
COMMENT ON VIEW keystone.pub_jalons_projets IS 'Contrat R-189 v1 : une ligne par projet et jalon CAPEX (commande, fin_etudes, fat, expedition, arrivee_site, sat, pv_reception, fin_garantie) ; reel_le null tant que le jalon n''est pas atteint ; reference_le = date BL1 du jalon du planning portant ce code (milestones.capex_milestone_code), null sans BL1 ni jalon codé ; R-158 : expedition = premier enlèvement réel des expéditions, arrivee_site = dernière arrivée réelle une fois toutes les expéditions envoyées arrivées (ETD / ETA en date prévue à défaut d''autre source). Lecteurs : arche_app, matrix_app.';

-- Avancement physique et SPI : calculés par Keystone (valeur acquise à la date de situation) et tenus dans
-- share_project_progress par la tâche planifiée share-progress (nuls avant son premier passage) ; le reste est lu en direct.
CREATE OR REPLACE VIEW keystone.pub_avancement_projets WITH (security_barrier) AS
SELECT p.code              AS projet_code,
       sp.situation_on     AS date_situation,
       sp.progress_pct     AS avancement_physique_pct,
       sp.spi,
       coalesce((SELECT max(coalesce(a.finish_date, a.early_finish_date)) FROM keystone.activities a WHERE a.project_id = p.id),
                p.planned_finish_date) AS fin_prevue_le,
       CASE WHEN c.id IS NOT NULL THEN round(c.base_amount_keur * fx.rate, 3) ELSE bp.contract_value_keur END AS montant_contrat_keur,
       CASE WHEN c.id IS NOT NULL THEN round(coalesce(av.signed, 0) * fx.rate, 3) END AS montant_avenants_keur,
       CASE WHEN c.id IS NOT NULL OR bp.project_id IS NOT NULL THEN round(coalesce(inv.amount, 0) + coalesce(lg.amount, 0), 3) END AS facture_keur,
       greatest(p.updated_at, sp.updated_at, c.updated_at, bp.updated_at, av.changed, inv.changed, lg.changed) AS maj_le
FROM keystone.projects p
LEFT JOIN keystone.share_project_progress sp ON sp.project_id = p.id
LEFT JOIN keystone.contracts c               ON c.project_id = p.id
LEFT JOIN keystone.billing_plans bp          ON bp.project_id = p.id
CROSS JOIN LATERAL (
  SELECT CASE WHEN coalesce(c.currency, 'EUR') = 'EUR' THEN 1::numeric
              WHEN c.currency = p.currency AND p.budget_rate > 0 THEN p.budget_rate
              ELSE 1::numeric END AS rate
) fx
CROSS JOIN LATERAL (
  SELECT sum(am.amount_keur) FILTER (WHERE am.status = 'signed') AS signed, max(am.updated_at) AS changed
  FROM keystone.contract_amendments am WHERE am.contract_id = c.id
) av
CROSS JOIN LATERAL (
  SELECT sum(ci.amount_keur * CASE WHEN coalesce(ci.currency, 'EUR') = 'EUR' THEN 1::numeric
                                   WHEN ci.currency = p.currency AND p.budget_rate > 0 THEN p.budget_rate
                                   ELSE 1::numeric END) AS amount,
         max(ci.created_at) AS changed
  FROM keystone.customer_invoices ci JOIN keystone.payment_milestones pm ON pm.id = ci.payment_milestone_id
  WHERE pm.project_id = p.id
) inv
CROSS JOIN LATERAL (
  SELECT sum(pm.amount_keur) FILTER (WHERE pm.status <> 'planned') AS amount, max(pm.updated_at) AS changed
  FROM keystone.payment_milestones pm WHERE pm.project_id = p.id AND pm.contract_id IS NULL
) lg;
COMMENT ON VIEW keystone.pub_avancement_projets IS 'Contrat R-189 v1 : situation courante de chaque projet, côté vente seulement (aucun coût interne, taux, coût réel, CPI, EAC ni marge — P-05 / AC-2) ; montants en k€. Avancement et SPI : table share_project_progress, rafraîchie par la tâche share-progress. Lecteurs : arche_app, matrix_app.';

-- Avenants envoyés au client (les brouillons restent internes) : proposé jusqu'à signature, refusé quand la demande de
-- modification qui le porte a été rejetée. Numéro = rang dans le contrat (AV-01…) ; délai = jours de la demande.
CREATE OR REPLACE VIEW keystone.pub_avenants WITH (security_barrier) AS
SELECT p.code              AS projet_code,
       'AV-' || lpad((a.position + 1)::text, 2, '0') AS numero,
       a.subject           AS objet,
       round(a.amount_keur * CASE WHEN coalesce(c.currency, 'EUR') = 'EUR' THEN 1::numeric
                                  WHEN c.currency = p.currency AND p.budget_rate > 0 THEN p.budget_rate
                                  ELSE 1::numeric END, 3) AS montant_keur,
       cr.schedule_days    AS delai_jours,
       CASE WHEN a.status = 'signed' THEN 'signe'
            WHEN cr.status = 'rejected' THEN 'refuse'
            ELSE 'propose' END AS statut,
       a.signed_on         AS signe_le,
       greatest(a.updated_at, cr.updated_at) AS maj_le
FROM keystone.contract_amendments a
JOIN keystone.contracts c             ON c.id = a.contract_id
JOIN keystone.projects p              ON p.id = c.project_id
LEFT JOIN keystone.change_requests cr ON cr.id = a.change_request_id
WHERE a.status <> 'draft';
COMMENT ON VIEW keystone.pub_avenants IS 'Contrat R-189 v1 : avenants au contrat envoyés au client (brouillons exclus), montant en k€. Lecteurs : arche_app, matrix_app.';

-- Réserves : une liste par projet (R-117). Le numéro de NC, le nom du responsable et la description restent dans
-- Keystone. ouverte_le = jour (heure de Paris) de la saisie : Keystone ne garde pas d'autre date d'ouverture.
CREATE OR REPLACE VIEW keystone.pub_reserves WITH (security_barrier) AS
SELECT p.code              AS projet_code,
       pi.number           AS numero,
       pi.category         AS categorie,
       pi.register         AS origine,
       pi.status           AS statut,
       pi.owner_party      AS responsable,
       (pi.created_at AT TIME ZONE 'Europe/Paris')::date AS ouverte_le,
       pi.closed_on        AS levee_le,
       pi.updated_at       AS maj_le
FROM keystone.punch_items pi
JOIN keystone.projects p ON p.id = pi.project_id;
COMMENT ON VIEW keystone.pub_reserves IS 'Contrat R-189 v1 : réserves (liste unique du projet) — catégorie A/B/C, origine itp/site, statut open/in_progress/closed, responsable client/keystone. Lecteurs : arche_app, matrix_app.';

-- R-186 · Catalogue machines publié aux filiales (Arche K-01) ─────────────
-- Une ligne par fiche et version publiée ou retirée, jamais les brouillons. Une version publiée est figée par le
-- déclencheur machine_catalogue_entries_frozen (contrôlé en tête de fichier). type_code = code du type de machine
-- (comme pub_parc_machines.type_machine_code) ; maj_le = machine_catalogue_entries.updated_at (index K-11).
CREATE OR REPLACE VIEW keystone.pub_catalogue_machines WITH (security_barrier) AS
SELECT e.code,
       e.version,
       e.machine_type_code                  AS type_code,
       coalesce(mt.name, mt.label)          AS type_libelle,
       e.variant                            AS variante,
       e.label                              AS libelle,
       e.description,
       e.options,
       e.nominal_capacity                   AS capacite_nominale,
       e.capacity_unit                      AS unite_capacite,
       e.indicative_price_keur              AS prix_indicatif_keur,
       e.lead_time_weeks                    AS delai_type_semaines,
       CASE e.status WHEN 'published' THEN 'publie' ELSE 'retire' END AS statut,
       e.updated_at                         AS maj_le
FROM keystone.machine_catalogue_entries e
JOIN keystone.machine_types mt ON mt.code = e.machine_type_code
WHERE e.status IN ('published', 'retired');
COMMENT ON VIEW keystone.pub_catalogue_machines IS 'Contrat K-01 v1 (R-186) : catalogue machines publié aux filiales, une ligne par fiche et version (publiées et retirées ; jamais les brouillons) ; une version publiée est figée, la publication d''une nouvelle version retire la précédente. Lecteurs : arche_app.';

-- R-187 · Réponses aux besoins machines des filiales (Arche K-02, K-03, K-10) ──
-- Une ligne par réponse ; la plus récente (repondu_le, puis numero) fait foi. Fourchette calculée d'après la classe à
-- l'écriture et gardée (E50 ±50 %, E30 ±30 %, E10 −5 / +10 %) : une réponse publiée ne bouge plus. projet_code : projet
-- EPC2i créé (ou complété) à la commande, nul avant. maj_le = need_answers.updated_at (index K-11).
CREATE OR REPLACE VIEW keystone.pub_reponses_besoins WITH (security_barrier) AS
SELECT a.need_ref                   AS besoin_ref,
       a.capex_code,
       a.number                     AS numero,
       a.nature,
       a.qualification,
       a.reason                     AS motif,
       a.estimate_class             AS classe_estimation,
       a.central_keur               AS montant_central_keur,
       a.low_keur                   AS montant_bas_keur,
       a.high_keur                  AS montant_haut_keur,
       a.lead_time_weeks            AS delai_semaines,
       a.valid_until                AS valide_jusqu_au,
       a.document_ref,
       p.code                       AS projet_code,
       a.status                     AS statut,
       a.answered_at                AS repondu_le,
       a.updated_at                 AS maj_le
FROM keystone.need_answers a
LEFT JOIN keystone.projects p ON p.id = a.project_id;
COMMENT ON VIEW keystone.pub_reponses_besoins IS 'Contrat K-02 v1 (R-187) : réponses d''EPC2i aux besoins machines des filiales, une ligne par réponse, la plus récente (repondu_le, puis numero) fait foi ; classe d''estimation et fourchette (K-03, offre ferme = E10) ; projet EPC2i créé à la commande (K-10). Lecteurs : arche_app.';

-- D22 · Leçons apprises des projets ──────────────────────────────────────
-- Contrat commun du REX de Matrix (15 colonnes, mêmes que arche.pub_rex_v2), réunies par matrix.rex_unifie (96). Seules
-- les leçons validées ou appliquées sont publiées. titre = numéro et début du constat (80 caractères au plus, espaces
-- réduits) ; categorie = code du thème ; statut = code du statut. Donnée personnelle : le nom de l'auteur seulement.
CREATE OR REPLACE VIEW keystone.pub_rex WITH (security_barrier) AS
SELECT 'lessons_learned:' || l.id::text AS ref_source,
       'keystone'::text                 AS outil,
       p.code                           AS projet_code,
       p.capex_code,
       l.number                         AS numero,
       l.theme                          AS categorie,
       l.number || ' · ' || CASE
         WHEN char_length(regexp_replace(btrim(l.what_happened), '\s+', ' ', 'g')) <= 80 THEN regexp_replace(btrim(l.what_happened), '\s+', ' ', 'g')
         ELSE left(regexp_replace(btrim(l.what_happened), '\s+', ' ', 'g'), 79) || '…'
       END                              AS titre,
       l.what_happened                  AS constat,
       l.impact,
       l.recommendation                 AS recommandation,
       l.applies_to                     AS portee,
       l.status                         AS statut,
       l.raised_by_name                 AS auteur,
       l.created_at                     AS cree_le,
       l.updated_at                     AS maj_le
FROM keystone.lessons_learned l
JOIN keystone.projects p ON p.id = l.project_id
WHERE l.status IN ('validated', 'applied');
COMMENT ON VIEW keystone.pub_rex IS 'Contrat commun du REX de Matrix (D22) : leçons apprises des projets EPC2i, validées ou appliquées (une leçon proposée n''est pas publiée), mêmes colonnes que arche.pub_rex_v2. Lecteurs : matrix_app.';

-- R-191 · Part EPC2i du pack ingénierie (Arche K-08) ──────────────────────
-- Une ligne par projet et famille (pid, bom, layout, electrique, analyse_fonctionnelle), pour le critère G2 d'Arche (pack
-- au-dessus du seuil). Règles de src/domain/engineering-pack.ts de Keystone : familles pesées par les types des lignes
-- d'équipement du projet ; pièces attendues = documents de l'index Codex rattachés à la famille par leur type.
CREATE OR REPLACE VIEW keystone.pub_pack_ingenierie WITH (security_barrier) AS
WITH lines AS (
  SELECT e.project_id, e.machine_type_code, e.position, e.updated_at
  FROM keystone.project_equipments e
  UNION ALL
  SELECT p.id, p.machine_type_code, -1, p.updated_at
  FROM keystone.projects p
  WHERE p.machine_type_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM keystone.project_equipments e WHERE e.project_id = p.id)
),
weighed AS (
  SELECT l.project_id, f.family, f.weight, f.min_expected, greatest(f.updated_at, l.updated_at) AS updated_at,
         row_number() OVER (PARTITION BY l.project_id, f.family ORDER BY l.position) AS rank_in_project
  FROM lines l
  JOIN keystone.machine_type_pack_families f ON f.machine_type_code = l.machine_type_code AND f.weight > 0
),
standard AS (
  SELECT project_id, family, max(weight) FILTER (WHERE rank_in_project = 1) AS weight, max(min_expected) AS min_expected,
         max(updated_at) AS updated_at
  FROM weighed
  GROUP BY project_id, family
),
docs AS (
  SELECT d.project_id, t.pack_family AS family,
         count(*) FILTER (WHERE d.status <> 'obsolete') AS indexed,
         count(*) FILTER (WHERE d.status = 'released') AS released,
         max(d.updated_at) AS updated_at
  FROM keystone.documents d
  JOIN keystone.document_types t ON t.code = d.type_code
  WHERE d.project_id IS NOT NULL AND t.pack_family IS NOT NULL
  GROUP BY d.project_id, t.pack_family
),
fam AS (
  SELECT s.project_id, s.family, s.weight,
         greatest(s.min_expected, coalesce(dc.indexed, 0))::int AS expected,
         coalesce(dc.released, 0)::int AS validated,
         greatest(s.updated_at, dc.updated_at) AS updated_at
  FROM standard s
  LEFT JOIN docs dc ON dc.project_id = s.project_id AND dc.family = s.family
)
SELECT p.code                                AS projet_code,
       r.family                              AS famille,
       r.expected                            AS attendues,
       r.validated                           AS validees,
       r.weight::numeric                     AS poids,
       coalesce(round(100 * sum(CASE WHEN r.expected > 0 THEN r.weight * r.validated::numeric / r.expected END) OVER w
                      / nullif(sum(CASE WHEN r.expected > 0 THEN r.weight END) OVER w, 0), 1), 0)::numeric AS pct_pondere,
       greatest(p.updated_at, max(r.updated_at) OVER w) AS maj_le
FROM fam r
JOIN keystone.projects p ON p.id = r.project_id
WINDOW w AS (PARTITION BY r.project_id);
COMMENT ON VIEW keystone.pub_pack_ingenierie IS 'Contrat K-08 v1 (R-191) : part EPC2i du pack ingénierie, une ligne par projet et famille (pid, bom, layout, electrique, analyse_fonctionnelle) ; pièces attendues (documents de l''index Codex rattachés à la famille par leur type, hors obsolètes, au moins le minimum de la liste type) et validées (diffusées BPE), poids de la famille et % pondéré du projet (même valeur sur chaque ligne ; cible G2 > 80 %). Liste type provisoire (5 familles × 20 %) en attendant le point C-9. Lecteurs : arche_app.';

-- R-158 · Expéditions vers le site (Arche, décision 6 du 25/10/2026 : la filiale suit les expéditions dans Arche) ───────
-- Une ligne par expédition : ni valeur, ni prix, ni transitaire (tiers externe, ses coordonnées restent dans Keystone).
-- Incoterm et lieu du contrat lus en direct ; nb_reserves_ouvertes = réserves levées à la réception et non closes ;
-- maj_le = shipments.updated_at (index shipments_updated_at_idx, K-11).
CREATE OR REPLACE VIEW keystone.pub_expeditions WITH (security_barrier) AS
SELECT p.code              AS projet_code,
       s.ref               AS expedition_ref,
       (SELECT string_agg(pe.ref || ' · ' || CASE WHEN pe.quantity > 1 THEN pe.quantity::text || ' × ' ELSE '' END || pe.machine_type_code, ', ' ORDER BY pe.position, pe.ref)
          FROM keystone.shipment_equipments se JOIN keystone.project_equipments pe ON pe.id = se.equipment_id
         WHERE se.shipment_id = s.id) AS equipements,
       s.status            AS statut,
       s.mode,
       i.code              AS incoterm,
       c.incoterm_place    AS incoterm_lieu,
       s.origin            AS origine,
       s.destination,
       s.etd,
       s.eta,
       s.atd               AS depart_reel_le,
       s.ata               AS arrivee_reelle_le,
       s.received_on       AS receptionnee_le,
       (SELECT count(*)::int FROM keystone.shipment_loads sl WHERE sl.shipment_id = s.id) AS nb_chargements,
       (SELECT count(*)::int FROM keystone.shipment_punch_items sp JOIN keystone.punch_items pi ON pi.id = sp.punch_item_id
         WHERE sp.shipment_id = s.id AND pi.status <> 'closed') AS nb_reserves_ouvertes,
       s.updated_at        AS maj_le
FROM keystone.shipments s
JOIN keystone.projects p          ON p.id = s.project_id
LEFT JOIN keystone.contracts c    ON c.project_id = p.id
LEFT JOIN keystone.incoterms i    ON i.id = c.incoterm_id;
COMMENT ON VIEW keystone.pub_expeditions IS 'Contrat R-158 v1 : une ligne par expédition du matériel EPC2i vers le site — équipements, statut (draft, prepared, picked_up, in_transit, arrived, received, closed), mode, Incoterm et lieu du contrat, origine, destination, ETD / ETA, départ et arrivée réels, réception sur site, nombre de chargements et de réserves ouvertes ; aucune valeur, aucun prix, aucun contact du transitaire. Lecteurs : arche_app.';

-- D18 · Journal ──────────────────────────────────────────────────────────
-- Colonnes communes aux quatre pub_journal (même ordre, mêmes types), réunies par matrix.journal_unifie.
CREATE OR REPLACE VIEW keystone.pub_journal WITH (security_barrier) AS
SELECT 'audit_entries:' || a.id::text AS ref_source,  -- Matrix : ligne d'origine
       'audit'::text           AS nature,             -- Matrix : filtre (audit par défaut, activite reprend en partie l'audit)
       a.occurred_at           AS quand,              -- Matrix : tri, période
       a.actor_name            AS qui,                -- Matrix : nom affiché
       a.actor_person_id::text AS qui_ref,            -- Matrix : identifiant local (uuid persons)
       NULL::text              AS qui_role,           -- Matrix : sans objet chez Keystone
       a.area                  AS action,             -- Matrix : domaine fonctionnel (pas un verbe)
       a.object_ref            AS objet,              -- Matrix : objet visé
       a.change                AS detail,             -- Matrix : détail
       p.code                  AS projet,             -- Matrix : filtre par projet
       pe.matricule            AS qui_matricule       -- Matrix : rapprochement des auteurs entre outils (D01)
FROM keystone.audit_entries a
LEFT JOIN keystone.projects p ON p.id = a.project_id
LEFT JOIN keystone.persons pe ON pe.id = a.actor_person_id
UNION ALL
SELECT 'activity_events:' || e.id::text, 'activite', e.occurred_at, e.actor_name, e.actor_person_id::text, NULL,
       'activity.' || e.kind, NULL, e.text, p.code, pe.matricule
FROM keystone.activity_events e
LEFT JOIN keystone.projects p ON p.id = e.project_id
LEFT JOIN keystone.persons pe ON pe.id = e.actor_person_id;
COMMENT ON VIEW keystone.pub_journal IS 'Contrat D18 v1 : journal d''audit et fil d''activité de Keystone aux colonnes communes. Lecteur : matrix_app (matrix.journal_unifie).';
