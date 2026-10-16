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
| 3 | `90-droits.sql` | `postgres` ou administrateur membre de `matrix_admin` | Contrôle des vues, `GRANT` des lecteurs, contrôle final par `droits.verifier()` |
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
- Le contrôle de 90 s'exécute avant tout `GRANT`. Il refuse le partage si une vue `pub_` lit une colonne sensible, dépend d'un autre schéma, n'appartient pas au propriétaire de son schéma ou utilise `security_invoker`. Après les `GRANT`, `droits.verifier()` contrôle l'ensemble (voir « Contrôle par le socle »).
- `95` vient après 90 : il lit les quatre `pub_journal` accordées à `matrix_app`.
- Les lecteurs n'ont pas de vue locale sur les vues d'un autre outil : ils lisent la vue `pub_` au moment du besoin, ou rafraîchissent un cache dans leur propre schéma (`codex.projects`, `codex.users`, `codex.departments`, `codex.sites`, `keystone.persons`, `keystone.departments`, `keystone.document_types`, miroirs `keystone.vigie_*`, `vigie.people`, `vigie.sites`, `vigie.training_titles`, `vigie.keystone_assignments`, `cursus.projets`, `cursus.equipes`, `cursus.missions`). Ce rafraîchissement relève du code des lecteurs et vient après 90 (`docs/convergence-des-donnees.md`, § 1.3).
- Une migration d'outil qui touche une colonne lue par une vue `pub_` doit recréer la vue (`CREATE OR REPLACE VIEW`). PostgreSQL refuse sinon le `DROP COLUMN` ou le changement de type.
- `matrix.journal_unifie` (fichier 95) est la seule vue qui lit d'autres schémas. Un `DROP SCHEMA <outil> CASCADE` la supprime : après la restauration d'un schéma, rejouer le fichier de l'outil, puis 90, puis 95 (`../README.md`, « Restaurer le schéma d'un outil »).
- `90-droits.sql` inscrit chaque couple (vue, lecteur) dans `droits.partage_lecteurs`. `droits.verifier()` signale ensuite en erreur un lecteur qui a perdu son `USAGE` ou son `SELECT` (restauration avec `--no-privileges`), et en attention une vue de la liste devenue absente ou `matrix.journal_unifie` manquante. Une vue retirée volontairement se retire de la liste : `DELETE FROM droits.partage_lecteurs WHERE vue = '…';` (`matrix_admin`).

## Contrôle par le socle

`droits.verifier()` (`../init/03-droits.sql`) accepte exactement cette convention. Aucun réglage du socle n'est à faire à la main.

| Situation | Résultat de `droits.verifier()` |
|---|---|
| Un outil a `USAGE` sur le schéma d'un autre et `SELECT` sur une ou plusieurs de ses vues `pub_` | Accepté. |
| `USAGE` sans aucune vue `pub_` accordée dans ce schéma | Erreur. |
| `CREATE` sur le schéma d'un autre | Erreur. |
| Droit d'un outil sur une table, une colonne, une séquence, une fonction ou une vue non publiée d'un autre schéma (vues `*_v1` de `cursus` comprises) | Erreur. |
| Droit autre que `SELECT` sur une vue `pub_` (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) | Erreur. |
| Vue `pub_` (ou `*_v1` de `cursus`) qui lit une colonne de `droits.colonnes_sensibles`, une ligne entière d'une table protégée, une relation d'un autre schéma, qui appartient à un autre rôle que le propriétaire du schéma ou qui porte `security_invoker` | Erreur. |
| Vues `*_v1` de `cursus` lues par `matrix_lecture` ou `matrix_app` | Accepté (vues de contrôle de Matrix). |
| Lecteur inscrit dans `droits.partage_lecteurs` sans `USAGE` sur le schéma ou sans `SELECT` sur la vue | Erreur (droit perdu, par exemple à la restauration d'un schéma). |
| Vue inscrite dans `droits.partage_lecteurs` absente, ou `matrix.journal_unifie` absente alors que le partage est en place | Attention. |

`90-droits.sql` appelle `droits.verifier()` à la fin de sa transaction. Une erreur annule tous ses `GRANT`. Le cas 99 de `../verifier-droits.sql` (« droits.verifier() sans erreur ») passe sur un serveur où le partage est en place, et les cas 100 à 136 éprouvent chaque ligne du tableau ci-dessus.

Le contrôle de 90 (étape 1) garde sa propre liste, un peu plus large que `droits.colonnes_sensibles` : elle contient aussi `cursus.employes.reprise_date`, que la convention de partage exclut des vues `pub_`. Pour `matrix_lecture`, le classement de cette colonne reste la question P-04 de `docs/architecture-postgres.md`.

## Essais

Faits le 15/10/2026 sur un PostgreSQL 16.15 neuf (port 55440), en connexions réelles par mot de passe :

- socle `init/01` à `03`, migrations des quatre outils dans leur schéma (203, 22, 36 et 28 tables), démonstration de Cursus (417 lignes), vues `*_v1` de Cursus ;
- fichiers 10 à 95 dans l'ordre ci-dessus, chacun avec son rôle, deux fois de suite ;
- `droits.verifier()` : aucune ligne ; `../verifier-droits.sql` : 94 cas conformes ; rejeu du socle après le partage : aucune erreur ;
- chaque outil lit exactement les vues que lui accorde 90 (57 droits, 57 lectures réussies), et leurs 984 essais de lecture d'une table ou d'une vue non accordée d'un autre schéma sont refusés ; `matrix_app` lit les 31 vues des outils ;
- Cursus : `pub_salaries` 24 lignes pour 24 salariés, `pub_titres` 17 (formations et habilitations), `pub_titres_detenus` 86 sans orphelin, `pub_parametres` 1 ; `heures_validees_v1` 228 lignes et 1 403 h ;
- aucune colonne sensible parmi les 511 couples (vue, colonne source) des vues `pub_` ;
- une vue de test `cursus.pub_zz_test` qui lit `employes.visite` est signalée par `droits.verifier()` et refusée par 90 (« Partage refusé, aucun droit posé ») ; un `GRANT SELECT` d'une table de Cursus à `keystone_app` fait annuler 90 par le contrôle final.

Contre-essai du 15/10/2026 après les corrections de relecture, sur un PostgreSQL 16.15 neuf (port 55441), même déroulé :

- partage joué deux fois : 35 vues contrôlées, droits posés sur 35 vues, `droits.partage_lecteurs` remplie (88 couples vue et lecteur, dont 57 pour les outils et 31 pour `matrix_app`) ; `droits.verifier()` : aucune ligne ; `../verifier-droits.sql` : 96 cas conformes (cas 135 et 136 : lecteur attendu qui perd son `SELECT` ou son `USAGE`, signalé) ; mêmes lectures réussies et refusées qu'à l'essai précédent ;
- restauration de `cursus` par la procédure de `../README.md` : le `DROP SCHEMA cursus CASCADE` supprime `matrix.journal_unifie` ; après `pg_restore --no-privileges`, `droits.verifier()` signale 8 erreurs (lecteurs des vues `cursus.pub_*` sans `USAGE`) et 1 attention (`matrix.journal_unifie` absente), et `codex_app` reçoit `permission denied for schema cursus` ; après le rejeu de 20, 90 et 95 : aucune ligne, `codex_app` relit ses 24 salariés et `matrix_app` relit `heures_validees_v1` (228 lignes, 1 403 h) ;
- `matrix.pub_correspondances` : `matrix_app` voit les 3 lignes d'essai, `keystone_app` et `codex_app` chacun la sienne, `cursus_app` aucune.
