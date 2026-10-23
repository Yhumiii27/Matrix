-- Partage des données EPC2I, fichier 50 : vues publiées par Vigie (schéma vigie), hors ECR / ECO.
--
-- Décisions : D13 non-conformités et HSE de projet, D18 journal.
-- Source : les vues sont créées par la migration de Vigie drizzle/0009_partage.sql (dépôt Vigie, décision P-02 du
-- 18/10/2026), leurs colonnes prérequises par drizzle/0008_partage_prerequis.sql. Ce fichier en est la copie, qualifiée
-- vigie. : le rejouer sur un serveur où Vigie a passé ses migrations ne change rien (CREATE OR REPLACE VIEW, même
-- définition). Il ne crée ni colonne ni table : migration de Vigie d'abord, puis ce fichier, puis 90-droits.sql.
-- Toute évolution d'une vue se fait d'abord dans une migration de Vigie, puis est recopiée ici.
-- Exécution : en tant que vigie_app, après les migrations de Vigie (voir README.md).
--   psql "postgres://vigie_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/50-vigie.sql
-- Rejouable. Les vues ne lisent que des tables du schéma vigie. Droits : 90-droits.sql.
--
-- Écarts avec la première version de ce fichier (15/10/2026), constatés sur le schéma réel de Vigie :
--   - pas de table vigie.inductions : pub_hse_projet n'a pas de ligne « induction » (accueils sécurité, D13 à arbitrer) ;
--   - pas de table vigie.document_actions (D10) : le lien révision Codex ↔ action reste à concevoir dans Vigie ;
--   - pas de table vigie.journal (D18) : pub_journal lit le journal des modifications change_log (logChange), sans
--     motif ni détail des champs ;
--   - pas de colonnes events.closed_on ni updated_at : closed_on et vigie_updated_at sont calculés (event_steps,
--     change_log) ; les actions sont libellées d'après leur détail (actions.title n'existe pas) ;
--   - people.matricule existe déjà (migration de Vigie) ; les événements classés sans suite, plans de prévention et
--     permis annulés sont exclus.
--
-- Données de santé : aucune vue ne lit une colonne de droits.colonnes_sensibles (events.injury, lost_days et les
-- autres colonnes de HEALTH_LABELS de Vigie, change_log.details et reason) ni les tables fermées en entier
-- (benign_accidents, access_log, attachments). Un accident du travail (type AT) ou une maladie professionnelle (MP)
-- n'entre dans aucune vue, son journal non plus (migrations 0010 et 0013 de Vigie).

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

-- ═══ Prérequis : migrations 0008, 0009 et 0014 de Vigie (0010 et 0013 : mêmes vues, filtres de santé repris ici) ═══
-- Ce fichier ne crée rien d'autre que les vues. Une colonne absente signale une migration de Vigie non passée.
DO $$
DECLARE
  v_manque text;
BEGIN
  SELECT string_agg(x.t || '.' || x.c, ', ') INTO v_manque
  FROM (VALUES ('events', 'keystone_project_code'), ('events', 'nc_number'), ('events', 'keystone_activity_code'),
               ('events', 'part_ref'), ('events', 'keystone_deliverable_number'), ('events', 'supplier_id'),
               ('events', 'supplier_name'), ('events', 'root_cause'), ('events', 'nc_cost_keur'), ('events', 'iso_clause'),
               ('prevention_plans', 'keystone_project_code'), ('permits', 'keystone_project_code'),
               ('people', 'matricule'), ('people', 'last_role'), ('change_log', 'summary'),
               ('controls', 'equipment_code')) AS x(t, c)
  WHERE NOT EXISTS (SELECT FROM information_schema.columns ic
                    WHERE ic.table_schema = 'vigie' AND ic.table_name = x.t AND ic.column_name = x.c);
  IF v_manque IS NOT NULL THEN
    RAISE EXCEPTION 'Colonnes absentes du schéma vigie (%) : démarrez Vigie sur le serveur pour qu''il passe ses migrations (0008_partage_prerequis, 0009_partage, 0014_controls_share), puis rejouez ce fichier.', v_manque;
  END IF;
END $$;

-- ═══ Vues publiées (copie de drizzle/0009_partage.sql de Vigie) ═══
-- Contrat : on n'en retire ni ne renomme de colonne (sinon nouvelle vue _v2) ; ajout en fin de liste seulement.
-- security_barrier : les filtres de la vue (type = 'NC'…) s'évaluent avant toute fonction posée par le lecteur,
-- qui ne peut donc pas lire le titre d'un accident par ce chemin.
-- Les noms de colonnes reprennent ceux des miroirs Keystone (vigie_ncrs, vigie_hse_items) : le rafraîchissement
-- se fait par INSERT … SELECT.

-- D13 · Non-conformités de projet (miroir Keystone vigie_ncrs). Événements NC portant un code projet Keystone et un
-- numéro NCR, hors classés sans suite. closed_on et vigie_updated_at sont calculés (passage à « Clôturé » dans
-- event_steps ; dernière écriture d'après event_steps et change_log), jamais stockés.
CREATE OR REPLACE VIEW vigie.pub_non_conformites WITH (security_barrier) AS
SELECT e.keystone_project_code AS project_code,
       e.nc_number             AS number,
       e.id                    AS vigie_ref,
       e.title,
       CASE WHEN e.severity >= 3 THEN 'critical' WHEN e.severity = 2 THEN 'major' ELSE 'minor' END AS severity,
       CASE e.nc_origin WHEN 'Fournisseurs' THEN 'goods_receipt' WHEN 'Fabrication' THEN 'workshop'
            WHEN 'Mise en service' THEN 'site_inspection' WHEN 'Inspection chantier' THEN 'site_inspection'
            WHEN 'Relevé' THEN 'survey' WHEN 'Audit' THEN 'audit' WHEN 'Réclamation client' THEN 'client'
            WHEN 'Conception BE' THEN 'design' ELSE 'workshop' END AS source,
       (ARRAY['open', 'containment', 'root_cause', 'corrective_action', 'verification', 'closed'])[least(e.step, 5) + 1] AS status,
       e.keystone_activity_code      AS activity_code,
       e.part_ref,
       e.keystone_deliverable_number AS deliverable_number,
       e.supplier_id,
       e.supplier_name,
       CASE WHEN e.anonymous THEN 'Anonyme' ELSE coalesce(e.declarant, 'Anonyme') END AS raised_by_name,
       e.occurred_on                 AS raised_on,
       coalesce(p.name, '—')         AS owner_name,
       p.matricule                   AS owner_matricule,
       coalesce(e.root_cause, '')    AS root_cause,
       coalesce(concat_ws(' · ', nullif(e.immediate_measures, ''), act.titres), '') AS action,
       act.prochaine_echeance        AS due_on,
       coalesce(e.nc_cost_keur, 0)   AS cost_keur,
       coalesce(e.iso_clause, '')    AS iso_clause,
       CASE WHEN e.step >= 5 THEN st.closed_on END AS closed_on,
       greatest(e.created_at, st.last_at, jl.last_at) AS vigie_updated_at
FROM vigie.events e
LEFT JOIN vigie.people p ON p.id = e.pilot_id
LEFT JOIN LATERAL (
  -- Libellé d'une action : première ligne non vide du détail, espaces réduits, 90 caractères (actionLabel).
  SELECT string_agg(coalesce(nullif(left(btrim(regexp_replace(substring(a.detail from '[^\r\n]*\S[^\r\n]*'), '\s+', ' ', 'g')), 90), ''),
                             'Action sans détail'), ' · ' ORDER BY a.due_on, a.id) AS titres,
         min(a.due_on) FILTER (WHERE a.status NOT IN ('terminee', 'verifiee', 'abandonnee')) AS prochaine_echeance
  FROM vigie.actions a
  WHERE a.event_id = e.id AND a.status <> 'abandonnee'
) act ON true
LEFT JOIN LATERAL (
  SELECT max(s.at) AS last_at,
         (max(s.at) FILTER (WHERE s.kind = 'advance' AND s.to_step = 5) AT TIME ZONE 'Europe/Paris')::date AS closed_on
  FROM vigie.event_steps s
  WHERE s.event_id = e.id
) st ON true
LEFT JOIN LATERAL (
  SELECT max(l.at) AS last_at FROM vigie.change_log l WHERE l.entity_type = 'event' AND l.entity_id = e.id
) jl ON true
WHERE e.type = 'NC' AND e.keystone_project_code IS NOT NULL AND e.nc_number IS NOT NULL AND e.dismissed_at IS NULL;
COMMENT ON VIEW vigie.pub_non_conformites IS 'Contrat D13 v1 : NC de projet (type NC, code projet et numéro renseignés, hors classées sans suite). Ni injury ni lost_days. Lecteurs : keystone_app, matrix_app.';

-- D13 · Registre HSE de projet (miroir Keystone vigie_hse_items) : plans de prévention et permis non annulés portant
-- un code projet Keystone, puis le nombre de presqu'accidents du projet. Pas de ligne « induction » : Vigie n'a pas
-- d'accueils sécurité de chantier (table inductions de 50-vigie.sql non créée, D13 à arbitrer). Depuis la migration 0013
-- de Vigie (É13), un projet qui n'a qu'un accident du travail ou une maladie professionnelle n'apparaît pas.
CREATE OR REPLACE VIEW vigie.pub_hse_projet WITH (security_barrier) AS
WITH projets AS (
  SELECT keystone_project_code AS project_code FROM vigie.prevention_plans WHERE keystone_project_code IS NOT NULL AND status <> 'annule'
  UNION SELECT keystone_project_code FROM vigie.permits WHERE keystone_project_code IS NOT NULL AND status <> 'annule'
  UNION SELECT keystone_project_code FROM vigie.events WHERE keystone_project_code IS NOT NULL AND dismissed_at IS NULL
        AND type NOT IN ('AT', 'MP')
), lignes AS (
  SELECT pp.keystone_project_code AS project_code, pp.id AS vigie_ref, 'prevention_plan'::text AS kind,
         'Plan de prévention · ' || pp.title AS title,
         CASE WHEN pp.status IN ('signe', 'clos') THEN 'signed' ELSE 'pending' END AS status,
         NULL::text AS status_text,
         CASE WHEN pp.status IN ('signe', 'clos') THEN greatest(pp.signed_eu_on, pp.signed_ee_on) ELSE pp.start_on END AS date_on,
         1 AS groupe, pp.start_on AS tri
  FROM vigie.prevention_plans pp
  WHERE pp.keystone_project_code IS NOT NULL AND pp.status <> 'annule'
  UNION ALL
  SELECT pe.keystone_project_code, pe.id, 'permit',
         CASE pe.type WHEN 'feu' THEN 'Permis de feu' WHEN 'essai' THEN 'Permis d''essai' WHEN 'levage' THEN 'Permis de levage'
                      WHEN 'travail_ht' THEN 'Permis de travail HT' ELSE 'Permis' END || ' · ' || pe.location,
         CASE pe.status WHEN 'demande' THEN 'pending' WHEN 'delivre' THEN 'signed' ELSE 'recorded' END,
         NULL, (pe.valid_from AT TIME ZONE 'Europe/Paris')::date, 2, (pe.valid_from AT TIME ZONE 'Europe/Paris')::date
  FROM vigie.permits pe
  WHERE pe.keystone_project_code IS NOT NULL AND pe.status <> 'annule'
  UNION ALL
  SELECT x.project_code, NULL, 'register', 'Registre presqu''accidents', 'recorded',
         count(ev.id) || CASE WHEN count(ev.id) > 1 THEN ' déclarés' ELSE ' déclaré' END, NULL, 3, NULL
  FROM projets x
  LEFT JOIN vigie.events ev ON ev.keystone_project_code = x.project_code AND ev.type = 'PA' AND ev.dismissed_at IS NULL
  GROUP BY x.project_code
)
SELECT project_code,
       vigie_ref,
       kind,
       title,
       status,
       status_text,
       date_on,
       (row_number() OVER (PARTITION BY project_code ORDER BY groupe, tri NULLS LAST, vigie_ref) - 1)::integer AS position
FROM lignes;
COMMENT ON VIEW vigie.pub_hse_projet IS 'Contrat D13 v1 : registre HSE par projet Keystone (plans de prévention, permis, nombre de presqu''accidents). Un accident du travail ou une maladie professionnelle ne fait pas apparaître un projet (0013). Lecteurs : keystone_app, matrix_app.';

-- D18 · Journal (colonnes communes aux quatre pub_journal, réunies par matrix.journal_unifie) : journal des
-- modifications de Vigie (change_log, écrit par logChange), sans le motif ni le détail des champs (details), qui
-- peuvent porter des données de santé. Écartés : les entrées d'un accident du travail et du registre des accidents
-- bénins (benign_accident), et, depuis la migration 0010 de Vigie (EVT-09), celles d'une maladie professionnelle (MP).
-- Auteur absent (signalement anonyme, tâche du serveur) : « Anonyme ». qui_role : dernier
-- rôle connu de l'auteur (people.last_role), Vigie ne journalisant pas le rôle de l'écriture.
CREATE OR REPLACE VIEW vigie.pub_journal WITH (security_barrier) AS
SELECT 'change_log:' || l.id::text           AS ref_source,
       'audit'::text                         AS nature,
       l.at                                  AS quand,
       coalesce(p.name, 'Anonyme')           AS qui,
       l.by_id                               AS qui_ref,
       p.last_role                           AS qui_role,
       l.entity_type || '.' || l.action      AS action,
       l.entity_type || ':' || l.entity_id   AS objet,
       l.summary                             AS detail,
       coalesce(ev.keystone_project_code, pp.keystone_project_code, pe.keystone_project_code) AS projet,
       p.matricule                           AS qui_matricule
FROM vigie.change_log l
LEFT JOIN vigie.people p ON p.id = l.by_id
LEFT JOIN vigie.events ev ON l.entity_type = 'event' AND ev.id = l.entity_id
LEFT JOIN vigie.prevention_plans pp ON l.entity_type = 'prevention_plan' AND pp.id = l.entity_id
LEFT JOIN vigie.permits pe ON l.entity_type = 'permit' AND pe.id = l.entity_id
WHERE l.entity_type <> 'benign_accident' AND (ev.type IS NULL OR ev.type NOT IN ('AT', 'MP'));
COMMENT ON VIEW vigie.pub_journal IS 'Contrat D18 v1 : journal des modifications de Vigie (change_log) aux colonnes communes, sans motif ni détail des champs, hors accidents du travail, maladies professionnelles et registre des accidents bénins. Lecteur : matrix_app (matrix.journal_unifie).';

-- D23 · Contrôles périodiques (copie de drizzle/0014_controls_share.sql de Vigie ; demande de Vigie du 22/10/2026,
-- REQUESTS.md de Matrix). Contrat Crucible v1 : tous les contrôles, en vigueur et archivés, avec le code commun de
-- l'équipement ; maj_le calculée (journal et enregistrements). Ni personne ni donnée de santé.
-- Lecteurs : crucible_app, matrix_app (90-droits.sql).
CREATE OR REPLACE VIEW vigie.pub_controles WITH (security_barrier) AS
SELECT c.id::text            AS vigie_ref,
       c.site_id             AS site_code,
       c.equipment           AS equipement,
       c.equipment_code      AS equipement_code,
       c.control_type        AS type_controle,
       c.organization        AS organisme,
       c.period_months       AS periodicite_mois,
       c.last_on             AS dernier_le,
       c.next_on             AS prochain_le,
       c.reserves            AS reserves,
       c.archived_at IS NOT NULL AS archive,
       greatest(c.archived_at, jl.last_at, rec.last_at) AS maj_le
FROM vigie.controls c
LEFT JOIN LATERAL (
  SELECT max(l.at) AS last_at FROM vigie.change_log l WHERE l.entity_type = 'control' AND l.entity_id = c.id::text
) jl ON true
LEFT JOIN LATERAL (
  SELECT max(greatest(r.created_at, r.cancelled_at)) AS last_at FROM vigie.control_records r WHERE r.control_id = c.id
) rec ON true;
COMMENT ON VIEW vigie.pub_controles IS 'Contrat Crucible v1 : contrôles périodiques (en vigueur et archivés) avec le code commun de l''équipement (equipement_code, null s''il n''est pas renseigné) ; maj_le = dernière écriture connue (journal et enregistrements), null sans trace. Ni personne ni donnée de santé. Colonnes ajoutées en fin seulement. Lecteur : crucible_app (droit accordé par Matrix, 90-droits.sql).';
