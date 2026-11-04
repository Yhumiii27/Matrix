-- Partage des données EPC2I, fichier 17 : glossaire métier et règles de qualité des données, saisis par la DSI dans
-- Matrix (décision M-04 du 04/11/2026 : « DSI seule » ; écarts E-08 et E-09).
--
--   - matrix.glossaire : un terme métier par ligne (définition, synonymes, domaine, propriétaire, colonnes des outils
--     qui le portent, sous la forme outil.table.colonne). Un terme retiré passe à actif = false, sa ligne reste.
--   - matrix.regles_qualite : une règle de qualité par ligne, au format de data/regles-qualite.json (contrôlé par
--     Matrix, outils/qualite.mjs). Une règle retirée passe à actif = false. Au premier démarrage qui trouve la table
--     vide, Matrix y reprend data/regles-qualite.json ; ensuite la table fait foi.
-- maj_le sert de version : une modification préparée sur une version dépassée est refusée (outils/saisies-pg.mjs).
-- Chaque modification est écrite dans matrix.journal (fichier 15), dans la même transaction.
-- Exécution : en tant que matrix_app, après 15-matrix-edition.sql :
--   psql "postgres://matrix_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/17-matrix-glossaire-qualite.sql
-- Rejouable.

\set ON_ERROR_STOP on
\pset pager off

CREATE TABLE IF NOT EXISTS matrix.glossaire (
  id            text        NOT NULL,
  terme         text        NOT NULL,
  definition    text        NOT NULL,
  synonymes     text[]      NOT NULL DEFAULT '{}',
  domaine       text,
  proprietaire  text,
  colonnes      text[]      NOT NULL DEFAULT '{}',
  actif         boolean     NOT NULL DEFAULT true,
  maj_le        timestamptz NOT NULL DEFAULT now(),
  maj_par       text        NOT NULL,
  CONSTRAINT glossaire_pkey PRIMARY KEY (id),
  CONSTRAINT glossaire_id_check CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  CONSTRAINT glossaire_textes_check CHECK (btrim(terme) <> '' AND length(terme) <= 120 AND btrim(definition) <> '' AND length(definition) <= 4000
                                           AND coalesce(length(domaine), 0) <= 80 AND coalesce(length(proprietaire), 0) <= 120),
  CONSTRAINT glossaire_colonnes_check CHECK (array_to_string(colonnes, ' ') ~ '^((keystone|codex|cursus|vigie|arche|crucible)\.[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*( |$))*$'),
  CONSTRAINT glossaire_synonymes_check CHECK (cardinality(synonymes) <= 20)
);
COMMENT ON TABLE matrix.glossaire IS 'Glossaire métier tenu par la DSI dans Matrix (M-04, E-08) : terme, définition, synonymes, colonnes des outils qui le portent (outil.table.colonne) ; maj_le sert de version.';
CREATE INDEX IF NOT EXISTS glossaire_colonnes_idx ON matrix.glossaire USING gin (colonnes);

CREATE TABLE IF NOT EXISTS matrix.regles_qualite (
  id       text        NOT NULL,
  regle    jsonb       NOT NULL,
  actif    boolean     NOT NULL DEFAULT true,
  maj_le   timestamptz NOT NULL DEFAULT now(),
  maj_par  text        NOT NULL,
  CONSTRAINT regles_qualite_pkey PRIMARY KEY (id),
  CONSTRAINT regles_qualite_id_check CHECK (id ~ '^Q[0-9]{2,3}$' AND regle ->> 'id' = id),
  CONSTRAINT regles_qualite_regle_check CHECK (jsonb_typeof(regle) = 'object')
);
COMMENT ON TABLE matrix.regles_qualite IS 'Règles de qualité des données tenues par la DSI dans Matrix (M-04, E-09), au format de data/regles-qualite.json ; exécutées par la sonde en lecture seule ; maj_le sert de version.';

\echo 'Glossaire et règles de qualité : matrix.glossaire et matrix.regles_qualite en place.'
