-- Comptage exact du serveur commun, avant et après la copie des volumes (docs/renommage-atrium.md, étapes 4 et 6) :
-- une ligne par table des schémas des outils (nombre exact de lignes), puis les objets qui doivent survivre à la copie
-- (vues pub_ et leur propriétaire, fonctions pub_, déclencheurs d'événement, rôles, réglages, droits CONNECT).
-- Lecture seule ; rien n'est écrit. Les deux sorties se comparent avec diff : aucune ligne ne doit différer, hormis
-- le nom de la base (première ligne) si le renommage est fait entre les deux.
--
-- En superutilisateur, sur la base commune (epc2i avant le renommage, atrium après) :
--   psql -U postgres -d epc2i -X -q -A -t -v ON_ERROR_STOP=1 -f /opt/atrium/renommage/compter.sql > /sauvegardes/comptage-avant.txt

\set ON_ERROR_STOP on
\pset pager off

CREATE FUNCTION pg_temp.compter() RETURNS TABLE (objet text, valeur text)
LANGUAGE plpgsql AS $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN SELECT c.oid, n2.nspname, c.relname FROM pg_class c JOIN pg_namespace n2 ON n2.oid = c.relnamespace
           WHERE c.relkind IN ('r', 'p') AND n2.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible',
                 'clavis', 'modulus', 'vector', 'matrix', 'droits')
           ORDER BY 2, 3 LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', r.nspname, r.relname) INTO n;
    objet := format('table %s.%s', r.nspname, r.relname); valeur := n::text; RETURN NEXT;
  END LOOP;
END $$;

SELECT 'base', current_database();
SELECT objet, valeur FROM pg_temp.compter();
SELECT 'vue ' || n.nspname || '.' || c.relname, pg_get_userbyid(c.relowner)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'v' AND c.relname LIKE 'pub\_%' ORDER BY 1;
SELECT 'fonction ' || n.nspname || '.' || p.proname, pg_get_userbyid(p.proowner)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname LIKE 'pub\_%' AND n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1;
SELECT 'déclencheur d''événement ' || evtname, evtenabled::text FROM pg_event_trigger ORDER BY 1;
SELECT 'rôle ' || CASE WHEN rolname IN ('epc2i_sauvegarde', 'atrium_sauvegarde') THEN '<rôle des sauvegardes>' ELSE rolname END,
       concat_ws(' ', CASE WHEN rolcanlogin THEN 'login' END, CASE WHEN rolsuper THEN 'super' END,
                 CASE WHEN rolpassword IS NULL THEN 'sans mot de passe' WHEN rolpassword LIKE 'SCRAM-SHA-256$%' THEN 'scram' ELSE 'autre' END)
FROM pg_authid WHERE rolname NOT LIKE 'pg\_%' ORDER BY 1;
SELECT 'réglages de la base', count(*)::text FROM pg_db_role_setting d JOIN pg_database b ON b.oid = d.setdatabase
WHERE b.datname = current_database();
SELECT 'droits CONNECT', coalesce(array_length(datacl, 1), 0)::text FROM pg_database WHERE datname = current_database();
SELECT to_regclass('matrix.publications') IS NOT NULL AS a_publications, to_regclass('matrix.liens') IS NOT NULL AS a_liens \gset
\if :a_publications
SELECT 'publications ' || etat, count(*)::text FROM matrix.publications GROUP BY etat ORDER BY 1;
\endif
\if :a_liens
SELECT 'liens ' || statut, count(*)::text FROM matrix.liens GROUP BY statut ORDER BY 1;
\endif
