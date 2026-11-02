-- Partage des données EPC2I, fichier 40 : contrôle des prérequis des vues publiées par Codex (schéma codex).
--
-- Lot M17-3 (02/11/2026, décisions M-17 et M-18 de Matrix) : ce fichier ne recopie plus les vues pub_ de Codex. Il
-- contrôle seulement que le schéma codex porte les migrations, tables, colonnes et index dont elles dépendent, et pose les prérequis encore manquants (IF NOT EXISTS, sans effet une fois la migration passée).
-- D'où viennent les vues (pub_documents, pub_revisions_document, pub_validations, pub_types_document, pub_circuits_type, pub_titulaires_fonction, pub_programmes_recherche, pub_journal) :
--   - jusqu'à la reprise de Codex par Matrix, de ses propres migrations (elles existent sur le serveur dès que l'outil
--     a migré) ;
--   - ensuite, du registre des publications de Matrix (matrix.publications, écran « Publications ») : Matrix les reprend
--     (14-reprise-publications.sql), les définit et les applique (rôle matrix_gestion) ; Codex n'en crée plus.
-- Les anciennes copies sont dans l'historique git (dernière version : commit 8d4c228, avant le lot M17-3).
-- Un échec ici signale une migration de Codex manquante : la lancer, puis rejouer ce fichier et 90-droits.sql.
-- Exécution : en tant que codex_app (ou en superutilisateur), avant 90-droits.sql :
--   psql "postgres://codex_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/40-codex.sql
-- Rejouable : rien n'est créé ni modifié une fois les migrations de Codex passées.

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

-- ═══ Prérequis : colonnes à ajouter (à reporter dans les migrations de l'outil) ═══
-- Destination : src/db/schema.ts puis une migration drizzle/00xx. ADD COLUMN IF NOT EXISTS : sans effet si la
-- colonne existe déjà ; la contrainte écrite dans la définition de colonne suit le même sort.

-- D10 : champs des documents maîtrisés de Vigie, repris dans Codex.
ALTER TABLE codex.documents ADD COLUMN IF NOT EXISTS distribution text NOT NULL DEFAULT '';  -- Vigie : liste de diffusion (DocumentPanel.tsx:151)
ALTER TABLE codex.documents
  ADD COLUMN IF NOT EXISTS review_months integer                                          -- Vigie : périodicité de revue (documents.ts:118)
    CONSTRAINT documents_review_months_check CHECK (review_months > 0);
ALTER TABLE codex.documents ADD COLUMN IF NOT EXISTS process_code text;                    -- Vigie : processus ISO 9001 (filtre « Processus »)

-- D01 : matricule Cursus d'un utilisateur ; nul pour les comptes système (keystone, vigie…).
ALTER TABLE codex.users
  ADD COLUMN IF NOT EXISTS matricule text
    CONSTRAINT users_matricule_unique UNIQUE
    CONSTRAINT users_matricule_check CHECK (matricule IS NULL OR (matricule ~ '^EMP-[0-9]{4,}$' AND NOT is_system));

-- D15 : departments devient un cache de matrix.pub_organigramme (niveau departement) ; une unité fermée reste
-- (clé documents.department), marquée inactive.
ALTER TABLE codex.departments ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- D18 : index de pub_journal.
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON codex.audit_log (at);

-- Non traités ici : D01 suppression de users.title ; users.name, initials, department et site restent comme
-- cache de cursus.pub_salaries et matrix.pub_organigramme (clés users.department et users.site inchangées, contrôle
-- « confidentiel » de access.ts:80) ; D12 codex.change_requests reste un miroir de vigie.pub_demandes_modification.

\echo 'Partage de Codex : prérequis présents ; vues pub_ : migrations de Codex jusqu''à la reprise, registre des publications de Matrix ensuite.'
