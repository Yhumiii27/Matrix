-- Partage des données EPC2I, fichier 12 : registre des liens entre outils, administré par Matrix.
--
-- Un lien est le droit d'un outil (lecteur) de lire la vue pub_ d'un autre outil. Matrix les administre (décision du
-- 24/10/2026 : « Matrix doit devenir un outil de type dataverse, il administre toutes les tables et autorise ou non
-- les liens » ; choix « registre + application contrôlée ») :
--   - matrix.liens : un lien par couple (vue, lecteur), statut autorise | refuse | demande ; écrit par l'écran
--     « Liens » de Matrix (rôle matrix_app, propriétaire du schéma), amorcé par 90-droits.sql avec la convention
--     de partage (origine « convention ») ;
--   - matrix.liens_journal : chaque création ou changement de statut, en ajout seul (déclencheurs) ;
--   - 90-droits.sql applique le registre : GRANT pour chaque lien autorisé, REVOKE de tout droit SELECT d'un outil
--     sur une vue pub_ qui n'est pas autorisé (lien refusé, demandé ou absent du registre).
-- Matrix ne pose aucun droit lui-même : matrix_app n'a aucun droit d'administration. Une décision prise dans Matrix
-- prend effet au passage suivant de 90-droits.sql (administrateur ou tâche planifiée).
-- Exécution : en tant que matrix_app, avant 90-droits.sql :
--   psql "postgres://matrix_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/12-matrix-liens.sql
-- Rejouable.

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

CREATE TABLE IF NOT EXISTS matrix.liens (
  vue          text        NOT NULL,
  lecteur      text        NOT NULL,
  statut       text        NOT NULL,
  origine      text        NOT NULL DEFAULT 'matrix',
  motif        text,
  demande_par  text,
  demande_le   timestamptz,
  decide_par   text,
  decide_le    timestamptz,
  modifie_le   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT liens_pkey PRIMARY KEY (vue, lecteur),
  CONSTRAINT liens_vue_check CHECK (vue ~ '^(keystone|codex|cursus|vigie|arche|crucible|matrix)\.pub_[a-z0-9_]+$'),
  CONSTRAINT liens_lecteur_check CHECK (lecteur IN ('keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app', 'crucible_app', 'matrix_app')),
  -- Un outil lit ses propres vues sans lien.
  CONSTRAINT liens_autre_outil_check CHECK (split_part(vue, '.', 1) || '_app' <> lecteur),
  CONSTRAINT liens_statut_check CHECK (statut IN ('autorise', 'refuse', 'demande')),
  CONSTRAINT liens_origine_check CHECK (origine IN ('convention', 'matrix')),
  CONSTRAINT liens_decision_check CHECK (statut = 'demande' OR decide_le IS NOT NULL)
);
-- Nature d'un lien (M-18, lot P4) : lecture d'une vue pub_, ou exécution d'une fonction pub_ (écriture chez un autre
-- outil par une fonction que le propriétaire fournit, docs/architecture-postgres.md § 8 sexies, règle R4).
ALTER TABLE matrix.liens ADD COLUMN IF NOT EXISTS nature text NOT NULL DEFAULT 'lecture';
ALTER TABLE matrix.liens DROP CONSTRAINT IF EXISTS liens_nature_check;
ALTER TABLE matrix.liens ADD CONSTRAINT liens_nature_check CHECK (nature IN ('lecture', 'execution'));
COMMENT ON COLUMN matrix.liens.nature IS 'lecture : SELECT sur la vue pub_ (colonne vue) ; execution : EXECUTE sur la fonction pub_ du même nom (écriture chez l''outil propriétaire, par ses règles).';
COMMENT ON TABLE matrix.liens IS 'Registre des liens entre outils (lecture d''une vue pub_ par un autre outil), administré par Matrix ; appliqué par partage/90-droits.sql (GRANT des liens autorisés, REVOKE des autres).';
COMMENT ON COLUMN matrix.liens.origine IS 'convention : lien de la convention de partage, inscrit par 90-droits.sql ; matrix : lien demandé ou décidé dans Matrix.';

CREATE TABLE IF NOT EXISTS matrix.liens_journal (
  id       bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vue      text        NOT NULL,
  lecteur  text        NOT NULL,
  avant    text,
  apres    text        NOT NULL,
  motif    text,
  par      text,
  le       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE matrix.liens_journal IS 'Journal des décisions sur les liens (ajout seul) : création, autorisation, refus, demande.';

-- Journal : après l'écriture (une insertion qui se change en mise à jour, ON CONFLICT, ne compte qu'une fois).
CREATE OR REPLACE FUNCTION matrix.liens_journaliser() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.statut IS DISTINCT FROM OLD.statut OR NEW.motif IS DISTINCT FROM OLD.motif THEN
    INSERT INTO matrix.liens_journal (vue, lecteur, avant, apres, motif, par)
    VALUES (NEW.vue, NEW.lecteur, CASE WHEN TG_OP = 'UPDATE' THEN OLD.statut END, NEW.statut, NEW.motif,
            coalesce(NEW.decide_par, NEW.demande_par, session_user));
  END IF;
  RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION matrix.liens_horodater() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.modifie_le := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS liens_journal ON matrix.liens;
CREATE OR REPLACE TRIGGER liens_horodatage BEFORE UPDATE ON matrix.liens
  FOR EACH ROW EXECUTE FUNCTION matrix.liens_horodater();
CREATE OR REPLACE TRIGGER liens_journalisation AFTER INSERT OR UPDATE ON matrix.liens
  FOR EACH ROW EXECUTE FUNCTION matrix.liens_journaliser();

-- Un lien ne se supprime pas : il se refuse (la décision reste au journal).
CREATE OR REPLACE FUNCTION matrix.liens_interdire() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% interdit sur % : refusez le lien plutôt que de le supprimer, le journal ne se modifie pas.', TG_OP, TG_TABLE_NAME;
END $$;
CREATE OR REPLACE TRIGGER liens_sans_suppression BEFORE DELETE ON matrix.liens
  FOR EACH ROW EXECUTE FUNCTION matrix.liens_interdire();
CREATE OR REPLACE TRIGGER liens_journal_ajout_seul BEFORE UPDATE OR DELETE ON matrix.liens_journal
  FOR EACH ROW EXECUTE FUNCTION matrix.liens_interdire();

\echo 'Registre des liens : matrix.liens et matrix.liens_journal en place.'
