-- Partage des données EPC2I, fichier 30 : contrôle des prérequis des vues publiées par Keystone (schéma keystone).
--
-- Lot M17-3 (02/11/2026, décisions M-17 et M-18 de Matrix) : ce fichier ne recopie plus les vues pub_ de Keystone. Il
-- contrôle seulement que le schéma keystone porte les migrations, tables, colonnes et index dont elles dépendent.
-- D'où viennent les vues (22 vues : pub_projets, pub_chantiers, pub_affectations, pub_taches_jours, pub_fournisseurs, pub_clients, pub_articles, pub_nomenclatures, pub_parc_machines, pub_activites, pub_livrables, pub_jalons, pub_jalons_projets, pub_avancement_projets, pub_avenants, pub_reserves, pub_catalogue_machines, pub_reponses_besoins, pub_rex, pub_pack_ingenierie, pub_expeditions, pub_journal) :
--   - jusqu'à la reprise de Keystone par Matrix, de ses propres migrations (elles existent sur le serveur dès que l'outil
--     a migré) ;
--   - ensuite, du registre des publications de Matrix (matrix.publications, écran « Publications ») : Matrix les reprend
--     (14-reprise-publications.sql), les définit et les applique (rôle matrix_gestion) ; Keystone n'en crée plus.
-- Les anciennes copies sont dans l'historique git (dernière version : commit 8d4c228, avant le lot M17-3).
-- Un échec ici signale une migration de Keystone manquante : la lancer, puis rejouer ce fichier et 90-droits.sql.
-- Exécution : en tant que keystone_app (ou en superutilisateur), avant 90-droits.sql :
--   psql "postgres://keystone_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/30-keystone.sql
-- Rejouable : rien n'est créé ni modifié une fois les migrations de Keystone passées.

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

-- ═══ Prérequis : migrations 0034 à 0064 de Keystone ═══
-- Une colonne, une table ou un déclencheur absent signale une migration
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

\echo 'Partage de Keystone : prérequis présents ; vues pub_ : migrations de Keystone jusqu''à la reprise, registre des publications de Matrix ensuite.'
