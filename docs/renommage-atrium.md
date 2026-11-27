# Renommage du serveur commun en Atrium — fiche d'opération

Décisions du propriétaire du 27/11/2026 (M-26, M-27, M-28 de `docs/decisions.md`) : la suite s'appelle **Atrium** ; tout
ce qui portait l'ancien nom est renommé, **volumes compris**, ainsi que le nom affiché de la filiale `SMC` et les
identifiants des messages d'échange. Cette fiche dit, dans l'ordre, comment renommer le serveur en service sans perdre de
données, en gardant à chaque étape un retour arrière.

**État : préparée, rien n'est joué.** Rien n'a été fait sur le serveur ni dans Coolify. Chaque étape marquée « validé »
attend le « validé » explicite du propriétaire (`docs/delegation-claude.md` § 2). Toute la fenêtre a été répétée sur des
clusters PostgreSQL 16 jetables, copie des volumes comprise (`scripts/essai-renommage.sh`, § 12).

## 1. Ce qui change

| Ancien | Nouveau | Où | Quand |
|---|---|---|---|
| volumes `…_epc2i_pgdata`, `…_epc2i_sauvegardes` | `…_atrium_pgdata`, `…_atrium_sauvegardes` | ressource `postgres` de Coolify (clés du compose) | étape 4.5 (copie) ; anciens volumes gardés intacts jusqu'à l'étape 9 |
| base `epc2i` | `atrium` | serveur commun ; `DATABASE_URL` de chaque outil | étape 4.8 |
| hôte `epc2i-postgres` | `atrium-postgres` | alias réseau du compose ; `DATABASE_URL` de chaque outil | alias : étape 4.6 (les deux servis) ; adresses : étape 5 |
| rôle `epc2i_sauvegarde` | `atrium_sauvegarde` | serveur commun | étape 4.8 |
| variable `EPC2I_SAUVEGARDE_PASSWORD` | `ATRIUM_SAUVEGARDE_PASSWORD` | ressource `postgres` | étape A1 (copie), étape 9 (retrait) |
| `EPC2I_SAUVEGARDE_DIR`, `_JOURS`, `EPC2I_LIENS_ETAT`, `_FORCER`, `EPC2I_PARTAGE_DIR`, `EPC2I_PG_PORT`, `EPC2I_DOCKER_NETWORK` | `ATRIUM_…` | compose, scripts, poste local | dépôt (anciens lus en repli jusqu'à l'étape 9) |
| `/opt/epc2i/` dans l'image | `/opt/atrium/` | image `postgres`, commandes des tâches planifiées | image : étape 4.6 (lien `/opt/epc2i` gardé) ; tâches : étape 8 |
| nom affiché de la ressource Coolify | `atrium-postgres` | Coolify (affichage seul) | étape 8 |
| filiale `SMC`, site `smc` : ancien nom de société | « Filiale partenaire », « Saint-Martin-de-Crau — Filiale partenaire (laboratoire 67, PDE) » | `matrix.filiales`, `matrix.sites` (donc `pub_filiales`, `pub_sites`) | étape 6.3 ; codes `SMC` et `smc` inchangés |
| messages `epc2i.heures.*/1`, `epc2i.absence.*/1` | `atrium.heures.*/2`, `atrium.absence.*/2` (mêmes champs) | contrats `data/contrats/*-v2.schema.json` | hors fenêtre : `docs/remplacement-lucca.md` § 3.11 (P7) |
| cookie `epc2i-theme` | `atrium-theme` | Matrix (et Norma 3.0 pour les autres outils) | dépôt ; l'ancien lu en repli |
| `/etc/epc2i/`, services `epc2i-*`, compte `epc2i`… | `atrium` | installation directe | annexe A |

Ce qui ne porte pas l'ancien nom et ne change donc pas : identifiant (UUID) de la ressource Coolify et nom du conteneur
(`postgres-<identifiant>`), projet « Outils PM », rôles `<outil>_app` et `matrix_*`, schémas, vues `pub_`, verrous
consultatifs et `application_name` des outils (relevé du 27/11/2026 dans tous les dépôts : aucun ne contient l'ancien
nom), noms des dossiers de sauvegarde (horodatages).

## 2. Principe

- **Les fichiers joués sur le serveur acceptent les deux noms** pendant la transition : `init/01` à `03`,
  `partage/90-droits.sql` et `verifier-droits.sql` prennent la base `atrium`, sinon `epc2i` (sinon créent `atrium`), et le
  rôle `atrium_sauvegarde`, sinon `epc2i_sauvegarde` ; `droits.verifier()` contrôle les deux noms ; `sauvegarder.sh` et
  `appliquer-liens.sh` se connectent à ce qui répond et lisent les anciennes variables en repli. Le compose sert les deux
  alias réseau et accepte les deux variables de mot de passe ; l'image garde `/opt/epc2i` comme lien vers `/opt/atrium`.
- **Le compose de `main` désigne les nouveaux volumes.** Coolify nomme chaque volume `<identifiant de la ressource>_<clé>` :
  sur le serveur en service, `…_atrium_pgdata` n'existe qu'une fois la copie de l'étape 4.5 faite. Déployer la ressource
  `postgres` avant démarrerait une base neuve et vide (aucune perte : les données restent dans les anciens volumes, mais
  tous les outils seraient coupés). D'où le prérequis P1 : **déploiement automatique de `postgres` coupé avant la fusion
  de la PR, et aucun déploiement de `postgres` jusqu'à l'étape 4.6.**
- **Copie à l'identique des volumes, base arrêtée** (étape 4.5), plutôt qu'une restauration logique. Raisons :
  - une copie de fichiers de PostgreSQL 16 arrêté vers PostgreSQL 16 est le cluster lui-même : identifiants internes,
    mots de passe SCRAM, propriétaires (`matrix_gestion` des vues `pub_`), droits, déclencheurs d'événement
    `droits_ddl`, réglages, séquences et journal de transactions, sans exception ni ordre à respecter ;
  - une restauration `pg_dump` / `pg_restore` dans un cluster neuf rejoue chaque objet sous le déclencheur `droits_ddl` et
    recrée rôles et droits à part (`pg_dumpall --globals-only`) : plus longue, avec plus de manières d'échouer à moitié ;
  - la copie se vérifie simplement (même `PG_VERSION`, même nombre de fichiers, puis comptage exact table par table
    identique, `renommage/compter.sql`) ;
  - elle demande un accès à l'hôte Docker (Coolify n'a pas de copie de volume, ni dans l'interface ni dans l'API) : SSH
    ou terminal du serveur dans Coolify (prérequis P8). La restauration logique reste le **plan de secours** (§ 9), avec
    les sauvegardes complètes de l'étape 4.3, qui voyagent dans le volume des sauvegardes copié.
- Les anciens volumes ne sont **jamais modifiés** : `postgres` est arrêté avant la copie et ne redémarre plus sur eux,
  sauf retour arrière. Ils restent jusqu'au nettoyage (étape 9).

## 3. Qui fait quoi

| Rôle | Qui | Quoi |
|---|---|---|
| Propriétaire | Guillaume Garrigue | Date de la fenêtre, « validé » des étapes A1, 4 à 9, annonce aux utilisateurs ; copie des volumes (4.5) par SSH si Claude n'a pas accès à l'hôte. |
| Opérateur | Claude par l'API de Coolify, après chaque « validé » ; ou le propriétaire dans l'interface | Étapes 1 à 9 hors accès à l'hôte. Jeton de l'API passé par l'environnement, jamais écrit. |
| Sessions des outils | Clavis, Arche, Crucible, Modulus, Cursus, Keystone, Vigie | Prérequis P4, P5, P7 dans leurs dépôts (§ 13 : demandes). |
| DSI | | Rien côté Entra ni DNS : les adresses publiques des outils ne changent pas. |

## 4. Prérequis

| | Prérequis | Vérification |
|---|---|---|
| P1 | **Avant de fusionner la PR** : ressource `postgres` de Coolify, déploiement automatique coupé (« Auto Deploy » désactivé), et consigne de ne pas la redéployer jusqu'à l'étape 4.6. | Réglage relevé coupé ; la fusion de la PR ne lance aucun déploiement de `postgres`. |
| P2 | La PR de cette fiche est fusionnée dans `main` (à la demande du propriétaire), CI verte. Matrix lui-même peut être redéployé : seul `postgres` attend. | — |
| P3 | Répétition jouée : `bash scripts/essai-renommage.sh` sur un poste avec PostgreSQL 16, jamais sur le serveur. | « Répétition terminée sans erreur. » |
| P4 | **Clavis, Arche, Crucible, Modulus** : leur `deploy/compose.shared.yaml` écrit lui-même `DATABASE_URL` avec `/epc2i` en dur et l'hôte `${EPC2I_PG_HOST:-epc2i-postgres}`. Réécrire leurs variables dans Coolify ne suffit pas : chacun lit d'abord la base et l'hôte de variables, avec les valeurs actuelles par défaut, par exemple `@${ATRIUM_PG_HOST:-epc2i-postgres}:5432/${ATRIUM_PG_DATABASE:-epc2i}` (pas de valeur par défaut imbriquée : l'interpolation de Coolify n'est pas garantie). | Chacun redéployé avec ce compose, toujours connecté à `epc2i`. |
| P5 | **Cursus** : `BASE_COMMUNE = 'epc2i'` (`server/src/config.ts`) sert au contrôle de production et à la protection qui refuse une démonstration sur la base commune ; après le renommage, cette protection ne reconnaîtrait plus `atrium`. Cursus accepte les deux noms avant la fenêtre. | Contrôle de production de Cursus vert sur `atrium` comme sur `epc2i`. |
| P6 | Keystone garde une ancienne copie du socle (`infra/postgres-socle/`, base `epc2i`) : elle ne doit jamais être jouée sur le serveur. | Aucune tâche ne la joue. |
| P7 | Messages v2 (`docs/remplacement-lucca.md` § 3.11) : Keystone et Vigie acceptent `/1` et `/2`, puis Cursus émet `/2`. Indépendant de la fenêtre ; ni Keystone ni Cursus n'utilisent encore le champ `schema` (relevé du 27/11/2026). | — |
| P8 | Accès à l'hôte Docker du serveur Coolify (SSH root, ou terminal du serveur dans Coolify) pour l'étape 4.5. | `docker volume ls` répond. |
| P9 | Place disque sur l'hôte : au moins la taille des deux anciens volumes, plus les sauvegardes complètes, plus 20 % (relevé, § 5). | `df -h /var/lib/docker`. |
| P10 | Fenêtre choisie hors des heures d'usage et hors de la sauvegarde nocturne (2 h 15) ; utilisateurs prévenus. | Annonce faite. |

## 5. Relevé, sans rien changer (étape 1)

En lecture seule, la veille ou le jour même (pas de « validé » requis, `docs/delegation-claude.md` § 1).

1. **Ressources et variables** : `COOLIFY_URL=… COOLIFY_TOKEN=… node scripts/renommage-envs-coolify.mjs` (noms et nature des
   changements seulement, jamais de valeur). Ressources attendues : `postgres` et les 11 applications qui y sont reliées —
   Matrix, Clavis, Keystone, Codex, Cursus, Vigie, Arche, Crucible, Modulus, Vector, plus la 11ᵉ que le relevé fait
   apparaître (une ressource dont une variable ou le compose nomme `epc2i-postgres`). La liste du relevé fait foi.
2. **Tâches planifiées** de `postgres` (`REJEU_SOCLE`, `APPLIQUER_LIENS`, `SAVE_DAILY`) : commande exacte de chacune.
3. **Volumes** : sur l'hôte, `docker volume ls --format '{{.Name}}' | grep -E '_epc2i_(pgdata|sauvegardes)$'` → deux noms
   `<préfixe>_epc2i_pgdata` et `<préfixe>_epc2i_sauvegardes` ; noter le préfixe (identifiant de la ressource) et les
   étiquettes : `docker volume inspect <préfixe>_epc2i_pgdata --format '{{json .Labels}}'`. Tailles :
   `docker run --rm -v <préfixe>_epc2i_pgdata:/v:ro postgres:16-bookworm du -sh /v` (de même pour les sauvegardes) ;
   place libre : `df -h /var/lib/docker` (P9). Réglage « Auto Deploy » de `postgres` (P1).
4. **Base**, en `postgres` dans le terminal du conteneur :
   ```sql
   SELECT datname FROM pg_database WHERE datname IN ('epc2i', 'atrium');                       -- epc2i seule
   SELECT rolname, left(rolpassword, 13) FROM pg_authid WHERE rolname LIKE '%\_sauvegarde';   -- SCRAM-SHA-256 attendu
   SELECT application_name, usename, count(*) FROM pg_stat_activity WHERE datname = 'epc2i' GROUP BY 1, 2 ORDER BY 1, 2;
   SELECT gravite, objet, constat FROM droits.verifier() WHERE gravite <> 'info';
   SELECT code, nom FROM matrix.filiales WHERE code = 'SMC';  SELECT code, libelle FROM matrix.sites WHERE code = 'smc';
   ```
   PostgreSQL efface un mot de passe MD5 au renommage du rôle (il garde un SCRAM, vérifié à la répétition) : en MD5,
   rejouer d'abord `init/01`. `pg_stat_activity` donne la liste réelle des outils connectés, à recouper avec le point 1.
   Dans Matrix, écran « Référentiels » : noter si les filiales et les sites sont « saisis dans Matrix » (étape 6.3).

## 6. Temps A — avant la fenêtre (étape A1, « validé »)

| | Action | Vérification | Retour arrière |
|---|---|---|---|
| A1 | Ressource `postgres` : ajouter `ATRIUM_SAUVEGARDE_PASSWORD` avec la valeur de `EPC2I_SAUVEGARDE_PASSWORD`, sans l'afficher : `node scripts/renommage-envs-coolify.mjs --ressources=postgres --cles --appliquer`. Une variable ajoutée ne redéploie pas la ressource ; ne pas cliquer « Redeploy ». | « copiée vers ATRIUM_SAUVEGARDE_PASSWORD ». | Supprimer la nouvelle variable. |

Rien d'autre ne se fait avant la fenêtre sur le serveur : le nouvel alias n'existe qu'avec la nouvelle image et le
nouveau compose, déployés à l'étape 4.6.

## 7. La fenêtre (étapes 4 à 7, « validé » du jour)

**Coupure estimée : 45 à 75 minutes ; annoncer une heure et demie.** Arrêt 2 min ; comptage et sauvegardes 5 à 10 min ;
copie des volumes 2 à 10 min selon leur taille (relevé) ; construction et démarrage de l'image 3 à 5 min ; rejeu du socle et
renommage 3 min ; variables 2 min ; redémarrage des 11 applications 10 à 20 min ; contrôles et filiale 10 à 15 min.

### Étape 4 — arrêt, sauvegardes, copie des volumes, nouveau serveur, renommage

| | Action | Vérification | Retour arrière |
|---|---|---|---|
| 4.1 | Arrêter les 11 applications (API Coolify `stop`), Matrix compris ; désactiver `APPLIQUER_LIENS` et `SAVE_DAILY`. | Chaque ressource « Exited » ; `SELECT application_name, usename FROM pg_stat_activity WHERE datname = 'epc2i';` : plus que des sessions d'administration. | Redémarrer les applications. |
| 4.2 | Comptage avant : l'ancienne image n'a pas `compter.sql` : sur l'hôte, `docker cp <copie du dépôt>/infra/postgres/renommage/compter.sql <conteneur>:/tmp/compter.sql`, puis dans le conteneur `psql -U postgres -d epc2i -X -q -A -t -v ON_ERROR_STOP=1 -f /tmp/compter.sql > /sauvegardes/comptage-avant.txt`. | Une ligne par table, puis vues, fonctions, déclencheurs, rôles, réglages, droits, publications, liens. | — |
| 4.3 | Sauvegardes : `SAVE_DAILY` à la main (un fichier par schéma), puis une sauvegarde complète en superutilisateur : `pg_dump -U postgres -d epc2i -Fc -f /sauvegardes/complet-$(date +%F).dump` et `pg_dumpall -U postgres --globals-only -f /sauvegardes/globaux-$(date +%F).sql` (rôles **avec leurs mots de passe chiffrés** : fichier sensible, mode 600). | `cd /sauvegardes/<horodatage> && sha256sum -c SHA256SUMS` tout « OK » ; `pg_restore --list /sauvegardes/complet-….dump \| wc -l` non nul ; tailles comparables à la veille. Noter les noms des fichiers dans le compte rendu. Copie de secours hors des volumes : `docker cp <conteneur>:/sauvegardes/complet-….dump /root/` (chiffrée si elle quitte le serveur). | — |
| 4.4 | Arrêter la ressource `postgres` (API `stop`). | `docker ps` ne la montre plus ; aucun conteneur ne monte les anciens volumes : `docker ps -a --filter volume=<préfixe>_epc2i_pgdata`. | Redémarrer `postgres` (ancienne révision, rien n'a changé). |
| 4.5 | **Sur l'hôte**, copie des volumes (P8), avec les étiquettes relevées (§ 5, point 3), la clé changée : ```docker volume create --label com.docker.compose.project=<préfixe> --label com.docker.compose.volume=atrium_pgdata <préfixe>_atrium_pgdata``` (de même `atrium_sauvegardes`), puis ```docker run --rm -v <préfixe>_epc2i_pgdata:/de:ro -v <préfixe>_atrium_pgdata:/vers postgres:16-bookworm sh -c 'cp -a /de/. /vers/'``` et la même commande pour `…_epc2i_sauvegardes` → `…_atrium_sauvegardes`. L'image `postgres:16-bookworm` garantit le même propriétaire (utilisateur `postgres`, 999). Les anciens volumes sont montés en lecture seule (`:ro`). | Pour chaque paire : `docker run --rm -v <ancien>:/a:ro -v <nouveau>:/b:ro postgres:16-bookworm sh -c 'cat /b/PG_VERSION; find /a \| wc -l; find /b \| wc -l; du -s /a /b'` → `16` (pour les données), mêmes nombres de fichiers, mêmes tailles ; pas de `postmaster.pid` dans la copie (arrêt propre). | Supprimer les nouveaux volumes (`docker volume rm <préfixe>_atrium_…`) : les anciens n'ont pas été touchés. |
| 4.6 | Déployer la ressource `postgres` depuis `main` (nouvelle image, nouveau compose, nouveaux volumes). | Journal du conteneur **sans** « PostgreSQL init process complete » (sinon : volumes neufs, arrêter aussitôt, voir le retour) ; `docker inspect <conteneur> --format '{{range .Mounts}}{{.Name}} {{end}}'` → les deux volumes `…_atrium_…` ; `ls -l /opt/epc2i` → lien vers `/opt/atrium` ; depuis le terminal d'un outil arrêté, ou d'un conteneur sur le réseau `coolify`, `getent hosts atrium-postgres` et `getent hosts epc2i-postgres` répondent. Comptage : `psql -U postgres -d epc2i -X -q -A -t -f /opt/atrium/renommage/compter.sql > /sauvegardes/comptage-copie.txt && diff /sauvegardes/comptage-avant.txt /sauvegardes/comptage-copie.txt` → aucune différence. | Redéployer la révision précédente (Coolify « Rollback », anciennes clés de volumes) : `postgres` repart sur les anciens volumes, intacts. Si l'init a tourné sur un volume vide : arrêter, vérifier les noms créés à 4.5 (préfixe, étiquettes), recommencer 4.5 après `docker volume rm` du volume vide. |
| 4.7 | `REJEU_SOCLE` (socle de la nouvelle image, mode transition). | « Renommage en Atrium pas encore fait sur ce serveur : base epc2i, rôle des sauvegardes epc2i_sauvegarde », « Étape 3 terminée » ; `SELECT count(*) FROM droits.verifier() WHERE gravite = 'erreur';` = 0. | Comme 4.6. |
| 4.8 | Renommage : `psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /opt/atrium/renommage/renommer-atrium.sql`. Il refuse s'il est lancé sur `epc2i`, si `atrium` existe déjà, si le mot de passe est en MD5 ; il ferme la base aux nouvelles connexions, coupe les sessions restantes (listées avant), renomme la base et le rôle, rouvre. | Il affiche `atrium \| t \| <n>` (droits CONNECT gardés : 17 à la répétition), le nombre de réglages gardés, `atrium_sauvegarde \| t \| t \| t \| t` (connexion, SCRAM, lecture de tout, CONNECT). Puis : `droits.verifier()` sur `atrium` sans erreur ; `psql -U postgres -d atrium -X -q -A -t -f /opt/atrium/renommage/compter.sql > /sauvegardes/comptage-apres.txt && diff <(sed 1d /sauvegardes/comptage-avant.txt) <(sed 1d /sauvegardes/comptage-apres.txt)` → aucune différence (seule la ligne « base » change). | `/opt/atrium/renommage/retour-epc2i.sql`, puis redémarrer les applications sur leurs anciennes adresses (alias `epc2i-postgres` servi) ; ou retour complet de 4.6. |

`pg_hba.conf` de l'image officielle ne nomme pas de base (`host all all all scram-sha-256`), et un rôle n'a pas de base par
défaut côté serveur (chaque outil la donne dans son adresse) : rien d'autre à changer dans PostgreSQL.

### Étape 5 — adresses des outils

| | Action | Vérification | Retour arrière |
|---|---|---|---|
| 5.1 | `node scripts/renommage-envs-coolify.mjs --appliquer` (hôte et base de chaque `DATABASE_URL`, Matrix compris : `MATRIX_DATABASE_URL`, `MATRIX_GESTION_DATABASE_URL` ; Cursus : `DATABASE_URL` et `CURSUS_PURGE_DATABASE_URL`). Outils de P4 : `--ressources=clavis,arche,crucible,modulus --poser=ATRIUM_PG_DATABASE=atrium,ATRIUM_PG_HOST=atrium-postgres --appliquer`. | Relancé sans `--appliquer`, le script n'annonce plus rien à écrire, sauf `EPC2I_SAUVEGARDE_PASSWORD` (clé gardée jusqu'à l'étape 9) et des cas « à voir à la main », traités un par un. | `retour-epc2i.sql`, puis les adresses en `/epc2i` (hôte au choix, les deux alias répondent). |

### Étape 6 — redémarrage, dans l'ordre, et filiale

| | Action | Vérification |
|---|---|---|
| 6.1 | **Clavis** (les autres outils lisent `clavis.pub_acces` à chaque connexion d'un utilisateur). | `/api/health` 200. |
| 6.2 | **Matrix** (sa sonde relit le serveur au démarrage). | `/api/sante` 200, champ `historique` : serveur commun. |
| 6.3 | **Filiale `SMC`** (M-27), par le chemin d'édition de Matrix, qui écrit à la fois `edition.json` de Matrix, le schéma `matrix` et son journal : écran « Référentiels » › Filiales, ligne `SMC`, nom « Filiale partenaire » ; › Sites, ligne `smc`, libellé « Saint-Martin-de-Crau — Filiale partenaire (laboratoire 67, PDE) » ; Enregistrer. Équivalent par l'API, connecté administrateur : `GET /api/referentiels/filiales`, changer le seul champ `nom` de `SMC`, `PUT /api/referentiels/filiales` avec la liste entière ; de même `sites`. La sauvegarde de l'étape 4.3 couvre ces deux tables ; noter avant le changement la ligne relevée (§ 5, point 4). **Jamais par un `UPDATE` seul** : si la liste est « saisie dans Matrix », Matrix réécrirait l'ancien nom sur le serveur à son démarrage suivant (`alignerReferentiels` de `serveur.mjs`). | `SELECT code, nom FROM matrix.pub_filiales WHERE code = 'SMC';` → `SMC \| Filiale partenaire` ; `SELECT code, libelle FROM matrix.pub_sites WHERE code = 'smc';` → nouveau libellé ; journal de Matrix : deux saisies. Crucible et Arche reprennent le nom au passage suivant de leur lecture. Retour : même chemin, ancien nom. |
| 6.4 | Keystone, Codex, Cursus, Vigie, Arche, Crucible, Modulus, Vector, puis la 11ᵉ ressource du relevé (workers avec eux). Les ressources « Docker Compose » prennent une variable changée au redéploiement, les autres au redémarrage. | Route de santé 200 ; journal sans « database "epc2i" does not exist » ni « permission denied for database ». |

### Étape 7 — contrôles d'après

| | Contrôle | Attendu |
|---|---|---|
| 7.1 | `REJEU_SOCLE` | « Étape 1 terminée : base atrium et rôles en place », sans la ligne « pas encore fait » ; « Étape 3 terminée », écarts vides. |
| 7.2 | `droits.verifier()` sur `atrium` ; `psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /opt/atrium/verifier-droits.sql` | Aucune erreur ; « Tous les cas sont conformes ». |
| 7.3 | Réactiver puis lancer `SAVE_DAILY` et `APPLIQUER_LIENS`. | « base atrium, rôle atrium_sauvegarde » ; liens « concordent » ou « terminé ». |
| 7.4 | `SELECT application_name, usename, count(*) FROM pg_stat_activity WHERE datname = 'atrium' GROUP BY 1, 2 ORDER BY 1, 2;` | Les outils du relevé, tous revenus. |
| 7.5 | Matrix : écran Santé (liens appliqués), écran Publications (aucune en « erreur ») ; `SELECT etat, count(*) FROM matrix.publications GROUP BY 1;` identique au comptage d'avant. | Comme avant la fenêtre. |
| 7.6 | Recette : connexion par Clavis à Keystone puis Codex ; une lecture croisée (Arche lit `keystone.pub_projets`, Crucible `vigie.pub_controles`). | Comme avant. |
| 7.7 | Annoncer la fin de la coupure. | — |

### Étape 8 — tâches planifiées et noms affichés (« validé »)

- Commandes : `SAVE_DAILY` → `sh /opt/atrium/sauvegarde/sauvegarder.sh`, `APPLIQUER_LIENS` → `sh /opt/atrium/partage/appliquer-liens.sh`.
  Lancer chacune une fois.
- Ressource `postgres` : nom affiché `atrium-postgres` ; réactiver son déploiement automatique (P1) si on le souhaite.

## 8. Nettoyage (étape 9, deux semaines après au plus tôt, PR et « validé »)

| Quoi | Où |
|---|---|
| Anciens volumes `<préfixe>_epc2i_pgdata`, `<préfixe>_epc2i_sauvegardes` | sur l'hôte, `docker volume rm`, après une dernière sauvegarde de la base `atrium` vérifiée et le « validé » (suppression de données, `docs/delegation-claude.md` § 2) |
| Alias `epc2i-postgres` | `infra/postgres/docker-compose.yml` (puis redéployer `postgres`) |
| Variable `EPC2I_SAUVEGARDE_PASSWORD` | compose, `.env.example`, ressource `postgres` |
| Lien `/opt/epc2i` | `infra/postgres/Dockerfile` |
| Replis vers `epc2i` / `epc2i_sauvegarde` / `EPC2I_*` | `init/01`, `02`, `03` (y compris `droits.verifier()`), `partage/90-droits.sql`, `verifier-droits.sql`, `sauvegarde/sauvegarder.sh`, `partage/appliquer-liens.sh`, `test/renommage.test.mjs` |
| Valeurs par défaut `epc2i` des outils de P4 et P5 | leurs dépôts (défaut `atrium-postgres` / `atrium`) |
| Contrats v1 (`data/contrats/heures-validees.schema.json`, `absences-validees.schema.json`) | à la fin de la transition des messages (`docs/remplacement-lucca.md` § 3.11) |
| Cookie `epc2i-theme` lu en repli | `outils/theme.mjs`, une fois toute la suite passée à Norma 3.0 |
| `renommage/`, `scripts/essai-renommage.sh`, `scripts/renommage-envs-coolify.mjs`, cette fiche | gardés comme trace, ou retirés |

## 9. Retour arrière

| Après l'étape | Retour |
|---|---|
| A1 | Supprimer `ATRIUM_SAUVEGARDE_PASSWORD`. |
| 4.4 / 4.5 | Supprimer les nouveaux volumes s'ils existent ; redémarrer `postgres` (révision précédente) et les applications. |
| 4.6 à 4.8 | Coolify « Rollback » de `postgres` vers la révision d'avant (anciennes clés de volumes) : le serveur repart sur les anciens volumes, base `epc2i`, intacts (vérifié à la répétition : comptage identique) ; redémarrer les applications sur leurs anciennes adresses. Les nouveaux volumes restent pour examen. |
| 5, 6 | Même retour ; remettre les adresses en `epc2i-postgres:5432/epc2i` (script ou interface) et les variables de P4 ; refaire 6.3 avec l'ancien nom si l'on revient complètement. |
| Copie inutilisable | Plan de secours, restauration logique dans les nouveaux volumes : vider le volume `…_atrium_pgdata`, laisser l'image initialiser une base neuve (`init/` crée `atrium` et les rôles avec les mots de passe de la ressource), puis restaurer par schéma depuis `/sauvegardes/complet-….dump` (`pg_restore -U postgres -d atrium --schema=<schéma> --no-owner --role=<outil>_app`, puis `partage/14-reprise-publications.sql` et `partage/90-droits.sql`, procédure de `infra/postgres/README.md`, « Sauvegarde et restauration »), contrôlé par `compter.sql`. Plus long (une à deux heures) : à ne choisir que si la copie a échoué et que l'on ne revient pas aux anciens volumes. |
| Ancienne sauvegarde à restaurer plus tard | Les `.dump` par schéma ne nomment pas la base ; `roles.sql` et `globaux-….sql` d'avant citent `epc2i` et `epc2i_sauvegarde` : ne pas les rejouer tels quels, rejouer `init/01` à `03`. |

## 10. Risques

| Risque | Parade |
|---|---|
| `postgres` déployé avant la copie (fusion de la PR, clic « Redeploy ») : base neuve et vide, outils coupés | P1 ; vérification 4.6 ; retour : Rollback, les anciens volumes sont intacts. |
| Nouveau volume créé sous un autre nom que celui que Coolify attend (préfixe, étiquettes) : Coolify en crée un vide | Noms et étiquettes relevés (§ 5) ; vérification 4.6 (« init process complete » absent, montages) ; reprendre 4.5. |
| Copie incomplète ou faite base démarrée | 4.4 vérifie l'arrêt ; 4.5 compare fichiers et tailles ; 4.6 compare le comptage exact. |
| Place disque insuffisante | P9. |
| Outil dont le compose écrit `/epc2i` (P4) ou qui contrôle le nom de la base (P5) | Prérequis avant la fenêtre ; sinon l'outil reste arrêté jusqu'à son correctif. |
| Session qui empêche le renommage | Le script ferme la base, coupe les sessions et attend 10 s ; sinon il échoue sans rien renommer. |
| Mot de passe du rôle des sauvegardes effacé | SCRAM vérifié au relevé ; le script refuse en MD5. |
| Nom de la filiale réécrit par Matrix | 6.3 par l'écran ou l'API de Matrix, jamais par un `UPDATE` seul. |
| Secret affiché | Le script n'imprime que des noms ; aucune commande de la fiche n'affiche un mot de passe ; `globaux-….sql` reste en mode 600. |

## 11. Hors du serveur commun

Les autres dépôts nomment encore l'ancien nom dans leur documentation, leurs exemples et parfois leur code (adresses
d'expéditeur de Keystone, identifiant de son application Mac, colonne `capex_lots.epc2i` d'Arche, commentaire de
`crucible.facility_partners`). Chaque session d'outil les traite dans son dépôt (§ 13) ; seuls P4 et P5 conditionnent la
fenêtre. Le catalogue des tables de Matrix (`data/catalogue.json`, et la maquette qui l'embarque) recopie le schéma réel
des outils : il suivra au prochain `npm run collecter`, une fois leurs dépôts corrigés.

## 12. Répétition du 27/11/2026

`scripts/essai-renommage.sh` : un dossier de données par « volume ». Socle de `main` au 27/11/2026 (a01da74), référentiels
et liens, 1 000 lignes d'essai ; comptage avant (`compter.sql`), sauvegarde par le nouveau script avec l'ancienne variable ;
arrêt, `cp -a` de l'ancien volume dans un nouveau, démarrage sur la copie ; socle de cette branche en mode transition,
comptage identique, `droits.verifier()` sans erreur ; renommage avec une session de `keystone_app` ouverte (coupée),
droits CONNECT et réglages gardés, `atrium_sauvegarde` connecté avec son mot de passe d'avant (SCRAM), `keystone_app` avec
son `search_path`, script rejouable ; socle rejoué, sauvegardes avec l'ancienne puis la nouvelle variable, liens,
`verifier-droits.sql` conforme (155 cas), comptage identique hormis le nom de la base ; retour arrière par
`retour-epc2i.sql`, puis redémarrage sur l'ancien volume : base `epc2i`, comptage identique à celui d'avant la fenêtre.
Sur un socle neuf (CI) : base `atrium`, rôle `atrium_sauvegarde`, `scripts/ci-socle.sh` complet et les tests avec base passent.

## 13. Demandes aux autres outils (brouillons, à porter dans leur `REQUESTS.md` après « validé »)

| Outil | Demande | Pourquoi | Sans elle |
|---|---|---|---|
| Clavis, Arche, Crucible, Modulus | `deploy/compose.shared.yaml` : `DATABASE_URL` composée de `${ATRIUM_PG_HOST:-epc2i-postgres}` et `${ATRIUM_PG_DATABASE:-epc2i}` (puis défauts `atrium-postgres` / `atrium` au nettoyage) ; textes « epc2i-postgres » des commentaires. | P4 : leur adresse est écrite dans le compose, pas dans une variable. | L'outil ne redémarre pas après la fenêtre. |
| Cursus | `BASE_COMMUNE` : accepter `atrium` et `epc2i` (puis `atrium` seul) ; textes de `pre-vol.ts` et `.env.example`. | P5 : contrôle de production et protection de la démonstration. | Contrôle de production bloquant ; démonstration non reconnue sur la base commune. |
| Cursus, Keystone, Vigie | Messages `atrium.…/2` : récepteurs `/1` et `/2`, puis émetteur `/2`, puis retrait de `/1` (`docs/remplacement-lucca.md` § 3.11). | M-28. | Les contrats v1 restent dans Matrix. |
| Arche | Colonne `capex_lots.epc2i` (booléen « lot alimenté par un projet de l'entreprise ») et valeur `'epc2i'` du type de barre du Gantt (`src/components/charts/capex-gantt.tsx`) : nouveau nom, par exemple `capex_lots.interne`, par une migration (colonne ajoutée, recopiée, l'ancienne retirée plus tard) ; commentaire « projets EPC2i » de la table. Si une vue `pub_` la publie, passer d'abord par Matrix (nouvelle colonne en fin de vue). | M-26 : aucune allusion à l'ancien nom ; le catalogue de Matrix la recopie. | Le catalogue et la maquette de Matrix la montrent encore. |
| Crucible | Commentaire de la table `facility_partners` (« laboratoire 67 → » ancien nom de la filiale) ; entité partenaire nommée d'après `matrix.pub_filiales` (« Filiale partenaire » après 6.3) ; codes d'entités qui contiennent l'ancien nom (relevé : `EPC2I`, `EPCFR`), s'ils sont affichés. | M-26, M-27. | Le catalogue de Matrix recopie le commentaire. |
| Keystone | Copie ancienne du socle `infra/postgres-socle/` (à retirer ou à marquer « jamais sur le serveur ») ; adresses d'expéditeur et identifiant de l'application Mac. | P6, M-26. | Risque de la jouer sur le serveur renommé. |

## 14. Décisions prises et à prendre

| N° | Question | Réponse ou choix par défaut |
|---|---|---|
| R-1 | Date de la fenêtre et annonce aux utilisateurs. | À fixer : hors heures d'usage, hors 2 h 15. |
| R-2 | Nom de la filiale `SMC`. | Tranché (M-27) : « Filiale partenaire », codes inchangés, étape 6.3. |
| R-3 | Identifiants des messages de Cursus. | Tranché (M-28) : version 2 `atrium.…/2`, mêmes champs. |
| R-4 | Porter les demandes du § 13 dans les `REQUESTS.md` des outils, ou les faire faire par leurs sessions (autorisation multi-dépôts du 23/11/2026). | Demandes après « validé ». |
| R-5 | Noms DNS réels et domaine des adresses de l'entreprise. | Inchangés par cette fiche ; seuls les exemples des docs sont renommés. |
| R-6 | Copie des volumes par l'hôte : qui la fait (accès SSH, P8). | Le propriétaire, si la session de Claude n'a pas d'accès à l'hôte. |

## Annexe A — serveur installé directement (sans Coolify)

Seulement si un serveur a été installé selon une version antérieure de `docs/installation-directe.md` (dossiers `/etc/epc2i`,
services `epc2i-*`, compte système `epc2i`). Pas de volume à copier : le cluster reste où il est. Dans la même fenêtre :

1. `systemctl stop 'epc2i-*'` ; sauvegardes (étape 4.3) ; `pg_hba.conf` : ajouter les lignes `atrium` à côté des lignes
   `epc2i` (une ligne qui nomme la base suit son nom), `systemctl reload postgresql`.
2. `renommer-atrium.sql` (étape 4.8), comptage avant et après (`compter.sql`).
3. `mv /etc/epc2i /etc/atrium`, de même `/opt/epc2i`, `/var/lib/epc2i`, `/var/backups/epc2i` ; dans chaque `/etc/atrium/*.env` :
   `sed -i 's#/epc2i\b#/atrium#g' <fichier>` (sans afficher le fichier) ; `EPC2I_SAUVEGARDE_PASSWORD` →
   `ATRIUM_SAUVEGARDE_PASSWORD` dans `postgres.env`.
4. Compte système : `usermod -l atrium -d /opt/atrium epc2i && groupmod -n atrium epc2i`.
5. Services : renommer `/etc/systemd/system/epc2i-*.service` en `atrium-*.service` (chemins et `User=atrium` dedans), `crontab`
   (chemins, journaux `/var/log/atrium-*.log`), `systemctl daemon-reload && systemctl enable --now atrium-…` ; retirer les
   lignes `epc2i` de `pg_hba.conf`.
6. Filiale (étape 6.3) et contrôles de l'étape 7.
