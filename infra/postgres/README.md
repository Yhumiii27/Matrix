# Serveur PostgreSQL commun EPC2I

Ce dossier contient le socle du serveur PostgreSQL commun aux quatre outils de la suite (décision M-01 du 15 octobre 2026) : une base `epc2i`, un schéma par outil, un rôle de connexion par outil. Le plan de migration des outils est dans `docs/architecture-postgres.md`.

| Fichier | Rôle |
|---|---|
| `docker-compose.yml` | PostgreSQL 16, volume de données persistant, scripts d'initialisation montés. Utilisable dans Coolify et en local. |
| `.env.example` | Les variables à fournir (mots de passe). |
| `init/01-base-et-roles.sql` | Base `epc2i` et rôles. |
| `init/02-schemas.sql` | Schémas `keystone`, `codex`, `cursus`, `vigie`, `matrix`, propriétaires et paramètres de session. |
| `init/03-droits.sql` | Droits de Matrix, schéma `droits`, protection des colonnes sensibles (déclencheur d'événement). |
| `verifier-droits.sql` | Contrôle des droits en conditions réelles : 68 cas, rien n'est conservé. |
| `sauvegarde/sauvegarder.sh` | Sauvegarde `pg_dump` par schéma, avec rétention. |
| `cursus/schema.sql` | Schéma PostgreSQL cible de Cursus (28 tables, 37 clés étrangères), à exécuter par `cursus_app`. |

## Ce que créent les scripts

| Objet | Détail |
|---|---|
| Base | `epc2i`, UTF-8, tri `C`, classes de caractères `C.UTF-8`, fuseau des sessions `UTC`, format de date `ISO, MDY`. Ce sont les réglages de PGlite : les outils trient et lisent les dates comme aujourd'hui. |
| Schémas | `keystone`, `codex`, `cursus`, `vigie`, `matrix` (un propriétaire chacun) ; `droits` (propriétaire : le superutilisateur) ; `public` fermé à tous. |
| Rôles de connexion | `keystone_app`, `codex_app`, `cursus_app`, `vigie_app` : propriétaire de son seul schéma, `search_path` = son schéma, aucun accès aux autres schémas, aucun droit `CREATE` sur la base. `matrix_app` : propriétaire de `matrix`, membre de `matrix_lecture`. `epc2i_sauvegarde` : membre de `pg_read_all_data`. |
| Rôles de groupe | `matrix_lecture` : `SELECT` sur les quatre schémas des outils, sauf les colonnes sensibles. `matrix_admin` : tous les droits sur les cinq schémas, attribué nominativement, requêtes journalisées. |
| Fonctions | `droits.appliquer_droits()`, `droits.verifier()`, `droits.declarer_admin(nom)`. |
| Déclencheurs | `droits_ddl` (fin de chaque `CREATE`, `ALTER`, `GRANT`, `REVOKE`) et `droits_suppression` (`DROP`). |

Les colonnes sensibles sont listées dans `droits.colonnes_sensibles`. La convention du 15 octobre y figure : `cursus.employes` (`visite`, `passeport_numero`, `passeport_expire`, `naissance`, `reprise_motif`), `cursus.vaccinations` (`v`, `date`), `cursus.visas` (`type`, `obtenu`, `expire`), `cursus.entretiens` (`cr`), `vigie.events` (`injury`, `lost_days`). Trois ajouts sont proposés et en attente de confirmation (question P-04 du plan) : `cursus.journal` (`payload`, `message`) et `cursus.demandes_collab` (`label`), qui recopient des données de santé.

Pourquoi un déclencheur d'événement : `ALTER DEFAULT PRIVILEGES` accorde `SELECT` sur une table entière, sans pouvoir exclure une colonne. Le déclencheur `droits_ddl` s'exécute à la fin de chaque commande qui crée ou modifie une table, dans la transaction de la migration. Il remplace le `SELECT` de table par un `SELECT` colonne par colonne, sans les colonnes sensibles. La table n'est visible des autres sessions qu'au `COMMIT` : à aucun moment `matrix_lecture` ne lit une colonne sensible. Le détail des règles est en tête de `init/03-droits.sql` et au § 3 du plan.

## Mise en service dans Coolify

1. **Créer la ressource.** Nouvelle ressource « Docker Compose » depuis le dépôt Matrix. Répertoire de base : `/infra/postgres`. Fichier compose : `docker-compose.yml`. Les montages `./init`, `./sauvegarde` et `./verifier-droits.sql` se lisent dans ce répertoire.
2. **Saisir les variables** de `.env.example` : `POSTGRES_PASSWORD`, `KEYSTONE_APP_PASSWORD`, `CODEX_APP_PASSWORD`, `CURSUS_APP_PASSWORD`, `VIGIE_APP_PASSWORD`, `MATRIX_APP_PASSWORD`, `EPC2I_SAUVEGARDE_PASSWORD`. Un mot de passe par variable, généré par `openssl rand -base64 30 | tr -d '/+=' | cut -c1-32`. Ces caractères n'ont pas besoin d'être encodés dans une URL. Ce sont des variables d'exécution : ne cochez pas leur disponibilité au build.
3. **Réseau.** Les outils déployés sur le même serveur Coolify joignent la base par le réseau Docker. Activez l'option de connexion au réseau prédéfini de Coolify sur cette ressource et sur chaque outil. Le nom d'hôte est le nom du conteneur affiché par Coolify (de la forme `postgres-<identifiant>`). Le port 5432 n'est publié que sur `127.0.0.1` de l'hôte, pour l'administration par tunnel SSH. Les libellés exacts dépendent de la version de Coolify : à vérifier à la première mise en service (question P-09).
4. **Déployer.** Au premier démarrage, le volume est vide : l'image exécute les trois scripts de `init/`. Le journal du conteneur doit afficher « Étape 3 terminée », un tableau d'écarts vide, puis « PostgreSQL init process complete ». En cas d'erreur, le conteneur s'arrête : corrigez la cause (souvent une variable vide), supprimez le volume `epc2i_pgdata` et redéployez.
5. **Vérifier les droits.** Dans le terminal du conteneur :
   ```bash
   psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /opt/epc2i/verifier-droits.sql
   ```
   Résultat attendu : « Tous les cas sont conformes : 68 cas. »
6. **Programmer la sauvegarde.** Tâche planifiée Coolify sur le conteneur `postgres`, commande `sh /opt/epc2i/sauvegarde/sauvegarder.sh`, par exemple chaque nuit à 2 h 15 (`15 2 * * *`). Copiez ensuite le volume `epc2i_sauvegardes` hors du serveur (voir « Sauvegarde et restauration »).
7. **Déclarer les administrateurs nominatifs** (voir plus bas).
8. **Raccorder les outils** un par un, dans l'ordre du plan (§ 10), avec leur `DATABASE_URL`.

## Sur un poste local

Avec Docker :

```bash
cd infra/postgres
cp .env.example .env          # puis remplir chaque mot de passe ; .env n'est jamais versionné
docker compose up -d
docker compose logs -f postgres   # attendre « PostgreSQL init process complete »
psql "postgres://postgres@127.0.0.1:5432/postgres" -f verifier-droits.sql
```

Le port publié se change avec `EPC2I_PG_PORT` si 5432 est pris. `docker compose down -v` supprime la base et les sauvegardes locales.

Sans Docker, sur un PostgreSQL 16 déjà installé : exportez les variables de `.env.example`, puis lancez les trois scripts dans l'ordre avec psql 15 ou plus, en superutilisateur :

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
| Keystone | `postgres://keystone_app:<KEYSTONE_APP_PASSWORD>@<hôte>:5432/epc2i` | `KEYSTONE_SEED_DEMO=1` (jeu de démonstration, bêta seulement) ; `KEYSTONE_DB_POOL_MAX` (10 par défaut) ; `KEYSTONE_DATA_DIR` reste nécessaire pour les fichiers déposés. |
| Codex | `postgres://codex_app:<CODEX_APP_PASSWORD>@<hôte>:5432/epc2i` | `CODEX_SEED_DEMO=1` (jeu de démonstration, bêta seulement) ; `CODEX_DB_POOL` (10 par défaut) ; `CODEX_DATA_DIR` reste nécessaire pour les fichiers déposés. |
| Cursus | `postgres://cursus_app:<CURSUS_APP_PASSWORD>@<hôte>:5432/epc2i` | `CURSUS_DEMO=0` en production ; `CURSUS_SECRET` (clé des sessions) ; `CURSUS_PG_POOL` ; `CURSUS_DB` ne sert plus qu'au repli SQLite. |
| Vigie | `postgres://vigie_app:<VIGIE_APP_PASSWORD>@<hôte>:5432/epc2i` | `VIGIE_SEED_DEMO=1` (jeu de démonstration, obligatoire tant que Vigie n'a pas de données de référence) ; `VIGIE_UPLOAD_DIR` reste nécessaire pour les pièces jointes. |
| Matrix | `postgres://matrix_app:<MATRIX_APP_PASSWORD>@<hôte>:5432/epc2i` | Lecture des outils par `matrix_lecture`, écriture dans `matrix`. |

Règles communes :

- `DATABASE_URL` est une variable d'exécution. Elle ne doit jamais être disponible au build (`next build` ouvre la base de Keystone et de Vigie) ni écrite dans une image.
- Les applications Mac fixent `DATABASE_URL` à vide : elles restent sur leur base locale, même si un fichier `.env.local` du projet en définit une.
- Un mot de passe qui contient `@`, `:`, `/` ou `%` doit être encodé dans l'URL (`encodeURIComponent`). Les mots de passe générés comme indiqué plus haut n'en contiennent pas.
- TLS : la base n'est jointe que par le réseau Docker interne, sans TLS. Si un outil doit la joindre par un autre réseau, il faut un certificat ; le pilote `pg` 8.x traite `sslmode=require` comme une vérification complète du certificat (question P-06).

## Rejouer le socle

Les scripts de `init/` ne s'exécutent automatiquement qu'une fois, sur un volume vide. Ils sont rejouables : on les relance après une modification de ces fichiers, pour réparer des droits, ou pour changer un mot de passe. Dans le conteneur, les variables d'environnement sont déjà présentes :

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

**Hors du serveur.** Le volume `epc2i_sauvegardes` est sur le même disque que la base. Copiez chaque dossier ailleurs, chiffré (destination à choisir, question P-08). Une sauvegarde par nuit perd au plus une journée de saisies : l'objectif de 15 minutes de Keystone (I-1b) demande en plus l'archivage continu des journaux de transactions.

**Restaurer le schéma d'un outil** (procédure essayée sur `cursus`) :

1. Arrêter l'outil.
2. En superutilisateur : `DROP SCHEMA cursus CASCADE;`
3. Rejouer `init/02-schemas.sql` puis `init/03-droits.sql` : le schéma vide est recréé avec son propriétaire et ses privilèges par défaut.
4. Restaurer en tant que propriétaire :
   ```bash
   pg_restore -h <hôte> -U cursus_app -d epc2i --schema=cursus --no-owner --no-privileges \
     --exit-on-error --single-transaction cursus.dump
   ```
   Avec `--schema`, `pg_restore` ne tente pas de recréer le schéma, ce que `cursus_app` n'a pas le droit de faire. Les droits de `matrix_lecture` et `matrix_admin` sont reposés par le déclencheur `droits_ddl`. Les séquences reprennent leur valeur.
5. `SELECT * FROM droits.verifier();` puis redémarrer l'outil.

**Reconstruire tout le serveur.** Nouveau volume avec les mêmes variables : l'initialisation recrée base, rôles, schémas et droits. Restaurer ensuite chaque schéma comme ci-dessus (étapes 4 et 5), `matrix` compris. Si la liste des colonnes sensibles avait été modifiée, la reprendre de `droits.dump`, en superutilisateur :

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

Les droits sont réappliqués à la fin de la transaction. Enfin, déclarer de nouveau les administrateurs (`roles.sql` montre qui l'était).

Restaurez une sauvegarde sur un serveur d'essai au moins une fois par mois, pour vérifier qu'elle est exploitable.

## Vérifier les droits

Trois niveaux de contrôle :

1. **État courant**, à tout moment, en superutilisateur, en `matrix_admin` ou en `matrix_app` :
   ```sql
   SELECT gravite, objet, constat FROM droits.verifier() ORDER BY gravite, objet;
   ```
   Aucune ligne `erreur` n'est attendue. Une ligne `attention` signale une table fermée à Matrix (colonne de la liste pas encore créée, renommée ou supprimée, table renommée), une table que Matrix ne lit pas, une fonction `SECURITY DEFINER` d'un outil que Matrix peut appeler, un administrateur non journalisé ou un paramètre manquant. Une ligne `info` signale une table de la liste pas encore créée (normal avant la migration de l'outil) ou une vue fermée parce qu'elle lit une colonne sensible.
2. **Essai complet**, après une mise en service ou un rejeu : `verifier-droits.sql` (voir plus haut). Il joue chaque rôle sur des tables d'essai et annule tout à la fin.
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

Les droits sont réappliqués dans la même transaction. Retirer une colonne se fait par `DELETE` ; les colonnes de la convention ne peuvent être retirées ou modifiées que par un superutilisateur.

Avant une migration qui renomme une colonne sensible, ou qui ajoute une colonne sensible sous un nouveau nom, mettez la liste à jour. Si la migration passe avant : une colonne de la liste devenue absente ferme la table entière à Matrix (avertissement `droits : … est fermée à matrix_lecture` dans le journal de l'outil), jusqu'à la mise à jour de la liste. Une colonne nouvelle, absente de la liste, est lisible par Matrix dès sa création.

Inscrire une colonne avant sa création ferme aussi la table entière à Matrix, jusqu'à la migration qui crée la colonne : faites l'inscription juste avant le déploiement de l'outil. Dès la migration passée, Matrix lit de nouveau les autres colonnes.

La liste protège des colonnes nommées. Une copie de leurs valeurs dans une autre table (`CREATE TABLE … AS SELECT`, table de sauvegarde laissée par une migration, colonne remplie par l'outil) est lisible par Matrix tant qu'elle n'est pas inscrite à son tour. C'est le cas de `cursus.journal.payload`, inscrite pour cette raison.

## Dépannage

| Symptôme | Cause et remède |
|---|---|
| Les scripts de `init/` ne se relancent pas après une modification. | Normal : l'image ne les exécute que sur un volume vide. Les rejouer à la main (« Rejouer le socle »). |
| Un outil s'arrête au démarrage sur `permission denied for database epc2i`. | Il appelle `migrate()` de Drizzle, qui lance `CREATE SCHEMA IF NOT EXISTS`. Utiliser le migrateur du plan (§ 4.3). |
| Un outil s'arrête sur `permission denied for schema public`. | Ses migrations contiennent `REFERENCES "public"."…"` : la migration de base doit être régénérée avec `pgSchema` (§ 4.2). |
| `WARNING: droits : … est fermée à matrix_lecture`. | Une colonne de la liste est absente : pas encore créée (inscription faite avant la migration), renommée ou supprimée ; ou la table a été renommée. Passer la migration attendue, ou mettre `droits.colonnes_sensibles` à jour. |
| Une commande de structure échoue dans `droits._sur_ddl`. | Défaut du socle. En urgence, en superutilisateur : `ALTER EVENT TRIGGER droits_ddl DISABLE;`, faire l'opération, puis `ALTER EVENT TRIGGER droits_ddl ENABLE;` et `SELECT droits.appliquer_droits();`. Signaler le cas. |
| `pg_restore` échoue sur `SET transaction_timeout`. | Le fichier vient d'un PostgreSQL 17 ou plus (PGlite 0.5.8 est un PostgreSQL 18). Retirer la ligne, ou restaurer sur un serveur de même version. |

## Version de PostgreSQL

L'image est `postgres:16-bookworm`, qui suit les versions mineures de la 16 à chaque redéploiement. Pour figer la version, remplacer par une étiquette précise (`postgres:16.x-bookworm`). Un changement de version majeure (17, 18) demande une sauvegarde complète et une restauration, ou `pg_upgrade` sur le volume ; il ne se fait pas en changeant seulement l'étiquette (question P-01).
