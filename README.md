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
declarations/              schémas déclarés par les outils (reçus par le serveur)
integration/declarer-schema.mjs   module à ajouter dans chaque outil
outils/collecteur.mjs             lit les schémas (déclarations, sinon code source) et compare
outils/serveur-declarations.mjs   reçoit POST /api/declarations
outils/construire-maquette.mjs    assemble maquette/matrix.html
outils/generer-liste-doublons.mjs génère docs/doublons-a-trancher.md
maquette/source.html              source de la maquette
```

## Commandes

Les dépôts `keystone/`, `codex/`, `cursus/` et `vigie/` doivent être clonés à côté de `Matrix/` (ou dans le dossier passé en argument). Node 22 suffit, sans dépendance.

```bash
node outils/collecteur.mjs ..            # relire les schémas et comparer à la collecte précédente
node outils/construire-maquette.mjs      # reconstruire maquette/matrix.html
node outils/generer-liste-doublons.mjs   # régénérer la liste des doublons
MATRIX_TOKEN=… node outils/serveur-declarations.mjs   # recevoir les déclarations (port 3300)
```
