-- Partage des données EPC2I, fichier 70 : contrôle des prérequis des vues publiées par Arche (schéma arche).
--
-- Lot M17-3 (02/11/2026, décisions M-17 et M-18 de Matrix) : ce fichier ne recopie plus les vues pub_ d'Arche. Il
-- contrôle seulement que le schéma arche porte les migrations, tables, colonnes et index dont elles dépendent.
-- D'où viennent les vues (pub_journal, pub_capex, pub_besoins_machines, pub_rampup, pub_rex, pub_rex_v2) :
--   - jusqu'à la reprise d'Arche par Matrix, de ses propres migrations (elles existent sur le serveur dès que l'outil
--     a migré) ;
--   - ensuite, du registre des publications de Matrix (matrix.publications, écran « Publications ») : Matrix les reprend
--     (14-reprise-publications.sql), les définit et les applique (rôle matrix_gestion) ; Arche n'en crée plus.
-- Les anciennes copies sont dans l'historique git (dernière version : commit 8d4c228, avant le lot M17-3).
-- Un échec ici signale une migration d'Arche manquante : la lancer, puis rejouer ce fichier et 90-droits.sql.
-- Exécution : en tant que arche_app (ou en superutilisateur), avant 90-droits.sql :
--   psql "postgres://arche_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/70-arche.sql
-- Rejouable : rien n'est créé ni modifié une fois les migrations d'Arche passées.

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

\echo 'Partage d''Arche : prérequis présents ; vues pub_ : migrations d''Arche jusqu''à la reprise, registre des publications de Matrix ensuite.'
