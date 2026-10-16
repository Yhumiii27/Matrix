-- Partage des données EPC2I, fichier 50 : vues publiées par Vigie (schéma vigie), hors ECR / ECO.
--
-- Décisions : D13 non-conformités et HSE de projet, D18 journal.
-- Prérequis portés par d'autres décisions : D01 (people.matricule), D02 (keystone_project_code dans 4 tables),
-- D16 (contractors.supplier_id, events.supplier_id), D10 (document_actions).
-- Les tables et vues ECR / ECO (D12) sont dans 60-vigie-ecr-eco.sql.
-- Exécution : en tant que vigie_app, après les migrations Drizzle de Vigie (voir README.md).
--   psql "postgres://vigie_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/50-vigie.sql
-- Rejouable. Les vues ne lisent que des tables du schéma vigie. Droits : 90-droits.sql.
--
-- Colonnes sensibles, jamais lues par une vue pub_ : vigie.events.injury et vigie.events.lost_days (santé).
-- Un événement de type AT n'entre dans aucune vue : seules les NC (pub_non_conformites) et le nombre de
-- presqu'accidents (pub_hse_projet) sont publiés.

\set ON_ERROR_STOP on

-- ═══ Prérequis : colonnes à ajouter (à reporter dans les migrations de l'outil) ═══
-- Destination : src/db/schema.ts puis une migration drizzle/00xx. ADD COLUMN IF NOT EXISTS : sans effet si la
-- colonne existe déjà ; la contrainte écrite dans la définition de colonne suit le même sort.
-- Aucune clé étrangère vers un autre schéma : les codes Keystone, Codex et Cursus sont contrôlés à la saisie
-- par Vigie (contre les vues pub_) puis par le contrôle d'orphelins de Matrix.

-- D01 : matricule Cursus de la personne (people devient une table réduite, reliée à cursus.pub_salaries).
ALTER TABLE vigie.people
  ADD COLUMN IF NOT EXISTS matricule text
    CONSTRAINT people_matricule_unique UNIQUE
    CONSTRAINT people_matricule_check CHECK (matricule ~ '^EMP-[0-9]{4,}$');

-- D16 : fournisseur Keystone d'une entreprise extérieure (keystone.pub_fournisseurs.id). Facultatif ; pas
-- d'unicité (deux agences d'une même société).
ALTER TABLE vigie.contractors ADD COLUMN IF NOT EXISTS supplier_id uuid;
CREATE INDEX IF NOT EXISTS contractors_supplier_id_idx ON vigie.contractors (supplier_id);

-- D02 : code projet Keystone (keystone.pub_projets.code), à la place du texte libre « id · client » de
-- keystone_project. L'ancienne colonne est renommée keystone_project_ancien par la migration de Vigie et reste
-- affichée en lecture seule (enregistrements à conserver).
ALTER TABLE vigie.events           ADD COLUMN IF NOT EXISTS keystone_project_code text;
ALTER TABLE vigie.prevention_plans ADD COLUMN IF NOT EXISTS keystone_project_code text;
ALTER TABLE vigie.permits          ADD COLUMN IF NOT EXISTS keystone_project_code text;
ALTER TABLE vigie.site_activities  ADD COLUMN IF NOT EXISTS keystone_project_code text;
CREATE INDEX IF NOT EXISTS events_keystone_project_code_idx           ON vigie.events (keystone_project_code);
CREATE INDEX IF NOT EXISTS prevention_plans_keystone_project_code_idx ON vigie.prevention_plans (keystone_project_code);
CREATE INDEX IF NOT EXISTS permits_keystone_project_code_idx          ON vigie.permits (keystone_project_code);
CREATE INDEX IF NOT EXISTS site_activities_keystone_project_code_idx  ON vigie.site_activities (keystone_project_code);

-- D13 : volet NC de Keystone porté par l'événement (type = 'NC').
ALTER TABLE vigie.events
  ADD COLUMN IF NOT EXISTS nc_number text                       -- « NCR-029 », unique par projet : vigie_ncrs (project_code, number), punch_items.ncr_number
    CONSTRAINT events_nc_number_check CHECK (nc_number IS NULL OR (nc_number ~ '^NCR-[0-9]{3,}$' AND type = 'NC' AND keystone_project_code IS NOT NULL));
ALTER TABLE vigie.events ADD COLUMN IF NOT EXISTS keystone_activity_code text;        -- keystone.pub_activites.code
ALTER TABLE vigie.events ADD COLUMN IF NOT EXISTS part_ref text;                      -- keystone.pub_articles.ref
ALTER TABLE vigie.events ADD COLUMN IF NOT EXISTS keystone_deliverable_number text;   -- keystone.pub_livrables.number
ALTER TABLE vigie.events ADD COLUMN IF NOT EXISTS supplier_id uuid;                   -- D16 : keystone.pub_fournisseurs.id (origine « Fournisseurs »)
ALTER TABLE vigie.events ADD COLUMN IF NOT EXISTS supplier_name text;                 -- nom du fournisseur au moment de la saisie
ALTER TABLE vigie.events ADD COLUMN IF NOT EXISTS root_cause text;                    -- synthèse ; le détail reste dans event_analyses
ALTER TABLE vigie.events
  ADD COLUMN IF NOT EXISTS nc_cost_keur numeric(12, 2)                                -- coût de non-qualité (k€)
    CONSTRAINT events_nc_cost_keur_check CHECK (nc_cost_keur >= 0);
ALTER TABLE vigie.events ADD COLUMN IF NOT EXISTS iso_clause text;                    -- « 8.7 Control of nonconforming outputs »
ALTER TABLE vigie.events ADD COLUMN IF NOT EXISTS closed_on date;                     -- passage à « Clôturé » (étape 5), écrit par advanceEvent
ALTER TABLE vigie.events ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();  -- écrit par saveEvent, advanceEvent, revertEvent
CREATE UNIQUE INDEX IF NOT EXISTS events_nc_number_par_projet ON vigie.events (keystone_project_code, nc_number) WHERE nc_number IS NOT NULL;

-- D13 (à arbitrer) : accueils sécurité de chantier, ligne « induction » du registre HSE de Keystone. Vigie n'a
-- aucun objet équivalent aujourd'hui.
CREATE TABLE IF NOT EXISTS vigie.inductions (
  id                     text NOT NULL,   -- « AS-2026-001 »
  keystone_project_code  text NOT NULL,   -- keystone.pub_projets.code
  title                  text NOT NULL,   -- « Accueil sécurité — modèle port »
  status                 text NOT NULL DEFAULT 'brouillon',
  ready_on               date,
  codex_doc_id           text,            -- D10 : support d'accueil dans Codex (codex.pub_documents.id)
  owner_id               text,
  CONSTRAINT inductions_pkey PRIMARY KEY (id),
  CONSTRAINT inductions_owner_id_people_id_fk FOREIGN KEY (owner_id) REFERENCES vigie.people (id),
  CONSTRAINT inductions_status_check CHECK (status IN ('brouillon', 'pret')),
  CONSTRAINT inductions_pret_check CHECK (status <> 'pret' OR ready_on IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS inductions_keystone_project_code_idx ON vigie.inductions (keystone_project_code);
COMMENT ON TABLE vigie.inductions IS 'D13 : accueils sécurité de chantier, publiés dans vigie.pub_hse_projet (ligne induction).';

-- D10 : lien entre une révision Codex et le plan d'actions (remplace document_versions.action_id). Aucune vue
-- ne la lit ; codex_id est une référence croisée contrôlée par Matrix.
CREATE TABLE IF NOT EXISTS vigie.document_actions (
  codex_id   text NOT NULL,   -- codex.pub_documents.id
  revision   text,            -- lettre de révision Codex
  action_id  text NOT NULL,
  CONSTRAINT document_actions_pkey PRIMARY KEY (codex_id, action_id),
  CONSTRAINT document_actions_action_id_actions_id_fk FOREIGN KEY (action_id) REFERENCES vigie.actions (id)
);
COMMENT ON TABLE vigie.document_actions IS 'D10 : actions de revue liées à un document Codex.';

-- D18 : journal d'audit de Vigie, à créer (environ 80 actions serveur ne laissent aucune trace aujourd'hui).
-- Règles d'écriture (helper logAction, src/lib/) : signalement anonyme sans actor_id ni actor_name ; jamais la
-- nature de la lésion ni les jours d'arrêt (events.injury, events.lost_days) dans detail.
CREATE TABLE IF NOT EXISTS vigie.journal (
  id                     integer GENERATED ALWAYS AS IDENTITY,
  at                     timestamptz NOT NULL DEFAULT now(),
  actor_id               text,
  actor_name             text,
  role                   text NOT NULL,
  action                 text NOT NULL,
  object_ref             text,
  detail                 text NOT NULL DEFAULT '',
  site_id                text,
  keystone_project_code  text,
  CONSTRAINT journal_pkey PRIMARY KEY (id),
  CONSTRAINT journal_actor_id_people_id_fk FOREIGN KEY (actor_id) REFERENCES vigie.people (id),
  CONSTRAINT journal_site_id_sites_id_fk FOREIGN KEY (site_id) REFERENCES vigie.sites (id)
);
CREATE INDEX IF NOT EXISTS journal_at_idx ON vigie.journal (at DESC);
COMMENT ON TABLE vigie.journal IS 'D18 : journal d''audit de Vigie, publié par vigie.pub_journal. Ne contient aucune donnée de santé.';

-- Non traités ici : D02 renommage keystone_project → keystone_project_ancien et suppression de
-- keystone_projects ; D04 keystone_assignments gardée comme cache de keystone.pub_affectations ; D08
-- training_titles gardée comme cache de cursus.pub_titres (label, validity_months) avec sort local ;
-- D09 suppression de qualifications ; D14 sites devient un cache de matrix.pub_sites (label, sort), plus seveso et
-- pp_from_first_minute propres à Vigie ;
-- D13 types de permis levage et travail_ht (contrôle applicatif, components/prevention/model.ts:111).

-- ═══ Vues publiées ═══
-- Contrat : on n'en retire ni ne renomme de colonne (sinon nouvelle vue _v2) ; ajout en fin de liste seulement.
-- security_barrier : les filtres de la vue (type = 'NC'…) s'évaluent avant toute fonction posée par le lecteur,
-- qui ne peut donc pas lire le titre d'un accident par ce chemin.
-- Les noms de colonnes reprennent ceux des miroirs Keystone (vigie_ncrs, vigie_hse_items) : le rafraîchissement
-- se fait par INSERT … SELECT.

-- D13 · Non-conformités de projet ────────────────────────────────────────
CREATE OR REPLACE VIEW vigie.pub_non_conformites WITH (security_barrier) AS
SELECT e.keystone_project_code AS project_code,   -- Keystone : vigie_ncrs.project_code (filtre par projet)
       e.nc_number             AS number,         -- Keystone : vigie_ncrs.number, punch_items.ncr_number, liens (links.ts:56-63)
       e.id                    AS vigie_ref,      -- Keystone : vigie_ref, avancement par API (/api/ncrs/:project/:number/progress)
       e.title,                                   -- Keystone : titre
       CASE WHEN e.severity >= 3 THEN 'critical' WHEN e.severity = 2 THEN 'major' ELSE 'minor' END AS severity,  -- Keystone : gravité
       CASE e.nc_origin WHEN 'Fournisseurs' THEN 'goods_receipt' WHEN 'Fabrication' THEN 'workshop'
            WHEN 'Mise en service' THEN 'site_inspection' WHEN 'Inspection chantier' THEN 'site_inspection'
            WHEN 'Relevé' THEN 'survey' WHEN 'Audit' THEN 'audit' WHEN 'Réclamation client' THEN 'client'
            WHEN 'Conception BE' THEN 'design' ELSE 'workshop' END AS source,  -- Keystone : origine (codes.ts:812)
       (ARRAY['open', 'containment', 'root_cause', 'corrective_action', 'verification', 'closed'])[least(e.step, 5) + 1] AS status,  -- Keystone : étape
       e.keystone_activity_code      AS activity_code,       -- Keystone : volet NC (model.ts:116), export control.ts:127
       e.part_ref,                                           -- Keystone : ECO et commandes de l'article (model.ts:212)
       e.keystone_deliverable_number AS deliverable_number,  -- Keystone : NC liées aux livrables (quality.ts:194)
       e.supplier_id,                                        -- Keystone : barème fournisseurs (suppliers.ts:73)
       e.supplier_name,                                      -- Keystone : vigie_ncrs.supplier_name
       CASE WHEN e.anonymous THEN 'Anonyme' ELSE coalesce(e.declarant, 'Anonyme') END AS raised_by_name,  -- Keystone : déclarant
       e.occurred_on                 AS raised_on,           -- Keystone : date de déclaration
       coalesce(p.name, '—')         AS owner_name,          -- Keystone : pilote (affichage)
       p.matricule                   AS owner_matricule,     -- Keystone : owner_person_id par persons.matricule (D01)
       coalesce(e.root_cause, '')    AS root_cause,          -- Keystone : volet NC
       coalesce(concat_ws(' · ', nullif(e.immediate_measures, ''), act.titres), '') AS action,  -- Keystone : endiguement et actions
       act.prochaine_echeance        AS due_on,              -- Keystone : échéance
       coalesce(e.nc_cost_keur, 0)   AS cost_keur,           -- Keystone : coût de non-qualité (domain/quality.ts:116)
       coalesce(e.iso_clause, '')    AS iso_clause,          -- Keystone : clause ISO 9001
       e.closed_on,                                          -- Keystone : ncrClosureDates (kpis.ts:150-155)
       e.updated_at                  AS vigie_updated_at     -- Keystone : vigie_ncrs.vigie_updated_at
FROM vigie.events e
LEFT JOIN vigie.people p ON p.id = e.pilot_id
LEFT JOIN LATERAL (
  SELECT string_agg(a.title, ' · ' ORDER BY a.due_on, a.id) AS titres,
         min(a.due_on) FILTER (WHERE a.status <> 'done')    AS prochaine_echeance
  FROM vigie.actions a
  WHERE a.event_id = e.id
) act ON true
WHERE e.type = 'NC' AND e.keystone_project_code IS NOT NULL AND e.nc_number IS NOT NULL;
COMMENT ON VIEW vigie.pub_non_conformites IS 'Contrat D13 v1 : NC de projet (type NC, code projet et numéro renseignés). Ni injury ni lost_days. Lecteurs : keystone_app, matrix_app.';

-- D13 · Registre HSE de projet ───────────────────────────────────────────
CREATE OR REPLACE VIEW vigie.pub_hse_projet WITH (security_barrier) AS
WITH projets AS (
  SELECT keystone_project_code AS project_code FROM vigie.prevention_plans WHERE keystone_project_code IS NOT NULL
  UNION SELECT keystone_project_code FROM vigie.permits WHERE keystone_project_code IS NOT NULL
  UNION SELECT keystone_project_code FROM vigie.events WHERE keystone_project_code IS NOT NULL
), lignes AS (
  SELECT pp.keystone_project_code AS project_code, pp.id AS vigie_ref, 'prevention_plan'::text AS kind,
         'Plan de prévention · ' || pp.title AS title,
         CASE WHEN pp.status IN ('signe', 'clos') THEN 'signed' ELSE 'pending' END AS status,
         NULL::text AS status_text,
         CASE WHEN pp.status IN ('signe', 'clos') THEN greatest(pp.signed_eu_on, pp.signed_ee_on) ELSE pp.start_on END AS date_on,
         1 AS groupe, pp.start_on AS tri
  FROM vigie.prevention_plans pp
  WHERE pp.keystone_project_code IS NOT NULL
  UNION ALL
  SELECT pe.keystone_project_code, pe.id, 'permit',
         CASE pe.type WHEN 'feu' THEN 'Permis de feu' WHEN 'essai' THEN 'Permis d''essai' WHEN 'levage' THEN 'Permis de levage'
                      WHEN 'travail_ht' THEN 'Permis de travail HT' ELSE 'Permis' END || ' · ' || pe.location,
         CASE pe.status WHEN 'demande' THEN 'pending' WHEN 'delivre' THEN 'signed' ELSE 'recorded' END,
         NULL, (pe.valid_from AT TIME ZONE 'Europe/Paris')::date, 2, (pe.valid_from AT TIME ZONE 'Europe/Paris')::date
  FROM vigie.permits pe
  WHERE pe.keystone_project_code IS NOT NULL AND pe.status <> 'annule'
  UNION ALL
  SELECT i.keystone_project_code, i.id, 'induction', i.title,
         CASE i.status WHEN 'pret' THEN 'ready' ELSE 'pending' END,
         NULL, i.ready_on, 2, i.ready_on
  FROM vigie.inductions i
  UNION ALL
  SELECT x.project_code, NULL, 'register', 'Registre presqu''accidents', 'recorded',
         count(ev.id) || CASE WHEN count(ev.id) > 1 THEN ' déclarés' ELSE ' déclaré' END, NULL, 3, NULL
  FROM projets x
  LEFT JOIN vigie.events ev ON ev.keystone_project_code = x.project_code AND ev.type = 'PA'
  GROUP BY x.project_code
)
SELECT project_code,   -- Keystone : vigie_hse_items.project_code
       vigie_ref,      -- Keystone : lien vers Vigie (links.ts:90-95) ; nul pour la ligne register
       kind,           -- Keystone : prevention_plan, permit, induction, register (condition « HSE permits », domain/site.ts:99)
       title,          -- Keystone : libellé
       status,         -- Keystone : signed, pending, ready, recorded
       status_text,    -- Keystone : nombre de presqu'accidents en tête (vigieIncidentCount, domain/kpis.ts:315)
       date_on,        -- Keystone : date
       (row_number() OVER (PARTITION BY project_code ORDER BY groupe, tri NULLS LAST, vigie_ref) - 1)::integer AS position  -- Keystone : ordre
FROM lignes;
COMMENT ON VIEW vigie.pub_hse_projet IS 'Contrat D13 v1 : registre HSE par projet Keystone (plans de prévention, permis, accueils, nombre de presqu''accidents). Lecteurs : keystone_app, matrix_app.';

-- D18 · Journal ──────────────────────────────────────────────────────────
-- Colonnes communes aux quatre pub_journal (même ordre, mêmes types), réunies par matrix.journal_unifie.
CREATE OR REPLACE VIEW vigie.pub_journal WITH (security_barrier) AS
SELECT 'journal:' || j.id::text          AS ref_source,  -- Matrix : ligne d'origine
       'audit'::text                     AS nature,      -- Matrix : filtre
       j.at                              AS quand,       -- Matrix : tri, période
       coalesce(j.actor_name, 'Anonyme') AS qui,         -- Matrix : nom affiché (signalement anonyme)
       j.actor_id                        AS qui_ref,     -- Matrix : identifiant local (slug Vigie)
       j.role                            AS qui_role,    -- Matrix : rôle Vigie
       j.action,                                         -- Matrix : code d'action
       j.object_ref                      AS objet,       -- Matrix : objet visé
       j.detail,                                         -- Matrix : détail (sans donnée de santé)
       j.keystone_project_code           AS projet,      -- Matrix : filtre par projet
       p.matricule                       AS qui_matricule  -- Matrix : rapprochement des auteurs entre outils (D01)
FROM vigie.journal j
LEFT JOIN vigie.people p ON p.id = j.actor_id;
COMMENT ON VIEW vigie.pub_journal IS 'Contrat D18 v1 : journal d''audit de Vigie aux colonnes communes. Lecteur : matrix_app (matrix.journal_unifie).';
