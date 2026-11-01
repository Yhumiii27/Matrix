-- Partage des données EPC2I, fichier 90 : droits des lecteurs sur les vues pub_, et contrôle des vues.
--
-- Ce que fait le script, dans une seule transaction :
--   1. Contrôle des vues pub_ des cinq schémas. Il échoue, avant tout GRANT, si une vue pub_ :
--        - lit une colonne sensible (liste ci-dessous, plus droits.colonnes_sensibles quand elle est lisible) ;
--        - dépend d'une relation d'un autre schéma ;
--        - n'appartient pas au propriétaire de son schéma, ou s'exécute avec security_invoker.
--      Les colonnes source sont lues dans information_schema.view_column_usage en tant que propriétaire de chaque
--      schéma (SET ROLE) : cette vue d'information ne montre que les tables du rôle courant.
--   2. GRANT USAGE sur le schéma et GRANT SELECT sur la vue, pour chaque lien autorisé, aucun droit sur une table.
--      Les liens viennent du registre de Matrix (matrix.liens, 12-matrix-liens.sql), amorcé avec la convention
--      écrite ci-dessous ; sans registre, la convention s'applique telle quelle. Avec le registre, tout SELECT d'un
--      outil sur une vue pub_ qui n'est pas un lien autorisé est retiré (REVOKE), puis l'USAGE sur un schéma où
--      l'outil ne lit plus rien. Chaque GRANT et REVOKE est passé par le propriétaire du schéma (SET ROLE).
--      Chaque couple (vue, lecteur) est inscrit dans droits.partage_lecteurs : droits.verifier() signale ensuite
--      un lecteur qui a perdu son droit (restauration d'un schéma, DROP … CASCADE).
--   3. État des droits sur les vues pub_ (lecture seule), pour relecture.
--   4. Contrôle final par droits.verifier() (init/03-droits.sql), dans la même transaction : il accepte exactement
--      cette convention (USAGE sur le schéma du propriétaire, SELECT sur ses vues pub_) et refuse tout autre droit
--      croisé. Une erreur annule tout le fichier. Aucun réglage du socle n'est à faire à la main.
--
-- Lancement : superutilisateur (postgres) ou administrateur nominatif membre de matrix_admin (qui peut prendre
-- le rôle de chaque outil, SET ROLE). Après les migrations des outils (qui créent leurs vues pub_) et les fichiers
-- 10 à 80 (60 seulement une fois le module ECR / ECO de Vigie construit). Sans l'option -1 : le fichier ouvre
-- lui-même sa transaction.
--   psql -h <hôte> -U postgres -d epc2i -v ON_ERROR_STOP=1 -f partage/90-droits.sql
-- Rejouable : un GRANT déjà posé ne change rien ; une vue absente est signalée (WARNING) et passée.
--
-- Rappel : matrix_lecture n'est pas traité ici. Le déclencheur droits_ddl (init/03-droits.sql) lui donne déjà les
-- vues qui ne lisent aucune colonne sensible.

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off
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
  FROM unnest(ARRAY['keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app', 'crucible_app', 'matrix_app']) AS r
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
    'vigie.events.mp_table', 'vigie.events.mp_disease', 'vigie.events.mp_certificate_on', 'vigie.events.mp_informed_on',
    'vigie.events.mp_questionnaire_received_on', 'vigie.events.mp_questionnaire_returned_on',
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
    WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible', 'matrix')
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
    WHERE nv.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible', 'matrix')
      AND v.relkind = 'v' AND v.relname LIKE 'pub\_%' AND t.relnamespace <> v.relnamespace
    ORDER BY 1);
  -- Propriétaire autre que celui du schéma ou, pour les six outils, que matrix_gestion qui les reprend (M-18, partage/14)
  -- (une vue d'un superutilisateur lirait tout), ou security_invoker.
  v_fautes := v_fautes || ARRAY(
    SELECT format('%s.%s appartient à %s au lieu de %s', n.nspname, c.relname, pg_get_userbyid(c.relowner),
                  CASE WHEN n.nspname = 'matrix' THEN pg_get_userbyid(n.nspowner) ELSE pg_get_userbyid(n.nspowner) || ' ou matrix_gestion' END)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible', 'matrix') AND c.relkind = 'v'
      AND c.relname LIKE 'pub\_%' AND c.relowner <> n.nspowner
      AND NOT (n.nspname <> 'matrix' AND pg_get_userbyid(c.relowner) = 'matrix_gestion')
    ORDER BY 1);
  v_fautes := v_fautes || ARRAY(
    SELECT format('%s.%s s''exécute avec security_invoker', n.nspname, c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible', 'matrix') AND c.relkind = 'v'
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
  v_proprio_schema text;
  v_lecteurs text;
  v_absentes text[] := '{}';
  v_nb integer := 0;
  v_liste boolean := to_regclass('droits.partage_lecteurs') IS NOT NULL;
  v_registre boolean := to_regclass('matrix.liens') IS NOT NULL;
  v_convention jsonb;
  v_voulus jsonb;
  v_retires integer := 0;
  v_usages integer := 0;
BEGIN
  -- Convention de partage : liens d'origine, écrits ici. Depuis le 24/10/2026, Matrix les administre dans son registre
  -- matrix.liens (12-matrix-liens.sql) : ils y sont inscrits une fois (« convention », autorisés), puis c'est le
  -- registre qui fait foi (un lien refusé dans Matrix n'est plus accordé, un lien autorisé dans Matrix l'est).
  SELECT jsonb_agg(jsonb_build_object('vue', t.vue, 'lecteurs', to_jsonb(t.lecteurs))) INTO v_convention
  FROM (VALUES
      -- Matrix : référentiels (D14, D15, D17, D21) et correspondances.
      ('matrix.pub_pays',                    ARRAY['keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app']),
      ('matrix.pub_sites',                   ARRAY['keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app', 'crucible_app']),
      ('matrix.pub_organigramme',            ARRAY['keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app', 'crucible_app']),
      ('matrix.pub_correspondances',         ARRAY['keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app']),
      ('matrix.pub_zones',                   ARRAY['keystone_app', 'arche_app']),
      ('matrix.pub_filiales',                ARRAY['keystone_app', 'arche_app', 'crucible_app']),
      -- Cursus : personnes (D01), titres (D08, D09), paramètres (D19), journal (D18).
      ('cursus.pub_salaries',                ARRAY['keystone_app', 'codex_app', 'vigie_app', 'crucible_app', 'matrix_app']),
      ('cursus.pub_titres',                  ARRAY['keystone_app', 'vigie_app', 'crucible_app', 'matrix_app']),
      ('cursus.pub_titres_detenus',          ARRAY['keystone_app', 'vigie_app', 'crucible_app', 'matrix_app']),
      ('cursus.pub_parametres',              ARRAY['vigie_app', 'matrix_app']),
      ('cursus.pub_journal',                 ARRAY['matrix_app']),
      -- Keystone : projets (D02), chantiers (D03), affectations (D04), tâches (D05), tiers (D16),
      -- référentiels de Vigie (D12, D13), journal (D18).
      ('keystone.pub_projets',               ARRAY['codex_app', 'cursus_app', 'vigie_app', 'arche_app', 'crucible_app', 'matrix_app']),
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
      -- Codex : documents (D10, lus aussi par Arche : dossiers et pack ; par Crucible : références des essais), registre (D11), journal (D18).
      ('codex.pub_documents',                ARRAY['keystone_app', 'vigie_app', 'arche_app', 'crucible_app', 'matrix_app']),
      ('codex.pub_revisions_document',       ARRAY['keystone_app', 'vigie_app', 'arche_app', 'crucible_app', 'matrix_app']),
      ('codex.pub_validations',              ARRAY['keystone_app', 'vigie_app', 'arche_app', 'matrix_app']),
      ('codex.pub_types_document',           ARRAY['keystone_app', 'vigie_app', 'arche_app', 'matrix_app']),
      ('codex.pub_circuits_type',            ARRAY['keystone_app', 'matrix_app']),
      ('codex.pub_titulaires_fonction',      ARRAY['keystone_app', 'matrix_app']),
      ('codex.pub_journal',                  ARRAY['matrix_app']),
      -- Codex : programmes de recherche (migration 0002 de Codex, demande CX-2 de Crucible).
      ('codex.pub_programmes_recherche',     ARRAY['crucible_app', 'matrix_app']),
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
      -- Expéditions (migration 0064 de Keystone, R-158) : suivies par la filiale dans Arche (décision 6 du 25/10/2026).
      ('keystone.pub_expeditions',           ARRAY['arche_app', 'matrix_app']),
      -- Arche : CAPEX, besoins machines et montée en cadence (contrats d'Arche, docs/CONTRATS.md § 3), journal (D18).
      ('arche.pub_capex',                    ARRAY['keystone_app', 'matrix_app']),
      ('arche.pub_besoins_machines',         ARRAY['keystone_app', 'matrix_app']),
      ('arche.pub_rampup',                   ARRAY['keystone_app', 'matrix_app']),
      ('arche.pub_journal',                  ARRAY['matrix_app']),
      -- D22 (22/10/2026) : REX des CAPEX (Arche) et des projets (Keystone), réunis par Matrix ; vues à créer par les outils.
      ('arche.pub_rex',                      ARRAY['matrix_app']),
      -- M-13 d'Arche (23/10/2026) : REX au contrat commun (§ 8 quater de docs/architecture-postgres.md), réuni par 96.
      ('arche.pub_rex_v2',                   ARRAY['matrix_app']),
      ('keystone.pub_rex',                   ARRAY['matrix_app']),
      -- Crucible (demande M-4, 22/10/2026) : journal (D18) ; moyens et réservations confirmées (livraison L3 de Crucible,
      -- absentes jusque-là : WARNING), lus par Keystone (planning des projets) et Vigie (coactivité, plans de prévention).
      ('crucible.pub_journal',               ARRAY['matrix_app']),
      ('crucible.pub_moyens',                ARRAY['keystone_app', 'vigie_app', 'matrix_app']),
      ('crucible.pub_reservations',          ARRAY['keystone_app', 'vigie_app', 'matrix_app']),
      ('crucible.pub_occupation_hebdo',      ARRAY['matrix_app']),
      -- Vues demandées pour Crucible, absentes tant que l'outil ne les publie pas (WARNING) : jalons de Keystone (K-2 de
      -- Crucible), absences de Cursus sans motif (CU-1 de Crucible).
      ('keystone.pub_jalons',                ARRAY['crucible_app', 'matrix_app']),
      ('cursus.pub_absences',                ARRAY['crucible_app', 'matrix_app']),
      -- D23 (22/10/2026, option A) : Vigie fait foi pour les contrôles périodiques ; Crucible lit les contrôles et les
      -- interventions qui suspendent les essais (V-1, V-2 de Crucible), absentes tant que Vigie ne les publie pas (WARNING).
      ('vigie.pub_controles',                ARRAY['crucible_app', 'matrix_app']),
      ('vigie.pub_suspensions_essais',       ARRAY['crucible_app', 'matrix_app'])
  ) AS t(vue, lecteurs);

  IF v_registre THEN
    -- Amorçage : un lien de la convention absent du registre y entre comme autorisé ; une décision déjà prise dans
    -- Matrix (refus compris) n'est jamais écrasée.
    EXECUTE $q$
      INSERT INTO matrix.liens (vue, lecteur, statut, origine, motif, decide_par, decide_le)
      SELECT c.vue, l, 'autorise', 'convention', 'Convention de partage (partage/90-droits.sql)', session_user, now()
      FROM jsonb_to_recordset($1) AS c(vue text, lecteurs text[]), unnest(c.lecteurs) AS l
      WHERE split_part(c.vue, '.', 1) || '_app' <> l
      ON CONFLICT (vue, lecteur) DO NOTHING$q$ USING v_convention;
    EXECUTE $q$SELECT jsonb_agg(jsonb_build_object('vue', vue, 'lecteurs', to_jsonb(lecteurs)))
               FROM (SELECT vue, array_agg(lecteur ORDER BY lecteur) AS lecteurs FROM matrix.liens
                     WHERE statut = 'autorise' GROUP BY vue) x$q$ INTO v_voulus;
    RAISE NOTICE 'Liens : registre de Matrix (matrix.liens) appliqué.';
  ELSE
    v_voulus := v_convention;
    RAISE WARNING 'matrix.liens absente : liens de la convention appliqués tels quels (jouez 12-matrix-liens.sql pour que Matrix les administre).';
  END IF;

  FOR r IN SELECT * FROM jsonb_to_recordset(coalesce(v_voulus, '[]')) AS x(vue text, lecteurs text[])
  LOOP
    v_oid := to_regclass(r.vue);
    IF v_oid IS NULL OR (SELECT relkind FROM pg_class WHERE oid = v_oid) <> 'v' THEN
      v_absentes := v_absentes || r.vue;
      CONTINUE;
    END IF;
    -- USAGE par le propriétaire du schéma, SELECT par celui de la vue (matrix_gestion pour une vue reprise, M-18).
    SELECT n.nspname, pg_get_userbyid(c.relowner), pg_get_userbyid(n.nspowner) INTO v_schema, v_proprio, v_proprio_schema
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = v_oid;
    SELECT string_agg(quote_ident(l), ', ' ORDER BY l) INTO v_lecteurs FROM unnest(r.lecteurs) AS l;
    EXECUTE format('SET ROLE %I', v_proprio_schema);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %s', v_schema, v_lecteurs);
    EXECUTE format('SET ROLE %I', v_proprio);
    EXECUTE format('GRANT SELECT ON TABLE %s TO %s', v_oid::regclass, v_lecteurs);
    EXECUTE 'RESET ROLE';
    -- Lecteurs attendus, contrôlés ensuite par droits.verifier() (perte d'un droit après une restauration).
    IF v_liste THEN
      EXECUTE 'INSERT INTO droits.partage_lecteurs (vue, lecteur) SELECT $1, l FROM unnest($2) AS l ON CONFLICT DO NOTHING'
        USING r.vue, r.lecteurs;
    END IF;
    v_nb := v_nb + 1;
  END LOOP;

  -- Retrait des liens non autorisés (registre seulement) : tout SELECT d'un rôle d'outil sur une vue pub_ d'un autre
  -- schéma qui n'est pas un lien autorisé de matrix.liens (refusé, demandé, ou jamais inscrit), puis l'USAGE d'un outil
  -- sur un schéma où il ne lit plus aucune vue pub_. Chaque REVOKE est passé par le propriétaire du schéma.
  IF v_registre THEN
    FOR r IN
      SELECT n.nspname AS schema, c.oid::regclass::text AS vue, pg_get_userbyid(c.relowner) AS proprio,
             pg_get_userbyid(a.grantee) AS lecteur
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible', 'matrix') AND c.relkind = 'v'
        AND c.relname LIKE 'pub\_%' AND a.privilege_type = 'SELECT'
        AND pg_get_userbyid(a.grantee) IN ('keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app', 'crucible_app', 'matrix_app')
        AND a.grantee <> c.relowner
        AND NOT EXISTS (SELECT FROM jsonb_to_recordset(coalesce(v_voulus, '[]')) AS x(vue text, lecteurs text[])
                        WHERE x.vue = n.nspname || '.' || c.relname AND pg_get_userbyid(a.grantee) = ANY (x.lecteurs))
    LOOP
      EXECUTE format('SET ROLE %I', r.proprio);
      EXECUTE format('REVOKE SELECT ON TABLE %s FROM %I', r.vue, r.lecteur);
      EXECUTE 'RESET ROLE';
      IF v_liste THEN
        EXECUTE 'DELETE FROM droits.partage_lecteurs WHERE vue = $1 AND lecteur = $2' USING r.vue, r.lecteur;
      END IF;
      RAISE NOTICE 'Lien retiré (non autorisé dans matrix.liens) : % ne lit plus %.', r.lecteur, r.vue;
      v_retires := v_retires + 1;
    END LOOP;
    -- Couples inscrits dans droits.partage_lecteurs qui ne sont plus des liens autorisés (vue absente comprise).
    IF v_liste THEN
      EXECUTE $q$DELETE FROM droits.partage_lecteurs p
                 WHERE NOT EXISTS (SELECT FROM jsonb_to_recordset(coalesce($1, '[]')) AS x(vue text, lecteurs text[])
                                   WHERE x.vue = p.vue AND p.lecteur = ANY (x.lecteurs))$q$ USING v_voulus;
    END IF;
    FOR r IN
      -- Chaque USAGE est retiré par celui qui l'a donné : le propriétaire du schéma, ou matrix_gestion (lot P2 de M-18).
      SELECT n.nspname AS schema, pg_get_userbyid(a.grantor) AS proprio, pg_get_userbyid(a.grantee) AS lecteur
      FROM pg_namespace n
      CROSS JOIN LATERAL aclexplode(n.nspacl) a
      WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible', 'matrix') AND a.privilege_type = 'USAGE'
        AND pg_get_userbyid(a.grantee) IN ('keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app', 'crucible_app')
        AND a.grantee <> n.nspowner
        AND NOT EXISTS (SELECT FROM pg_class v
                        WHERE v.relnamespace = n.oid AND v.relkind = 'v' AND v.relname LIKE 'pub\_%'
                          AND has_table_privilege(a.grantee, v.oid, 'SELECT'))
    LOOP
      EXECUTE format('SET ROLE %I', r.proprio);
      EXECUTE format('REVOKE USAGE ON SCHEMA %I FROM %I', r.schema, r.lecteur);
      EXECUTE 'RESET ROLE';
      v_usages := v_usages + 1;
    END LOOP;
    IF v_retires + v_usages > 0 THEN
      RAISE NOTICE 'Liens retirés : % droit(s) SELECT, % droit(s) USAGE sur un schéma.', v_retires, v_usages;
    END IF;
  END IF;

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
WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible', 'matrix') AND c.relkind = 'v' AND c.relname LIKE 'pub\_%'
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
