-- Partage des données EPC2I, fichier 10 : référentiels publiés par Matrix (schéma matrix).
--
-- Décisions : D17 pays ISO, D14 sites, D15 organigramme à niveaux, correspondances d'identifiants pour la
-- transition (D01 personnes, D02 projets, D08 titres, D10 documents, D14 sites, D15 unités).
-- Exécution : en tant que matrix_app, propriétaire du schéma matrix (voir README.md).
--   psql "postgres://matrix_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/10-matrix-referentiels.sql
-- Rejouable : CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, amorçage en ON CONFLICT DO NOTHING (une valeur
-- corrigée plus tard dans Matrix n'est jamais écrasée).
-- Droits : aucun ici. Les lecteurs reçoivent USAGE et SELECT dans 90-droits.sql.
--
-- Règles de la convention appliquées ici :
--   - les outils lisent les vues matrix.pub_*, jamais les tables ;
--   - les outils écrivent par l'API de Matrix (organigramme : POST /api/organigramme…), jamais en SQL ;
--   - aucune clé étrangère entre schémas : employes.site_code, persons.matricule… sont des colonnes texte, que
--     Matrix contrôle (lot 5 de docs/proposition.md, contrôle d'orphelins).

\set ON_ERROR_STOP on

-- ── 1. Mise à jour de modifie_le ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION matrix.maj_modifie_le() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  NEW.modifie_le := now();
  RETURN NEW;
END $$;
COMMENT ON FUNCTION matrix.maj_modifie_le() IS 'Déclencheur : met modifie_le à l''heure de la modification.';

-- ── 2. D17 Pays ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matrix.pays (
  iso2        char(2)     NOT NULL,
  iso3        char(3)     NOT NULL,
  nom_fr      text        NOT NULL,
  nom_en      text        NOT NULL,
  actif       boolean     NOT NULL DEFAULT true,
  cree_le     timestamptz NOT NULL DEFAULT now(),
  modifie_le  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pays_pkey PRIMARY KEY (iso2),
  CONSTRAINT pays_iso3_unique UNIQUE (iso3),
  CONSTRAINT pays_nom_en_unique UNIQUE (nom_en),
  CONSTRAINT pays_iso2_check CHECK (iso2 ~ '^[A-Z]{2}$'),
  CONSTRAINT pays_iso3_check CHECK (iso3 ~ '^[A-Z]{3}$'),
  CONSTRAINT pays_noms_check CHECK (btrim(nom_fr) <> '' AND btrim(nom_en) <> '')
);
COMMENT ON TABLE matrix.pays IS 'D17 : liste des pays ISO 3166, publiée par Matrix (vue matrix.pub_pays).';
COMMENT ON COLUMN matrix.pays.iso2 IS 'Code ISO 3166-1 alpha-2. Clé lue par Cursus (destinations.code, chantiers.pays) et Keystone (countries.iso2, public_holidays.country_code).';
COMMENT ON COLUMN matrix.pays.iso3 IS 'Code ISO 3166-1 alpha-3. Non publié : aucun lecteur.';
COMMENT ON COLUMN matrix.pays.nom_fr IS 'Nom affiché par Cursus (dest.pays : TripDialog, Voyages, Portail…).';
COMMENT ON COLUMN matrix.pays.nom_en IS 'Nom affiché par Keystone. Identique au caractère près à keystone.countries.name (tests golden, fr-dict.json), apostrophe typographique comprise.';
COMMENT ON COLUMN matrix.pays.actif IS 'Faux : pays retiré des listes de choix, gardé pour l''historique.';
CREATE OR REPLACE TRIGGER pays_modifie_le BEFORE UPDATE ON matrix.pays
  FOR EACH ROW EXECUTE FUNCTION matrix.maj_modifie_le();

-- Amorçage : les 22 pays de keystone.countries (prototype-data.json, COUNTRY_ZONE), puis les 3 destinations
-- de Cursus absentes de Keystone (GH, BR, SA ; server/src/seed.ts, DESTS). nom_fr reprend le libellé de Cursus
-- quand il existe (Maroc, Inde, États-Unis, Côte d’Ivoire, Ghana, Brésil, Arabie saoudite, Vietnam).
INSERT INTO matrix.pays (iso2, iso3, nom_fr, nom_en) VALUES
  ('FR', 'FRA', 'France',          'France'),
  ('GB', 'GBR', 'Royaume-Uni',     'United Kingdom'),
  ('NL', 'NLD', 'Pays-Bas',        'Netherlands'),
  ('DE', 'DEU', 'Allemagne',       'Germany'),
  ('BE', 'BEL', 'Belgique',        'Belgium'),
  ('ES', 'ESP', 'Espagne',         'Spain'),
  ('IT', 'ITA', 'Italie',          'Italy'),
  ('CA', 'CAN', 'Canada',          'Canada'),
  ('US', 'USA', 'États-Unis',      'United States'),
  ('MA', 'MAR', 'Maroc',           'Morocco'),
  ('CI', 'CIV', 'Côte d’Ivoire',   'Côte d’Ivoire'),
  ('SN', 'SEN', 'Sénégal',         'Senegal'),
  ('KE', 'KEN', 'Kenya',           'Kenya'),
  ('ZA', 'ZAF', 'Afrique du Sud',  'South Africa'),
  ('EG', 'EGY', 'Égypte',          'Egypt'),
  ('AU', 'AUS', 'Australie',       'Australia'),
  ('MY', 'MYS', 'Malaisie',        'Malaysia'),
  ('SG', 'SGP', 'Singapour',       'Singapore'),
  ('ID', 'IDN', 'Indonésie',       'Indonesia'),
  ('VN', 'VNM', 'Vietnam',         'Vietnam'),
  ('JP', 'JPN', 'Japon',           'Japan'),
  ('IN', 'IND', 'Inde',            'India'),
  ('GH', 'GHA', 'Ghana',           'Ghana'),
  ('BR', 'BRA', 'Brésil',          'Brazil'),
  ('SA', 'SAU', 'Arabie saoudite', 'Saudi Arabia')
ON CONFLICT (iso2) DO NOTHING;

-- ── 3. D14 Sites ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matrix.sites (
  code        text        NOT NULL,
  libelle     text        NOT NULL,
  ville       text,
  pays_iso2   char(2)     NOT NULL DEFAULT 'FR',
  ordre       integer     NOT NULL DEFAULT 0,
  actif       boolean     NOT NULL DEFAULT true,
  ferme_le    date,
  cree_le     timestamptz NOT NULL DEFAULT now(),
  modifie_le  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sites_pkey PRIMARY KEY (code),
  CONSTRAINT sites_pays_iso2_fk FOREIGN KEY (pays_iso2) REFERENCES matrix.pays (iso2) ON UPDATE CASCADE ON DELETE RESTRICT,
  -- Minuscules, chiffres et soulignés, comme les clés de Codex, mais plus strict : une lettre en premier et au
  -- moins 2 caractères. Codex accepte aujourd'hui « 2e_site » ou « x » (actions.ts:722, clé tirée du libellé) ;
  -- avec D14, il ne crée plus de site et applique cette règle (sites lus dans matrix.pub_sites). « all » est
  -- réservé par Vigie (ALL_SITES, src/lib/session.ts:10).
  CONSTRAINT sites_code_check CHECK (code ~ '^[a-z][a-z0-9_]{1,31}$' AND code <> 'all'),
  CONSTRAINT sites_libelle_check CHECK (btrim(libelle) <> ''),
  CONSTRAINT sites_fermeture_check CHECK (ferme_le IS NULL OR NOT actif)
);
COMMENT ON TABLE matrix.sites IS 'D14 : liste unique des sites de l''entreprise, publiée par Matrix (vue matrix.pub_sites). Un site fermé reste référencé : actif = false, jamais supprimé. Les attributs Seveso restent dans vigie.sites ; le lieu d''un projet reste dans keystone.project_sites.';
COMMENT ON COLUMN matrix.sites.code IS 'Clé stable lue par codex.users.site, codex.documents.site, vigie.sites.id (et ses 16 clés étrangères), cursus.employes.site_code. Ne change jamais.';
COMMENT ON COLUMN matrix.sites.libelle IS 'Libellé affiché par Codex (sites.label) et Vigie (sites.label).';
COMMENT ON COLUMN matrix.sites.ville IS 'Ville, pour rattacher les emplacements de stock Keystone (« Entrepôt central — Lyon »).';
COMMENT ON COLUMN matrix.sites.pays_iso2 IS 'Pays du site (matrix.pays).';
COMMENT ON COLUMN matrix.sites.ordre IS 'Ordre d''affichage (codex.sites.sort, vigie.sites.sort).';
COMMENT ON COLUMN matrix.sites.ferme_le IS 'Date de fermeture. Renseignée seulement si actif = false.';
CREATE INDEX IF NOT EXISTS sites_pays_iso2_idx ON matrix.sites (pays_iso2);
CREATE OR REPLACE TRIGGER sites_modifie_le BEFORE UPDATE ON matrix.sites
  FOR EACH ROW EXECUTE FUNCTION matrix.maj_modifie_le();

-- Amorçage : les 3 sites de Codex (codex/src/db/seed-org.ts:24-28, SITES), clés et libellés inchangés.
-- Les sites de Vigie (ville-a, ville-b) sont des noms provisoires : ils ne sont pas repris. L'hypothèse
-- ville-a = lyon se saisit dans matrix.correspondances après confirmation du QHSE.
INSERT INTO matrix.sites (code, libelle, ville, pays_iso2, ordre) VALUES
  ('lyon',      'Lyon — siège et atelier', 'Lyon',      'FR', 10),
  ('le_havre',  'Le Havre — magasin',      'Le Havre',  'FR', 20),
  ('marseille', 'Marseille — magasin',     'Marseille', 'FR', 30)
ON CONFLICT (code) DO NOTHING;

-- ── 4. D15 Organigramme à niveaux ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS matrix.organigramme (
  code                   text        NOT NULL,
  niveau                 text        NOT NULL,
  parent_code            text,
  libelle_fr             text        NOT NULL,
  libelle_en             text        NOT NULL,
  responsable_matricule  text,
  site_code              text,
  ordre                  integer     NOT NULL DEFAULT 0,
  actif                  boolean     NOT NULL DEFAULT true,
  ferme_le               date,
  cree_le                timestamptz NOT NULL DEFAULT now(),
  modifie_le             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organigramme_pkey PRIMARY KEY (code),
  CONSTRAINT organigramme_parent_fk FOREIGN KEY (parent_code) REFERENCES matrix.organigramme (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT organigramme_site_fk FOREIGN KEY (site_code) REFERENCES matrix.sites (code) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT organigramme_niveau_check CHECK (niveau IN ('departement', 'service', 'equipe')),
  -- Un département est une racine ; un service ou une équipe a toujours un parent.
  CONSTRAINT organigramme_racine_check CHECK ((niveau = 'departement') = (parent_code IS NULL)),
  -- Département : 3 majuscules, repris dans les identifiants de documents Codex (schema.ts:22, actions.ts:719) ;
  -- QMS est réservé par Codex. Service et équipe : code du département suivi d'un suffixe (PRJ-CPL).
  CONSTRAINT organigramme_code_check CHECK (
    CASE WHEN niveau = 'departement' THEN code ~ '^[A-Z]{3}$' AND code <> 'QMS'
         ELSE code ~ '^[A-Z]{3}(-[A-Z0-9]{2,12}){1,2}$' END),
  CONSTRAINT organigramme_libelles_check CHECK (btrim(libelle_fr) <> '' AND btrim(libelle_en) <> ''),
  CONSTRAINT organigramme_responsable_check CHECK (responsable_matricule ~ '^EMP-[0-9]{4,}$'),
  CONSTRAINT organigramme_fermeture_check CHECK (ferme_le IS NULL OR NOT actif)
);
COMMENT ON TABLE matrix.organigramme IS 'D15 : organigramme unique à trois niveaux (département > service > équipe), publié par Matrix (vue matrix.pub_organigramme). Codex lit le département, Keystone le service (ou le département), Cursus l''équipe. Une unité n''est jamais supprimée : actif = false et ferme_le. Écritures des RH de Cursus par l''API de Matrix.';
COMMENT ON COLUMN matrix.organigramme.code IS 'Clé stable. Un renommage ne touche que les libellés. Lue par codex.departments.code, keystone.departments.org_code, cursus.employes.unite_code (et budgets, plan_actions).';
COMMENT ON COLUMN matrix.organigramme.niveau IS 'departement, service ou equipe.';
COMMENT ON COLUMN matrix.organigramme.parent_code IS 'Unité mère : un département pour un service ; un service ou un département pour une équipe (contrôlé par déclencheur).';
COMMENT ON COLUMN matrix.organigramme.libelle_fr IS 'Libellé français : Codex label_fr, Cursus (nom de l''équipe).';
COMMENT ON COLUMN matrix.organigramme.libelle_en IS 'Libellé anglais : Codex label_en, Keystone departments.name (chaîne source traduite par fr-dict.json).';
COMMENT ON COLUMN matrix.organigramme.responsable_matricule IS 'Matricule Cursus du responsable (EMP-xxxx) : circuit d''approbation de Keystone (head_person_id), manager valideur de Cursus (equipes.manager_id), fonction resp_departement de Codex.';
COMMENT ON COLUMN matrix.organigramme.site_code IS 'Site de rattachement, facultatif (équipes « du site » de Cursus).';
COMMENT ON COLUMN matrix.organigramme.ordre IS 'Ordre d''affichage (Codex sort, Keystone sort_order, Cursus ordre).';
CREATE UNIQUE INDEX IF NOT EXISTS organigramme_libelle_unique ON matrix.organigramme (coalesce(parent_code, ''), lower(libelle_fr));
CREATE INDEX IF NOT EXISTS organigramme_parent_idx ON matrix.organigramme (parent_code);
CREATE INDEX IF NOT EXISTS organigramme_site_idx ON matrix.organigramme (site_code);

-- Contrôle des niveaux, que des CHECK ne peuvent pas exprimer (ils ne lisent pas les autres lignes).
CREATE OR REPLACE FUNCTION matrix.organigramme_controle() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_niveau_parent text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.code <> OLD.code THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format('organigramme : le code %s ne change jamais (il est repris dans les identifiants de documents Codex). Créez une nouvelle unité et fermez l''ancienne.', OLD.code);
  END IF;
  IF NEW.parent_code IS NOT NULL THEN
    SELECT o.niveau INTO v_niveau_parent FROM matrix.organigramme o WHERE o.code = NEW.parent_code;
    IF (NEW.niveau = 'service' AND v_niveau_parent IS DISTINCT FROM 'departement')
       OR (NEW.niveau = 'equipe' AND v_niveau_parent IS DISTINCT FROM 'departement' AND v_niveau_parent IS DISTINCT FROM 'service') THEN
      RAISE EXCEPTION USING ERRCODE = 'check_violation',
        MESSAGE = format('organigramme : %s (%s) ne peut pas dépendre de %s (%s). Un service dépend d''un département ; une équipe d''un service ou d''un département.',
                         NEW.code, NEW.niveau, NEW.parent_code, coalesce(v_niveau_parent, 'unité absente'));
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.niveau <> OLD.niveau
     AND EXISTS (SELECT FROM matrix.organigramme e WHERE e.parent_code = NEW.code) THEN
    RAISE EXCEPTION USING ERRCODE = 'check_violation',
      MESSAGE = format('organigramme : %s a des unités rattachées, son niveau ne peut pas changer.', NEW.code);
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.modifie_le := now();
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION matrix.organigramme_controle() IS 'Déclencheur de matrix.organigramme : code immuable, niveau du parent cohérent, niveau figé si l''unité a des enfants, modifie_le.';
CREATE OR REPLACE TRIGGER organigramme_controle BEFORE INSERT OR UPDATE ON matrix.organigramme
  FOR EACH ROW EXECUTE FUNCTION matrix.organigramme_controle();

-- Amorçage : les 15 départements de Codex (codex/src/db/seed-org.ts:6-22), qui deviennent les départements de
-- Matrix sans intervention (analyse D15). Les services Keystone et les équipes Cursus se placent à la main,
-- quand l'organigramme réel sera fourni (question O-04 de Codex) ; les responsables aussi (aucun matricule).
INSERT INTO matrix.organigramme (code, niveau, libelle_fr, libelle_en, ordre) VALUES
  ('DIR', 'departement', 'Direction générale',       'Executive management',     10),
  ('COM', 'departement', 'Commercial',               'Sales',                    20),
  ('PRJ', 'departement', 'Projets & contrôle',       'Projects & controls',      30),
  ('ING', 'departement', 'Ingénierie',               'Engineering',              40),
  ('MEP', 'departement', 'Lots techniques (MEP)',    'MEP',                      50),
  ('CHA', 'departement', 'Opérations chantier',      'Site operations',          60),
  ('QUA', 'departement', 'Qualité',                  'Quality',                  70),
  ('HSE', 'departement', 'HSE',                      'HSE',                      80),
  ('ACH', 'departement', 'Achats & stock',           'Procurement & stock',      90),
  ('RHU', 'departement', 'Ressources humaines',      'Human resources',         100),
  ('FIN', 'departement', 'Finance & administration', 'Finance & administration', 110),
  ('JUR', 'departement', 'Juridique',                'Legal',                   120),
  ('DSI', 'departement', 'Systèmes d’information',   'Information systems',     130),
  ('CMN', 'departement', 'Communication',            'Communication',           140),
  ('RDI', 'departement', 'Recherche & innovation',   'Research & innovation',   150)
ON CONFLICT (code) DO NOTHING;

-- ── 5. Correspondances d'identifiants (transition) ──────────────────────
-- Une ligne relie un identifiant local d'un outil (uuid Keystone, slug Codex ou Vigie, entier Cursus, numéro de
-- document, code projet…) à la clé commune (le pivot). Matrix propose ; les RH valident les personnes,
-- l'informatique valide le reste ; chaque outil lit matrix.pub_correspondances et pose lui-même sa clé locale.
-- Une fois les colonnes matricule et code en place, la table sert de trace et de contrôle de cohérence.
CREATE TABLE IF NOT EXISTS matrix.correspondances (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  objet             text        NOT NULL,
  outil             text        NOT NULL,
  table_locale      text        NOT NULL,
  id_local          text        NOT NULL,
  cle_naturelle     text,
  libelle_local     text,
  pivot             text,
  pivot_provisoire  boolean     NOT NULL DEFAULT false,
  methode           text        NOT NULL,
  statut            text        NOT NULL DEFAULT 'propose',
  propose_le        timestamptz NOT NULL DEFAULT now(),
  propose_par       text        NOT NULL DEFAULT 'matrix',
  decide_par        text,
  decide_le         timestamptz,
  note              text,
  CONSTRAINT correspondances_pkey PRIMARY KEY (id),
  CONSTRAINT correspondances_objet_check CHECK (objet IN ('personne', 'projet', 'site', 'unite', 'pays', 'titre', 'document')),
  CONSTRAINT correspondances_outil_check CHECK (outil IN ('keystone', 'codex', 'cursus', 'vigie')),
  CONSTRAINT correspondances_methode_check CHECK (methode IN ('nom_exact', 'nom_court', 'code', 'rang', 'manuel', 'jeu_demo')),
  -- propose : en attente ; valide : à appliquer ; a_creer : l'objet doit d'abord être créé chez l'outil qui fait
  -- foi (projet K-2614 à créer dans Keystone) ; abandonne : donnée de démonstration non reprise ;
  -- rejete : proposition refusée ; retire : correspondance validée puis annulée.
  CONSTRAINT correspondances_statut_check CHECK (statut IN ('propose', 'valide', 'a_creer', 'abandonne', 'rejete', 'retire')),
  CONSTRAINT correspondances_pivot_check CHECK (statut NOT IN ('propose', 'valide') OR pivot IS NOT NULL),
  CONSTRAINT correspondances_decision_check CHECK (statut IN ('propose', 'a_creer') OR (decide_par IS NOT NULL AND decide_le IS NOT NULL)),
  -- PRV-xxxx : pivot provisoire d'une personne connue de Codex ou Keystone mais pas encore de Cursus.
  CONSTRAINT correspondances_provisoire_check CHECK (
    (objet = 'personne' AND pivot_provisoire = coalesce(pivot LIKE 'PRV-%', false)) OR (objet <> 'personne' AND NOT pivot_provisoire)),
  CONSTRAINT correspondances_format_check CHECK (pivot IS NULL OR CASE objet
    WHEN 'personne' THEN pivot ~ '^(EMP|PRV)-[0-9]{4,}$'
    WHEN 'pays'     THEN pivot ~ '^[A-Z]{2}$'
    WHEN 'site'     THEN pivot ~ '^[a-z][a-z0-9_]{1,31}$'
    WHEN 'unite'    THEN pivot ~ '^[A-Z]{3}(-[A-Z0-9]{2,12}){0,2}$'
    WHEN 'titre'    THEN pivot ~ '^(formation|habilitation)\.[a-z0-9_]+$'
    ELSE btrim(pivot) <> '' END)
);
COMMENT ON TABLE matrix.correspondances IS 'Transition : identifiant local d''un outil → clé commune (matricule EMP-xxxx ou PRV-xxxx, code projet Keystone, code de site, code d''unité, code ISO, titre_id Cursus, identifiant Codex). Publiée (lignes décidées) par matrix.pub_correspondances.';
COMMENT ON COLUMN matrix.correspondances.objet IS 'personne (D01), projet (D02, D03), site (D14), unite (D15), pays (D17), titre (D08), document (D10).';
COMMENT ON COLUMN matrix.correspondances.table_locale IS 'Table de l''outil qui porte l''identifiant local : persons, users, people, employes, departments, equipes, sites, events, training_titles, documents…';
COMMENT ON COLUMN matrix.correspondances.id_local IS 'Identifiant local en texte : uuid, slug, entier, numéro de document, code « K-2025-042 »…';
COMMENT ON COLUMN matrix.correspondances.cle_naturelle IS 'Clé lisible qui survit au rechargement d''une démo : short_name Keystone (les uuid sont régénérés, seed/context.ts:7), slug Vigie, nom d''équipe Cursus.';
COMMENT ON COLUMN matrix.correspondances.libelle_local IS 'Libellé local, pour l''écran de validation. Non publié (noms de personnes).';
COMMENT ON COLUMN matrix.correspondances.pivot IS 'Clé commune. Nulle pour a_creer et abandonne.';
COMMENT ON COLUMN matrix.correspondances.methode IS 'nom_exact (probable), nom_court (à vérifier), code, rang (documents Keystone → Codex), manuel, jeu_demo. Jamais le nom de famille seul.';
COMMENT ON COLUMN matrix.correspondances.decide_par IS 'Qui a validé, abandonné, rejeté ou retiré : RH pour les personnes, informatique pour le reste.';
-- Une seule décision vivante par couple (identifiant local, pivot) ; un identifiant local peut viser plusieurs
-- pivots (titre Vigie « conduite » éclaté en ac489 et ac484) et un pivot plusieurs identifiants (deux codes K-…
-- de Vigie pour un même projet Keystone).
CREATE UNIQUE INDEX IF NOT EXISTS correspondances_vivante_unique
  ON matrix.correspondances (objet, outil, table_locale, id_local, coalesce(pivot, ''))
  WHERE statut NOT IN ('rejete', 'retire');
-- Personnes : une fiche locale a au plus un matricule validé, et un matricule au plus une fiche par table.
CREATE UNIQUE INDEX IF NOT EXISTS correspondances_personne_local_unique
  ON matrix.correspondances (outil, table_locale, id_local) WHERE objet = 'personne' AND statut = 'valide';
CREATE UNIQUE INDEX IF NOT EXISTS correspondances_personne_pivot_unique
  ON matrix.correspondances (outil, table_locale, pivot) WHERE objet = 'personne' AND statut = 'valide';
CREATE INDEX IF NOT EXISTS correspondances_pivot_idx ON matrix.correspondances (objet, pivot);

-- ── 6. Vues publiées ─────────────────────────────────────────────────────
-- Contrat : on n'en retire ni ne renomme de colonne (sinon nouvelle vue _v2) ; ajout en fin de liste seulement.

CREATE OR REPLACE VIEW matrix.pub_pays WITH (security_barrier) AS
SELECT p.iso2,      -- Cursus : jointure destinations.code ; Keystone : countries.iso2, public_holidays.country_code
       p.nom_fr,    -- Cursus : cache destinations.pays, rafraîchi par Cursus (affiché par dataset.ts:56)
       p.nom_en,    -- Keystone : rattachement de countries.name (étape 1 de D17), affichage
       p.actif      -- tous : listes de choix
FROM matrix.pays p;
COMMENT ON VIEW matrix.pub_pays IS 'Contrat D17 v1. Lecteurs : keystone_app, codex_app, cursus_app, vigie_app.';

CREATE OR REPLACE VIEW matrix.pub_sites WITH (security_barrier) AS
SELECT s.code,       -- Codex : sites.key (cache) ; Vigie : sites.id ; Cursus : contrôle de employes.site_code ; Keystone : storage_locations.site_code (facultatif)
       s.libelle,    -- Codex : sites.label (cache) ; Vigie : sites.label (cache) ; Cursus : affichage du site
       s.ville,      -- Keystone : rattachement des emplacements de stock
       s.pays_iso2,  -- Keystone, Cursus : pays du site
       s.ordre,      -- Codex : sites.sort (cache) ; Vigie : sites.sort (cache)
       s.actif       -- tous : listes de choix (un site fermé reste lisible pour l'historique)
FROM matrix.sites s;
COMMENT ON VIEW matrix.pub_sites IS 'Contrat D14 v1. Lecteurs : keystone_app, codex_app, cursus_app, vigie_app.';

CREATE OR REPLACE VIEW matrix.pub_organigramme WITH (security_barrier) AS
WITH RECURSIVE arbre AS (
  SELECT o.code, o.niveau, o.parent_code, o.code AS departement_code, NULL::text AS service_code,
         o.libelle_fr, o.libelle_en, o.responsable_matricule, o.site_code, o.ordre, o.actif
  FROM matrix.organigramme o
  WHERE o.parent_code IS NULL
  UNION ALL
  SELECT o.code, o.niveau, o.parent_code, a.departement_code,
         CASE WHEN o.niveau = 'service' THEN o.code ELSE a.service_code END,
         o.libelle_fr, o.libelle_en, o.responsable_matricule, o.site_code, o.ordre, o.actif
  FROM matrix.organigramme o
  JOIN arbre a ON o.parent_code = a.code
)
SELECT code,                   -- tous : clé (Codex departments.code, Keystone departments.org_code, Cursus unite_code)
       niveau,                 -- Codex : niveau = 'departement' ; Cursus : niveau = 'equipe' ; Keystone : service ou département
       parent_code,            -- Cursus, Keystone : arborescence
       departement_code,       -- Codex : users.department (cache) d'un salarié rattaché à une équipe, contrôle « confidentiel » (access.ts:80)
       service_code,           -- Keystone : service d'une équipe Cursus (persons.department_id)
       libelle_fr,             -- Codex label_fr ; Cursus nom de l'équipe
       libelle_en,             -- Codex label_en ; Keystone departments.name
       responsable_matricule,  -- Keystone head_person_id ; Cursus managerId ; Codex resp_departement
       site_code,              -- Cursus : équipes du site
       ordre,                  -- tous : ordre d'affichage
       actif                   -- tous : listes de choix ; une unité fermée reste lisible (identifiants de documents)
FROM arbre;
COMMENT ON VIEW matrix.pub_organigramme IS 'Contrat D15 v1. Une ligne par unité, avec son département et son service. Lecteurs : keystone_app, codex_app, cursus_app, vigie_app.';

CREATE OR REPLACE VIEW matrix.pub_correspondances WITH (security_barrier) AS
SELECT c.objet,             -- tous : filtre (personne, projet, site, unite, pays, titre, document)
       c.outil,             -- un outil ne voit que ses propres lignes (filtre de la vue sur current_user)
       c.table_locale,      -- table locale à mettre à jour
       c.id_local,          -- clé de jointure avec la table locale
       c.cle_naturelle,     -- Keystone : rattachement après rechargement de la démo (uuid régénérés)
       c.pivot,             -- valeur à poser : persons.matricule, events.keystone_project_code, training_titles.id, documents.codex_id…
       c.pivot_provisoire,  -- Codex, Keystone : PRV-xxxx, à remplacer par le matricule EMP quand les RH créent la fiche
       c.statut,            -- valide : à appliquer ; abandonne : ligne de démonstration à ne pas reprendre
       c.decide_le          -- tous : reprise incrémentale
FROM matrix.correspondances c
WHERE c.statut IN ('valide', 'abandonne')
  -- Chaque rôle d'outil ne lit que les lignes de son outil : cle_naturelle porte des noms (short_name des
  -- personnes de Keystone). current_user est ici le rôle qui interroge la vue, pas son propriétaire.
  -- Matrix (propriétaire) et ses administrateurs lisent tout.
  AND (current_user::text NOT IN ('keystone_app', 'codex_app', 'cursus_app', 'vigie_app')
       OR current_user::text = c.outil || '_app');
COMMENT ON VIEW matrix.pub_correspondances IS 'Contrat transition v1 : correspondances décidées (valide, abandonne). Chaque outil ne voit que ses lignes. libelle_local n''est pas publié. Lecteurs : keystone_app, codex_app, cursus_app, vigie_app.';
