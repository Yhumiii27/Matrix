-- Partage des données EPC2I, fichier 30 : vues publiées par Keystone (schéma keystone).
--
-- Décisions : D02 projets, D03 chantiers, D04 affectations, D05 tâches, D16 clients et fournisseurs,
-- D12 et D13 (référentiels lus par Vigie : articles, nomenclatures, parc, activités, livrables), D18 journal.
-- Prérequis portés par d'autres décisions : D01 (persons.matricule), D17 (countries.iso2), D15 (departments.org_code).
-- Exécution : en tant que keystone_app, après les migrations Drizzle de Keystone (voir README.md).
--   psql "postgres://keystone_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/30-keystone.sql
-- Rejouable. Les vues ne lisent que des tables du schéma keystone (aucune jointure vers matrix) : chaque outil
-- peut les recréer dans ses tests PGlite. Droits : 90-droits.sql.
--
-- Attention aux migrations de Keystone : PostgreSQL refuse de supprimer ou de changer le type d'une colonne lue
-- par une vue (« cannot drop column … view keystone.pub_chantiers depends on it »). drizzle-kit ne connaît pas
-- ces vues : une migration qui touche une colonne listée ici doit recréer la vue (CREATE OR REPLACE VIEW).

\set ON_ERROR_STOP on

-- ═══ Prérequis : colonnes à ajouter (à reporter dans les migrations de l'outil) ═══
-- Destination : src/server/db/schema/*.ts puis une migration drizzle/00xx. ADD COLUMN IF NOT EXISTS : sans
-- effet si la colonne existe déjà ; la contrainte écrite dans la définition de colonne suit le même sort.

-- D01 : matricule Cursus d'un salarié ; nul pour une personne externe (contact client, rôle contractuel).
ALTER TABLE keystone.persons
  ADD COLUMN IF NOT EXISTS matricule text
    CONSTRAINT persons_matricule_unique UNIQUE
    CONSTRAINT persons_matricule_check CHECK (matricule IS NULL OR (matricule ~ '^EMP-[0-9]{4,}$' AND client_id IS NULL));

-- D17 : code ISO du pays. Les 22 noms anglais de countries se rattachent tels quels à matrix.pays (amorçage du
-- fichier 10). La table de passage est écrite ici pour ne pas lire le schéma matrix depuis une migration.
ALTER TABLE keystone.countries
  ADD COLUMN IF NOT EXISTS iso2 char(2)
    CONSTRAINT countries_iso2_unique UNIQUE
    CONSTRAINT countries_iso2_check CHECK (iso2 ~ '^[A-Z]{2}$');
UPDATE keystone.countries c SET iso2 = v.iso2
FROM (VALUES ('France', 'FR'), ('United Kingdom', 'GB'), ('Netherlands', 'NL'), ('Germany', 'DE'), ('Belgium', 'BE'),
             ('Spain', 'ES'), ('Italy', 'IT'), ('Canada', 'CA'), ('United States', 'US'), ('Morocco', 'MA'),
             ('Côte d’Ivoire', 'CI'), ('Senegal', 'SN'), ('Kenya', 'KE'), ('South Africa', 'ZA'), ('Egypt', 'EG'),
             ('Australia', 'AU'), ('Malaysia', 'MY'), ('Singapore', 'SG'), ('Indonesia', 'ID'), ('Vietnam', 'VN'),
             ('Japan', 'JP'), ('India', 'IN'), ('Ghana', 'GH'), ('Brazil', 'BR'), ('Saudi Arabia', 'SA')) AS v(name, iso2)
WHERE c.name = v.name AND c.iso2 IS NULL;
-- NOT NULL seulement quand la table est remplie et complète : le jeu de démo (seed/organisation.ts:117-119)
-- n'écrit pas encore iso2 et échouerait sur une table vide déjà contrainte.
DO $$
DECLARE
  v_manquants text;
BEGIN
  SELECT string_agg(name, ', ' ORDER BY name) INTO v_manquants FROM keystone.countries WHERE iso2 IS NULL;
  IF NOT EXISTS (SELECT FROM keystone.countries) THEN
    RAISE NOTICE 'keystone.countries est vide : iso2 reste facultatif. Rejouez ce fichier après le chargement des pays.';
  ELSIF v_manquants IS NULL THEN
    ALTER TABLE keystone.countries ALTER COLUMN iso2 SET NOT NULL;
  ELSE
    RAISE WARNING 'keystone.countries : pays sans code ISO (%), iso2 reste facultatif. Complétez puis rejouez ce fichier.', v_manquants;
  END IF;
END $$;

-- D02 : nature du projet. Les codes hors projet de Cursus (INT-PROD… ECOLE) deviennent des projets internes.
ALTER TABLE keystone.projects
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'client'
    CONSTRAINT projects_kind_check CHECK (kind IN ('client', 'internal'));

-- D15 : unité de matrix.pub_organigramme (service, ou département sans service) que représente le département
-- Keystone. Le cache departments est rafraîchi depuis la vue par Keystone.
ALTER TABLE keystone.departments
  ADD COLUMN IF NOT EXISTS org_code text
    CONSTRAINT departments_org_code_unique UNIQUE
    CONSTRAINT departments_org_code_check CHECK (org_code ~ '^[A-Z]{3}(-[A-Z0-9]{2,12}){0,2}$');

-- D12 et D13 : colonnes des miroirs Keystone, remplis par SELECT sur les vues de Vigie.
ALTER TABLE keystone.vigie_ecos ADD COLUMN IF NOT EXISTS released_at timestamptz;   -- domain/kpis.ts:337 (ecoReleaseDate)
ALTER TABLE keystone.vigie_ncrs ADD COLUMN IF NOT EXISTS closed_on date;            -- dal/kpis.ts:150 (ncrClosureDates)
ALTER TABLE keystone.vigie_ncrs ADD COLUMN IF NOT EXISTS supplier_id uuid;          -- D16 : keystone.suppliers.id
ALTER TABLE keystone.vigie_ncrs ADD COLUMN IF NOT EXISTS owner_matricule text;      -- D01 : pilote de la NC

-- D14 (facultatif, aucune lecture aujourd'hui) : site Matrix d'un emplacement de stock.
-- ALTER TABLE keystone.storage_locations ADD COLUMN IF NOT EXISTS site_code text;

-- D18 : index de pub_journal (le catalogue ne signale aucun index secondaire sur ces tables).
CREATE INDEX IF NOT EXISTS audit_entries_occurred_at_idx ON keystone.audit_entries (occurred_at);
CREATE INDEX IF NOT EXISTS activity_events_occurred_at_idx ON keystone.activity_events (occurred_at);

-- Non traités ici : D03 suppression de site_sheets.cursus_chantier_id ; D10 documents.codex_id NOT NULL UNIQUE
-- (après la reprise) ; D09 suppression de certifications ; D11 document_types, document_type_circuit_steps et
-- document_approver_assignments gardées comme caches de codex.pub_types_document, pub_circuits_type et
-- pub_titulaires_fonction (clés documents.type_code et document_deposits.type_code inchangées).

-- ═══ Vues publiées ═══
-- Contrat : on n'en retire ni ne renomme de colonne (sinon nouvelle vue _v2) ; ajout en fin de liste seulement.
-- security_barrier : un filtre posé par le lecteur ne s'évalue qu'après ceux de la vue.

-- D02 · Projets (clients et internes) ────────────────────────────────────
CREATE OR REPLACE VIEW keystone.pub_projets WITH (security_barrier) AS
SELECT p.code,                                   -- tous : clé (codex.projects.code, vigie.*.keystone_project_code, lignes de feuille Cursus)
       p.number             AS numero,           -- Vigie : matchProject (« n° d'affaire » #026 des plans importés)
       p.analytic_code      AS code_analytique,  -- Vigie : matchProject (HAV004) ; Cursus : imputation Sage (D06)
       p.kind               AS nature,           -- Cursus : codes internes sur la feuille ; Codex, Vigie : filtre nature = 'client'
       p.name               AS nom,              -- tous : libellé
       p.client_id,                              -- Vigie : rapprochement avec pub_clients (D16)
       c.name               AS client,           -- Codex : projects.client ; Vigie : libellé « code · client »
       c.code3              AS client_code3,     -- Vigie : rapprochement des plans de prévention importés (text.ts:252-272)
       p.stage              AS phase_code,       -- Vigie : contrôle de la clé PM d'un ECO (D12)
       ls.label             AS phase,            -- Codex : projects.stage (page.tsx:254)
       (p.stage NOT IN ('clos', 'annule')) AS imputable,  -- Cursus : options d'ajout de ligne (Temps.tsx:247)
       pm.matricule         AS chef_projet_matricule,     -- Codex : projects.manager_id par users.matricule ; Vigie : clé PM (D12)
       coalesce(pm.full_name, pm.short_name) AS chef_projet_nom,  -- Codex : panneau projet ; Vigie : affichage
       ps.city              AS ville,            -- Codex : projects.site (page.tsx:262)
       ps.country_name      AS pays,             -- Codex, Vigie : affichage
       (SELECT string_agg(DISTINCT su.name, ' · ' ORDER BY su.name)
          FROM keystone.purchase_orders po
          JOIN keystone.suppliers su ON su.id = po.supplier_id
         WHERE po.project_id = p.id AND po.status NOT IN ('draft', 'cancelled')) AS fournisseurs,  -- Codex : projects.tiers (page.tsx:263)
       p.updated_at         AS maj_le            -- Codex : projects.synced_at (page.tsx:255) ; tous : rafraîchissement
FROM keystone.projects p
LEFT JOIN keystone.clients c           ON c.id = p.client_id
LEFT JOIN keystone.persons pm          ON pm.id = p.pm_person_id
LEFT JOIN keystone.lifecycle_stages ls ON ls.code = p.stage
LEFT JOIN keystone.project_sites ps    ON ps.project_id = p.id;
COMMENT ON VIEW keystone.pub_projets IS 'Contrat D02 v1 : tous les projets Keystone, internes compris (nature). Lecteurs : codex_app, cursus_app, vigie_app, matrix_app.';

-- D03 · Fiches chantier ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW keystone.pub_chantiers WITH (security_barrier) AS
SELECT p.code               AS projet_code,      -- Cursus : clé du chantier (chantiers.projet_code, voyages.chantier, demandes_keystone.chantier)
       p.name               AS projet_nom,       -- Cursus : Chantiers.tsx, Voyages.tsx
       c.name               AS client,           -- Cursus : Chantiers.tsx:53
       s.site_name          AS lieu,             -- Cursus : Chantiers.tsx, voyages.ts:70-87
       ps.city              AS ville,            -- Cursus : affichage
       s.country            AS pays,             -- Cursus : affichage
       co.iso2              AS pays_iso2,        -- Cursus : Go / No Go (c.pays !== 'FR', destOf, domain.ts:400-401)
       s.start_on           AS debut,            -- Cursus : resourceStatus (domain.ts:383-411)
       s.end_on             AS fin,              -- Cursus : resourceStatus
       pm.matricule         AS chef_projet_matricule,     -- Cursus : chef
       coalesce(pm.full_name, pm.short_name) AS chef_projet_nom,  -- Cursus : chef (affichage)
       s.updated_at         AS maj_le            -- Cursus : rafraîchissement
FROM keystone.site_sheets s
JOIN keystone.projects p            ON p.id = s.project_id
LEFT JOIN keystone.clients c        ON c.id = p.client_id
LEFT JOIN keystone.persons pm       ON pm.id = p.pm_person_id
LEFT JOIN keystone.project_sites ps ON ps.project_id = p.id
LEFT JOIN keystone.countries co     ON co.name = s.country;
COMMENT ON VIEW keystone.pub_chantiers IS 'Contrat D03 v1 : une ligne par fiche chantier. Les exigences (habilitations, certifications) restent dans cursus.chantiers. Lecteurs : cursus_app, matrix_app.';

-- D04 · Affectations (rotations de chantier et planning) ────────────────
-- Seules les personnes qui ont un matricule sont publiées : les équipes d'entreprises sortent du Go / No Go.
-- allocations est exclue : ses lignes n'ont pas de projet (totaux par semaine, seed/resources.ts:29-34).
CREATE OR REPLACE VIEW keystone.pub_affectations WITH (security_barrier) AS
SELECT 'rotation'::text      AS source,          -- Cursus : missions = source 'rotation' ; Vigie : les deux
       r.id                  AS affectation_id,  -- Cursus, Vigie : clé des caches cursus.missions et vigie.keystone_assignments
       pe.matricule,                             -- Cursus : employes.matricule ; Vigie : people.matricule
       coalesce(pe.full_name, r.person_name) AS personne_nom,  -- Vigie : affichage
       p.code                AS projet_code,     -- Cursus : missions.projet ; Vigie : libellé « code · client »
       p.name                AS projet_nom,      -- Cursus : Missions.tsx
       c.name                AS client,          -- Vigie : libellé « code · client »
       NULL::text            AS activite_code,   -- Vigie : activité (planning seulement)
       r.role_on_site        AS activite,        -- Vigie : keystone_assignments.activity
       r.from_on             AS du,              -- Cursus : alerte « Affecté au chantier » (conges.ts:129) ; Vigie : start_on
       r.to_on               AS au,              -- Cursus, Vigie : fin
       coalesce(s.site_name, ps.city) AS lieu,   -- Cursus : missions.lieu
       coalesce(s.country, ps.country_name) AS pays,  -- Cursus : affichage
       co.iso2               AS pays_iso2,       -- Cursus : type « Déplacement international » si <> 'FR'
       NULL::numeric         AS heures_prevues   -- Vigie : charge (planning seulement)
FROM keystone.site_rotations r
JOIN keystone.projects p            ON p.id = r.project_id
JOIN keystone.persons pe            ON pe.id = r.person_id
LEFT JOIN keystone.clients c        ON c.id = p.client_id
LEFT JOIN keystone.site_sheets s    ON s.project_id = r.project_id
LEFT JOIN keystone.project_sites ps ON ps.project_id = r.project_id
LEFT JOIN keystone.countries co     ON co.name = coalesce(s.country, ps.country_name)
WHERE pe.matricule IS NOT NULL
UNION ALL
SELECT 'planning', aa.id, pe.matricule, coalesce(pe.full_name, pe.short_name), p.code, p.name, c.name,
       a.code, a.name,
       coalesce(a.start_date, a.early_start_date), coalesce(a.finish_date, a.early_finish_date),
       ps.city, ps.country_name, co.iso2, aa.planned_hours
FROM keystone.activity_assignments aa
JOIN keystone.activities a          ON a.id = aa.activity_id
JOIN keystone.projects p            ON p.id = a.project_id
JOIN keystone.persons pe            ON pe.id = aa.person_id
LEFT JOIN keystone.clients c        ON c.id = p.client_id
LEFT JOIN keystone.project_sites ps ON ps.project_id = p.id
LEFT JOIN keystone.countries co     ON co.name = ps.country_name
WHERE pe.matricule IS NOT NULL
  AND coalesce(a.start_date, a.early_start_date) IS NOT NULL
  AND coalesce(a.finish_date, a.early_finish_date) IS NOT NULL;
COMMENT ON VIEW keystone.pub_affectations IS 'Contrat D04 v1 : rotations de chantier et affectations du planning des salariés (matricule renseigné). Les lecteurs filtrent sur au >= current_date. Lecteurs : cursus_app, vigie_app, matrix_app.';

-- D05 · Tâches réparties par jour ouvré ──────────────────────────────────
-- estimate_h réparti uniformément sur les jours ouvrés (lundi à vendredi) entre start_date et due_date. Cursus
-- met ensuite à zéro fériés, absences et jours non travaillés (shared/rules/temps.ts:94-100).
CREATE OR REPLACE VIEW keystone.pub_taches_jours WITH (security_barrier) AS
SELECT t.number              AS tache_numero,    -- Cursus : LigneTemps.tacheKeystone, envoi des heures par tâche (D06)
       pe.matricule,                             -- Cursus : filtre matricule = $1
       p.code                AS projet_code,     -- Cursus : ligne.projet
       p.name                AS projet_nom,      -- Cursus : affichage
       p.kind                AS projet_nature,   -- Cursus : projet interne ou client
       a.code                AS activite_code,   -- Cursus : lot (« To assign » sinon)
       t.title               AS titre,           -- Cursus : ligne.tache
       t.status              AS statut,          -- Cursus : exclure done si besoin
       g.jour::date          AS jour,            -- Cursus : colonne h[i]
       date_trunc('week', g.jour)::date AS semaine,  -- Cursus : filtre semaine = $2 (lundi)
       round(t.estimate_h / nullif(n.jours, 0), 2) AS heures_prevues  -- Cursus : suggestion temps.suggest
FROM keystone.tasks t
JOIN keystone.projects p   ON p.id = t.project_id
JOIN keystone.persons pe   ON pe.id = t.assignee_person_id
LEFT JOIN keystone.activities a ON a.id = t.activity_id
CROSS JOIN LATERAL (
  SELECT count(*) AS jours
  FROM generate_series(t.start_date, t.due_date, interval '1 day') AS d(x)
  WHERE extract(isodow FROM d.x) < 6
) n
CROSS JOIN LATERAL generate_series(t.start_date, t.due_date, interval '1 day') AS g(jour)
WHERE pe.matricule IS NOT NULL
  AND extract(isodow FROM g.jour) < 6;
COMMENT ON VIEW keystone.pub_taches_jours IS 'Contrat D05 v1 : une ligne par tâche et jour ouvré, salariés seulement. Lecture : WHERE matricule = $1 AND semaine = $2. Lecteurs : cursus_app, matrix_app.';

-- D16 · Fournisseurs et clients ──────────────────────────────────────────
CREATE OR REPLACE VIEW keystone.pub_fournisseurs WITH (security_barrier) AS
SELECT s.id,           -- Vigie : contractors.supplier_id, events.supplier_id (NC fournisseur)
       s.name,         -- Vigie : nom affiché d'une entreprise reliée, rapprochement matchByName
       s.x3_code,      -- Vigie : aide à la saisie du lien (Achats, QHSE)
       s.is_internal   -- Vigie : ne jamais proposer un atelier Keystone comme entreprise extérieure
FROM keystone.suppliers s;
COMMENT ON VIEW keystone.pub_fournisseurs IS 'Contrat D16 v1 : fournisseurs Keystone (sans les indicateurs de performance). Lecteurs : vigie_app, matrix_app.';

CREATE OR REPLACE VIEW keystone.pub_clients WITH (security_barrier) AS
SELECT c.id,     -- Vigie, Codex, Cursus : clé (pub_projets.client_id)
       c.name,   -- tous : libellé du client
       c.code3   -- Vigie : rapprochement des plans de prévention importés ; Codex : affichage
FROM keystone.clients c;
COMMENT ON VIEW keystone.pub_clients IS 'Contrat D16 v1 : clients Keystone. Lecteurs : codex_app, cursus_app, vigie_app, matrix_app.';

-- D12 et D13 · Référentiels lus par Vigie ────────────────────────────────
CREATE OR REPLACE VIEW keystone.pub_articles WITH (security_barrier) AS
SELECT pa.ref,        -- Vigie : eco_parts.part_ref, events.part_ref
       pa.name,       -- Vigie : libellé
       pa.revision,   -- Vigie : révision courante (from_revision d'un ECO)
       pa.status,     -- Vigie : article actif ou non
       pa.part_type,  -- Vigie : affichage
       pa.make_buy    -- Vigie : impact achats d'un ECO
FROM keystone.parts pa;
COMMENT ON VIEW keystone.pub_articles IS 'Contrat D12 v1 : articles (sans prix, fabricant ni contrôle export). Lecteurs : vigie_app, matrix_app.';

CREATE OR REPLACE VIEW keystone.pub_nomenclatures WITH (security_barrier) AS
SELECT p.code             AS project_code,  -- Vigie : effectivité automatique « projet » d'un ECO
       p.stage,                             -- Vigie : phases à nomenclature ouverte
       pa.ref             AS part_ref,      -- Vigie : cas d'emploi de l'article
       sum(b.quantity)    AS quantity       -- Vigie : affichage
FROM keystone.project_bom_lines b
JOIN keystone.projects p ON p.id = b.project_id
JOIN keystone.parts pa   ON pa.id = b.part_id
GROUP BY p.code, p.stage, pa.ref;
COMMENT ON VIEW keystone.pub_nomenclatures IS 'Contrat D12 v1 : cas d''emploi des articles par projet. Lecteurs : vigie_app, matrix_app.';

CREATE OR REPLACE VIEW keystone.pub_parc_machines WITH (security_barrier) AS
SELECT m.number,                                  -- Vigie : eco_effectivity.target_ref (cible « machine »)
       m.name,                                    -- Vigie : libellé de la cible
       m.client_name,                             -- Vigie : affichage
       m.site_text,                               -- Vigie : affichage
       coalesce(p.code, m.project_code) AS project_code,  -- Vigie : projet d'origine
       m.warranty_status,                         -- Vigie : disposition (rétrofit sous garantie)
       r.part_ref,                                -- Vigie : article monté
       r.revision         AS fitted_revision      -- Vigie : eco_effectivity.fitted_revision
FROM keystone.machines m
LEFT JOIN keystone.projects p ON p.id = m.project_id
LEFT JOIN keystone.machine_part_revisions r ON r.machine_id = m.id;
COMMENT ON VIEW keystone.pub_parc_machines IS 'Contrat D12 v1 : parc installé, une ligne par machine et article monté. Lecteurs : vigie_app, matrix_app.';

CREATE OR REPLACE VIEW keystone.pub_activites WITH (security_barrier) AS
SELECT p.code   AS project_code,  -- Vigie : filtre de la liste de choix
       a.code,                    -- Vigie : events.keystone_activity_code (fiche NC)
       a.name                     -- Vigie : libellé
FROM keystone.activities a
JOIN keystone.projects p ON p.id = a.project_id;
COMMENT ON VIEW keystone.pub_activites IS 'Contrat D13 v1 : activités du planning, pour la fiche NC. Lecteurs : vigie_app, matrix_app.';

CREATE OR REPLACE VIEW keystone.pub_livrables WITH (security_barrier) AS
SELECT p.code   AS project_code,  -- Vigie : filtre de la liste de choix
       d.number,                  -- Vigie : events.keystone_deliverable_number (fiche NC)
       d.title,                   -- Vigie : libellé
       d.status                   -- Vigie : affichage
FROM keystone.deliverables d
JOIN keystone.projects p ON p.id = d.project_id;
COMMENT ON VIEW keystone.pub_livrables IS 'Contrat D13 v1 : livrables contractuels, pour la fiche NC. Lecteurs : vigie_app, matrix_app.';

-- D18 · Journal ──────────────────────────────────────────────────────────
-- Colonnes communes aux quatre pub_journal (même ordre, mêmes types), réunies par matrix.journal_unifie.
CREATE OR REPLACE VIEW keystone.pub_journal WITH (security_barrier) AS
SELECT 'audit_entries:' || a.id::text AS ref_source,  -- Matrix : ligne d'origine
       'audit'::text           AS nature,             -- Matrix : filtre (audit par défaut, activite reprend en partie l'audit)
       a.occurred_at           AS quand,              -- Matrix : tri, période
       a.actor_name            AS qui,                -- Matrix : nom affiché
       a.actor_person_id::text AS qui_ref,            -- Matrix : identifiant local (uuid persons)
       NULL::text              AS qui_role,           -- Matrix : sans objet chez Keystone
       a.area                  AS action,             -- Matrix : domaine fonctionnel (pas un verbe)
       a.object_ref            AS objet,              -- Matrix : objet visé
       a.change                AS detail,             -- Matrix : détail
       p.code                  AS projet,             -- Matrix : filtre par projet
       pe.matricule            AS qui_matricule       -- Matrix : rapprochement des auteurs entre outils (D01)
FROM keystone.audit_entries a
LEFT JOIN keystone.projects p ON p.id = a.project_id
LEFT JOIN keystone.persons pe ON pe.id = a.actor_person_id
UNION ALL
SELECT 'activity_events:' || e.id::text, 'activite', e.occurred_at, e.actor_name, e.actor_person_id::text, NULL,
       'activity.' || e.kind, NULL, e.text, p.code, pe.matricule
FROM keystone.activity_events e
LEFT JOIN keystone.projects p ON p.id = e.project_id
LEFT JOIN keystone.persons pe ON pe.id = e.actor_person_id;
COMMENT ON VIEW keystone.pub_journal IS 'Contrat D18 v1 : journal d''audit et fil d''activité de Keystone aux colonnes communes. Lecteur : matrix_app (matrix.journal_unifie).';
