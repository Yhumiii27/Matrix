# StarterPack EPC2I — fiche d'installation sur le serveur interne

Premier déploiement de la suite sur le serveur de l'entreprise. Il installe :

| Service | Rôle | Adresse |
|---|---|---|
| PostgreSQL commun | Base `epc2i`, un schéma par outil, rôles et droits du socle de Matrix | interne, port 5432 sur la boucle locale |
| Matrix | Administration de la base, référentiels, liens entre outils | `https://MATRIX_HOST` |
| Clavis | Annuaire, accès aux outils, connexion par mot de passe | `https://CLAVIS_HOST` |
| Keystone | Projets | `https://KEYSTONE_HOST` |
| Codex | Documents | `https://CODEX_HOST` |
| Proxy (Caddy) | HTTPS, une adresse par outil | ports 80 et 443 |

Le serveur n'a pas besoin de Coolify : tout tient dans `docker-compose.yml` et `installer.sh`.

## Jalons

- **A — installation (ce kit)** : Clavis sur des données réelles (annuaire importé). Keystone et Codex tournent sur leur jeu de
  démonstration, fermés par un identifiant et un mot de passe communs (authentification HTTP du proxy), en attendant leur
  branchement sur la connexion de Clavis.
- **B — connexion centrale** : Keystone, Codex et Matrix se connectent par Clavis ; l'accès de démonstration disparaît.
- **C — ouverture** : bases de Keystone et Codex remises à zéro sans données de démonstration (`KEYSTONE_SEED=production`,
  `CODEX_SEED=minimal`), comptes activés, mots de passe provisoires envoyés.

## 1. Prérequis à demander à l'informatique

| Besoin | Détail |
|---|---|
| Système | Linux 64 bits, Docker 24 ou plus avec Docker Compose v2, `git`, `openssl` |
| Ressources | 4 processeurs, 8 Go de mémoire (16 Go conseillés pour la construction des images), 40 Go de disque |
| Réseau sortant pendant l'installation | Docker Hub, registre npm, `apt.postgresql.org`, GitHub. Sans accès : construire les images ailleurs et les apporter (`docker save` / `docker load`) |
| Noms internes | Quatre noms pointant vers le serveur, par exemple `clavis.`, `matrix.`, `keystone.`, `codex.` suivis du domaine interne |
| Certificat | Soit le certificat de l'entreprise pour ces quatre noms (ou un certificat générique), soit l'autorité locale de Caddy à installer sur les postes (§ 4) |
| Ports | 80 et 443 ouverts depuis le réseau des utilisateurs ; 5432 jamais ouvert (administration par tunnel SSH) |
| Sauvegardes | Un dossier hors du serveur où copier chaque nuit les sauvegardes (§ 6) |

## 2. Récupérer les sources

Les quatre dépôts côte à côte, dans un même dossier (par exemple `/opt/epc2i`). Clavis est privé : utiliser un compte ou un
jeton GitHub qui y a accès.

```bash
sudo mkdir -p /opt/epc2i && sudo chown "$USER" /opt/epc2i && cd /opt/epc2i
```

```bash
for r in Matrix Clavis Keystone Codex; do git clone --depth 1 https://github.com/Yhumiii27/$r.git; done
```

## 3. Installer

```bash
cd /opt/epc2i/Matrix/infra/starterpack
```

```bash
cp .env.example .env && chmod 600 .env
```

Dans `.env`, renseigner les quatre adresses (`CLAVIS_HOST`, `MATRIX_HOST`, `KEYSTONE_HOST`, `CODEX_HOST`) et, si
l'entreprise fournit un certificat, `EPC2I_TLS` (§ 4). Laisser les secrets vides : le script les génère.

Copier le fichier de l'annuaire (66 personnes de l'organigramme, adresses `prenom.nom@epc-groupe.com`) sur le serveur, puis :

```bash
./installer.sh --annuaire /chemin/annuaire-initial.csv --admin julien.exposito@epc-groupe.com
```

Le script, rejouable :

1. vérifie Docker et les sources ;
2. génère les secrets manquants dans `.env` (jamais affichés) ;
3. prépare l'accès de démonstration de Keystone et Codex ;
4. construit les images (10 à 20 minutes la première fois) ;
5. démarre PostgreSQL et rejoue le socle de Matrix (base, rôles, schémas, droits) ;
6. applique les migrations de Clavis et de Keystone (Codex migre au démarrage) ;
7. démarre tous les services ;
8. pose les registres de Matrix (référentiels, liens, publications, historique, glossaire) ;
9. attend que chaque outil réponde à sa route de santé ;
10. importe l'annuaire dans Clavis : chaque personne reçoit le profil suggéré par son poste, et personne n'est activé ;
11. crée le premier administrateur de Clavis et affiche **une seule fois** son mot de passe provisoire, valable 7 jours.

À la fin, il affiche les adresses. Les mots de passe d'accès (Matrix, démonstration) sont dans `.env`.

## 4. Certificats

- **Certificat de l'entreprise** : copier le certificat complet et sa clé dans `certs/`, puis dans `.env` :
  `EPC2I_TLS=/certs/fullchain.pem /certs/key.pem`.
- **Sans certificat** (`EPC2I_TLS=internal`) : Caddy signe lui-même. Installer son autorité racine sur les postes, sinon les
  navigateurs affichent un avertissement :

```bash
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt ./autorite-epc2i.crt
```

  Puis diffuser `autorite-epc2i.crt` par stratégie de groupe (autorités de certification racines de confiance).

## 5. Contrôles après installation

| Contrôle | Attendu |
|---|---|
| `docker compose ps` | Tous les services `running` (ou `healthy`) ; `clavis-migrate` et `keystone-migrate` sortis avec le code 0 |
| `https://CLAVIS_HOST` | Page de connexion ; l'administrateur se connecte avec son mot de passe provisoire, choisit le sien, voit l'organigramme des 66 personnes |
| `https://KEYSTONE_HOST`, `https://CODEX_HOST` | Demande d'identifiant (accès de démonstration), puis l'outil |
| `https://MATRIX_HOST` | Connexion par le mot de passe `MATRIX_MOT_DE_PASSE` |
| `docker compose exec postgres psql -U postgres -d epc2i -c "SELECT gravite, objet, constat FROM droits.verifier() WHERE gravite = 'erreur';"` | Aucune ligne |

## 6. Sauvegardes

- **Serveur commun** : chaque nuit, un fichier par schéma (Clavis compris), gardé 14 jours dans le volume `sauvegardes`.
  À programmer dans la crontab de l'hôte :

```bash
15 2 * * * cd /opt/epc2i/Matrix/infra/starterpack && docker compose exec -T postgres sh /opt/epc2i/sauvegarde/sauvegarder.sh >> /var/log/epc2i-sauvegarde.log 2>&1
```

- **Copie hors du serveur** : à organiser par l'informatique (le dossier du volume : `docker volume inspect epc2i-starterpack_sauvegardes`).
  Les sauvegardes contiennent l'annuaire et les empreintes des mots de passe de Clavis : la copie doit être chiffrée.
- Keystone et Clavis font aussi leurs propres sauvegardes (services `keystone-worker`, `clavis-worker`) dans leurs volumes.

## 7. Mettre à jour

```bash
cd /opt/epc2i && for r in Matrix Clavis Keystone Codex; do git -C $r pull --ff-only; done
```

```bash
cd /opt/epc2i/Matrix/infra/starterpack && ./installer.sh
```

Les migrations s'appliquent à chaque passage ; une sauvegarde de moins de 24 heures doit exister avant (délégation, § 1).

## 8. En cas de problème

| Symptôme | Remède |
|---|---|
| `429 Too Many Requests` pendant la construction | Limite de Docker Hub pour les téléchargements anonymes : relancer quelques minutes plus tard, ou se connecter (`docker login`) |
| Un outil ne répond pas à l'étape 9 | `docker compose logs <service>` : une variable manquante ou invalide est nommée au démarrage |
| Le navigateur refuse le certificat | Installer l'autorité locale (§ 4) ou fournir le certificat de l'entreprise |
| Un administrateur a perdu son mot de passe | `docker compose run --rm -T clavis-migrate npm run --silent admin:create -- <e-mail>` : nouveau mot de passe provisoire |
| Importer une nouvelle version de l'annuaire | Copier le fichier dans `import/`, puis `docker compose run --rm -T clavis-migrate npm run --silent directory:import -- /import/<fichier>.csv` (ajoute, met à jour, marque absents ceux qui n'y sont plus ; ne supprime rien) |

## 9. Serveur sans accès à internet

Construire les images sur un poste qui a accès à internet et aux quatre dépôts (même dossier `starterpack`, même `.env`
pour les adresses, car elles sont inscrites dans les images), puis les apporter :

```bash
docker compose build && docker pull caddy:2.10-alpine
```

```bash
docker save epc2i-starterpack-postgres epc2i-starterpack-matrix epc2i/clavis:local epc2i/keystone:local epc2i/codex:local caddy:2.10-alpine | gzip > epc2i-images.tar.gz
```

Sur le serveur :

```bash
gunzip -c epc2i-images.tar.gz | docker load
```

```bash
./installer.sh --sans-construction --annuaire /chemin/annuaire-initial.csv --admin julien.exposito@epc-groupe.com
```
