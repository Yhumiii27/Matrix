# Partage des données entre outils (base epc2i)

Ce dossier crée les vues `pub_*` que chaque outil publie, les référentiels de Matrix et les droits des lecteurs.

La convention :

- L'outil qui fait foi publie des vues `pub_<objet>` dans son propre schéma.
- Le lecteur reçoit `USAGE` sur ce schéma et `SELECT` sur ces vues, rien d'autre.
- Les écritures d'un outil chez un autre passent par une API, jamais par SQL.
- Il n'y a pas de clé étrangère entre schémas. Une référence croisée est une colonne texte. L'application la contrôle à la saisie, puis Matrix contrôle les orphelins.
- Une vue `pub_` est un contrat. On n'en retire ni ne renomme de colonne : un changement de ce type passe par une nouvelle vue `_v2`. On peut seulement ajouter des colonnes en fin de liste.
- Aucune donnée de santé ni colonne sensible dans une vue `pub_` (liste `droits.colonnes_sensibles`, tables fermées en entier comprises).
- Les vues `pub_` sont créées par les migrations de l'outil (décision P-02 du 18/10/2026 : Keystone `0035_share`, Codex `0001_partage`, Vigie `0009_partage`). Le fichier de partage de Matrix en est la copie qualifiée : il les recrée à l'identique et ne crée plus de colonne prérequise.

## Fichiers et ordre d'exécution

| Ordre | Fichier | Rôle d'exécution | Contenu |
|---|---|---|---|
| 0 | `../init/01` à `03`, puis migrations des outils (Keystone `npm run db:migrate` ; Codex et Vigie à leur démarrage), Cursus à son démarrage (`server/migrations-pg/` du dépôt Cursus) | `postgres`, puis le rôle de chaque outil | Socle, tables des outils, colonnes prérequises et vues `pub_` de Keystone, Codex et Vigie |
| 1 | `10-matrix-referentiels.sql` | `matrix_app` | `matrix.pays`, `sites` (avec coordonnées, M-11 d'Arche), `organigramme`, `zones` (avec cadre géographique, M-12 d'Arche), `filiales` (D21), `correspondances`, amorçage, vues `matrix.pub_*` |
| 1 | `12-matrix-liens.sql` | `matrix_app` | Registre des liens entre outils administré par Matrix : `matrix.liens` (vue, lecteur, statut autorise / refuse / demande), journal `matrix.liens_journal` en ajout seul |
| 2 | `20-cursus.sql` | `cursus_app` | Copie qualifiée des vues `cursus.pub_*` de la migration `0002_partage` de Cursus (D01, D08, D09, D18, D19) |
| 2 | `30-keystone.sql` | `keystone_app` | Contrôle des prérequis (migrations `0034` à `0054`, index `maj_le` et déclencheur `machine_catalogue_entries_frozen` compris), copie des 18 vues `keystone.pub_*` : 12 de `0035_share` (D02 à D05, D12, D13, D16, D18), `pub_jalons` (Crucible), `pub_jalons_projets`, `pub_avancement_projets`, `pub_avenants`, `pub_reserves` (Arche K-04) et les colonnes ajoutées en fin de `pub_projets` et `pub_livrables` (`0038_share_followup`), en fin de `pub_parc_machines` (`0040_share_installed_base`, Arche K-07), `pub_catalogue_machines` (`0046_catalogue_share`, Arche K-01), `pub_reponses_besoins` (`0050_capex_needs_share`, Arche K-02), colonnes en fin de `pub_projets` (`0052_internal_client_share`, client interne) et de `pub_clients` (`0054`, D21), `pub_rex` (`0054`, D22) : 20 vues |
| 2 | `40-codex.sql` | `codex_app` | Prérequis en `IF NOT EXISTS` (sans effet après `0001_partage`), copie des 8 vues `codex.pub_*` : 7 de `0001_partage` (D10, D11, D18) et `pub_programmes_recherche` de `0002_pub_programmes_recherche` (CX-2 de Crucible) |
| 2 | `50-vigie.sql` | `vigie_app` | Contrôle des prérequis (migrations `0008`, `0009`, `0014`), copie des 3 vues `vigie.pub_*` de `0009_partage` (D13, D18) et de `vigie.pub_controles` de `0014_controls_share` (D23, lue par Crucible) |
| — | `60-vigie-ecr-eco.sql` | `vigie_app` | **À ne pas jouer tant que le module ECR / ECO n'existe pas dans Vigie** (aucune de ses tables dans Vigie au 18/10/2026). Spécification des tables ECR / ECO (D12) et de leurs vues `pub_`, à reporter dans les migrations de Vigie. |
| 2 | `70-arche.sql` | `arche_app` | Contrôle des migrations d'Arche (`0000` à `0016`), copie de `arche.pub_journal` (D18), `arche.pub_capex`, `arche.pub_besoins_machines` (M-10 d'Arche), `arche.pub_rampup`, `arche.pub_rex` (v1, plus lue) et `arche.pub_rex_v2` (M-13 d'Arche, contrat commun du REX) |
| 2 | `80-crucible.sql` | `crucible_app` | Contrôle des migrations de Crucible (`0000` à `0009`), copie de `crucible.pub_journal` (D18), `pub_moyens` et `pub_reservations` (M-7 de Crucible, lues par Keystone, Vigie et Matrix) et `pub_occupation_hebdo` (M-8, lue par Matrix) |
| 3 | `90-droits.sql` | `postgres` ou administrateur membre de `matrix_admin` | Contrôle des vues ; amorçage du registre `matrix.liens` avec la convention ; `GRANT` des liens autorisés, `REVOKE` des droits non autorisés (refusés, demandés ou hors registre) ; contrôle final par `droits.verifier()` |
| — | `appliquer-liens.sh` | `postgres` (tâche planifiée) | Rejoue `90-droits.sql` quand le registre de Matrix et les droits posés divergent (« Application automatique du registre des liens » ci-dessous) |
| 4 | `95-matrix-journal-unifie.sql` | `matrix_app` | `matrix.journal_unifie` (D18) |
| 4 | `96-matrix-rex-unifie.sql` | `matrix_app` | `matrix.rex_unifie` (D22) : union de `keystone.pub_rex` et `arche.pub_rex_v2` au contrat commun du REX ; une vue absente est laissée de côté (WARNING), une vue hors contrat fait échouer le fichier |

Les fichiers de l'étape 2 sont indépendants entre eux : chaque vue ne lit que des tables de son propre schéma. Les vues de 30, 40 et 50 sont identiques à celles des migrations des outils (définition, options et commentaire, vérifié le 18/10/2026 ; pour 40, de nouveau le 22/10/2026 contre `0001_partage` de Codex, après la correction de `pub_journal.quand`, instant UTC publié tel quel) : les rejouer ne change rien. Toute évolution d'une vue se fait d'abord dans une migration de l'outil, puis est recopiée ici.

Commandes :

```sh
psql "postgres://matrix_app:…@hôte:5432/epc2i"  -v ON_ERROR_STOP=1 -1 -f partage/10-matrix-referentiels.sql
psql "postgres://matrix_app:…@hôte:5432/epc2i"  -v ON_ERROR_STOP=1 -1 -f partage/12-matrix-liens.sql
psql "postgres://cursus_app:…@hôte:5432/epc2i"  -v ON_ERROR_STOP=1 -1 -f partage/20-cursus.sql
# … 30 (keystone_app), 40 (codex_app), 50 (vigie_app), 70 (arche_app), 80 (crucible_app), sur le même modèle ; pas 60 (module ECR / ECO absent de Vigie)
psql -h hôte -U postgres -d epc2i -v ON_ERROR_STOP=1 -f partage/90-droits.sql   # sans -1 : le fichier ouvre sa transaction
psql "postgres://matrix_app:…@hôte:5432/epc2i"  -v ON_ERROR_STOP=1 -1 -f partage/95-matrix-journal-unifie.sql
psql "postgres://matrix_app:…@hôte:5432/epc2i"  -v ON_ERROR_STOP=1 -1 -f partage/96-matrix-rex-unifie.sql
```

Tous les fichiers sont rejouables.

## Application automatique du registre des liens

Une décision prise dans l'écran « Liens entre outils » de Matrix est écrite dans `matrix.liens`. Elle ne pose ni ne retire aucun droit : c'est `90-droits.sql` qui l'applique. `appliquer-liens.sh` le rejoue automatiquement, par une tâche planifiée Coolify sur le conteneur `postgres` :

| Réglage | Valeur |
|---|---|
| Commande | `sh /opt/epc2i/partage/appliquer-liens.sh` |
| Fréquence | toutes les 15 minutes (`*/15 * * * *`) : une décision prend effet en 15 minutes au plus |
| Rôle | `postgres` par le socket local du conteneur (défaut) ; `PGUSER` pour un administrateur membre de `matrix_admin` |

Le script rejoue `90-droits.sql` seulement dans ces cas, et écrit la raison :

- premier passage dans le conteneur, ou `90-droits.sql` changé depuis le dernier passage réussi. L'empreinte du fichier est gardée dans `/tmp/epc2i-liens.etat` (`EPC2I_LIENS_ETAT`), effacé à chaque redéploiement : un redéploiement provoque donc toujours un passage ;
- « n lien(s) à appliquer » : un lien autorisé dont la vue existe n'a pas son `SELECT`. C'est le cas d'une autorisation récente, ou d'une vue publiée depuis le dernier passage ;
- « n lien(s) à retirer » : un rôle d'outil lit une vue `pub_` d'un autre schéma sans lien autorisé (refusé, demandé ou hors registre) ;
- « registre absent » : `12-matrix-liens.sql` n'a pas encore été joué ;
- `EPC2I_LIENS_FORCER=1`.

Dans tous les autres cas, il écrit « registre et droits concordent, rien à appliquer » et n'ouvre aucune transaction.

Après un passage, il n'affiche que les messages utiles de 90 : liens retirés, vues absentes, contrôles. Une erreur (vue non conforme, `droits.verifier()` en erreur) annule toute la transaction de 90 : la tâche échoue avec un code non nul et la sortie complète, les droits restent ceux d'avant. La tâche suivante réessaie.

Deux passages ne se chevauchent pas : le verrou `/tmp/epc2i-liens.etat.verrou` est repris s'il a plus de 30 minutes.

Lancement à la main : `docker compose exec postgres sh /opt/epc2i/partage/appliquer-liens.sh`.

## Dépendances

- Les colonnes prérequises appartiennent à l'outil et sont créées par ses migrations : Keystone `0034_share_prerequisites` (et `0024` pour `persons.matricule`), Codex `0001_partage`, Vigie `0008_partage_prerequis`. `30-keystone.sql` et `50-vigie.sql` ne créent rien : ils s'arrêtent sur « Colonnes absentes du schéma … » si la migration n'est pas passée. `40-codex.sql` garde ses `ADD COLUMN IF NOT EXISTS`, sans effet sur Codex à jour. `20-cursus.sql` crée encore les siens : ils iront dans `server/migrations-pg/` de Cursus à sa bascule.
- Écarts de Vigie avec la première version de 50 : pas de tables `inductions` (pas de ligne « induction » dans `pub_hse_projet`), `document_actions` (D10) ni `journal` : `pub_journal` lit le journal des modifications `change_log`, sans motif ni détail des champs ; `closed_on` et `vigie_updated_at` de `pub_non_conformites` sont calculés. Écarts de Keystone avec la première version de 30 : `countries.iso2` reste facultatif (pas de `NOT NULL`, comme dans Drizzle), pas de contrainte de forme sur `persons.matricule` (matricules importés de Cursus).
- `90-droits.sql` vient après 10 à 80. Une vue absente est signalée par un WARNING (aujourd'hui les 4 vues ECR / ECO de 60, et les vues demandées pas encore publiées : celles de Keystone pour Arche et Crucible, `cursus.pub_absences`, `arche.pub_besoins_machines`, `pub_rampup`, `pub_rex`, `crucible.pub_moyens`, `pub_reservations`) ; il suffit de relancer 90 quand elle existe.
- Le contrôle de 90 s'exécute avant tout `GRANT`. Il refuse le partage si une vue `pub_` lit une colonne sensible, dépend d'un autre schéma, n'appartient pas au propriétaire de son schéma ou utilise `security_invoker`. Après les `GRANT`, `droits.verifier()` contrôle l'ensemble (voir « Contrôle par le socle »).
- `95` vient après 90 : il réunit les `pub_journal` accordées à `matrix_app`, contrôle qu'elles suivent le contrat commun (11 colonnes, mêmes noms et types, dans le même ordre) et laisse de côté, avec un WARNING, celles des outils pas encore basculés. Il se rejoue après chaque bascule.
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
| `USAGE` sur le schéma `extensions` (`pg_trgm`, `../init/02-schemas.sql`) | Accepté pour `codex_app` seul (et `epc2i_sauvegarde`, par `pg_read_all_data`) ; pour tout autre rôle, erreur ; `CREATE` : erreur. Les fonctions de `pg_trgm` y restent hors de la convention de partage : installées dans `codex`, elles seraient un droit `EXECUTE` croisé pour chaque lecteur des vues `codex.pub_*`. |

`90-droits.sql` appelle `droits.verifier()` à la fin de sa transaction. Une erreur annule tous ses `GRANT`. Le cas 99 de `../verifier-droits.sql` (« droits.verifier() sans erreur ») passe sur un serveur où le partage est en place, et les cas 100 à 138 (et 71 à 73 pour `extensions`) éprouvent chaque ligne du tableau ci-dessus.

Le contrôle de 90 (étape 1) garde sa propre liste, un peu plus large que `droits.colonnes_sensibles` : elle contient aussi `cursus.employes.reprise_date`, que la convention de partage exclut des vues `pub_`. Pour `matrix_lecture`, le classement de cette colonne reste la question P-04 de `docs/architecture-postgres.md`.

## Essais

Essai du 25/10/2026 (vues de Keystone `0037` à `0046` et de Codex `0002`), sur un PostgreSQL 16 neuf :

- socle `init/01` à `03`, puis migrations réelles en rôle d'outil : Keystone `0000` à `0049` (schéma `keystone`, `"public".` remplacé comme le fait son migrateur du serveur), Codex `0000` à `0002` ;
- `30-keystone.sql` et `40-codex.sql` : les 26 vues `keystone.pub_*` (18) et `codex.pub_*` (8) identiques avant et après (définition, options, commentaire) ; `30` rejoué après 90 : sans effet ;
- prérequis : sans `milestones.updated_at` ou sans le déclencheur `machine_catalogue_entries_frozen`, 30 s'arrête avec le message qui nomme la migration de Keystone à passer ;
- 10, 12, puis 90 deux fois : 32 vues contrôlées et accordées, aucun lien retiré au second passage, `droits.verifier()` sans erreur ; `crucible_app` lit `codex.pub_programmes_recherche` et `keystone.pub_jalons`, `arche_app` lit `keystone.pub_catalogue_machines` et `pub_reserves`, `vigie_app` ne lit pas `codex.pub_programmes_recherche` ; `../verifier-droits.sql` : 126 cas conformes ;
- complément du même jour (Keystone `0049` à `0054`) : migrations de Keystone `0000` à `0054` ; les 20 vues `keystone.pub_*` et les 8 vues `codex.pub_*` identiques avant et après 30 et 40 ; 90 deux fois : 34 vues accordées, `droits.verifier()` sans erreur ; `arche_app` lit `pub_reponses_besoins`, `matrix_app` lit `pub_rex` (pas `arche_app`), `vigie_app` lit `pub_clients.filiale_code` ; 96 : `keystone.pub_rex` conforme au contrat commun, `matrix.rex_unifie` créée (sans Arche, pas migrée dans cet essai : WARNING) ; `../verifier-droits.sql` : 126 cas conformes.

Essai du 22/10/2026 (ajout de Crucible), sur PostgreSQL 16 (image du socle), en connexions réelles par mot de passe :

- socle neuf : `init/01` à `03` sans écart, rejoués deux fois sans écart ; `../verifier-droits.sql` : 126 cas conformes (cas 170 à 175 pour Crucible) ;
- mise à jour d'un serveur en service : volume initialisé par l'image de `main` (sans Crucible), puis redémarré sur la nouvelle image avec `CRUCIBLE_APP_PASSWORD` ; rejeu de `init/01` à `03` : schéma `crucible` et rôle `crucible_app` créés, `droits.verifier()` sans erreur ni attention. Sans `CRUCIBLE_APP_PASSWORD`, le nouveau `init/01` s'arrête sur « Mots de passe manquants : rien n'a été modifié » ;
- Crucible en `crucible_app` (`npm run db:migrate`, `CRUCIBLE_SEED=demo`) : migrations `0000` à `0002` appliquées (11 tables et `pub_journal`), démonstration chargée ; second passage sans effet ;
- fichiers 80, 10, 90, 95 deux fois : `crucible.pub_journal` identique avant et après 80 (définition, options, commentaire) ; 90 : 7 vues contrôlées et accordées, les vues demandées absentes signalées, `droits.verifier()` sans erreur ; `matrix.journal_unifie` réunit le journal de Crucible ; rejeu du socle ensuite sans écart, `../verifier-droits.sql` : 126 cas conformes ;
- `matrix_app` refusé sur `crucible.users.email` et `entra_object_id`, lit les autres colonnes ; `crucible_app` lit `matrix.pub_sites` et `pub_organigramme`, refusé sur `matrix.pub_pays` ; `sauvegarde/sauvegarder.sh` produit `crucible.dump`.

Essai du 22/10/2026 (lot 11 de Codex), sur un PostgreSQL 18.3 neuf, en connexions réelles par mot de passe :

- socle `init/01` à `03` (schéma `extensions` et `pg_trgm` compris) ; `../verifier-droits.sql` : 114 cas conformes ;
- Codex (lot 11) en `codex_app` : `npm run db:migrate` applique `0000_init` et `0001_partage` (index `document_terms_term` en `extensions.gin_trgm_ops`), puis démonstration (`CODEX_SEED=demo` : 63 documents, 168 lignes de journal) ;
- fichiers 10, 40 (deux fois), 90, 95 : les 7 vues `codex.pub_*` identiques avant et après 40 (définition, options, commentaire, colonnes et types) ; 90 : 11 vues contrôlées et accordées, `droits.verifier()` sans erreur ; `matrix.journal_unifie` réunit le journal de Codex (`quand` en `timestamptz`). L'ancien 40 (`AT TIME ZONE 'Europe/Paris'`) échoue sur cette base : « cannot change data type of view column "quand" » ;
- rejeu de `init/01` à `03` après le partage : sans erreur, `droits.verifier()` sans erreur ni attention ; `../verifier-droits.sql` : 114 cas conformes ; `keystone_app` refusé sur le schéma `extensions`, `codex_app` y appelle `similarity()`.

Essai du 18/10/2026, après la bascule de Keystone et de Vigie, sur un PostgreSQL 16.15 neuf (port 5443), en connexions réelles par mot de passe :

- socle `init/01` à `03` ; tables créées par les migrateurs réels des outils : Keystone (branche `claude/shared-postgres`, `npm run db:migrate`, démonstration : 212 tables, 12 vues), Codex (`main`, `getDb()` avec `CODEX_SEED_DEMO=1` : 22 tables, 7 vues), Vigie (branche `claude/bascule-postgres`, ouverture en démonstration : 52 tables, 3 vues) ; Cursus sans bascule : tables créées par `../cursus/schema.sql` (28 tables), pour jouer 20 ;
- fichiers 10, 20, 30, 40, 50, 90, 95 dans cet ordre, deux fois : aucun écart d'état (droits de table et de colonne, définitions et commentaires des vues, `droits.partage_lecteurs`, droits de schéma) entre les deux passages, ni après un rejeu de `init/03` ; les 22 vues de Keystone, Codex et Vigie identiques avant et après 30, 40 et 50 ;
- 90 : 31 vues contrôlées et accordées (79 couples vue et lecteur), les 4 vues ECR / ECO signalées absentes ; `droits.verifier()` sans erreur ; `matrix.journal_unifie` réunit les quatre journaux ;
- `../verifier-droits.sql` : 139 cas conformes, dont 30 sur les tables de Vigie ; `matrix_lecture` refusé sur chacune des 10 colonnes de santé de `vigie.events`, sur `change_log.details` et `reason`, et sur `benign_accidents`, `access_log` et `attachments` ;
- chaque outil lit exactement les vues accordées : 52 lectures réussies, 1 016 refusées, aucune hors `pub_`.

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
