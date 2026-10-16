-- Partage des données EPC2I, fichier 95 : journal unifié de Matrix (D18 option A).
--
-- Chaque outil garde son journal et publie une vue pub_journal aux colonnes communes (fichiers 20 à 50).
-- Matrix les réunit ici, en lecture seule, pour l'écran « Journal » de l'administration (docs/proposition.md).
-- C'est la seule vue du partage qui lit d'autres schémas. Elle n'est pas une vue pub_ : aucun outil ne la lit.
-- Exécution : en tant que matrix_app, après 90-droits.sql (qui accorde les quatre pub_journal à matrix_app).
--   psql "postgres://matrix_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/95-matrix-journal-unifie.sql
-- Rejouable. Données personnelles (noms des auteurs) : écran réservé à l'administrateur des données ; durée de
-- conservation à fixer.

\set ON_ERROR_STOP on

CREATE OR REPLACE VIEW matrix.journal_unifie AS
SELECT 'keystone'::text AS outil, quand, qui, qui_ref, qui_role, action, objet, detail, projet, nature, ref_source, qui_matricule
FROM keystone.pub_journal
UNION ALL
SELECT 'codex', quand, qui, qui_ref, qui_role, action, objet, detail, projet, nature, ref_source, qui_matricule
FROM codex.pub_journal
UNION ALL
SELECT 'cursus', quand, qui, qui_ref, qui_role, action, objet, detail, projet, nature, ref_source, qui_matricule
FROM cursus.pub_journal
UNION ALL
SELECT 'vigie', quand, qui, qui_ref, qui_role, action, objet, detail, projet, nature, ref_source, qui_matricule
FROM vigie.pub_journal;
COMMENT ON VIEW matrix.journal_unifie IS 'D18 : union des quatre pub_journal (outil, quand, qui, qui_ref, qui_role, action, objet, detail, projet, nature, ref_source, qui_matricule). Pagination par (quand, ref_source). action n''a pas le même sens partout (verbe chez Codex et Cursus, domaine chez Keystone). Lecteur : matrix_app seulement.';
