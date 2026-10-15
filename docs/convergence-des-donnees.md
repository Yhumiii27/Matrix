# Convergence des données : plan de mise en œuvre des 20 décisions

État au 15 octobre 2026. Ce plan dit comment appliquer, dans les quatre outils et dans Matrix, les 20 décisions sur les doublons (M-02). Il s'appuie sur six analyses du code (personnes et organisation, projets et planning, formations et titres, documents, qualité, tiers et audit) et sur le SQL de partage écrit et essayé dans `infra/postgres/partage/`.

Sommaire : 1. Cadre · 2. Synthèse · 3. Les décisions · 4. Référentiels de Matrix · 5. Plan par outil · 6. Ordre des lots · 7. Contrôles de Matrix · 8. Questions ouvertes · Annexe : vérifications.

## 1. Cadre

### 1.1 Ce que couvre le document

- Pour chaque décision : l'outil qui fait foi, ses tables et les colonnes à ajouter, les vues publiées, ce que lit chaque autre outil, ce que devient sa table locale, les clés étrangères touchées, la reprise des identifiants, les fichiers à changer, les API, la charge et les risques.
- Les référentiels tenus par Matrix : pays, sites, organigramme, correspondances.
- Le plan consolidé par outil, l'ordre des lots, les contrôles de Matrix et les questions qui restent à trancher.

Hors de ce document : le serveur commun et la bascule de chaque outil vers PostgreSQL (`docs/architecture-postgres.md`), le détail des flux d'heures et d'absences de D06 et D07 (`docs/remplacement-lucca.md`).

Les numéros de ligne renvoient aux dépôts des outils, aux commits lus par les analyses (keystone 9bd597e, codex 8abbe38, vigie b658790, cursus f70619f). Les chiffres de rapprochement viennent des jeux de démonstration : aucune base de production n'a été lue.

### 1.2 Décisions de référence

- Journal des décisions : [`docs/decisions.md`](decisions.md). Texte intégral de chaque option : `data/doublons.json`, champ `decision`.
- D02, D03 et D04 suivent l'option B, les 17 autres groupes l'option A.
- D06 est provisoire (M-03) : tout est préparé, rien n'est retiré de Lucca.

### 1.3 Convention de partage

| Règle | Application |
|---|---|
| L'outil qui fait foi publie des vues `pub_<objet>` dans son schéma. | 35 vues : 4 dans `matrix` (fichier `10`), 31 dans les schémas des outils (fichiers `20` à `60` de `infra/postgres/partage/`). |
| Le lecteur reçoit `USAGE` sur le schéma et `SELECT` sur ces vues, rien d'autre. | `90-droits.sql` pose les droits vue par vue, sous `SET ROLE` du propriétaire. Aucun droit sur une table. |
| Les écritures d'un outil chez un autre passent par une API. | Liste des routes au § 5.7. Aucun `INSERT` ni `UPDATE` croisé. |
| Pas de clé étrangère entre schémas. | Une référence croisée est une colonne texte (ou uuid). L'outil la contrôle à la saisie contre la vue. Matrix cherche les orphelins (§ 7.1). |
| Une vue `pub_` est un contrat. | On ajoute des colonnes en fin de liste. Retirer, renommer ou changer le type d'une colonne demande une vue `_v2`. Le commentaire de chaque vue porte « Contrat Dxx v1 » et ses lecteurs. |
| Aucune donnée de santé ni colonne sensible dans une vue `pub_`. | `cursus.employes` : `visite`, `passeport_numero`, `passeport_expire`, `naissance`, `reprise_motif`, `reprise_date` ; `cursus.vaccinations` ; `cursus.visas` ; `cursus.entretiens.cr` ; `vigie.events` : `injury`, `lost_days`. `90-droits.sql` refuse tout le partage si une vue `pub_` lit l'une d'elles (essayé). |

Règles techniques qui en découlent, vérifiées sur PostgreSQL 16.15 :

- Une vue `pub_` ne lit que des tables de son schéma. `90-droits.sql` refuse une vue qui dépend d'un autre schéma. Chaque outil peut donc recréer ses vues dans ses propres tests.
- Une vue s'exécute avec les droits de son propriétaire : `security_invoker` reste faux, le contrôle le refuse. Toutes les vues portent `security_barrier`.
- Une vue appartient au propriétaire de son schéma. Une vue créée par un superutilisateur lirait tout : le contrôle la refuse.
- PostgreSQL refuse de supprimer ou de changer le type d'une colonne lue par une vue. Une migration qui touche une colonne publiée recrée la vue dans la même migration. drizzle-kit ne connaît pas ces vues : elles vont dans des migrations SQL écrites à la main.
- Un lecteur Drizzle déclare la vue lue avec `pgSchema('cursus').view('pub_salaries', {…}).existing()`. Essai fait pour ce plan avec drizzle-kit 0.31.11 et drizzle-orm 0.45.3 : `generate` n'écrit aucune ligne pour la vue, avec ou sans `schemaFilter`, et un second `generate` répond « No schema changes ». Si le fichier de schéma exporte l'objet `pgSchema('cursus')`, drizzle-kit écrit `CREATE SCHEMA "cursus";` en tête de migration, même avec `schemaFilter: ['vigie']`. Règle : on n'exporte jamais l'objet `pgSchema` d'un autre outil, comme pour le sien (`docs/architecture-postgres.md`, § 4.2).

**Cache local ou lecture directe.** Une table locale reste, comme cache rafraîchi par son outil depuis la vue, dans trois cas :

1. des clés étrangères locales la visent (exemple : `codex.projects`, visée par `codex.documents.project_code`) ;
2. une vue `pub_` de l'outil a besoin de la valeur (exemple : `vigie.people.name`, lu par `vigie.pub_non_conformites.owner_name`) ;
3. les règles de l'outil la lisent à chaque action et l'outil doit tourner sans serveur commun (équipes et projets de Cursus, qui garde SQLite en repli).

Dans les autres cas, l'outil lit la vue au moment du besoin et sa table locale disparaît. Personne ne saisit dans un cache : seule la tâche de rafraîchissement de l'outil l'écrit. L'outil écrit dans son propre schéma ce qu'il a lu : ce n'est pas une écriture croisée.

**Modes de repli.** Sans `DATABASE_URL`, Keystone, Codex et Vigie tournent sur PGlite et Cursus sur SQLite (`docs/architecture-postgres.md`, § 1). Les vues des autres outils n'y existent pas. Les caches gardent alors le contenu de la démonstration. Pour les lectures directes, chaque outil charge des substituts : des vues de mêmes colonnes sur des lignes de démonstration (PGlite), ou des fichiers JSON de même forme (SQLite de Cursus). Matrix publie la forme de chaque vue (§ 7.3), d'où l'on tire les substituts. L'usage réel des applications Mac reste à confirmer (C-04).

### 1.4 Écarts entre le texte des décisions et la mise en œuvre

La convention de partage remplace les copies synchronisées et les API de lecture que citent certaines options. L'outil qui fait foi reste celui de la décision.

| Décision | Texte de l'option | Mise en œuvre | Raison |
|---|---|---|---|
| D01 | Tables « réduites » chez les lecteurs | Les colonnes copiées de Cursus (nom, initiales, unité, site, poste) restent en cache, jamais saisies localement. | Clés locales (`codex.users.department`, `users.site`) et vues `pub_` des lecteurs (`owner_name`, `assignee_name`). |
| D02 | « Miroirs synchronisés » dans Codex, Vigie et Cursus | Codex et Cursus : cache rafraîchi depuis `keystone.pub_projets`. Vigie : lecture directe, `vigie.keystone_projects` supprimée. | Aucune clé étrangère ne vise le miroir de Vigie. |
| D04 | « Copies synchronisées » | Lecture directe de `keystone.pub_affectations`. `cursus.missions` et `vigie.keystone_assignments` sont supprimées. | Une requête sur la vue suffit aux alertes calculées en masse. |
| D11 | « Keystone lit /api/registry » | Keystone lit `codex.pub_types_document`, `pub_circuits_type` et `pub_titulaires_fonction`. `/api/registry` reste pour les lecteurs HTTP. | Lecture par vue. |
| D13 | « Vigie publie /api/ncrs et /api/hse » | Vues `vigie.pub_non_conformites` et `pub_hse_projet`. L'API de Vigie ne sert qu'aux écritures. | Lecture par vue. |
| D06 (préparation) | Lectures P1, P2 et P3 par API (`docs/remplacement-lucca.md`, § 2) | `cursus.pub_salaries`, `keystone.pub_projets`, `keystone.pub_taches_jours`. | Lecture par vue. La convention répond à la question L-07. |

Deux choix de ce plan s'écartent des analyses :

- `cursus.equipes` reste comme cache de l'organigramme, avec le code Matrix pour clé (l'analyse D15 la supprimait). `cursus.projets` reste comme cache de `keystone.pub_projets` (l'analyse D02 la supprimait). Sans eux, Cursus ne tourne plus en repli SQLite (tests, application Mac) et perd ses clés locales.
- Les vues locales `codex.v_users`, `vigie.v_people` et `vigie.v_sites` de l'analyse D01 ne sont pas retenues. Les colonnes qu'elles calculaient restent en cache, d'après la règle du § 1.3. Ainsi `vigie.people.name` reste lisible par `vigie.pub_non_conformites` sans dépendance vers le schéma `cursus`.

### 1.5 Prérequis et alignements

**Prérequis.**

| Prérequis | Où | Ce qu'il bloque |
|---|---|---|
| M-05 : autorisation de modifier le code des quatre outils | `docs/decisions.md` | Tout. |
| Socle du serveur commun, puis bascule de Codex, Vigie, Keystone et Cursus (étapes 0 à 4) | `docs/architecture-postgres.md`, § 10 | Les vues d'un outil attendent sa bascule. Tout ce qui lit Cursus attend l'étape 4. |
| Couche d'accès asynchrone de Cursus | `docs/architecture-postgres.md`, § 8.1 | Toute lecture d'une vue ou d'une API depuis une action de Cursus. Les actions sont synchrones aujourd'hui (`server/src/index.ts:106-114`). |
| D20 technique : `pgSchema` non exporté, migration de base régénérée, migrateur dans le schéma de l'outil | `docs/architecture-postgres.md`, § 4.2 et 4.3 | Le premier déploiement d'une vue. |
| D06 et D07 | `docs/remplacement-lucca.md` | Heures et absences. |

**Alignements à faire dans les fichiers de l'autre chantier.** Ce plan ne les modifie pas.

1. `infra/postgres/init/03-droits.sql:513-529`, bloc « Accès des rôles aux schémas : chaque outil chez soi » de `droits.verifier()`. Après `90-droits.sql`, il signale 14 erreurs « droit USAGE inattendu » : keystone_app sur matrix, cursus, codex et vigie ; codex_app sur matrix, cursus, keystone et vigie ; cursus_app sur matrix et keystone ; vigie_app sur matrix, cursus, keystone et codex. Règle à écrire : un `USAGE` croisé est permis quand le rôle n'a, dans ce schéma, que `SELECT` sur des vues `pub_`. Le cas 99 de `infra/postgres/verifier-droits.sql` (« droits.verifier() sans erreur ») échoue tant que ce bloc n'est pas adapté.
2. `infra/postgres/init/03-droits.sql:608-622` : la liste `droits.colonnes_sensibles` n'a pas `cursus.employes.reprise_date`, que la convention classe sensible. `matrix_lecture` la lit aujourd'hui. `90-droits.sql` l'a déjà dans sa liste locale.
3. `docs/architecture-postgres.md:14` (« Un outil ne lit ni n'écrit dans le schéma d'un autre ») et `:685` (« Aucun rôle d'outil ne lit le schéma `cursus` ») : à remplacer par la convention de partage. Les écritures restent des API, comme le dit déjà ce texte.
4. `docs/remplacement-lucca.md` :
   - § 3.9 et L-07 : la convention permet la lecture des vues `pub_` ;
   - P1 (annuaire), P2 (projets) et P3 (tâches) deviennent des lectures de vues ; le lot K4 de Keystone (1 j) disparaît ;
   - `employes.site` (`:412`, lot C1) devient `employes.site_code`, nom retenu par D01 et par `20-cursus.sql` ; `feuilles.site` le copie à la soumission ;
   - `cursus.projets` reste un cache de `keystone.pub_projets` : ses colonnes viennent de la vue (`code_analytique`, `nature`, `imputable`) ;
   - le numéro de tâche d'une ligne de feuille s'appelle `tacheKeystone`, comme dans les contrats JSON (l'analyse D05 disait `tacheRef`) ;
   - `employes.email` n'a pas d'usage dans le code. Le rapprochement des personnes passe par les correspondances de Matrix (§ 4.5). La colonne viendra avec le fournisseur d'authentification (M-06) ;
   - H3 (heures par site et par mois, lues par Vigie) est une lecture et pourrait devenir une vue `cursus.pub_heures_site_mois`. `docs/remplacement-lucca.md` garde l'API parce que `complet` se calcule en TypeScript. Ce choix revient à ce chantier-là.

## 2. Tableau de synthèse

| Objet | Fait foi | Table(s) source | Publié par | Lecteurs | Copie locale des autres outils | Décision |
|---|---|---|---|---|---|---|
| D01 Personnes | Cursus | `cursus.employes` | `cursus.pub_salaries` | Keystone, Codex, Vigie, Matrix | `keystone.persons` : cache + `matricule`, externes gardés ; `codex.users` : cache + `matricule`, `title` supprimée ; `vigie.people` : cache + `matricule` | A |
| D02 Projets | Keystone | `keystone.projects` (+ `kind`) | `keystone.pub_projets` | Codex, Cursus, Vigie, Matrix | `codex.projects` : cache ; `cursus.projets` : cache ; `vigie.keystone_projects` : supprimée (code projet dans 4 tables) | B |
| D03 Chantiers | Keystone pour la fiche, Cursus pour les exigences | `keystone.site_sheets`, `site_rotations` | `keystone.pub_chantiers` (+ `pub_affectations`) | Cursus, Matrix | `cursus.chantiers` réduite à `projet_code`, `habs`, `certs` | B |
| D04 Affectations | Keystone | `keystone.site_rotations`, `activity_assignments` | `keystone.pub_affectations` | Cursus, Vigie, Matrix | `cursus.missions`, `vigie.keystone_assignments` : supprimées | B |
| D05 Tâches | Keystone | `keystone.tasks` | `keystone.pub_taches_jours` | Cursus, Matrix | `cursus.taches` : supprimée | A |
| D06 Temps passés | Cursus (provisoire) | `cursus.feuilles` | API H1 vers Keystone ; vues `*_v1` pour Matrix | Keystone, Vigie, Matrix | voir `docs/remplacement-lucca.md` | A, provisoire |
| D07 Absences | Cursus | `cursus.absences` | API H2 vers Keystone | Keystone, Matrix | `keystone.leave_entries` : copie en lecture | A |
| D08 Catalogue des titres | Cursus | `cursus.formations`, `habilitations` | `cursus.pub_titres` | Vigie, Keystone, Matrix | `vigie.training_titles` réduite à `id`, `sort` | A |
| D09 Titres détenus | Cursus | `cursus.certifications` (+ `organisme`), `hab_titres` | `cursus.pub_titres_detenus` | Vigie, Keystone, Matrix | `vigie.qualifications`, `keystone.certifications` : supprimées | A |
| D10 Documents | Codex | `codex.documents` (+ 3 colonnes), `revisions`, `working_versions`, `workflows`, `workflow_steps` | `codex.pub_documents`, `pub_revisions_document`, `pub_validations` | Keystone, Vigie, Matrix | `keystone.documents` réduite à un index (`codex_id`), 3 tables supprimées ; `vigie.documents`, `document_versions` : migrées dans Codex puis supprimées | A |
| D11 Registre des types | Codex | `codex.doc_types`, `families`, `functions`, `function_holders` | `codex.pub_types_document`, `pub_circuits_type`, `pub_titulaires_fonction` | Keystone, Vigie, Matrix | `keystone.document_types`, `document_type_circuit_steps`, `document_approver_assignments` : supprimées | A |
| D12 ECR et ECO | Vigie | 9 tables à créer : `vigie.ecos`, `ecrs`, `eco_*`, `external_progress` | `vigie.pub_ordres_modification`, `pub_eco_approbations`, `pub_eco_effectivite`, `pub_demandes_modification` | Keystone, Codex, Matrix | `keystone.vigie_eco*` (5 tables) : cache ; `codex.change_requests` : cache | A |
| D13 NC et HSE de projet | Vigie | `vigie.events` (NC, + 11 colonnes), `prevention_plans`, `permits`, `inductions` | `vigie.pub_non_conformites`, `pub_hse_projet` | Keystone, Matrix | `keystone.vigie_ncrs`, `vigie_hse_items` : cache | A |
| D14 Sites | Matrix | `matrix.sites` | `matrix.pub_sites` | les 4 outils | `codex.sites` : cache ; `vigie.sites` : cache + attributs Seveso ; `cursus.employes.site_code` | A |
| D15 Organisation | Matrix | `matrix.organigramme` | `matrix.pub_organigramme` | les 4 outils | `codex.departments` : cache (+ `active`) ; `keystone.departments` : cache (+ `org_code`) ; `cursus.equipes` : cache, clé = code Matrix | A |
| D16 Clients et fournisseurs | Keystone | `keystone.clients`, `suppliers` | `keystone.pub_clients`, `pub_fournisseurs` (+ colonnes de `pub_projets`) | Vigie, Codex, Cursus, Matrix | `vigie.contractors` gardée + `supplier_id` ; clients en texte remplacés par le projet | A |
| D17 Pays | Matrix | `matrix.pays` | `matrix.pub_pays` | les 4 outils | `keystone.countries` gardée + `iso2` ; `cursus.destinations` gardée, `pays` en cache | A |
| D18 Journaux d'audit | chaque outil | `keystone.audit_entries`, `activity_events` ; `codex.audit_log` ; `cursus.journal` ; `vigie.journal` (à créer) | 4 vues `pub_journal`, réunies par `matrix.journal_unifie` | Matrix | toutes gardées | A |
| D19 Paramètres et fichiers | chaque outil | `cursus.settings` (horizon d'alerte) | `cursus.pub_parametres` | Vigie, Matrix | aucune ; Vigie lit l'horizon au lieu de sa constante | A |
| D20 Homonymes | sans objet | | | | aucun renommage ; le schéma sert de préfixe | A |

## 3. Les décisions

Chaque section suit le même ordre : ce qui change, source, vues, lecteurs, clés étrangères locales, rapprochement, code, API, charge, risques. Les charges sont en jours de développement, tests compris, hors bascule vers PostgreSQL. Elles reprennent celles des analyses ; le SQL de partage déjà écrit en retire une partie quand l'analyse comptait l'écriture des vues.

### D01 · Personnes (option A)

**Ce qui change.** Cursus tient la seule fiche de chaque salarié. Le matricule `EMP-xxxx` devient la clé commune. Keystone, Codex et Vigie gardent une table locale reliée au matricule. Keystone garde aussi ses personnes externes : contacts client et rôles contractuels.

**Source.** `cursus.employes`. Colonnes ajoutées par `20-cursus.sql`, à reporter dans `server/migrations-pg/` :

| Colonne | Type | Rôle |
|---|---|---|
| `matricule` | texte généré, unique | Déjà dans `infra/postgres/cursus/schema.sql`. Même calcul que `shared/format.ts:21`. |
| `site_code` | texte, code de `matrix.pub_sites` | Site de rattachement (D14). `agence` reste l'agence d'intérim. |
| `unite_code` | texte, code de `matrix.pub_organigramme` | Remplace `equipe` (D15). |
| `sortie` | date, `CHECK (sortie >= entree)` | Sortie effective, CDI compris. `fin` ne vaut que pour les contrats à terme (`shared/rules/profil.ts:62`). |

**Vue.** `cursus.pub_salaries` : `matricule`, `nom`, `poste`, `unite_code`, `site_code`, `entree`, `sortie`, `actif`. Lecteurs : keystone_app, codex_app, vigie_app, matrix_app. Elle ne porte ni donnée de santé, ni donnée de contrat (temps, heures, forfaits, agence, statut, type de contrat), ni aptitude.

**Lecteurs.**

| Outil | Lit | Table locale |
|---|---|---|
| Keystone | `pub_salaries`, par une tâche de synchronisation | `persons` gardée (105 clés entrantes). Ajout de `matricule` : unique, nul pour un externe, interdit avec `client_id`. La tâche écrase `full_name`, `short_name`, `initials` et `department_id` (par l'organigramme, D15) des lignes qui ont un matricule. `job_title` reste local : il sert de clé de taux horaire (`tasks.ts:194`) et repère les chefs de projet (`projects-register.ts:194`). `users` ne change pas. |
| Codex | `pub_salaries` et `matrix.pub_organigramme` | `users` gardée (15 clés entrantes). Ajout de `matricule` : unique, nul pour les comptes système. `name`, `initials`, `department` (département de l'unité) et `site` deviennent un cache. `title`, jamais lue, est supprimée. |
| Vigie | `pub_salaries` | `people` gardée (18 clés entrantes). Ajout de `matricule`. `name`, `job` et `site_id` deviennent un cache ; `site_id` reste nul quand Vigie ne suit pas le site du salarié (colonne nullable, clé vers `vigie.sites`). `savePerson` devient « rattacher un salarié Cursus ». |

**Clés étrangères locales.** Aucune ne disparaît. `codex.users.department → departments` et `users.site → sites` restent : les deux tables cibles deviennent des caches complets (D14, D15).

**Rapprochement** (jeux de démonstration).

- Cursus et les trois autres : aucun rapprochement sûr. Un seul nom commun, « Aïcha Diallo », probablement deux personnes : gestionnaire de paie (EMP-0007) dans Cursus, responsable de zone dans Keystone. 24 noms de famille sont communs, jamais avec le même prénom : on ne rapproche jamais sur le nom de famille seul.
- Codex et Keystone : 11 noms complets identiques, 3 noms courts (S. Perrin, C. Moreau, L. Fabre), 2 orthographes proches à vérifier (Samir et Sami Haddad, Camille et Claire Morvan). Les 14 premiers reçoivent un pivot provisoire `PRV-xxxx` en attendant leur fiche Cursus.
- Vigie : 12 noms provisoires entre crochets, sans équivalent. Saisie manuelle.
- Keystone : 29 personnes à classer salarié ou externe (22 avec nom complet, 7 avec nom court seulement). Externes évidents : Nadia Bensaïd (client) et « Contractant — 2 monteurs ». 5 matricules sont nuls dans `keystone.cursus_clearances` (HLT-026).
- Méthode : Matrix propose (nom complet normalisé : probable ; nom court : à vérifier), les RH valident. La correspondance garde `short_name` comme clé lisible, car les uuid de Keystone changent à chaque rechargement de la démo (`seed/context.ts:7`).

**Code.**

- Cursus : `server/src/db.ts:17-24` (colonnes ; `matricule` exclu des insertions), `shared/types.ts:50-80`, `shared/rules/profil.ts:31-34` et `62-107` (site connu, sortie après l'entrée), `client/src/dialogs/EmployeDialog.tsx`, `client/src/pages/Collaborateurs.tsx` (filtre des sortis), `server/src/index.ts:150` (recherche par matricule). Tests : `tests/server.test.ts`, `tests/equipes.test.ts`.
- Keystone : `src/server/db/schema/organisation.ts` (colonne, contrainte, vue déclarée `.existing()`) ; nouvelle tâche `src/server/integrations/cursus/people-sync.ts`, qui crée aussi les personnes des salariés des unités suivies, faute d'écran de création ; `integrations/cursus/mirror.ts:18-19` (personne cherchée par matricule) ; `connector.ts:138`, `152-153`, `167-170` ; `seed/organisation.ts`. Tests golden `delivery*.test.ts`, `scripts/db-check.ts`.
- Codex : `src/db/schema.ts:35-44` ; tâche de rafraîchissement de `users` (au démarrage, toutes les 15 minutes, sur demande) ; `src/db/seed-org.ts` ; écran Administration pour rattacher un utilisateur à un matricule (Codex n'a pas d'écran de création d'utilisateur).
- Vigie : `src/db/schema.ts:16-24` ; rafraîchissement de `people` ; `src/server/skills.ts:113-145` et `components/skills/PersonForm.tsx` (rattachement) ; `SkillMatrix.tsx:169` (bouton « Connecteur Cursus » activé) ; script qui remplace les noms provisoires dans `events.declarant`, `review_items.owner`, `permits.performer`, `attachments.uploaded_by`.

**API.** Aucune nouvelle. `POST /api/integrations/keystone/demandes` de Cursus porte déjà le matricule (`server/src/index.ts:147-157`).

**Charge.** Cursus 2 j, Keystone 4 j, Codex 2 j, Vigie 3 j.

**Risques.**

- Le matricule dérive de `employes.id` : la reprise depuis SQLite garde les identifiants (`docs/architecture-postgres.md`, § 8.6). L-02 (`docs/remplacement-lucca.md`) demande si c'est le matricule de paie.
- `keystone.persons.short_name` est unique : la synchronisation doit gérer les collisions. Plus de 50 colonnes `*_name` de Keystone sont des copies figées du nom.
- Codex : les droits « confidentiel » suivent l'unité Cursus (`src/lib/access.ts:80`). Un salarié sans unité perd ses droits de département.
- Les salariés sortis restent dans la vue : les listes de choix filtrent sur `actif`. `actif` se calcule à la date du serveur, sans `CURSUS_TODAY` (`server/src/dataset.ts:19-21`) : en démonstration figée, il peut différer de Cursus.

### D02 · Projets (option B)

**Ce qui change.** Keystone fait foi pour tous les projets, codes internes compris. Les 8 codes hors projet de Cursus (INT-PROD, INT-LOG, INT-MAINT, INT-HSE, INT-QUA, INT-ADM, INT-COM, ECOLE) deviennent des projets internes de Keystone, avec leur code analytique.

**Source.** `keystone.projects` (`src/server/db/schema/portfolio.ts:158-205`). Colonne ajoutée : `kind` (`client` ou `internal`, `client` par défaut). Les 8 projets internes gardent le code Cursus, ce qui laisse valables les feuilles déjà saisies et le test `tests/correctifs.test.ts:180`. Valeurs : `short_code` INT ou ECO, `number` et `client_id` nuls, `sort_order` à partir de 1000, `analytic_code` fourni par la finance (Sage), phase à choisir (C-07).

**Vue.** `keystone.pub_projets` : `code`, `numero`, `code_analytique`, `nature`, `nom`, `client_id`, `client`, `client_code3`, `phase_code`, `phase`, `imputable`, `chef_projet_matricule`, `chef_projet_nom`, `ville`, `pays`, `fournisseurs`, `maj_le`. Lecteurs : codex_app, cursus_app, vigie_app, matrix_app.

**Lecteurs.**

| Outil | Lit | Table locale |
|---|---|---|
| Codex | `pub_projets`, `nature = 'client'` | `projects` gardée en cache (`code`, `name`, `client`, `stage`, `manager_id`, `site`, `tiers`, `synced_at`), rafraîchie par codex_app (`INSERT … ON CONFLICT`), jamais vidée (conservation des documents). `manager_id` se relie par `users.matricule`, sinon au compte système `keystone` (`seed-org.ts:58`). |
| Cursus | `pub_projets` : `code`, `nom`, `nature`, `imputable`, `code_analytique` | `projets` gardée en cache, rafraîchie au démarrage et chaque nuit. La feuille de temps ne propose que les projets imputables. Les projets clos restent pour l'historique. |
| Vigie | `pub_projets` : `code`, `nom`, `client`, `numero`, `code_analytique`, `nature` | `keystone_projects` supprimée. Les 4 tables qui portent le texte « id · client » (`events`, `prevention_plans`, `permits`, `site_activities`) reçoivent `keystone_project_code`, indexée, sans clé. L'ancienne colonne devient `keystone_project_ancien`, affichée en lecture seule. |

**Clés étrangères locales.**

- Codex : `documents.project_code`, `project_expected.project_code` et `project_events.project_code` visent toujours `codex.projects` (codes identiques). `function_holders.scope_value` reste un lien logique.
- Cursus : `missions.projet` et `taches.projet` (`infra/postgres/cursus/schema.sql:423` et `:430`) disparaissent avec leurs tables (D04, D05). `feuilles.lignes[].projet` est du JSON, contrôlé par Matrix.
- Vigie : aucune.

**Rapprochement.**

- Codex : 3 projets sur 3 par le code (HLT-026, NDC-031, RCF-019). Keystone l'emporte quand les champs divergent : phases, client (« Autorité portuaire du Havre » contre « Port authority »), nom de RCF-019.
- Chefs de projet de Codex : raubert ↔ Romain Aubert, automatique ; sperrin et cmoreau par l'initiale seulement, à confirmer. Aucun n'est salarié dans la démo de Cursus.
- Codes internes de Cursus : 8 sur 8 si le code est gardé. Les 8 codes analytiques sont à saisir.
- Codes K-26xx de Cursus : 0 sur 6 (K-2614, K-2620, K-2611, K-2625, K-2631, K-2633). Ils figurent dans `chantiers` (5), `missions` (14), `taches` (8), `voyages.chantier` (4), `demandes_keystone.chantier` (4) et dans 14 feuilles validées.
- Codes K-AAAA-NNN de Vigie : 0 sur 10. 6 codes servent dans 21 lignes : `events` 10, `prevention_plans` 2, `permits` 5, `site_activities` 4.
- Les 16 codes inconnus vont dans `matrix.correspondances` : `a_creer` (projet réel à créer dans Keystone) ou `abandonne` (donnée de démonstration). Voir C-03.
- Reprise de Vigie : `split_part(keystone_project_ancien, ' · ', 1)` relié à `matrix.pub_correspondances` (essayé par l'analyse).

**Code.**

- Keystone : `schema/portfolio.ts` ; `listProjects` (`src/server/dal/projects.ts:79-93`) exclut `kind = 'internal'` sauf option, pour ses 28 appelants ; revue des 36 fichiers qui lisent `from(projects)`, dont `settings-lists.ts:100` ; liste « Projets internes » dans les Paramètres, car `createProject` et `createWizardProject` exigent un client ; `seed/portfolio.ts:66-80`. Tests : `src/server/db/db.test.ts:17`, `src/server/export/export.test.ts:117`, `src/server/dal/shell.test.ts:110-123`.
- Codex : `src/lib/keystone.ts` réécrit, comme prévu lignes 7-9, avec `syncProjects()` ; retrait de `PROJECTS` (`seed-org.ts:106-108`, `seed.ts:103`).
- Vigie : migration des 4 tables et suppression de `keystoneProjects` ; `lib/data/options.ts:15-20` ; les contrôles « Projet Keystone inconnu » (`server/events.ts:92-98`, `prevention.ts:104, 113-114, 289, 307-308`, `pp-import.ts:483, 491`, `sitemap.ts:230, 241`) ; les dialogues (`EventEditButton.tsx:39-66`, `PlanDialogs.tsx:60-126`, `PermitDialogs.tsx:77-182`, `sitemap/dialogs.tsx:157-207`, `ReviewStep.tsx:156`) ; les affichages (`evenements/page.tsx`, `lib/data/prevention.ts`, `lib/data/sitemap.ts`, `lib/data/audits.ts:187`) ; `matchProject` (`lib/pp-import/text.ts:252-263`) pour HLT-026, #026 et HAV004 ; démos et `scripts/pp-samples.mjs`.
- Cursus : `server/src/db.ts:15`, `dataset.ts:58`, `seed.ts:47-52, 298`, `client/src/pages/Temps.tsx:247` (filtre `imputable`), reprise des codes dans `feuilles.lignes`.

**API.** Aucune.

**Charge.** Keystone 3 j, Codex 2 j, Vigie 3,5 j, Cursus 1,5 j. Les correspondances sont comptées au § 4.

**Risques.** Des projets internes peuvent apparaître dans des écrans de Keystone qui ne passent pas par `listProjects`. Vigie n'a aucun test : seuls `typecheck` et `lint` vérifient le changement.

### D03 · Chantiers (option B)

**Ce qui change.** Keystone tient la fiche chantier : lieu, pays, dates, chef de projet et équipe. Cursus garde, par code projet, les habilitations et certifications exigées, et calcule le Go / No Go en lisant le reste dans Keystone.

**Source.** `keystone.site_sheets` (`src/server/db/schema/site.ts:17-37`, une fiche par projet) et `site_rotations` (`:80-98`). Aucune colonne ajoutée : le code ISO du pays vient de `countries.iso2` (D17). `site_sheets.cursus_chantier_id` est supprimée (vide en démo). Règle : `site_rotations.person_id` est renseigné pour tout salarié.

**Vues.** `keystone.pub_chantiers` : `projet_code`, `projet_nom`, `client`, `lieu`, `ville`, `pays`, `pays_iso2`, `debut`, `fin`, `chef_projet_matricule`, `chef_projet_nom`, `maj_le`. Lecteurs : cursus_app, matrix_app. L'équipe vient de `keystone.pub_affectations`, lignes `source = 'rotation'` (D04).

**Lecteur : Cursus.** `chantiers` est réduite à `projet_code` (clé), `habs`, `certs`, `maj_le`, `maj_par`. `nom`, `client`, `lieu`, `pays`, `debut`, `fin`, `chef` et `ressources` disparaissent. `loadFull` (`server/src/dataset.ts:59`) reconstruit un objet `Chantier` de même forme, et le calcul (`shared/domain.ts:383-436`) change peu. Quand une fiche nouvelle apparaît dans la vue, le rafraîchissement crée sa ligne d'exigences vide (« exigences à définir »). La décision NEW-CURSUS-1 de Keystone (« Keystone crée le chantier dans Cursus », `keystone/docs/DECISIONS.md:70`) est ainsi tenue sans API. Keystone garde `cursus_clearances` ; son `chantier_id` devient le code projet.

**Clés étrangères locales.** `voyages.chantier → chantiers` (`SET NULL`) et `demandes_keystone.chantier → chantiers` (`CASCADE`) visent désormais `chantiers(projet_code)`. Elles restent valides parce que chaque fiche Keystone a sa ligne d'exigences.

**Rapprochement.** 0 chantier sur 5 : Tanger, Feyzin, Abidjan, Tema et São Paulo, contre la seule fiche Keystone, HLT-026 au Havre. Équipes : aucun nom commun. Les exigences suivent dès que le code K est rattaché, sinon elles sont ressaisies. 8 lignes de `voyages` et `demandes_keystone` sont réécrites par la même correspondance.

**Code.**

- Keystone : écrans « Créer la fiche chantier » et rotations (ajout, modification, retrait ; choix limité aux personnes qui ont un matricule). Aucun `insert` ni `update` sur `siteSheets` ou `siteRotations` n'existe hors du jeu de démo (vérifié). `connector.ts:29-34` (`chantierOf` renvoie le code projet) et ses appelants `145-157`, `159-180`, `185-200` ; `links.ts:18-20` ; `dal/site.ts:51, 137, 144` ; `features/site/model.ts:152` ; `features/site/actions.ts:27, 125` (`NO_CURSUS_SITE` devient « pas de fiche chantier ») ; `seed/site.ts:24-29`. Tests : `src/server/dal/delivery5-writes.test.ts:272`, `src/features/site/actions.test.ts:137-142`.
- Cursus : `server/src/db.ts:16` et fusion dans `dataset.ts:59` ; `shared/types.ts:32` ; nouvelle action RH `chantier.exigences` et son écran dans `client/src/pages/Chantiers.tsx` (aucune action n'écrit les chantiers aujourd'hui) ; routes `server/src/index.ts:137-157` ; `seed.ts:54-60, 299` ; test `tests/domain.test.ts:69-76`.

**API.** Aucune nouvelle route. Le contrat de deux routes existantes de Cursus change : `GET /api/integrations/keystone/chantiers/:id/go-no-go` et `POST /api/integrations/keystone/demandes` prennent le code projet.

**Charge.** Keystone 4,5 j, Cursus 3,5 j.

**Risques.** Sans les écrans de Keystone, D03 et D04 restent bloqués : une seule fiche existe. Évaluer chaque personne sur ses dates de rotation, au lieu des dates du chantier, change le verdict (C-10). Les personnes sans matricule sortent du Go / No Go.

### D04 · Affectations (option B)

**Ce qui change.** Keystone fait foi pour les rotations de chantier et les affectations du planning. Cursus et Vigie ne saisissent plus rien et lisent la vue.

**Source.** `keystone.site_rotations` et `activity_assignments` (`schema/planning.ts:124-145`, dates de l'activité). `allocations` est exclue : ses 64 lignes de démo n'ont pas de projet (totaux par semaine, `seed/resources.ts:29-34`). La fiche D04 de `doublons.json` (« par semaine et projet ») se trompe sur ce point. Aucune colonne ajoutée.

**Vue.** `keystone.pub_affectations` : `source` (rotation ou planning), `affectation_id`, `matricule`, `personne_nom`, `projet_code`, `projet_nom`, `client`, `activite_code`, `activite`, `du`, `au`, `lieu`, `pays`, `pays_iso2`, `heures_prevues`. Seules les personnes qui ont un matricule y figurent. L'uuid `personne_id` n'est pas publié. Lecteurs : cursus_app, vigie_app, matrix_app.

**Lecteurs.**

| Outil | Lit | Table locale |
|---|---|---|
| Cursus | lignes `source = 'rotation'` ; `pays_iso2 <> 'FR'` donne « Déplacement international », sinon « Mission » | `missions` supprimée |
| Vigie | les deux sources, jointes par `people.matricule` ; libellé « code · client » recomposé | `keystone_assignments` supprimée |

**Clés étrangères locales.** Aucune n'entre dans ces deux tables. Disparaissent : `cursus.missions.emp_id → employes`, `missions.projet → projets`, `vigie.keystone_assignments.person_id → people`.

**Rapprochement.** Aucun : 0 personne commune entre Keystone et Cursus (seul le nom Roux coïncide, pour deux personnes). Les 14 missions de Cursus et l'affectation de Vigie sont des copies de démonstration : elles ne sont pas reprises.

**Code.**

- Keystone : la vue dans une migration SQL, un test.
- Cursus : `server/src/db.ts:35`, `dataset.ts:69, 132`, `seed.ts:176-184, 316`, `shared/types.ts:97`, `shared/rules/conges.ts:129-140` (alerte « Affecté au chantier »), `client/src/pages/Absences.tsx:126`, `Missions.tsx`, `Temps.tsx:238-280`.
- Vigie : `schema.ts:216-224`, `lib/data/skills.ts:14, 74, 95`, `server/skills.ts:57-59`, `components/skills/SkillMatrix.tsx:99`, `SkillAlerts.tsx:41-42, 108`, `lib/data/audits.ts:235-237`, `lib/data/todo.ts:50-51`, `seed.ts:287`.

**API.** Aucune.

**Charge.** Keystone 0,5 j (vue déjà écrite), Cursus 2 j, Vigie 1,5 j.

**Risques.** Un déplacement court sans fiche chantier n'a pas de place dans Keystone (K-2633 à Grenoble, C-10). Les imports de planning produisent beaucoup de lignes : les lecteurs filtrent sur `au >= current_date`. Une personne peut avoir une rotation et une ligne de planning sur le même projet.

### D05 · Tâches et heures prévues (option A)

**Ce qui change.** `cursus.taches` disparaît. Quand le salarié prépare sa feuille (action `temps.suggest`), Cursus lit ses tâches de la semaine dans Keystone.

**Source.** `keystone.tasks` (`schema/work.ts:17-50`). La personne est `assignee_person_id` ; la fiche de `doublons.json` cite à tort `person_id`. Aucune colonne ajoutée : les heures par jour répartissent `estimate_h` sur les jours ouvrés entre `start_date` et `due_date`.

**Vue.** `keystone.pub_taches_jours` : `tache_numero`, `matricule`, `projet_code`, `projet_nom`, `projet_nature`, `activite_code`, `titre`, `statut`, `jour`, `semaine`, `heures_prevues`. Les uuid `tache_id` et `personne_id` ne sont pas publiés. Lecture : `WHERE matricule = $1 AND semaine = $2`. Lecteurs : cursus_app, matrix_app. Essai : T-2314, 8 h sur 4 jours ouvrés, donne 2 h par jour.

**Lecteur : Cursus.** Une ligne de feuille par tâche : `projet` = `projet_code`, `tache` = `titre`, `h[i]` = `heures_prevues`, `tacheKeystone` = `tache_numero` (`shared/types.ts:101`). Cursus met ensuite à zéro fériés, absences et jours non travaillés (`shared/rules/temps.ts:94-100`). Les actions de Cursus tournent dans `db.tx` : la lecture se fait avant la transaction et passe dans le contexte de l'action.

**Clés étrangères locales.** `taches.emp_id → employes` et `taches.projet → projets` disparaissent avec la table.

**Rapprochement.** Rien à reprendre : les 32 lignes de démonstration ne sont pas migrées. 8 portent un code K de personnes absentes de Keystone, 24 sont internes. 17 salariés sur 24 n'ont que des lignes internes (C-11).

**Code.**

- Keystone : la vue dans une migration SQL, un test.
- Cursus : `server/src/actions/temps.ts:45-65`, `shared/rules/temps.ts:93-100` (`suggestLines` reçoit les lignes de Keystone), `client/src/pages/Temps.tsx:248` (`canSuggest`) ; suppression de `taches` (`db.ts:36`, `dataset.ts:70, 133`, `shared/types.ts:98, 147`, `seed.ts:162-174, 315`). Tests : `tests/server.test.ts:67-81`, `tests/equipes.test.ts:167-168`, avec un lecteur Keystone simulé.

**API.** Aucune : la vue remplace la route P3 de `docs/remplacement-lucca.md` (lot K4).

**Charge.** Keystone 0,5 j, Cursus 2,5 j. Le lot C5 de `docs/remplacement-lucca.md` est compté ici.

**Risques.** Régression pour les 17 salariés qui n'ont que des lignes internes. La répartition uniforme reste une approximation. Les titres des tâches deviennent visibles par Cursus, pour les seuls salariés qui ont un matricule.

### D06 · Temps passés (option A, provisoire) et D07 · Absences et congés (option A)

Le plan complet est dans `docs/remplacement-lucca.md` : flux H1 (heures validées) et H2 (absences validées) poussés par Cursus vers `POST /api/integrations/cursus/events` de Keystone, flux H3 lu par Vigie, file d'envoi `cursus.evenements_sortants`, vues de contrôle `cursus.heures_validees_v1`, `absences_validees_v1` et `heures_site_mois_v1` lues par Matrix, marche en parallèle et critères de bascule. Rien n'est retiré de Lucca tant que M-03 n'est pas confirmée.

Ce plan fournit à D06 et D07 leurs prérequis : D01 (matricule), D02 (projets internes et codes analytiques), D05 (tâche sur chaque ligne), D14 (site du salarié). Il remplace les lectures P1, P2 et P3 par des vues (§ 1.5). Charge propre de D06 et D07 : 19,5 j d'après `docs/remplacement-lucca.md` (§ 5.5), soit environ 17,5 j sans K4 (1 j, remplacé par les vues) et C5 (1 j, compté dans D05).

