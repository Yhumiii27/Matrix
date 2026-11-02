-- Partage des données EPC2I, fichier 80 : contrôle des prérequis des vues publiées par Crucible (schéma crucible).
--
-- Lot M17-3 (02/11/2026, décisions M-17 et M-18 de Matrix) : ce fichier ne recopie plus les vues pub_ de Crucible. Il
-- contrôle seulement que le schéma crucible porte les migrations, tables, colonnes et index dont elles dépendent.
-- D'où viennent les vues (pub_journal, pub_moyens, pub_reservations, pub_occupation_hebdo) :
--   - jusqu'à la reprise de Crucible par Matrix, de ses propres migrations (elles existent sur le serveur dès que l'outil
--     a migré) ;
--   - ensuite, du registre des publications de Matrix (matrix.publications, écran « Publications ») : Matrix les reprend
--     (14-reprise-publications.sql), les définit et les applique (rôle matrix_gestion) ; Crucible n'en crée plus.
-- Les anciennes copies sont dans l'historique git (dernière version : commit 8d4c228, avant le lot M17-3).
-- Un échec ici signale une migration de Crucible manquante : la lancer, puis rejouer ce fichier et 90-droits.sql.
-- Exécution : en tant que crucible_app (ou en superutilisateur), avant 90-droits.sql :
--   psql "postgres://crucible_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/80-crucible.sql
-- Rejouable : rien n'est créé ni modifié une fois les migrations de Crucible passées.

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

\echo 'Partage de Crucible : prérequis présents ; vues pub_ : migrations de Crucible jusqu''à la reprise, registre des publications de Matrix ensuite.'
