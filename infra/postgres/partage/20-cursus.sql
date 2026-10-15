-- Partage des données EPC2I, fichier 20 : vues publiées par Cursus (schéma cursus).
--
-- Décisions : D01 personnes, D08 catalogue des titres, D09 titres détenus, D15 organigramme (unite_code),
-- D14 sites (site_code), D18 journal, D19 horizon d'alerte.
-- Hors de ce fichier : D06 et D07 (heures et absences, vues *_v1 lues par matrix_lecture seulement, voir
-- docs/remplacement-lucca.md § 3.9).
-- Exécution : en tant que cursus_app, après cursus/schema.sql (voir README.md).
--   psql "postgres://cursus_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/20-cursus.sql
-- Rejouable. Les vues ne lisent que des tables du schéma cursus. Droits : 90-droits.sql.
--
-- Colonnes sensibles, jamais lues par une vue pub_ (convention du 15/10/2026 et droits.colonnes_sensibles) :
--   employes : visite, passeport_numero, passeport_expire, naissance, reprise_motif, reprise_date ;
--   vaccinations, visas (tables entières) ; entretiens.cr ; journal.payload, journal.message ; demandes_collab.label.
-- Le contrôle de 90-droits.sql échoue si l'une d'elles apparaît dans information_schema.view_column_usage.

\set ON_ERROR_STOP on

-- ═══ Prérequis : colonnes à ajouter (à reporter dans les migrations de l'outil) ═══
-- Destination : server/migrations-pg/ de Cursus (après 0001_init.sql). ADD COLUMN IF NOT EXISTS : sans effet
-- si la colonne existe déjà ; la contrainte écrite dans la définition de colonne suit le même sort.

-- D01 : matricule. Déjà dans cursus/schema.sql (colonne générée) ; la ligne ne sert que si la base vient d'une
-- version antérieure. Les identifiants SQLite doivent être conservés à la reprise, sinon les matricules changent.
ALTER TABLE cursus.employes
  ADD COLUMN IF NOT EXISTS matricule text
    GENERATED ALWAYS AS ('EMP-' || CASE WHEN id < 10000 THEN lpad(id::text, 4, '0') ELSE id::text END) STORED
    CONSTRAINT employes_matricule_unique UNIQUE;

-- D14 : site de rattachement, code de matrix.pub_sites (pas de clé étrangère entre schémas : contrôle à la
-- saisie par Cursus, puis contrôle d'orphelins par Matrix). Ne pas confondre avec agence (agence d'intérim).
ALTER TABLE cursus.employes
  ADD COLUMN IF NOT EXISTS site_code text
    CONSTRAINT employes_site_code_check CHECK (site_code ~ '^[a-z][a-z0-9_]{1,31}$');

-- D15 : unité de rattachement, code de matrix.pub_organigramme (niveau equipe). Remplace equipe, qui reste
-- pendant la transition puis disparaît avec la table equipes.
ALTER TABLE cursus.employes
  ADD COLUMN IF NOT EXISTS unite_code text
    CONSTRAINT employes_unite_code_check CHECK (unite_code ~ '^[A-Z]{3}(-[A-Z0-9]{2,12}){0,2}$');
ALTER TABLE cursus.budgets
  ADD COLUMN IF NOT EXISTS unite_code text
    CONSTRAINT budgets_unite_code_check CHECK (unite_code ~ '^[A-Z]{3}(-[A-Z0-9]{2,12}){0,2}$');
ALTER TABLE cursus.plan_actions
  ADD COLUMN IF NOT EXISTS unite_code text
    CONSTRAINT plan_actions_unite_code_check CHECK (unite_code ~ '^[A-Z]{3}(-[A-Z0-9]{2,12}){0,2}$');

-- D01 : date de sortie effective, CDI compris (fin ne vaut que pour les CDD, intérims et alternances,
-- shared/rules/profil.ts:62). Sert à calculer actif pour les listes de choix de Codex, Vigie et Keystone.
ALTER TABLE cursus.employes
  ADD COLUMN IF NOT EXISTS sortie date
    CONSTRAINT employes_sortie_check CHECK (sortie >= entree);

CREATE INDEX IF NOT EXISTS employes_unite_code_index ON cursus.employes (unite_code);
CREATE INDEX IF NOT EXISTS employes_site_code_index ON cursus.employes (site_code);

-- D09 : organisme de la formation suivie (Vigie le saisit pour chaque titre détenu : TrainingForm.tsx:56-60).
-- Facultatif à la saisie ; la vue retombe sur formations.organisme.
ALTER TABLE cursus.certifications ADD COLUMN IF NOT EXISTS organisme text;

-- D18 : auteur et objet du journal en colonnes, écrits par server/src/index.ts:111 à chaque action. La vue
-- pub_journal ne lit ni payload ni message (copies possibles de données de santé : « Vaccination … enregistrée »,
-- numéro de passeport de formalite.enregistrer). Cursus remplit donc :
--   actor_emp_id  CurrentUser.empId (shared/types.ts:128), nul pour une intégration ;
--   objet_ref     matricule du salarié visé (payload.matricule, ou EMP-xxxx tiré de payload.empId), ou code chantier ;
--   projet_code   code projet Keystone (payload.chantier ou ligne de feuille).
ALTER TABLE cursus.journal
  ADD COLUMN IF NOT EXISTS actor_emp_id integer
    CONSTRAINT journal_actor_emp_id_employes_id_fk REFERENCES cursus.employes (id) ON DELETE SET NULL;
ALTER TABLE cursus.journal ADD COLUMN IF NOT EXISTS objet_ref text;
ALTER TABLE cursus.journal ADD COLUMN IF NOT EXISTS projet_code text;
CREATE INDEX IF NOT EXISTS journal_at_index ON cursus.journal (at);

-- Non traités ici (changements de structure décidés, sans effet sur les vues) :
--   D03 chantiers réduit à (projet_code, habs, certs) ; D05 suppression de taches ; D02 suppression de projets ;
--   D17 suppression de destinations.pays (lu dans matrix.pub_pays) ; D15 suppression de equipes et de equipe.

-- ═══ Vues publiées ═══
-- Contrat : on n'en retire ni ne renomme de colonne (sinon nouvelle vue _v2) ; ajout en fin de liste seulement.
-- security_barrier : un filtre posé par le lecteur ne s'évalue qu'après ceux de la vue.

-- D01 · Salariés ─────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW cursus.pub_salaries WITH (security_barrier) AS
SELECT e.matricule,   -- tous : clé de jointure (keystone.persons.matricule, codex.users.matricule, vigie.people.matricule)
       e.nom,         -- Keystone : persons.full_name, short_name, initials (cache) ; Codex : v_users.name ; Vigie : v_people.name
       e.poste,       -- Vigie : v_people.job. Keystone ne le synchronise pas (job_title reste local : clé de taux horaire)
       e.unite_code,  -- Keystone : persons.department_id par l'organigramme ; Codex : département (droits « confidentiel »)
       e.site_code,   -- Vigie : v_people.site_id (filtre de site de la matrice) ; Codex : v_users.site
       e.entree,      -- tous : historique, calcul de actif
       e.sortie,      -- tous : historique ; Codex : conservation employee_departure (registry.ts:670)
       ((e.entree IS NULL OR e.entree <= current_date)
        AND (e.fin IS NULL OR e.fin >= current_date)
        AND (e.sortie IS NULL OR e.sortie >= current_date)) AS actif   -- tous : filtre des listes de choix
FROM cursus.employes e;
COMMENT ON VIEW cursus.pub_salaries IS 'Contrat D01 v1 : une ligne par salarié, sortis compris. Jamais : visite, reprise_motif, reprise_date, naissance, passeport_*, temps, heures, forfait_*, jour_off, agence, statut, type_contrat, aptitude. Lecteurs : keystone_app, codex_app, vigie_app, matrix_app.';

-- D08 · Catalogue des titres ─────────────────────────────────────────────
-- titre_id porte la nature : atex, hauteur et aipr existent à la fois en formation et en habilitation. Le point
-- sert de séparateur, car Vigie découpe sur « : » (src/server/plan.ts:64).
CREATE OR REPLACE VIEW cursus.pub_titres WITH (security_barrier) AS
SELECT 'formation.' || f.id                 AS titre_id,       -- Vigie : training_titles.id ; Keystone : jointure avec pub_titres_detenus
       'formation'::text                    AS nature,         -- Vigie : seules les formations se saisissent depuis Vigie (API Cursus)
       f.id                                 AS code,           -- tous : code Cursus (exigences des chantiers, D03)
       f.nom                                AS libelle,        -- Keystone : certifications.name (écran Compétences, accueil, export)
       coalesce(nullif(f.court, ''), f.nom) AS libelle_court,  -- Vigie : en-tête de colonne de la matrice (SkillMatrix.tsx:190)
       f.validite                           AS validite_mois   -- Vigie : échéance par défaut ; NULL = sans échéance (Accueil sécurité)
FROM cursus.formations f
UNION ALL
SELECT 'habilitation.' || h.id, 'habilitation'::text, h.id, h.nom, h.nom, h.validite
FROM cursus.habilitations h;
COMMENT ON VIEW cursus.pub_titres IS 'Contrat D08 v1 : formations et habilitations du catalogue Cursus. validite_mois NULL = sans échéance. Lecteurs : vigie_app, keystone_app, matrix_app.';

-- D09 · Titres détenus ───────────────────────────────────────────────────
-- Formation : dernière obtention par (salarié, formation). Habilitation : délivrée (les demandes en attente,
-- delivree NULL, sont exclues). L'aptitude médicale n'est pas publiée : elle se calcule depuis employes.visite
-- (donnée de santé). utilisable_jusqu_au ne tient compte que des formations prérequises ; une habilitation
-- suspendue pour aptitude échue reste donc « valide » chez les lecteurs (point soumis au DPO, analyse D09 § 8).
CREATE OR REPLACE VIEW cursus.pub_titres_detenus WITH (security_barrier) AS
WITH cert AS (
  SELECT DISTINCT ON (c.emp_id, c.f) c.id, c.emp_id, c.f, c.obtenue AS obtenu_le, c.session_id, c.organisme
  FROM cursus.certifications c
  WHERE c.obtenue IS NOT NULL
  ORDER BY c.emp_id, c.f, c.obtenue DESC, c.id DESC
), hab AS (
  SELECT h.id, h.emp_id, h.h, h.delivree AS delivre_le, h.par
  FROM cursus.hab_titres h
  WHERE h.delivree IS NOT NULL
)
SELECT 'certification.' || c.id     AS cursus_ref,           -- Vigie : référence renvoyée par l'API (saveQualification)
       e.matricule,                                          -- Vigie : people.matricule ; Keystone : persons.matricule
       'formation.' || c.f          AS titre_id,             -- Vigie : training_titles.id (title_id) ; Keystone : jointure pub_titres
       'formation'::text            AS nature,               -- Vigie : formulaire (formation saisissable, habilitation non)
       c.f                          AS code,                 -- tous : code Cursus
       c.obtenu_le,                                          -- Vigie : obtainedOn
       (c.obtenu_le + make_interval(months => f.validite))::date AS expire_le,           -- Keystone : expires_on ; NULL = sans échéance
       (c.obtenu_le + make_interval(months => f.validite))::date AS utilisable_jusqu_au, -- Vigie : expiresOn (état, alertes, recyclage)
       false                        AS prerequis_manquant,   -- Vigie : état « suspendu » (toujours faux pour une formation)
       coalesce(c.organisme, f.organisme) AS organisme,      -- Vigie : provider (SkillMatrix.tsx:97)
       NULL::text                   AS delivre_par,          -- Vigie : provider d'une habilitation (signataire)
       CASE WHEN s.date > c.obtenu_le THEN s.date END AS session_prevue_le  -- Vigie : recyclage déjà réservé par les RH (common.tsx:33)
FROM cert c
JOIN cursus.employes e   ON e.id = c.emp_id
JOIN cursus.formations f ON f.id = c.f
LEFT JOIN cursus.sessions s ON s.id = c.session_id
UNION ALL
SELECT 'hab_titre.' || h.id,
       e.matricule,
       'habilitation.' || h.h,
       'habilitation'::text,
       h.h,
       h.delivre_le,
       x.expire_le,
       least(x.expire_le, pr.prerequis_jusqu_au),
       coalesce(pr.manquant, false),
       NULL::text,
       h.par,
       NULL::date
FROM hab h
JOIN cursus.employes e      ON e.id = h.emp_id
JOIN cursus.habilitations m ON m.id = h.h
CROSS JOIN LATERAL (
  SELECT (h.delivre_le + make_interval(months => m.validite))::date AS expire_le
) x
LEFT JOIN LATERAL (
  -- Formations prérequises (habilitations.prereqs) : manquante, ou date de fin de la plus proche.
  SELECT bool_or(dernier.obtenu_le IS NULL) AS manquant, min(dernier.expire_le) AS prerequis_jusqu_au
  FROM jsonb_array_elements_text(m.prereqs) AS p(f)
  LEFT JOIN LATERAL (
    SELECT c2.obtenue AS obtenu_le, (c2.obtenue + make_interval(months => f2.validite))::date AS expire_le
    FROM cursus.certifications c2
    JOIN cursus.formations f2 ON f2.id = c2.f
    WHERE c2.emp_id = h.emp_id AND c2.f = p.f AND c2.obtenue IS NOT NULL
    ORDER BY c2.obtenue DESC, c2.id DESC
    LIMIT 1
  ) dernier ON true
) pr ON true;
COMMENT ON VIEW cursus.pub_titres_detenus IS 'Contrat D09 v1 : titres détenus par salarié (dernière formation suivie, habilitations délivrées). Aucune donnée de santé : l''aptitude médicale n''est pas publiée. Lecteurs : vigie_app, keystone_app, matrix_app.';

-- D19 · Horizon d'alerte ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW cursus.pub_parametres WITH (security_barrier) AS
SELECT coalesce((s.value ->> 'horizonAlerte')::integer, 90) AS horizon_alerte_jours  -- Vigie : remplace SKILL_SOON_DAYS (60, domain.ts:88)
FROM (SELECT 1) AS une_ligne
LEFT JOIN cursus.settings s ON s.key = 'app';
COMMENT ON VIEW cursus.pub_parametres IS 'Contrat D19 v1 : une ligne. Seule la clé app.horizonAlerte est lue (jamais secret ni lastSagePush). Lecteurs : vigie_app, matrix_app.';

-- D18 · Journal ──────────────────────────────────────────────────────────
-- Colonnes communes aux quatre pub_journal (même ordre, mêmes types), réunies par matrix.journal_unifie.
CREATE OR REPLACE VIEW cursus.pub_journal WITH (security_barrier) AS
SELECT 'journal:' || j.id::text  AS ref_source,  -- Matrix : ligne d'origine, pagination
       CASE WHEN j.role = 'integration' THEN 'integration' ELSE 'audit' END AS nature,  -- Matrix : filtre
       j.at                      AS quand,       -- Matrix : tri, filtre par période
       j.actor                   AS qui,         -- Matrix : nom affiché
       a.matricule               AS qui_ref,     -- Matrix : identifiant de l'auteur dans Cursus (le matricule)
       j.role                    AS qui_role,    -- Matrix : rh, manager, collaborateur, integration
       j.action,                                 -- Matrix : code d'action (employe.creer, temps.valider…)
       j.objet_ref               AS objet,       -- Matrix : salarié ou chantier visé
       NULL::text                AS detail,      -- Matrix : message non publié (données de santé possibles)
       j.projet_code             AS projet,      -- Matrix : filtre par projet
       a.matricule               AS qui_matricule  -- Matrix : rapprochement des auteurs entre outils (D01)
FROM cursus.journal j
LEFT JOIN cursus.employes a ON a.id = j.actor_emp_id;
COMMENT ON VIEW cursus.pub_journal IS 'Contrat D18 v1 : journal de Cursus aux colonnes communes. Ni payload ni message. Lecteur : matrix_app (matrix.journal_unifie).';
