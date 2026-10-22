-- Partage des données EPC2I, fichier 60 : demandes (ECR) et ordres (ECO) de modification, tenus par Vigie (D12).
--
-- ╔══════════════════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ À NE PAS JOUER tant que le module ECR / ECO n'existe pas dans Vigie (état au 18/10/2026 : aucune table      ║
-- ║ ecos, ecrs… dans le schéma de Vigie). Ce fichier est la spécification du futur module : ses tables iront dans ║
-- ║ schema.ts et les migrations de Vigie (décision P-02 : le partage passe par les migrations de l'outil), puis ce ║
-- ║ fichier sera aligné sur elles comme 50-vigie.sql. Joué aujourd'hui, il créerait dans vigie des tables          ║
-- ║ inconnues de Vigie, que sa prochaine migration générée chercherait à supprimer. 90-droits.sql signale les     ║
-- ║ quatre vues absentes (WARNING) sans échouer.                                                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- D12 option A : Vigie numérote, instruit, approuve et libère toutes les demandes et tous les ordres, qu'ils
-- viennent de Codex, de Keystone ou de Vigie. Codex (change_requests) et Keystone (vigie_eco*) gardent des
-- miroirs, remplis par SELECT sur les vues ci-dessous. Les écritures des autres outils passent par l'API Vigie :
--   POST /api/ecrs                         Codex crée une demande (réponse 201 { id }, 409 change_pending)
--   POST /api/ecos/:number/progress        Keystone enregistre une approbation ou une étape
--   POST /api/ncrs/:project/:number/progress  Keystone fait avancer une NC (D13, même journal external_progress)
--
-- Ce fichier est le DDL PostgreSQL de référence. À reporter dans src/db/schema.ts de Vigie (pgTable), puis
-- npm run db:generate ; les vues vont dans une migration SQL écrite à la main (drizzle-kit ne gère pas ces vues) ;
-- les droits des lecteurs restent dans 90-droits.sql.
-- Exécution (une fois le module construit) : en tant que vigie_app, après les migrations de Vigie (voir README.md).
--   psql "postgres://vigie_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/60-vigie-ecr-eco.sql
-- Rejouable (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE VIEW). Droits : 90-droits.sql.
-- Valeurs calculées, jamais stockées (convention de Vigie, CLAUDE.md) : pending_dispositions et locked.

\set ON_ERROR_STOP on
-- Sans afficheur page par page : dans un terminal web (Coolify), il bloquait le script transaction ouverte.
\pset pager off

-- ═══ Tables ═══

-- Ordres de modification.
CREATE TABLE IF NOT EXISTS vigie.ecos (
  id                      text           NOT NULL,                  -- « ECO-2026-015 »
  title                   text           NOT NULL,
  eco_type                text           NOT NULL,                  -- rev | sub | asm | sup | obs
  status                  text           NOT NULL DEFAULT 'draft',  -- draft | impact_analysis | in_approval | released | rejected
  interchangeability      text,                                     -- yes | no ; NULL = non évaluée (soumission interdite)
  from_revision           text           NOT NULL,
  to_revision             text           NOT NULL,
  cost_eur                numeric(12, 2) NOT NULL DEFAULT 0,
  schedule_days           integer        NOT NULL DEFAULT 0,
  stock_impact            text           NOT NULL DEFAULT '',
  requested_by_name       text           NOT NULL,
  requested_by_matricule  text,                                     -- D01 : matricule Cursus du demandeur
  raised_on               date           NOT NULL,
  pilot_id                text,                                     -- pilote dans Vigie (plan d'actions)
  site_id                 text,                                     -- NULL = tous sites (filtre currentSiteId)
  source                  text           NOT NULL DEFAULT 'vigie',  -- vigie | keystone | codex
  released_at             timestamptz,
  rejected_at             timestamptz,
  created_at              timestamptz    NOT NULL DEFAULT now(),
  updated_at              timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT ecos_pkey PRIMARY KEY (id),
  CONSTRAINT ecos_pilot_id_people_id_fk FOREIGN KEY (pilot_id) REFERENCES vigie.people (id),
  CONSTRAINT ecos_site_id_sites_id_fk FOREIGN KEY (site_id) REFERENCES vigie.sites (id),
  CONSTRAINT ecos_id_check CHECK (id ~ '^ECO-[0-9]{4}-[0-9]{3,}$'),
  CONSTRAINT ecos_eco_type_check CHECK (eco_type IN ('rev', 'sub', 'asm', 'sup', 'obs')),
  CONSTRAINT ecos_status_check CHECK (status IN ('draft', 'impact_analysis', 'in_approval', 'released', 'rejected')),
  CONSTRAINT ecos_interchangeability_check CHECK (interchangeability IN ('yes', 'no')),
  CONSTRAINT ecos_requested_by_matricule_check CHECK (requested_by_matricule ~ '^EMP-[0-9]{4,}$'),
  CONSTRAINT ecos_source_check CHECK (source IN ('vigie', 'keystone', 'codex')),
  CONSTRAINT ecos_released_check CHECK (released_at IS NULL OR status = 'released'),
  CONSTRAINT ecos_rejected_check CHECK (rejected_at IS NULL OR status = 'rejected')
);
CREATE INDEX IF NOT EXISTS ecos_status_idx ON vigie.ecos (status);
CREATE INDEX IF NOT EXISTS ecos_pilot_id_idx ON vigie.ecos (pilot_id);
COMMENT ON TABLE vigie.ecos IS 'D12 : ordres de modification (ECO). Vigie fait foi ; publiés par vigie.pub_ordres_modification.';
COMMENT ON COLUMN vigie.ecos.id IS 'Numéro ECO-AAAA-NNN, attribué par Vigie (nextRef). Repris tel quel des miroirs Keystone (ECO-2026-011 à 017). Référencé en texte par keystone.warranty_claims, revision_diffs, drawings, drawing_revisions (eco_number) et codex.revisions.change_ref.';
COMMENT ON COLUMN vigie.ecos.released_at IS 'Date de libération. Keystone l''estimait à partir de la dernière décision (domain/kpis.ts:337-344, ecoReleaseDate).';

-- Demandes de modification.
CREATE TABLE IF NOT EXISTS vigie.ecrs (
  id                     text        NOT NULL,   -- « ECR-2026-004 », numéroté par Vigie
  kind                   text        NOT NULL,   -- modification | obsolescence
  subject                text        NOT NULL,   -- document | part | project | event
  title                  text        NOT NULL,
  reason                 text        NOT NULL,
  description            text        NOT NULL DEFAULT '',
  source                 text        NOT NULL,   -- codex | keystone | vigie
  codex_doc_id           text,                   -- D10 : codex.pub_documents.id
  keystone_project_code  text,                   -- D02 : keystone.pub_projets.code
  part_ref               text,                   -- keystone.pub_articles.ref
  event_id               text,                   -- NC à l'origine de la demande
  requester_name         text        NOT NULL,
  requester_matricule    text,                   -- D01
  requester_ref          text,                   -- identifiant dans l'outil émetteur (codex.users.id : « jwagner »)
  status                 text        NOT NULL DEFAULT 'submitted',  -- submitted | accepted | rejected | implemented
  eco_id                 text,
  modifier_ref           text,                   -- codex.users.id du rédacteur désigné (modifierId du webhook)
  decision_note          text,
  decided_by_id          text,
  decided_at             timestamptz,
  implemented_at         timestamptz,            -- réponse 200 du webhook Codex
  codex_revision         text,                   -- lettre de révision ouverte par Codex
  notify_status          text,                   -- pending | sent | failed (webhook vers Codex)
  notify_attempts        integer     NOT NULL DEFAULT 0,
  notify_error           text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ecrs_pkey PRIMARY KEY (id),
  CONSTRAINT ecrs_event_id_events_id_fk FOREIGN KEY (event_id) REFERENCES vigie.events (id),
  CONSTRAINT ecrs_eco_id_ecos_id_fk FOREIGN KEY (eco_id) REFERENCES vigie.ecos (id),
  CONSTRAINT ecrs_decided_by_id_people_id_fk FOREIGN KEY (decided_by_id) REFERENCES vigie.people (id),
  CONSTRAINT ecrs_id_check CHECK (id ~ '^ECR-[0-9]{4}-[0-9]{3,}$'),
  CONSTRAINT ecrs_kind_check CHECK (kind IN ('modification', 'obsolescence')),
  CONSTRAINT ecrs_subject_check CHECK (subject IN ('document', 'part', 'project', 'event')),
  CONSTRAINT ecrs_objet_check CHECK (
    (subject = 'document' AND codex_doc_id IS NOT NULL) OR (subject = 'part' AND part_ref IS NOT NULL)
    OR (subject = 'project' AND keystone_project_code IS NOT NULL) OR (subject = 'event' AND event_id IS NOT NULL)),
  CONSTRAINT ecrs_source_check CHECK (source IN ('codex', 'keystone', 'vigie')),
  CONSTRAINT ecrs_requester_matricule_check CHECK (requester_matricule ~ '^EMP-[0-9]{4,}$'),
  CONSTRAINT ecrs_status_check CHECK (status IN ('submitted', 'accepted', 'rejected', 'implemented')),
  CONSTRAINT ecrs_decision_check CHECK (status = 'submitted' OR decided_at IS NOT NULL),
  CONSTRAINT ecrs_implemented_check CHECK (status <> 'implemented' OR implemented_at IS NOT NULL),
  CONSTRAINT ecrs_notify_status_check CHECK (notify_status IN ('pending', 'sent', 'failed')),
  CONSTRAINT ecrs_notify_attempts_check CHECK (notify_attempts >= 0)
);
-- Une seule demande en cours par document (règle change_requests_pending de Codex, schema.ts:315).
CREATE UNIQUE INDEX IF NOT EXISTS ecrs_one_open_per_document ON vigie.ecrs (codex_doc_id)
  WHERE codex_doc_id IS NOT NULL AND status IN ('submitted', 'accepted');
CREATE INDEX IF NOT EXISTS ecrs_eco_id_idx ON vigie.ecrs (eco_id);
CREATE INDEX IF NOT EXISTS ecrs_event_id_idx ON vigie.ecrs (event_id);
CREATE INDEX IF NOT EXISTS ecrs_notify_idx ON vigie.ecrs (notify_status) WHERE notify_status IN ('pending', 'failed');
COMMENT ON TABLE vigie.ecrs IS 'D12 : demandes de modification (ECR), nées dans Codex, Keystone ou Vigie. Publiées par vigie.pub_demandes_modification ; codex.change_requests en est le miroir.';
COMMENT ON COLUMN vigie.ecrs.id IS 'Numéro ECR-AAAA-NNN, attribué par Vigie et renvoyé à Codex par POST /api/ecrs. Les demandes Codex ECR-2026-001 à 003 sont reprises avec leur numéro.';

-- Approbations d'un ECO (trois clés).
CREATE TABLE IF NOT EXISTS vigie.eco_approvals (
  eco_id                text        NOT NULL,
  approval_key          text        NOT NULL,                     -- englead | quality | pm
  approver_text         text        NOT NULL,                     -- « Antoine Girard » ; PM : « R. Aubert, C. Moreau »
  decision              text        NOT NULL DEFAULT 'pending',   -- pending | ok | rejected
  decided_by_name       text,
  decided_by_matricule  text,                                     -- D01
  decided_at            timestamptz,
  comment               text,
  via                   text,                                     -- vigie | keystone
  CONSTRAINT eco_approvals_pkey PRIMARY KEY (eco_id, approval_key),
  CONSTRAINT eco_approvals_eco_id_ecos_id_fk FOREIGN KEY (eco_id) REFERENCES vigie.ecos (id) ON DELETE CASCADE,
  CONSTRAINT eco_approvals_approval_key_check CHECK (approval_key IN ('englead', 'quality', 'pm')),
  CONSTRAINT eco_approvals_decision_check CHECK (decision IN ('pending', 'ok', 'rejected')),
  CONSTRAINT eco_approvals_matricule_check CHECK (decided_by_matricule ~ '^EMP-[0-9]{4,}$'),
  CONSTRAINT eco_approvals_via_check CHECK (via IN ('vigie', 'keystone'))
);
COMMENT ON TABLE vigie.eco_approvals IS 'D12 : approbations d''un ECO. Les approbations reprises du prototype Keystone n''ont pas de decided_at.';

-- Articles visés par un ECO.
CREATE TABLE IF NOT EXISTS vigie.eco_parts (
  eco_id    text    NOT NULL,
  part_ref  text    NOT NULL,   -- keystone.pub_articles.ref
  position  integer NOT NULL,
  CONSTRAINT eco_parts_pkey PRIMARY KEY (eco_id, part_ref),
  CONSTRAINT eco_parts_eco_id_ecos_id_fk FOREIGN KEY (eco_id) REFERENCES vigie.ecos (id) ON DELETE CASCADE
);
COMMENT ON TABLE vigie.eco_parts IS 'D12 : articles Keystone visés par un ECO (référence texte, contrôlée par Matrix).';

-- Projets visés par un ECO.
CREATE TABLE IF NOT EXISTS vigie.eco_projects (
  eco_id                 text    NOT NULL,
  keystone_project_code  text    NOT NULL,   -- keystone.pub_projets.code (« HLT-026 »)
  position               integer NOT NULL,
  CONSTRAINT eco_projects_pkey PRIMARY KEY (eco_id, keystone_project_code),
  CONSTRAINT eco_projects_eco_id_ecos_id_fk FOREIGN KEY (eco_id) REFERENCES vigie.ecos (id) ON DELETE CASCADE
);
COMMENT ON TABLE vigie.eco_projects IS 'D12 : projets Keystone visés par un ECO (la clé PM se contrôle par keystone.pub_projets).';

-- Effectivité : disposition de chaque cible (projet ou machine du parc).
CREATE TABLE IF NOT EXISTS vigie.eco_effectivity (
  eco_id           text    NOT NULL,
  target_type      text    NOT NULL,                 -- project | machine
  target_ref       text    NOT NULL,                 -- code projet « HLT-026 » ou keystone.pub_parc_machines.number « MCH-029 »
  label            text    NOT NULL,
  disposition      text,                             -- update | pinned | retrofit | na ; NULL = à décider
  is_automatic     boolean NOT NULL DEFAULT false,   -- proposée depuis keystone.pub_nomenclatures ou pub_parc_machines
  note             text,
  fitted_part_ref  text,
  fitted_revision  text,
  position         integer NOT NULL,
  CONSTRAINT eco_effectivity_pkey PRIMARY KEY (eco_id, target_type, target_ref),
  CONSTRAINT eco_effectivity_eco_id_ecos_id_fk FOREIGN KEY (eco_id) REFERENCES vigie.ecos (id) ON DELETE CASCADE,
  CONSTRAINT eco_effectivity_target_type_check CHECK (target_type IN ('project', 'machine')),
  CONSTRAINT eco_effectivity_disposition_check CHECK (disposition IN ('update', 'pinned', 'retrofit', 'na'))
);
COMMENT ON TABLE vigie.eco_effectivity IS 'D12 : effectivité d''un ECO, une ligne par projet ou machine visé.';

-- Documents cités par un ECO (remplace le tableau texte keystone.vigie_ecos.document_refs).
CREATE TABLE IF NOT EXISTS vigie.eco_documents (
  eco_id        text    NOT NULL,
  position      integer NOT NULL,
  ref_label     text    NOT NULL,   -- « DWG-AS-9000 C », « Fire detection layout HLT-FD-004 »
  codex_doc_id  text,               -- D10 : codex.pub_documents.id quand le document est dans Codex
  ecr_id        text,               -- demande transmise à Codex pour ce document
  CONSTRAINT eco_documents_pkey PRIMARY KEY (eco_id, position),
  CONSTRAINT eco_documents_eco_id_ecos_id_fk FOREIGN KEY (eco_id) REFERENCES vigie.ecos (id) ON DELETE CASCADE,
  CONSTRAINT eco_documents_ecr_id_ecrs_id_fk FOREIGN KEY (ecr_id) REFERENCES vigie.ecrs (id)
);
CREATE INDEX IF NOT EXISTS eco_documents_ecr_id_idx ON vigie.eco_documents (ecr_id);
COMMENT ON TABLE vigie.eco_documents IS 'D12 : documents cités par un ECO, avec l''identifiant Codex quand il est connu.';

-- Lien ECO ↔ plan d'actions unique (même principe que risk_actions).
CREATE TABLE IF NOT EXISTS vigie.eco_actions (
  eco_id     text NOT NULL,
  action_id  text NOT NULL,
  CONSTRAINT eco_actions_pkey PRIMARY KEY (eco_id, action_id),
  CONSTRAINT eco_actions_eco_id_ecos_id_fk FOREIGN KEY (eco_id) REFERENCES vigie.ecos (id) ON DELETE CASCADE,
  CONSTRAINT eco_actions_action_id_actions_id_fk FOREIGN KEY (action_id) REFERENCES vigie.actions (id)
);
CREATE INDEX IF NOT EXISTS eco_actions_action_id_idx ON vigie.eco_actions (action_id);
COMMENT ON TABLE vigie.eco_actions IS 'D12 : actions du plan d''actions liées à un ECO (origine « eco »).';

-- Avancements reçus des autres outils (ECO et NC). Trace exigée par ISO 9001 § 8.5.6 et idempotence des envois.
CREATE TABLE IF NOT EXISTS vigie.external_progress (
  id               text        NOT NULL,   -- renvoyé à Keystone ({ id }) et stocké dans vigie_*_progress.vigie_ref
  source           text        NOT NULL,   -- keystone | codex
  external_id      text        NOT NULL,   -- keystoneId (uuid de l'outbox Keystone)
  entity_type      text        NOT NULL,   -- eco | nc
  entity_id        text        NOT NULL,   -- ecos.id | events.id
  kind             text        NOT NULL,   -- approval | step | verification
  approval_key     text,
  decision         text,
  from_status      text,
  target_status    text,
  comment          text,
  actor_name       text        NOT NULL,
  actor_role       text        NOT NULL,
  actor_matricule  text,                   -- D01
  recorded_at      timestamptz NOT NULL,   -- heure de l'action chez l'émetteur
  received_at      timestamptz NOT NULL DEFAULT now(),
  outcome          text        NOT NULL,   -- applied | refused
  refusal_reason   text,
  CONSTRAINT external_progress_pkey PRIMARY KEY (id),
  CONSTRAINT external_progress_source_external_id_unique UNIQUE (source, external_id),
  CONSTRAINT external_progress_source_check CHECK (source IN ('keystone', 'codex')),
  CONSTRAINT external_progress_entity_type_check CHECK (entity_type IN ('eco', 'nc')),
  CONSTRAINT external_progress_kind_check CHECK (kind IN ('approval', 'step', 'verification')),
  CONSTRAINT external_progress_approval_check CHECK (kind <> 'approval' OR (entity_type = 'eco' AND approval_key IN ('englead', 'quality', 'pm'))),
  CONSTRAINT external_progress_matricule_check CHECK (actor_matricule ~ '^EMP-[0-9]{4,}$'),
  CONSTRAINT external_progress_outcome_check CHECK (outcome IN ('applied', 'refused')),
  CONSTRAINT external_progress_refus_check CHECK ((outcome = 'refused') = (refusal_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS external_progress_entity_idx ON vigie.external_progress (entity_type, entity_id);
COMMENT ON TABLE vigie.external_progress IS 'D12 et D13 : avancements reçus par l''API de Vigie (ECO, NC), appliqués ou refusés. Unique par (source, external_id) : un envoi rejoué ne s''applique qu''une fois.';

-- ═══ Vues publiées ═══
-- Contrat : on n'en retire ni ne renomme de colonne (sinon nouvelle vue _v2) ; ajout en fin de liste seulement.
-- Les noms reprennent ceux des miroirs keystone.vigie_ecos, vigie_eco_approvals, vigie_eco_effectivity et
-- codex.change_requests : le rafraîchissement se fait par INSERT … SELECT.

CREATE OR REPLACE VIEW vigie.pub_ordres_modification WITH (security_barrier) AS
SELECT e.id                  AS number,               -- Keystone : vigie_ecos.number, links.ts:24, dal/eco.ts:115-123
       e.title,                                       -- Keystone : dal/eco.ts:194
       e.eco_type,                                    -- Keystone : dal/eco.ts:66
       e.status,                                      -- Keystone : dal/eco.ts:67, progress.ts:43
       e.interchangeability,                          -- Keystone : dal/eco.ts:68, progress.ts:61
       e.from_revision,                               -- Keystone : features/eco/model.ts, domain/parts.ts
       e.to_revision,                                 -- Keystone : idem
       e.cost_eur,                                    -- Keystone : model.ts:107, domain/eco.ts:130
       e.schedule_days,                               -- Keystone : model.ts:108
       e.stock_impact,                                -- Keystone : model.ts:237
       ARRAY(SELECT d.ref_label FROM vigie.eco_documents d WHERE d.eco_id = e.id ORDER BY d.position) AS document_refs,  -- Keystone : vigie_ecos.document_refs (model.ts:240)
       ARRAY(SELECT d.codex_doc_id FROM vigie.eco_documents d
             WHERE d.eco_id = e.id AND d.codex_doc_id IS NOT NULL ORDER BY d.position) AS codex_doc_ids,             -- Keystone : lien vers Codex (D10)
       e.requested_by_name,                           -- Keystone : model.ts:103
       e.requested_by_matricule,                      -- Keystone : requested_by_person_id par persons.matricule (D01)
       e.raised_on,                                   -- Keystone : model.ts:103, domain/kpis.ts:337
       coalesce(f.en_attente, 0)::integer AS pending_dispositions,  -- Keystone : domain/eco.ts:126, 133
       (coalesce(a.n, 0) = 3 AND a.toutes_ok AND e.status NOT IN ('draft', 'rejected')
        AND (coalesce(f.en_attente, 0) > 0 OR e.interchangeability IS NULL)) AS locked,  -- Keystone : domain/eco.ts:225-227, 274
       ARRAY(SELECT p.part_ref FROM vigie.eco_parts p WHERE p.eco_id = e.id ORDER BY p.position) AS parts,  -- Keystone : vigie_eco_parts (plm.ts:106, fleet.ts:168)
       ARRAY(SELECT pr.keystone_project_code FROM vigie.eco_projects pr
             WHERE pr.eco_id = e.id ORDER BY pr.position) AS projects,                                        -- Keystone : vigie_eco_projects (progress.ts:47-51)
       e.released_at,                                 -- Keystone : vigie_ecos.released_at (ecoReleaseDate)
       e.updated_at          AS vigie_updated_at      -- Keystone : vigie_ecos.vigie_updated_at (mirror.ts:32)
FROM vigie.ecos e
LEFT JOIN (SELECT eco_id, count(*) AS n, bool_and(decision = 'ok') AS toutes_ok
           FROM vigie.eco_approvals GROUP BY eco_id) a ON a.eco_id = e.id
LEFT JOIN (SELECT eco_id, count(*) FILTER (WHERE disposition IS NULL) AS en_attente
           FROM vigie.eco_effectivity GROUP BY eco_id) f ON f.eco_id = e.id;
COMMENT ON VIEW vigie.pub_ordres_modification IS 'Contrat D12 v1 : ordres de modification, avec articles, projets et documents en tableaux. Lecteurs : keystone_app, matrix_app.';

CREATE OR REPLACE VIEW vigie.pub_eco_approbations WITH (security_barrier) AS
SELECT a.eco_id AS eco_number,   -- Keystone : jointure vigie_ecos.number
       a.approval_key,           -- Keystone : englead, quality, pm (dal/eco.ts:70-73)
       a.decision,               -- Keystone : progress.ts:44-51
       a.approver_text,          -- Keystone : approbateur attendu
       a.decided_by_name,        -- Keystone : qui a décidé
       a.decided_by_matricule,   -- Keystone : rattachement à persons (D01)
       a.decided_at              -- Keystone : date de décision
FROM vigie.eco_approvals a;
COMMENT ON VIEW vigie.pub_eco_approbations IS 'Contrat D12 v1 : approbations des ECO. Lecteurs : keystone_app, matrix_app.';

CREATE OR REPLACE VIEW vigie.pub_eco_effectivite WITH (security_barrier) AS
SELECT t.eco_id AS eco_number,   -- Keystone : jointure vigie_ecos.number
       t.target_type,            -- Keystone : project ou machine
       t.target_ref,             -- Keystone : code projet ou numéro de machine
       t.label,                  -- Keystone : libellé
       t.disposition,            -- Keystone : domain/eco.ts:306-321
       t.is_automatic,           -- Keystone : effectivité proposée
       t.note,                   -- Keystone : affichage
       t.fitted_part_ref,        -- Keystone : article monté
       t.fitted_revision,        -- Keystone : révision montée
       t.position                -- Keystone : ordre
FROM vigie.eco_effectivity t;
COMMENT ON VIEW vigie.pub_eco_effectivite IS 'Contrat D12 v1 : effectivité des ECO. Lecteurs : keystone_app, matrix_app.';

CREATE OR REPLACE VIEW vigie.pub_demandes_modification WITH (security_barrier) AS
SELECT r.id,                                          -- Codex : change_requests.id ; Keystone : suivi des demandes nées chez lui
       r.kind,                                        -- Codex : modification ou obsolescence (lifecycle.ts:146-160)
       r.codex_doc_id        AS doc_id,               -- Codex : change_requests.doc_id
       CASE WHEN r.source = 'codex' THEN r.requester_ref ELSE r.source END AS requester_id,  -- Codex : users.id (comptes système vigie, keystone)
       r.requester_name,                              -- Codex : queries.ts:194
       r.requester_matricule,                         -- Codex, Keystone : rattachement (D01)
       r.reason,                                      -- Codex : documents/[id]/page.tsx:431
       r.description,                                 -- Codex : page.tsx:432
       r.status,                                      -- Codex : actions.ts:406, 575 (demande en cours)
       r.eco_id              AS eco_ref,              -- Codex : change_requests.eco_ref, revisions.change_ref
       r.modifier_ref        AS modifier_id,          -- Codex : rédacteur désigné (route.ts:43-46)
       r.decision_note,                               -- Codex : page.tsx:438
       r.source,                                      -- Codex : origine (D-18)
       r.subject,                                     -- Keystone : objet de la demande (article, projet)
       r.keystone_project_code AS project_code,       -- Keystone : filtre par projet
       r.part_ref,                                    -- Keystone : filtre par article
       r.event_id,                                    -- Keystone : NC à l'origine
       r.created_at,                                  -- Codex : change_requests.created_at
       r.decided_at,                                  -- Codex : change_requests.decided_at
       r.implemented_at,                              -- Codex, Keystone : révision ouverte dans Codex
       r.codex_revision                               -- Codex, Keystone : lettre de la révision ouverte
FROM vigie.ecrs r;
COMMENT ON VIEW vigie.pub_demandes_modification IS 'Contrat D12 v1 : demandes de modification. Codex la lit pour une demande inconnue reçue par webhook (route.ts:48-49) et pour un contrôle de cohérence. Lecteurs : codex_app, keystone_app, matrix_app.';
