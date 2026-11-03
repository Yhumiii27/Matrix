-- Partage des données EPC2I, fichier 16 : historique des schémas des outils, sur le serveur commun (écart E-04, suite).
--
-- Jusqu'ici, l'historique des schémas (tables et colonnes ajoutées, retirées ou modifiées, migrations appliquées,
-- changements hors migration : écart E-06) vivait dans <MATRIX_DATA_DIR>/historique.json. Avec le serveur commun, il vit
-- ici, et historique.json n'en est plus que la copie locale (repli sans serveur, lecture de la page) :
--   - matrix.historique_schemas : un événement par ligne, en ajout seul. L'événement entier est gardé dans `evenement`
--     (avant et après compris) ; quand, outil, type, table et colonne en sont extraits pour la recherche.
--   - `empreinte` (SHA-256 de l'événement, calculée par Matrix) rend l'envoi rejouable : un événement déjà enregistré
--     n'est pas dupliqué.
-- Alignement (outils/historique-pg.mjs) : à chaque lecture du serveur commun, Matrix envoie les événements de
-- historique.json absents de la table, puis réécrit historique.json d'après la table, qui fait foi.
-- Exécution : en tant que matrix_app, après 12-matrix-liens.sql :
--   psql "postgres://matrix_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/16-matrix-historique.sql
-- Rejouable. Au premier passage de Matrix qui trouve la table vide, tout historique.json y est repris.

\set ON_ERROR_STOP on
\pset pager off

CREATE TABLE IF NOT EXISTS matrix.historique_schemas (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quand       timestamptz NOT NULL,
  outil       text        NOT NULL,
  type        text        NOT NULL,
  nom_table   text,
  colonne     text,
  evenement   jsonb       NOT NULL,
  empreinte   text        NOT NULL,
  enregistre_le timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT historique_schemas_empreinte_key UNIQUE (empreinte),
  CONSTRAINT historique_schemas_outil_check CHECK (outil ~ '^[a-z][a-z0-9_]{0,40}$'),
  CONSTRAINT historique_schemas_type_check CHECK (type ~ '^[a-z][a-z0-9_]{0,60}$'),
  CONSTRAINT historique_schemas_empreinte_check CHECK (empreinte ~ '^[0-9a-f]{64}$'),
  CONSTRAINT historique_schemas_evenement_check CHECK (jsonb_typeof(evenement) = 'object')
);
COMMENT ON TABLE matrix.historique_schemas IS 'Historique des schémas des outils vu par Matrix (E-04, E-06) : un événement par ligne, en ajout seul ; evenement garde le détail (avant, après), empreinte évite les doublons.';
CREATE INDEX IF NOT EXISTS historique_schemas_quand_idx ON matrix.historique_schemas (quand, id);
CREATE INDEX IF NOT EXISTS historique_schemas_table_idx ON matrix.historique_schemas (outil, nom_table);

-- L'historique ne se modifie ni ne s'efface (liens_interdire vient du fichier 12).
DROP TRIGGER IF EXISTS historique_schemas_ajout_seul ON matrix.historique_schemas;
CREATE TRIGGER historique_schemas_ajout_seul BEFORE UPDATE OR DELETE ON matrix.historique_schemas
  FOR EACH ROW EXECUTE FUNCTION matrix.liens_interdire();

\echo 'Historique des schémas : matrix.historique_schemas en place.'
