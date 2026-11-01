# Matrix : proposition

Matrix est l'outil du service informatique pour gérer les bases de données de la suite EPC2i : Keystone, Codex, Cursus et Vigie. Il ne remplace aucune base. Il les recense, montre comment elles sont reliées, repère les doublons et suit chaque changement de schéma. Plus tard, il servira aussi à les administrer : volumétrie, extraits, sauvegardes, droits.

Il suit les mêmes règles de conception que les autres outils (design system Nocturne, structure de l'écran de Codex, interface en français), parce qu'un outil technique doit être aussi simple à utiliser que les autres.

- Maquette navigable : `maquette/matrix.html` (un seul fichier, données réelles des quatre dépôts).
- Liste des doublons à trancher : `docs/doublons-a-trancher.md`.
- Déclaration automatique des nouvelles tables : `docs/declaration-des-tables.md`.

## 1. Ce que montre l'analyse des quatre bases

Les chiffres ci-dessous sont lus dans le code source au 15 octobre 2026 : migrations Drizzle de Keystone, Codex et Vigie, déclaration `TABLES` de Cursus.

| Outil | Rôle | Moteur | Tables | Colonnes | Liens |
|---|---|---|---:|---:|---:|
| Keystone | Gestion de projets et de portefeuille | PostgreSQL embarqué (PGlite) · Drizzle | 203 | 2 017 | 370 |
| Codex | GED du groupe | PostgreSQL embarqué (PGlite) · Drizzle | 22 | 187 | 38 |
| Cursus | RH : formations, temps, déplacements | SQLite (node:sqlite), sans ORM | 28 | 200 | 37 |
| Vigie | QHSE : événements, risques, prévention | PostgreSQL embarqué (PGlite) · Drizzle | 36 | 304 | 58 |
| **Total** | | | **289** | **2 708** | **503** |

**Liens entre les quatre outils.** 15 flux ont été relevés, champ par champ, dans `data/flux.json` :
- **2 réels**, construits des deux côtés : le verdict Go / No Go de Cursus lu par Keystone, et les demandes de déplacement envoyées par Keystone à Cursus.
- **2 partiels**, construits d'un seul côté : le registre des types de Codex, que Keystone ne lit pas encore ; le webhook de décision ECR, que Vigie n'appelle pas.
- **Les 11 autres** sont simulés, proposés, prévus, ou recopiés par les jeux de démonstration sans aucune synchronisation.

**Doublons.** Les tables ont été comparées deux à deux entre outils (noms et colonnes), puis vérifiées dans le code et dans les données de démonstration :
- **20 groupes**, qui concernent 73 tables ; 4 sont critiques : personnes, projets, temps passés, documents.
- Exemples tirés du contenu :
  - 11 des 25 personnes de Codex existent aussi dans Keystone, sous un autre identifiant.
  - Vigie et Cursus ont les mêmes titres de formation (codes et durées de validité identiques).
  - La politique QHSE existe à la fois dans Codex et dans Vigie.
- Le détail, avec les options pour chaque groupe, est dans `docs/doublons-a-trancher.md`.

**Points d'architecture.**
- **Bases embarquées.** Les quatre bases sont embarquées dans leur outil (PGlite ou SQLite, dans le volume du conteneur). Un outil tiers ne peut pas s'y connecter pendant que l'outil tourne. C'est la principale limite pour une gestion centralisée (voir § 4).
- **Cursus.** Il ne déclare aucune clé étrangère : 37 liens sont tenus uniquement par le code. Il garde des données de santé (visite médicale, vaccinations) dans les mêmes tables que les données courantes.
- **Vigie.** Il stocke le projet Keystone en texte libre (« K-2025-042 · client ») dans quatre tables.
- **Keystone et Vigie.** Ils n'ont aucun index secondaire.

## 2. Les écrans

La structure est celle de Codex :
- une barre latérale de 224 px ;
- un en-tête avec le titre de l'écran et une recherche globale ;
- des écrans en trois volets : arbre de classement, liste, aperçu rapide.

Les autres règles de Codex sont reprises :
- un clic sur une ligne ouvre l'aperçu ;
- les filtres sont des boutons segmentés ;
- les états sont des étiquettes : remplie et accentuée pour l'état actif, contour pour les états en cours, neutre pour le reste ;
- les filets des tableaux s'estompent aux extrémités ;
- il n'y a jamais de rouge ;
- les intitulés sont courts et en français.

| Écran | Pour quoi faire |
|---|---|
| **Accueil** | Les chiffres clés, l'état de chaque base, les points critiques à traiter, les nouvelles tables déclarées. |
| **Bibliothèque** | Le catalogue des 289 tables : arbre outil › domaine, filtres (échangées, en double, sensibles, isolées, à documenter), recherche sur les noms de table et de colonne. La fiche d'une table donne ses colonnes (type, clé, lien, donnée sensible), ses liens dans les deux sens, les écrans qui la lisent ou l'écrivent et les logiciels qui l'échangent. |
| **Graphe des liens** | Trois vues. **Liens entre tables** : clés déclarées, liens logiques, flux et doublons entre outils ; on peut centrer sur une table et choisir 1 ou 2 sauts de voisinage. **Échanges entre logiciels** : un outil par coin ; chaque flux est un losange qui relie les tables lues aux tables alimentées ; un clic donne les informations extraites, champ par champ. **Écrans → tables** : pour un outil, quels écrans lisent ou écrivent quelles tables. |
| **Flux entre logiciels** | Les contrats d'interface : qui lit quoi chez qui, par quel point d'accès, avec quelle sécurité, dans quel état ; tableau croisé de → vers ; systèmes externes (Sage Paie, SharePoint, Lucca, Sage X3, Trackdéchets). |
| **Doublons** | Les 20 groupes de tables en double, ce qu'elles contiennent, les colonnes qui se correspondent, les options et celle qui est proposée. On choisit une option par groupe ; « Copier mes décisions » produit le texte à transmettre. |
| **Qualité des schémas** | Indicateurs par base (liens logiques, tables isolées, colonnes JSON, données sensibles, tables sans écran) et points d'attention. |
| **Administration** | Connexions aux bases, collecte et historique des schémas, rôles et droits, journal. |

## 3. Comment Matrix connaît les tables

**Aujourd'hui (fait).**
- Le collecteur (`outils/collecteur.mjs`) lit le schéma dans le code des quatre dépôts.
- Chaque outil peut aussi **déclarer** son schéma réel à Matrix au démarrage (`integration/declarer-schema.mjs`). Une table créée dans un outil arrive alors dans la bibliothèque, marquée à documenter, et elle est comparée aux tables des autres outils pour signaler un doublon possible.
- Le module a été vérifié sur les quatre bases réelles. Le détail est dans `docs/declaration-des-tables.md`.

**Ce que le code ne dit pas** est saisi à la main et versionné dans `data/` :
- les flux entre outils ;
- les écrans qui utilisent chaque table ;
- les doublons et leurs options.

## 4. Architecture proposée

**Étape 1 : catalogue (maquette actuelle).** Matrix lit les schémas, sans accès aux données. Aucun changement dans les outils, sauf l'ajout de la déclaration du schéma.

**Étape 2 : un serveur PostgreSQL commun, un schéma par outil (validé le 15 octobre 2026).** Les quatre bases restent séparées, mais sur un même serveur :

```
serveur PostgreSQL EPC2I
├── schéma keystone   ← propriétaire : rôle keystone_app
├── schéma codex      ← propriétaire : rôle codex_app
├── schéma cursus     ← propriétaire : rôle cursus_app (migration depuis SQLite)
├── schéma vigie      ← propriétaire : rôle vigie_app
└── schéma matrix     ← catalogue, correspondances, historique, journal
    rôles : matrix_lecture (lecture seule sur tout, colonnes sensibles exclues), matrix_admin
```

- **Chaque outil reste maître de ses tables.** Matrix lit tout, sans pouvoir écrire dans les schémas des outils, sauf avec le rôle d'administration et une action journalisée.
- **Bascule simple pour Keystone, Codex et Vigie.** Ils utilisent déjà le dialecte PostgreSQL : on remplace PGlite par `node-postgres`, comme le prévoit déjà un commentaire de Keystone.
- **Cursus demande une migration.** Il faut passer de SQLite à PostgreSQL et déclarer les 37 clés étrangères qui manquent.
- **Une base partagée, chaque outil chez soi.** Cela répond à la question O-03 de Codex (API ou base partagée), sans mélanger les tables des outils.
- **Une seule politique de sauvegarde** pour les quatre outils.

**Étape 3 : administration.** Avec l'accès en lecture, Matrix ajoute :
- la volumétrie et sa tendance ;
- des extraits masqués des données ;
- le contrôle des liens logiques (lignes orphelines) ;
- le suivi des migrations appliquées ;
- les sauvegardes.

Les tables de correspondance (personnes, projets, sites) tranchées dans la liste des doublons vivent dans le schéma `matrix` et sont publiées aux outils.

**Technique.**
- Même pile que Codex et Vigie : Next.js 16, Drizzle et PostgreSQL. Port interne 3000, déployé par Docker et Coolify comme les autres outils.
- Le graphe utilise Cytoscape.js.
- L'authentification suivra le choix fait pour les autres outils (question O-02 de Codex, Entra ID proposé).

**Tables de Matrix (schéma `matrix`).**

| Table | Contenu |
|---|---|
| `applications` | Les outils, leur environnement et leur connexion (chiffrée). |
| `declarations` | Chaque schéma déclaré : date, version, empreinte, contenu. |
| `tables_catalogue`, `colonnes` | Le catalogue courant, avec domaine, description, responsable et sensibilité. |
| `liens` | Clés étrangères déclarées, liens logiques, liens entre outils. |
| `flux`, `flux_champs` | Contrats d'interface et correspondance champ à champ. |
| `ecrans`, `ecrans_tables` | Écrans des outils et tables lues ou écrites. |
| `doublons`, `doublons_tables`, `decisions` | Groupes de doublons, options, décisions et qui les a prises. |
| `correspondances` | Identifiant d'une même personne, d'un même projet, etc. dans chaque outil. |
| `historique_schemas` | Tables et colonnes ajoutées ou supprimées. |
| `journal`, `roles`, `droits` | Traçabilité et droits dans Matrix. |

## 5. Sécurité

- **Lecture seule par défaut.** Toute écriture dans la base d'un outil passe par le rôle d'administration et laisse une trace dans le journal.
- **Données sensibles masquées par défaut.** Visite médicale, vaccinations, passeport, contenu des entretiens et lésions sont masqués. Seul l'administrateur des données les voit.
- **Déclarations authentifiées.** Les outils envoient leur déclaration avec un jeton partagé (`MATRIX_TOKEN`), comparé en temps constant.
- **Rôles proposés.**
  - L'administrateur des données a tous les droits.
  - Le responsable de domaine consulte et documente.
  - Le lecteur consulte.
  - La matrice détaillée est dans la maquette, sous Administration › Rôles & droits.

## 6. Feuille de route

| Lot | Contenu |
|---|---|
| 1 · Catalogue | Application Matrix (bibliothèque, graphe, flux, doublons, qualité) sur les schémas lus dans le code ; réception des déclarations ; ajout du module de déclaration dans les quatre outils. |
| 2 · Décisions | Saisie des décisions sur les doublons dans Matrix ; référentiels (pays, sites, organigramme) et tables de correspondance personnes, projets, sites, tenus dans Matrix. |
| 3 · Serveur commun | Serveur PostgreSQL à schéma par outil ; bascule de Codex, Vigie et Keystone ; migration de Cursus ; compte de lecture de Matrix (`docs/architecture-postgres.md`, § 10). |
| 4 · Convergence | Publication aux outils : vues `pub_` de chaque outil après sa bascule, lecture par les autres, caches et suppressions, dans l'ordre des lots de `docs/convergence-des-donnees.md` (§ 6). Les vues d'un outil attendent sa bascule (lot 3). |
| 5 · Administration | Volumétrie, extraits masqués, lignes orphelines, sauvegardes, journal unifié, suivi des migrations appliquées (§ 4, étape 3). *Analyse comparative du 25 oct. 2026 : le suivi des migrations est complété par le diff de schéma lisible par table et la détection du drift hors migration (E-06) ; le journal unifié est à exposer dans l'écran, avec le REX unifié (E-11).* |
| 6 · Écarts constatés avec le marché, 26 oct. 2026 | Quinze écarts relevés le 25 octobre 2026 en comparant Matrix aux catalogues de données du commerce (DataHub, OpenMetadata, Collibra, Atlan, Alation, Amundsen, Dataedo, SchemaSpy, Flyway, Soda, dbt). Détail ci-dessous ; les écarts déjà prévus renvoient au lot ou au document qui les porte. |

Le remplacement de Lucca (`docs/remplacement-lucca.md`) suit son propre calendrier : sa construction commence après la couche asynchrone de Cursus, en parallèle des lots 3 et 4 ; sa marche en parallèle attend les référentiels D01, D02, D05 et D14 du lot 4.

### Lot 6 : écarts constatés avec le marché (analyse comparative du 25 octobre 2026)

Matrix a été comparé, fonction par fonction, aux catalogues de données du commerce. Le niveau « marché » dit si la fonction est standard (présente dans tous les produits), avancée (présente dans quelques-uns) ou différenciante. L'état est celui du code au 25 octobre 2026. Effort : S (quelques jours), M (une à deux semaines), L (plus). Les écarts qui demandent une décision sont repris en § 7 (M-14 à M-16).

| N° | Priorité | Écart | Niveau marché | Effort | Ce qui existe | Ce qui manque | Déjà prévu |
|---|---|---|---|---|---|---|---|
| E-01 | Bloquant | **Source unique des référentiels.** Les saisies de l'écran Référentiels doivent alimenter `matrix.pays`, `sites`, `zones`, `filiales`, `organigramme` et leurs vues `pub_`. | standard | M | Écran Référentiels, `PUT /api/referentiels/:nom`, validation reprise des contraintes de `partage/10-matrix-referentiels.sql` ; tables et vues `pub_` créées par le socle. | Les saisies restent dans `/data/edition.json` : aucune écriture vers PostgreSQL (vérifié par recherche dans le code). Les outils qui lisent `matrix.pub_sites`, `pub_filiales`, `pub_zones` (D14, D15, D17, D21) ne voient pas ce que Matrix saisit. Écrire les référentiels dans le schéma `matrix` avec le rôle `matrix_app` (droit d'écriture à accorder sur ces seules tables) et garder `edition.json` comme repli hors serveur. | Lot 2 (référentiels tenus dans Matrix) et lot 4 (publication aux outils) : prévu, mais la synchronisation n'a jamais été écrite. *Fait le 29/10/2026 : `outils/referentiels-pg.mjs`, écriture dans le schéma `matrix` à chaque enregistrement, alignement au démarrage, écarts signalés (`README.md`).* |
| E-02 | Bloquant | **Authentification nominative** (Entra ID), rôles réels (lecture, responsable de domaine, administrateur), limitation des tentatives. | standard | M | Authentification HTTP Basic à mot de passe unique (`MATRIX_MOT_DE_PASSE`) ; l'identifiant saisi signe le journal ; matrice des rôles dans la maquette (Administration › Rôles & droits) ; jeton partagé pour les déclarations. | L'identifiant est déclaratif, non vérifié : le journal n'est pas fiable. Pas de rôle appliqué (toute personne connectée modifie tout), pas de limitation des tentatives. Brancher Entra ID (OpenID Connect), lire les rôles dans les groupes, bloquer après n échecs. | M-06 (fournisseur d'authentification) et § 5 (rôles proposés) : la question est posée depuis le 15/10/2026, sans réponse. |
| E-03 | P1 | **Tests automatisés et intégration continue.** | qualité | M | Rien : aucun test, aucun workflow (`.github` absent). Les vérifications du 24/10/2026 (sonde, registre des liens) ont été faites à la main. | `node --test` sur le collecteur (parseurs), `edition.mjs` (validation des référentiels), `sante.mjs` (règles) et la sonde sur un service `postgres:16` doté du socle ; workflow GitHub Actions qui rejoue les scripts de `infra/postgres/` et `droits.verifier()`. | `docs/architecture-postgres.md` § 10.1 prévoit l'intégration continue des quatre outils, pas celle de Matrix. *Fait le 30/10/2026 : 28 tests `node --test` (`test/`), workflow `.github/workflows/ci.yml` (image du socle démarrée, `scripts/ci-socle.sh`, tests avec base).* |
| E-04 | P1 | **Persistance applicative en base avec verrouillage** : catalogue, décisions, documentation, journal. | standard | L | Fichiers JSON (`/data/edition.json`, `catalogue.json`, `historique.json`, déclarations) écrits par lecture-modification-écriture, fichier temporaire puis renommage. Tables `matrix.liens`, `liens_journal`, référentiels et `correspondances` créées par le socle. | Pas de verrou : deux modifications simultanées se perdent. Les tables `applications`, `declarations`, `tables_catalogue`, `colonnes`, `doublons`, `decisions`, `historique_schemas`, `journal` du § 4 ne sont pas créées. Migrations de Matrix (migrateur du § 4.3 d'`architecture-postgres.md`, `DB_SCHEMA = 'matrix'`), puis bascule écran par écran, JSON en repli sans serveur. | § 4, tables du schéma `matrix` ; `architecture-postgres.md` § 11, dernier point. *Fait le 01/11/2026 (documentation, décisions, journal) : `partage/15-matrix-edition.sql` (`matrix.documentation`, `decisions_doublons`, `journal` en ajout seul) ; `outils/edition-pg.mjs` : une transaction par modification, ligne verrouillée, version contrôlée (une modification préparée sur une version dépassée est refusée, code 409, au lieu d'écraser la précédente), entrée de journal dans la même transaction ; reprise d'`edition.json` au premier démarrage, `edition.json` devenu copie locale et repli sans serveur. Le catalogue vient déjà de la lecture du serveur (E-14) ; l'historique des schémas reste dans `historique.json` (à basculer ensuite).* |
| E-05 | P2 | **Alertes de changement de schéma** (e-mail, Teams) et **analyse d'impact** : quels outils lisent la table modifiée. | avancé (DataHub Actions, OpenMetadata) | M | Historique des tables et colonnes ajoutées ou supprimées, consultable dans l'écran ; registre des liens (qui lit quelle vue `pub_`) ; usages écrans → tables. | Personne n'est prévenu : il faut ouvrir Matrix. À chaque événement de l'historique, calculer l'impact (vues `pub_` qui exposent la table, outils qui les lisent d'après `matrix.liens`, écrans d'après `usages.json`) et l'envoyer par e-mail ou Teams (webhook). Canal et destinataires : M-14. | Non. |
| E-06 | P2 | **Diff de schéma avant/après lisible par table** et **suivi des migrations appliquées** (drift hors migration). | avancé (Dataedo, Flyway drift) | M | Événements ajout/suppression de tables et de colonnes ; la sonde lit déjà l'empreinte de la structure ; § 11 liste les tables de migrations (`__drizzle_migrations`, `schema_migrations`) lisibles par `matrix_app`. | Un changement de type, de nullité ou de clé n'est pas vu ; pas de vue « avant / après » d'une table ; les migrations appliquées ne sont ni lues ni rapprochées de la structure : un `ALTER` passé hors migration (drift) est invisible. | Lot 5, « suivi des migrations appliquées » : prévu, annoté. *Fait le 31/10/2026 : différence détaillée (type, nullité, défaut, clé, unicités, clés étrangères) avec avant et après, onglet « Historique » de chaque table ; journal des migrations lu par la sonde, changement hors migration signalé (« Santé › Migrations »).* |
| E-07 | P2 | **Lignage colonne à colonne et graphe des flux générés automatiquement** depuis les vues `pub_`. | standard (DataHub, OpenMetadata) | M | Flux F01 à F27 saisis à la main dans `data/flux.json`, champ par champ ; la sonde lit les vues `pub_` et leurs lecteurs ; le registre des liens dit qui lit quoi. | Rien n'est déduit : un flux réel (vue `pub_` + lien autorisé) n'apparaît dans le graphe que si quelqu'un l'a saisi. Lire la définition des vues (`pg_rewrite` / `pg_get_viewdef`) pour relier chaque colonne publiée à sa colonne source, croiser avec `matrix.liens`, et marquer les flux saisis « confirmés » ou « non observés ». | Non. *Fait le 31/10/2026 : lignage lu sur le serveur (`pg_depend` + définition, `outils/lignage.mjs`), colonne publiée ← colonne source dans la fiche de chaque table ; flux saisis marqués observés ou non, flux observés non décrits listés. Le graphe des flux reste celui de `data/flux.json`.* |
| E-08 | P2 | **Glossaire métier** (termes, définitions, propriétaires, liaison aux colonnes) et **colonnes sensibles pilotées en base**. | standard | M | Domaines et descriptions par table ; responsable par table dans la fiche ; sensibilité des colonnes lue dans une liste `SENSITIVE` du code ; `droits.colonnes_sensibles` existe dans le socle. | Pas de glossaire (un terme défini une fois, relié aux colonnes qui le portent, avec un propriétaire) ; la sensibilité n'est pas lue depuis la base. Dépend de M-04 (qui documente). | `architecture-postgres.md` § 11, « à faire » : lire `SENSITIVE` dans `droits.colonnes_sensibles` ; annoté. Glossaire : non. |
| E-09 | P2 | **Qualité des données** : fraîcheur, taux de nulls, unicité, incidents. | standard (OpenMetadata, Soda, dbt tests) | L | Santé des **schémas** uniquement (structure : clés, index, lignes mortes, documentation) ; références orphelines entre outils (`data/references.json`). | Aucun test sur le contenu. Règles déclarées par table (dernière écriture attendue, colonnes non nulles, unicité, plage de valeurs), exécutées par la sonde avec `matrix_lecture` en nommant les colonnes (jamais `SELECT *`, § 11), résultats dans l'état de santé, incidents ouverts et clos. | Lot 5 (lignes orphelines) couvre une seule règle. |
| E-10 | P2 | **Workflow de demande d'accès** à une vue `pub_` par l'outil demandeur, notification, application automatique du `GRANT`. | avancé (Collibra, Atlan) | M | Registre `matrix.liens` avec le statut « demandé », saisi par la DSI dans l'écran ; `GRANT` appliqué par `partage/appliquer-liens.sh` toutes les 15 minutes. | L'outil demandeur ne peut pas demander lui-même (API avec son jeton) ; personne n'est notifié d'une demande ni d'une décision ; l'application reste un script hors Matrix (choix M-13 : Matrix n'a aucun droit d'administration). Garder ce choix ou laisser Matrix poser le droit : M-15. | M-13 (registre + application contrôlée). |
| E-11 | P2 | **Affichage de `journal_unifie` et `rex_unifie` ; écran pour `matrix.correspondances`.** | interne | S | Vues `matrix.journal_unifie` (`partage/95`) et `rex_unifie` (`partage/96`) créées ; table `matrix.correspondances` créée (`partage/10`), mentionnée dans l'écran Administration. | Aucun écran ne les lit : le journal unifié (D18), le REX (D22) et les correspondances d'identifiants (D01, D02, D14) ne se consultent qu'en SQL. | Lot 5 (journal unifié) ; lot 2 (correspondances) : prévus, l'écran manque. *Fait le 30/10/2026 : écrans « Journal unifié », « Retours d’expérience » et « Correspondances » (décisions comprises), `outils/consultation.mjs`, API `/api/journal`, `/api/rex`, `/api/correspondances`.* |
| E-12 | P3 | **Export** (CSV, dictionnaire de données PDF/HTML, diagrammes ER) et **API de lecture du catalogue**. | standard (SchemaSpy, Dataedo, dbt docs) | M | Copie dans le presse-papier (nom de table, décisions) ; page HTML monolithique ; `GET /api/referentiels/:nom` pour les référentiels seulement. | Pas d'export du catalogue, pas de dictionnaire imprimable, pas de diagramme ER par outil, pas d'API `GET /api/catalogue` que les outils ou un agent pourraient lire. | Non. *Fait le 31/10/2026 : `outils/export.mjs` ; menu « Exporter » de la Bibliothèque (CSV des tables et des colonnes, dictionnaire HTML imprimable, diagramme ER Mermaid, pour la sélection en cours) ; `GET /api/catalogue/tables[/:outil/:table]` et `GET /api/export/…`, structure seulement.* |
| E-13 | P3 | **Recherche plein texte** sur tables, colonnes, descriptions ; **popularité** des tables. | standard (Amundsen, Alation) | S | Recherche sur les noms de table et de colonne, filtres de la bibliothèque. | Les descriptions, commentaires et noms de domaine ne sont pas cherchés ; aucune mesure d'usage (`pg_stat_user_tables.seq_scan`, `idx_scan`, lue par la sonde) pour classer les tables les plus lues. | Non. *Fait le 31/10/2026 : `outils/recherche.mjs` (noms, colonnes, commentaires, descriptions, documentation, domaines, flux ; sans accents ; pertinence et raison) ; lectures lues par la sonde, tri « Plus lues » et bloc de l’accueil.* |
| E-14 | P3 | **Collecte robuste** : la sonde serveur comme source principale, à la place des parseurs par expressions régulières des migrations Drizzle et de `Function()` sur le code de Cursus. | robustesse | M | Collecteur par expressions régulières (`parseDrizzle`) et évaluation `Function()` de la déclaration `TABLES` de Cursus (`outils/collecteur.mjs`) ; sonde serveur et déclarations des outils, qui remplacent déjà le code quand elles existent. | Les parseurs restent la source par défaut et cassent au premier changement de format ; `Function()` exécute du code d'un autre dépôt. Inverser l'ordre (serveur, puis déclaration, puis code), réserver les parseurs au mode hors serveur, retirer `Function()`. | `declaration-des-tables.md` et § 8 quinquies vont dans ce sens, sans retirer les parseurs. *Fait le 31/10/2026 : `outils/litteral.mjs` remplace `Function()` ; priorité serveur, déclaration, code, embarqué ; migrations suivies jusqu’aux `ALTER COLUMN` et `RENAME COLUMN` (7 colonnes corrigées), instructions inconnues signalées ; colonnes fermées par le serveur marquées sensibles.* |
| E-15 | P3 | **IA** : rédaction assistée des descriptions avec validation du responsable, exposition du catalogue aux agents (MCP). | différenciant (Atlan, OpenMetadata MCP) | L | Rien. | Proposer une description à partir des colonnes, des commentaires et des usages, validée avant enregistrement (jamais écrite seule) ; serveur MCP en lecture seule sur le catalogue, les liens et la santé, derrière l'authentification de E-02. Opportunité à trancher : M-16. | Non. |

**Ordre proposé.** E-01 et E-02 avant toute ouverture de Matrix hors du service informatique ; E-03 en même temps, pour protéger la suite ; E-04 avec le lot 3 (le schéma `matrix` existe dès le serveur commun) ; E-05 à E-11 avec le lot 5 ; E-12 à E-15 ensuite.

## 7. Décisions et questions ouvertes

Décidé le 15 octobre 2026 (détail et citations dans `docs/decisions.md`) :
- **M-01, serveur PostgreSQL commun avec un schéma par outil : validé.** Le plan est dans `docs/architecture-postgres.md` et le socle dans `infra/postgres/`.
- **M-02, doublons : les 20 groupes sont tranchés** (options proposées retenues). La mise en œuvre est décrite dans `docs/convergence-des-donnees.md`.
- **M-03, remplacement de Lucca par Cursus : préparé, décision provisoire.** Tout est préparé comme si Cursus remplaçait Lucca (`docs/remplacement-lucca.md`) ; rien n'est retiré tant que ce n'est pas confirmé.

| | Question encore ouverte |
|---|---|
| M-03 | Confirmer le remplacement de Lucca. |
| M-04 | Qui documente les tables : le service informatique seul, ou un responsable par domaine (RH, QHSE, projets, documents) ? *Analyse comparative du 25 oct. 2026 : la réponse fixe aussi qui tient le glossaire métier et valide les descriptions proposées (E-08, E-15).* |
| M-05 | Autorisez-vous les modifications dans le code des quatre outils (une branche et une demande de fusion par outil, à valider avant toute fusion) ? Matrix seul ne suffit pas : la déclaration des tables, le passage à PostgreSQL et le remplacement de Lucca demandent des changements dans Keystone, Codex, Cursus et Vigie. |
| M-06 | Fournisseur d'authentification : même réponse que la question O-02 de Codex. *Analyse comparative du 25 oct. 2026 : devenu bloquant (E-02) ; l'identifiant déclaratif de l'authentification Basic rend le journal non fiable. Si la réponse tarde, Matrix peut partir sur OpenID Connect générique (Entra ID compatible) sans attendre O-02.* |
| M-14 | Alertes de changement de schéma (E-05) : par quel canal (e-mail, canal Teams par webhook) et à qui (service informatique seul, ou responsable de chaque outil qui lit la table modifiée) ? |
| M-15 | Demande d'accès à une vue `pub_` (E-10) : Matrix pose-t-il lui-même le `GRANT` dès l'autorisation (rôle d'administration limité aux vues `pub_`), ou garde-t-on le choix M-13 (Matrix sans droit d'administration, `appliquer-liens.sh` toutes les 15 minutes) en ajoutant seulement la demande par l'outil et la notification ? |
| M-16 | IA (E-15) : voulez-vous la rédaction assistée des descriptions (validée par le responsable avant enregistrement) et l'exposition du catalogue aux agents par un serveur MCP en lecture seule ? Avec quel fournisseur, et le catalogue (noms de tables, colonnes sensibles comprises) peut-il lui être transmis ? |
