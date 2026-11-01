-- Partage des données EPC2I, fichier 14 : reprise par Matrix des vues pub_ créées par les outils (décision M-18).
--
-- Pour chaque vue pub_ des outils choisis qui appartient encore à l'outil (créée par une de ses migrations) :
--   1. la vue passe à matrix_gestion (ALTER VIEW … OWNER TO) : ses lecteurs gardent leur droit, PostgreSQL le
--      réattribue au nouveau propriétaire ; la définition ne change pas ;
--   2. elle est inscrite dans matrix.publications (mode « sql », origine « reprise », état « appliquee ») avec sa
--      définition, ses noms de tables qualifiés, et son contrat (colonnes, types, ordre) ; une vue déjà inscrite garde
--      sa ligne.
-- Ensuite, Matrix seul la modifie (CREATE OR REPLACE VIEW par matrix_gestion).
--
-- À ne lancer pour un outil qu'une fois qu'il ne crée plus de vue pub_ dans ses migrations (demande M-18 de son
-- REQUESTS.md) : une migration qui recrée une vue reprise échouerait (« must be owner of view »).
--
-- Exécution : en superutilisateur, après init/03-droits.sql et 13-matrix-publications.sql, avec la liste des outils
-- repris (ou « tous ») :
--   psql -h <hôte> -U postgres -d epc2i -v ON_ERROR_STOP=1 -v outils=keystone,codex -1 -f partage/14-reprise-publications.sql
-- Rejouable : une vue déjà reprise n'est plus touchée.

\set ON_ERROR_STOP on
\pset pager off

\if :{?outils}
\else
  \echo 'Indiquez les outils repris : -v outils=keystone,codex (ou -v outils=tous).'
  \quit 3
\endif

SELECT set_config('matrix.reprise_outils', :'outils', false);

DO $$
DECLARE
  v_liste text[] := string_to_array(replace(current_setting('matrix.reprise_outils'), ' ', ''), ',');
  v_tous constant text[] := ARRAY['keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible'];
  v record;
  v_def text;
  v_n int := 0;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Lancez ce script avec un superutilisateur (par exemple postgres), pas avec %.', current_user;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'matrix_gestion') THEN
    RAISE EXCEPTION 'Rôle matrix_gestion absent : rejouez init/01-base-et-roles.sql puis init/03-droits.sql.';
  END IF;
  IF to_regclass('matrix.publications') IS NULL THEN
    RAISE EXCEPTION 'Registre matrix.publications absent : jouez d''abord partage/13-matrix-publications.sql (rôle matrix_app).';
  END IF;
  IF v_liste = ARRAY['tous'] THEN
    v_liste := v_tous;
  END IF;
  IF NOT v_liste <@ v_tous THEN
    RAISE EXCEPTION 'Outils inconnus : % (attendus : %, ou tous).', array_to_string(ARRAY(SELECT unnest(v_liste) EXCEPT SELECT unnest(v_tous)), ', '), array_to_string(v_tous, ', ');
  END IF;
  -- Définitions écrites avec leurs schémas (aucun nom ne dépend du search_path de la session).
  PERFORM set_config('search_path', '', true);
  FOR v IN
    SELECT c.oid, n.nspname, c.relname, c.relowner = n.nspowner AS a_reprendre
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ANY (v_liste) AND c.relkind = 'v' AND c.relname LIKE 'pub\_%'
    ORDER BY 2, 3
  LOOP
    IF v.a_reprendre THEN
      EXECUTE format('ALTER VIEW %I.%I OWNER TO matrix_gestion', v.nspname, v.relname);
      v_n := v_n + 1;
    END IF;
    v_def := rtrim(btrim(pg_get_viewdef(v.oid, true)), ';');
    INSERT INTO matrix.publications (vue, outil, mode, definition, description, contrat, etat, origine, modifie_par, applique_par, applique_le)
    SELECT v.nspname || '.' || v.relname, v.nspname, 'sql', v_def, obj_description(v.oid, 'pg_class'),
           (SELECT jsonb_agg(jsonb_build_object('nom', a.attname, 'type', format_type(a.atttypid, a.atttypmod)) ORDER BY a.attnum)
              FROM pg_attribute a WHERE a.attrelid = v.oid AND a.attnum > 0 AND NOT a.attisdropped),
           'appliquee', 'reprise', 'reprise (partage/14)', 'reprise (partage/14)', now()
    ON CONFLICT (vue) DO NOTHING;
  END LOOP;
  RAISE NOTICE 'Reprise : % vue(s) passée(s) à matrix_gestion pour %.', v_n, array_to_string(v_liste, ', ');
END $$;

-- Contrôle : plus aucune vue pub_ des outils repris n'appartient à l'outil.
SELECT n.nspname || '.' || c.relname AS vue_non_reprise
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = ANY (string_to_array(replace(replace(:'outils', ' ', ''), 'tous', 'keystone,codex,cursus,vigie,arche,crucible'), ','))
  AND c.relkind = 'v' AND c.relname LIKE 'pub\_%' AND c.relowner = n.nspowner;

\echo 'Reprise des publications terminée : les vues reprises se gèrent dans Matrix (écran Publications).'
