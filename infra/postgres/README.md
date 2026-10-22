# Serveur PostgreSQL commun EPC2I

Ce dossier contient le socle du serveur PostgreSQL commun aux quatre outils de la suite (décision M-01 du 15 octobre 2026) : une base `epc2i`, un schéma par outil, un rôle de connexion par outil. Le plan de migration des outils est dans `docs/architecture-postgres.md`.

| Fichier | Rôle |
|---|---|
| `docker-compose.yml` | PostgreSQL 18 (proposition, question P-01), volumes de données et de sauvegardes persistants. Utilisable dans Coolify et en local. |
| `Dockerfile` | Image officielle PostgreSQL 18 avec les fichiers du socle copiés dedans (`init/`, `sauvegarde/`, `partage/`, `verifier-droits.sql`). |
| `.env.example` | Les variables à fournir (mots de passe). |
| `init/01-base-et-roles.sql` | Base `epc2i` et rôles. |
| `init/02-schemas.sql` | Schémas `keystone`, `codex`, `cursus`, `vigie`, `matrix`, propriétaires et paramètres de session ; schéma `extensions` et `pg_trgm` (pour Codex). |
| `init/03-droits.sql` | Droits de Matrix, schéma `droits`, protection des colonnes sensibles (déclencheur d'événement). |
| `verifier-droits.sql` | Contrôle des droits en conditions réelles : 114 cas sur un socle neuf, convention de partage, tables fermées et schéma `extensions` compris, plus 2 cas par colonne ou table de santé de Vigie une fois Vigie migré (144 au total au 22/10/2026) ; rien n'est conservé. |
| `partage/` | Vues `pub_*` publiées par chaque outil, référentiels de Matrix, droits des lecteurs (`partage/README.md`). |
| `sauvegarde/sauvegarder.sh` | Sauvegarde `pg_dump` par schéma, avec rétention. |
| `correctifs/` | Correctifs essayés le 15/10/2026 dans des copies des outils (`correctifs/README.md`). Ceux de Keystone et de Vigie sont obsolètes (remplacés par les branches des outils, décision P-02), celui de Codex est fusionné ; reste le prototype de Cursus. |

## Ce que créent les scripts

| Objet | Détail |
|---|---|
| Base | `epc2i`, UTF-8, tri `C`, classes de caractères `C.UTF-8`, fuseau des sessions `UTC`, format de date `ISO, MDY`. Ce sont les réglages de PGlite : les outils trient et lisent les dates comme aujourd'hui. |
| Schémas | `keystone`, `codex`, `cursus`, `vigie`, `matrix` (un propriétaire chacun) ; `droits` (propriétaire : le superutilisateur) ; `extensions` (propriétaire : le superutilisateur ; extension `pg_trgm`, index de recherche de Codex ; `USAGE` à `codex_app` seul, fermé aux autres outils) ; `public` fermé à tous. |
| Rôles de connexion | `keystone_app`, `codex_app`, `cursus_app`, `vigie_app` : propriétaire de son seul schéma, `search_path` = son schéma, aucun droit `CREATE` sur la base. Dans le schéma d'un autre outil, seulement `USAGE` et `SELECT` sur ses vues `pub_`, posés par `partage/90-droits.sql` (convention de partage). `matrix_app` : propriétaire de `matrix`, membre de `matrix_lecture`. `epc2i_sauvegarde` : membre de `pg_read_all_data`. |
| Rôles de groupe | `matrix_lecture` : `SELECT` sur les quatre schémas des outils, sauf les colonnes sensibles. `matrix_admin` : tous les droits sur les cinq schémas, attribué nominativement, requêtes journalisées. |
| Fonctions | `droits.appliquer_droits()`, `droits.verifier()`, `droits.declarer_admin(nom)`. |
| Tables du schéma `droits` | `colonnes_sensibles` (liste des colonnes sensibles), `relations_protegees` (tables déjà traitées), `partage_lecteurs` (lecteurs attendus des vues `pub_`, écrits par `partage/90-droits.sql`). |
| Déclencheurs | `droits_ddl` (fin de chaque `CREATE`, `ALTER`, `GRANT`, `REVOKE`) et `droits_suppression` (`DROP`). |

Les colonnes sensibles sont listées dans `droits.colonnes_sensibles`. La convention du 15 octobre y figure : `cursus.employes` (`visite`, `passeport_numero`, `passeport_expire`, `naissance`, `reprise_motif`), `cursus.vaccinations` (`v`, `date`), `cursus.visas` (`type`, `obtenu`, `expire`), `cursus.entretiens` (`cr`), `vigie.events` (`injury`, `lost_days`). Le 18/10/2026, la même convention (« aucune donnée de santé ») est appliquée aux colonnes réelles de Vigie : `vigie.events` (`cpam_declared_on`, `lesion_nature`, `lesion_site`, `care_given`, `reserves_on`, `cpam_waived_at`, `cpam_waived_by_id`, `cpam_waiver_reason`, d'après `HEALTH_LABELS` de Vigie), `vigie.change_log` (`details`, `reason`, qui en recopient les valeurs), et trois tables fermées en entier par une entrée `*` : `vigie.benign_accidents` (registre des accidents bénins), `vigie.access_log` (journal des consultations) et `vigie.attachments` (pièces médicales). Trois ajouts sont proposés et en attente de confirmation (question P-04 du plan) : `cursus.journal` (`payload`, `message`) et `cursus.demandes_collab` (`label`), qui recopient des données de santé.

Pourquoi un déclencheur d'événement : `ALTER DEFAULT PRIVILEGES` accorde `SELECT` sur une table entière, sans pouvoir exclure une colonne. Le déclencheur `droits_ddl` s'exécute à la fin de chaque commande qui crée ou modifie une table, dans la transaction de la migration. Il remplace le `SELECT` de table par un `SELECT` colonne par colonne, sans les colonnes sensibles. La table n'est visible des autres sessions qu'au `COMMIT` : à aucun moment `matrix_lecture` ne lit une colonne sensible. Le détail des règles est en tête de `init/03-droits.sql` et au § 3 du plan.

## Mise en service dans Coolify

1. **Créer la ressource.** Nouvelle ressource « Docker Compose » depuis le dépôt Matrix. Répertoire de base : `/infra/postgres`. Fichier compose : `docker-compose.yml`. Les fichiers du socle sont copiés dans l'image à la construction (`Dockerfile`), pas montés : Coolify ne fournit pas au conteneur les fichiers du dépôt montés par chemin relatif (constat du 19/10/2026 : `verifier-droits.sql` y apparaissait comme un dossier vide). Dans le conteneur : `/docker-entrypoint-initdb.d/`, `/opt/epc2i/sauvegarde/`, `/opt/epc2i/partage/` et `/opt/epc2i/verifier-droits.sql`. Une modification de ces fichiers demande un redéploiement (nouvelle image) ; la base n'est pas touchée.
2. **Saisir les variables** de `.env.example` : `POSTGRES_PASSWORD`, `KEYSTONE_APP_PASSWORD`, `CODEX_APP_PASSWORD`, `CURSUS_APP_PASSWORD`, `VIGIE_APP_PASSWORD`, `MATRIX_APP_PASSWORD`, `EPC2I_SAUVEGARDE_PASSWORD`. Un mot de passe par variable, généré par `openssl rand -base64 30 | tr -d '/+=' | cut -c1-32`. Ces caractères n'ont pas besoin d'être encodés dans une URL. Ce sont des variables d'exécution : ne cochez pas leur disponibilité au build.
3. **Réseau.** Les outils déployés sur le même serveur Coolify joignent la base par le réseau Docker. Activez l'option de connexion au réseau prédéfini de Coolify sur cette ressource et sur chaque outil. Le compose rattache le service au réseau `coolify` avec l'alias fixe `epc2i-postgres` : c'est le nom d'hôte à mettre dans `DATABASE_URL` (`postgres://<outil>_app:…@epc2i-postgres:5432/epc2i`). Le nom du conteneur affiché par Coolify (`postgres-<identifiant>-<date du déploiement>`) change à chaque redéploiement : ne l'utilisez pas. Le port 5432 n'est publié que sur `127.0.0.1` de l'hôte, pour l'administration par tunnel SSH. Les libellés exacts dépendent de la version de Coolify : à vérifier à la première mise en service (question P-09).
4. **Déployer.** Au premier démarrage, le volume est vide : l'image exécute les trois scripts de `init/`. Le journal du conteneur doit afficher « Étape 3 terminée », un tableau d'écarts vide, puis « PostgreSQL init process complete ». En cas d'erreur, le conteneur s'arrête : corrigez la cause (souvent une variable vide), supprimez le volume de données et redéployez. Dans Coolify, le volume porte un nom préfixé par la ressource : prenez celui que montre l'onglet des volumes de la ressource (son nom se termine par `epc2i_pgdata`). En local, Docker le nomme `epc2i-postgres_epc2i_pgdata` (nom de projet `epc2i-postgres` du compose) ; `docker compose down -v` le supprime avec celui des sauvegardes.
5. **Vérifier les droits.** Dans le terminal du conteneur :
   ```bash
   psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /opt/epc2i/verifier-droits.sql
   ```
   Résultat attendu sur un socle neuf : « Tous les cas sont conformes : 114 cas (dont 0 sur les tables de Vigie). » Une fois Vigie migré, 30 cas de plus (144).
6. **Programmer la sauvegarde.** Tâche planifiée Coolify sur le conteneur `postgres`, commande `sh /opt/epc2i/sauvegarde/sauvegarder.sh`, par exemple chaque nuit à 2 h 15 (`15 2 * * *`). Copiez ensuite le volume des sauvegardes (`/sauvegardes` dans le conteneur ; son nom se termine par `epc2i_sauvegardes`) hors du serveur (voir « Sauvegarde et restauration »).
7. **Déclarer les administrateurs nominatifs** (voir plus bas).
8. **Raccorder les outils** un par un, dans l'ordre du plan (§ 10), avec leur `DATABASE_URL`.
9. **Poser le partage** après la bascule de chaque outil, dans cet ordre : migration de l'outil (elle crée ses colonnes prérequises et ses vues `pub_`), référentiels de Matrix (`partage/10-matrix-referentiels.sql`, une fois), fichier de l'outil (`20` à `50` ; `60` attend le module ECR / ECO de Vigie), puis `partage/90-droits.sql` et `partage/95-matrix-journal-unifie.sql`. Ordre, rôles et commandes : `partage/README.md`. `droits.verifier()` doit rester sans erreur après chaque passage.

## Sur un poste local

Avec Docker :

```bash
cd infra/postgres
cp .env.example .env          # puis remplir chaque mot de passe ; .env n'est jamais versionné
docker network create coolify   # une fois ; autre nom : EPC2I_DOCKER_NETWORK
docker compose up -d
docker compose logs -f postgres   # attendre « PostgreSQL init process complete »
psql "postgres://postgres@127.0.0.1:5432/postgres" -f verifier-droits.sql
```

Le port publié se change avec `EPC2I_PG_PORT` si 5432 est pris. `docker compose down -v` supprime la base et les sauvegardes locales.

Sans Docker, sur un PostgreSQL 18 déjà installé (avec les modules contrib, pour `pg_trgm`) : exportez les variables de `.env.example`, puis lancez les trois scripts dans l'ordre avec psql 15 ou plus, en superutilisateur :

```bash
set -a; . ./.env; set +a
for f in init/*.sql; do psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -f "$f" || break; done
```

Sur macOS, la locale `C.UTF-8` peut manquer : le script crée alors la base avec `LC_CTYPE = C` et l'annonce. Les tris restent ceux de PGlite ; seules les fonctions `upper()` et `lower()` ignorent les lettres accentuées.

Les outils n'ont pas besoin de ce serveur pour le développement courant : sans `DATABASE_URL`, chacun garde sa base embarquée (PGlite, ou SQLite pour Cursus).

## Variables d'environnement des outils

Chaque outil reçoit une seule nouvelle variable obligatoire, `DATABASE_URL`, avec son propre rôle. Absente ou vide, l'outil reste sur sa base embarquée.

| Outil | `DATABASE_URL` | Autres variables |
|---|---|---|
| Keystone | `postgres://keystone_app:<KEYSTONE_APP_PASSWORD>@<hôte>:5432/epc2i` | `KEYSTONE_SEED` (`demo` en bêta, `production` pour les seuls référentiels ; obligatoire pour remplir le schéma vide au premier `npm run db:migrate`, qui migre au déploiement) ; `DATABASE_POOL_MAX` (10 par défaut) ; `KEYSTONE_DATA_DIR` reste nécessaire pour les fichiers déposés et la base PGlite de `next build`. |
| Codex | `postgres://codex_app:<CODEX_APP_PASSWORD>@<hôte>:5432/epc2i` | `CODEX_SEED_DEMO=1` (jeu de démonstration, bêta seulement) ; `CODEX_DB_POOL` (10 par défaut) ; `CODEX_DATA_DIR` reste nécessaire pour les fichiers déposés. |
| Cursus | `postgres://cursus_app:<CURSUS_APP_PASSWORD>@<hôte>:5432/epc2i` | `CURSUS_DEMO=0` en production ; `CURSUS_SECRET` (clé des sessions) ; `CURSUS_PG_POOL` ; `CURSUS_DB` ne sert plus qu'au repli SQLite. |
| Vigie | `postgres://vigie_app:<VIGIE_APP_PASSWORD>@<hôte>:5432/epc2i` | `VIGIE_DEMO=1` (démonstration, bêta seulement : jeu de données chargé une fois, sélecteur de rôle ; sans elle, Vigie démarre vide sur « Créer le premier site ») ; `VIGIE_UPLOAD_DIR` et `VIGIE_BACKUP_DIR` restent nécessaires (pièces jointes, sauvegardes). |
| Matrix | `postgres://matrix_app:<MATRIX_APP_PASSWORD>@<hôte>:5432/epc2i` | Lecture des outils par `matrix_lecture`, écriture dans `matrix`. |

Règles communes :

- `DATABASE_URL` est une variable d'exécution. Elle ne doit jamais être disponible au build (`next build` ouvre la base de Keystone et de Vigie) ni écrite dans une image.
- Les applications Mac fixent `DATABASE_URL` à vide : elles restent sur leur base locale, même si un fichier `.env.local` du projet en définit une.
- Un mot de passe qui contient `@`, `:`, `/` ou `%` doit être encodé dans l'URL (`encodeURIComponent`). Les mots de passe générés comme indiqué plus haut n'en contiennent pas.
- TLS : la base n'est jointe que par le réseau Docker interne, sans TLS. Si un outil doit la joindre par un autre réseau, il faut un certificat ; le pilote `pg` 8.x traite `sslmode=require` comme une vérification complète du certificat (question P-06).

## Rejouer le socle

Les scripts de `init/` ne s'exécutent automatiquement qu'une fois, sur un volume vide. Ils sont rejouables : on les relance après une modification de ces fichiers (redéployer d'abord, pour que l'image les contienne), pour réparer des droits, ou pour changer un mot de passe. Dans le conteneur, les variables d'environnement sont déjà présentes :

```bash
docker compose exec postgres sh -c 'for f in /docker-entrypoint-initdb.d/*.sql; do psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$f" || exit 1; done'
```

Un rejeu crée ce qui manque, remet propriétaires, attributs, appartenances, paramètres et mots de passe aux valeurs attendues, recrée les fonctions et les déclencheurs dans une seule transaction, puis contrôle toutes les relations existantes. Il ne touche pas aux données des outils. Il n'ajoute pas de nouveau les colonnes « proposées » qu'un administrateur aurait retirées ; il remet en revanche toujours les colonnes de la convention. N'ajoutez jamais `-e` ni `-a` à psql : les mots de passe s'afficheraient.

**Changer un mot de passe :** modifier la variable (dans Coolify ou `.env`), redémarrer le conteneur pour qu'il la voie, rejouer `01-base-et-roles.sql`, puis mettre à jour `DATABASE_URL` de l'outil et le redémarrer.

## Administrateurs nominatifs

`matrix_admin` n'a pas de connexion propre. Chaque administrateur a son rôle, à son nom, membre de `matrix_admin`, avec toutes ses requêtes journalisées. En superutilisateur, sur `epc2i` :

```sql
CALL droits.declarer_admin('prenom_nom');
\password prenom_nom
```

`declarer_admin` crée le rôle s'il n'existe pas, l'ajoute à `matrix_admin` et pose `log_statement = 'all'`, que seul un superutilisateur peut retirer. L'administrateur lit et écrit dans les cinq schémas, colonnes sensibles comprises. Pour une opération de structure exceptionnelle, il prend le rôle de l'outil (`SET ROLE vigie_app;`), ce qui est aussi journalisé. Pour retirer un administrateur : `REVOKE matrix_admin FROM prenom_nom; DROP ROLE prenom_nom;`.

Le superutilisateur `postgres` ne sert qu'à l'administration du socle et ne doit être utilisé par aucun outil.

## Journaux

Les journaux du serveur sont écrits dans le volume de données, un fichier par jour : `$PGDATA/log/postgresql-AAAA-MM-JJ.log`. Coolify n'affiche plus que les messages du démarrage. Pour les lire :

```bash
docker compose exec postgres sh -c 'tail -f "$PGDATA/log/postgresql-$(date +%F).log"'
```

Chaque ligne porte l'heure, le rôle, la base et le nom de l'application (`%u@%d/%a`). Les requêtes des administrateurs y figurent en entier, avec les valeurs saisies : ces fichiers sont aussi sensibles que la base. Leur purge n'est pas automatique (question P-08).

## Sauvegarde et restauration

**Contenu d'une sauvegarde.** `sauvegarde/sauvegarder.sh` se connecte en `epc2i_sauvegarde` et écrit, dans un dossier daté :

| Fichier | Contenu |
|---|---|
| `keystone.dump`, `codex.dump`, `cursus.dump`, `vigie.dump`, `matrix.dump` | `pg_dump --format=custom --schema=<schéma>` : structure, données, séquences, droits. |
| `droits.dump` | La liste des colonnes sensibles et les fonctions du socle. |
| `roles.sql` | Rôles, appartenances et paramètres, sans les mots de passe. |
| `SHA256SUMS` | Empreintes, pour contrôler une copie. |

Les dossiers de plus de `EPC2I_SAUVEGARDE_JOURS` jours (14 par défaut) sont supprimés. Lancement à la main : `docker compose exec postgres sh /opt/epc2i/sauvegarde/sauvegarder.sh`.

**Ce qui n'est pas dans la base.** Les fichiers déposés restent dans les volumes des outils : `/data/files` pour Keystone et Codex, `/data/uploads` pour Vigie. Ils se sauvegardent avec la base, à la même heure.

**Hors du serveur.** Le volume des sauvegardes est sur le même disque que la base. Copiez chaque dossier ailleurs, chiffré (destination à choisir, question P-08). Une sauvegarde par nuit perd au plus une journée de saisies : l'objectif de 15 minutes de Keystone (I-1b) demande en plus l'archivage continu des journaux de transactions.

**Restaurer le schéma d'un outil** (procédure essayée sur `cursus`, partage en place) :

1. Arrêter l'outil.
2. En superutilisateur : `DROP SCHEMA cursus CASCADE;`. Le `CASCADE` supprime aussi les objets d'autres schémas qui dépendent de celui-ci : aujourd'hui `matrix.journal_unifie` (« drop cascades to view matrix.journal_unifie »). Notez la liste affichée.
3. Rejouer `init/02-schemas.sql` puis `init/03-droits.sql` : le schéma vide est recréé avec son propriétaire et ses privilèges par défaut. Pour `codex` : l'extension `pg_trgm` est dans le schéma `extensions`, donc hors de `codex.dump` (l'index `document_terms_term` y renvoie par `extensions.gin_trgm_ops`) ; le `DROP SCHEMA codex CASCADE` n'y touche pas, et `init/02-schemas.sql` la réinstalle si elle manque (serveur reconstruit) : elle doit être en place avant le `pg_restore`.
4. Restaurer en tant que propriétaire :
   ```bash
   pg_restore -h <hôte> -U cursus_app -d epc2i --schema=cursus --no-owner --no-privileges \
     --exit-on-error --single-transaction cursus.dump
   ```
   Avec `--schema`, `pg_restore` ne tente pas de recréer le schéma, ce que `cursus_app` n'a pas le droit de faire. Les droits de `matrix_lecture` et `matrix_admin` sont reposés par le déclencheur `droits_ddl`. Les séquences reprennent leur valeur. Les vues `pub_` et `*_v1` du schéma reviennent avec la sauvegarde, mais **pas les droits des autres outils** : `--no-privileges` les écarte, et `droits_ddl` ne traite que Matrix.
5. `SELECT gravite, objet, constat FROM droits.verifier() ORDER BY gravite, objet;` signale à ce stade, en erreur, chaque lecteur qui a perdu son `USAGE` ou son `SELECT` (liste `droits.partage_lecteurs`, tenue par `partage/90-droits.sql`), et en attention `matrix.journal_unifie` absente. Essai : 8 erreurs (les lecteurs des vues `cursus.pub_*`), 1 attention ; `codex_app` reçoit `permission denied for schema cursus` sur `cursus.pub_salaries`.
6. Reposer le partage, dans l'ordre de `partage/README.md` : le fichier de l'outil restauré (`partage/20-cursus.sql` en `cursus_app`), puis `partage/90-droits.sql` (superutilisateur), puis `partage/95-matrix-journal-unifie.sql` (`matrix_app`). Si l'étape 2 a supprimé d'autres objets, les recréer par les migrations de leur outil.
7. `droits.verifier()` ne doit plus renvoyer d'erreur (essai : aucune ligne). Redémarrer l'outil, puis vérifier qu'un lecteur lit ses vues (par exemple `SELECT count(*) FROM cursus.pub_salaries` en `codex_app`).

**Reconstruire tout le serveur.** Nouveau volume avec les mêmes variables : l'initialisation recrée base, rôles, schémas et droits. Restaurer ensuite chaque schéma comme ci-dessus (étape 4), `matrix` compris. Si la liste des colonnes sensibles avait été modifiée, la reprendre de `droits.dump`, en superutilisateur :

```bash
pg_restore --data-only --schema=droits --table=colonnes_sensibles -f liste.sql droits.dump
psql -U postgres -d epc2i -v ON_ERROR_STOP=1 <<'EOF'
BEGIN;
ALTER TABLE droits.colonnes_sensibles DISABLE TRIGGER colonnes_sensibles_convention;
DELETE FROM droits.colonnes_sensibles;
\i liste.sql
ALTER TABLE droits.colonnes_sensibles ENABLE TRIGGER colonnes_sensibles_convention;
COMMIT;
EOF
```

Les droits sont réappliqués à la fin de la transaction. Reposer ensuite tout le partage dans l'ordre de `partage/README.md` (10, 20 à 60, 90, 95) : il réaccorde les vues `pub_` à leurs lecteurs, remplit de nouveau `droits.partage_lecteurs` et recrée `matrix.journal_unifie`. Contrôler par `droits.verifier()`. Enfin, déclarer de nouveau les administrateurs (`roles.sql` montre qui l'était).

Restaurez une sauvegarde sur un serveur d'essai au moins une fois par mois, pour vérifier qu'elle est exploitable.

## Vérifier les droits

Trois niveaux de contrôle :

1. **État courant**, à tout moment, en superutilisateur, en `matrix_admin` ou en `matrix_app` :
   ```sql
   SELECT gravite, objet, constat FROM droits.verifier() ORDER BY gravite, objet;
   ```
   Aucune ligne `erreur` n'est attendue, que le partage (`partage/`) soit en place ou non. La fonction accepte la convention de partage et elle seule : un outil peut avoir `USAGE` sur le schéma d'un autre et `SELECT` sur ses vues `pub_` ; tout autre droit croisé (table, colonne, séquence, fonction, vue non publiée, écriture, `CREATE`, `USAGE` sans vue `pub_` accordée) est une erreur, comme tout droit sur le schéma `extensions` autre que l'`USAGE` de `codex_app` (et celui d'`epc2i_sauvegarde`, par `pg_read_all_data`), de même qu'une vue `pub_` qui lit une colonne de `droits.colonnes_sensibles` ou une relation d'un autre schéma, et un lecteur inscrit dans `droits.partage_lecteurs` qui a perdu son `USAGE` ou son `SELECT` (après une restauration). Les vues de contrôle `cursus.*_v1` sont réservées à `matrix_lecture` et `matrix_app`. Détail : `partage/README.md`, « Contrôle par le socle ». Une ligne `attention` signale une table fermée à Matrix (colonne de la liste pas encore créée, renommée ou supprimée, table renommée), une table que Matrix ne lit pas, une fonction `SECURITY DEFINER` d'un outil que Matrix peut appeler, un administrateur non journalisé, un paramètre manquant, une vue de `droits.partage_lecteurs` absente ou `matrix.journal_unifie` absente alors que le partage est en place. Une ligne `info` signale une table de la liste pas encore créée (normal avant la migration de l'outil), une table fermée en entier par une entrée `*` (`vigie.benign_accidents`, `access_log`, `attachments`) ou une vue fermée parce qu'elle lit une colonne sensible. Une colonne ou une table de la liste redevenue lisible par `matrix_lecture` (droit posé hors du déclencheur, par exemple) est une `erreur`.
2. **Essai complet**, après une mise en service ou un rejeu : `verifier-droits.sql` (voir plus haut). Il joue chaque rôle sur des tables d'essai et annule tout à la fin. Les cas 71 à 73 éprouvent le schéma `extensions` (`pg_trgm` utilisable par `codex_app` seul, aucune création possible). Les cas 100 à 138 éprouvent la convention de partage : un outil lit une vue `pub_` d'un autre et rien d'autre, et chaque écart (vue `pub_` qui lit une colonne sensible, droit sur une table, écriture, `CREATE`, lecteur attendu qui perd son droit…) est joué seul, signalé par `droits.verifier()`, puis annulé. Les cas 140 à 152 éprouvent une table fermée en entier (`*`) et un droit posé hors du déclencheur. Les cas 200 et suivants, présents dès que Vigie est migré, reprennent chaque entrée de Vigie de la liste (colonnes de santé, copies du journal, tables fermées) : refusée à Matrix, puis signalée par `droits.verifier()` quand elle redevient lisible.
3. **À la main**, par exemple :
   ```sql
   \dp cursus.employes                          -- droits de table et de colonnes
   SET ROLE matrix_app;
   SELECT id, nom, equipe FROM cursus.employes;  -- autorisé
   SELECT visite FROM cursus.employes;           -- ERROR: permission denied for table employes
   RESET ROLE;
   ```

Matrix lit les colonnes par leur nom : `SELECT *` est refusé sur une table qui a des colonnes sensibles, et `information_schema.columns` ne lui montre que les colonnes autorisées. Pour décrire les tables, Matrix lit `pg_catalog` (`pg_class`, `pg_attribute`) ou les déclarations envoyées par les outils.

## Modifier la liste des colonnes sensibles

En `matrix_admin` ou en superutilisateur :

```sql
INSERT INTO droits.colonnes_sensibles (schema_nom, table_nom, colonne_nom, motif)
VALUES ('keystone', 'rate_roles', 'base_rate_eur', 'Taux horaire confidentiel');
```

Les droits sont réappliqués dans la même transaction. Pour fermer une table entière, colonnes futures comprises, inscrire la colonne `*` (`('vigie', 'access_log', '*', …)`). Retirer une colonne se fait par `DELETE` ; les colonnes de la convention ne peuvent être retirées ou modifiées que par un superutilisateur.

Avant une migration qui renomme une colonne sensible, ou qui ajoute une colonne sensible sous un nouveau nom, mettez la liste à jour. Si la migration passe avant : une colonne de la liste devenue absente ferme la table entière à Matrix (avertissement `droits : … est fermée à matrix_lecture` dans le journal de l'outil), jusqu'à la mise à jour de la liste. Une colonne nouvelle, absente de la liste, est lisible par Matrix dès sa création.

Inscrire une colonne avant sa création ferme aussi la table entière à Matrix, jusqu'à la migration qui crée la colonne : faites l'inscription juste avant le déploiement de l'outil. Dès la migration passée, Matrix lit de nouveau les autres colonnes.

La liste protège des colonnes nommées. Une copie de leurs valeurs dans une autre table (`CREATE TABLE … AS SELECT`, table de sauvegarde laissée par une migration, colonne remplie par l'outil) est lisible par Matrix tant qu'elle n'est pas inscrite à son tour. C'est le cas de `cursus.journal.payload`, inscrite pour cette raison.

## Dépannage

| Symptôme | Cause et remède |
|---|---|
| Les scripts de `init/` ne se relancent pas après une modification. | Normal : l'image ne les exécute que sur un volume vide. Les rejouer à la main (« Rejouer le socle »). |
| Un outil s'arrête au démarrage sur `permission denied for database epc2i`. | Il appelle `migrate()` de Drizzle, qui lance `CREATE SCHEMA IF NOT EXISTS`. Utiliser le migrateur du plan (§ 4.3). |
| Un outil s'arrête sur `permission denied for schema public`. | Ses migrations contiennent `REFERENCES "public"."…"` et sont appliquées sans réécriture : Keystone et Vigie doivent passer par leur migrateur du serveur, qui remplace `"public".` par leur schéma (décision P-02, plan § 4.2) ; Codex, par sa migration régénérée avec `pgSchema`. |
| Codex refuse de migrer : « the pg_trgm extension is missing … » ou « … installed in the schema …, which Codex's role may not use ». | Socle antérieur au 22/10/2026, ou extension installée ailleurs. Rejouer `init/02-schemas.sql` (redéployer d'abord) : il crée le schéma `extensions`, y installe `pg_trgm` et donne `USAGE` à `codex_app`. Une extension `pg_trgm` déjà installée dans un autre schéma n'est pas déplacée : `ALTER EXTENSION pg_trgm SET SCHEMA extensions;` en superutilisateur. |
| Un fichier de partage (`30`, `50`) s'arrête sur « Colonnes absentes du schéma … ». | La migration de l'outil qui crée ses prérequis et ses vues n'est pas passée : `npm run db:migrate` pour Keystone, démarrage de Vigie, puis rejouer le fichier. |
| `WARNING: droits : … est fermée à matrix_lecture`. | Une colonne de la liste est absente : pas encore créée (inscription faite avant la migration), renommée ou supprimée ; ou la table a été renommée. Passer la migration attendue, ou mettre `droits.colonnes_sensibles` à jour. |
| Une commande de structure échoue dans `droits._sur_ddl`. | Défaut du socle. En urgence, en superutilisateur : `ALTER EVENT TRIGGER droits_ddl DISABLE;`, faire l'opération, puis `ALTER EVENT TRIGGER droits_ddl ENABLE;` et `SELECT droits.appliquer_droits();`. Signaler le cas. |
| Après une restauration, un outil reçoit `permission denied for schema …` sur une vue `pub_` d'un autre, ou `droits.verifier()` signale « lecteur prévu par partage/90-droits.sql sans USAGE ». | `--no-privileges` a écarté les droits des lecteurs. Rejouer le fichier de partage de l'outil restauré, puis `partage/90-droits.sql` et `partage/95-matrix-journal-unifie.sql` (« Restaurer le schéma d'un outil », étape 6). |
| `pg_restore` échoue sur `SET transaction_timeout`. | Le fichier vient d'un PostgreSQL 17 ou plus (PGlite 0.5.8 est un PostgreSQL 18). Retirer la ligne, ou restaurer sur un serveur de même version. |

## Version de PostgreSQL

L'image est `postgres:18-bookworm`, qui suit les versions mineures de la 18 à chaque redéploiement. C'est une proposition du 22/10/2026, à confirmer (question P-01 du plan) : le socle était en 16 depuis le 15/10/2026, et Codex exige PostgreSQL 18 (sa fonction `codex_fold` utilise la collation `pg_unicode_fast`, propre à la 18 ; il refuse de démarrer sur un serveur plus ancien). Le choix vaut aussi pour Keystone, Vigie et Cursus, et pour l'intégration continue des outils. Le socle (`init/`, `partage/`, `verifier-droits.sql`) a été rejoué sans changement sur PostgreSQL 18.3 le 22/10/2026.

Pour figer la version, remplacer par une étiquette précise (`postgres:18.x-bookworm`). Depuis la 18, l'image range les données dans `/var/lib/postgresql/18/docker` (`$PGDATA`) et le volume se monte sur `/var/lib/postgresql` (`docker-compose.yml`) : un volume monté sur `/var/lib/postgresql/data`, comme en 16, fait refuser le démarrage. Un volume déjà initialisé en 16 ne s'ouvre pas en 18 : sauvegarde complète et restauration, ou `pg_upgrade` ; un changement de version majeure ne se fait jamais en changeant seulement l'étiquette. Sur un serveur neuf, rien de tel : le volume est vide.
