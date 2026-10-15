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
- Même pile que Codex et Vigie : Next.js 16, Drizzle et PostgreSQL. Port 3300, déployé par Docker et Coolify.
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
| 2 · Décisions | Saisie des décisions sur les doublons dans Matrix ; tables de correspondance personnes, projets, sites ; publication aux outils. |
| 3 · Serveur commun | Serveur PostgreSQL à schéma par outil ; bascule de Keystone, Codex et Vigie ; migration de Cursus ; compte de lecture de Matrix. |
| 4 · Administration | Volumétrie, extraits masqués, lignes orphelines, sauvegardes, journal. |

## 7. Décisions et questions ouvertes

Décidé le 15 octobre 2026 (détail et citations dans `docs/decisions.md`) :
- **M-01, serveur PostgreSQL commun avec un schéma par outil : validé.** Le plan est dans `docs/architecture-postgres.md` et le socle dans `infra/postgres/`.
- **M-02, doublons : les 20 groupes sont tranchés** (options proposées retenues). La mise en œuvre est décrite dans `docs/convergence-des-donnees.md`.
- **M-03, remplacement de Lucca par Cursus : préparé, décision provisoire.** Tout est préparé comme si Cursus remplaçait Lucca (`docs/remplacement-lucca.md`) ; rien n'est retiré tant que ce n'est pas confirmé.

| | Question encore ouverte |
|---|---|
| M-03 | Confirmer le remplacement de Lucca. |
| M-04 | Qui documente les tables : le service informatique seul, ou un responsable par domaine (RH, QHSE, projets, documents) ? |
| M-05 | Autorisez-vous les modifications dans le code des quatre outils (une branche et une demande de fusion par outil, à valider avant toute fusion) ? Matrix seul ne suffit pas : la déclaration des tables, le passage à PostgreSQL et le remplacement de Lucca demandent des changements dans Keystone, Codex, Cursus et Vigie. |
| M-06 | Fournisseur d'authentification : même réponse que la question O-02 de Codex. |
