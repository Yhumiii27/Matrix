-- Partage des données EPC2I, fichier 96 : REX unifié de Matrix (D22 option A).
--
-- Keystone garde les leçons apprises des projets, Arche le REX des CAPEX ; chacun publie une vue au contrat commun du
-- REX (docs/architecture-postgres.md, § 8 quater) : keystone.pub_rex (demande « Matrix → Keystone — Publier les leçons
-- apprises des projets », pas encore publiée au 23/10/2026) et arche.pub_rex_v2 (migration 0016_share_rex_v2 d'Arche ;
-- arche.pub_rex, v1, n'est plus lue). Matrix les réunit ici, en lecture seule, sur le modèle du journal unifié (95).
-- Contrat commun, dans cet ordre : ref_source text, outil text, projet_code text, capex_code text, numero text,
-- categorie text, titre text, constat text, impact text, recommandation text, portee text, statut text, auteur text,
-- cree_le timestamptz, maj_le timestamptz. Les colonnes propres à un outil (Arche : phase) suivent et ne sont pas lues.
-- Une vue dont les 15 premières colonnes s'écartent du contrat fait échouer ce fichier.
-- Elle n'est pas une vue pub_ : aucun outil ne la lit.
-- Exécution : en tant que matrix_app, après 90-droits.sql (qui accorde les vues REX à matrix_app).
--   psql "postgres://matrix_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/96-matrix-rex-unifie.sql
-- Une vue absente ou non accordée (Keystone tant qu'il ne publie pas pub_rex) est laissée de côté avec un WARNING ;
-- si aucune n'est lisible, rien n'est créé (WARNING). Rejouer ce fichier après chaque publication et 90-droits.sql.
-- Rejouable. Données personnelles : le nom de l'auteur seulement, comme le journal unifié.

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

DO $rex$
DECLARE
  v_vue text;
  v_branches text[] := '{}';
  v_absentes text[] := '{}';
  v_mauvaises text[] := '{}';
  v_colonnes_communes constant text := 'ref_source, outil, projet_code, capex_code, numero, categorie, titre, constat, '
                                       'impact, recommandation, portee, statut, auteur, cree_le, maj_le';
  v_attendu constant text := 'ref_source:text,outil:text,projet_code:text,capex_code:text,numero:text,categorie:text,'
                             'titre:text,constat:text,impact:text,recommandation:text,portee:text,statut:text,'
                             'auteur:text,cree_le:timestamp with time zone,maj_le:timestamp with time zone';
  v_colonnes text;
BEGIN
  FOREACH v_vue IN ARRAY ARRAY['keystone.pub_rex', 'arche.pub_rex_v2'] LOOP
    IF to_regclass(v_vue) IS NULL OR NOT has_table_privilege(v_vue, 'SELECT') THEN
      v_absentes := v_absentes || v_vue;
      CONTINUE;
    END IF;
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum) INTO v_colonnes
    FROM pg_attribute a
    WHERE a.attrelid = v_vue::regclass AND a.attnum BETWEEN 1 AND 15 AND NOT a.attisdropped;
    IF v_colonnes IS DISTINCT FROM v_attendu THEN
      v_mauvaises := v_mauvaises || format('%s (%s)', v_vue, v_colonnes);
      CONTINUE;
    END IF;
    v_branches := v_branches || format('SELECT %s FROM %s', v_colonnes_communes, v_vue);
  END LOOP;
  IF cardinality(v_mauvaises) > 0 THEN
    RAISE EXCEPTION 'Vue REX hors du contrat commun (%) : %', v_attendu, array_to_string(v_mauvaises, ' ; ');
  END IF;
  IF cardinality(v_absentes) > 0 THEN
    RAISE WARNING 'matrix.rex_unifie sans % (vue absente ou non accordée) : rejouez ce fichier après sa publication et 90-droits.sql.',
      array_to_string(v_absentes, ', ');
  END IF;
  IF cardinality(v_branches) = 0 THEN
    RAISE WARNING 'Aucune vue REX lisible par % : matrix.rex_unifie n''est pas créée.', current_user;
    RETURN;
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW matrix.rex_unifie AS ' || array_to_string(v_branches, ' UNION ALL ');
  EXECUTE $c$COMMENT ON VIEW matrix.rex_unifie IS 'D22 : union des vues REX au contrat commun (keystone.pub_rex, arche.pub_rex_v2), 15 colonnes ; outil distingue la source. Lecteur : matrix_app seulement.'$c$;
  RAISE NOTICE 'matrix.rex_unifie : %.', array_to_string(ARRAY(SELECT x FROM unnest(ARRAY['keystone.pub_rex', 'arche.pub_rex_v2']) AS x
                                                              WHERE NOT x = ANY (v_absentes)), ', ');
END $rex$;
