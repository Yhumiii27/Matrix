# Matrix

Outil du service informatique pour gérer les bases de données de la suite EPC2I (Keystone, Codex, Cursus, Vigie, Arche, Crucible). Il propose :
- une bibliothèque des tables ;
- un graphe des liens entre tables et entre logiciels ;
- la liste des doublons à trancher ;
- le suivi des changements de schéma ;
- une **sonde** qui lit elle-même le serveur PostgreSQL commun : tables, colonnes, clés, liens, commentaires, vues `pub_` et droits de chaque outil, reportés dans la bibliothèque et les graphes sans attendre de déclaration ;
- l'**état de santé** des tables et des liens (écran « Santé des données ») ;
- le **registre des liens entre outils** (écran « Liens entre outils ») : Matrix autorise ou refuse chaque lecture d'une vue `pub_` par un autre outil, et `infra/postgres/partage/90-droits.sql` l'applique.

## À lire

| Fichier | Contenu |
|---|---|
| `docs/proposition.md` | La proposition : constats, écrans, architecture, feuille de route, questions ouvertes. |
| `docs/doublons-a-trancher.md` | Les 20 groupes de tables en double, avec les options et celle qui est proposée. |
| `docs/declaration-des-tables.md` | Comment une table créée dans un outil arrive dans la bibliothèque de Matrix. |
| `docs/architecture-postgres.md` § 8 quinquies | Sonde, état de santé et registre des liens (Matrix « dataverse »). |
| `maquette/matrix.html` | Maquette navigable, à ouvrir dans un navigateur (données réelles des quatre dépôts). |

## Organisation

```
data/catalogue.json        schéma des 4 bases (généré par le collecteur)
data/historique.json       tables et colonnes ajoutées ou supprimées (généré)
data/flux.json             flux entre logiciels, systèmes externes, points d'attention (saisi)
data/usages.json           écrans de chaque outil et tables lues ou écrites (saisi)
data/doublons.json         groupes de doublons et options (saisi)
data/referentiels.json     sites, organigramme, pays de départ (D14, D15, D17)
data/declarations/         schémas lus par la sonde (origine « serveur ») ou déclarés par les outils (/data/declarations en production)
data/references.json       références entre outils contrôlées par la sonde (valeurs orphelines)
data/sante.json            état de santé calculé à chaque lecture du serveur commun (généré ; /data/sante.json en production)
integration/declarer-schema.mjs   module à ajouter dans chaque outil
serveur.mjs                       serveur de Matrix : la page, les API, la lecture périodique du serveur commun
outils/sonde.mjs                  lecture du serveur commun (rôle matrix_app) et registre des liens (matrix.liens)
outils/sante.mjs                  règles et calcul de l'état de santé des tables et des liens
outils/collecteur.mjs             lit les schémas (serveur commun, puis déclaration de l'outil, puis code source lu sans rien exécuter) et compare
outils/recherche.mjs              recherche plein texte du catalogue (recopiée dans la page)
outils/litteral.mjs               lit un objet littéral JavaScript sans l'exécuter (déclaration TABLES de Cursus)
outils/edition.mjs                documentation, décisions, référentiels, journal (/data/edition.json)
outils/referentiels-pg.mjs        référentiels écrits dans le schéma matrix du serveur commun (pays, zones, filiales, sites, organigramme)
outils/consultation.mjs           journal unifié, REX unifié et correspondances d'identifiants lus sur le serveur commun
outils/page.mjs                   construit la page à partir de maquette/source.html et des données
outils/construire-maquette.mjs    assemble maquette/matrix.html (version publiée comme artefact)
outils/generer-liste-doublons.mjs génère docs/doublons-a-trancher.md
maquette/source.html              source de la maquette
```

## Commandes

Node 22 ou plus récent. Deux dépendances (`cytoscape` pour le graphe, `pg` pour la sonde du serveur commun) : `npm install`.

```bash
npm start                                # serveur Matrix sur http://localhost:3000
node outils/collecteur.mjs ..            # relire les schémas dans les dépôts voisins et comparer
node outils/construire-maquette.mjs      # reconstruire maquette/matrix.html
node outils/generer-liste-doublons.mjs   # régénérer docs/doublons-a-trancher.md
npm test                                 # tests (node --test, dossier test/) ; MATRIX_TEST_DATABASE_URL=postgres://matrix_app:…@hôte/epc2i
                                         # ajoute ceux du serveur commun (base d'essai seulement)
bash scripts/ci-socle.sh                 # rejoue le socle sur un PostgreSQL d'essai et contrôle les droits (PGHOST, mots de passe)
```

**Intégration continue** (`.github/workflows/ci.yml`, à chaque demande de fusion et sur `main`) :
- job `tests` : `npm test` sans base, puis contrôle que `maquette/matrix.html` est à jour (`npm run maquette`) ;
- job `socle` : l'image `infra/postgres` est construite et démarrée comme en production (`init/` joué au premier démarrage). Ensuite :
  - `scripts/ci-socle.sh` : `10` et `12` en `matrix_app`, `appliquer-liens.sh` deux fois (le second passage ne doit rien appliquer), `96`, `droits.verifier()` sans erreur, `verifier-droits.sql`, rejeu du socle ;
  - les tests qui demandent une base.

Pour relire les schémas, les dépôts `keystone/`, `codex/`, `cursus/`, `vigie/`, `arche/` et `crucible/` doivent être clonés à côté de `Matrix/` (ou dans le dossier passé en argument).

## Mise en ligne (Docker, Coolify)

Le `Dockerfile` à la racine installe la dépendance et lance `node serveur.mjs`. Réglages à donner à l'hébergeur :

| Réglage | Valeur |
| --- | --- |
| Type de construction (Build Pack) | `Dockerfile` |
| Branche | celle qui contient le `Dockerfile` (`main` une fois la demande de fusion acceptée) |
| Port interne (Ports Exposes) | `3000` |
| Volume persistant | `/data` (catalogue à jour, historique des schémas, déclarations reçues) |
| Variable d'environnement | `MATRIX_TOKEN` : jeton partagé avec les quatre outils ; sans lui, les déclarations sont refusées |
| Variable d'environnement | `MATRIX_MOT_DE_PASSE` : mot de passe d'accès à Matrix (identifiant libre, enregistré dans le journal). Sans lui, la consultation est ouverte et les modifications sont refusées |
| Variable d'environnement | `MATRIX_DATABASE_URL` : `postgres://matrix_app:<MATRIX_APP_PASSWORD>@epc2i-postgres:5432/epc2i`. Active la sonde : lecture du serveur commun au démarrage puis toutes les heures, état de santé, registre des liens. Sans elle, Matrix vit des déclarations et du code des dépôts |
| Variable d'environnement | `MATRIX_GESTION_DATABASE_URL` : `postgres://matrix_gestion:<MATRIX_GESTION_PASSWORD>@epc2i-postgres:5432/epc2i`. Matrix applique lui-même les publications (vues `pub_` des outils) et les décisions sur les liens, tout de suite (décision M-18). Sans elle, les publications restent en brouillon et les liens attendent `appliquer-liens.sh` |
| Variable d'environnement | `MATRIX_SYNCHRO_MINUTES` (facultative) : intervalle entre deux lectures, 60 par défaut ; 0 : au démarrage et à la demande seulement |
| Contrôle de santé | intégré à l'image (`GET /api/sante`) ; rien à configurer |

- Le catalogue embarqué dans l'image sert de point de départ. À chaque déploiement, il est comparé au catalogue du volume : les écarts vont dans l'historique.
- Avec `MATRIX_MOT_DE_PASSE`, le navigateur demande un identifiant et ce mot de passe ; l'identifiant saisi signe les modifications dans le journal. `/api/sante` et la réception des déclarations (`POST /api/declarations`, jeton) restent accessibles sans mot de passe.
- Ce que le service informatique saisit dans Matrix (documentation des tables, décisions, référentiels, journal) est enregistré dans `/data/edition.json`.
- **Référentiels sur le serveur commun** (écart E-01, `docs/proposition.md` § 6). Avec `MATRIX_DATABASE_URL`, chaque enregistrement de l'écran Référentiels est d'abord écrit dans les tables `matrix.pays`, `zones`, `filiales`, `sites` et `organigramme` (rôle `matrix_app`, une transaction par enregistrement), que les outils lisent par les vues `matrix.pub_*`. Une contrainte du schéma qui refuse la liste annule tout : rien n'est écrit, ni en base ni dans `edition.json`. Une ligne retirée de la liste est désactivée en base (`actif = false`), jamais supprimée : les outils gardent son code. Au démarrage, une liste déjà saisie dans Matrix est réécrite sur le serveur si elle en diffère (Matrix fait foi : D14, D15, D17, D21) ; une liste jamais saisie est reprise du serveur (amorçage de `partage/10-matrix-referentiels.sql`). Ensuite, à chaque lecture du serveur, un écart (modification faite en SQL, par exemple) est seulement signalé dans `/api/etat` et `/api/sante`, jusqu'au prochain démarrage ou au prochain enregistrement. Sans `MATRIX_DATABASE_URL`, les référentiels restent dans `edition.json` et n'atteignent pas les outils.
- **Journal unifié, retours d'expérience, correspondances** (écart E-11). Avec `MATRIX_DATABASE_URL`, trois écrans lisent ce que le serveur commun réunit pour Matrix :
  - « Journal unifié » : `matrix.journal_unifie` (D18), du plus récent au plus ancien, par pages de 100. Filtres : outil, recherche, code projet, période en jours de Paris.
  - « Retours d'expérience » : `matrix.rex_unifie` (D22), REX des projets (Keystone) et des CAPEX (Arche). Filtres : outil, catégorie, projet ou CAPEX, recherche.
  - « Correspondances » : `matrix.correspondances`, à décider : valider (clé commune modifiable), rejeter, à créer, abandonner, retirer. Un rejet, un abandon ou un retrait est motivé ; les contraintes de la table contrôlent la forme de la clé.
  - API : `GET /api/journal`, `GET /api/rex`, `GET /api/correspondances`, `POST /api/correspondances`.
- **Sources du catalogue** (écart E-14). Par outil, dans cet ordre :
  1. la lecture du serveur commun par la sonde (`declarations/<outil>.serveur.json`) ;
  2. la déclaration envoyée par l'outil (`declarations/<outil>.json`, qui ne peut jamais se faire passer pour le serveur) ;
  3. le code des dépôts voisins, lu sans rien exécuter : expressions régulières pour les migrations Drizzle, lecteur de données littérales pour `TABLES` de Cursus. Une instruction de migration non reconnue est signalée dans l'écran Administration ;
  4. le catalogue embarqué.
  Les colonnes que le serveur ferme à Matrix (`droits.colonnes_sensibles`) sont marquées sensibles.
- **Historique des schémas et migrations** (écart E-06). À chaque collecte, l'historique (`data/historique.json`) détaille chaque changement avec avant et après :
  - colonne ajoutée, retirée, ou dont le type, la nullité ou le défaut change ;
  - clé primaire, unicité ou clé étrangère ajoutée ou retirée ;
  - quand la source d'un outil change (code → serveur), un seul événement « source changée », sans comparer les colonnes, dont l'écriture diffère.
  La fiche de chaque table a un onglet « Historique ». La sonde lit aussi le journal des migrations de chaque outil (`__drizzle_migrations` ou `schema_migrations` de son schéma). Une structure qui change sans nouvelle migration appliquée est signalée (« changement hors migration », état attention dans « Santé › Migrations ») jusqu'à la migration suivante.
- **Lignage et flux observés** (écart E-07). Pour chaque vue `pub_`, la sonde lit les colonnes dont elle dépend (`pg_depend`) et sa définition (`pg_get_viewdef`). `outils/lignage.mjs` en tire, pour chaque colonne publiée, sa ou ses colonnes sources : telle quelle, transformée, ou calculée. Une source n'est gardée que si `pg_depend` la confirme. La fiche d'une table montre, dans l'onglet « Liens », les vues qui la publient, colonne par colonne. L'écran « Flux » marque chaque flux saisi « observé » (un lien appliqué lui correspond) ou « non observé », et liste les flux observés sur le serveur qu'aucun flux saisi ne décrit, hors lectures de Matrix.
- **Recherche et tables les plus lues** (écart E-13). La recherche de l'en-tête et de la Bibliothèque porte sur le nom des tables, leurs colonnes et commentaires de colonnes, leur description, la documentation saisie dans Matrix, leur domaine et les flux qui les touchent. Elle ignore accents et majuscules. Chaque mot doit être trouvé ; `"…"` cherche une expression entière. Les résultats sont triés par pertinence, avec la raison sous chaque table ; les flux et doublons qui correspondent sont proposés en plus. Avec le serveur commun, la Bibliothèque montre les lectures de chaque table (parcours séquentiels et par index depuis le dernier redémarrage du serveur), avec un tri « Plus lues » ; l'accueil liste les tables les plus lues.
- **Exports et API de lecture du catalogue** (écart E-12). Le menu « Exporter » de la Bibliothèque exporte la sélection en cours (outil, domaine, recherche). Seule la structure est exportée, jamais les données des tables :
  - tables ou colonnes en CSV (séparateur `;`, UTF-8 avec BOM : s'ouvre tel quel dans Excel ; une cellule commençant par `=`, `+`, `-` ou `@` est neutralisée) ;
  - dictionnaire de données en HTML autonome, imprimable en PDF depuis le navigateur ;
  - diagramme entité-relation Mermaid (`erDiagram`), lisible par GitHub, les wikis ou mermaid.live.
  API, derrière le même mot de passe que l'écran ; paramètres `outil`, `domaine` et `q` (même recherche que la page) :
  - `GET /api/catalogue/tables` : liste des tables ;
  - `GET /api/catalogue/tables/:outil/:table` : fiche complète (colonnes, liens, vues `pub_` qui la publient, état de santé) ;
  - `GET /api/export/tables.csv`, `colonnes.csv`, `dictionnaire.html`, `schema.mmd`.
- **Registre des liens.** Une décision prise dans l'écran « Liens entre outils » est écrite dans `matrix.liens` (journalisée dans `matrix.liens_journal`). Avec `MATRIX_GESTION_DATABASE_URL`, Matrix l'applique tout de suite sur une vue qu'il a reprise (M-18) : droit posé pour un lien autorisé, retiré pour un lien refusé. Sinon, ou pour une vue pas encore reprise, elle prend effet au passage suivant de `infra/postgres/partage/90-droits.sql`, rejoué dans les 15 minutes par la tâche planifiée `infra/postgres/partage/appliquer-liens.sh`, qui reste le rattrapage et le contrôle.
- **Écritures entre outils** (décision M-18, lot P4). Un outil écrit chez un autre par une fonction `pub_<verbe>_<objet>` que le propriétaire fournit dans son schéma (`SECURITY DEFINER`, `search_path` fixé, `REVOKE EXECUTE … FROM PUBLIC`) : elle applique ses règles et son journal. Le droit de l'exécuter est un lien du registre, de nature « écriture » (`matrix.liens.nature = 'execution'`), demandé et décidé dans « Liens entre outils » comme une lecture. Matrix l'applique tout de suite par `droits.accorder_execution` (fonction du socle, qui ne pose le droit que pour un lien autorisé et une fonction bien protégée) : `matrix_gestion` ne reçoit jamais le droit d'exécuter une fonction d'un outil. `90-droits.sql` et `appliquer-liens.sh` rattrapent et retirent les droits hors registre ; `droits.verifier()` signale une fonction `pub_` exécutable par tous (erreur) ou mal protégée (attention).
- **Publications des outils** (décision M-18, lot P2, `outils/publications.mjs`). Matrix définit les vues `pub_` des outils, ce que chacun publie, et les applique avec le rôle `matrix_gestion` :
  - un brouillon s'enregistre dans `matrix.publications` : mode « colonnes » (une table de l'outil, des colonnes choisies et leur nom publié, un filtre) ou mode « sql » (requête complète, pour les jointures et les agrégats) ;
  - l'application se fait en une transaction : `CREATE OR REPLACE VIEW` (PostgreSQL refuse de retirer, renommer ou changer de type une colonne publiée ; un changement incompatible passe par une vue `…_v2`), contrôles du socle (`droits.verifier()` : aucune colonne sensible, aucune table d'un autre schéma), droits des lecteurs d'après le registre des liens, journal. Un échec annule tout et la publication passe à l'état « erreur » avec le message ;
  - une publication se retire (vue supprimée, ligne gardée au registre) seulement quand aucun lien autorisé ne la lit ;
  - API : `GET /api/publications`, `GET /api/publications/:vue`, `PUT /api/publications/:vue` (brouillon), `POST /api/publications/:vue/appliquer`, `POST /api/publications/:vue/retirer` (`{ motif }`).
  - Écran « Publications » (lot P3) : liste par outil et par état (appliquée, brouillon, erreur, retirée) avec colonnes et lecteurs ; fiche d'une publication : choix de la table et des colonnes (nom publié, colonnes sensibles grisées, colonnes déjà publiées verrouillées) ou requête SQL, description, boutons « Enregistrer le brouillon », « Appliquer sur le serveur » et « Retirer », contrat publié, lecteurs, journal ; « Nouvelle publication » ; vues pas encore reprises. Une décision dans « Liens entre outils » indique si le droit a été posé tout de suite.
- Si vous préférez l'authentification HTTP de Coolify à `MATRIX_MOT_DE_PASSE`, les outils déclarent leurs tables avec `MATRIX_URL=https://identifiant:mot-de-passe@matrix.votre-domaine` ; le jeton part dans l'en-tête `X-Matrix-Token`.
