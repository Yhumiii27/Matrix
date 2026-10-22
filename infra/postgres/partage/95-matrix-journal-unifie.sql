-- Partage des données EPC2I, fichier 95 : journal unifié de Matrix (D18 option A).
--
-- Chaque outil garde son journal et publie une vue pub_journal aux colonnes communes : Keystone (migration
-- 0035_share, audit_entries et activity_events), Codex (migration 0001_partage, audit_log), Vigie (migration
-- 0009_partage, change_log), Cursus (20-cursus.sql, journal). Matrix les réunit ici, en lecture seule, pour l'écran
-- « Journal » de l'administration (docs/proposition.md).
-- Contrat commun des quatre pub_journal, dans cet ordre : ref_source text, nature text, quand timestamptz, qui text,
-- qui_ref text, qui_role text, action text, objet text, detail text, projet text, qui_matricule text (vérifié le
-- 18/10/2026 sur les vues de Keystone, Codex et Vigie). Une pub_journal qui s'en écarte fait échouer ce fichier.
-- C'est la seule vue du partage qui lit d'autres schémas. Elle n'est pas une vue pub_ : aucun outil ne la lit.
-- Exécution : en tant que matrix_app, après 90-droits.sql (qui accorde les pub_journal à matrix_app).
--   psql "postgres://matrix_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/95-matrix-journal-unifie.sql
-- Les outils pas encore basculés (pub_journal absente ou non accordée, par exemple Cursus) sont laissés de côté avec
-- un WARNING : rejouer ce fichier après leur bascule et 90-droits.sql. Rejouable. Données personnelles (noms des
-- auteurs) : écran réservé à l'administrateur des données ; durée de conservation à fixer.

\set ON_ERROR_STOP on

DO $journal$
DECLARE
  v_outil text;
  v_branches text[] := '{}';
  v_absents text[] := '{}';
  v_mauvais text[] := '{}';
  v_attendu text := 'ref_source:text,nature:text,quand:timestamp with time zone,qui:text,qui_ref:text,qui_role:text,'
                    'action:text,objet:text,detail:text,projet:text,qui_matricule:text';
  v_colonnes text;
BEGIN
  FOREACH v_outil IN ARRAY ARRAY['keystone', 'codex', 'cursus', 'vigie', 'arche'] LOOP
    IF to_regclass(format('%I.pub_journal', v_outil)) IS NULL
       OR NOT has_table_privilege(format('%I.pub_journal', v_outil), 'SELECT') THEN
      v_absents := v_absents || v_outil;
      CONTINUE;
    END IF;
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum) INTO v_colonnes
    FROM pg_attribute a
    WHERE a.attrelid = format('%I.pub_journal', v_outil)::regclass AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_colonnes <> v_attendu THEN
      v_mauvais := v_mauvais || format('%s.pub_journal (%s)', v_outil, v_colonnes);
      CONTINUE;
    END IF;
    v_branches := v_branches || format(
      'SELECT %L::text AS outil, quand, qui, qui_ref, qui_role, action, objet, detail, projet, nature, ref_source, qui_matricule FROM %I.pub_journal',
      v_outil, v_outil);
  END LOOP;
  IF cardinality(v_mauvais) > 0 THEN
    RAISE EXCEPTION 'pub_journal hors du contrat commun (%) : %', v_attendu, array_to_string(v_mauvais, ' ; ');
  END IF;
  IF cardinality(v_branches) = 0 THEN
    RAISE EXCEPTION 'Aucune pub_journal lisible par % : jouez d''abord les migrations des outils et 90-droits.sql.', current_user;
  END IF;
  IF cardinality(v_absents) > 0 THEN
    RAISE WARNING 'matrix.journal_unifie sans % (pub_journal absente ou non accordée) : rejouez ce fichier après la bascule de l''outil et 90-droits.sql.',
      array_to_string(v_absents, ', ');
  END IF;
  -- Un outil ajouté ou retiré change le nombre de branches, pas les colonnes : CREATE OR REPLACE suffit.
  EXECUTE 'CREATE OR REPLACE VIEW matrix.journal_unifie AS ' || array_to_string(v_branches, ' UNION ALL ');
  RAISE NOTICE 'matrix.journal_unifie : %.', array_to_string(ARRAY(SELECT x FROM unnest(ARRAY['keystone', 'codex', 'cursus', 'vigie', 'arche']) AS x
                                                                  WHERE NOT x = ANY (v_absents)), ', ');
END $journal$;

COMMENT ON VIEW matrix.journal_unifie IS 'D18 : union des pub_journal des outils basculés (outil, quand, qui, qui_ref, qui_role, action, objet, detail, projet, nature, ref_source, qui_matricule). Pagination par (quand, ref_source). action n''a pas le même sens partout (verbe chez Codex et Cursus, domaine chez Keystone, entité.action chez Vigie). Lecteur : matrix_app seulement.';
