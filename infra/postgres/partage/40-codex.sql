-- Partage des données EPC2I, fichier 40 : vues publiées par Codex (schéma codex).
--
-- Décisions : D10 documents, D11 registre des types et circuits, D18 journal.
-- Prérequis portés par d'autres décisions : D01 (users.matricule), D15 (departments.active).
-- Exécution : en tant que codex_app, après les migrations Drizzle de Codex (voir README.md).
--   psql "postgres://codex_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/40-codex.sql
-- Rejouable. Les vues ne lisent que des tables du schéma codex. Droits : 90-droits.sql.
--
-- Contrôle d'accès : les vues ne reprennent pas les règles par utilisateur de Codex (src/lib/access.ts:66-84 :
-- brouillons visibles du cercle de rédaction, « confidentiel » limité au département ou au projet). Elles
-- excluent les documents « tres_confidentiel » ; les lecteurs appliquent conf eux-mêmes.

\set ON_ERROR_STOP on

-- ═══ Prérequis : colonnes à ajouter (à reporter dans les migrations de l'outil) ═══
-- Destination : src/db/schema.ts puis une migration drizzle/00xx. ADD COLUMN IF NOT EXISTS : sans effet si la
-- colonne existe déjà ; la contrainte écrite dans la définition de colonne suit le même sort.

-- D10 : champs des documents maîtrisés de Vigie, repris dans Codex.
ALTER TABLE codex.documents ADD COLUMN IF NOT EXISTS distribution text NOT NULL DEFAULT '';  -- Vigie : liste de diffusion (DocumentPanel.tsx:151)
ALTER TABLE codex.documents
  ADD COLUMN IF NOT EXISTS review_months integer                                          -- Vigie : périodicité de revue (documents.ts:118)
    CONSTRAINT documents_review_months_check CHECK (review_months > 0);
ALTER TABLE codex.documents ADD COLUMN IF NOT EXISTS process_code text;                    -- Vigie : processus ISO 9001 (filtre « Processus »)

-- D01 : matricule Cursus d'un utilisateur ; nul pour les comptes système (keystone, vigie…).
ALTER TABLE codex.users
  ADD COLUMN IF NOT EXISTS matricule text
    CONSTRAINT users_matricule_unique UNIQUE
    CONSTRAINT users_matricule_check CHECK (matricule IS NULL OR (matricule ~ '^EMP-[0-9]{4,}$' AND NOT is_system));

-- D15 : departments devient un cache de matrix.pub_organigramme (niveau departement) ; une unité fermée reste
-- (clé documents.department), marquée inactive.
ALTER TABLE codex.departments ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- D18 : index de pub_journal.
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON codex.audit_log (at);

-- Non traités ici : D01 suppression de users.title, puis de users.department et users.site (valeurs de repli) ;
-- D12 codex.change_requests reste un miroir de vigie.pub_demandes_modification.

-- ═══ Vues publiées ═══
-- Contrat : on n'en retire ni ne renomme de colonne (sinon nouvelle vue _v2) ; ajout en fin de liste seulement.
-- security_barrier : le filtre conf <> 'tres_confidentiel' s'évalue avant toute fonction posée par le lecteur.

-- D10 · Documents ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW codex.pub_documents WITH (security_barrier) AS
SELECT d.id,                 -- Keystone : documents.codex_id ; Vigie : document_actions.codex_id, ecos (eco_documents.codex_doc_id)
       d.aliases,            -- Keystone : anciens numéros (PFD-HLT-026…) ; Vigie : anciens identifiants (POL-QHSE-001…)
       d.title,              -- Keystone, Vigie : titre
       d.origin,             -- Keystone : dépôt (interne, externe)
       d.attachment,         -- Vigie : périmètre QHSE (attachment = 'none')
       d.project_code,       -- Keystone : documents du projet ; Vigie : filtre
       d.program_code,       -- Keystone : programme de recherche
       d.family,             -- Keystone : puces de filtre du coffre
       d.type_code,          -- Keystone : type (pub_types_document) ; Vigie : POL, PRO, FRM, REC
       d.subtype,            -- Keystone : « Liste d’instruments » (remplace le préfixe LST-INS-) ; Vigie : instruction de travail
       d.department,         -- Vigie : périmètre QHSE (QUA, HSE)
       d.site,               -- Vigie : filtre de site
       d.owner_id,           -- Keystone, Vigie : propriétaire (identifiant Codex)
       o.name AS owner_name, -- Keystone, Vigie : affichage du propriétaire
       d.author_id,          -- Keystone : auteur (identifiant Codex)
       coalesce(a.name, d.author_text) AS author_name,  -- Keystone : documents.author_name
       d.conf,               -- Keystone, Vigie : confidentialité à appliquer (interne, restreint, confidentiel)
       d.keywords,           -- Keystone : tags
       d.lang,               -- Keystone : affichage
       d.state,              -- Keystone, Vigie : obsolete, archived
       d.status,             -- Keystone, Vigie : statut du document
       d.rev_in_force,       -- Keystone : current_revision ; Vigie : version en vigueur
       d.rev_working,        -- Keystone : révision en cours ; Vigie : brouillon ou revue
       d.issued_at,          -- Keystone : issued_on
       d.review_due_at,      -- Vigie : revue en retard ou bientôt (indicateurs, « À traiter »)
       d.expires_at,         -- Keystone, Vigie : échéance
       d.discipline,         -- Keystone : registre d'ingénierie
       d.project_phase,      -- Keystone : phase du projet
       d.work_package,       -- Keystone : lot
       d.source_org,         -- Keystone : organisme émetteur (CER, COC)
       d.external_ref,       -- Keystone : référence externe
       d.legal_hold,         -- Keystone, Vigie : gel juridique
       d.obsolete_at,        -- Vigie : date de retrait
       d.archived_at,        -- Vigie : archivage
       d.created_at,         -- Keystone, Vigie : création
       d.modified_at,        -- Keystone, Vigie : rafraîchissement
       d.distribution,       -- Vigie : « Diffusion »
       d.review_months,      -- Vigie : périodicité de revue
       d.process_code,       -- Vigie : filtre « Processus »
       o.matricule AS owner_matricule  -- Vigie : pilote de l'action de revue (vigie.people.matricule) ; Keystone : persons.matricule
FROM codex.documents d
JOIN codex.users o      ON o.id = d.owner_id
LEFT JOIN codex.users a ON a.id = d.author_id
WHERE d.conf <> 'tres_confidentiel';
COMMENT ON VIEW codex.pub_documents IS 'Contrat D10 v1 : fiches documents de Codex, sans les « tres_confidentiel ». Les lecteurs appliquent conf. Lecteurs : keystone_app, vigie_app, matrix_app.';

CREATE OR REPLACE VIEW codex.pub_revisions_document WITH (security_barrier) AS
SELECT r.id            AS revision_id,      -- Keystone, Vigie : clé de la révision
       r.doc_id,                            -- Keystone, Vigie : jointure pub_documents.id
       r.letter,                            -- Keystone : document_acknowledgements.revision ; Vigie : version
       r.status,                            -- Vigie : brouillon, en_revue, approuve, archive
       r.created_at,                        -- Keystone, Vigie : historique
       r.effective_at,                      -- Keystone : « Approuvé, effet le … »
       r.approved_at,                       -- Vigie : approved_on
       r.in_force_at,                       -- Vigie : mise en vigueur
       r.superseded_at,                     -- Vigie : archivage de la version
       r.modifier_id,                       -- Keystone : rédacteur désigné
       r.change_ref,                        -- Keystone, Vigie : ECR ou ECO à l'origine (vigie.pub_*_modification)
       (SELECT count(*) FROM codex.working_versions w WHERE w.revision_id = r.id)::integer AS working_versions,  -- Keystone : nombre de versions de travail
       lv.id           AS last_version_id,          -- Keystone, Vigie : dernière version de travail
       lv.n            AS last_version_n,           -- Keystone : numéro
       lv.date         AS last_version_date,        -- Vigie : submitted_on
       lv.author_id    AS last_version_author_id,   -- Vigie : auteur
       va.name         AS last_version_author_name, -- Vigie : affichage
       coalesce(lv.comment ->> 'fr', lv.comment #>> '{}') AS last_version_comment,  -- Vigie : summary
       lv.file_name,                                -- Keystone, Vigie : fichier (lien vers Codex)
       lv.mime,                                     -- Keystone, Vigie : type du fichier
       lv.size                                      -- Keystone, Vigie : taille
FROM codex.revisions r
JOIN codex.documents d ON d.id = r.doc_id AND d.conf <> 'tres_confidentiel'
LEFT JOIN LATERAL (
  SELECT w.id, w.n, w.date, w.author_id, w.comment, w.file_name, w.mime, w.size
  FROM codex.working_versions w
  WHERE w.revision_id = r.id
  ORDER BY w.n DESC
  LIMIT 1
) lv ON true
LEFT JOIN codex.users va ON va.id = lv.author_id;
COMMENT ON VIEW codex.pub_revisions_document IS 'Contrat D10 v1 : révisions des documents publiés, avec leur dernière version de travail. Lecteurs : keystone_app, vigie_app, matrix_app.';

CREATE OR REPLACE VIEW codex.pub_validations WITH (security_barrier) AS
SELECT w.id           AS workflow_id,   -- Keystone, Vigie : circuit
       w.doc_id,                        -- Keystone, Vigie : jointure pub_documents.id
       r.letter       AS revision,      -- Keystone, Vigie : révision validée
       w.requester_id,                  -- Keystone : demandeur
       w.due,                           -- Keystone : échéance (Mes approbations)
       w.step         AS current_step,  -- Keystone : nextApprover
       w.outcome,                       -- Keystone, Vigie : issue du circuit
       w.created_at,                    -- Vigie : submitted_on
       s.idx,                           -- Keystone : step_position
       s.function_key,                  -- Keystone : rôle (correspondance avec ApproverRole)
       coalesce(s.name ->> 'fr', s.name #>> '{}') AS step_label,  -- Keystone, Vigie : libellé de l'étape
       s.assignee_id,                   -- Keystone : approbateur (identifiant Codex)
       u.name         AS assignee_name, -- Keystone : approver_name ; Vigie : approbateur
       s.date         AS done_on,       -- Keystone : signed_on ; Vigie : approved_on
       u.matricule    AS assignee_matricule  -- Keystone : boîte d'approbations par matricule (approvals.ts:170-172)
FROM codex.workflows w
JOIN codex.revisions r      ON r.id = w.revision_id
JOIN codex.documents d      ON d.id = w.doc_id AND d.conf <> 'tres_confidentiel'
JOIN codex.workflow_steps s ON s.workflow_id = w.id
JOIN codex.users u          ON u.id = s.assignee_id;
COMMENT ON VIEW codex.pub_validations IS 'Contrat D10 v1 : circuits de validation, une ligne par étape. Lecteurs : keystone_app, vigie_app, matrix_app.';

-- D11 · Registre des types et circuits ───────────────────────────────────
CREATE OR REPLACE VIEW codex.pub_types_document WITH (security_barrier) AS
SELECT t.code,                         -- Keystone : documents.type_code, handover_items.document_type_code ; Vigie : type
       t.label_fr,                     -- Keystone, Vigie : libellé
       t.label_en,                     -- Keystone : libellé (écran /admin/document-types)
       t.family,                       -- Keystone : famille (puces du coffre, depositService)
       f.label_fr AS family_label_fr,  -- Keystone : libellé de famille
       f.label_en AS family_label_en,  -- Keystone : libellé de famille
       f.grp      AS family_group,     -- Keystone : regroupement
       f.sort     AS family_sort,      -- Keystone : ordre
       t.origins,                      -- Keystone : assistant de dépôt (origine admise)
       t.attachments,                  -- Keystone : rattachements admis (projet obligatoire pour RPT, PV, PHO)
       t.subtypes,                     -- Keystone : sous-types
       t.circuit,                      -- Keystone : circuit (clés de fonction)
       t.retention_years,              -- Keystone : conservation
       t.retention_trigger,            -- Keystone : déclencheur de conservation
       t.retention_disposition,        -- Keystone : sort final
       t.retention_basis,              -- Keystone : fondement
       t.conf_allowed,                 -- Keystone : confidentialités admises
       t.conf_default,                 -- Keystone : confidentialité par défaut
       t.iso,                          -- Keystone : clause ISO (en français)
       t.client_deliverable,           -- Keystone : livrable client (acknowledgeDocument)
       t.active,                       -- Keystone : seuls les types actifs au dépôt
       t.source,                       -- Keystone : affichage
       t.sort                          -- Keystone : ordre
FROM codex.doc_types t
JOIN codex.families f ON f.key = t.family;
COMMENT ON VIEW codex.pub_types_document IS 'Contrat D11 v1 : registre des types de document de Codex. Lecteurs : keystone_app, vigie_app, matrix_app.';

CREATE OR REPLACE VIEW codex.pub_circuits_type WITH (security_barrier) AS
SELECT t.code              AS type_code,  -- Keystone : jointure pub_types_document.code
       c.ord::integer      AS position,   -- Keystone : ordre des étapes
       c.function_key,                    -- Keystone : rôle d'approbation
       fn.label_fr,                       -- Keystone : libellé de la fonction
       fn.label_en,                       -- Keystone : libellé de la fonction
       fn.scope                           -- Keystone : portée (département, projet…)
FROM codex.doc_types t
CROSS JOIN LATERAL jsonb_array_elements_text(t.circuit) WITH ORDINALITY AS c(function_key, ord)
LEFT JOIN codex.functions fn ON fn.key = c.function_key;
COMMENT ON VIEW codex.pub_circuits_type IS 'Contrat D11 v1 : étapes du circuit de chaque type. Lecteurs : keystone_app, matrix_app.';

CREATE OR REPLACE VIEW codex.pub_titulaires_fonction WITH (security_barrier) AS
SELECT h.id,                       -- Keystone : clé
       h.function_key,             -- Keystone : rôle d'approbation (getApproverDirectory)
       fn.label_fr,                -- Keystone : libellé
       fn.label_en,                -- Keystone : libellé
       fn.scope,                   -- Keystone : portée
       h.scope_value,              -- Keystone : département ou projet visé
       h.user_id,                  -- Keystone : titulaire (identifiant Codex)
       u.name      AS user_name,   -- Keystone : affichage
       u.matricule AS user_matricule  -- Keystone : titulaire ↔ persons.matricule (D01)
FROM codex.function_holders h
JOIN codex.functions fn ON fn.key = h.function_key
JOIN codex.users u      ON u.id = h.user_id;
COMMENT ON VIEW codex.pub_titulaires_fonction IS 'Contrat D11 v1 : titulaires des fonctions d''approbation. Le département du titulaire n''est pas publié (users.department disparaît avec D01). Lecteurs : keystone_app, matrix_app.';

-- D18 · Journal ──────────────────────────────────────────────────────────
-- Colonnes communes aux quatre pub_journal (même ordre, mêmes types), réunies par matrix.journal_unifie.
-- audit_log.at est l'heure de Paris sans fuseau (lib/format.ts:37-39) : converti en timestamptz.
CREATE OR REPLACE VIEW codex.pub_journal WITH (security_barrier) AS
SELECT 'audit_log:' || a.id::text        AS ref_source,  -- Matrix : ligne d'origine
       'audit'::text                     AS nature,      -- Matrix : filtre
       a.at AT TIME ZONE 'Europe/Paris'  AS quand,       -- Matrix : tri, période
       u.name                            AS qui,         -- Matrix : nom affiché
       a.user_id                         AS qui_ref,     -- Matrix : identifiant local (slug Codex)
       u.role                            AS qui_role,    -- Matrix : rôle Codex
       a.action,                                         -- Matrix : code d'action (16 codes)
       a.doc_id                          AS objet,       -- Matrix : document (réécrit lors d'un reclassement, actions.ts:302)
       a.detail,                                         -- Matrix : détail
       d.project_code                    AS projet,      -- Matrix : filtre par projet
       u.matricule                       AS qui_matricule  -- Matrix : rapprochement des auteurs entre outils (D01)
FROM codex.audit_log a
JOIN codex.users u          ON u.id = a.user_id
LEFT JOIN codex.documents d ON d.id = a.doc_id;
COMMENT ON VIEW codex.pub_journal IS 'Contrat D18 v1 : journal d''audit de Codex aux colonnes communes. Lecteur : matrix_app (matrix.journal_unifie).';
