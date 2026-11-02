-- Partage des données EPC2I, fichier 20 : contrôle des prérequis des vues publiées par Cursus (schéma cursus).
--
-- Lot M17-3 (02/11/2026, décisions M-17 et M-18 de Matrix) : ce fichier ne recopie plus les vues pub_ de Cursus. Il
-- contrôle seulement que le schéma cursus porte les migrations, tables, colonnes et index dont elles dépendent.
-- D'où viennent les vues (pub_journal, pub_parametres, pub_salaries, pub_titres, pub_titres_detenus) :
--   - jusqu'à la reprise de Cursus par Matrix, de ses propres migrations (elles existent sur le serveur dès que l'outil
--     a migré) ;
--   - ensuite, du registre des publications de Matrix (matrix.publications, écran « Publications ») : Matrix les reprend
--     (14-reprise-publications.sql), les définit et les applique (rôle matrix_gestion) ; Cursus n'en crée plus.
-- Les anciennes copies sont dans l'historique git (dernière version : commit 8d4c228, avant le lot M17-3).
-- Un échec ici signale une migration de Cursus manquante : la lancer, puis rejouer ce fichier et 90-droits.sql.
-- Exécution : en tant que cursus_app (ou en superutilisateur), avant 90-droits.sql :
--   psql "postgres://cursus_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/20-cursus.sql
-- Rejouable : rien n'est créé ni modifié une fois les migrations de Cursus passées.

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

-- ═══ Prérequis : migration 0002_partage de Cursus passée ═══
DO $prerequis$
BEGIN
  IF to_regclass('cursus.schema_migrations') IS NULL
     OR NOT EXISTS (SELECT FROM cursus.schema_migrations WHERE nom = '0002_partage') THEN
    RAISE EXCEPTION 'Cursus n''a pas encore appliqué sa migration 0002_partage sur ce serveur : démarrez Cursus avec DATABASE_URL (rôle cursus_app), puis rejouez ce fichier.';
  END IF;
END $prerequis$;

\echo 'Partage de Cursus : prérequis présents ; vues pub_ : migrations de Cursus jusqu''à la reprise, registre des publications de Matrix ensuite.'
