-- Partage des données EPC2I, fichier 50 : contrôle des prérequis des vues publiées par Vigie (schéma vigie).
--
-- Lot M17-3 (02/11/2026, décisions M-17 et M-18 de Matrix) : ce fichier ne recopie plus les vues pub_ de Vigie. Il
-- contrôle seulement que le schéma vigie porte les migrations, tables, colonnes et index dont elles dépendent.
-- D'où viennent les vues (pub_non_conformites, pub_hse_projet, pub_journal, pub_controles) :
--   - jusqu'à la reprise de Vigie par Matrix, de ses propres migrations (elles existent sur le serveur dès que l'outil
--     a migré) ;
--   - ensuite, du registre des publications de Matrix (matrix.publications, écran « Publications ») : Matrix les reprend
--     (14-reprise-publications.sql), les définit et les applique (rôle matrix_gestion) ; Vigie n'en crée plus.
-- Les anciennes copies sont dans l'historique git (dernière version : commit 8d4c228, avant le lot M17-3).
-- Un échec ici signale une migration de Vigie manquante : la lancer, puis rejouer ce fichier et 90-droits.sql.
-- Exécution : en tant que vigie_app (ou en superutilisateur), avant 90-droits.sql :
--   psql "postgres://vigie_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/50-vigie.sql
-- Rejouable : rien n'est créé ni modifié une fois les migrations de Vigie passées.

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

-- ═══ Prérequis : migrations 0008, 0009 et 0014 de Vigie ═══
-- Une colonne absente signale une migration de Vigie non passée.
DO $$
DECLARE
  v_manque text;
BEGIN
  SELECT string_agg(x.t || '.' || x.c, ', ') INTO v_manque
  FROM (VALUES ('events', 'keystone_project_code'), ('events', 'nc_number'), ('events', 'keystone_activity_code'),
               ('events', 'part_ref'), ('events', 'keystone_deliverable_number'), ('events', 'supplier_id'),
               ('events', 'supplier_name'), ('events', 'root_cause'), ('events', 'nc_cost_keur'), ('events', 'iso_clause'),
               ('prevention_plans', 'keystone_project_code'), ('permits', 'keystone_project_code'),
               ('people', 'matricule'), ('people', 'last_role'), ('change_log', 'summary'),
               ('controls', 'equipment_code')) AS x(t, c)
  WHERE NOT EXISTS (SELECT FROM information_schema.columns ic
                    WHERE ic.table_schema = 'vigie' AND ic.table_name = x.t AND ic.column_name = x.c);
  IF v_manque IS NOT NULL THEN
    RAISE EXCEPTION 'Colonnes absentes du schéma vigie (%) : démarrez Vigie sur le serveur pour qu''il passe ses migrations (0008_partage_prerequis, 0009_partage, 0014_controls_share), puis rejouez ce fichier.', v_manque;
  END IF;
END $$;

\echo 'Partage de Vigie : prérequis présents ; vues pub_ : migrations de Vigie jusqu''à la reprise, registre des publications de Matrix ensuite.'
