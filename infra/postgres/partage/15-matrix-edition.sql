-- Partage des données EPC2I, fichier 15 : ce que le service informatique saisit dans Matrix, sur le serveur commun
-- (écart E-04, docs/proposition.md § 6).
--
-- Jusqu'ici, la documentation des tables, les décisions sur les doublons et le journal des modifications vivaient dans
-- le fichier <MATRIX_DATA_DIR>/edition.json. Avec le serveur commun, ils vivent ici, et edition.json n'en est plus que
-- la copie locale (repli sans serveur) :
--   - matrix.documentation : une fiche par table (outil.table), avec sa version (maj_le) ;
--   - matrix.decisions_doublons : l'option retenue pour chaque groupe de doublons ;
--   - matrix.journal : chaque modification faite dans Matrix (documentation, décision, référentiel), en ajout seul.
-- Verrouillage (outils/edition-pg.mjs) : chaque modification se fait dans une transaction qui verrouille la ligne
-- (SELECT … FOR UPDATE) et écrit son entrée de journal ; une modification préparée sur une version dépassée (maj_le ou
-- option changée entre-temps par quelqu'un d'autre) est refusée au lieu d'écraser la précédente.
-- Exécution : en tant que matrix_app, après 12-matrix-liens.sql :
--   psql "postgres://matrix_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/15-matrix-edition.sql
-- Rejouable. Au premier démarrage qui trouve ces tables vides, Matrix y reprend le contenu d'edition.json.

\set ON_ERROR_STOP on
\pset pager off

CREATE TABLE IF NOT EXISTS matrix.documentation (
  cle          text        NOT NULL,
  description  text,
  domaine      text,
  responsable  text,
  note         text,
  maj_le       timestamptz NOT NULL DEFAULT now(),
  maj_par      text        NOT NULL,
  CONSTRAINT documentation_pkey PRIMARY KEY (cle),
  CONSTRAINT documentation_cle_check CHECK (cle ~ '^(keystone|codex|cursus|vigie|arche|crucible)\.[A-Za-z0-9_]+$'),
  CONSTRAINT documentation_longueurs_check CHECK (coalesce(length(description), 0) <= 2000 AND coalesce(length(domaine), 0) <= 80
                                                  AND coalesce(length(responsable), 0) <= 120 AND coalesce(length(note), 0) <= 4000)
);
COMMENT ON TABLE matrix.documentation IS 'Documentation des tables saisie dans Matrix (E-04) : description, domaine, responsable, note ; maj_le sert de version (une modification préparée sur une version dépassée est refusée).';

CREATE TABLE IF NOT EXISTS matrix.decisions_doublons (
  groupe   text        NOT NULL,
  option   text        NOT NULL,
  le       timestamptz NOT NULL DEFAULT now(),
  par      text        NOT NULL,
  CONSTRAINT decisions_doublons_pkey PRIMARY KEY (groupe),
  CONSTRAINT decisions_doublons_groupe_check CHECK (groupe ~ '^D[0-9]{2,3}$')
);
COMMENT ON TABLE matrix.decisions_doublons IS 'Décisions sur les groupes de doublons prises dans Matrix (E-04, data/doublons.json) : une option par groupe ; une décision retirée est supprimée, le journal la garde.';

CREATE TABLE IF NOT EXISTS matrix.journal (
  id      bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quand   timestamptz NOT NULL DEFAULT now(),
  qui     text        NOT NULL,
  action  text        NOT NULL,
  objet   text        NOT NULL,
  detail  text        NOT NULL DEFAULT ''
);
COMMENT ON TABLE matrix.journal IS 'Journal des modifications faites dans Matrix (E-04) : documentation, décisions, référentiels ; ajout seul. Distinct de matrix.journal_unifie (journaux des outils, D18).';
CREATE INDEX IF NOT EXISTS journal_quand_idx ON matrix.journal (quand);

-- Le journal ne se modifie ni ne s'efface (liens_interdire vient du fichier 12).
DROP TRIGGER IF EXISTS journal_ajout_seul ON matrix.journal;
CREATE TRIGGER journal_ajout_seul BEFORE UPDATE OR DELETE ON matrix.journal
  FOR EACH ROW EXECUTE FUNCTION matrix.liens_interdire();

\echo 'Saisies de Matrix : matrix.documentation, matrix.decisions_doublons et matrix.journal en place.'
