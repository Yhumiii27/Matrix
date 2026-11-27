# Installation directe sur le serveur interne (sans Docker ni Coolify)

Guide de mise en service du **StarterPack** (Matrix, Clavis, Keystone, Codex) sur un serveur Linux de l'entreprise, installé
directement par SSH. Chaque commande de ce guide a été jouée lors de la **répétition du 24 novembre 2026** (un cluster
PostgreSQL 16 neuf, les quatre outils sur leur branche `main`, l'annuaire réel importé, un vrai navigateur du premier mot de
passe jusqu'à chaque outil). Les écarts trouvés et leurs corrections sont au § 12.

Cursus, Vigie, Arche, Crucible, Modulus, Vector et Ingenium suivent le même schéma ensuite (§ 13).

## 0. Ce qu'il faut avant de commencer

| Élément | Valeur attendue |
| --- | --- |
| Système | Debian 12 ou Ubuntu 22.04/24.04, accès root par SSH |
| Node.js | 22 LTS (22.12 ou plus) — `node -v` |
| PostgreSQL | 16 (le serveur commun, décision D-27) avec `psql` |
| Mandataire HTTPS | nginx (ou celui de la DSI) avec un certificat pour chaque nom d'hôte |
| Noms d'hôte | un par outil dans le DNS interne, par exemple `clavis.atrium.local`, `keystone.…`, `codex.…`, `matrix.…` |
| Sources | les dépôts Matrix, Clavis, Keystone, Codex (archive de `main`, ou `git clone` avec un jeton de lecture) |
| Annuaire | le fichier CSV de l'organigramme (il nomme des personnes réelles : jamais dans Git, copié par `scp`) |
| Messagerie | **à choisir avec la DSI** avant d'envoyer des mots de passe provisoires : Graph `Mail.Send` ou SMTP |

Ports internes (jamais exposés, le mandataire seul les joint) : Clavis 3600, Keystone 3000, Codex 3100, Matrix 3700.

## 1. Comptes et dossiers

```bash
adduser --system --group --home /opt/atrium atrium
mkdir -p /opt/atrium /etc/atrium /var/lib/atrium/{clavis,keystone,codex,matrix} /var/backups/atrium/{clavis,postgres}
chmod 700 /etc/atrium
chown -R atrium:atrium /opt/atrium /var/lib/atrium /var/backups/atrium
```

- `/opt/atrium/<outil>` : le code de chaque outil ;
- `/etc/atrium/<outil>.env` : sa configuration et ses secrets (mode 600, propriétaire root, lus par systemd) ;
- `/var/lib/atrium/<outil>` : ses données (Clavis y garde **sa clé de signature OIDC**, `oidc/` : à sauvegarder) ;
- `/var/backups/atrium` : les sauvegardes.

## 2. PostgreSQL : mots de passe et socle

Mots de passe des rôles, générés une fois :

```bash
cd /etc/atrium && {
  for v in KEYSTONE CODEX CURSUS VIGIE ARCHE CRUCIBLE CLAVIS MODULUS VECTOR INGENIUM MATRIX; do echo "${v}_APP_PASSWORD=$(openssl rand -hex 24)"; done
  echo "MATRIX_GESTION_PASSWORD=$(openssl rand -hex 24)"
  echo "BI_READER_PASSWORD=$(openssl rand -hex 24)"
  echo "CURSUS_PURGE_PASSWORD=$(openssl rand -hex 24)"
  echo "ATRIUM_SAUVEGARDE_PASSWORD=$(openssl rand -hex 24)"
} > postgres.env && chmod 600 postgres.env
```

Socle, en superutilisateur (`init/` crée la base `atrium`, les rôles et les schémas, puis les droits par défaut) :

```bash
cd /opt/atrium/matrix/infra/postgres
set -a; . /etc/atrium/postgres.env; set +a
for f in init/01-base-et-roles.sql init/02-schemas.sql init/03-droits.sql; do
  sudo -u postgres --preserve-env psql -X -q -d postgres -v ON_ERROR_STOP=1 -f "$f" || break
done
```

Puis les tables de Matrix, en `matrix_app`, chaque fichier dans une transaction :

```bash
export PGHOST=127.0.0.1 PGPASSWORD=$MATRIX_APP_PASSWORD
for f in 10-matrix-referentiels 12-matrix-liens 13-matrix-publications 15-matrix-edition 16-matrix-historique 17-matrix-glossaire-qualite; do
  psql -X -q -U matrix_app -d atrium -v ON_ERROR_STOP=1 -1 -f partage/$f.sql || break
done
```

`pg_hba.conf` : `scram-sha-256` pour `127.0.0.1/32` sur la base `atrium` ; aucun accès depuis le réseau tant qu'aucun poste
(Power BI : `bi_reader`) n'en a besoin.

## 3. Code et compilation

Une archive de `main` par outil (sans historique ni fichier hors Git) :

```bash
cd /opt/atrium
for r in Matrix:matrix Clavis:clavis Keystone:keystone Codex:codex; do
  (cd ~/sources/${r%%:*} && git fetch -q origin main && git archive --prefix=${r##*:}/ FETCH_HEAD) | tar -x -C /opt/atrium
done
chown -R atrium:atrium /opt/atrium
```

Installation et compilation, **avec les adresses publiques** : Next.js inscrit les variables `NEXT_PUBLIC_*` dans le code au
moment du `build` ; une adresse changée ensuite demande une nouvelle compilation.

```bash
export NEXT_TELEMETRY_DISABLED=1 \
  NEXT_PUBLIC_KEYSTONE_URL=https://keystone.atrium.local NEXT_PUBLIC_CODEX_URL=https://codex.atrium.local \
  NEXT_PUBLIC_VIGIE_URL=https://vigie.atrium.local NEXT_PUBLIC_CURSUS_URL=https://cursus.atrium.local
for o in clavis keystone codex; do (cd /opt/atrium/$o && sudo -u atrium -E npm ci --no-audit --no-fund && sudo -u atrium -E npm run build) || break; done
(cd /opt/atrium/matrix && sudo -u atrium npm ci --no-audit --no-fund)   # Matrix n'a pas d'étape de compilation
```

Comptez 3 à 6 minutes par outil. Next.js doit être en **16.4.6** au moins : la 16.4.2 refuse de compiler
(`SecurityFatalError`, faille connue).

## 4. Configuration de chaque outil

Gabarits (remplacer `atrium.local` par le domaine réel ; `r` génère un secret de session) :

```bash
set -a; . /etc/atrium/postgres.env; set +a; cd /etc/atrium
DB=127.0.0.1:5432/atrium; r(){ openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48; }
cat > clavis.env <<EOF
NODE_ENV=production
PORT=3600
DATABASE_URL=postgres://clavis_app:$CLAVIS_APP_PASSWORD@$DB
CLAVIS_SEED=production
CLAVIS_AUTH=local
CLAVIS_PUBLIC_URL=https://clavis.atrium.local
CLAVIS_SESSION_SECRET=$(r)
CLAVIS_DATA_DIR=/var/lib/atrium/clavis
CLAVIS_BACKUP_DIR=/var/backups/atrium/clavis
EOF
cat > keystone.env <<EOF
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://keystone_app:$KEYSTONE_APP_PASSWORD@$DB
KEYSTONE_SEED=production
KEYSTONE_DATA_DIR=/var/lib/atrium/keystone
KEYSTONE_PUBLIC_URL=https://keystone.atrium.local
KEYSTONE_AUTH=entra
KEYSTONE_SESSION_SECRET=$(r)
ENTRA_ISSUER=https://clavis.atrium.local
ENTRA_CLIENT_ID=keystone
ENTRA_CLIENT_SECRET=a-remplir
ENTRA_REDIRECT_URI=https://keystone.atrium.local/api/auth/callback
KEYSTONE_PERSONS_FROM_TOKEN=on
KEYSTONE_ACCESS_FROM_CLAVIS=on
EOF
cat > codex.env <<EOF
NODE_ENV=production
DATABASE_URL=postgres://codex_app:$CODEX_APP_PASSWORD@$DB
CODEX_SEED=minimal
CODEX_DATA_DIR=/var/lib/atrium/codex
CODEX_AUTH=clavis
CODEX_PUBLIC_URL=https://codex.atrium.local
CODEX_CLAVIS_URL=https://clavis.atrium.local
CODEX_CLAVIS_CLIENT_ID=codex
CODEX_CLAVIS_CLIENT_SECRET=a-remplir
CODEX_SESSION_SECRET=$(r)
CODEX_TRUST_PROXY=1
EOF
cat > matrix.env <<EOF
NODE_ENV=production
PORT=3700
MATRIX_DATA_DIR=/var/lib/atrium/matrix
MATRIX_DATABASE_URL=postgres://matrix_app:$MATRIX_APP_PASSWORD@$DB
MATRIX_GESTION_DATABASE_URL=postgres://matrix_gestion:$MATRIX_GESTION_PASSWORD@$DB
MATRIX_PUBLIC_URL=https://matrix.atrium.local
MATRIX_SESSION_SECRET=$(r)
MATRIX_ENTRA_TENANT_ID=clavis
MATRIX_ENTRA_ISSUER=https://clavis.atrium.local
MATRIX_ENTRA_CLIENT_ID=matrix
MATRIX_ENTRA_CLIENT_SECRET=a-remplir
MATRIX_ACCES_CLAVIS=on
EOF
chmod 600 *.env
```

- `KEYSTONE_FILE_SCAN=off` seulement si l'antivirus (ClamAV) n'est pas encore installé ; sinon le laisser par défaut.
- Codex écoute sur 3100 par son script `start` (pas de `PORT`).
- Les `a-remplir` sont posés au § 7.

## 5. Migrations des outils

Dans cet ordre, Clavis d'abord (les autres lisent ses vues) :

```bash
for o in clavis keystone codex; do
  (cd /opt/atrium/$o && set -a && . /etc/atrium/$o.env && set +a && sudo -u atrium -E npm run -s db:migrate) || break
done
```

Puis, en superutilisateur, la reprise des publications des outils installés par Matrix (M-18) et l'application du registre
des liens :

```bash
cd /opt/atrium/matrix/infra/postgres && set -a && . /etc/atrium/postgres.env && set +a
sudo -u postgres --preserve-env psql -X -q -d atrium -v ON_ERROR_STOP=1 -v outils=keystone,codex -1 -f partage/14-reprise-publications.sql
sudo -u postgres ATRIUM_LIENS_ETAT=/var/lib/atrium/matrix/liens.etat sh partage/appliquer-liens.sh
```

`appliquer-liens.sh` ne fait rien quand les droits sont à jour : il tourne ensuite **toutes les 5 minutes** (§ 9), ce qui
applique les liens que la DSI autorise dans l'écran de Matrix.

## 6. Services systemd

Un service par outil (`/etc/systemd/system/atrium-<outil>.service`) ; exemple pour Keystone :

```ini
[Unit]
Description=Atrium Keystone
After=network.target postgresql.service

[Service]
User=atrium
WorkingDirectory=/opt/atrium/keystone
EnvironmentFile=/etc/atrium/keystone.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Pour Matrix : `WorkingDirectory=/opt/atrium/matrix`, `ExecStart=/usr/bin/node serveur.mjs`. Keystone et Clavis ont en plus
leur tâche de fond : `atrium-keystone-worker` et `atrium-clavis-worker`, même fichier avec `ExecStart=/usr/bin/npm run worker`.

```bash
systemctl daemon-reload
systemctl enable --now atrium-clavis atrium-matrix atrium-keystone atrium-codex atrium-keystone-worker atrium-clavis-worker
for u in 3600/api/health 3000/api/health 3100/api/health 3700/api/sante; do echo "$u → $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$u)"; done
```

Quatre `200` attendus.

## 7. Clavis : administrateur, annuaire, inscription des outils

```bash
cd /opt/atrium/clavis && set -a && . /etc/atrium/clavis.env && set +a
sudo -u atrium -E npm run -s admin:create -- <e-mail de l'administrateur DSI> "<Nom>"     # mot de passe provisoire affiché une fois
sudo -u atrium -E npm run -s directory:import -- /root/annuaire-initial.csv --domaine <domaine des adresses de l'entreprise>
```

Inscription des trois outils (le secret s'affiche **une seule fois** : le copier aussitôt dans le fichier de l'outil) :

```bash
sudo -u atrium -E npm run -s oidc:client -- keystone https://keystone.atrium.local/api/auth/callback "https://keystone.atrium.local/sign-in?signedOut=1"
sudo -u atrium -E npm run -s oidc:client -- codex https://codex.atrium.local/auth/retour https://codex.atrium.local/
sudo -u atrium -E npm run -s oidc:client -- matrix https://matrix.atrium.local/auth/retour
```

Secrets à poser : `ENTRA_CLIENT_SECRET` (keystone.env), `CODEX_CLAVIS_CLIENT_SECRET` (codex.env), `MATRIX_ENTRA_CLIENT_SECRET`
(matrix.env), puis `systemctl restart atrium-keystone atrium-codex atrium-matrix`. Ensuite, supprimer le fichier de
l'annuaire du serveur (`shred -u`).

## 8. Matrix : publier les vues de Clavis et autoriser leur lecture

Les droits des personnes se lisent dans `clavis.pub_acces` : tant que Matrix ne l'a pas publiée, **chaque connexion est
refusée** (lecture impossible = refus). Dans Matrix, écran « Publications » :

1. `clavis.pub_personnes` et `clavis.pub_acces` : « Appliquer » la définition proposée par le dépôt ;
   `clavis.pub_acces` publie `personne_id`, `application`, `autorise`, `niveau`, `domaine`, `role` (rôle principal),
   `ouvert`, `maj_le`, puis `roles` (`text[]`, tous les rôles en vigueur) et `perimetre` (`jsonb`, périmètre de chaque rôle),
   ajoutées en fin le 24/11/2026 (DM-1 de Clavis) : elles lisent `clavis.person_roles`, la migration `0004_person_roles` de
   Clavis doit donc être passée avant « Appliquer » ;
2. puis, dans « Liens entre outils », autoriser les lecteurs proposés (`keystone_app`, `codex_app`, `matrix_app`, …).

L'ordre compte : un lien vers une vue qui n'existe pas encore est refusé. `appliquer-liens.sh` pose les droits au passage
suivant (ou le lancer à la main, § 5).

## 9. Mandataire HTTPS, tâches planifiées, sauvegardes

nginx, un bloc par outil :

```nginx
server {
  listen 443 ssl http2;
  server_name keystone.atrium.local;
  ssl_certificate     /etc/ssl/atrium/keystone.crt;
  ssl_certificate_key /etc/ssl/atrium/keystone.key;
  client_max_body_size 60m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

`crontab -e` (root) :

```cron
*/5 * * * *  sudo -u postgres ATRIUM_LIENS_ETAT=/var/lib/atrium/matrix/liens.etat sh /opt/atrium/matrix/infra/postgres/partage/appliquer-liens.sh >> /var/log/atrium-liens.log 2>&1
30 2 * * *   . /etc/atrium/postgres.env; PGHOST=127.0.0.1 PGPASSWORD=$ATRIUM_SAUVEGARDE_PASSWORD ATRIUM_SAUVEGARDE_DIR=/var/backups/atrium/postgres sh /opt/atrium/matrix/infra/postgres/sauvegarde/sauvegarder.sh >> /var/log/atrium-sauvegarde.log 2>&1
45 2 * * *   tar -C /var/lib/atrium -czf /var/backups/atrium/donnees-$(date +\%F).tgz clavis codex keystone matrix && find /var/backups/atrium -name 'donnees-*.tgz' -mtime +14 -delete
```

La sauvegarde des bases contient les données sensibles de Cursus et de Vigie : toute copie hors du serveur est chiffrée.
Les données des outils (`/var/lib/atrium`) contiennent la clé OIDC de Clavis et les fichiers de Codex : sans elles, une
restauration oblige à réinscrire les outils et perd les documents.

## 10. Recette

Avec deux personnes de l'annuaire, activées dans Clavis, chacune avec un mot de passe provisoire :

| Vérification | Attendu |
| --- | --- |
| Ouvrir Keystone | renvoi vers Clavis, changement du mot de passe provisoire, **retour à Keystone** |
| Rôle dans Keystone | celui réglé dans Clavis (ex. « Chef de projet ») |
| Ouvrir Codex ensuite | ouvert sans ressaisir le mot de passe ; utilisateur créé et lié |
| Matrix pour une personne sans accès | page « Accès refusé » |
| Retirer l'accès à Codex dans Clavis | page suivante de Codex : refus |
| Changer le rôle Keystone dans Clavis | appliqué à la page suivante (menu et libellé) |
| Matrix pour l'administrateur informatique | rôle « admin » |

## 11. Mise à jour d'un outil

```bash
systemctl stop atrium-<outil>
# sauvegarde (§ 9), nouvelle archive de main dans /opt/atrium/<outil>, puis :
npm ci && npm run build && npm run db:migrate
systemctl start atrium-<outil>
```

Une migration qui toucherait une colonne lue par une vue `pub_` échoue : Matrix fait d'abord évoluer la publication.

## 12. Ce que la répétition a trouvé (corrigé)

| Écart | Correction |
| --- | --- |
| Codex ne compilait pas (Next 16.4.2, faille signalée) | Next 16.4.6 (Codex#31) |
| Matrix refusait les liens vers `clavis.pub_*` et sa sonde ignorait le schéma `clavis` | Matrix#94 |
| Après le changement du mot de passe provisoire, la personne restait sur l'accueil de Clavis au lieu de revenir à l'outil | Clavis#8 |
| Keystone appliquait le rôle changé dans Clavis mais gardait le libellé de la connexion (« Chef de projet ») | Keystone#80 |
| `POST /api/publications/<vue>/appliquer` exige un corps JSON (`{}`) | à savoir pour un script ; l'écran le fait |

## 13. Les outils suivants

Cursus, Vigie, Arche, Crucible : même suite (archive, `npm ci`, build, fichier `/etc/atrium/<outil>.env`, `db:migrate`,
`14-reprise-publications.sql` avec `-v outils=…` étendu, inscription `oidc:client`, service systemd, bloc nginx), puis passage
de l'outil de « prévu » à « ouvert » dans Clavis. Lecture des droits dans la base : `CURSUS_OIDC_EMETTEUR` +
`CURSUS_ACCES_CLAVIS=on`, `ARCHE_ACCESS_FROM_CLAVIS=on`, `CRUCIBLE_ACCESS_FROM_CLAVIS=on` ; Vigie : à faire.

**Cursus : purge du journal des actions par le rôle dédié** (décision M-24 du 25/11/2026). Le journal de Cursus est en
ajout seul (migration `0035_journal_ajout_seul`) : seul `cursus_purge` en supprime les lignes échues (12 mois, 36 pour la
paie), par `cursus.purger_journal()`. Le rôle est créé par `init/01` (connexion seulement avec `CURSUS_PURGE_PASSWORD`,
généré au § 2 ; sur un serveur déjà installé, l'ajouter à la main à `postgres.env`) ; ses droits sont posés par `init/03`
**une fois la migration 0035 de Cursus passée** : après le premier `db:migrate` de Cursus, rejouer `init/03-droits.sql`
(sans effet avant). Puis, dans `/etc/atrium/cursus.env`, une seconde adresse, jamais celle de `cursus_app` :

```bash
echo "CURSUS_PURGE_DATABASE_URL=postgres://cursus_purge:$CURSUS_PURGE_PASSWORD@$DB" >> cursus.env
```

Contrôle : `SELECT le, par, supprimees_un_an, supprimees_trois_ans FROM cursus.journal_purges ORDER BY id DESC LIMIT 3;`
(une ligne par jour, `par` = `cursus_purge`) et `droits.verifier()` sans erreur ni « attention » sur `cursus_purge`. Sans
la variable, Cursus le dit au démarrage et ne supprime rien.

**Modulus** (commercial et chiffrage, « validé » du propriétaire du 24/11/2026) : le socle crée déjà le rôle `modulus_app`
et le schéma `modulus` (sans `MODULUS_APP_PASSWORD` dans `postgres.env`, le rôle existe sans pouvoir se connecter). Modulus
n'a encore ni table, ni publication, ni lien. Le jour de son déploiement : `MODULUS_APP_PASSWORD` dans `postgres.env` (la
boucle du § 2 le génère ; sur un serveur déjà installé, l'ajouter à la main), rejeu de `init/01` à `03`, puis
`/etc/atrium/modulus.env` sur le modèle de Clavis (§ 4), port **3800** (registre de Norma) :

```bash
cat > modulus.env <<EOF
NODE_ENV=production
PORT=3800
DATABASE_URL=postgres://modulus_app:$MODULUS_APP_PASSWORD@$DB
EOF
```

Les autres variables (connexion par Clavis, secret de session) suivent le `.env.example` de Modulus, quand il sera livré.

**Vector** (expéditions nationales et internationales, « validé » du propriétaire du 25/11/2026, décision M-25) : de même,
le socle crée le rôle `vector_app` et le schéma `vector` (sans `VECTOR_APP_PASSWORD` dans `postgres.env`, le rôle existe
sans pouvoir se connecter). Vector n'a encore ni publication ni lien. Le jour de son déploiement : `VECTOR_APP_PASSWORD`
dans `postgres.env` (la boucle du § 2 le génère ; sur un serveur déjà installé, l'ajouter à la main), rejeu de `init/01`
à `03`, puis `/etc/atrium/vector.env` sur le modèle de Clavis (§ 4), port **3900** (registre de Norma) :

```bash
cat > vector.env <<EOF
NODE_ENV=production
PORT=3900
DATABASE_URL=postgres://vector_app:$VECTOR_APP_PASSWORD@$DB
EOF
```

Les autres variables (connexion par Clavis avec `VECTOR_ACCESS_FROM_CLAVIS=on`, secret de session) suivent le
`.env.example` de Vector.

**Ingenium** (ingénierie, « validé » du propriétaire du 27/11/2026, demande DI-M1, décision M-29) : un socle neuf crée le
rôle `ingenium_app` et le schéma `ingenium` ; sur un serveur déjà installé, sans rejouer `init/01` (les mots de passe n'y
changent pas) : `sudo -u postgres psql -v ON_ERROR_STOP=1 -d postgres -f infra/postgres/ajouts/ingenium.sql`, puis
`init/03-droits.sql` de même. Sans `INGENIUM_APP_PASSWORD`, le rôle existe sans pouvoir se connecter. Le jour de son
déploiement : `INGENIUM_APP_PASSWORD` dans `postgres.env`, rejeu de `init/01` à `03`, puis `/etc/atrium/ingenium.env`,
port **4000** (registre de Norma) :

```bash
cat > ingenium.env <<EOF
NODE_ENV=production
PORT=4000
DATABASE_URL=postgres://ingenium_app:$INGENIUM_APP_PASSWORD@$DB
EOF
```

Les autres variables (connexion par Clavis avec `INGENIUM_ACCESS_FROM_CLAVIS=on`, secret de session) suivent le
`.env.example` d'Ingenium.
