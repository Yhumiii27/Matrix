# Renommage du serveur commun en Atrium — fiche d'opération

Décision du propriétaire du 27/11/2026 (M-26 de `docs/decisions.md`) : la suite s'appelle **Atrium**, et les identifiants
techniques du serveur commun changent dès maintenant. Cette fiche dit, dans l'ordre, comment renommer le serveur en
service sans perdre de données ni couper un outil plus longtemps que nécessaire.

**État : préparée, rien n'est joué.** Rien n'a été fait sur le serveur ni dans Coolify. Chaque étape marquée « validé »
attend le « validé » explicite du propriétaire (`docs/delegation-claude.md` § 2). Les fichiers du dépôt marchent déjà
avant, pendant et après le renommage (§ 2) ; ce qui est écrit ici a été répété sur un PostgreSQL 16 jetable
(`scripts/essai-renommage.sh`, § 12).

## 1. Ce qui change, ce qui ne change pas

| Ancien | Nouveau | Où | Quand |
|---|---|---|---|
| base `epc2i` | `atrium` | serveur commun ; `DATABASE_URL` de chaque outil | étape 4 (fenêtre) |
| hôte `epc2i-postgres` | `atrium-postgres` | alias réseau du compose ; `DATABASE_URL` de chaque outil | alias : étape 2 ; adresses : étape 3 ou 5 |
| rôle `epc2i_sauvegarde` | `atrium_sauvegarde` | serveur commun | étape 4 |
| variable `EPC2I_SAUVEGARDE_PASSWORD` | `ATRIUM_SAUVEGARDE_PASSWORD` | ressource `postgres` de Coolify | étape 2 (copie), étape 9 (retrait) |
| `EPC2I_SAUVEGARDE_DIR`, `_JOURS`, `EPC2I_LIENS_ETAT`, `_FORCER`, `EPC2I_PARTAGE_DIR`, `EPC2I_PG_PORT`, `EPC2I_DOCKER_NETWORK` | `ATRIUM_…` | compose, scripts, poste local | dépôt (anciens lus en repli jusqu'à l'étape 9) |
| `/opt/epc2i/` dans l'image | `/opt/atrium/` | image `postgres`, commandes des tâches planifiées | image : étape 2 (lien `/opt/epc2i` gardé) ; tâches : étape 8 |
| `/etc/epc2i/`, `/var/lib/epc2i/`, `/var/backups/epc2i/`, services `epc2i-*`, compte `epc2i` | `atrium` | installation directe (`docs/installation-directe.md`) | annexe A, seulement sur un serveur installé ainsi |
| cookie `epc2i-theme` | `atrium-theme` | Matrix (et Norma 3.0 pour les autres outils) | dépôt ; l'ancien cookie est lu en repli |
| nom de la ressource Coolify `epc2i-postgres` | `atrium-postgres` | affichage dans Coolify | étape 8 (purement affiché) |

Ce qui garde son nom, et pourquoi :

| Identifiant | Raison |
|---|---|
| Clés des volumes `epc2i_pgdata`, `epc2i_sauvegardes` (compose) | Coolify nomme chaque volume `<identifiant de la ressource>_<clé>`. Une autre clé serait un **volume neuf et vide** : au redéploiement, l'image initialiserait une base vide. C'est le seul piège qui fait perdre des données ; `test/renommage.test.mjs` interdit de les renommer. |
| Identifiant (UUID) de la ressource Coolify, projet « Outils PM » | Ne contiennent pas « epc2i » ; les changer recréerait la ressource. |
| Rôles `<outil>_app`, `matrix_*`, `bi_reader`, `cursus_purge`, schémas, vues `pub_` | Aucun ne porte le nom de la suite. |
| Verrous consultatifs (`hashtext('keystone.ecritures')`, `'vigie.migrations'`…) et `application_name` des outils | Relevé du 27/11/2026 dans tous les dépôts : aucun ne contient « epc2i » (ils portent le nom de l'outil). Rien à faire. |
| Noms des dossiers de sauvegarde | Horodatages (`2026-11-27_021500`), sans nom de suite. Les sauvegardes restent dans le volume `…_epc2i_sauvegardes`, monté sur `/sauvegardes`. |
| Messages `epc2i.heures.validees/1`, `epc2i.absence.validee/1`… (`data/contrats/`) | Contrats d'échange de Cursus avec Keystone et Vigie : un nouvel identifiant est une version nouvelle du contrat, à décider avec les outils (question R-3, § 13). |
| Filiale `SMC` « EPC France » (`matrix.filiales`, `data/referentiels.json`) | Nom d'une société du groupe, donnée et non nom de la suite (question R-2). |

## 2. Principe : les deux noms acceptés pendant la transition

Le dépôt est prêt à l'avance, et chaque fichier joué sur le serveur prend ce qu'il trouve :

| Fichier | Comportement pendant la transition |
|---|---|
| `init/01`, `02`, `03`, `partage/90-droits.sql`, `verifier-droits.sql` | Base `atrium` si elle existe, sinon `epc2i`, sinon création de `atrium` (`-v base=…` l'impose) ; rôle des sauvegardes `atrium_sauvegarde`, sinon `epc2i_sauvegarde`. `init/01` le dit (« Renommage en Atrium pas encore fait »). Ils ne renomment jamais rien. |
| `droits.verifier()` (posée par `init/03`) | Contrôle le rôle des sauvegardes sous ses deux noms. **À poser avant le renommage** (étape 2) : l'ancienne fonction cite `epc2i_sauvegarde` et échouerait après. |
| `sauvegarde/sauvegarder.sh` | Se connecte avec `atrium_sauvegarde`, sinon `epc2i_sauvegarde`, sur `atrium`, sinon `epc2i` ; mot de passe `ATRIUM_SAUVEGARDE_PASSWORD`, sinon `EPC2I_SAUVEGARDE_PASSWORD`. Écrit dans son journal la base et le rôle pris. |
| `partage/appliquer-liens.sh` | Base `atrium`, sinon `epc2i` (`ATRIUM_BASE` l'impose) ; anciennes variables lues en repli. |
| `docker-compose.yml` | Deux alias réseau, `atrium-postgres` et `epc2i-postgres` ; les deux variables de mot de passe facultatives (l'une des deux doit être remplie, `init/01` refuse sinon) ; contrôle de santé sur la base `postgres` (présente avant comme après). |
| `Dockerfile` | Fichiers dans `/opt/atrium/`, `/opt/epc2i` gardé comme lien : les tâches planifiées actuelles marchent sans changement. |
| `renommage/renommer-atrium.sql`, `retour-epc2i.sql` | Le renommage et son retour arrière, rejouables, avec leurs contrôles. |
| `scripts/renommage-envs-coolify.mjs` | Relevé puis réécriture des variables des ressources Coolify (hôte, base, rôle, chemins), sans jamais afficher une valeur. |

## 3. Qui fait quoi

| Rôle | Qui | Quoi |
|---|---|---|
| Propriétaire | Guillaume Garrigue | Décide la date de la fenêtre, donne les « validé » (étapes 2, 3, 4 à 8, 9), prévient les utilisateurs. |
| Opérateur | Claude par l'API de Coolify, après chaque « validé » ; ou le propriétaire dans l'interface | Étapes 1 à 9. Jeton de l'API Coolify passé par l'environnement, jamais écrit. |
| Sessions des outils | une par dépôt (Clavis, Arche, Crucible, Modulus, Cursus) | Prérequis P3 et P4 : leur code accepte le nouveau nom avant la fenêtre. |
| DSI | | Rien à faire côté Entra ni DNS : les adresses publiques des outils ne changent pas. |

## 4. Prérequis (avant tout « validé » de l'étape 2)

| | Prérequis | Vérification |
|---|---|---|
| P1 | La PR de cette fiche est fusionnée dans `main` (sur demande du propriétaire), CI verte. | Coolify construit l'image `postgres` depuis `main`. |
| P2 | Répétition jouée : `bash scripts/essai-renommage.sh` sur un poste avec PostgreSQL 16, jamais sur le serveur. | « Répétition terminée sans erreur. » |
| P3 | **Clavis, Arche, Crucible, Modulus** : leur `deploy/compose.shared.yaml` écrit lui-même `DATABASE_URL` avec `/epc2i` en dur et l'hôte `${EPC2I_PG_HOST:-epc2i-postgres}`. Réécrire leurs variables Coolify ne suffit donc pas : chacun doit d'abord lire le nom de la base et l'hôte de variables, avec les valeurs actuelles par défaut, par exemple `@${ATRIUM_PG_HOST:-epc2i-postgres}:5432/${ATRIUM_PG_DATABASE:-epc2i}` (pas de valeur par défaut imbriquée : l'interpolation de Coolify n'est pas garantie). Demande à porter dans leur `REQUESTS.md` après « validé ». | Chacun redéployé avec ce compose, toujours connecté à `epc2i`. |
| P4 | **Cursus** : `BASE_COMMUNE = 'epc2i'` (`server/src/config.ts`) sert au contrôle de production (« base epc2i » bloquant dans `verifier-production`) et à la protection qui refuse une démonstration sur la base commune. Après le renommage, cette protection ne reconnaîtrait plus `atrium`. Cursus doit accepter les deux noms avant la fenêtre. Même demande que P3. | Contrôle de production de Cursus vert sur `atrium` comme sur `epc2i`. |
| P5 | Keystone garde une ancienne copie du socle (`infra/postgres-socle/`, base `epc2i`) : elle ne doit jamais être jouée sur le serveur (elle recréerait une base `epc2i` vide après le renommage). À signaler à la session de Keystone. | Aucune tâche Coolify ne la joue. |
| P6 | Fenêtre choisie hors des heures d'usage et hors de la tâche de sauvegarde nocturne (2 h 15) ; utilisateurs prévenus. | Annonce faite. |

## 5. Relevé, sans rien changer (étape 1)

Fait par l'opérateur, en lecture seule, la veille ou le jour même. Il ne demande pas de « validé » (`docs/delegation-claude.md` § 1).

1. **Ressources et variables.** `COOLIFY_URL=… COOLIFY_TOKEN=… node scripts/renommage-envs-coolify.mjs` : pour chaque ressource,
   chaque variable qui contient « epc2i » (nom seulement), ce qui sera réécrit (hôte, base, rôle, chemin) et ce qui reste à voir
   à la main. Garder la sortie dans le compte rendu (elle ne contient aucune valeur). Les ressources attendues : `postgres`
   (le serveur) et les 11 applications qui y sont reliées — Matrix, Clavis, Keystone, Codex, Cursus, Vigie, Arche, Crucible,
   Modulus, Vector, plus la 11ᵉ que le relevé fait apparaître (une ressource dont une variable nomme `epc2i-postgres`, ou dont
   le compose le nomme, P3). La liste du relevé fait foi.
2. **Tâches planifiées de la ressource `postgres`** (`REJEU_SOCLE`, `APPLIQUER_LIENS`, `SAVE_DAILY`) : noter la commande exacte de
   chacune (interface Coolify, onglet « Scheduled Tasks »). Attendu : `SAVE_DAILY` = `sh /opt/epc2i/sauvegarde/sauvegarder.sh`,
   `APPLIQUER_LIENS` = `sh /opt/epc2i/partage/appliquer-liens.sh`, `REJEU_SOCLE` = la boucle sur `/docker-entrypoint-initdb.d/*.sql`.
3. **Volumes** de la ressource `postgres` : noter le nom complet des deux volumes (onglet « Persistent Storage » ; ils finissent par
   `epc2i_pgdata` et `epc2i_sauvegardes`). Ils doivent être identiques après l'étape 2.
4. **Base**, en `postgres` dans le terminal du conteneur :
   ```sql
   SELECT datname FROM pg_database WHERE datname IN ('epc2i', 'atrium');                       -- epc2i seule
   SELECT rolname, left(rolpassword, 13) FROM pg_authid WHERE rolname LIKE '%\_sauvegarde';   -- epc2i_sauvegarde | SCRAM-SHA-256
   SELECT application_name, usename, count(*) FROM pg_stat_activity WHERE datname = 'epc2i' GROUP BY 1, 2 ORDER BY 1, 2;
   SELECT count(*) FROM pg_db_role_setting d JOIN pg_database b ON b.oid = d.setdatabase WHERE b.datname = 'epc2i';
   SELECT gravite, objet, constat FROM droits.verifier() WHERE gravite <> 'info';
   ```
   Le mot de passe de `epc2i_sauvegarde` doit être en SCRAM : PostgreSQL efface un mot de passe MD5 au renommage du rôle (il
   garde un SCRAM, vérifié à la répétition). En MD5, rejouer d'abord `init/01` (il pose le mot de passe en SCRAM).
   `pg_stat_activity` donne la liste réelle des outils connectés : elle doit recouper celle du point 1.

## 6. Temps A — préparation, sans changer de nom (étapes 2 et 3)

Coupure de l'ordre d'une minute pour tous les outils au redéploiement de `postgres` ; à faire quelques jours avant la fenêtre.

### Étape 2 — nouvelle image du serveur, socle rejoué (« validé »)

| | Action | Vérification | Retour arrière |
|---|---|---|---|
| 2.1 | Sauvegarde : lancer `SAVE_DAILY` à la main. | Journal : « terminée : /sauvegardes/<horodatage> » ; dans le conteneur, `cd /sauvegardes/<horodatage> && sha256sum -c SHA256SUMS` tout « OK ». | — |
| 2.2 | Ressource `postgres` : ajouter `ATRIUM_SAUVEGARDE_PASSWORD` avec la valeur de `EPC2I_SAUVEGARDE_PASSWORD`, cochée « Available at Build Time », sans l'afficher : `node scripts/renommage-envs-coolify.mjs --ressources=postgres --cles --appliquer`. Garder l'ancienne. | Le script écrit « copiée vers ATRIUM_SAUVEGARDE_PASSWORD ». | Supprimer la nouvelle variable. |
| 2.3 | Redéployer la ressource `postgres` (nouvelle image depuis `main`). | Journal du conteneur : pas de « PostgreSQL init process complete » (le volume n'est pas neuf) ; volumes identiques au relevé (§ 5, point 3) ; `SELECT count(*) FROM matrix.liens;` non nul ; `ls -l /opt/epc2i` → lien vers `/opt/atrium` ; depuis le terminal d'un outil, `getent hosts atrium-postgres` et `getent hosts epc2i-postgres` répondent la même adresse. Chaque outil répond 200 sur sa route de santé. | Redéployer la révision précédente de `main` (Coolify, « Rollback »). **Si une base vide a démarré** (init joué, `matrix.liens` absent) : arrêter aussitôt, ne rien écrire ; c'est un volume neuf, les données sont dans l'ancien volume (nom relevé) : le remonter. |
| 2.4 | Lancer `REJEU_SOCLE` (socle de la nouvelle image). | Journal : « Renommage en Atrium pas encore fait sur ce serveur : base epc2i, rôle des sauvegardes epc2i_sauvegarde », « Étape 3 terminée » ; `SELECT count(*) FROM droits.verifier() WHERE gravite = 'erreur';` = 0. | Le socle précédent se rejoue de même (rien n'est renommé). |
| 2.5 | Lancer `SAVE_DAILY` puis `APPLIQUER_LIENS` à la main (anciennes commandes, par le lien `/opt/epc2i`). | « base epc2i, rôle epc2i_sauvegarde » ; « registre et droits concordent » ou « terminé ». | — |
| 2.6 | `psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /opt/atrium/verifier-droits.sql` | « Tous les cas sont conformes ». | — |

### Étape 3 — hôte des outils (facultatif ici, sinon à l'étape 5 ; « validé »)

L'alias `atrium-postgres` répondant depuis l'étape 2, chaque outil peut passer au nouvel hôte avant la fenêtre, un par un,
en gardant la base `epc2i`. Cela raccourcit la fenêtre et sépare les risques.

| | Action | Vérification | Retour arrière |
|---|---|---|---|
| 3.1 | `node scripts/renommage-envs-coolify.mjs --parties=hote --appliquer` (toutes les variables où l'hôte apparaît, Matrix compris : `MATRIX_DATABASE_URL`, `MATRIX_GESTION_DATABASE_URL`). Pour les outils de P3 : `--ressources=clavis,arche,crucible,modulus --poser=ATRIUM_PG_HOST=atrium-postgres --appliquer`. | Le script ne liste plus d'« hôte » à réécrire. | Relancer sur les mêmes ressources avec `--poser=ATRIUM_PG_HOST=epc2i-postgres`, ou remettre la valeur dans l'interface. L'ancien alias reste valable. |
| 3.2 | Redémarrer chaque outil touché, un par un (Clavis d'abord). | Route de santé 200 ; connexion d'un utilisateur ; dans `pg_stat_activity`, l'outil est de nouveau connecté. | Idem 3.1. |

## 7. Temps B — la fenêtre (étapes 4 à 7, « validé » du jour)

Durée de coupure estimée : **30 à 45 minutes** (annoncer une heure). Arrêt 2 min ; sauvegarde 2 à 5 min selon le volume ;
renommage moins d'une minute ; variables 2 min ; redémarrage des 11 applications 10 à 20 min (une à trois minutes chacune,
en parallèle par groupes) ; contrôles 10 min.

### Étape 4 — arrêt, sauvegarde, renommage

| | Action | Vérification | Retour arrière |
|---|---|---|---|
| 4.1 | Arrêter les 11 applications (API Coolify `stop`, ou l'interface), Matrix compris. Désactiver `APPLIQUER_LIENS` et `SAVE_DAILY` pendant la fenêtre (ou accepter qu'un passage échoue). | Chaque ressource « Exited ». En `postgres` : `SELECT application_name, usename FROM pg_stat_activity WHERE datname = 'epc2i';` ne montre plus que des sessions d'administration. | Redémarrer les applications : rien n'a changé. |
| 4.2 | Sauvegarde fraîche : `SAVE_DAILY` à la main. | « base epc2i, rôle epc2i_sauvegarde », « terminée : /sauvegardes/<horodatage> » ; `sha256sum -c SHA256SUMS` tout « OK » ; `pg_restore --list /sauvegardes/<horodatage>/keystone.dump \| head` lisible ; taille comparable à la veille (`du -sh /sauvegardes/*`). **Noter l'horodatage dans le compte rendu.** | — |
| 4.3 | Renommage : `psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /opt/atrium/renommage/renommer-atrium.sql`. Il refuse s'il est lancé sur `epc2i`, si `atrium` existe déjà, si le mot de passe est en MD5 ; il ferme la base aux nouvelles connexions (`ALLOW_CONNECTIONS false`), coupe les sessions restantes (la liste s'affiche avant), renomme, rouvre, renomme le rôle. | Il affiche : `atrium \| t \| <n>` (base ouverte, droits CONNECT gardés : 17 à la répétition), le nombre de réglages de la base (13 à la répétition : `ALTER DATABASE … SET` et `ALTER ROLE … IN DATABASE … SET` suivent l'identifiant de la base), `atrium_sauvegarde \| t \| t \| t \| t` (connexion, SCRAM gardé, lecture de tout, CONNECT). | `psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /opt/atrium/renommage/retour-epc2i.sql`, puis redémarrer les applications (leurs adresses n'ont pas encore changé). |
| 4.4 | Contrôles immédiats : `\l` ; `SELECT count(*) FROM droits.verifier() WHERE gravite = 'erreur';` sur `atrium` (attendu 0, sans rejeu : la fonction posée à l'étape 2.4 connaît les deux noms) ; `PGPASSWORD=… psql -h 127.0.0.1 -U atrium_sauvegarde -d atrium -c 'SELECT 1'` avec le mot de passe de la variable (sans l'afficher : `PGPASSWORD="$ATRIUM_SAUVEGARDE_PASSWORD"`). | Tout répond. | Idem 4.3. |

Une base n'a pas de « base par défaut » côté rôle : chaque outil choisit la base dans son adresse. Rien d'autre à changer
dans PostgreSQL ; `pg_hba.conf` de l'image officielle ne nomme pas de base (`host all all all scram-sha-256`). Sur une
installation directe, voir l'annexe A.

### Étape 5 — adresses des outils

| | Action | Vérification | Retour arrière |
|---|---|---|---|
| 5.1 | `node scripts/renommage-envs-coolify.mjs --appliquer` (base, et hôte si l'étape 3 n'a pas été faite ; Matrix compris). Pour les outils de P3 : `--ressources=clavis,arche,crucible,modulus --poser=ATRIUM_PG_DATABASE=atrium,ATRIUM_PG_HOST=atrium-postgres --appliquer`. Cursus : `DATABASE_URL` et `CURSUS_PURGE_DATABASE_URL` sont réécrites par la même commande. | Relancé sans `--appliquer`, le script n'annonce plus rien à écrire ; les seules lignes restantes sont `EPC2I_SAUVEGARDE_PASSWORD` (clé gardée jusqu'à l'étape 9) et les cas « à voir à la main », traités un par un. | Remettre `/epc2i` : `retour-epc2i.sql` d'abord, puis les variables à la main ou par l'interface (l'hôte peut rester `atrium-postgres`, l'alias répond). |

### Étape 6 — redémarrage, dans l'ordre

1. **Clavis** d'abord : les autres outils lisent `clavis.pub_acces` à chaque connexion d'un utilisateur.
2. **Matrix** : sa sonde relit le serveur au démarrage.
3. Keystone, Codex, Cursus, Vigie, Arche, Crucible, Modulus, Vector, puis la 11ᵉ ressource du relevé (leurs workers avec eux).

Les ressources « Docker Compose » prennent une variable changée au redéploiement (interpolation du compose) ; les autres au
redémarrage. Après chacune : route de santé 200 (`/api/health`, `/api/sante` pour Matrix), journal sans « database "epc2i"
does not exist » ni « permission denied for database ».

### Étape 7 — contrôles d'après

| | Contrôle | Attendu |
|---|---|---|
| 7.1 | `REJEU_SOCLE` | « Étape 1 terminée : base atrium et rôles en place », sans la ligne « pas encore fait » ; « Étape 3 terminée », écarts vides. |
| 7.2 | `SELECT gravite, objet, constat FROM droits.verifier() WHERE gravite = 'erreur';` (sur `atrium`) | Vide. |
| 7.3 | `psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /opt/atrium/verifier-droits.sql` | « Tous les cas sont conformes ». |
| 7.4 | Réactiver puis lancer `SAVE_DAILY` et `APPLIQUER_LIENS` à la main. | « base atrium, rôle atrium_sauvegarde » ; liens « concordent » ou « terminé ». |
| 7.5 | `SELECT application_name, usename, count(*) FROM pg_stat_activity WHERE datname = 'atrium' GROUP BY 1, 2 ORDER BY 1, 2;` | Les outils du relevé (§ 5, point 4), tous revenus. |
| 7.6 | Matrix : écran Santé (liens appliqués, aucun « à appliquer »), écran Publications (aucune en « erreur »), `/api/sante` (champ `historique` : serveur commun). | Comme avant la fenêtre. |
| 7.7 | Recette rapide : une connexion par Clavis à Keystone puis Codex ; une lecture croisée (Arche lit `keystone.pub_projets`, Crucible `vigie.pub_controles`). | Comme avant. |
| 7.8 | Annoncer la fin de la coupure. | — |

### Étape 8 — tâches planifiées et noms affichés (« validé »)

- Commandes : `SAVE_DAILY` → `sh /opt/atrium/sauvegarde/sauvegarder.sh`, `APPLIQUER_LIENS` → `sh /opt/atrium/partage/appliquer-liens.sh`
  (`REJEU_SOCLE` ne nomme pas `/opt/epc2i`). Lancer chacune une fois à la main.
- Ressource `postgres` : nom affiché `atrium-postgres` (Coolify garde son identifiant et ses volumes). Aucune autre ressource
  n'a besoin d'être renommée pour le serveur ; les noms des applications sont ceux des outils.

## 8. Nettoyage (étape 9, deux semaines après au plus tôt, PR et « validé »)

Une fois `pg_stat_activity` et le relevé du script sans plus aucune trace de l'ancien nom :

| Quoi | Où |
|---|---|
| Alias `epc2i-postgres` | `infra/postgres/docker-compose.yml` (puis redéployer `postgres`) |
| Variable `EPC2I_SAUVEGARDE_PASSWORD` | compose, `.env.example`, ressource `postgres` de Coolify |
| Lien `/opt/epc2i` | `infra/postgres/Dockerfile` |
| Replis vers `epc2i` / `epc2i_sauvegarde` / `EPC2I_*` | `init/01`, `02`, `03` (y compris `droits.verifier()`), `partage/90-droits.sql`, `verifier-droits.sql`, `sauvegarde/sauvegarder.sh`, `partage/appliquer-liens.sh`, `test/renommage.test.mjs` |
| Valeurs par défaut `epc2i` des outils de P3 et P4 | leurs dépôts (défaut `atrium-postgres` / `atrium`) |
| Cookie `epc2i-theme` lu en repli | `outils/theme.mjs`, une fois toute la suite passée à Norma 3.0 |
| `renommage/`, `scripts/essai-renommage.sh`, `scripts/renommage-envs-coolify.mjs` | gardés comme trace, ou retirés avec cette fiche |

## 9. Retour arrière, récapitulatif

| Après l'étape | Retour |
|---|---|
| 2 (image, socle) | Rollback de la ressource `postgres` vers la révision précédente ; le socle précédent se rejoue. Rien n'est renommé. |
| 3 (hôtes) | Remettre `epc2i-postgres` dans les adresses ; l'alias reste servi. |
| 4 (renommage) | `renommage/retour-epc2i.sql` (rejouable, rouvre aussi les connexions si le renommage s'est arrêté au milieu), puis redémarrer les applications. |
| 5 et 6 (adresses, redémarrage) | `retour-epc2i.sql`, puis les adresses en `/epc2i` (hôte au choix), redémarrage. |
| Perte de données constatée | Restauration de la sauvegarde de l'étape 4.2 (`infra/postgres/README.md`, « Sauvegarde et restauration »), après « validé ». Les fichiers `.dump` par schéma ne nomment pas la base : `pg_restore -d atrium --schema=<schéma> …`. `roles.sql` d'une sauvegarde antérieure cite `epc2i` et `epc2i_sauvegarde` (`ALTER ROLE … IN DATABASE epc2i SET …`) : ne pas le rejouer tel quel sur le serveur renommé ; rejouer `init/01` à `03` à la place. |

## 10. Risques

| Risque | Parade |
|---|---|
| Volume neuf monté au redéploiement (clé renommée, ou Coolify qui changerait de règle de nommage) : base vide | Clés gardées (test) ; vérification 2.3 avant tout ; la base vide n'a pas `epc2i`, les outils refusent de démarrer plutôt que d'écrire ailleurs. |
| Un outil dont le compose écrit lui-même `/epc2i` (P3) ou qui contrôle le nom de la base (P4) | Prérequis P3 et P4 avant la fenêtre ; sinon l'outil reste arrêté jusqu'à son correctif. |
| Session qui empêche le renommage | Le script ferme la base, coupe les sessions et attend 10 s ; sinon il échoue sans rien renommer et le dit. |
| Mot de passe du rôle des sauvegardes effacé | SCRAM vérifié au relevé ; le script refuse en MD5. |
| `droits.verifier()` ancienne après le renommage | Étape 2.4 obligatoire avant la fenêtre. |
| Variable restée sur l'ancien hôte | L'alias `epc2i-postgres` est servi jusqu'à l'étape 9. |
| Ancienne copie du socle de Keystone jouée sur le serveur | P5. |
| Secret affiché pendant l'opération | Le script n'imprime que des noms ; aucune commande de la fiche n'affiche un mot de passe (pas de `psql -e`, pas de `env`). |

## 11. Hors du serveur commun

Les autres dépôts nomment encore `epc2i` dans leur documentation, leurs exemples (`.env.example`, adresses de test) et parfois
leur code (adresses d'expéditeur `@epc2i.fr` de Keystone, identifiant d'application Mac `com.epc2i.keystone`, colonne
`capex_lots.epc2i` d'Arche). Chaque session d'outil les traite dans son dépôt ; seuls P3 et P4 conditionnent la fenêtre.

## 12. Répétition du 27/11/2026

`scripts/essai-renommage.sh` (cluster PostgreSQL 16 jetable, socle de `main` au 27/11/2026, a01da74, puis celui de cette branche) : socle
ancien, socle nouveau en transition (« Renommage pas encore fait »), sauvegarde et liens sur `epc2i`, `verifier-droits.sql`
conforme (155 cas) ; renommage avec une session de `keystone_app` ouverte (coupée), 17 droits CONNECT et 13 réglages gardés,
`atrium_sauvegarde` connecté avec son mot de passe d'avant (SCRAM), `keystone_app` avec son `search_path`,
`droits.verifier()` sans erreur avant tout rejeu, script rejouable ; socle rejoué sur `atrium`, sauvegarde avec l'ancienne
variable seule puis la nouvelle ; retour arrière, puis sauvegarde sur `epc2i`. Sur un socle neuf (CI) : base `atrium`, rôle
`atrium_sauvegarde`, `scripts/ci-socle.sh` complet et les tests avec base passent.

## 13. Décisions à prendre par le propriétaire

| N° | Question | Choix par défaut de cette fiche |
|---|---|---|
| R-1 | Date de la fenêtre et annonce aux utilisateurs. | Hors heures d'usage, hors 2 h 15. |
| R-2 | La filiale « EPC France » (`SMC`) garde-t-elle ce nom dans les référentiels ? C'est le nom d'une société, pas de la suite. | Gardé tel quel. |
| R-3 | Les identifiants des messages d'échange `epc2i.heures.*/1` et `epc2i.absence.*/1` (contrats de Cursus) passent-ils à `atrium.…/2` ? | Gardés : un changement d'identifiant est une version nouvelle, à décider avec Cursus, Keystone et Vigie. |
| R-4 | Porter les demandes P3 (Clavis, Arche, Crucible, Modulus) et P4 (Cursus) dans leur `REQUESTS.md`, ou les faire faire par leurs sessions (autorisation multi-dépôts du 23/11/2026). | Demandes après « validé ». |
| R-5 | Domaine d'exemple des adresses internes (`*.atrium.local` dans `docs/installation-directe.md`) et domaine réel des adresses de l'entreprise (`--domaine` de l'import de Clavis) : les noms DNS réels ne changent pas avec cette fiche. | Exemples renommés ; DNS inchangé. |

## Annexe A — serveur installé directement (sans Coolify)

Seulement si un serveur a été installé selon une version antérieure de `docs/installation-directe.md` (dossiers `/etc/epc2i`,
services `epc2i-*`, compte système `epc2i`). Même principe, dans la même fenêtre :

1. `systemctl stop 'epc2i-*'` ; sauvegarde (`sauvegarder.sh`, § 9 du guide) ; `pg_hba.conf` : ajouter les lignes `atrium` à côté
   des lignes `epc2i` (une ligne qui nomme la base suit son nom), `systemctl reload postgresql`.
2. `renommer-atrium.sql` (étape 4.3).
3. `mv /etc/epc2i /etc/atrium`, de même `/opt/epc2i`, `/var/lib/epc2i`, `/var/backups/epc2i` ; dans chaque `/etc/atrium/*.env` :
   `sed -i 's#/epc2i\b#/atrium#g' <fichier>` (base des adresses et chemins)
   (sans afficher le fichier) ; `EPC2I_SAUVEGARDE_PASSWORD` → `ATRIUM_SAUVEGARDE_PASSWORD` dans `postgres.env`.
4. Compte système : `usermod -l atrium -d /opt/atrium epc2i && groupmod -n atrium epc2i`.
5. Services : renommer `/etc/systemd/system/epc2i-*.service` en `atrium-*.service` (chemins et `User=atrium` dedans), `crontab`
   (chemins, journaux `/var/log/atrium-*.log`), `systemctl daemon-reload && systemctl enable --now atrium-…` ; retirer les
   lignes `epc2i` de `pg_hba.conf`.
6. Contrôles de l'étape 7.
