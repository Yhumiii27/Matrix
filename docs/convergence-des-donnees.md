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
| Le lecteur reçoit `USAGE` sur le schéma et `SELECT` sur ces vues, rien d'autre. | `90-droits.sql` pose les droits vue par vue, sous `SET ROLE` du propriétaire. Aucun droit sur une table. `droits.verifier()` accepte exactement ces droits et signale tout autre droit croisé ; `90-droits.sql` l'appelle avant son `COMMIT`. |
| Les écritures d'un outil chez un autre passent par une API. | Liste des routes au § 5.7. Aucun `INSERT` ni `UPDATE` croisé. |
| Pas de clé étrangère entre schémas. | Une référence croisée est une colonne texte (ou uuid). L'outil la contrôle à la saisie contre la vue. Matrix cherche les orphelins (§ 7.1). |
| Une vue `pub_` est un contrat. | On ajoute des colonnes en fin de liste. Retirer, renommer ou changer le type d'une colonne demande une vue `_v2`. Le commentaire de chaque vue porte « Contrat Dxx v1 » et ses lecteurs. |
| Aucune donnée de santé ni colonne sensible dans une vue `pub_`. | `cursus.employes` : `visite`, `passeport_numero`, `passeport_expire`, `naissance`, `reprise_motif`, `reprise_date` ; `cursus.vaccinations` ; `cursus.visas` ; `cursus.entretiens.cr` ; `vigie.events` : `injury`, `lost_days` et, depuis le 18/10/2026, les 8 autres colonnes de santé d'un accident du travail (`HEALTH_LABELS` de Vigie) ; `vigie.change_log` : `details`, `reason` ; tables fermées en entier : `vigie.benign_accidents`, `access_log`, `attachments` (`docs/architecture-postgres.md`, § 2.3). `90-droits.sql` refuse tout le partage si une vue `pub_` lit l'une d'elles, et `droits.verifier()` signale une vue `pub_` qui lit une colonne de `droits.colonnes_sensibles` (essayé). |

Règles techniques qui en découlent, vérifiées sur PostgreSQL 16.15 :

- Une vue `pub_` ne lit que des tables de son schéma. `90-droits.sql` refuse une vue qui dépend d'un autre schéma. Chaque outil peut donc recréer ses vues dans ses propres tests.
- Une vue s'exécute avec les droits de son propriétaire : `security_invoker` reste faux, le contrôle le refuse. Toutes les vues portent `security_barrier`.
- Une vue appartient au propriétaire de son schéma. Une vue créée par un superutilisateur lirait tout : le contrôle la refuse.
- PostgreSQL refuse de supprimer ou de changer le type d'une colonne lue par une vue. Une migration qui touche une colonne publiée recrée la vue dans la même migration. drizzle-kit ne connaît pas ces vues : elles vont dans des migrations SQL écrites à la main.
- Un lecteur Drizzle déclare la vue lue avec `pgSchema('cursus').view('pub_salaries', {…}).existing()`. Essai fait pour ce plan avec drizzle-kit 0.31.11 et drizzle-orm 0.45.3 : `generate` n'écrit aucune ligne pour la vue, avec ou sans `schemaFilter`, et un second `generate` répond « No schema changes ». Si le fichier de schéma exporte l'objet `pgSchema('cursus')`, drizzle-kit écrit `CREATE SCHEMA "cursus";` en tête de migration, même avec `schemaFilter: ['vigie']`. Règle : on n'exporte jamais l'objet `pgSchema` d'un autre outil, comme pour le sien (`docs/architecture-postgres.md`, § 4.2).

**Cache local ou lecture directe.** Une table locale reste, comme cache rafraîchi par son outil depuis la vue, dans trois cas :

1. des clés étrangères locales la visent (exemple : `codex.projects`, visée par `codex.documents.project_code`) ;
2. une vue `pub_` de l'outil a besoin de la valeur (exemple : `vigie.people.name`, lu par `vigie.pub_non_conformites.owner_name`) ;
3. les règles de l'outil la lisent à chaque action et l'outil doit tourner sans serveur commun (équipes, projets et missions de Cursus, qui garde SQLite en repli) ;
4. la décision demande expressément un cache ou une copie synchronisée (D04, D08, D11) : on suit alors la décision.

Dans les autres cas, l'outil lit la vue au moment du besoin et sa table locale disparaît. Personne ne saisit dans un cache : seule la tâche de rafraîchissement de l'outil l'écrit. L'outil écrit dans son propre schéma ce qu'il a lu : ce n'est pas une écriture croisée.

**Modes de repli.** Sans `DATABASE_URL`, Keystone, Codex et Vigie tournent sur PGlite et Cursus sur SQLite (`docs/architecture-postgres.md`, § 1). Les vues des autres outils n'y existent pas. Les caches gardent alors le contenu de la démonstration. Pour les lectures directes, chaque outil charge des substituts : des vues de mêmes colonnes sur des lignes de démonstration (PGlite), ou des fichiers JSON de même forme (SQLite de Cursus). Matrix publie la forme de chaque vue (§ 7.3), d'où l'on tire les substituts. L'usage réel des applications Mac reste à confirmer (C-04).

### 1.4 Écarts entre le texte des décisions et la mise en œuvre

La convention de partage remplace les copies synchronisées et les API de lecture que citent certaines options. L'outil qui fait foi reste celui de la décision.

| Décision | Texte de l'option | Mise en œuvre | Raison |
|---|---|---|---|
| D01 | Tables « réduites » chez les lecteurs | Les colonnes copiées de Cursus (nom, initiales, unité, site, poste) restent en cache, jamais saisies localement. | Clés locales (`codex.users.department`, `users.site`) et vues `pub_` des lecteurs (`owner_name`, `assignee_name`). |
| D02 | « Miroirs synchronisés » dans Codex, Vigie et Cursus | Codex et Cursus : cache rafraîchi depuis `keystone.pub_projets`. Vigie : lecture directe, `vigie.keystone_projects` supprimée. | Aucune clé étrangère ne vise le miroir de Vigie. |
| D04 | « Copies synchronisées » ; « les tables restent comme cache, mises à jour par Keystone » | `cursus.missions` et `vigie.keystone_assignments` restent comme caches, rafraîchis par Cursus et par Vigie depuis `keystone.pub_affectations`. | La convention interdit à Keystone d'écrire dans leurs schémas : chaque outil met à jour son propre cache. |
| D08 | « training_titles devient un miroir du catalogue Cursus » | `vigie.training_titles` reste comme cache de `cursus.pub_titres` (`label`, `validity_months` rafraîchis), avec `sort` propre à Vigie. | Lecture par vue au lieu de l'API. |
| D11 | « Keystone lit /api/registry » ; « les trois tables Keystone deviennent un cache » | `keystone.document_types`, `document_type_circuit_steps` et `document_approver_assignments` restent comme caches, rafraîchis depuis `codex.pub_types_document`, `pub_circuits_type` et `pub_titulaires_fonction`. `/api/registry` reste pour les lecteurs HTTP. | Lecture par vue au lieu de l'API. Les clés `documents.type_code` et `document_deposits.type_code` visent toujours `document_types(code)` (règle 1 du § 1.3). |
| D13 | « Vigie publie /api/ncrs et /api/hse » | Vues `vigie.pub_non_conformites` et `pub_hse_projet`. L'API de Vigie ne sert qu'aux écritures. | Lecture par vue. |
| D06 (préparation) | Lectures P1, P2 et P3 par API (première version de `docs/remplacement-lucca.md`) | `cursus.pub_salaries`, `keystone.pub_projets`, `keystone.pub_taches_jours`. | Lecture par vue. La convention clôt la question L-07. |
| D19 | « Aucun changement » | `cursus.pub_parametres` publie l'horizon d'alerte de Cursus (90 jours par défaut). Vigie garde sa constante `SKILL_SOON_DAYS = 60` (`src/lib/domain.ts:88`) tant que le QHSE n'a pas validé le passage à l'horizon de Cursus (C-12). | Avec D09, un même titre serait « à renouveler » dans Cursus et « valide » dans Vigie entre J-90 et J-60. Publier la vue ne change rien tant que Vigie ne la lit pas. |

Choix de ce plan qui s'écartent des analyses :

- `cursus.equipes` reste comme cache de l'organigramme, avec le code Matrix pour clé (l'analyse D15 la supprimait) : sans elle, Cursus ne tourne plus en repli SQLite (règle 3), et `budgets.equipe`, `plan_actions.equipe` perdent leur clé locale (règle 1). `cursus.projets` reste comme cache de `keystone.pub_projets` (l'analyse D02 la supprimait) : la feuille de temps la lit à chaque saisie et Cursus doit tourner en repli SQLite (règle 3) ; `missions.projet`, gardée par D04, la vise aussi (règle 1). `cursus.destinations.pays` reste en cache de `matrix.pub_pays` (l'analyse D17 la supprimait), pour la même règle 3.
- `cursus.missions`, `vigie.keystone_assignments` (D04), `vigie.training_titles` (D08) et les trois tables du registre de Keystone (D11) restent comme caches, comme le demandent les décisions (règle 4). Les analyses les supprimaient ou les réduisaient.
- Les vues locales `codex.v_users`, `vigie.v_people` et `vigie.v_sites` de l'analyse D01 ne sont pas retenues. Les colonnes qu'elles calculaient restent en cache, d'après la règle du § 1.3. Ainsi `vigie.people.name` reste lisible par `vigie.pub_non_conformites` sans dépendance vers le schéma `cursus`.

### 1.5 Prérequis et alignements

**Prérequis.**

| Prérequis | Où | Ce qu'il bloque |
|---|---|---|
| M-05 : autorisation de modifier le code des quatre outils | `docs/decisions.md` | Tout. |
| Socle du serveur commun, puis bascule de Codex, Vigie, Keystone et Cursus (étapes 0 à 4) | `docs/architecture-postgres.md`, § 10 | Les vues d'un outil attendent sa bascule. Tout ce qui lit Cursus attend l'étape 4. |
| Couche d'accès asynchrone de Cursus | `docs/architecture-postgres.md`, § 8 (sous-étape 8.a) | Toute lecture d'une vue ou d'une API depuis une action de Cursus. Les actions sont synchrones aujourd'hui (`server/src/index.ts:106-114`). |
| D20 technique : `pgSchema` non exporté, migration de base régénérée, migrateur dans le schéma de l'outil | `docs/architecture-postgres.md`, § 4.2 et 4.3 | Le premier déploiement d'une vue. |
| D06 et D07 | `docs/remplacement-lucca.md` | Heures et absences. |

**Alignements avec le socle du serveur.**

Faits le 15/10/2026 :

- `droits.verifier()` (`infra/postgres/init/03-droits.sql`) accepte la convention de partage : un `USAGE` croisé est permis quand le rôle d'outil a, dans ce schéma, `SELECT` sur au moins une vue `pub_`, et seulement cela. Tout autre droit croisé (table, colonne, séquence, fonction, vue non publiée, écriture, `CREATE`) est une erreur, comme une vue `pub_` qui lit une colonne de `droits.colonnes_sensibles` ou un autre schéma. `90-droits.sql` appelle `droits.verifier()` à la fin de sa transaction ; `infra/postgres/verifier-droits.sql` éprouve la convention (cas 100 à 136, dont la perte d'un droit de lecteur après une restauration). Essai sur un serveur neuf : partage joué deux fois, aucune erreur, 96 cas conformes (`infra/postgres/partage/README.md`, « Essais »).
- `docs/architecture-postgres.md` (§ 1, § 2.2, § 3.2, § 9) décrit la convention de partage à la place de la règle « un outil ne lit pas le schéma d'un autre ».
- `docs/remplacement-lucca.md` : la question L-07 est close par la convention.

Alignements faits à la relecture du 15/10/2026 :

- `docs/remplacement-lucca.md` : P1 (annuaire), P2 (projets) et P3 (tâches) sont des lectures de vues ; le lot K4 de Keystone (1 j) disparaît et C5 est compté dans D05 (total de construction : 17,5 j) ; `employes.site_code` remplace `employes.site` ; `cursus.projets` est un cache de `keystone.pub_projets`, avec ses colonnes (`code_analytique`, `nature`, `imputable`) ; `projects.kind` remplace l'indicateur « interne » ; `employes.email` et le rapprochement par e-mail sont retirés au profit de `matrix.pub_correspondances` (§ 4.5).
- Nom du champ de tâche : `LigneTemps.tacheKeystone` dans Cursus ; dans les contrats JSON, le champ du message s'appelle `tache` (type `numeroTache`) ; `30-keystone.sql` écrit désormais `tacheKeystone` (l'analyse D05 disait `tacheRef`).
- Fichiers de partage : `20-cursus.sql`, `40-codex.sql`, `50-vigie.sql`, `10-matrix-referentiels.sql` et `partage/README.md` décrivent les caches de ce plan (plus de suppression de `cursus.projets`, `equipes`, `destinations.pays`, `codex.users.department`, `users.site`, ni de vues locales `v_*`).

Reste à faire :

1. `cursus.employes.reprise_date` : la convention de partage l'exclut des vues `pub_` (liste locale de `90-droits.sql`), mais elle n'est pas dans `droits.colonnes_sensibles` : `matrix_lecture` la lit. Son classement relève de la question P-04 de `docs/architecture-postgres.md`.
2. H3 (heures par site et par mois, lues par Vigie) est une lecture et pourrait devenir une vue `cursus.pub_heures_site_mois`. `docs/remplacement-lucca.md` garde l'API parce que `complet` se calcule en TypeScript. Ce choix revient à ce chantier-là.

## 2. Tableau de synthèse

| Objet | Fait foi | Table(s) source | Publié par | Lecteurs | Copie locale des autres outils | Décision |
|---|---|---|---|---|---|---|
| D01 Personnes | Cursus | `cursus.employes` | `cursus.pub_salaries` | Keystone, Codex, Vigie, Matrix | `keystone.persons` : cache + `matricule`, externes gardés ; `codex.users` : cache + `matricule`, `title` supprimée ; `vigie.people` : cache + `matricule` | A |
| D02 Projets | Keystone | `keystone.projects` (+ `kind`) | `keystone.pub_projets` | Codex, Cursus, Vigie, Matrix | `codex.projects` : cache ; `cursus.projets` : cache ; `vigie.keystone_projects` : supprimée (code projet dans 4 tables) | B |
| D03 Chantiers | Keystone pour la fiche, Cursus pour les exigences | `keystone.site_sheets`, `site_rotations` | `keystone.pub_chantiers` (+ `pub_affectations`) | Cursus, Matrix | `cursus.chantiers` réduite à `projet_code`, `habs`, `certs` | B |
| D04 Affectations | Keystone | `keystone.site_rotations`, `activity_assignments` | `keystone.pub_affectations` | Cursus, Vigie, Matrix | `cursus.missions`, `vigie.keystone_assignments` : caches (+ `affectation_id`) | B |
| D05 Tâches | Keystone | `keystone.tasks` | `keystone.pub_taches_jours` | Cursus, Matrix | `cursus.taches` : supprimée | A |
| D06 Temps passés | Cursus (provisoire) | `cursus.feuilles` | API H1 vers Keystone ; vues `*_v1` pour Matrix | Keystone, Vigie, Matrix | voir `docs/remplacement-lucca.md` | A, provisoire |
| D07 Absences | Cursus | `cursus.absences` | API H2 vers Keystone | Keystone, Matrix | `keystone.leave_entries` : copie en lecture | A |
| D08 Catalogue des titres | Cursus | `cursus.formations`, `habilitations` | `cursus.pub_titres` | Vigie, Keystone, Matrix | `vigie.training_titles` : cache (`label`, `validity_months`), `sort` local | A |
| D09 Titres détenus | Cursus | `cursus.certifications` (+ `organisme`), `hab_titres` | `cursus.pub_titres_detenus` | Vigie, Keystone, Matrix | `vigie.qualifications`, `keystone.certifications` : supprimées | A |
| D10 Documents | Codex | `codex.documents` (+ 3 colonnes), `revisions`, `working_versions`, `workflows`, `workflow_steps` | `codex.pub_documents`, `pub_revisions_document`, `pub_validations` | Keystone, Vigie, Matrix | `keystone.documents` réduite à un index (`codex_id`), 3 tables supprimées ; `vigie.documents`, `document_versions` : migrées dans Codex puis supprimées | A |
| D11 Registre des types | Codex | `codex.doc_types`, `families`, `functions`, `function_holders` | `codex.pub_types_document`, `pub_circuits_type`, `pub_titulaires_fonction` | Keystone, Vigie, Matrix | `keystone.document_types`, `document_type_circuit_steps`, `document_approver_assignments` : caches | A |
| D12 ECR et ECO | Vigie | 9 tables à créer : `vigie.ecos`, `ecrs`, `eco_*`, `external_progress` | `vigie.pub_ordres_modification`, `pub_eco_approbations`, `pub_eco_effectivite`, `pub_demandes_modification` | Keystone, Codex, Matrix | `keystone.vigie_eco*` (5 tables) : cache ; `codex.change_requests` : cache | A |
| D13 NC et HSE de projet | Vigie | `vigie.events` (NC, + 10 colonnes, migration `0008_partage_prerequis`), `prevention_plans`, `permits` ; `inductions` non créée (C-13) | `vigie.pub_non_conformites`, `pub_hse_projet` | Keystone, Matrix | `keystone.vigie_ncrs`, `vigie_hse_items` : cache | A |
| D14 Sites | Matrix | `matrix.sites` | `matrix.pub_sites` | les 4 outils | `codex.sites` : cache ; `vigie.sites` : cache + attributs Seveso ; `cursus.employes.site_code` | A |
| D15 Organisation | Matrix | `matrix.organigramme` | `matrix.pub_organigramme` | les 4 outils | `codex.departments` : cache (+ `active`) ; `keystone.departments` : cache (+ `org_code`) ; `cursus.equipes` : cache, clé = code Matrix | A |
| D16 Clients et fournisseurs | Keystone | `keystone.clients`, `suppliers` | `keystone.pub_clients`, `pub_fournisseurs` (+ colonnes de `pub_projets`) | Vigie, Codex, Cursus, Matrix | `vigie.contractors` gardée + `supplier_id` ; clients en texte remplacés par le projet | A |
| D17 Pays | Matrix | `matrix.pays` | `matrix.pub_pays` | les 4 outils | `keystone.countries` gardée + `iso2` ; `cursus.destinations` gardée, `pays` en cache | A |
| D18 Journaux d'audit | chaque outil | `keystone.audit_entries`, `activity_events` ; `codex.audit_log` ; `cursus.journal` ; `vigie.change_log` (journal des modifications de Vigie, sans motif ni détail) | 4 vues `pub_journal`, réunies par `matrix.journal_unifie` | Matrix | toutes gardées | A |
| D19 Paramètres et fichiers | chaque outil | `cursus.settings` (horizon d'alerte) | `cursus.pub_parametres` | Vigie (après C-12), Matrix | aucune ; Vigie garde sa constante tant que le QHSE n'a pas validé (C-12) | A |
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
- Cursus : `missions.projet` (`infra/postgres/cursus/schema.sql:423`) vise toujours `projets` (missions reste un cache, D04) ; `taches.projet` (`:430`) disparaît avec `taches` (D05). `feuilles.lignes[].projet` est du JSON, contrôlé par Matrix (§ 7.1).
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

**Charge.** Keystone 3 j, Codex 2 j, Vigie 3,5 j, Cursus 1,5 j. Les correspondances sont comptées au § 5.5.

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

**Ce qui change.** Keystone fait foi pour les rotations de chantier et les affectations du planning. Cursus et Vigie ne saisissent plus rien. Comme le veut l'option B, `cursus.missions` et `vigie.keystone_assignments` restent comme caches : chaque outil les rafraîchit depuis la vue de Keystone, qui n'écrit jamais chez eux (§ 1.4).

**Source.** `keystone.site_rotations` et `activity_assignments` (`schema/planning.ts:124-145`, dates de l'activité). `allocations` est exclue : ses 64 lignes de démo n'ont pas de projet (totaux par semaine, `seed/resources.ts:29-34`). La fiche D04 de `doublons.json` (« par semaine et projet ») se trompe sur ce point. Aucune colonne ajoutée.

**Vue.** `keystone.pub_affectations` : `source` (rotation ou planning), `affectation_id`, `matricule`, `personne_nom`, `projet_code`, `projet_nom`, `client`, `activite_code`, `activite`, `du`, `au`, `lieu`, `pays`, `pays_iso2`, `heures_prevues`. Seules les personnes qui ont un matricule y figurent. L'uuid `personne_id` n'est pas publié. Lecteurs : cursus_app, vigie_app, matrix_app.

**Lecteurs.**

| Outil | Lit | Table locale |
|---|---|---|
| Cursus | lignes `source = 'rotation'` ; `pays_iso2 <> 'FR'` donne « Déplacement international », sinon « Mission » | `missions` gardée en cache, avec une colonne `affectation_id` (texte, unique) pour clé du rafraîchissement ; `emp_id` retrouvé par `employes.matricule`. Rafraîchie au démarrage, chaque nuit et à la demande, en une transaction (ajouts, mises à jour, retraits des affectations disparues de la vue). `checkAbsence` (`shared/rules/conges.ts:128`) lit toujours `d.ds.missions` de façon synchrone, et le repli SQLite garde la démonstration (règle 3). |
| Vigie | les deux sources, jointes par `people.matricule` ; libellé « code · client » recomposé | `keystone_assignments` gardée en cache, avec `affectation_id` et `source` ; `person_id` retrouvé par `people.matricule`. Rafraîchie chaque nuit ; les alertes d'habilitation calculées en masse la lisent comme aujourd'hui. |

**Clés étrangères locales.** Toutes restent : `cursus.missions.emp_id → employes`, `missions.projet → projets` (cache, D02), `vigie.keystone_assignments.person_id → people`. Une affectation dont la personne n'a pas de fiche locale n'est pas copiée ; Matrix la signale (§ 7.2).

**Rapprochement.** Aucun : 0 personne commune entre Keystone et Cursus (seul le nom Roux coïncide, pour deux personnes). Les 14 missions de Cursus et l'affectation de Vigie sont des copies de démonstration : le premier rafraîchissement sur le serveur les remplace.

**Code.**

- Keystone : la vue dans une migration SQL, un test.
- Cursus : `server/src/db.ts:35` (`affectation_id`), nouvelle tâche de rafraîchissement `server/src/integrations/keystone-affectations.ts`, `seed.ts:176-184, 316` (démonstration gardée pour le repli). Plus aucune écriture par les actions ; `Missions.tsx` passe en lecture seule. `shared/rules/conges.ts:129-140`, `client/src/pages/Absences.tsx:126`, `Temps.tsx:238-280` ne changent pas.
- Vigie : `schema.ts:216-224` (`affectation_id`, `source`), rafraîchissement dans `src/server/integrations/keystone.ts` (nouveau), `seed.ts:287`. `lib/data/skills.ts`, `SkillAlerts.tsx`, `audits.ts`, `todo.ts` ne changent pas.

**API.** Aucune.

**Charge.** Keystone 0,5 j (vue déjà écrite), Cursus 1,5 j, Vigie 1 j.

**Risques.** Un déplacement court sans fiche chantier n'a pas de place dans Keystone (K-2633 à Grenoble, C-10). Les imports de planning produisent beaucoup de lignes : les rafraîchissements filtrent sur `au >= current_date - 1 an`. Une personne peut avoir une rotation et une ligne de planning sur le même projet. Un cache rafraîchi chaque nuit peut avoir un jour de retard sur Keystone : le bouton « Actualiser » le rattrape.

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

Le plan complet est dans `docs/remplacement-lucca.md` : flux H1 (heures validées) et H2 (absences validées) poussés par Cursus vers `POST /api/integrations/cursus/events` de Keystone, flux H3 lu par Vigie, file d'envoi `cursus.evenements_sortants`, en-têtes `keystone.hr_timesheets` et `hr_leave_headers`, vues de contrôle `cursus.heures_validees_v1`, `absences_validees_v1`, `annulations_v1` et `heures_site_mois_v1` lues par Matrix, marche en parallèle et critères de bascule. Rien n'est retiré de Lucca tant que M-03 n'est pas confirmée.

Ce plan fournit à D06 et D07 leurs prérequis : D01 (matricule), D02 (projets internes et codes analytiques), D05 (tâche sur chaque ligne), D14 (site du salarié). Il remplace les lectures P1, P2 et P3 par des vues (§ 1.5). Charge propre de D06 et D07 : 17,5 j (`docs/remplacement-lucca.md`, § 5.5 : Cursus 6, Keystone 8, Vigie 2,5, Matrix 1), hors de ce qui est compté dans D01, D02, D05 et D14. Elle était de 19,5 j avant ce plan : K4 (1 j) est remplacé par les vues, C5 (1 j) est compté dans D05, et les colonnes de D01, D02 et D14 sortent de C1 et de C6.

### D08 · Catalogue des formations et habilitations (option A)

**Ce qui change.** Cursus devient le seul endroit où l'on crée ou modifie un titre (code, libellé, validité). Les titres propres au QHSE sont ajoutés dans Cursus : `formation.accueil` (« Accueil sécurité », sans échéance), `formation.caces484` et `habilitation.ac484`. Vigie garde la liste des titres qu'il suit dans sa matrice, avec leur ordre.

**Source.** `cursus.formations` (11 lignes de démonstration) et `cursus.habilitations` (6). Les codes `atex`, `hauteur` et `aipr` existent dans les deux tables : l'identifiant publié porte la nature (`formation.atex`, `habilitation.atex`). Le séparateur est le point, car Vigie découpe sur « : » (`src/server/plan.ts:64`). Règle nouvelle : `validite` nulle veut dire « sans échéance » (Vigie traite aujourd'hui 0 de cette façon, `TitlesManager.tsx:16`) ; dans Cursus, 0 donne aujourd'hui un titre expiré le jour même (`shared/domain.ts:186-194`).

**Vue.** `cursus.pub_titres` : `titre_id`, `nature`, `code`, `libelle`, `libelle_court`, `validite_mois`. 17 lignes sur la démonstration, 20 après l'ajout des trois titres. Lecteurs : vigie_app, keystone_app, matrix_app.

**Lecteurs.**

| Outil | Lit | Table locale |
|---|---|---|
| Vigie | `pub_titres` | `training_titles` gardée en cache (décision : « miroir du catalogue ») : `id` prend la valeur de `titre_id` ; `label` et `validity_months` sont rafraîchis depuis `libelle_court` et `validite_mois` (nul devient 0) ; `sort` reste local. Une ligne veut dire « titre suivi par Vigie ». `saveTitle` (`server/skills.ts:147-170`) devient « suivre ou ne plus suivre un titre du catalogue ». |
| Keystone | `pub_titres.libelle`, par la jointure de D09 | aucune |

**Clés étrangères locales.** `vigie.qualification_requirements.title_id → training_titles.id` est gardée ; ses 41 lignes de démonstration sont recodées (tableau ci-dessous). `qualifications.title_id` disparaît avec `qualifications` (D09). Dans Cursus, les codes ne changent pas.

**Rapprochement** (titres de Vigie vers Cursus, à valider par les RH et le QHSE, C-01).

| Vigie | Cursus | Remarque |
|---|---|---|
| `accueil` | `formation.accueil` (nouveau) | 9 détenteurs dans la démo de Vigie |
| `elec` | `habilitation.he` | `formation.elec` est la préparation |
| `r484` | `formation.caces484` (nouveau) | |
| `r489` | `formation.caces489` | |
| `sst` | `formation.sst` | |
| `hauteur` | `habilitation.hauteur`, ou `formation.hauteur` | |
| `atex` | `habilitation.atex`, ou `formation.atex` | |
| `conduite` | `habilitation.ac489` et `habilitation.ac484` | éclatement à la main par détenteur |

On retient l'habilitation de préférence : c'est elle qui autorise à intervenir, et c'est elle que contrôle le Go / No Go de Cursus. Le rapprochement sur le code est écarté : il relie `elec` à la formation. Le tableau va dans `matrix.correspondances` (objet `titre`).

**Code.**

- Cursus : « sans échéance » dans `shared/types.ts:27-28`, `shared/domain.ts` (`certInfo` 186-194, `habInfo` 205-229, `echeances` 361-379, `resourceStatus` 383-410), `shared/format.ts:13`, les dialogues et pages des titres ; les trois titres dans `seed.ts:11-32` et dans une migration ; nouvel écran de catalogue pour les RH (`server/src/actions/catalogue.ts`, aujourd'hui aucune action n'écrit le catalogue) ; tests `tests/domain.test.ts`.
- Vigie : `schema.ts:195-200`, recodage dans une migration, rafraîchissement du cache, `lib/data/skills.ts:13, 71`, `server/skills.ts:147-170`, `TitlesManager.tsx`, `seed.ts:159-162, 270`.

**API.** Aucune : le catalogue se lit par la vue.

**Charge.** Cursus 3 j, Vigie 1,5 j, Matrix 0,5 j (correspondances des titres, flux).

**Risques.** Le sens des codes (`elec`, `atex`, `hauteur`, `conduite`) revient au métier : si la formation est retenue, le Go / No Go de Cursus et les alertes de Vigie ne contrôlent plus le même objet. Le QHSE dépendra des RH pour tout nouveau titre. Coûts, durées et signataire des nouveaux titres sont inconnus.

### D09 · Titres détenus (option A)

**Ce qui change.** Les titres détenus ne se saisissent plus que dans Cursus. Vigie et Keystone lisent la vue. Vigie garde ses exigences par personne et son calcul d'alertes ; une formation saisie depuis Vigie passe par une API de Cursus.

**Source.** `cursus.certifications` (historique, plusieurs lignes par salarié et formation : 66 en démonstration) et `cursus.hab_titres` (une ligne par salarié et habilitation, `delivree` nulle tant qu'elle n'est pas délivrée : 21 lignes dont 1 en attente). Colonne ajoutée par `20-cursus.sql` : `certifications.organisme`, facultative (Vigie saisit un organisme par titre, `TrainingForm.tsx:56-60`). L'expiration se calcule, comme dans Cursus : date d'obtention ou de délivrance plus la validité.

**Vue.** `cursus.pub_titres_detenus` : `cursus_ref`, `matricule`, `titre_id`, `nature`, `code`, `obtenu_le`, `expire_le`, `utilisable_jusqu_au`, `prerequis_manquant`, `organisme`, `delivre_par`, `session_prevue_le`. Dernière formation par salarié et formation ; habilitations délivrées seulement. 86 lignes sans orphelin sur la démonstration. L'aptitude médicale n'est pas publiée : elle se calcule depuis `employes.visite`, donnée de santé. Lecteurs : vigie_app, keystone_app, matrix_app.

**Lecteurs.**

| Outil | Lit | Table locale |
|---|---|---|
| Vigie | `pub_titres_detenus` jointe par `people.matricule` et `training_titles.id` | `qualifications` supprimée. `loadSkillMatrix` garde sa forme de sortie : `rules.ts`, `SkillMatrix`, `SkillAlerts`, `audits.ts`, `todo.ts`, `counters.ts` ne changent pas. `prerequis_manquant` donne l'état « suspendu ». |
| Keystone | `pub_titres_detenus` et `pub_titres.libelle`, jointes par `persons.matricule` | `certifications` supprimée (`schema/resources.ts:88-95`, écrite seulement par la démonstration ; `expires_on` n'est lu nulle part). `getSkillsMatrix` (`dal/hr.ts:117-139`) garde sa forme. |

**Clés étrangères locales.** Disparaissent avec les tables : `vigie.qualifications.person_id → people`, `title_id → training_titles`, `keystone.certifications.person_id → persons`. Gardées : `vigie.qualification_requirements` (`title_id`, `person_id`, `renewal_action_id`). `vigie.certifications` (certifications ISO du groupe) est un homonyme sans rapport (D20).

**Rapprochement.** Aucun automatique : 0 identifiant de Vigie sur 12 ne correspond à un salarié de Cursus, et 8 partagent un nom de famille avec un autre prénom (8 faux positifs si l'on rapprochait sur le nom). Les 5 personnes de Keystone qui ont des certifications n'existent pas dans Cursus. Sur les 8 lignes de texte libre de Keystone, une seule se rapproche (« SST ») ; « Eurocode 3 » est une compétence (`person_skills`) ; les autres titres sont à créer dans Cursus ou à arbitrer. Reprise des 39 lignes de Vigie : abandon en démonstration ; en production, arbitrage des RH sur justificatif.

**Code.**

- Cursus : `db.ts:25` (`organisme`), `CertDialog.tsx`, route `POST /api/integrations/vigie/certifications` (§ 5.7) avec sa clé `VIGIE_API_KEY`, tests de la route.
- Vigie : suppression de `qualifications` (après export), déclaration `.existing()` des vues, `lib/data/skills.ts:66-117`, `server/skills.ts:38-82` (appel de l'API, erreur si Cursus est injoignable), `TrainingForm.tsx` (formations seulement, échéance en lecture seule), `SkillMatrix.tsx:169`, `seed.ts:270-287`.
- Keystone : `dal/hr.ts:117-139`, suppression de la table par migration, `seed/resources.ts:47-58`, libellé « Tracked with expiry in Lucca » (`skills-view.tsx:36`, `fr-dict.json:1914`), tests `delivery2.test.ts:254-258`, `db-check.ts:82, 309-310`, `hr.render.test.ts:99-101`, `domain/hr.test.ts:94-95`, `home.test.ts:97, 121`.

**API.** `POST /api/integrations/vigie/certifications` dans Cursus : corps `{ matricule, titre_id, obtenue, organisme? }`, même effet que `cert.ajouter`, réponse `201 { cursus_ref, expire_le }`, refus d'une habilitation (422). Une habilitation se délivre dans Cursus (signataire, prérequis).

**Charge.** Cursus 2 j, Vigie 3 j, Keystone 2 j, Matrix 0,5 j. Reprise métier : 1 à 2 j (RH et QHSE).

**Risques.** Sans l'aptitude médicale, Vigie affiche « valide » une habilitation que Cursus voit suspendue et donc en No Go (avis du DPO, C-02). Les calculs de dates diffèrent au 29 février (PostgreSQL ramène au dernier jour du mois, JavaScript déborde). La vue calcule à la date du serveur, sans `CURSUS_TODAY`. Si Cursus est injoignable, Vigie ne peut plus enregistrer de formation. Les personnes externes de Keystone n'ont pas de titres dans Cursus.

### D10 · Documents (option A)

**Ce qui change.** Codex fait foi pour tous les documents. Les 15 documents maîtrisés de Vigie (36 versions) entrent dans Codex : 3 par rapprochement, 12 par import. Keystone garde un index réduit dont `codex_id` est obligatoire, et supprime ses révisions et ses signatures. Les circuits de validation sont ceux de Codex.

**Source.** `codex.documents`, `revisions`, `working_versions`, `workflows`, `workflow_steps` (`codex/src/db/schema.ts:120-281`). Colonnes ajoutées par `40-codex.sql` : `distribution` (liste de diffusion de Vigie, `DocumentPanel.tsx:151`), `review_months` (périodicité de revue, `documents.ts:118` ; `putInForce` recalcule `review_due_at`), `process_code` (processus ISO 9001, filtre « Processus »).

**Vues.** `codex.pub_documents` (sans les « très confidentiel » ; les lecteurs appliquent `conf` eux-mêmes), `pub_revisions_document` (révisions et dernière version de travail), `pub_validations` (circuits, une ligne par étape). Lecteurs : keystone_app, vigie_app, matrix_app.

**Lecteurs.**

| Outil | Lit | Table locale |
|---|---|---|
| Keystone | les trois vues : numéro, révision, statut, circuit, historique | `documents` réduite à un index (`id` gardé pour ses 9 clés entrantes, `codex_id` texte unique et obligatoire après la reprise, `project_id`, `service`, `recipients`, `is_new`, `sort_order`). `document_revisions`, `document_approvals` et `document_index_syncs` supprimées. `document_acknowledgements`, `document_downloads`, `document_links`, `document_deposits` gardées. |
| Vigie | `pub_documents` filtrée sur le périmètre QHSE (`attachment = 'none'`, départements QUA et HSE, à valider : C-06), `pub_revisions_document`, `pub_validations` | `documents` et `document_versions` migrées dans Codex puis supprimées. Nouvelle table `document_actions (codex_id, revision, action_id)` créée par `50-vigie.sql`, pour le lien entre une révision et le plan d'actions. L'écran `/documents` devient un registre en lecture ; créer, réviser, soumettre et approuver deviennent des liens vers Codex ; « Rendre obsolète » devient une demande de retrait (D12). |

**Clés étrangères locales.** Keystone : les 9 clés vers `keystone.documents.id` restent (index gardé) ; celles de `document_revisions` et `document_approvals` disparaissent avec leurs tables ; `documents.type_code` et `document_deposits.type_code` visent toujours le cache `document_types` (D11). Les références en texte (`eng_inputs.document_number`, `pid_sheets.document_number`, `meetings.minutes_number`…) se résolvent par les alias de Codex. Vigie : les clés de `documents` et `document_versions` disparaissent ; `document_actions.action_id → actions` est nouvelle.

**Rapprochement.** Keystone vers Codex : 39 documents sur 42 trouvent leur pendant par (type, projet, rang), contrôlé à la main sur les titres ; les 3 manquants (REC-HLT-008, REC-HLT-009, CER-HLT-040) sont importés avec `legacyRef`. Les numéros Keystone deviennent des alias Codex, par un script ponctuel exécuté par `codex_app` d'après `matrix.correspondances` (objet `document`, méthode `rang`). Vigie vers Codex : 3 rapprochements par titre et type, à confirmer par le QHSE (POL-QHSE-001, PR-QHSE-001, PR-QHSE-002), et 12 imports, dont les instructions de travail en PRO avec le sous-type « Instruction de travail ». Personnes : par D01.

**Code.**

- Codex : colonnes, formulaires et `lifecycle.ts:45-55` ; extension de `POST /api/import` (historique, version en cours, état, nouvelles colonnes) ; routes d'écriture pour Keystone (§ 5.7) ; script des alias ; `docs/api.md`.
- Keystone : `dal/documents.ts` sur les vues ; dépôts et comptes rendus par l'API de Codex ; approbations par lien vers Codex ; `syncCodexIndex` supprimé ; préfixe `LST-INS-` remplacé par le sous-type ; environ 25 fichiers de test et un substitut du schéma `codex` pour PGlite.
- Vigie : script de migration (export, imports, rapprochements, `actions.origin_ref`, `document_actions`) ; `lib/data/documents.ts` sur les vues ; écran en lecture ; suppression de `DocumentForms.tsx` et `server/documents.ts`.

**API.** Codex : `POST /api/integrations/keystone/documents` (dépôt, avec fichier), `POST …/documents/{id}/versions` (409 si une demande de modification est nécessaire), en option `POST …/{id}/validation`, avec un jeton `KEYSTONE_TOKEN` et l'utilisateur qui agit. Extension de `POST /api/import` pour la migration de Vigie.

**Charge.** Codex 7,5 j (vues déjà écrites), Keystone 11 j, Vigie 7,5 j, Matrix 0,5 j.

**Risques.** Les vues contournent les règles de visibilité par utilisateur de Codex (brouillons, « confidentiel » limité au département ou au projet) : les lecteurs appliquent `conf`, ou des vues plus restrictives seront nécessaires. Sans l'extension de l'import, l'historique de Vigie est perdu. Le statut « Frozen » de Keystone n'a pas d'équivalent (C-05). Les circuits de Codex sont plus longs que ceux de Vigie. Le registre de Codex refuse certains dépôts de Keystone (CER et COC exigent l'origine externe ; RPT, PV et PHO un projet).

### D11 · Registre des types de document (option A)

**Ce qui change.** Codex fait foi pour le registre des types et leurs circuits. Comme le demande l'option A, les trois tables de Keystone deviennent un cache du registre de Codex, rafraîchi par Keystone depuis les vues (§ 1.4). `/api/registry` reste pour les lecteurs HTTP.

**Source.** `codex.doc_types` (69 types), `families` (23), `functions`, `function_holders`. Aucune colonne ajoutée hors `users.matricule` (D01).

**Vues.** `codex.pub_types_document` (lecteurs : keystone_app, vigie_app, matrix_app), `pub_circuits_type` et `pub_titulaires_fonction` (keystone_app, matrix_app).

**Lecteur : Keystone.**

| Table locale | Devenir |
|---|---|
| `document_types` | Cache de `pub_types_document`, clé `code` inchangée : les 69 types de Codex y entrent (les 28 de Keystone en font partie). Libellés, famille, conservation, livrable client et clause ISO viennent de la vue ; un type désactivé dans Codex est marqué inactif, jamais supprimé. |
| `document_type_circuit_steps` | Cache de `pub_circuits_type` : une ligne par étape ; le rôle Keystone est remplacé par la clé de fonction de Codex (`engineering_lead` → `referent_ingenierie`, `project_manager` → `chef_projet`, `quality_manager` → `resp_qualite`, `direction` → `direction`, `client` → `validation_client`, `hse_officer` → `resp_hse`). |
| `document_approver_assignments` | Cache de `pub_titulaires_fonction`, titulaire relié par `user_matricule` → `persons.matricule` (D01). |

Le rafraîchissement tourne au démarrage, chaque nuit et à la demande (écran `/admin/document-types`, qui passe en lecture seule). Personne ne saisit dans ces tables.

**Clés étrangères locales.** `documents.type_code → document_types(code)`, `document_deposits.type_code → document_types(code)` et `document_type_circuit_steps.type_code → document_types(code)` restent valides : le cache contient tous les codes de Codex. `handover_items.document_type_code` est un texte sans clé, contrôlé contre la vue.

**Rapprochement.** Automatique : les 28 codes de Keystone figurent tous parmi les 69 de Codex ; circuit, clause ISO et indicateur « livrable client » concordent après correspondance des rôles. Diffèrent : 5 libellés anglais, la répartition des 7 familles Keystone sur 23 familles Codex, la règle de conservation de 4 types (RPT, CER, COC, PO) et 3 titulaires (`hse_officer`, `client`, `direction`).

**Code.** Keystone : tâche de rafraîchissement (`src/server/integrations/codex/registry-sync.ts`, nouveau), `listDocumentTypes` et `getApproverDirectory` (`dal/documents.ts:55-82`) inchangés dans leur forme, `ApproverRole` remplacé par les clés de fonction (`codes.ts:471-487`), libellés de conservation construits depuis les codes, `/admin/document-types` en lecture, `seed/documents.ts:34-47` gardé pour le repli, tests `delivery3.test.ts:123-126` et `features/docs/render.test.ts:216-285`.

**API.** Aucune nouvelle.

**Charge.** Keystone 3 j, Matrix 0,25 j (flux F04). Vues de Codex déjà écrites.

**Risques.** Les approbateurs effectifs changent pour trois rôles. Keystone affiche une clause ISO en anglais que Codex n'a qu'en français. D11 précède D10 côté Keystone.

### D12 · Demandes et ordres de modification (option A)

**Ce qui change.** Vigie numérote, instruit, approuve et libère toutes les demandes (ECR) et tous les ordres (ECO) de modification, qu'ils viennent de Codex, de Keystone ou de Vigie. Codex et Keystone gardent des miroirs, rafraîchis depuis les vues de Vigie, et envoient leurs actions par API.

**Source.** 9 tables à créer dans `vigie`, écrites par `60-vigie-ecr-eco.sql` : `ecos`, `ecrs`, `eco_approvals`, `eco_parts`, `eco_projects`, `eco_effectivity`, `eco_documents`, `eco_actions`, `external_progress` (journal des avancements reçus, idempotent par `external_id`). Elles entrent dans la migration `partage` de Vigie (`docs/architecture-postgres.md`, § 4.9). `pending_dispositions` et `locked` sont calculés dans la vue, pas stockés.

**Vues.** `vigie.pub_ordres_modification` (avec articles, projets et documents en tableaux), `pub_eco_approbations`, `pub_eco_effectivite` (lecteurs : keystone_app, matrix_app) ; `pub_demandes_modification` (codex_app, keystone_app, matrix_app). Vigie lit aussi `keystone.pub_articles`, `pub_nomenclatures`, `pub_parc_machines`, `pub_projets` pour l'effectivité par défaut.

**Lecteurs.**

| Outil | Lit | Table locale |
|---|---|---|
| Keystone | les trois vues des ECO | miroir à 5 tables (`vigie_ecos`, `vigie_eco_approvals`, `vigie_eco_parts`, `vigie_eco_projects`, `vigie_eco_effectivity`) gardé, rafraîchi par `SELECT` sur les vues au lieu de `GET` HTTP (`eco-connector.ts:73-81`) ; `vigie_ecos.released_at` ajoutée ; outbox `vigie_eco_progress` gardée, avec un état `refused`. |
| Codex | `pub_demandes_modification` pour une demande inconnue reçue par le webhook (`route.ts:48-49`) et pour un contrôle | `change_requests` gardée en miroir : l'état « implemented », écrit par Codex quand il applique la décision, ne peut pas être écrit dans Vigie. |

**Clés étrangères locales.** Keystone : les clés du miroir vers `vigie_ecos.id` restent ; `requested_by_person_id` et `actor_person_id` se rattachent par le matricule (D01). Les références texte `warranty_claims.eco_number`, `revision_diffs.eco_number`, `drawings.eco_number`, `drawing_revisions.eco_number` désignent `pub_ordres_modification.number`. Codex : `change_requests.doc_id`, `requester_id`, `modifier_id` inchangées ; une demande née hors de Codex porte les comptes système `vigie` ou `keystone`.

**Rapprochement.** Les 6 ECO de Keystone (avec 18 approbations, 12 articles, 7 projets, 24 effectivités) sont repris avec leur numéro ; les 3 ECR de Codex aussi. ECO-2026-002, cité par Codex, n'existe nulle part : un ECO minimal est créé, à compléter à la main. Les huit documents cités par les ECO n'ont pas d'identifiant Codex : saisie à la main. Les demandeurs et approbateurs n'ont aucun matricule dans Cursus. Prochains numéros : ECO-2026-018, ECR-2026-004. La reprise passe avant tout rafraîchissement de Keystone, sinon le miroir est vidé.

**Code.**

- Vigie : schéma et migration, reprise et numérotation, écran « Modifications techniques » (registre, fiche à onglets, formulaire prérempli depuis Keystone, libération automatique, redirection `/changements/[id]` utilisée par Codex), effectivité par défaut, plan d'actions, navigation et signaux, API, webhook vers Codex avec file d'envoi, tests (vitest à mettre en place).
- Keystone : `eco-connector.ts` (mode « db »), `deliverOutbox` avec jeton et état `refused`, `released_at` dans `domain/kpis.ts:337`, `links.ts:9-38`.
- Codex : `submitChange` appelle l'API de Vigie (`vigie.ts:24-31`) ; demande inconnue lue dans la vue ; adresse `/modifications-techniques/` ; simulation neutralisée quand `VIGIE_API_URL` est défini.

**API.** Vigie : `POST /api/ecrs` (création par Codex, 201 `{ id }`, 409 `change_pending`), `POST /api/ecos/[number]/progress` (approbation ou étape envoyée par Keystone, 409 `refused`). Webhook existant de Codex appelé par Vigie (`POST {CODEX_URL}/api/integrations/vigie`).

**Charge.** Vigie 14 j (vues déjà écrites), Keystone 3 j, Codex 2,25 j, Matrix 0,5 j.

**Risques.** Adresses divergentes (`/changements/` chez Codex, `/modifications-techniques/` chez Keystone). Collision possible des numéros fabriqués par la simulation de Codex. Une demande créée dans Vigie sans miroir Codex (transaction Codex échouée) se rattrape au premier webhook. Vigie n'a pas d'authentification : le contrôle des acteurs dépend de M-06 et D01. D13 passe avant D12.

### D13 · Non-conformités et HSE de projet (option A)

**Ce qui change.** Les NC de projet sont des événements de type NC de Vigie. Le registre HSE de chantier vient des plans de prévention, des permis, des accueils et des presqu'accidents de Vigie. Keystone garde ses miroirs `vigie_ncrs` et `vigie_hse_items`, rafraîchis depuis les vues, et son outbox `vigie_ncr_progress`.

**Source.** `vigie.events` (`type = 'NC'`) avec 10 colonnes ajoutées par la migration de Vigie `0008_partage_prerequis` (18/10/2026) : `keystone_project_code` (D02), `nc_number` (« NCR-029 », unique par projet), `keystone_activity_code`, `part_ref`, `keystone_deliverable_number`, `supplier_id`, `supplier_name` (D16), `root_cause`, `nc_cost_keur`, `iso_clause`. `closed_on` et `vigie_updated_at` ne sont pas stockés : la vue les calcule (`event_steps`, `change_log`). `prevention_plans`, `permits` et `site_activities` reçoivent `keystone_project_code`. Pas de table `vigie.inductions` (accueils sécurité, à arbitrer : C-13) : `pub_hse_projet` n'a pas de ligne « induction ». Types de permis `levage` et `travail_ht` ajoutés par contrôle applicatif.

**Vues.** `vigie.pub_non_conformites` (NC avec code projet et numéro, hors classées sans suite ; aucune colonne de santé ; les colonnes reprennent celles du miroir pour un `INSERT … SELECT`) et `pub_hse_projet` (registre par projet), créées par la migration de Vigie `0009_partage` et recopiées dans `50-vigie.sql`. Lecteurs : keystone_app, matrix_app.

**Lecteur : Keystone.** Même miroir, rafraîchi par `SELECT` sur les deux vues à la place de `GET /api/ncrs` et `/api/hse` (`quality-connector.ts:79-89`). `vigie_ncrs` gagne `closed_on`, `supplier_id` et `owner_matricule` (`30-keystone.sql`). L'avancement d'une NC part par l'API (§ 5.7).

**Clés étrangères locales.** Inchangées : `vigie_ncr_progress.ncr_id → vigie_ncrs.id` ; `raised_by_person_id`, `owner_person_id`, `actor_person_id` → `persons`, rattachées par le matricule après D01. Référence texte : `punch_items.ncr_number`.

**Rapprochement.** Aucune clé commune aujourd'hui : les 4 NC de Vigie portent des codes K-AAAA-NNN absents de Keystone, et les 15 NCR de Keystone n'ont pas de `vigie_ref`. Reprise : les 5 NCR de HLT-026 deviennent des événements NC avec leur numéro ; les 10 copies générées ne sont pas reprises. À faire à la main : pilotes dans `vigie.people` (D01), site de chaque NC (D14), code projet des NC de Vigie par `matrix.correspondances`. Correspondances de gravité et d'étape à valider par le QHSE. Le registre HSE de HLT-026 sera vide après la bascule et se ressaisit dans Vigie (1 plan, 1 accueil, 2 permis).

**Code.**

- Vigie : fiche NC (`EventEditButton.tsx`, `evenements/page.tsx`, `saveEvent`, `advanceEvent`, `revertEvent`), `/signaler` avec les paramètres envoyés par Keystone (`links.ts:75-79`), prévention (code projet, types de permis), accueils (en option), API d'avancement, reprise, tests.
- Keystone : rafraîchissement par `SELECT`, `deliverOutbox` avec jeton et état `refused`, `kpis.ts:150` (`closed_on`), `codes.ts:812` (valeur `design`), `links.ts:60-84`.

**API.** Vigie : `POST /api/ncrs/[project]/[number]/progress` (corps déjà émis par Keystone, `quality-connector.ts:103-108`), 409 `stale` si l'état a changé. L'API de Vigie ne sert qu'aux écritures.

**Charge.** Vigie 7,5 j (vues déjà écrites), Keystone 3,25 j, Matrix 0,5 j.

**Risques.** La gravité perd un niveau (4 dans Vigie, 3 dans Keystone). Les règles de Vigie feront refuser des demandes de Keystone : l'état `refused` évite des renvois sans fin. Les plans de prévention de Vigie sont pensés pour EPC2I entreprise utilisatrice, pas pour un chantier client. Les réclamations client sont exclues de la vue.

### D14 · Sites (option A)

**Ce qui change.** Matrix tient la liste unique des sites. Codex et Vigie lisent la même liste ; Vigie garde ses attributs Seveso ; Cursus rattache chaque salarié à un site. `keystone.project_sites`, qui décrit le lieu d'un projet, reste à part.

**Source.** `matrix.sites` (§ 4.2) : `code`, `libelle`, `ville`, `pays_iso2`, `ordre`, `actif`, `ferme_le`. Amorcée avec les 3 sites de Codex (`lyon`, `le_havre`, `marseille`).

**Vue.** `matrix.pub_sites` : `code`, `libelle`, `ville`, `pays_iso2`, `ordre`, `actif`. Lecteurs : les quatre outils.

**Lecteurs.**

| Outil | Lit | Table locale |
|---|---|---|
| Codex | `pub_sites` | `sites` gardée en cache (`key` = `code`, `label`, `sort`), rafraîchie avec les départements ; la branche « site » d'`addOrgValue` (`actions.ts:722-724`) est supprimée. |
| Vigie | `pub_sites` | `sites` gardée en cache : `label` et `sort` rafraîchis depuis la vue, `seveso` et `pp_from_first_minute` propres à Vigie. Une ligne veut dire « site suivi par Vigie ». Les 16 clés vers `vigie.sites` restent. |
| Cursus | `pub_sites` | `employes.site_code` (D01), contrôlé à la saisie contre la vue ; `sessions.lieu` reste du texte libre. |
| Keystone | facultatif | `storage_locations.site_code`, sans lecture aujourd'hui. |

**Clés étrangères locales.** `codex.users.site`, `codex.documents.site` → `codex.sites` et les 16 clés de Vigie restent ; leurs valeurs sont migrées pour Vigie.

**Rapprochement.** Codex : 3 sites sur 3, repris tels quels. Vigie : `ville-a` et `ville-b` sont des noms provisoires ; l'hypothèse `ville-a` = `lyon` est à confirmer par le QHSE, `ville-b` (zone d'essais) n'a pas d'équivalent et attend son vrai nom (C-08). Cursus : les 24 salariés sont sur un site lyonnais, rattachés à `lyon` si ce site est celui de Codex.

**Code.** Codex : rafraîchissement, écran Organisation en lecture. Vigie : schéma, migration des 16 tables en une transaction, `components/sitemap/model.ts:45-47` et les plans `public/plans/ville-a.svg`, `ville-b.svg`, écran « suivre un site de Matrix ». Cursus : compté dans D01.

**API.** Aucune : les sites se créent dans Matrix (§ 4.4).

**Charge.** Matrix 1 j, Codex 0,5 j, Vigie 2,5 j. Cursus compté dans D01 ; Keystone facultatif (0,5 j, non compté).

**Risques.** Les équivalences de sites ne sont pas confirmées. Un salarié rattaché à un site que Vigie ne suit pas sort de ses écrans filtrés par site. Codex accepte aujourd'hui des clés de site que Matrix refuse (premier caractère chiffre, un seul caractère) : avec D14, Codex ne crée plus de site.

### D15 · Organisation (option A)

**Ce qui change.** Matrix tient un organigramme unique à trois niveaux, département > service > équipe. Codex lit le département, Keystone le service (ou le département), Cursus l'équipe ; Vigie n'en a pas besoin aujourd'hui. Les RH gèrent les équipes depuis Cursus, qui écrit par l'API de Matrix.

**Source.** `matrix.organigramme` (§ 4.3) : `code` stable (département : 3 majuscules, repris dans les identifiants de documents de Codex), `niveau`, `parent_code`, libellés français et anglais, `responsable_matricule`, `site_code`, `ordre`, `actif`, `ferme_le`. Amorcé avec les 15 départements de Codex.

**Vue.** `matrix.pub_organigramme` : une ligne par unité, avec son département et son service. Lecteurs : les quatre outils.

**Lecteurs.**

| Outil | Lit | Table locale |
|---|---|---|
| Codex | niveau `departement` | `departments` gardée en cache (+ `active`), pour la clé `documents.department` ; `addOrgValue` (branche département) supprimée, écran Organisation en lecture. |
| Keystone | service ou département | `departments` gardée en cache (+ `org_code` unique) : `name` ← `libelle_en`, `sort_order` ← `ordre`, `head_person_id` ← personne du matricule responsable ; `head_title` et `department_capacities` restent locales. |
| Cursus | niveau `equipe` | `equipes` gardée en cache, avec le code Matrix pour clé ; `employes.unite_code`, `budgets.unite_code`, `plan_actions.unite_code` remplacent les colonnes `equipe`. Les actions de gestion des équipes appellent l'API de Matrix ; « affecter » reste local. |

**Clés étrangères locales.** Codex : `documents.department` et `users.department` → `departments` restent. Keystone : les 7 clés vers `departments` restent. Cursus : les clés vers `equipes` passent du nom au code.

**Rapprochement.** Codex : 15 codes sur 15. Keystone : 4 services sur 5 par le libellé anglais ; « Controls & planning » devient un service `PRJ-CPL` sous `PRJ`, à valider. Cursus : « Commercial » correspond à `COM` ; Logistique, Maintenance, Production, « Qualité & HSE » et Administration attendent l'organigramme réel (C-09, question O-04 de Codex). Responsables : ceux de Cursus sont repris ; conflits pour MEP et pour PRJ.

**Code.** Matrix : écran et API de l'organigramme (§ 4.4). Cursus : `actions/equipes.ts` (création, renommage, désignation, fermeture par l'API), 73 références à `equipe` dans 25 fichiers, test `tests/equipes.test.ts:117-132`. Codex : rafraîchissement et écran. Keystone : `org_code`, rafraîchissement, noms anglais identiques pour les tests golden.

**API.** Matrix : `POST /api/organigramme`, `PATCH /api/organigramme/:code`, `PUT /api/organigramme/:code/responsable`, `POST /api/organigramme/:code/fermeture`, avec un jeton par outil (§ 5.7).

**Charge.** Matrix 3,5 j, Cursus 4 j, Codex 1,5 j, Keystone 2 j.

**Risques.** Sans l'organigramme réel, le placement des équipes est une hypothèse. Les codes de département ne doivent jamais changer. Les actions de Cursus qui appellent l'API supposent la couche asynchrone (`docs/architecture-postgres.md`, § 8, sous-étape 8.a).

### D16 · Clients et fournisseurs (option A)

**Ce qui change.** Keystone reste seul propriétaire de `clients` et `suppliers`. Vigie garde ses entreprises extérieures (contacts HSE, corps de métier) et ajoute un lien facultatif vers le fournisseur Keystone. Les clients en texte libre des autres outils viennent du projet (`pub_projets`).

**Source.** `keystone.suppliers` et `keystone.clients` ; le lien projet → client existe (`projects.client_id`). Aucune colonne ajoutée à la source.

**Vues.** `keystone.pub_fournisseurs` (`id`, `name`, `x3_code`, `is_internal` ; lecteurs : vigie_app, matrix_app), `pub_clients` (`id`, `name`, `code3` ; codex_app, cursus_app, vigie_app, matrix_app), et les colonnes client de `pub_projets`.

**Lecteurs.**

| Outil | Lit | Table locale |
|---|---|---|
| Vigie | `pub_fournisseurs`, au moment de la saisie | `contractors` gardée, avec `supplier_id` (facultatif, sans unicité : deux agences d'une même société) ; `events.supplier_id` et `supplier_name` pour une NC fournisseur (D13). Les ateliers internes (`is_internal`) ne sont jamais proposés. |
| Codex | client par `pub_projets` | `projects.client` rafraîchi avec le cache des projets (D02). |
| Cursus | client par `pub_chantiers` (D03) | `chantiers.client` disparaît avec la réduction de D03. |

**Clés étrangères locales.** `prevention_plans.contractor_id`, `permits.contractor_id`, `site_activities.contractor_id` → `contractors` restent. Pas de clé vers l'autre schéma : `supplier_id` est contrôlé à l'enregistrement et par Matrix (§ 7.1).

**Rapprochement.** 0 entreprise de Vigie sur 6 ne se rapproche d'un fournisseur Keystone (noms masqués ; Keystone n'a que des fabricants et des soumissionnaires) : tous les `supplier_id` partent à nul et se renseignent à la main. Clients : 2 sur 3 pour Codex ; ceux de Vigie et de Cursus dépendent de D02 et D03. Les uuid de démonstration de Keystone changent à chaque rechargement (`seed/context.ts:7`) : des uuid déterministes pour les référentiels de démonstration évitent des `supplier_id` orphelins.

**Code.** Vigie : `contractors.supplier_id` (fait par la migration `0008_partage_prerequis`), `saveContractor` (contrôle contre la vue), `ContractorDialogs.tsx`, `ContractorView`, import des plans de prévention (`matchByName`). Keystone : uuid déterministes de démonstration.

**API.** Aucune : créer un fournisseur reste un acte de Keystone.

**Charge.** Keystone 0,5 j (identifiants de démonstration ; vues déjà écrites), Vigie 2,5 j, Matrix 0,5 j (orphelins, liste à compléter pour les Achats).

**Risques.** Taux de rapprochement réel inconnu (données masquées). Les libellés client de Keystone (« Port authority ») remplacent ceux, plus détaillés, de Codex.

### D17 · Pays (option A)

**Ce qui change.** Matrix publie la liste des pays ISO. Keystone ajoute le code ISO à ses pays ; Cursus garde ses règles de voyage par destination.

**Source.** `matrix.pays` (§ 4.1) : `iso2`, `iso3`, `nom_fr`, `nom_en`, `actif`. Amorcée avec les 22 pays de Keystone et les 3 destinations de Cursus absentes de Keystone (GH, BR, SA). `nom_en` est identique au caractère près à `keystone.countries.name` (tests golden, « Côte d’Ivoire » avec l'apostrophe typographique).

**Vue.** `matrix.pub_pays` : `iso2`, `nom_fr`, `nom_en`, `actif`. Lecteurs : les quatre outils.

**Lecteurs.**

| Outil | Lit | Table locale |
|---|---|---|
| Keystone | `pub_pays` | `countries` gardée, avec `iso2` (unique, facultatif comme dans le schéma Drizzle ; migration `0034_share_prerequisites`) ; zones et villes restent locales. Étape 2, recommandée : clé de `countries` sur `iso2`, `cities.country_name`, `project_sites.country_name` et `site_sheets.country` en code ISO. |
| Cursus | `pub_pays` | `destinations` gardée (visa, vaccins, validité du passeport), avec `pays` en cache de `nom_fr`, rafraîchi par Cursus (règle 3 : le repli SQLite garde les noms). |
| Codex, Vigie | rien aujourd'hui | aucune donnée de pays |

**Clés étrangères locales.** `cursus.voyages.dest`, `visas.dest`, `demandes_keystone.dest` → `destinations` restent. `chantiers.pays` n'a pas de clé (`FR` n'est pas une destination).

**Rapprochement.** Automatique : les 22 pays de Keystone par `nom_en`, les 8 destinations de Cursus déjà en ISO2. `site_sheets.country` « France » donne FR.

**Code.** Keystone : étape 1 (`iso2`), étape 2 (clés, carte du monde, tests golden). Cursus : `dataset.ts:56`, rafraîchissement de `destinations.pays`. Matrix : liste ISO complète.

**API.** Aucune.

**Charge.** Matrix 0,5 j, Keystone 2,5 j (étape 1 : 0,5 ; étape 2 : 2), Cursus 0,5 j.

**Risques.** Un écart d'un caractère sur `nom_en` casse les tests golden de Keystone. L'étape 2 touche la carte du monde.

### D18 · Journaux d'audit (option A)

**Ce qui change.** Chaque outil garde son journal et publie une vue `pub_journal` aux colonnes communes. Matrix les réunit en lecture dans `matrix.journal_unifie`. Vigie, qui n'a aucun journal (environ 80 actions serveur sans trace), en crée un.

**Source.** `keystone.audit_entries` et `activity_events`, `codex.audit_log`, `cursus.journal` (avec `actor_emp_id`, `objet_ref`, `projet_code` ajoutées par `20-cursus.sql`), `vigie.change_log` (journal des modifications, écrit par `logChange` ; `pub_journal` de la migration `0009_partage` n'en publie ni le motif ni le détail des champs, et écarte les accidents du travail et le registre des accidents bénins). La table `vigie.journal` prévue d'abord n'est pas créée.

**Vues.** Quatre `pub_journal` aux mêmes colonnes et types (`ref_source`, `nature`, `quand`, `qui`, `qui_ref`, `qui_role`, `action`, `objet`, `detail`, `projet`, `qui_matricule`), lues par matrix_app seulement. `cursus.pub_journal` ne lit ni `payload` ni `message`. `matrix.journal_unifie` (fichier `95`) les réunit ; c'est la seule vue du partage qui lit d'autres schémas, et un `DROP SCHEMA … CASCADE` sur un outil la supprime (procédure de restauration du README du socle).

**Lecteur : Matrix.** Écran « Journal » de l'administration : filtres par outil, période, auteur, objet, projet ; pagination par (`quand`, `ref_source`) ; export CSV.

**Clés étrangères locales.** Aucune ne disparaît. `vigie.change_log.by_id` vise `vigie.people`.

**Rapprochement.** Version 1 sans rapprochement (identifiants locaux) ; le matricule commun vient de D01 (`qui_matricule`), le code projet de D02 et D03.

**Code.** Cursus : `index.ts:111` écrit `actor_emp_id`, `objet_ref`, `projet_code`. Vigie : table, migration et fonction `logAction`, appelée par `requireManager`, `requireApprover` et les actions ; le signalement anonyme ne journalise pas son auteur ; jamais la lésion ni les jours d'arrêt dans `detail`. Matrix : connexion `matrix_app`, écran.

**API.** Aucune.

**Charge.** Keystone 0,25 j et Codex 0,25 j (index ; vues déjà écrites), Cursus 1 j, Vigie 3 j, Matrix 2,5 j.

**Risques.** `cursus.journal.message` contient des noms : écran réservé à l'administrateur des données, durée de conservation à fixer. L'heure de Paris sans fuseau de Codex est ambiguë une heure par an. `action` n'a pas le même sens dans tous les outils. `temps.setCell` n'est jamais journalisé.

### D19 · Paramètres et fichiers joints (option A)

**Ce qui change.** Aucune fusion : chaque outil garde ses paramètres et ses fichiers ; les fichiers qui ont valeur de document vont dans Codex au titre de D10. Le plan publie seulement l'horizon d'alerte de Cursus, sans que Vigie le lise tant que le QHSE ne l'a pas validé (§ 1.4, C-12).

**Source.** `cursus.settings`, clé `app`, champ `horizonAlerte` (90 jours par défaut, réglable de 30 à 180). Jamais `secret` ni `lastSagePush`.

**Vue.** `cursus.pub_parametres` : une ligne, `horizon_alerte_jours`. Lecteurs : vigie_app (accordé, lu seulement après C-12), matrix_app.

**Lecteurs.** Vigie garde `SKILL_SOON_DAYS = 60` (`src/lib/domain.ts:88`). Si le QHSE accepte l'horizon de Cursus, Vigie le lit dans la vue à la place de sa constante (0,5 j) ; l'alerte passe alors de 60 à 90 jours par défaut.

**Autres points.** Jours fériés : présents dans Cursus (calcul), Keystone (calcul, liste des Paramètres et `public_holidays`) ; identiques pour 2026, ils divergeraient si Keystone ajoutait un pont. Consigne : une fermeture d'entreprise se saisit dans les deux outils ; Matrix contrôle la cohérence (§ 7.2). `cursus.settings.secret` (clé des sessions) sort de la base vers `CURSUS_SECRET` (`docs/architecture-postgres.md`, § 8.3). Fichiers : sur les volumes des outils, sauvegardés avec la base.

**Clés étrangères locales.** Aucune touchée.

**API.** Aucune.

**Charge.** Cursus 0,5 j (secret), Matrix 0,5 j (contrôle des jours fériés). Vigie 0,5 j de plus si C-12 est acceptée.

**Risques.** Tant que C-12 n'est pas tranchée, un titre peut être « à renouveler » dans Cursus et « valide » dans Vigie entre J-90 et J-60.

### D20 · Homonymes (option A)

**Ce qui change.** Aucun renommage de table. Le schéma de chaque outil sert de préfixe : Matrix affiche partout `outil.table`. L'option dit « aucun changement de code » : c'est vrai des noms de tables, mais le passage au schéma par outil (M-01) demande des changements dans le code des outils (`pgSchema`, migration de base régénérée, migrateur dans le schéma de l'outil), décrits et chiffrés dans `docs/architecture-postgres.md` (§ 4.2, 4.3 et 13).

**Homonymes exacts** (`data/catalogue.json`) : 8 noms, 18 tables. Même objet ou même famille : `departments` (D15), `documents` (D10), `projects` (D02), `sites` (D14), `users` (D01), `certifications` de Keystone et de Cursus (D09). Objets différents : `vigie.certifications` (certifications ISO), `change_requests` (avenants chez Keystone, demandes de modification chez Codex), `risks` (risques projet chez Keystone, risques professionnels chez Vigie). Faux homonymes à afficher toujours qualifiés : `cursus.plan_actions` et `vigie.actions`, `cursus.settings` et `keystone.app_settings`, les journaux, `cursus.projets` et `keystone.projects`, les miroirs nommés d'après un autre outil (`keystone.vigie_*`, `keystone.cursus_*`, `vigie.keystone_*`), les quatre `pub_journal`.

**Règles.** Ne jamais ajouter un autre schéma au `search_path` ; toujours qualifier une lecture croisée (`pgSchema('keystone').view(…).existing()`) ; ne jamais exporter l'objet `pgSchema` d'un autre outil (§ 1.3).

**Charge.** Comptée dans `docs/architecture-postgres.md` (§ 13). Matrix : déclaration des vues `pub_` dans le catalogue, comptée au § 5.5.

## 4. Référentiels de Matrix

Les quatre tables sont dans le schéma `matrix`, créées et amorcées par `infra/postgres/partage/10-matrix-referentiels.sql` (essayé deux fois de suite, rejouable). Elles iront ensuite dans les migrations de Matrix, avec le migrateur commun (`docs/architecture-postgres.md`, § 4.3 et 11). Les outils lisent les vues `matrix.pub_*`, jamais les tables.

### 4.1 Pays (D17)

`matrix.pays` : clé `iso2`, `iso3` unique (non publié), `nom_fr`, `nom_en` unique, `actif`. 25 pays amorcés. Un pays retiré passe à `actif = false` et reste lisible pour l'historique. Lecture : `matrix.pub_pays`.

### 4.2 Sites (D14)

`matrix.sites` : clé `code`, minuscules, chiffres et soulignés, une lettre en premier, 2 à 32 caractères (`^[a-z][a-z0-9_]{1,31}$`), `all` interdit (réservé par Vigie). C'est aussi le motif de `cursus.employes.site_code` et du contrat d'heures (`codeSite`). La règle est plus stricte que la clé que Codex tire aujourd'hui d'un libellé (`actions.ts:722`) : Codex ne créera plus de site (D14). `pays_iso2` vise `matrix.pays`. Un site fermé reste référencé (`actif = false`, `ferme_le`). 3 sites amorcés ; ceux de Vigie (`ville-a`, `ville-b`) ne sont pas repris (C-08).

### 4.3 Organigramme (D15)

`matrix.organigramme` : trois niveaux, `departement` (racine, code de 3 majuscules, `QMS` réservé par Codex), `service` et `equipe` (code du département suivi d'un suffixe : `PRJ-CPL`). Un déclencheur contrôle la cohérence des niveaux, interdit de changer un code (repris dans les identifiants de documents de Codex) et fige le niveau d'une unité qui a des enfants. Libellés uniques par parent. 15 départements amorcés.

### 4.4 Écrans et API d'écriture

Les outils n'écrivent jamais dans `matrix` en SQL. Les RH gèrent les équipes depuis Cursus, qui appelle l'API de l'organigramme (D15) ; les sites et les pays se gèrent dans Matrix, par l'administrateur des données. Écrans de Matrix : pays, sites, organigramme (arbre, responsables, fermetures), correspondances (§ 4.5). L'authentification des outils auprès de Matrix suit les règles de `docs/remplacement-lucca.md` (§ 3.2) : une clé par appelant, comparée en temps constant.

### 4.5 Correspondances

`matrix.correspondances` relie un identifiant local d'un outil (uuid de Keystone, identifiant court de Codex ou de Vigie, entier de Cursus, numéro de document, code projet) à la clé commune, le pivot : matricule `EMP-xxxx` ou provisoire `PRV-xxxx`, code projet de Keystone, code de site, code d'unité, code ISO, `titre_id` de Cursus, identifiant de Codex.

- **Objets** : personne (D01), projet (D02, D03), site (D14), unité (D15), pays (D17), titre (D08), document (D10).
- **Méthodes** : `nom_exact` (probable), `nom_court` (à vérifier), `code`, `rang` (documents de Keystone vers Codex), `manuel`, `jeu_demo`. Jamais le nom de famille seul.
- **Statuts** : `propose`, `valide`, `a_creer` (l'objet doit d'abord être créé chez l'outil qui fait foi : projet K-2614 à créer dans Keystone), `abandonne` (donnée de démonstration non reprise), `rejete`, `retire`. Matrix propose ; les RH décident pour les personnes, l'informatique pour le reste.
- **Pivot provisoire** : `PRV-xxxx` relie dès maintenant les 14 personnes communes à Codex et Keystone ; il est remplacé par le matricule quand les RH créent la fiche dans Cursus.
- **Lecture** : `matrix.pub_correspondances` publie les lignes décidées (`valide`, `abandonne`). Chaque outil ne voit que ses propres lignes : la vue filtre sur le rôle qui l'interroge, parce que `cle_naturelle` porte des noms (`short_name` des personnes de Keystone). `libelle_local` n'est pas publié. Essai : `keystone_app` et `codex_app` voient chacun leur ligne, `cursus_app` aucune, `matrix_app` les trois.
- **Usage** : chaque outil lit ses lignes et pose lui-même sa clé locale (`persons.matricule`, `events.keystone_project_code`, `training_titles.id`, alias de documents). Une fois les colonnes en place, la table sert de trace et Matrix contrôle la cohérence entre la colonne locale et la correspondance (§ 7.2).

## 5. Plan par outil

Les charges sont en jours de développement, tests compris, hors bascule vers PostgreSQL (`docs/architecture-postgres.md`, § 13) et hors D06 et D07 (`docs/remplacement-lucca.md`, § 5.5), sauf mention.

### 5.1 Cursus

| Décision | Contenu | Jours |
|---|---|---|
| D01 | `matricule`, `site_code`, `unite_code`, `sortie` ; règles de profil ; filtre des sortis ; recherche par matricule | 2 |
| D02 | cache `projets` (colonnes de la vue), filtre `imputable`, reprise des codes dans `feuilles.lignes` | 1,5 |
| D03 | `chantiers` réduite aux exigences, écran des exigences, routes Keystone sur le code projet | 3,5 |
| D04 | cache `missions` (`affectation_id`), rafraîchissement | 1,5 |
| D05 | `temps.suggest` sur `pub_taches_jours`, suppression de `taches` | 2,5 |
| D08 | « sans échéance », trois titres, écran du catalogue | 3 |
| D09 | `certifications.organisme`, route pour Vigie | 2 |
| D15 | cache `equipes` par code, actions par l'API de Matrix | 4 |
| D17 | cache `destinations.pays` | 0,5 |
| D18 | colonnes du journal, écriture | 1 |
| D19 | `secret` hors de la base | 0,5 |
| **Total** | | **22** |

### 5.2 Keystone

| Décision | Contenu | Jours |
|---|---|---|
| D01 | `persons.matricule`, synchronisation des personnes, contrainte externes | 4 |
| D02 | `projects.kind`, projets internes, `listProjects`, revue des 36 lecteurs | 3 |
| D03 | écrans fiche chantier et rotations, connecteur sur le code projet | 4,5 |
| D04 | vue (écrite), test | 0,5 |
| D05 | vue (écrite), test | 0,5 |
| D09 | lecture des titres de Cursus, suppression de `certifications` | 2 |
| D10 | index réduit, lectures et écritures par Codex, tests | 11 |
| D11 | caches du registre, rôles en clés de fonction | 3 |
| D12 | miroir des ECO par les vues, outbox | 3 |
| D13 | miroirs NC et HSE par les vues, outbox | 3,25 |
| D15 | cache `departments` (`org_code`) | 2 |
| D16 | identifiants de démonstration déterministes | 0,5 |
| D17 | `countries.iso2`, puis clés ISO | 2,5 |
| D18 | index du journal | 0,25 |
| **Total** | | **40** |

### 5.3 Codex

| Décision | Contenu | Jours |
|---|---|---|
| D01 | `users.matricule`, cache des utilisateurs, rattachement dans l'Administration | 2 |
| D02 | `syncProjects()`, cache `projects` | 2 |
| D10 | colonnes, import étendu, routes pour Keystone, alias | 7,5 |
| D12 | demandes par l'API de Vigie, webhook | 2,25 |
| D14 | cache `sites` | 0,5 |
| D15 | cache `departments`, écran en lecture | 1,5 |
| D18 | index du journal | 0,25 |
| **Total** | | **16** |

### 5.4 Vigie

| Décision | Contenu | Jours |
|---|---|---|
| D01 | `people.matricule`, rattachement, remplacement des noms provisoires | 3 |
| D02 | `keystone_project_code` dans 4 tables, contrôles et dialogues | 3,5 |
| D04 | cache `keystone_assignments` | 1 |
| D08 | cache `training_titles`, recodage | 1,5 |
| D09 | lecture des titres détenus, saisie par l'API de Cursus | 3 |
| D10 | migration des documents dans Codex, registre en lecture | 7,5 |
| D12 | tables ECR et ECO, écran, API, webhook, tests | 14 |
| D13 | fiche NC, API d'avancement, reprise | 7,5 |
| D14 | cache `sites`, migration des 16 tables | 2,5 |
| D16 | `contractors.supplier_id`, saisie et contrôle | 2,5 |
| D18 | journal à créer | 3 |
| **Total** | | **49** |

### 5.5 Matrix

| Décision | Contenu | Jours |
|---|---|---|
| D08, D09, D10, D11, D12, D13 | correspondances (titres, documents), flux | 2,75 |
| D14, D15, D17 | tables (écrites), écrans, API de l'organigramme, liste ISO | 5 |
| D16, D19 | contrôles (orphelins, jours fériés) | 1 |
| D18 | écran Journal | 2,5 |
| Correspondances | propositions automatiques, écran de validation, contrôle d'orphelins (table écrite) | 2,5 |
| **Total** | | **13,75** |

### 5.6 Synthèse des charges

| Décision | Cursus | Keystone | Codex | Vigie | Matrix | Total |
|---|---|---|---|---|---|---|
| D01 | 2 | 4 | 2 | 3 | | 11 |
| D02 | 1,5 | 3 | 2 | 3,5 | | 10 |
| D03 | 3,5 | 4,5 | | | | 8 |
| D04 | 1,5 | 0,5 | | 1 | | 3 |
| D05 | 2,5 | 0,5 | | | | 3 |
| D08 | 3 | | | 1,5 | 0,5 | 5 |
| D09 | 2 | 2 | | 3 | 0,5 | 7,5 |
| D10 | | 11 | 7,5 | 7,5 | 0,5 | 26,5 |
| D11 | | 3 | | | 0,25 | 3,25 |
| D12 | | 3 | 2,25 | 14 | 0,5 | 19,75 |
| D13 | | 3,25 | | 7,5 | 0,5 | 11,25 |
| D14 | | | 0,5 | 2,5 | 1 | 4 |
| D15 | 4 | 2 | 1,5 | | 3,5 | 11 |
| D16 | | 0,5 | | 2,5 | 0,5 | 3,5 |
| D17 | 0,5 | 2,5 | | | 0,5 | 3,5 |
| D18 | 1 | 0,25 | 0,25 | 3 | 2,5 | 7 |
| D19 | 0,5 | | | | 0,5 | 1 |
| Correspondances | | | | | 2,5 | 2,5 |
| **Total du plan** | **22** | **40** | **16** | **49** | **13,75** | **140,75** |
| D06 et D07 (`docs/remplacement-lucca.md`) | 6 | 8 | | 2,5 | 1 | 17,5 |
| **Total avec D06 et D07** | **28** | **48** | **16** | **51,5** | **14,75** | **158,25** |

- Prérequis de D06 et D07 dans ce tableau : D01 (11), D02 (10), D05 (3) et D14 (4), soit 28 jours. `docs/remplacement-lucca.md` et `docs/architecture-postgres.md` renvoient à ce chiffre.
- Hors de ce tableau : la bascule de chaque outil vers le serveur commun et D20 (`docs/architecture-postgres.md`, § 13), la reprise métier de D09 (1 à 2 jours de RH et de QHSE), D19 côté Vigie si C-12 est acceptée (0,5 jour), Keystone D14 (0,5 jour, facultatif).
- Les prérequis du partage (colonnes et tables des fichiers `20` à `60`) sont compris dans les décisions qui les demandent.

### 5.7 Routes d'API (écritures d'un outil chez un autre)

Aucune lecture ne passe par une API : les lectures se font par les vues `pub_`. Les écritures croisées passent par l'API de l'outil propriétaire.

| Route | Propriétaire | Appelant | Décision |
|---|---|---|---|
| `POST /api/integrations/vigie/certifications` | Cursus | Vigie | D09 |
| `POST /api/organigramme`, `PATCH /api/organigramme/:code`, `PUT /api/organigramme/:code/responsable`, `POST /api/organigramme/:code/fermeture` | Matrix | Cursus | D15 |
| `POST /api/integrations/keystone/documents`, `POST …/documents/{id}/versions`, en option `POST …/{id}/validation` | Codex | Keystone | D10 |
| `POST /api/import` (étendu : historique, version en cours, état) | Codex | script de migration de Vigie | D10 |
| `POST /api/ecrs` | Vigie | Codex | D12 |
| `POST /api/ecos/[number]/progress` | Vigie | Keystone | D12 |
| `POST /api/ncrs/[project]/[number]/progress` | Vigie | Keystone | D13 |
| `POST {CODEX_URL}/api/integrations/vigie` (webhook existant) | Codex | Vigie | D12 |
| `POST /api/integrations/cursus/events` | Keystone | Cursus | D06, D07 |
| `GET /api/integrations/vigie/heures-travaillees` (lecture d'un agrégat calculé en TypeScript) | Cursus | Vigie | D06 |
| `GET /api/integrations/keystone/chantiers/:id/go-no-go`, `POST /api/integrations/keystone/demandes` (existantes, sur le code projet) | Cursus | Keystone | D03 |

## 6. Ordre des lots

Un lot ne commence que si ses prérequis sont en place. Les vues d'un outil attendent sa bascule sur le serveur commun ; tout ce qui lit Cursus attend la sienne (étape 4 de `docs/architecture-postgres.md`, § 10).

| Lot | Contenu | Prérequis |
|---|---|---|
| 0 | M-05 ; socle, collecteur, intégration continue (étape 0) ; D20 technique (`pgSchema`, migration de base, migrateur) dans chaque outil ; couche asynchrone de Cursus (sous-étape 8.a) | aucun |
| 1 | Référentiels de Matrix : D17, puis D14, puis D15 (structure) ; correspondances (table, propositions, écran) | lot 0 (étape 0) |
| 2 | Codex basculé (étape 1) : migration `partage`, vues D10, D11, D18 ; caches `sites`, `departments` (D14, D15) | lot 1 |
| 3 | Vigie basculé (étape 2) : migration `partage` ; D13 (colonnes, vues, API), puis D12 (tables, vues, API, reprise) ; D18 (journal) ; cache `sites` (D14) | lot 1 ; D13 avant D12 |
| 4 | Keystone basculé (étape 3) : migration `partage` ; vues D02 à D05, D16 ; D17 (`iso2`) ; D15 (`org_code`) ; caches du registre (D11) ; miroirs NC, HSE et ECO par les vues (D12, D13) ; D16 côté Vigie | lots 2 et 3 |
| 5 | Cursus basculé (étape 4) : migration `partage` ; vues D01, D08, D09, D18, D19 ; puis les lecteurs : personnes (D01) dans Keystone, Codex, Vigie ; titres (D08, D09) dans Vigie et Keystone ; projets, chantiers, affectations, tâches (D02 à D05) dans Cursus et Vigie ; équipes de Cursus par l'API de Matrix (D15) ; `matrix.journal_unifie` (fichier `95`) | lot 4 |
| 6 | D10 : colonnes et import de Codex, alias, index de Keystone, migration des documents de Vigie (Vigie en lecture seule pendant l'opération) | lot 5 (D01, D11) |
| 7 | Suppressions : `vigie.qualifications`, `keystone.certifications`, `vigie.keystone_projects`, `cursus.taches`, `keystone.document_revisions`, `document_approvals`, `document_index_syncs`, `vigie.documents`, `document_versions` ; contrôles de Matrix en service (§ 7) | lots 5 et 6, reprises validées |

D06 et D07 suivent leur propre calendrier (`docs/remplacement-lucca.md`, § 6) : construction après la sous-étape 8.a, sur SQLite, en parallèle des lots 1 à 5 ; marche en parallèle sur données réelles après le lot 5, qui pose D01, D02, D05 et D14.

## 7. Contrôles de Matrix

Matrix lance ces contrôles chaque nuit, en `matrix_app`, et les affiche dans l'écran Qualité. Ils ne modifient rien.

### 7.1 Orphelins

Une référence croisée est une colonne texte sans clé étrangère. Matrix vérifie qu'elle désigne une ligne de la vue de l'outil qui fait foi :

| Colonne | Vue de référence |
|---|---|
| `keystone.persons.matricule`, `codex.users.matricule`, `vigie.people.matricule` | `cursus.pub_salaries.matricule` |
| `cursus.employes.site_code`, `codex.sites.key`, `vigie.sites.id` | `matrix.pub_sites.code` |
| `cursus.employes.unite_code`, `codex.departments.code`, `keystone.departments.org_code` | `matrix.pub_organigramme.code` |
| `vigie.*.keystone_project_code`, `codex.projects.code`, `cursus.projets.code`, `cursus.feuilles.lignes[].projet` | `keystone.pub_projets.code` |
| `vigie.contractors.supplier_id`, `vigie.events.supplier_id` | `keystone.pub_fournisseurs.id` |
| `vigie.training_titles.id` | `cursus.pub_titres.titre_id` |
| `keystone.documents.codex_id`, `vigie.document_actions.codex_id`, `vigie.eco_documents.codex_doc_id` | `codex.pub_documents.id` |
| `keystone.countries.iso2`, `cursus.destinations.code` | `matrix.pub_pays.iso2` |
| `keystone.warranty_claims.eco_number` et les autres numéros d'ECO | `vigie.pub_ordres_modification.number` |

### 7.2 Caches et correspondances

- Chaque cache est comparé à sa vue : lignes absentes, en trop, valeurs différentes, date du dernier rafraîchissement. Caches suivis : `codex.users`, `projects`, `departments`, `sites` ; `keystone.persons`, `departments`, `document_types`, `document_type_circuit_steps`, `document_approver_assignments`, miroirs `vigie_*` ; `vigie.people`, `sites`, `training_titles`, `keystone_assignments` ; `cursus.projets`, `equipes`, `missions`, `destinations.pays`.
- Une affectation de `keystone.pub_affectations` dont la personne n'a pas de fiche locale dans Cursus ou Vigie est signalée (D04).
- Chaque correspondance validée est comparée à la colonne locale qu'elle a posée.
- Jours fériés : la liste des Paramètres de Keystone et le calcul de Cursus pour l'année en cours et la suivante (D19).

### 7.3 Forme des vues

Matrix publie, pour chaque vue `pub_`, sa liste de colonnes et leurs types, lue dans le catalogue du serveur, et la date du dernier changement. Les outils en tirent leurs substituts pour les modes de repli : vues de mêmes colonnes sur des lignes de démonstration (PGlite), fichiers JSON de même forme (SQLite de Cursus). Un changement de forme non annoncé (colonne retirée ou renommée sans vue `_v2`) est une erreur.

### 7.4 Droits

`droits.verifier()` chaque nuit : aucune ligne `erreur` attendue, partage en place. Elle signale notamment un lecteur inscrit dans `droits.partage_lecteurs` qui a perdu son droit (après une restauration) et une vue `pub_` qui lirait une colonne sensible (`infra/postgres/README.md`, « Vérifier les droits »).

## 8. Questions ouvertes

| N° | Question | Pour qui | Bloque |
|---|---|---|---|
| C-01 | Sens des titres de Vigie : `elec`, `atex`, `hauteur` et `conduite` désignent-ils l'habilitation (proposition) ou la formation (D08) ? | RH, QHSE | Recodage de `training_titles` |
| C-02 | Faut-il publier un indicateur d'aptitude médicale dans `pub_titres_detenus`, sans la date de visite (D09) ? Sans lui, Vigie affiche valide une habilitation suspendue. | DPO | Alertes de Vigie |
| C-03 | Les 16 codes projet inconnus de Keystone (6 K-26xx de Cursus, 10 K-AAAA-NNN de Vigie) sont-ils des projets réels à créer (`a_creer`) ou des données de démonstration (`abandonne`) (D02) ? | Utilisateur | Reprise des codes |
| C-04 | Quel usage réel des applications Mac (hors ligne, démonstration, saisie) ? Il décide des substituts à maintenir pour les modes de repli (§ 1.3). | Utilisateur | Substituts |
| C-05 | Statut « Frozen » de Keystone : le supprimer, ou le garder comme indicateur local (D10) ? | Utilisateur (Keystone) | Index des documents |
| C-06 | Périmètre des documents QHSE lus par Vigie : `attachment = 'none'` et départements QUA, HSE suffisent-ils (D10) ? | QHSE | Registre de Vigie |
| C-07 | Phase et code analytique des 8 projets internes (D02) : quelle phase Keystone, et quels codes Sage ? | Utilisateur, finance | Projets internes |
| C-08 | Sites de Vigie : `ville-a` est-il `lyon` ? quel est le vrai nom de `ville-b` ? le site lyonnais de Cursus est-il celui de Codex (D14) ? | QHSE, RH | Migration des sites |
| C-09 | Placement des équipes de Cursus dans l'organigramme, service `PRJ-CPL`, responsables en conflit (D15) : attend l'organigramme réel (O-04 de Codex). | Direction, RH | Organigramme |
| C-10 | Go / No Go : évaluer chaque personne sur ses dates de rotation plutôt que sur celles du chantier ? et que faire d'un déplacement court sans fiche chantier, comme K-2633 à Grenoble (D03, D04) ? | Utilisateur | D03, D04 |
| C-11 | 17 salariés sur 24 n'ont que des lignes internes dans les tâches de démonstration : faut-il des tâches internes dans Keystone pour que la proposition de lignes reste utile (D05) ? | Utilisateur | D05 |
| C-12 | Horizon d'alerte des titres : Vigie passe-t-il à l'horizon de Cursus (90 jours par défaut, réglable) au lieu de ses 60 jours (D19) ? | QHSE | Alertes de Vigie |
| C-13 | Accueils sécurité de chantier : faut-il la table `vigie.inductions`, ou un document Codex et le titre « accueil sécurité » de Cursus suffisent-ils (D13) ? | QHSE | Registre HSE de projet |

Les questions M-03 à M-06 (`docs/decisions.md`), P-01 à P-12 (`docs/architecture-postgres.md`) et L-01 à L-14 (`docs/remplacement-lucca.md`) restent ouvertes de leur côté.

## Annexe : vérifications

Vérifié dans le code et sur le serveur d'essai, le 15/10/2026 :

- Le SQL de partage (`infra/postgres/partage/`) joué deux fois sur un PostgreSQL 16.15 neuf, socle et migrations des quatre outils en place : 35 vues contrôlées et accordées, 88 couples (vue, lecteur) inscrits dans `droits.partage_lecteurs`, `droits.verifier()` sans aucune ligne, `verifier-droits.sql` à 96 cas conformes (`infra/postgres/partage/README.md`, « Essais »).
- Restauration du schéma `cursus` partage en place : droits perdus signalés puis rétablis par le rejeu de 20, 90 et 95.
- `matrix.pub_correspondances` filtrée par outil.
- Clés étrangères qui visent `cursus.projets` : seulement `missions.projet` et `taches.projet` (`infra/postgres/cursus/schema.sql:423`, `:430`) ; `missions` est gardée (D04).
- Clés qui visent `keystone.document_types` : `documents_type_code_document_types_code_fk` et `document_deposits_type_code_document_types_code_fk` (migrations de Keystone) ; le cache les garde valides (D11).
- `checkAbsence` lit `d.ds.missions` de façon synchrone (`cursus/shared/rules/conges.ts:128`) : `missions` reste en cache (D04).
- `codex/src/lib/access.ts:80` compare `ctx.user.department` au département du document : `users.department` reste en cache (D01).
- Horizons d'alerte : `SKILL_SOON_DAYS = 60` dans Vigie (`src/lib/domain.ts:88`), `horizonAlerte: 90` dans Cursus (`server/src/dataset.ts:15`) (D19).
- Le collecteur de Matrix lit les noms qualifiés : 28 tables et 37 clés sur `infra/postgres/cursus/schema.sql`, mêmes résultats qu'avant sur les migrations actuelles des outils.
- Charges : reprises des six analyses du 15/10/2026, moins l'écriture des vues déjà faite dans `infra/postgres/partage/` ; D04, D08 et D11 recalculées pour des caches au lieu de suppressions.
