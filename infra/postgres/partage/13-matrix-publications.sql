-- Partage des données EPC2I, fichier 13 : registre des publications, administré par Matrix (décision M-18).
--
-- Une publication est une vue pub_ d'un outil : ce que l'outil donne à lire aux autres. Depuis M-18 (01/11/2026),
-- Matrix la définit (écran « Publications ») et l'applique lui-même, par le rôle matrix_gestion, propriétaire des vues
-- pub_ des six outils (init/03-droits.sql). Les outils n'en écrivent plus dans leurs migrations.
--   - matrix.publications : une ligne par vue pub_ (schéma.vue), avec sa définition, son contrat (colonnes, types,
--     ordre) et son état ; une vue retirée garde sa ligne (état « retiree »), jamais supprimée ;
--   - matrix.publications_journal : chaque reprise, modification, application, erreur ou retrait, en ajout seul.
-- Écrit par matrix_app (brouillons de l'écran) et par matrix_gestion (application) ; amorcé par
-- 14-reprise-publications.sql (vues existantes reprises, origine « reprise »).
-- Exécution : en tant que matrix_app, après 12-matrix-liens.sql :
--   psql "postgres://matrix_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/13-matrix-publications.sql
-- Rejouable.

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

CREATE TABLE IF NOT EXISTS matrix.publications (
  vue          text        NOT NULL,
  outil        text        NOT NULL,
  mode         text        NOT NULL DEFAULT 'sql',
  source       text,
  colonnes     jsonb,
  filtre       text,
  definition   text        NOT NULL,
  description  text,
  contrat      jsonb,
  etat         text        NOT NULL DEFAULT 'brouillon',
  erreur       text,
  origine      text        NOT NULL DEFAULT 'matrix',
  modifie_par  text,
  modifie_le   timestamptz NOT NULL DEFAULT now(),
  applique_par text,
  applique_le  timestamptz,
  CONSTRAINT publications_pkey PRIMARY KEY (vue),
  CONSTRAINT publications_vue_check CHECK (vue ~ '^(keystone|codex|cursus|vigie|arche|crucible)\.pub_[a-z0-9_]+$'),
  CONSTRAINT publications_outil_check CHECK (outil = split_part(vue, '.', 1)),
  CONSTRAINT publications_mode_check CHECK (mode IN ('colonnes', 'sql')),
  -- Mode « colonnes » : une table de l'outil, des colonnes choisies ([{ "colonne": …, "nom": … }]), un filtre facultatif.
  CONSTRAINT publications_colonnes_check CHECK (mode = 'sql' OR (source ~ '^[a-z_]+\.[a-z0-9_]+$' AND split_part(source, '.', 1) = outil
                                                               AND jsonb_typeof(colonnes) = 'array' AND jsonb_array_length(colonnes) > 0)),
  CONSTRAINT publications_contrat_check CHECK (contrat IS NULL OR jsonb_typeof(contrat) = 'array'),
  CONSTRAINT publications_etat_check CHECK (etat IN ('brouillon', 'appliquee', 'erreur', 'retiree')),
  CONSTRAINT publications_origine_check CHECK (origine IN ('reprise', 'matrix')),
  CONSTRAINT publications_application_check CHECK (etat <> 'appliquee' OR (applique_le IS NOT NULL AND contrat IS NOT NULL))
);
COMMENT ON TABLE matrix.publications IS 'Registre des publications (vues pub_ des outils), administré par Matrix (M-18) : définition, contrat et état ; appliqué par matrix_gestion.';
COMMENT ON COLUMN matrix.publications.definition IS 'Requête SELECT de la vue, noms de tables qualifiés par leur schéma. Mode colonnes : produite par Matrix à partir de source, colonnes et filtre.';
COMMENT ON COLUMN matrix.publications.contrat IS 'Colonnes de la vue appliquée, dans l''ordre : [{ "nom": …, "type": … }]. Une colonne ne s''y retire, ne s''y renomme ni ne change de type (PostgreSQL le refuse aussi) ; un changement incompatible se fait par une vue …_v2.';
COMMENT ON COLUMN matrix.publications.origine IS 'reprise : vue créée par une migration de l''outil, reprise par 14-reprise-publications.sql ; matrix : vue créée dans Matrix.';

CREATE TABLE IF NOT EXISTS matrix.publications_journal (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vue         text        NOT NULL,
  action      text        NOT NULL,
  etat        text,
  definition  text,
  contrat     jsonb,
  detail      text,
  par         text,
  le          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publications_journal_action_check CHECK (action IN ('reprise', 'creation', 'modification', 'application', 'erreur', 'retrait'))
);
COMMENT ON TABLE matrix.publications_journal IS 'Journal des publications (ajout seul) : reprise, création, modification, application, erreur, retrait, avec la définition et le contrat de chaque version.';

CREATE OR REPLACE FUNCTION matrix.publications_horodater() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.modifie_le := now();
  RETURN NEW;
END $$;

-- Journal : une entrée par création, changement de définition ou changement d'état.
CREATE OR REPLACE FUNCTION matrix.publications_journaliser() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := CASE NEW.origine WHEN 'reprise' THEN 'reprise' ELSE 'creation' END;
  ELSIF NEW.etat IS DISTINCT FROM OLD.etat OR (NEW.etat = 'appliquee' AND NEW.applique_le IS DISTINCT FROM OLD.applique_le) THEN
    v_action := CASE NEW.etat WHEN 'appliquee' THEN 'application' WHEN 'erreur' THEN 'erreur' WHEN 'retiree' THEN 'retrait' ELSE 'modification' END;
  ELSIF NEW.definition IS DISTINCT FROM OLD.definition OR NEW.description IS DISTINCT FROM OLD.description THEN
    v_action := 'modification';
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO matrix.publications_journal (vue, action, etat, definition, contrat, detail, par)
  VALUES (NEW.vue, v_action, NEW.etat, NEW.definition, NEW.contrat, NEW.erreur,
          coalesce(CASE WHEN v_action = 'application' THEN NEW.applique_par END, NEW.modifie_par, session_user));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS publications_horodatage ON matrix.publications;
CREATE TRIGGER publications_horodatage BEFORE UPDATE ON matrix.publications
  FOR EACH ROW EXECUTE FUNCTION matrix.publications_horodater();
DROP TRIGGER IF EXISTS publications_journalisation ON matrix.publications;
CREATE TRIGGER publications_journalisation AFTER INSERT OR UPDATE ON matrix.publications
  FOR EACH ROW EXECUTE FUNCTION matrix.publications_journaliser();

-- Une publication ne se supprime pas : elle se retire (le journal garde ses versions). liens_interdire vient du
-- fichier 12.
DROP TRIGGER IF EXISTS publications_sans_suppression ON matrix.publications;
CREATE TRIGGER publications_sans_suppression BEFORE DELETE ON matrix.publications
  FOR EACH ROW EXECUTE FUNCTION matrix.liens_interdire();
DROP TRIGGER IF EXISTS publications_journal_ajout_seul ON matrix.publications_journal;
CREATE TRIGGER publications_journal_ajout_seul BEFORE UPDATE OR DELETE ON matrix.publications_journal
  FOR EACH ROW EXECUTE FUNCTION matrix.liens_interdire();

-- matrix_gestion applique les publications et les liens : il lit les deux registres et enregistre ce qu'il a
-- appliqué. Rien d'autre dans le schéma matrix (droits.verifier() le contrôle).
GRANT USAGE ON SCHEMA matrix TO matrix_gestion;
GRANT SELECT ON matrix.liens TO matrix_gestion;
GRANT SELECT, INSERT, UPDATE ON matrix.publications TO matrix_gestion;
GRANT SELECT, INSERT ON matrix.publications_journal TO matrix_gestion;

\echo 'Registre des publications : matrix.publications et matrix.publications_journal en place.'
