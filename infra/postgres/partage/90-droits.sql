-- Partage des données EPC2I, fichier 90 : droits des lecteurs sur les vues pub_, et contrôle des vues.
--
-- Ce que fait le script, dans une seule transaction :
--   1. Contrôle des vues pub_ des cinq schémas. Il échoue, avant tout GRANT, si une vue pub_ :
--        - lit une colonne sensible (liste ci-dessous, plus droits.colonnes_sensibles quand elle est lisible) ;
--        - dépend d'une relation d'un autre schéma ;
--        - n'appartient pas au propriétaire de son schéma, ou s'exécute avec security_invoker.
--      Les colonnes source sont lues dans information_schema.view_column_usage en tant que propriétaire de chaque
--      schéma (SET ROLE) : cette vue d'information ne montre que les tables du rôle courant.
--   2. GRANT USAGE sur le schéma et GRANT SELECT sur la vue, pour chaque lecteur de chaque vue. Rien d'autre :
--      aucun droit sur une table, aucun REVOKE. Chaque GRANT est passé par le propriétaire du schéma (SET ROLE).
--      Chaque couple (vue, lecteur) est inscrit dans droits.partage_lecteurs : droits.verifier() signale ensuite
--      un lecteur qui a perdu son droit (restauration d'un schéma, DROP … CASCADE).
--   3. État des droits sur les vues pub_ (lecture seule), pour relecture.
--   4. Contrôle final par droits.verifier() (init/03-droits.sql), dans la même transaction : il accepte exactement
--      cette convention (USAGE sur le schéma du propriétaire, SELECT sur ses vues pub_) et refuse tout autre droit
--      croisé. Une erreur annule tout le fichier. Aucun réglage du socle n'est à faire à la main.
--
-- Lancement : superutilisateur (postgres) ou administrateur nominatif membre de matrix_admin (qui peut prendre
-- le rôle de chaque outil, SET ROLE). Après les migrations des outils (qui créent leurs vues pub_) et les fichiers
-- 10 à 50 (60 seulement une fois le module ECR / ECO de Vigie construit). Sans l'option -1 : le fichier ouvre
-- lui-même sa transaction.
--   psql -h <hôte> -U postgres -d epc2i -v ON_ERROR_STOP=1 -f partage/90-droits.sql
-- Rejouable : un GRANT déjà posé ne change rien ; une vue absente est signalée (WARNING) et passée.
--
-- Rappel : matrix_lecture n'est pas traité ici. Le déclencheur droits_ddl (init/03-droits.sql) lui donne déjà les
-- vues qui ne lisent aucune colonne sensible.

\set ON_ERROR_STOP on
\connect epc2i

BEGIN;

-- ── 0. Rôle d'exécution ──────────────────────────────────────────────────
DO $$
DECLARE
  v_manque text;
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RETURN;
  END IF;
  SELECT string_agg(r, ', ') INTO v_manque
  FROM unnest(ARRAY['keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'matrix_app']) AS r
  WHERE NOT pg_has_role(current_user, r, 'SET');
  IF v_manque IS NOT NULL THEN
    RAISE EXCEPTION 'Lancez 90-droits.sql en superutilisateur ou en administrateur membre de matrix_admin : % ne peut pas prendre le rôle %.', current_user, v_manque;
  END IF;
END $$;

-- ── 1. Contrôle des vues pub_ ────────────────────────────────────────────

-- 1.1 Colonnes source de chaque vue pub_, lues en tant que propriétaire de chaque schéma.
DO $controle$
DECLARE
  -- Convention du 15/10/2026 (« schéma.table.colonne », « .* » pour une table entière), données de santé de Vigie
  -- (HEALTH_LABELS, leurs copies dans change_log, registre des accidents bénins, journal des consultations, pièces
  -- jointes), plus les propositions de init/03-droits.sql qui peuvent copier des données de santé (journal.payload,
  -- journal.message, demandes_collab.label).
  v_sensibles text[] := ARRAY[
    'cursus.employes.visite', 'cursus.employes.passeport_numero', 'cursus.employes.passeport_expire',
    'cursus.employes.naissance', 'cursus.employes.reprise_motif', 'cursus.employes.reprise_date',
    'cursus.vaccinations.*', 'cursus.visas.*', 'cursus.entretiens.cr',
    'vigie.events.injury', 'vigie.events.lost_days', 'vigie.events.cpam_declared_on',
    'vigie.events.lesion_nature', 'vigie.events.lesion_site', 'vigie.events.care_given', 'vigie.events.reserves_on',
    'vigie.events.cpam_waived_at', 'vigie.events.cpam_waived_by_id', 'vigie.events.cpam_waiver_reason',
    'vigie.change_log.details', 'vigie.change_log.reason',
    'vigie.benign_accidents.*', 'vigie.access_log.*', 'vigie.attachments.*',
    'cursus.journal.payload', 'cursus.journal.message', 'cursus.demandes_collab.label'];
  v_liste text[];
  v_schema text;
  v_proprio text;
  v_lignes jsonb := '[]'::jsonb;
BEGIN
  -- La liste tenue par le serveur, quand le rôle courant peut la lire (superutilisateur, matrix_admin).
  IF EXISTS (SELECT FROM pg_namespace WHERE nspname = 'droits') AND has_schema_privilege('droits', 'USAGE')
     AND to_regclass('droits.colonnes_sensibles') IS NOT NULL
     AND has_table_privilege('droits.colonnes_sensibles', 'SELECT') THEN
    EXECUTE $q$SELECT array_agg(DISTINCT schema_nom || '.' || table_nom || '.' || colonne_nom) FROM droits.colonnes_sensibles$q$
      INTO v_liste;
    v_sensibles := v_sensibles || coalesce(v_liste, '{}'::text[]);
  ELSE
    RAISE NOTICE 'droits.colonnes_sensibles illisible par % : contrôle sur la liste de la convention seulement.', current_user;
  END IF;

  FOR v_schema, v_proprio IN
    SELECT n.nspname::text, pg_get_userbyid(n.nspowner)::text
    FROM pg_namespace n
    WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'matrix')
    ORDER BY 1
  LOOP
    EXECUTE format('SET ROLE %I', v_proprio);
    v_lignes := v_lignes || coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'vue', u.view_schema || '.' || u.view_name,
               'source', u.table_schema || '.' || u.table_name,
               'colonne', u.column_name,
               'sensible', (u.table_schema || '.' || u.table_name || '.' || u.column_name) = ANY (v_sensibles)
                           OR (u.table_schema || '.' || u.table_name || '.*') = ANY (v_sensibles))
             ORDER BY u.view_name, u.table_schema, u.table_name, u.column_name)
      FROM information_schema.view_column_usage u
      WHERE u.view_schema = v_schema AND u.view_name LIKE 'pub\_%'), '[]'::jsonb);
    EXECUTE 'RESET ROLE';
  END LOOP;
  PERFORM set_config('partage.colonnes_pub', v_lignes::text, true);
END $controle$;

-- 1.2 Liste : une ligne par vue pub_ et colonne source.
SELECT x.vue, x.source AS table_source, x.colonne, x.sensible
FROM jsonb_to_recordset(current_setting('partage.colonnes_pub')::jsonb) AS x(vue text, source text, colonne text, sensible boolean)
ORDER BY x.vue, x.source, x.colonne;

-- 1.3 Échec si une règle de la convention n'est pas tenue.
DO $$
DECLARE
  v_fautes text[] := '{}';
  v_nb integer;
BEGIN
  -- Colonne sensible lue par une vue pub_.
  v_fautes := v_fautes || ARRAY(
    SELECT format('%s lit la colonne sensible %s.%s', x.vue, x.source, x.colonne)
    FROM jsonb_to_recordset(current_setting('partage.colonnes_pub')::jsonb) AS x(vue text, source text, colonne text, sensible boolean)
    WHERE x.sensible
    ORDER BY 1);
  -- Dépendance vers un autre schéma (catalogue, lisible par tous).
  v_fautes := v_fautes || ARRAY(
    SELECT DISTINCT format('%s.%s dépend de %s.%s (autre schéma)', nv.nspname, v.relname, nt.nspname, t.relname)
    FROM pg_class v
    JOIN pg_namespace nv ON nv.oid = v.relnamespace
    JOIN pg_rewrite rw ON rw.ev_class = v.oid
    JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = rw.oid
                    AND d.refclassid = 'pg_class'::regclass AND d.refobjid <> v.oid
    JOIN pg_class t ON t.oid = d.refobjid AND t.relkind IN ('r', 'p', 'v', 'm', 'f')
    JOIN pg_namespace nt ON nt.oid = t.relnamespace
    WHERE nv.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'matrix')
      AND v.relkind = 'v' AND v.relname LIKE 'pub\_%' AND t.relnamespace <> v.relnamespace
    ORDER BY 1);
  -- Propriétaire différent de celui du schéma (une vue d'un superutilisateur lirait tout), ou security_invoker.
  v_fautes := v_fautes || ARRAY(
    SELECT format('%s.%s appartient à %s au lieu de %s', n.nspname, c.relname, pg_get_userbyid(c.relowner), pg_get_userbyid(n.nspowner))
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'matrix') AND c.relkind = 'v'
      AND c.relname LIKE 'pub\_%' AND c.relowner <> n.nspowner
    ORDER BY 1);
  v_fautes := v_fautes || ARRAY(
    SELECT format('%s.%s s''exécute avec security_invoker', n.nspname, c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'matrix') AND c.relkind = 'v'
      AND c.relname LIKE 'pub\_%'
      AND EXISTS (SELECT FROM unnest(c.reloptions) AS o(opt) WHERE lower(o.opt) IN ('security_invoker=true', 'security_invoker=on', 'security_invoker=1'))
    ORDER BY 1);
  IF cardinality(v_fautes) > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege',
      MESSAGE = format('Partage refusé, aucun droit posé (%s écart%s) : %s', cardinality(v_fautes),
                       CASE WHEN cardinality(v_fautes) > 1 THEN 's' ELSE '' END, array_to_string(v_fautes, ' ; '));
  END IF;
  SELECT count(DISTINCT x.vue) INTO v_nb
  FROM jsonb_to_recordset(current_setting('partage.colonnes_pub')::jsonb) AS x(vue text, source text, colonne text, sensible boolean);
  RAISE NOTICE 'Contrôle du partage : % vues pub_ conformes (aucune colonne sensible, aucune dépendance vers un autre schéma).', v_nb;
END $$;

-- ── 2. Droits des lecteurs ───────────────────────────────────────────────
-- Une ligne par vue : ses lecteurs. matrix_app lit toutes les vues des outils : contrôle d'orphelins et de
-- cohérence (lot 5 de docs/proposition.md) et matrix.journal_unifie (fichier 95).
DO $droits$
DECLARE
  r record;
  v_oid oid;
  v_schema text;
  v_proprio text;
  v_lecteurs text;
  v_absentes text[] := '{}';
  v_nb integer := 0;
  v_liste boolean := to_regclass('droits.partage_lecteurs') IS NOT NULL;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- Matrix : référentiels (D14, D15, D17) et correspondances.
      ('matrix.pub_pays',                    ARRAY['keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app']),
      ('matrix.pub_sites',                   ARRAY['keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app']),
      ('matrix.pub_organigramme',            ARRAY['keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app']),
      ('matrix.pub_correspondances',         ARRAY['keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app']),
      -- Cursus : personnes (D01), titres (D08, D09), paramètres (D19), journal (D18).
      ('cursus.pub_salaries',                ARRAY['keystone_app', 'codex_app', 'vigie_app', 'matrix_app']),
      ('cursus.pub_titres',                  ARRAY['keystone_app', 'vigie_app', 'matrix_app']),
      ('cursus.pub_titres_detenus',          ARRAY['keystone_app', 'vigie_app', 'matrix_app']),
      ('cursus.pub_parametres',              ARRAY['vigie_app', 'matrix_app']),
      ('cursus.pub_journal',                 ARRAY['matrix_app']),
      -- Keystone : projets (D02), chantiers (D03), affectations (D04), tâches (D05), tiers (D16),
      -- référentiels de Vigie (D12, D13), journal (D18).
      ('keystone.pub_projets',               ARRAY['codex_app', 'cursus_app', 'vigie_app', 'arche_app', 'matrix_app']),
      ('keystone.pub_chantiers',             ARRAY['cursus_app', 'matrix_app']),
      ('keystone.pub_affectations',          ARRAY['cursus_app', 'vigie_app', 'matrix_app']),
      ('keystone.pub_taches_jours',          ARRAY['cursus_app', 'matrix_app']),
      ('keystone.pub_fournisseurs',          ARRAY['vigie_app', 'matrix_app']),
      ('keystone.pub_clients',               ARRAY['codex_app', 'cursus_app', 'vigie_app', 'arche_app', 'matrix_app']),
      ('keystone.pub_articles',              ARRAY['vigie_app', 'matrix_app']),
      ('keystone.pub_nomenclatures',         ARRAY['vigie_app', 'matrix_app']),
      ('keystone.pub_parc_machines',         ARRAY['vigie_app', 'arche_app', 'matrix_app']),
      ('keystone.pub_activites',             ARRAY['vigie_app', 'matrix_app']),
      ('keystone.pub_livrables',             ARRAY['vigie_app', 'arche_app', 'matrix_app']),
      ('keystone.pub_journal',               ARRAY['matrix_app']),
      -- Codex : documents (D10), registre (D11), journal (D18).
      ('codex.pub_documents',                ARRAY['keystone_app', 'vigie_app', 'matrix_app']),
      ('codex.pub_revisions_document',       ARRAY['keystone_app', 'vigie_app', 'matrix_app']),
      ('codex.pub_validations',              ARRAY['keystone_app', 'vigie_app', 'matrix_app']),
      ('codex.pub_types_document',           ARRAY['keystone_app', 'vigie_app', 'matrix_app']),
      ('codex.pub_circuits_type',            ARRAY['keystone_app', 'matrix_app']),
      ('codex.pub_titulaires_fonction',      ARRAY['keystone_app', 'matrix_app']),
      ('codex.pub_journal',                  ARRAY['matrix_app']),
      -- Vigie : NC et HSE de projet (D13), journal (D18), ECR et ECO (D12).
      ('vigie.pub_non_conformites',          ARRAY['keystone_app', 'matrix_app']),
      ('vigie.pub_hse_projet',               ARRAY['keystone_app', 'matrix_app']),
      ('vigie.pub_journal',                  ARRAY['matrix_app']),
      -- ECR et ECO : vues de 60-vigie-ecr-eco.sql, absentes tant que le module n'existe pas dans Vigie (WARNING).
      ('vigie.pub_ordres_modification',      ARRAY['keystone_app', 'matrix_app']),
      ('vigie.pub_eco_approbations',         ARRAY['keystone_app', 'matrix_app']),
      ('vigie.pub_eco_effectivite',          ARRAY['keystone_app', 'matrix_app']),
      ('vigie.pub_demandes_modification',    ARRAY['codex_app', 'keystone_app', 'matrix_app']),
      -- Keystone, vues demandées par Arche (R-186 à R-191), absentes tant que Keystone ne les publie pas (WARNING).
      ('keystone.pub_catalogue_machines',    ARRAY['arche_app', 'matrix_app']),
      ('keystone.pub_reponses_besoins',      ARRAY['arche_app', 'matrix_app']),
      ('keystone.pub_jalons_projets',        ARRAY['arche_app', 'matrix_app']),
      ('keystone.pub_avancement_projets',    ARRAY['arche_app', 'matrix_app']),
      ('keystone.pub_avenants',              ARRAY['arche_app', 'matrix_app']),
      ('keystone.pub_reserves',              ARRAY['arche_app', 'matrix_app']),
      ('keystone.pub_pack_ingenierie',       ARRAY['arche_app', 'matrix_app']),
      -- Arche : CAPEX, besoins machines et montée en cadence (contrats d'Arche, docs/CONTRATS.md § 3), journal (D18).
      ('arche.pub_capex',                    ARRAY['keystone_app', 'matrix_app']),
      ('arche.pub_besoins_machines',         ARRAY['keystone_app', 'matrix_app']),
      ('arche.pub_rampup',                   ARRAY['keystone_app', 'matrix_app']),
      ('arche.pub_journal',                  ARRAY['matrix_app'])
    ) AS t(vue, lecteurs)
  LOOP
    v_oid := to_regclass(r.vue);
    IF v_oid IS NULL OR (SELECT relkind FROM pg_class WHERE oid = v_oid) <> 'v' THEN
      v_absentes := v_absentes || r.vue;
      CONTINUE;
    END IF;
    SELECT n.nspname, pg_get_userbyid(c.relowner) INTO v_schema, v_proprio
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = v_oid;
    SELECT string_agg(quote_ident(l), ', ' ORDER BY l) INTO v_lecteurs FROM unnest(r.lecteurs) AS l;
    EXECUTE format('SET ROLE %I', v_proprio);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %s', v_schema, v_lecteurs);
    EXECUTE format('GRANT SELECT ON TABLE %s TO %s', v_oid::regclass, v_lecteurs);
    EXECUTE 'RESET ROLE';
    -- Lecteurs attendus, contrôlés ensuite par droits.verifier() (perte d'un droit après une restauration).
    IF v_liste THEN
      EXECUTE 'INSERT INTO droits.partage_lecteurs (vue, lecteur) SELECT $1, l FROM unnest($2) AS l ON CONFLICT DO NOTHING'
        USING r.vue, r.lecteurs;
    END IF;
    v_nb := v_nb + 1;
  END LOOP;
  IF NOT v_liste THEN
    RAISE WARNING 'droits.partage_lecteurs absente : rejouez init/03-droits.sql, puis ce fichier, pour que droits.verifier() contrôle les lecteurs.';
  END IF;
  IF cardinality(v_absentes) > 0 THEN
    RAISE WARNING 'Vues absentes, droits non posés (jouez le fichier de l''outil puis relancez celui-ci) : %', array_to_string(v_absentes, ', ');
  END IF;
  RAISE NOTICE 'Droits posés sur % vues pub_.', v_nb;
END $droits$;

-- ── 3. État des droits sur les vues pub_ ─────────────────────────────────
-- Pour relecture. Un droit autre que SELECT, ou un droit sur une table, est refusé par le contrôle 4.
SELECT n.nspname || '.' || c.relname AS vue,
       pg_get_userbyid(c.relowner) AS proprietaire,
       string_agg(DISTINCT g.droit, ', ' ORDER BY g.droit) AS lecteurs
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN LATERAL (
  SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END
         || CASE WHEN a.privilege_type = 'SELECT' THEN '' ELSE ' (' || a.privilege_type || ')' END AS droit
  FROM aclexplode(c.relacl) a
  WHERE a.grantee NOT IN (c.relowner, (SELECT oid FROM pg_roles WHERE rolname = 'matrix_admin'))
) g ON true
WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'matrix') AND c.relkind = 'v' AND c.relname LIKE 'pub\_%'
GROUP BY n.nspname, c.relname, c.relowner
ORDER BY 1;

-- ── 4. Contrôle final par le socle ───────────────────────────────────────
-- droits.verifier() accepte la convention de partage et signale tout autre droit croisé (table, colonne, vue non
-- publiée, écriture, CREATE) et toute vue pub_ qui lit une colonne sensible de droits.colonnes_sensibles.
DO $$
DECLARE
  v_fautes text;
BEGIN
  IF to_regprocedure('droits.verifier()') IS NULL THEN
    RAISE WARNING 'droits.verifier() absente : socle (init/03-droits.sql) non installé, contrôle final non fait.';
    RETURN;
  END IF;
  EXECUTE $q$SELECT string_agg(objet || ' : ' || constat, ' ; ' ORDER BY objet) FROM droits.verifier() WHERE gravite = 'erreur'$q$
    INTO v_fautes;
  IF v_fautes IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'insufficient_privilege',
      MESSAGE = format('Partage annulé : droits.verifier() signale des erreurs : %s', v_fautes);
  END IF;
  RAISE NOTICE 'Contrôle du socle : droits.verifier() sans erreur.';
END $$;

COMMIT;

\echo 'Partage : contrôle et droits terminés.'
