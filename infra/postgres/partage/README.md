# Partage des données entre outils (base epc2i)

Ce dossier crée les vues `pub_*` que chaque outil publie, les référentiels de Matrix et les droits des lecteurs.

La convention :

- L'outil qui fait foi publie des vues `pub_<objet>` dans son propre schéma.
- Le lecteur reçoit `USAGE` sur ce schéma et `SELECT` sur ces vues, rien d'autre.
- Les écritures d'un outil chez un autre passent par une API, jamais par SQL.
- Il n'y a pas de clé étrangère entre schémas. Une référence croisée est une colonne texte. L'application la contrôle à la saisie, puis Matrix contrôle les orphelins.
- Une vue `pub_` est un contrat. On n'en retire ni ne renomme de colonne : un changement de ce type passe par une nouvelle vue `_v2`. On peut seulement ajouter des colonnes en fin de liste.
- Aucune donnée de santé ni colonne sensible dans une vue `pub_`.

## Fichiers et ordre d'exécution

| Ordre | Fichier | Rôle d'exécution | Contenu |
|---|---|---|---|
| 0 | `../init/01` à `03`, migrations des outils, `../cursus/schema.sql` | `postgres`, puis le rôle de chaque outil | Socle, tables des outils |
| 1 | `10-matrix-referentiels.sql` | `matrix_app` | `matrix.pays`, `sites`, `organigramme`, `correspondances`, amorçage, vues `matrix.pub_*` |
| 2 | `20-cursus.sql` | `cursus_app` | Colonnes prérequises, vues `cursus.pub_*` (D01, D08, D09, D18, D19) |
| 2 | `30-keystone.sql` | `keystone_app` | Colonnes prérequises, vues `keystone.pub_*` (D02 à D05, D12, D13, D16, D18) |
| 2 | `40-codex.sql` | `codex_app` | Colonnes prérequises, vues `codex.pub_*` (D10, D11, D18) |
| 2 | `50-vigie.sql` | `vigie_app` | Colonnes et tables prérequises, vues `vigie.pub_*` (D13, D18) |
| 2 | `60-vigie-ecr-eco.sql` | `vigie_app` | Tables ECR / ECO (D12) et leurs vues `pub_` |
| 3 | `90-droits.sql` | `postgres` ou administrateur membre de `matrix_admin` | Contrôle des vues, puis `GRANT` des lecteurs |
| 4 | `95-matrix-journal-unifie.sql` | `matrix_app` | `matrix.journal_unifie` (D18) |

Les fichiers de l'étape 2 sont indépendants entre eux : chaque vue ne lit que des tables de son propre schéma.

Commandes :

```sh
psql "postgres://matrix_app:…@hôte:5432/epc2i"  -v ON_ERROR_STOP=1 -1 -f partage/10-matrix-referentiels.sql
psql "postgres://cursus_app:…@hôte:5432/epc2i"  -v ON_ERROR_STOP=1 -1 -f partage/20-cursus.sql
# … 30 (keystone_app), 40 (codex_app), 50 et 60 (vigie_app), sur le même modèle
psql -h hôte -U postgres -d epc2i -v ON_ERROR_STOP=1 -f partage/90-droits.sql   # sans -1 : le fichier ouvre sa transaction
psql "postgres://matrix_app:…@hôte:5432/epc2i"  -v ON_ERROR_STOP=1 -1 -f partage/95-matrix-journal-unifie.sql
```

Tous les fichiers sont rejouables.

## Dépendances

- Chaque fichier d'outil commence par une section « Prérequis : colonnes à ajouter ». Ces `ALTER TABLE … ADD COLUMN IF NOT EXISTS` sont à reporter dans les migrations de l'outil : Drizzle pour Keystone, Codex et Vigie ; `server/migrations-pg/` pour Cursus. Une fois reportés, ils deviennent sans effet.
- `90-droits.sql` vient après 10 à 60. Une vue absente est signalée par un WARNING ; il suffit de relancer 90 quand elle existe.
- Le contrôle de 90 s'exécute avant tout `GRANT`. Il refuse le partage si une vue `pub_` lit une colonne sensible, dépend d'un autre schéma, n'appartient pas au propriétaire de son schéma ou utilise `security_invoker`.
- `95` vient après 90 : il lit les quatre `pub_journal` accordées à `matrix_app`.
- Les vues locales des lecteurs (`codex.v_users`, `vigie.v_people`, `vigie.v_sites`) et le rafraîchissement des caches (`codex.projects`, `codex.departments`, `keystone.departments`, miroirs `keystone.vigie_*`) relèvent des migrations des lecteurs. Ils viennent après 90.
- Une migration d'outil qui touche une colonne lue par une vue `pub_` doit recréer la vue (`CREATE OR REPLACE VIEW`). PostgreSQL refuse sinon le `DROP COLUMN` ou le changement de type. Une vue `pub_` lue par la vue locale d'un autre outil ne peut plus être supprimée.

## Point d'attention sur le socle

Après 90, `droits.verifier()` (`../init/03-droits.sql`) signale 14 erreurs « droit USAGE inattendu », par exemple `keystone_app, schéma cursus`. Ce contrôle applique encore la règle « chaque outil chez soi ». Il faut l'adapter dans le socle : un `USAGE` croisé est permis quand le rôle n'a, dans ce schéma, que `SELECT` sur des vues `pub_`. Sinon le cas 99 de `../verifier-droits.sql` échoue sur un serveur où le partage est en place.

Testé sur PostgreSQL 16.15 : socle `init/01` à `03`, migrations réelles des quatre outils, données de démonstration de Cursus, deux passages de chaque fichier.
