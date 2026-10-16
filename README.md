# Matrix

Outil du service informatique pour gérer les bases de données de la suite EPC2I (Keystone, Codex, Cursus, Vigie). Il propose :
- une bibliothèque des tables ;
- un graphe des liens entre tables et entre logiciels ;
- la liste des doublons à trancher ;
- le suivi des changements de schéma.

## À lire

| Fichier | Contenu |
|---|---|
| `docs/proposition.md` | La proposition : constats, écrans, architecture, feuille de route, questions ouvertes. |
| `docs/doublons-a-trancher.md` | Les 20 groupes de tables en double, avec les options et celle qui est proposée. |
| `docs/declaration-des-tables.md` | Comment une table créée dans un outil arrive dans la bibliothèque de Matrix. |
| `maquette/matrix.html` | Maquette navigable, à ouvrir dans un navigateur (données réelles des quatre dépôts). |

## Organisation

```
data/catalogue.json        schéma des 4 bases (généré par le collecteur)
data/historique.json       tables et colonnes ajoutées ou supprimées (généré)
data/flux.json             flux entre logiciels, systèmes externes, points d'attention (saisi)
data/usages.json           écrans de chaque outil et tables lues ou écrites (saisi)
data/doublons.json         groupes de doublons et options (saisi)
data/declarations/         schémas déclarés par les outils (reçus par le serveur ; /data/declarations en production)
integration/declarer-schema.mjs   module à ajouter dans chaque outil
serveur.mjs                       serveur de Matrix : la page, POST /api/declarations, /api/sante
outils/collecteur.mjs             lit les schémas (déclarations, sinon code source) et compare
outils/page.mjs                   construit la page à partir de maquette/source.html et des données
outils/construire-maquette.mjs    assemble maquette/matrix.html (version publiée comme artefact)
outils/generer-liste-doublons.mjs génère docs/doublons-a-trancher.md
maquette/source.html              source de la maquette
```

## Commandes

Node 22 ou plus récent. Une seule dépendance (`cytoscape`, pour le graphe) : `npm install`.

```bash
npm start                                # serveur Matrix sur http://localhost:3000
node outils/collecteur.mjs ..            # relire les schémas dans les dépôts voisins et comparer
node outils/construire-maquette.mjs      # reconstruire maquette/matrix.html
node outils/generer-liste-doublons.mjs   # régénérer docs/doublons-a-trancher.md
```

Pour relire les schémas, les dépôts `keystone/`, `codex/`, `cursus/` et `vigie/` doivent être clonés à côté de `Matrix/` (ou dans le dossier passé en argument).

## Mise en ligne (Docker, Coolify)

Le `Dockerfile` à la racine installe la dépendance et lance `node serveur.mjs`. Réglages à donner à l'hébergeur :

| Réglage | Valeur |
| --- | --- |
| Type de construction (Build Pack) | `Dockerfile` |
| Branche | celle qui contient le `Dockerfile` (`main` une fois la demande de fusion acceptée) |
| Port interne (Ports Exposes) | `3000` |
| Volume persistant | `/data` (catalogue à jour, historique des schémas, déclarations reçues) |
| Variable d'environnement | `MATRIX_TOKEN` : jeton partagé avec les quatre outils ; sans lui, les déclarations sont refusées |
| Contrôle de santé | intégré à l'image (`GET /api/sante`) ; rien à configurer |

- Le catalogue embarqué dans l'image sert de point de départ. À chaque déploiement, il est comparé au catalogue du volume : les écarts vont dans l'historique.
- Tant que l'authentification n'est pas branchée, protéger l'accès au niveau de l'hébergeur (authentification HTTP de Coolify, par exemple). Les outils déclarent alors leurs tables avec `MATRIX_URL=https://identifiant:mot-de-passe@matrix.votre-domaine` ; le jeton part dans l'en-tête `X-Matrix-Token`.
