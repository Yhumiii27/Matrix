# Serveur PostgreSQL commun : plan de migration des quatre outils

État au 15 octobre 2026, mis à jour le 18 octobre (décision P-02, bascule de Keystone et de Vigie, données de santé de Vigie) et le 22 octobre (lot 11 de Codex : § 4.5, § 6 ; schéma `extensions` ; proposition PostgreSQL 18, P-01). Ce plan met en œuvre deux décisions de l'utilisateur (`docs/decisions.md`) :

- **M-01** : « Oui, je valide le format postgreSQL commun avec un schema par outil ».
- **M-03 / D06** : « Ce n'est pas certain que Cursus remplace Lucca a ce stade mais prépare tout comme si cela est le cas. » Le groupe D06 (temps passés) suit donc l'option A : Cursus fait foi pour la saisie des heures, Keystone et Vigie reçoivent les heures validées. Le choix reste réversible.

Le socle du serveur est écrit et essayé : `infra/postgres/` (mise en service dans `infra/postgres/README.md`). Au 18/10/2026, Codex est basculé (fusionné dans `main` ; le lot 11 du 22/10/2026 en reprend le migrateur et la concurrence, § 4.5 et § 6), Keystone et Vigie le sont sur leur branche (Yhumiii27/Keystone#15, Yhumiii27/Vigie#7), Cursus reste à faire (§ 8). Les flux d'heures et d'absences (contrats, changements fonctionnels par outil) sont décrits dans `docs/remplacement-lucca.md` ; ce plan-ci en traite la partie base de données.

Sommaire : 1. Principe · 2. Conventions · 3. Colonnes sensibles · 4. Règles communes aux outils Drizzle · 5. Keystone · 6. Codex · 7. Vigie · 8. Cursus · 9. Heures validées (D06) · 10. Ordre de bascule · 11. Ce que lit Matrix · 12. Risques · 13. Charge · 14. Questions ouvertes.

## 1. Principe retenu

- **Un serveur, une base, un schéma par outil.** Le serveur PostgreSQL (16, décision du 15/10/2026 confirmée le 22/10/2026 : P-01) porte la base `epc2i`. Chaque outil a son schéma et un rôle de connexion qui en est le seul propriétaire. Un outil n'écrit jamais dans le schéma d'un autre : les écritures restent des API (flux de `data/flux.json`). Pour lire, il suit la convention de partage (`infra/postgres/partage/README.md`, `docs/convergence-des-donnees.md`, § 1.3) : l'outil qui fait foi publie des vues `pub_*` dans son schéma, et le lecteur reçoit `USAGE` sur ce schéma et `SELECT` sur ces seules vues. Lire une vue publiée n'est pas un accès au schéma : « un schéma par outil » reste vrai.
- **Matrix lit tout, sauf les colonnes sensibles.** Il se connecte en `matrix_app`, membre du groupe `matrix_lecture`. L'écriture dans les schémas des outils passe par un administrateur nominatif, membre de `matrix_admin`, dont chaque requête est journalisée.
- **Chaque outil garde sa base embarquée en repli.** Sans `DATABASE_URL`, Keystone, Codex et Vigie ouvrent PGlite, et Cursus ouvre SQLite, comme aujourd'hui : développement, tests, application Mac (`desktop/`). Avec `DATABASE_URL`, l'outil se connecte au serveur commun, dans son schéma. En PGlite, Keystone et Vigie gardent le schéma `public` (décision P-02 du 18/10/2026, § 4.2) ; Codex utilise son schéma `codex` dans les deux modes.
- **Chaque outil applique ses migrations au démarrage**, avec le journal dans son propre schéma (`<schéma>.__drizzle_migrations`, ou `cursus.schema_migrations`). Aucun rôle d'outil n'a le droit `CREATE` sur la base : il ne peut pas créer de schéma. D'où un petit migrateur commun (§ 4.3), parce que `migrate()` de Drizzle commence toujours par `CREATE SCHEMA IF NOT EXISTS`, que PostgreSQL refuse dans ce cas (vérifié sur les trois outils Drizzle).
- **Les droits sont posés par le serveur.** Les migrations des outils ne contiennent aucun `GRANT`. Le socle accorde à Matrix les tables créées plus tard et retire les colonnes sensibles dès leur création (§ 3).

## 2. Conventions

### 2.1 Base et paramètres

| Élément | Valeur | Raison |
|---|---|---|
| Base | `epc2i`, UTF-8 | Décision M-01. |
| Tri | `LC_COLLATE = C`, `LC_CTYPE = C.UTF-8` | Mêmes réglages que PGlite 0.5.8 (vérifié) : les listes triées par les outils ne changent pas d'ordre. Un tri français est une question ouverte (P-12). |
| Fuseau des sessions | `UTC` (`ALTER DATABASE epc2i SET timezone`) | PGlite est en `Etc/GMT0` : Keystone lit les horodatages en chaînes, qui gardent le même format. Les journaux du serveur restent en heure de Paris. |
| Format de date | `ISO, MDY` | Valeur de PGlite. |
| Schéma `public` | fermé à tous (`REVOKE ALL … FROM PUBLIC`) | Un objet créé sans schéma échoue au lieu d'atterrir là. |
| Transactions oubliées | `idle_in_transaction_session_timeout = 5min` pour les rôles des outils | Une transaction ouverte et oubliée garderait ses verrous : le verrou d'écriture de Keystone et de Vigie, les verrous de ligne de Codex (§ 4.5). |

### 2.2 Schémas et rôles

| Rôle | Type | Propriétaire de | `search_path` | Droits |
|---|---|---|---|---|
| `keystone_app` | connexion | `keystone` | `keystone` | Tout sur son schéma ; ailleurs, seulement `USAGE` et `SELECT` sur les vues `pub_` qui lui sont accordées (`partage/90-droits.sql`) ; pas de `CREATE` ni de `TEMPORARY` sur la base. |
| `codex_app` | connexion | `codex` | `codex` | Idem. |
| `cursus_app` | connexion | `cursus` | `cursus` | Idem. |
| `vigie_app` | connexion | `vigie` | `vigie` | Idem. |
| `arche_app` | connexion | `arche` | `arche` | Idem (ajouté le 22/10/2026 pour Arche, § 8 bis). |
| `crucible_app` | connexion | `crucible` | `crucible` | Idem (ajouté le 22/10/2026 pour Crucible, § 8 ter). |
| `matrix_app` | connexion | `matrix` | `matrix` | Tout sur `matrix` ; membre de `matrix_lecture`. |
| `matrix_lecture` | groupe | | | `USAGE` sur `keystone`, `codex`, `cursus`, `vigie`, `arche`, `crucible` et `droits` ; `SELECT` sur leurs tables et vues, sauf les colonnes sensibles ; aucun droit sur les séquences ; lecture de `droits.colonnes_sensibles` et de `droits.verifier()`. |
| `matrix_admin` | groupe, attribué nominativement | | | Tous les droits sur les tables, séquences et fonctions des sept schémas ; peut prendre le rôle d'un outil (`SET ROLE`, sans en hériter) ; modifie la liste des colonnes sensibles, sauf celles de la convention. |
| `epc2i_sauvegarde` | connexion | | | Membre de `pg_read_all_data` : lit tout, colonnes sensibles comprises, pour `pg_dump`. |
| `postgres` | superutilisateur | `droits` | | Administration du socle seulement, jamais dans un outil. |

Le schéma `droits` est un sixième schéma, technique. Il porte la liste des colonnes sensibles et les fonctions de contrôle. Il appartient au superutilisateur, parce que le propriétaire d'un schéma peut supprimer tout objet qu'il contient : placé dans `matrix`, le dispositif serait à la merci de `matrix_app`, lui-même membre de `matrix_lecture`.

Un septième schéma, `extensions` (propriétaire : le superutilisateur, `init/02-schemas.sql`) porte `pg_trgm`, nécessaire à l'index de recherche de Codex, que `codex_app` ne peut pas installer ; seul `codex_app` y a `USAGE`, et `droits.verifier()` signale tout autre droit sur ce schéma. Installée dans `codex`, l'extension mettrait ses fonctions, exécutables par tous, à la portée de chaque lecteur des vues `codex.pub_*` (droit `EXECUTE` croisé).

### 2.3 Colonnes sensibles

| Colonnes | Origine |
|---|---|
| `cursus.employes` : `visite`, `passeport_numero`, `passeport_expire`, `naissance`, `reprise_motif` | Convention du 15/10/2026 |
| `cursus.vaccinations` : `v`, `date` | Convention |
| `cursus.visas` : `type`, `obtenu`, `expire` | Convention |
| `cursus.entretiens` : `cr` | Convention |
| `vigie.events` : `injury`, `lost_days` | Convention |
| `vigie.events` : `cpam_declared_on`, `lesion_nature`, `lesion_site`, `care_given`, `reserves_on`, `cpam_waived_at`, `cpam_waived_by_id`, `cpam_waiver_reason` | Convention, ajout du 18/10/2026 : données de santé d'un accident du travail (`HEALTH_LABELS` de Vigie, `src/components/events/shared.ts`) |
| `vigie.change_log` : `details`, `reason` | Convention, ajout du 18/10/2026 : copies des champs de santé et du motif d'absence de déclaration CPAM dans le journal des modifications |
| `vigie.benign_accidents`, `vigie.access_log`, `vigie.attachments` : table entière (colonne `*`) | Convention, ajout du 18/10/2026 : registre des accidents bénins, journal des consultations, pièces médicales (`attachments.health` ne se filtre pas par colonne) |
| `cursus.journal` : `payload`, `message` ; `cursus.demandes_collab` : `label` | Proposition, à confirmer (P-04) |

Les ajouts du 18/10/2026 appliquent la convention (« aucune donnée de santé ») aux colonnes réelles de Vigie, relevées à sa bascule : `matrix_lecture` lisait jusque-là les lésions, les soins, les dates CPAM, le registre des accidents bénins et le journal des consultations. Une entrée `*` ferme la table entière, colonnes futures comprises. `droits.verifier()` signale en erreur toute colonne ou table de la liste redevenue lisible ; `verifier-droits.sql` l'éprouve sur chaque entrée de Vigie (cas 200 et suivants). Matrix garde le reste de `events` et de `change_log` (entité, action, résumé, auteur, date).

Les trois propositions viennent de l'analyse du code de Cursus. `journal.payload` recopie le corps de chaque action : `employe.creer` et `employe.modifier` y mettent `naissance`, `visite` et `repriseMotif` (`shared/rules/profil.ts:31-34`), `formalite.enregistrer` y met le vaccin, sa date et le numéro de passeport. `journal.message` et `demandes_collab.label` contiennent des phrases comme « Vaccination Fièvre jaune déclarée » (`server/src/actions/voyages.ts:31, 46, 47`). Elles sont exclues dès l'installation ; les rendre lisibles est un simple `DELETE` dans la liste. Matrix garde l'accès au reste du journal (`at`, `actor`, `role`, `action`), ce que demande D18.

## 3. Protection des colonnes sensibles

### 3.1 Le problème

`ALTER DEFAULT PRIVILEGES` est le seul moyen de rendre lisibles par Matrix les tables qu'un outil créera plus tard. Il accorde `SELECT` sur la table entière et ne sait pas exclure une colonne. Sans autre mécanisme, la recréation de `vigie.events` par une migration rendrait `injury` et `lost_days` lisibles par `matrix_lecture`.

### 3.2 Le mécanisme retenu

Un déclencheur d'événement, `droits_ddl` (`infra/postgres/init/03-droits.sql`), s'exécute à la fin de chaque commande `CREATE TABLE`, `CREATE TABLE AS`, `ALTER TABLE`, `CREATE VIEW`, `ALTER VIEW`, `CREATE MATERIALIZED VIEW`, `CREATE SEQUENCE`, `CREATE FOREIGN TABLE`, `CREATE SCHEMA`, `GRANT` ou `REVOKE` passée dans la base, quel que soit le rôle. Il lit les relations touchées (`pg_event_trigger_ddl_commands()`), puis les vues qui en dépendent, et met chacune dans l'état voulu :

| Relation | Droits de `matrix_lecture` |
|---|---|
| Table sans colonne listée | `SELECT` sur la table. |
| Table avec colonnes listées | `SELECT` sur chaque autre colonne ; rien sur les colonnes listées. |
| Table listée avec la colonne `*` | Aucun : table fermée en entier, colonnes ajoutées plus tard comprises, sans avertissement (gravité `info` dans `droits.verifier()`). |
| Table dont une colonne listée est absente (pas encore créée, renommée ou supprimée) | Aucun : la table est fermée jusqu'à la mise à jour de la liste ou la migration qui crée la colonne, avec un avertissement dans le journal de l'outil. |
| Table protégée renommée ou déplacée (repérée par son OID dans `droits.relations_protegees`) | Aucun, jusqu'à la mise à jour de la liste. |
| Vue ou vue matérialisée qui lit une colonne listée, une ligne entière d'une table protégée, ou une vue fermée | Aucun : une vue lit avec les droits de son propriétaire. La dépendance est lue dans `pg_depend`. |
| Partition ou table héritée | La liste de la table mère s'applique. |
| Séquence | Aucun. |

Il retire aussi tout droit accordé à `PUBLIC` dans les quatre schémas des outils (`matrix_lecture` en hériterait), et donne à `matrix_admin` tous les droits sur chaque relation des cinq schémas. Il n'écrit que s'il constate un écart.

La correction a lieu dans la transaction de la commande, avant son `COMMIT`. Les autres sessions ne voient la table qu'une fois corrigée : `matrix_lecture` ne lit jamais une colonne sensible, même un instant. Un `GRANT` passé par l'outil, par erreur, sur une table protégée est corrigé de la même façon. Les migrations des outils n'ont donc rien à faire.

Trois fonctions complètent le déclencheur :

- `droits.appliquer_droits()` : passe complète sur les cinq schémas, sans effet si tout est en ordre. Le rejeu du socle l'appelle ; on peut la relancer après une migration, en contrôle.
- `droits.verifier()` : liste les écarts avec une gravité (`erreur`, `attention`, `info`) : colonne sensible lisible, vue sensible lisible, droit d'écriture de `matrix_lecture` ou de `matrix_app`, droit croisé d'un outil hors de la convention de partage (seuls `USAGE` sur le schéma et `SELECT` sur ses vues `pub_` sont acceptés), vue `pub_` ou `cursus.*_v1` qui lit une colonne sensible ou un autre schéma, lecteur prévu par `partage/90-droits.sql` (liste `droits.partage_lecteurs`) qui a perdu son `USAGE` ou son `SELECT`, droit `CREATE` sur la base, attribut d'administration, propriétaire de schéma, `search_path`, administrateur non journalisé, privilège par défaut manquant, entrée de la liste sans objet, fonction `SECURITY DEFINER` d'un outil exécutable par `matrix_lecture`.
- `droits.declarer_admin(nom)` : crée un administrateur nominatif, membre de `matrix_admin`, avec `log_statement = 'all'`.

Une modification de `droits.colonnes_sensibles` réapplique les droits dans la même transaction. Les colonnes de la convention ne se retirent qu'en superutilisateur.

### 3.3 Essais

Faits sur PostgreSQL 16.15, avec le script d'entrée officiel de l'image (`docker-entrypoint.sh` de `docker-library/postgres`, version 16-bookworm), exécuté hors de Docker avec les binaires du poste (seuls le chemin des scripts et le dossier de la socket sont adaptés) :

- Les trois scripts passent au premier démarrage, puis en rejeu sur une base remplie (336 relations, 2,5 s).
- Les migrations de base régénérées par les analyses, appliquées par le rôle de chaque outil : Keystone (203 tables, 573 commandes), Codex (22 tables), Vigie (36 tables), puis `infra/postgres/cursus/schema.sql` avec le jeu de démonstration de Cursus. `droits.verifier()` ne signale aucune erreur. Pour `vigie.events`, `matrix_lecture` lit 18 colonnes sur 20.
- `infra/postgres/verifier-droits.sql` : 94 cas conformes à ce premier essai (96 depuis l'ajout des cas 135 et 136, ci-dessous), dont `GRANT` de l'outil à `matrix_lecture` ou à `PUBLIC`, ajout et renommage de colonne, renommage de table, vues (colonne sensible, ligne entière, vue sur vue), partitions, sauvegarde, administration, et convention de partage (cas 100 à 134 : lecture d'une vue `pub_` d'un autre outil acceptée ; table, colonne, séquence, vue non publiée, écriture, `CREATE`, vue `pub_` sensible ou dépendant d'un autre schéma signalés ; cas 135 et 136 ajoutés depuis : lecteur attendu qui perd son droit).
- Partage en place (15/10/2026, PostgreSQL 16.15 neuf) : socle, migrations des quatre outils, Cursus et sa démonstration, vues `*_v1`, puis `infra/postgres/partage/` deux fois dans l'ordre de son README. `droits.verifier()` ne renvoie aucune ligne et `verifier-droits.sql` passe ses 94 cas. Chaque outil lit exactement les vues accordées et aucune table d'un autre schéma (détail dans `infra/postgres/partage/README.md`, « Essais »).
- Coût : la migration de base de Keystone prend 3,3 s avec le déclencheur et 2,0 s sans, soit 2 ms par commande.
- Contre-essai du 15/10/2026 sur un PostgreSQL 16.15 neuf, en connexions réelles par mot de passe : scripts passés deux fois sur base vide puis rejoués sur base remplie, sans aucun changement d'état ; migrations du dépôt de chaque outil, `"public".` remplacé par le schéma (370, 38 et 58 références), puis migrations de base régénérées : 203, 22 et 36 tables dans le bon schéma, journal dans le schéma de l'outil, aucun objet dans `public` ; démonstration de Cursus générée par son code (417 lignes) et chargée avec toutes les contraintes actives ; 315 cas d'isolation entre rôles ; 292 relations et 2 722 colonnes essayées une à une par `matrix_app` : 16 refusées, exactement celles de la liste ; table protégée recréée, colonne sensible ajoutée dans les deux ordres, `GRANT` de l'outil, vues ; sauvegarde par `epc2i_sauvegarde`, puis restauration dans une base neuve et par la procédure du README.
- Essai du 18/10/2026 après la bascule de Keystone et de Vigie (PostgreSQL 16.15 neuf, port 5443) : socle, puis migrateurs réels des outils dans leur schéma (Keystone `db:migrate`, 212 tables ; Codex `main`, 22 ; Vigie en démonstration, 52 ; Cursus : `infra/postgres/cursus/schema.sql`, 28) ; partage joué deux fois (10, 20, 30, 40, 50, 90, 95), état des droits identique après le second passage et après un rejeu de `init/03` ; les 22 vues `pub_` de Keystone, Codex et Vigie identiques avant et après 30, 40 et 50 (définition, options, commentaire) ; `droits.verifier()` sans erreur ; `verifier-droits.sql` : 139 cas conformes, dont 30 sur les tables de Vigie (15 entrées de santé refusées à Matrix, puis signalées une à une par `droits.verifier()` quand elles redeviennent lisibles) ; chaque outil lit exactement ses vues accordées (52 lectures, 1 016 refus, aucune hors `pub_`).
- Contre-essai après relecture (15/10/2026, PostgreSQL 16.15 neuf, port 55441) : partage joué deux fois, `droits.verifier()` sans aucune ligne, `verifier-droits.sql` à 96 cas (cas 135 et 136 : un lecteur prévu par `partage/90-droits.sql` qui perd son `SELECT` ou son `USAGE` est signalé). Restauration de `cursus` partage en place : le `DROP SCHEMA cursus CASCADE` emporte `matrix.journal_unifie` ; après `pg_restore --no-privileges`, `droits.verifier()` signale 8 erreurs (lecteurs sans `USAGE`) et 1 attention ; le rejeu du fichier de l'outil, de 90 et de 95 rétablit tout (procédure : `infra/postgres/README.md`, « Restaurer le schéma d'un outil »).

### 3.4 Limites

- Une colonne sensible créée sous un nom absent de la liste est lisible par Matrix dès sa création. La liste doit être complétée avant la migration. Le collecteur de Matrix inscrit chaque nouvelle colonne dans `data/historique.json` : c'est le moment de trancher.
- Inscrire la colonne avant la migration ferme la table entière à Matrix jusqu'à cette migration (règle de la colonne absente) : l'inscription se fait juste avant le déploiement de l'outil.
- La liste protège des colonnes nommées, pas des valeurs. Une copie dans une autre table (`CREATE TABLE … AS SELECT`, table de sauvegarde laissée par une migration) est lisible par Matrix tant qu'elle n'est pas inscrite (constaté au contre-essai).
- Une fonction `SECURITY DEFINER` créée par un outil contournerait les droits par colonne. Les privilèges par défaut retirent `EXECUTE` à `PUBLIC` sur les fonctions des outils (vérifié : appel refusé à Matrix) ; aucun outil n'en crée aujourd'hui. Un `GRANT EXECUTE` explicite de l'outil à `matrix_lecture` rouvre l'accès : `droits.verifier()` le signale (gravité `attention`).
- Un superutilisateur peut désactiver le déclencheur (`ALTER EVENT TRIGGER droits_ddl DISABLE`). `droits.verifier()` le signale en erreur.
- `epc2i_sauvegarde` et les administrateurs lisent tout : leurs mots de passe et les fichiers de sauvegarde sont aussi sensibles que la base.

## 4. Règles communes aux trois outils Drizzle

Keystone, Codex et Vigie ont la même pile (Next.js 16, Drizzle 0.45.3, PGlite 0.5.8). Les règles ci-dessous valent pour les trois ; les sections 5 à 7 donnent les fichiers exacts.

### 4.1 Ouverture de la base

Un seul module choisit le pilote, une fois par processus :

- `DATABASE_URL` présente et non vide : pool `pg` (`drizzle-orm/node-postgres`), `application_name` = nom de l'outil, `options: -c search_path=<schéma>` (le `search_path` est aussi fixé sur le rôle, ce qui suffit derrière PgBouncer) ;
- sinon : PGlite dans le dossier de données habituel ; Codex y travaille dans le schéma `codex` (`search_path` « codex, public » posé au démarrage de PGlite, `src/lib/pglite-options.mjs`), Keystone et Vigie restent dans `public` (P-02) ;
- `next build` ne doit jamais ouvrir le serveur commun : garde sur `process.env.NEXT_PHASE === 'phase-production-build'` (Next fixe cette variable pendant le build), qui force PGlite. Keystone et Vigie ouvrent la base pendant le build ; Codex non, la garde y est ajoutée par précaution ;
- Codex (lot 11, 22/10/2026) : une ancienne base PGlite, dont les tables sont dans `public`, n'est jamais ouverte telle quelle. Celle de la branche v2 au 21/10/2026 (chaîne de migrations `0000` à `0005`, empreintes connues) est **reprise automatiquement** au démarrage, après une sauvegarde : dans une transaction, `public` devient `codex` (tables, données, séquences, fonctions, collation, `pg_trgm`), un `public` vide est recréé, le journal passe dans `codex.__drizzle_migrations`, puis `0001_partage` s'applique. Toute autre (démonstration de `main` d'avant le 17/10/2026, celle du volume Coolify `/data/pglite`) est refusée, intacte, avec un message qui nomme le dossier et le remède : `npm run db:reset` pour `.data`, suppression du dossier `pglite` quand `CODEX_DATA_DIR` est fixé (§ 4.6). Sur un serveur, Codex refuse toute base dont les tables sont dans `public`. Sans ce garde-fou, le nouveau code créerait le schéma à côté et les anciennes données deviendraient invisibles sans avertissement. Keystone et Vigie n'en ont pas besoin en PGlite (rien n'y change) ; sur le serveur, ils refusent une base de l'ancienne disposition (tables de l'outil dans `public`) avec un message qui le dit (§ 5.1, § 7.1).

Type commun aux deux pilotes, essayé dans Keystone (`tsc` sans erreur sur 128 fichiers qui importent `DB` ou `Tx`) :

```ts
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/** Résultat de db.execute() commun aux deux pilotes (Results de PGlite, QueryResult de node-postgres) : les lignes. */
export interface QueryRows<T> {
  rows: T[];
}
export interface AppQueryResultHKT extends PgQueryResultHKT {
  readonly type: QueryRows<this['row']>;
}
export type DB = PgDatabase<AppQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
```

### 4.2 Schéma Drizzle et migration de base

Décision P-02 (18/10/2026) : pour Keystone et Vigie, les migrations publiées et les fichiers de schéma (`pgTable`) ne sont **pas** réécrits. Sur le serveur, le migrateur de l'outil remplace `"public".` par `"<schéma>".` au moment d'appliquer chaque instruction, et chaque connexion fixe `search_path=<schéma>` : noms non qualifiés et requêtes Drizzle résolvent dans le schéma de l'outil. La base embarquée (PGlite : développement, tests, application Mac) reste dans `public`. Le schéma est une constante du code serveur (`SERVER_SCHEMA`, § 5.1 et § 7.1). Ce qui suit, `pgSchema` et migration de base régénérée, ne vaut plus que pour Codex, basculé ainsi avant la décision (§ 6).

- Codex : les tables sont déclarées avec `pgSchema('<schéma>').table(…)` au lieu de `pgTable(…)`. Drizzle qualifie alors toutes ses requêtes (`"vigie"."sites"`) et drizzle-kit écrit `REFERENCES "<schéma>"."…"`. Avec `pgTable` et le seul `search_path`, drizzle-kit écrit `REFERENCES "public"."…"` à chaque migration, qu'il faudrait retoucher à la main.
- L'objet `pgSchema` n'est **pas exporté** par le fichier de schéma. Exporté, drizzle-kit ajoute `CREATE SCHEMA "<schéma>";` en tête de migration, que le rôle de l'outil ne peut pas exécuter (vérifié dans Keystone et Codex ; dans Vigie, l'objet exporté obligeait à retirer deux lignes de la migration générée).
- Les migrations contenaient des références `"public"` en dur : 370 dans Keystone, 38 dans Codex, 58 dans Vigie. Appliquées telles quelles par le rôle de l'outil, elles échouent (`permission denied for schema public`). Codex est reparti d'une migration de base unique, régénérée ; Keystone et Vigie les réécrivent à l'application (P-02). Les analyses ont comparé la structure obtenue à l'ancienne : mêmes colonnes, types, défauts, clés et règles de suppression ; seul l'ordre de quelques colonnes change.
- `drizzle.config.ts` de Codex (Keystone et Vigie gardent le leur, sans `schemaFilter`) :

```ts
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['codex'],
  migrations: { schema: 'codex', table: '__drizzle_migrations' },
});
```

Le bloc `migrations` ne sert qu'aux commandes de drizzle-kit (`migrate`, `studio`). À l'exécution, c'est le migrateur du § 4.3 qui tient le journal.

### 4.3 Migrateur commun

Principe commun aux trois outils, mis en œuvre par chacun : `applyMigrations` de `src/db/migrations.ts` dans Codex (§ 6.1 ; le `migrateSchema` ci-dessous est la première version, celle de la bascule du 15/10/2026, retirée au lot 11), `applyServerMigrations` dans Keystone (§ 5.1), `migrateServer` dans Vigie (§ 7.1). Ces deux derniers ajoutent la réécriture `"public".` → `"<schéma>".` de chaque instruction (P-02) et ne servent que sur le serveur ; PGlite y garde `migrate()` de Drizzle (journal `drizzle.__drizzle_migrations`), qui ne pose pas de problème en base embarquée. Partout : journal `<schéma>.__drizzle_migrations`, verrou `hashtext('<schéma>.migrations')` pris avant de créer ou de lire le journal, jamais de `CREATE SCHEMA` sur le serveur commun.

`migrate(db, { migrationsSchema })` de Drizzle place bien le journal dans le schéma de l'outil, mais lance d'abord `CREATE SCHEMA IF NOT EXISTS` (`drizzle-orm/pg-core/dialect.js:54`). PostgreSQL vérifie le droit `CREATE` sur la base avant de constater que le schéma existe : `ERROR: permission denied for database epc2i`. Accorder ce droit permettrait à l'outil de créer d'autres schémas, contre la convention. Chaque outil reçoit donc ce migrateur, qui tient le même journal que Drizzle (table `<schéma>.__drizzle_migrations`, colonnes `id`, `hash`, `created_at`, même règle d'ordre) :

```ts
// Codex, première bascule (15/10/2026) : src/db/migrate.ts, remplacé au lot 11 par src/db/migrations.ts (§ 6.1)
import 'server-only';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { DB } from './types';

/** Schéma PostgreSQL de l'outil : ses tables et le journal de ses migrations. */
export const DB_SCHEMA = 'codex';
const JOURNAL = sql`${sql.identifier(DB_SCHEMA)}.${sql.identifier('__drizzle_migrations')}`;

/**
 * Applique les migrations de `migrationsFolder` absentes du journal, dans une seule transaction. Même journal que
 * migrate() de Drizzle avec migrationsSchema, sans son CREATE SCHEMA : le schéma existe déjà (serveur : créé par le
 * socle ; PGlite : créé par le module d'ouverture). Le verrou est pris avant de créer le journal : deux instances qui
 * démarrent ensemble appliquent chaque migration une seule fois.
 */
export async function migrateSchema(db: DB, migrationsFolder: string): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder });
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${DB_SCHEMA}.migrations`}))`);
    await tx.execute(sql`create table if not exists ${JOURNAL} (id serial primary key, hash text not null, created_at bigint)`);
    const { rows } = await tx.execute<{ created_at: string | number }>(sql`select created_at from ${JOURNAL} order by created_at desc limit 1`);
    const last = rows[0] ? Number(rows[0].created_at) : -1;
    for (const m of migrations) {
      if (m.folderMillis <= last) continue;
      for (const stmt of m.sql) if (stmt.trim()) await tx.execute(sql.raw(stmt));
      await tx.execute(sql`insert into ${JOURNAL} (hash, created_at) values (${m.hash}, ${m.folderMillis})`);
    }
  });
}
```

Essais : la même logique a tourné sur PGlite puis sur le serveur en tant que `codex_app`, avec deux instances lancées en même temps (23 tables, une seule ligne au journal). Un journal créé avant la prise du verrou donne, au premier démarrage simultané, une erreur `duplicate key … pg_type_typname_nsp_index` (constaté par l'analyse Keystone) : le verrou passe donc en tête, dans les trois outils.

Les clés de verrou consultatif sont communes à toute la base `epc2i` : chaque outil dérive les siennes de son nom de schéma pour ne jamais bloquer un autre outil : `hashtext('<schéma>.migrations')` pour les migrations, `hashtext('<schéma>.ecritures')` pour les écritures (§ 4.5). Keystone : `keystone.migrations`, `keystone.ecritures` ; Vigie : `vigie.migrations`, `vigie.ecritures` ; Codex : `codex.migrations` (verrou de session pris avant de lire le journal) et `codex.seed` (remplissage), pas de verrou d'écriture global (§ 4.5) ; ses autres verrous consultatifs (`codex:import`, `codex:transfer`) sont pris dans la transaction.

### 4.4 Politique des dépôts sur les migrations

| Outil | Règle du dépôt | Conséquence |
|---|---|---|
| Keystone | `CLAUDE.md` : « generate a new one with `npm run db:generate` and never edit an existing one ». | Respectée : aucune migration réécrite (P-02, 18/10/2026) ; le partage arrive par `0034_share_prerequisites` et `0035_share`. |
| Codex | `CLAUDE.md` (lot 11) : « Ne plus jamais supprimer `drizzle/` ni régénérer ou modifier une migration déjà commitée ». | Migration de base régénérée une dernière fois le 22/10/2026 (`0000_init`, `pgSchema`), puis `0001_partage`, figées. |
| Vigie | `CLAUDE.md` : « une migration publiée ne se modifie jamais » ; empreintes dans `drizzle/checksums.json`. | Respectée : aucune migration réécrite (P-02) ; le partage arrive par `0008_partage_prerequis` et `0009_partage`. |

Dans les trois outils, les migrations publiées sont désormais **figées** : uniquement des migrations incrémentales.

### 4.5 Concurrence

PGlite exécute toutes les requêtes et transactions l'une après l'autre. Un pool `pg` les exécute en parallèle. Les trois outils calculent des numéros métier en « plus grand + 1 » :

- Keystone : 5 créations simultanées de risque donnent 2 succès et 3 erreurs `risks_project_id_number_unique` ;
- Codex : 17 imports sur 20 échouent sur `documents_pkey` (`nextDocId`, `src/lib/codification.ts:10-16`) ;
- Vigie (constat du 15/10/2026, corrigé depuis) : `nextRef` était appelé **hors transaction** dans 10 fonctions ; les numéros et références sont désormais calculés dans la transaction de l'écriture, sur un compteur (`nextActionNumber`, `nextEntityReference`), `nextRef` ne servant plus qu'à l'aperçu côté navigateur.

Deux réponses sont en place : un verrou d'écriture par outil (Keystone, Vigie), des verrous de ligne (Codex, depuis le lot 11).

**Keystone et Vigie : chaque transaction d'écriture prend le verrou d'écriture de l'outil.** Les écritures de l'outil passent l'une après l'autre, comme dans PGlite ; les lectures hors transaction restent parallèles. Code essayé dans Keystone (5 créations simultanées : 5 succès) :

```ts
/** db.transaction() prend d'abord le verrou d'écriture de l'outil : ses transactions passent l'une après l'autre. */
function serializeTransactions(db: DB): DB {
  const transaction = db.transaction.bind(db);
  db.transaction = ((fn, config) =>
    transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${DB_SCHEMA}.ecritures`}))`);
      return fn(tx);
    }, config)) as DB['transaction'];
  return db;
}
```

Le verrou ne protège que ce qui se passe dans la transaction. Un numéro calculé avant elle, hors verrou, reste exposé : dans les trois outils, chaque calcul « plus grand + 1 » entre dans la transaction de l'écriture qu'il prépare, et lit par `tx`.

- **Keystone.** `createProject` calculait `nextProjectNumber` et `nextAnalyticCode` avant d'ouvrir `db.transaction` : deux créations simultanées obtenaient le même `#NNN`. Les deux calculs sont dans la transaction depuis la bascule (§ 5.1). La revue des 65 calculs « plus grand + 1 » de Keystone, à la recherche des autres cas de ce genre, reste à faire (§ 13).
- **Vigie.** Références calculées dans la transaction de l'écriture (ci-dessus, § 7.1).
- **Codex.** Voir ci-dessous : plus de calcul « plus grand + 1 », des compteurs.

**Codex : verrous de ligne en `READ COMMITTED`, sans verrou d'écriture global.** La première bascule (15/10/2026, § 6) avait transposé le verrou `codex.ecritures` de Keystone. Le lot 11 (22/10/2026) garde à sa place les règles de la branche v2 de Codex, revues transaction par transaction le 18/10/2026 (`docs/postgres.md` de Codex, « Transactions en `READ COMMITTED` ») :

- isolation par défaut de PostgreSQL (`READ COMMITTED`), transactions en parallèle sur le pool (`CODEX_DB_POOL`, 10 par défaut) ;
- une transaction qui lit l'état d'un document (ligne, révisions, versions de travail, circuits, demandes de modification) pour décider ce qu'elle écrit verrouille d'abord la ligne du document (`SELECT … FOR UPDATE` : `lockDoc`, `lockDocs` de `src/lib/lifecycle.ts`, `lockWorkflow` de `src/lib/actions.ts`), dans l'ordre des identifiants quand il y en a plusieurs, puis relit ; une seconde transaction sur le même document attend la première et lit ce qu'elle a écrit (double approbation, double mise en vigueur, demande en double, décision Vigie appliquée deux fois : refusées) ;
- identifiants tirés d'un compteur (`codex.id_counters`, une instruction `INSERT … ON CONFLICT` dans la transaction de l'écriture : les tirages simultanés font la queue sur la ligne du compteur, une transaction annulée rend son numéro) ; import et reprise des documents d'une personne qui part sous `pg_advisory_xact_lock` (clés `codex:import`, `codex:transfer`) ; bail du planificateur par mise à jour conditionnelle ;
- vérifié entre connexions sur PostgreSQL 18.3 par `npm run test:pg` de Codex (`tests/integration/postgres-server.test.ts`, `read-committed.test.ts` : 60 créations simultanées sur 10 connexions donnent 60 identifiants distincts et consécutifs ; l'ancien calcul « plus grand + 1 » donne bien un doublon).

Le délai `idle_in_transaction_session_timeout` du socle (5 minutes, § 2.1) vaut pour ces verrous de ligne comme pour le verrou d'écriture.

### 4.6 Application Mac, Docker, Coolify

- **Application Mac.** `next start` tourne dans le dossier du projet, et Next charge ses fichiers `.env*`. Un `DATABASE_URL` mis dans `.env.local` pour le développement brancherait l'application Mac sur le serveur commun. Dans la fonction `environment()` de chaque application : `env["DATABASE_URL"] = ""`. Next ne remplit depuis les fichiers `.env` que les clés absentes (`@next/env`, vérifié par les analyses) ; une valeur vide les bloque, et le module d'ouverture traite le vide comme une absence.
- **Base de l'application Mac.** Keystone et Vigie : rien ne change, leur base PGlite reste dans `public` (P-02). Codex garde sa base PGlite hors du projet (`CODEX_DATA_DIR` = `~/Library/Application Support/Codex/data`, `desktop/CodexApp.swift`) : une base de la branche v2 est reprise automatiquement dans le schéma `codex`, après sauvegarde (§ 4.1) ; une autre, plus ancienne, est refusée, et `npm run db:reset` n'y touche pas. Remède dans ce cas : quitter l'application, supprimer `~/Library/Application Support/Codex/data/pglite`, relancer : la démonstration est rechargée et les fichiers déposés (`…/data/files`) restent. Le message du garde-fou nomme ce dossier.
- **Dockerfile.** Ne jamais mettre `DATABASE_URL` dans l'image. Le volume `/data` reste nécessaire : il porte les fichiers déposés, et la base de repli. Il porte aussi l'ancienne base PGlite : elle sert au retour arrière par redéploiement du commit précédent (§ 10). Mettre à jour le commentaire d'en-tête.
- **Coolify.** `DATABASE_URL` en variable d'exécution seulement (jamais disponible au build), le volume `/data` gardé, l'option de réseau prédéfini activée (`infra/postgres/README.md`).
- **Dépendances.** `pg` 8.23.1 en dépendance, `@types/pg` 8.23.1 en dépendance de développement. `drizzle-orm/node-postgres` est déjà dans `drizzle-orm` 0.45.3. `pg` est externe par défaut dans Next 16 : `serverExternalPackages` ne change pas.
- **Jeu de démonstration sur le serveur.** Seulement avec une variable explicite (`KEYSTONE_SEED=demo` au premier `db:migrate`, `CODEX_SEED_DEMO=1`, `VIGIE_DEMO=1`), en bêta. En production, la décision A-15 de Keystone demande des données réelles (P-11).

### 4.7 Différences de pilote

| Point | PGlite | node-postgres | Effet |
|---|---|---|---|
| `date`, `timestamp`, `timestamptz` en `mode: 'string'` | chaîne | chaîne | Aucun (Drizzle force la chaîne). |
| `timestamptz` en mode par défaut | `Date` | `Date` | Aucun (Vigie). |
| `numeric` | chaîne | chaîne | Aucun. |
| `int8` (`count(*)` sans conversion) | nombre | chaîne | Aucune requête brute concernée : toutes castent en `::int` (Keystone, Codex, Vigie vérifiés). |
| `db.execute().rows` | oui | oui | Type commun du § 4.1. |
| Version du moteur | PostgreSQL 18.3 | PostgreSQL 16 (P-01, confirmé le 22/10/2026) : Codex doit retirer `pg_unicode_fast` | Codex utilise la collation `pg_unicode_fast`, propre à la 18, et refuse un serveur plus ancien ; Keystone et Vigie n'utilisaient rien de propre à 17 ou 18 au 18/10/2026. À trancher : P-01. |

### 4.8 Déclaration à Matrix

Après les migrations, chaque outil peut appeler `introspecterPostgres` (`integration/declarer-schema.mjs`) avec une fonction qui exécute du SQL brut : `q => db.execute(sql.raw(q)).then(r => r.rows)`. La requête lit `current_schema()` : le `search_path` posé dans les deux modes suffit. Elle écarte déjà les journaux des migrations (`__drizzle_migrations`, `schema_migrations` : `integration/declarer-schema.mjs:32`, et `:75` pour SQLite) : au 18/10/2026, Codex déclare ses 22 tables, Keystone 212, Vigie 52 (Cursus : 46 au catalogue).

### 4.9 Prérequis du partage et migrations incrémentales

Le partage passe par les migrations de l'outil (P-02, 18/10/2026). Les colonnes et tables prérequises appartiennent à l'outil : elles sont déclarées dans son schéma Drizzle (ou dans `server/migrations-pg/` pour Cursus), pour que drizzle-kit ne les supprime pas à la migration suivante, et créées par une migration générée ; les vues `pub_` suivent dans une migration SQL écrite à la main, sans nom de schéma pour Keystone et Vigie (résolues dans `public` en PGlite, dans le schéma de l'outil sur le serveur), dans la même livraison (§ 1.3 de `docs/convergence-des-donnees.md`). Le fichier de partage de Matrix devient la copie qualifiée de ces vues : le rejouer ne change rien, et il échoue avec un message clair si la migration de l'outil n'est pas passée. Ordre de pose : migration de l'outil, puis son fichier de partage, puis `90-droits.sql` (et `95` pour le journal).

| Outil | Migrations du partage (dépôt de l'outil) | Fichier de Matrix | Tables (catalogue, 18/10/2026) |
|---|---|---|---|
| Cursus | À faire (8.b) : `employes.matricule` (déjà dans `cursus/schema.sql`), `site_code`, `unite_code`, `sortie` ; `budgets.unite_code`, `plan_actions.unite_code` ; `certifications.organisme` ; `journal.actor_emp_id`, `objet_ref`, `projet_code` ; 3 index ; vues `pub_` | `20-cursus.sql`, qui crée encore ces prérequis (`IF NOT EXISTS`) | 46 au catalogue (28 dans `cursus/schema.sql`, à réaligner) |
| Keystone | `0034_share_prerequisites` (`countries.iso2`, `projects.kind`, `departments.org_code`, colonnes des miroirs `vigie_ecos` et `vigie_ncrs`, 2 index ; `persons.matricule` depuis `0024`), `0035_share` (12 vues) | `30-keystone.sql` : copie des vues, contrôle des prérequis | 212 |
| Codex | `0001_partage` (`documents.distribution`, `review_months`, `process_code` ; `users.matricule` ; `departments.active` ; 1 index ; 7 vues) | `40-codex.sql` (prérequis en `IF NOT EXISTS`, sans effet) | 22 |
| Vigie | `0008_partage_prerequis` (`keystone_project_code` dans 4 tables, 9 colonnes du volet NC de `events`, `contractors.supplier_id`), `0009_partage` (3 vues) ; pas de `inductions`, `document_actions` ni `journal` (`pub_journal` lit `change_log`) | `50-vigie.sql` : copie des vues, contrôle des prérequis. `60-vigie-ecr-eco.sql` : module ECR / ECO à construire, à ne pas jouer | 52 |
| Matrix | `10-matrix-referentiels.sql` : `pays`, `sites`, `organigramme`, `correspondances` | idem | 4, par les migrations de Matrix (§ 11) |

Numérotation. Les migrations incrémentales prennent leur numéro à la fusion, dans l'ordre où elles arrivent : drizzle-kit le fixe pour Keystone, Codex et Vigie, l'auteur pour Cursus (`server/migrations-pg/NNNN_<objet>.sql`). Deux sont prévues dans chaque outil : `partage` (prérequis ci-dessus et vues `pub_` ; faite dans Keystone, Codex et Vigie) et, pour Cursus, Keystone et Vigie, `echanges_rh` (D06 et D07, `docs/remplacement-lucca.md`, § 5). Les documents les désignent par leur nom, pas par leur numéro.

## 5. Keystone

Basculé le 18/10/2026 sur la branche `claude/shared-postgres` du dépôt Keystone (demande de fusion Yhumiii27/Keystone#15), selon la décision P-02 : les migrations publiées (`drizzle/`, 36 migrations) et les fichiers de schéma (`pgTable`) restent tels quels. Les règles communes du § 4 s'appliquent, avec les écarts propres à Keystone notés ci-dessous. Essai du 18/10/2026 (PostgreSQL 16.15 doté du socle, en `keystone_app`) : `npm run db:migrate` applique les 36 migrations et la démonstration dans le schéma `keystone` (212 tables et le journal, 12 vues `pub_`), rien dans `public`, `droits.verifier()` sans erreur.

### 5.1 Fichiers

| Fichier (dépôt Keystone) | Rôle |
|---|---|
| `src/server/db/server-schema.ts` | Constantes du serveur : `SERVER_SCHEMA = 'keystone'`, `SERVER_CONNECTION_OPTIONS` (`-c search_path=keystone`), clés de verrou `keystone.migrations` et `keystone.ecritures`, `serverStatement()` qui remplace exactement `"public".` par `"keystone".`. PGlite garde `public` et le journal de Drizzle (`drizzle.__drizzle_migrations`). |
| `src/server/db/migrations.ts` | `applyServerMigrations` : migrateur du serveur. Refuse une base sans schéma `keystone` ou qui porte des tables Keystone dans `public` (ancienne disposition), crée si besoin `keystone.__drizzle_migrations` (mêmes colonnes et même règle d'ordre que Drizzle), puis applique en une transaction les migrations plus récentes que la dernière du journal, chaque instruction réécrite par `serverStatement`. Jamais de `CREATE SCHEMA`. `pendingMigrations` sert au contrôle de démarrage. |
| `src/server/db/postgres.ts` | Pool `pg` (`application_name` = `keystone`, `search_path` dans `options`), `withMigrationLock` : verrou de session `pg_advisory_lock(hashtext('keystone.migrations'))` sur une connexion dédiée, pris avant de créer ou de lire le journal ; migrations puis remplissage sous ce verrou. |
| `src/server/db/transactions.ts` | `withWriteLockedTransactions` : chaque `db.transaction()` du serveur prend d'abord `pg_advisory_xact_lock(hashtext('keystone.ecritures'))` et s'exécute en `READ COMMITTED` (derrière le verrou, les transactions passent l'une après l'autre ; en `SERIALIZABLE`, l'instantané serait pris avant l'attente). Interblocage rejoué. PGlite garde `SERIALIZABLE` avec reprise (R-010). |
| `src/server/db/client.ts` | `next build` n'ouvre jamais le serveur (`NEXT_PHASE`), même avec `DATABASE_URL` : il prend la base PGlite de `KEYSTONE_DATA_DIR`. Au démarrage, le serveur refuse une migration en attente (`/api/health` répond 503). |
| `scripts/db-migrate.ts` (`npm run db:migrate`) | Seul chemin qui migre un serveur : au déploiement, jamais au démarrage de l'application. Deux `db:migrate` simultanés appliquent chaque migration une fois et ne remplissent qu'une fois. |
| `src/server/dal/projects.ts`, `src/server/db/seed/index.ts` | Numéro et code analytique de `createProject` calculés dans la transaction de l'écriture (§ 4.5) ; vide de la base contrôlé dans la transaction du remplissage. |
| `drizzle/0034_share_prerequisites.sql`, `drizzle/0035_share.sql` | Partage (§ 4.9) : colonnes prérequises déclarées dans le schéma Drizzle (`countries.iso2`, `departments.org_code`, `projects.kind`, colonnes des miroirs `vigie_ecos` et `vigie_ncrs`, index de `audit_entries` et `activity_events` ; `persons.matricule` existe depuis `0024`), puis les 12 vues `pub_`, écrites sans schéma (résolues dans `public` en PGlite, dans `keystone` sur le serveur). `partage/30-keystone.sql` de Matrix en est la copie qualifiée. |
| `src/server/backup/` | `pg_dump --schema=keystone` ; restauration dans un schéma `keystone` existant et vide (`--no-owner --no-acl`), droits des lecteurs reposés ensuite par `partage/90-droits.sql`. |
| `.github/workflows/ci.yml`, `infra/postgres-socle/` | Tâche PostgreSQL 16 : les trois scripts `init/` de Matrix y sont recopiés (dépôt Matrix privé), puis deux `db:migrate` simultanés en `keystone_app`, `scripts/db-check.ts --postgres` et les tests PostgreSQL. Un changement de `infra/postgres/init/` dans Matrix se recopie dans `infra/postgres-socle/`. |
| `desktop/KeystoneApp.swift`, `deploy/compose.yaml`, `deploy/postgres-init/` | L'application Mac fixe `DATABASE_URL` à vide ; le kit Compose crée le schéma `keystone` sur sa base dédiée. |
| `docs/EXPLOITATION.md` § 4.1, `README.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md`, `.env.example` | Mise en service sur le serveur commun, variables, sauvegarde et restauration du schéma `keystone`. |

### 5.2 Mise en service

1. Socle (`infra/postgres/init/`), qui crée le rôle `keystone_app` et le schéma `keystone`.
2. `npm run db:migrate` avec `DATABASE_URL` et `KEYSTONE_SEED` : migrations (vues `pub_` comprises) puis jeu de départ.
3. Démarrage du serveur web et du worker avec la même `DATABASE_URL` ; `GET /api/health` répond 200.
4. Partage : `partage/30-keystone.sql` en `keystone_app` (sans effet : mêmes vues que `0035_share`), puis `partage/90-droits.sql` et `95-matrix-journal-unifie.sql` (`infra/postgres/partage/README.md`).

### 5.3 Tests

- Les tests restent sur PGlite (`public`) ; `test.env.DATABASE_URL` vide empêche un test d'atteindre le serveur commun.
- Tests PostgreSQL facultatifs (`src/server/db/postgres.integration.test.ts`) : disposition du schéma, créations de projets simultanées, verrou d'écriture.
- Intégration continue : tâche PostgreSQL 16 du § 5.1 ; critère de fusion : aucun échec nouveau par rapport à `main`.

### 5.4 Données

Pas de reprise (P-03, 18/10/2026) : le schéma `keystone` part vide, rempli par `KEYSTONE_SEED` (`demo` en bêta, `production` pour les seuls référentiels). Une base PostgreSQL de l'ancienne disposition (tables dans `public`) est refusée par `db:migrate` ; pour la bêta de démonstration, supprimer le volume et redéployer. Copier `/data/files`.

### 5.5 Variables

`DATABASE_URL` (`postgres://keystone_app:…@hôte:5432/epc2i`, variable d'exécution seulement), `DATABASE_POOL_MAX` (connexions par processus, 10 par défaut), `KEYSTONE_SEED` (`demo` ou `production`, obligatoire pour remplir le schéma vide au premier `db:migrate`), `KEYSTONE_DATA_DIR` (fichiers déposés et base PGlite de `next build`). Inchangées : `KEYSTONE_DIST_DIR`, `CURSUS_API_URL`, `CURSUS_API_KEY`, `KEYSTONE_API_KEY`, `VIGIE_API_URL`, `NEXT_PUBLIC_*`.

## 6. Codex

État au 22/10/2026 : lot 11 de Codex (branche v2 fusionnée avec la bascule de `main`, `docs/postgres.md` et `docs/historique.md` § 20 du dépôt Codex). La première bascule, essayée le 15/10/2026 dans une copie de Codex sur PostgreSQL 16.15 puis fusionnée dans `main` (`infra/postgres/correctifs/codex.diff`), est remplacée : son schéma `codex`, sa déclaration à Matrix et ses vues `pub_` restent, mais son migrateur (`src/db/migrate.ts`), son type commun (`src/db/types.ts`) et son verrou d'écriture `codex.ecritures` sont retirés au profit de ceux de la branche. Codex exige PostgreSQL 18 (P-01) et `pg_trgm` installé par le socle dans le schéma `extensions` (§ 2.2).

### 6.1 Fichiers

| Fichier (dépôt Codex) | Rôle |
|---|---|
| `src/db/schema.ts` | `codex.table(…)` au lieu de `pgTable(…)`, `pgSchema('codex')` non exporté (§ 4.2) : 31 tables. |
| `drizzle/0000_init.sql`, `drizzle/0001_partage.sql`, `drizzle.config.ts` | Base de migrations figée le 22/10/2026 : `0000_init` (tout le schéma, régénérée ce jour-là, aucun `CREATE SCHEMA`, `CREATE EXTENSION` ni `public`), `0001_partage` (prérequis du partage et 7 vues `pub_`, dont `40-codex.sql` est la copie qualifiée). Ensuite, migrations incrémentales seulement (`npm run db:generate`). `schemaFilter: ['codex']`. |
| `src/db/migrations.ts` | Migrateur (`applyMigrations`), à la place de `migrate()` de Drizzle : journal `codex.__drizzle_migrations` (`id`, `hash`, `created_at`, comme Drizzle), contrôle des empreintes SHA-256 (une base faite par une autre chaîne de migrations, ou par un Codex plus récent, est refusée avant toute écriture), toutes les migrations en attente dans une seule transaction, jamais de `CREATE SCHEMA`. Reprise d'une base PGlite de la branche v2 (§ 4.1). |
| `src/db/sql-client.ts` | Connexion commune aux deux moteurs ; sur le serveur, pool `pg` de `CODEX_DB_POOL` connexions (10 par défaut), `application_name = codex`, `-c search_path=codex` ; `int8` rendus en nombres, dates comme PGlite. |
| `src/db/index.ts` | `openDb` : refuse un serveur antérieur à PostgreSQL 18 (`codex_fold` replie la casse avec la collation `pg_unicode_fast`) et une base sans schéma `codex` ; prend `pg_advisory_lock(hashtext('codex.migrations'))` sur une connexion dédiée, migre, repose fonctions, déclencheurs et collation `codex_fr`, puis relâche ; ajoute le schéma de `pg_trgm` (`extensions`) au `search_path` de la seule transaction de migration (index `document_terms_term`, `extensions.gin_trgm_ops`) et, sans l'extension, refuse de migrer en donnant les commandes du socle ; remplissage sous `codex.seed`, seulement sur demande. |
| `src/lib/pglite-options.mjs` | En PGlite, `search_path` « codex, public » posé au démarrage : même schéma `codex` que sur le serveur. |
| `src/lib/lifecycle.ts`, `src/lib/actions.ts`, `src/lib/codification.ts` | Concurrence (§ 4.5) : verrous de ligne des documents en `READ COMMITTED`, identifiants tirés de `codex.id_counters`. |
| `src/lib/export-core.mjs` | Export complet sur le serveur : instantané en `REPEATABLE READ` sur une connexion gardée. Le socle ne donne pas `TEMPORARY` à `codex_app` : l'instantané est fait de tables `unlogged` éphémères du schéma `codex`, `codex_export_<hasard>_<table>`, supprimées à la fin de l'export (une coupure en laisse ; aucun autre export ne les lit). Créées par `CREATE TABLE … AS`, elles passent par `droits_ddl` comme toute table de Codex (lisibles par `matrix_lecture` le temps de l'export, Codex n'ayant pas de colonne sensible) ; Matrix doit les tenir pour éphémères. |
| `scripts/codex-migrate.mts` (`npm run db:migrate`) | Migrations au déploiement (`-- --check` : liste sans rien changer). Sur une base qui a des données, refus tant que `--no-backup` (ou `CODEX_MIGRATION_BACKUP=off`) n'est pas donné, une fois le `pg_dump` du serveur fait. Sans lui, le premier démarrage migre. |
| `src/app/base-vide/`, `src/app/api/health/` | Base du serveur laissée vide (ni `CODEX_SEED` ni `CODEX_SEED_DEMO=1`) : chaque page mène à `/base-vide`, qui dit quelles variables poser ; `/api/health` répond 200 avec `"empty": true`. |
| `src/lib/matrix.ts` | Déclaration du schéma à Matrix juste après les migrations (`MATRIX_URL`, `MATRIX_TOKEN`), jamais attendue ni bloquante, jamais pendant `next build` (`NEXT_PHASE`). |
| `tests/integration/`, `.github/workflows/ci.yml` | `npm test` sur PGlite ; `npm run test:pg` rejoue toute la suite sur un serveur, chaque fichier dans une base disposée comme le socle (rôle sans `CREATE` ni `TEMPORARY`, `public` fermé, `pg_trgm` dans `extensions`) ; l'intégration continue le lance sur un service `postgres:18`. |
| `desktop/CodexApp.swift`, `Dockerfile` | `DATABASE_URL` vide dans l'application Mac (§ 4.6) ; image : volume `/data` (fichiers, base de repli), aucun secret. |

### 6.2 Ouverture et migrations

1. `DATABASE_URL` présente (hors `next build`) : pool du serveur ; sinon PGlite dans `CODEX_DATA_DIR/pglite`.
2. Serveur : version 18 au moins, schéma `codex` présent et utilisable, sinon refus avec un message ; aucune table de Codex dans `public`.
3. Verrou de session `codex.migrations` : un seul processus vérifie et migre, les autres attendent puis n'ont plus rien à faire (essayé : deux serveurs lancés ensemble sur une base vide, une migration, un remplissage).
4. Plan de migration : base neuve, migrations en attente, reprise d'une base PGlite de la branche, ou refus (autre chaîne, base plus récente que le code). En PGlite, sauvegarde automatique avant une migration sur une base qui a des données ; sur le serveur, `pg_dump` d'abord (procédure du socle).
5. Une transaction : journal, `pg_trgm` (déjà installé par le socle dans `extensions` ; sur une base à soi dont le rôle est propriétaire, créé dans `codex`), migrations, journal mis à jour.
6. Fonctions et déclencheurs reposés à chaque démarrage (journal en ajout seul, version des documents, termes de recherche, `codex_fold`, `codex_unbom`, collation `codex_fr`) : ils ne sont pas dans les migrations.
7. Base vide : remplie seulement avec `CODEX_SEED=minimal` (référentiel et administrateur initial), `CODEX_SEED=demo` ou `CODEX_SEED_DEMO=1` (démonstration, bêta), sous le verrou `codex.seed` ; sinon `/base-vide`.
8. Déclaration à Matrix, en tâche de fond.

### 6.3 Essais, données, variables

- Essai du 22/10/2026 dans le dépôt Codex (PostgreSQL 18.3, socle rejoué) : `npm run db:migrate` en `codex_app` applique `0000_init` et `0001_partage` (32 tables dont le journal, 7 vues, tout à `codex_app`, rien dans `public`) ; sans `pg_trgm`, refus clair et schéma intact ; `npm run test:pg` : 1 464 tests réussis, 3 sautés. Essai du même jour dans Matrix : `infra/postgres/partage/README.md`, « Essais » (socle avec `extensions`, migrations et démonstration de Codex, partage 10, 40, 90, 95, `verifier-droits.sql` conforme).
- Données : pas de reprise d'une base PGlite vers le serveur ; le serveur part vide ou de la démonstration (P-03, P-11). Le volume Coolify `/data/pglite` (démonstration de `main` d'avant le 17/10/2026) est refusé : le supprimer (procédure d'exploitation de Codex, § 10). Copier `/data/files`.
- Variables : `DATABASE_URL` (variable d'exécution seulement), `CODEX_DB_POOL` (`CODEX_DB_POOL_MAX`, ancien nom, encore lu), `CODEX_SEED` (`demo` ou `minimal`) ou `CODEX_SEED_DEMO=1`, `CODEX_MIGRATION_BACKUP`, `CODEX_DATA_DIR` (fichiers et repli), `MATRIX_URL`, `MATRIX_TOKEN`.

## 7. Vigie

Basculé le 18/10/2026 sur la branche `claude/bascule-postgres` du dépôt Vigie (demande de fusion Yhumiii27/Vigie#7), selon la décision P-02 : les migrations publiées (`drizzle/`, `0000` à `0009`, figées par `drizzle/checksums.json`) et `src/db/schema.ts` (`pgTable`) restent tels quels. C'est l'outil Drizzle qui porte des données de santé : il valide la protection du § 3 sur un vrai schéma. Essai du 18/10/2026 (PostgreSQL 16.15 doté du socle, en `vigie_app`, démonstration) : 10 migrations, 52 tables et le journal, 3 vues `pub_` dans le schéma `vigie`, rien dans `public` ; `matrix_lecture` ne lit ni les 10 colonnes de santé de `events`, ni `change_log.details` et `reason`, ni `benign_accidents`, `access_log` et `attachments` (§ 2.3).

### 7.1 Fichiers

| Fichier (dépôt Vigie) | Rôle |
|---|---|
| `src/db/migrations.ts` | `SERVER_SCHEMA = 'vigie'` ; `migrateServer` : journal `vigie.__drizzle_migrations`, verrou `pg_advisory_xact_lock(hashtext('vigie.migrations'))` pris avant de lire le journal, chaque instruction réécrite par `toServerSchema` (`"public".` → `"vigie".`) ; refus d'une base migrée par une version plus récente (`NewerDatabaseError`) et d'une base de l'ancienne disposition (tables dans `public`). |
| `src/db/index.ts` | Pool `pg` (`application_name` = `vigie`, `search_path=vigie` dans `options`), verrou de session des migrations à l'ouverture (`hashtext('vigie.migrations')`), sauvegarde automatique avant migration, puis migrations ; chaque `db.transaction()` prend d'abord `pg_advisory_xact_lock(hashtext('vigie.ecritures'))`. Le schéma n'est créé que sur une base dédiée où le rôle a le droit `CREATE` (jamais sur le serveur commun : erreur qui renvoie au socle). `next build` reste sur PGlite. PGlite garde `migrate()` de Drizzle et `public`. |
| `src/db/seed.ts` | Démonstration chargée seulement avec `VIGIE_DEMO=1`, vide de la base recompté dans la transaction du remplissage (plusieurs instances : un seul remplissage). |
| `drizzle/0008_partage_prerequis.sql`, `drizzle/0009_partage.sql` | Partage (§ 4.9) : `keystone_project_code` dans 4 tables, 9 colonnes du volet NC de `events`, `contractors.supplier_id`, index et contraintes (`0008`, générée) ; vues `pub_non_conformites`, `pub_hse_projet`, `pub_journal` (`0009`, écrite à la main, sans schéma). `partage/50-vigie.sql` de Matrix en est la copie qualifiée. Aucune vue ne lit une donnée de santé ; un accident du travail n'entre dans aucune vue, son journal non plus. |
| `src/db/backup.ts`, `scripts/vigie-db.ts` | Sauvegarde `pg_dump --schema=vigie`, restauration qui vide le schéma `vigie` sans le supprimer, essai de migration (`db:test-migrate`) avec la même réécriture. |
| `test/integration/server-layout.test.ts`, `test/setup-postgres.ts` | Tests sur PostgreSQL (`TEST_DATABASE_URL`) dans le schéma `vigie`. `db:check` vérifie aussi la disposition du serveur. |
| `desktop-app/Sources/ServerController.swift`, `docker-compose.yml`, `docs/EXPLOITATION.md` § 2, `.env.example`, `README.md`, `CLAUDE.md` | L'application Mac fixe `DATABASE_URL` à vide ; mise en service sur le serveur commun. |

Aucun `GRANT` dans les migrations de Vigie : les droits de Matrix sont posés par le socle, ceux des lecteurs des vues `pub_` par `partage/90-droits.sql`.

### 7.2 Mise en service

1. Socle (`infra/postgres/init/`), qui crée le rôle `vigie_app`, le schéma `vigie` et la liste des colonnes de santé (§ 2.3).
2. Démarrage de Vigie avec `DATABASE_URL` : migrations à l'ouverture de la base (première requête ou sonde de santé), sous verrou ; en bêta, `VIGIE_DEMO=1` charge la démonstration une seule fois.
3. Partage : `partage/50-vigie.sql` en `vigie_app` (sans effet : mêmes vues que `0009_partage`), puis `partage/90-droits.sql` et `95-matrix-journal-unifie.sql`. `60-vigie-ecr-eco.sql` ne se joue pas : le module ECR / ECO n'existe pas dans Vigie.
4. Contrôle : `/api/sante` répond `{"statut":"ok","base":"postgres"}` ; `droits.verifier()` sans erreur ; `verifier-droits.sql` (cas 200 et suivants : colonnes et tables de santé de Vigie).

### 7.3 Données et variables

- Données : pas de reprise (P-03) ; une base PostgreSQL de l'ancienne disposition est refusée à l'ouverture. Sur un serveur vide, Vigie démarre sur l'écran « Créer le premier site » ; la bêta démarre avec `VIGIE_DEMO=1`. Copier `/data/uploads`.
- Variables : `DATABASE_URL` (`postgres://vigie_app:…@hôte:5432/epc2i`, variable d'exécution seulement), `VIGIE_DEMO=1` (démonstration : jeu de données, sélecteur de rôle), `VIGIE_UPLOAD_DIR` (pièces jointes), `VIGIE_BACKUP_DIR`, `VIGIE_DATA_DIR` (repli PGlite), `VIGIE_TODAY` (démonstration). Le pool est fixé à 10 connexions dans le code.

## 8. Cursus

Cursus est le seul outil sans Drizzle et sans PostgreSQL : Express 5, `node:sqlite` synchrone, une classe `Db` (`server/src/db.ts`, 195 lignes) qui crée les tables depuis l'objet `TABLES`, sans clé étrangère. Les règles métier de `shared/` travaillent sur un instantané en mémoire et n'appellent jamais la base : le client et `shared/` ne changent pas.

La migration se fait en trois sous-étapes, livrées l'une après l'autre. Le prototype essayé (`infra/postgres/correctifs/cursus-prototype.diff`) couvre les trois.

| Sous-étape | Contenu | Commence après | Sections |
|---|---|---|---|
| 8.a Couche asynchrone | Classe `Db` asynchrone avec le seul adaptateur SQLite ; actions, routes et tests en `async` ; aucun changement de moteur. | M-05 | § 8.1, § 8.2 (sans `PgDb`) |
| 8.b Adaptateur PostgreSQL | `PgDb`, `server/migrations-pg/`, schéma cible, verrous, double exécution des tests sur SQLite et PostgreSQL. | 8.a et le socle (étape 0 du § 10) | § 8.2 à 8.5 |
| 8.c Reprise et bascule | Script de reprise, recette, `DATABASE_URL` en production. | 8.b et les étapes 1 à 3 du § 10 | § 8.6, étape 4 du § 10 |

Le travail D06 et D07 de Cursus (`docs/remplacement-lucca.md`, § 5.1) commence dès que 8.a est fusionnée, sur SQLite : il ne dépend ni de 8.b ni de 8.c (§ 10).

### 8.1 Stratégie retenue : couche d'accès asynchrone

| Stratégie | Principe | Verdict |
|---|---|---|
| Synchrone avec `pg-native` | `querySync` sur libpq | Écartée : module natif à compiler dans l'image et sur chaque Mac (l'installation a échoué dans l'essai), boucle d'événements bloquée par environ 60 allers-retours réseau par action, une seule connexion, pas de PGlite. |
| Synchrone par un thread de travail et `Atomics.wait` | Requêtes passées à un thread qui porte la connexion | Écartée : même blocage, gestion maison des erreurs et des transactions. |
| **Asynchrone, `pg` sur le serveur, SQLite en repli** | La classe `Db` devient asynchrone, avec un adaptateur par moteur | **Retenue.** Passage mécanique, limité au serveur ; prototype vert sur trois moteurs (41 tests : SQLite 2,3 s, PostgreSQL 16 23 s, PGlite 79 s). |

SQLite reste le repli local (application Mac, développement, tests rapides) : aucune dépendance, démarrage immédiat, pas de conversion sur les postes. La contrepartie (pas de clé étrangère en local, typage souple) est compensée par la double exécution des tests en intégration continue et par le contrôle de la base avant toute reprise. Basculer plus tard le repli vers PGlite coûterait environ 1,5 jour (adaptateur déjà écrit).

### 8.2 Fichiers

| Fichier | Changement |
|---|---|
| `server/src/db.ts` | Classe abstraite `Db`, même API devenue asynchrone (`all`, `where`, `get`, `insert`, `update`, `remove`, `count`, `tx`, `getSetting`, `setSetting`) plus `query`, `clearAll`, `resyncIds`, `lockActions`. Adaptateurs `SqliteDb` et `PgDb`. `openDb()` : `DATABASE_URL` présente et non vide → `PgDb`, sinon SQLite (`CURSUS_DB` ou `data/cursus.db`). Une valeur vide vaut absence, comme pour les outils Drizzle (§ 4.1). `TABLES` reste la source lue par le collecteur de Matrix. |
| `server/src/dataset.ts`, `auth.ts`, `index.ts`, `migrate.ts`, `seed.ts`, `reset.ts`, `integrations/keystone.ts`, `actions/*.ts` (8 fichiers) et `actions/context.ts` | `async`/`await` sur les 141 appels directs et leurs appelants (42 gestionnaires d'actions). Les 34 boucles `forEach` qui écrivent deviennent `for…of` (9 dans les actions, environ 25 dans `seed.ts`). Règle de lint contre les promesses non attendues. |
| `server/migrations-pg/0001_init.sql` (nouveau) | Copie de `infra/postgres/cursus/schema.sql` (§ 8.4). Les migrations suivantes, `partage` (§ 4.9) et `echanges_rh` (`docs/remplacement-lucca.md`, § 5.1), prennent leur numéro à la fusion. Le script de droits `0002_droits_matrix.sql` du prototype n'a plus lieu d'être (§ 8.5). |
| `server/scripts/sqlite-vers-postgres.ts` (nouveau) | Reprise des données (§ 8.6). |
| `tests/*.test.ts` (4 fichiers) | `fresh()` asynchrone, `assert.throws` deviennent `assert.rejects`, choix du moteur par `CURSUS_TEST_ENGINE=sqlite\|pg`. |
| `shared/dates.ts:11` | `isValidDate` contrôle aussi le calendrier : `2026-02-30` passe le contrôle de format puis échoue dans PostgreSQL (« date/time field value out of range », vérifié), soit une erreur 500. |
| `server/src/index.ts:147-157` | La route Keystone contrôle `retour >= depart` (aujourd'hui le format seulement). |
| `desktop/CursusApp.swift:77-83` | `env["DATABASE_URL"] = ""`. Cursus ne charge aucun fichier `.env` (`node server/src/index.ts`, ni `--env-file` ni dotenv) ; l'application transmet en revanche l'environnement hérité du poste (`ProcessInfo.processInfo.environment`, ligne 77). La valeur vide neutralise un `DATABASE_URL` exporté dans la session de l'utilisateur. |
| `Dockerfile` | Commentaire : `/data` ne sert plus qu'au repli ; `DATABASE_URL` jamais dans l'image. |
| `README.md`, `docs/ARCHITECTURE.md` | Les deux modes, les variables, la reprise. |
| `package.json` | `pg` (le prototype a tourné avec 8.16.3 ; prendre 8.23.1 comme les autres outils). |

### 8.3 Adaptateur PostgreSQL : points obligatoires

| Point | Où | Traitement |
|---|---|---|
| Dates | 32 colonnes `date`, comparées en chaînes par le domaine | Parseur du type 1082 qui rend la chaîne telle quelle. Sans lui, `pg` rend un objet `Date` et le domaine casse (« Date d'entrée invalide », constaté). |
| `numeric` | heures, jours, montants | Parseur 1700 → `Number`. Parseur 20 (`bigint` de `count(*)`) → `Number`. |
| `journal.at` | `timestamptz` | Parseur 1184 → `new Date(v).toISOString()`, le format écrit aujourd'hui. |
| JSON | 17 colonnes `jsonb` | Paramètres passés en `JSON.stringify` ; à la lecture, `pg` rend déjà l'objet : plus de `JSON.parse`. |
| Booléens | 5 colonnes | `boolean NOT NULL DEFAULT false` ; une colonne omise prend le défaut. |
| Paramètres | `?` | `$1, $2…` ; l'adaptateur SQLite traduit `$n` en `?n`. |
| Insertion | `lastInsertRowid` (`db.ts:136`) | `INSERT … RETURNING *`. |
| Ordre `rowid` | `dataset.ts:54-58` | Colonne `rang` ; l'adaptateur traduit `'rowid'` en `rang`. |
| Remise à zéro | `clearAll` (`db.ts:160-163`) | `SET CONSTRAINTS ALL IMMEDIATE`, puis `TRUNCATE <28 tables> RESTART IDENTITY CASCADE`. Le `SET CONSTRAINTS` est nécessaire quand un contrôle différé (`equipes.manager_id`) est en attente dans la transaction : sinon « cannot TRUNCATE "equipes" because it has pending trigger events » (constaté). |
| Identifiants explicites | `seed.ts:304` (employés), `seed.ts:147-159` (sessions) | `resyncIds()` après le remplissage : `setval` des séquences. |
| Verrou d'actions | `POST /api/actions/:name` (`index.ts:99-121`) | `pg_advisory_xact_lock(hashtext('cursus.ecritures'))` en tête de la transaction de chaque action. Sans lui, 5 saisies simultanées sur la même feuille en perdent 3 (constaté) ; mêmes conflits sur `plan.inscrire`, `budget.enveloppes`, la création de feuille. |
| Lectures | `GET /api/data` et instantané renvoyé après une action | `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` : les 28 lectures voient le même état. |
| Écritures hors transaction | `auth.ts:24` (clé de session), `index.ts:155` (demande Keystone) | `CURSUS_SECRET` obligatoire en production ; la demande Keystone est une insertion unique. |
| Démonstration | `index.ts:20-23` charge la démonstration sur une base vide, `CURSUS_DEMO` vrai par défaut (`auth.ts:18`) | Chargement seulement si `DEMO` ; `CURSUS_DEMO=0` en production. Sinon le premier démarrage remplit le schéma et bloque la reprise. |
| Écart entre `TABLES` et le schéma | | Contrôle au démarrage : chaque colonne de `TABLES` existe dans `cursus` (requête sur `pg_attribute`). Le repli SQLite garde l'ajout automatique de colonnes. |

Migrations : dossier `server/migrations-pg/`, fichiers appliqués dans l'ordre au démarrage, journal `cursus.schema_migrations (nom text primary key, appliquee_le timestamptz)`. Le verrou `hashtext('cursus.migrations')` est pris **avant** de créer le journal (le prototype le créait avant, comme Vigie). Chaque fichier passe dans une transaction.

### 8.4 Schéma cible : `infra/postgres/cursus/schema.sql` (remplacé le 22/10/2026)

Mise à jour du 22/10/2026 : le schéma de Cursus est désormais celui de ses migrations (`server/migrations-pg/0001_init.sql`, 50 tables, et `0002_partage.sql`, dépôt Cursus, PR 8.b). `infra/postgres/cursus/schema.sql` (28 tables) est supprimé de Matrix ; `partage/20-cursus.sql` est la copie qualifiée de `0002_partage`. Le texte ci-dessous décrit le plan initial.

28 tables, noms inchangés, 37 clés étrangères, 8 unicités (7 contraintes et un index sur `lower(equipes.nom)`), 56 contraintes `CHECK`, 12 index. Le fichier suit le format de drizzle-kit, avec des noms qualifiés (`"cursus"."employes"`). Le collecteur de Matrix (`outils/collecteur.mjs`, `parseDrizzle`) les lit depuis le 15/10/2026 : 28 tables et 37 clés lues sur ce fichier (0 avant le changement). La vue `heures_validees` du prototype n'y est plus : les vues versionnées `heures_validees_v1`, `absences_validees_v1`, `annulations_v1` et `heures_site_mois_v1` (`docs/remplacement-lucca.md`, § 3.9) la remplacent dans la migration `echanges_rh`, qui ajoute les colonnes dont elles ont besoin (`feuilles.version`, `valide_le`, `site`, `rouverte_le` ; `absences.version`, `valide_le`, `annule_le`).

**Types.** Dates en `date`, `journal.at` en `timestamptz`, heures et jours en `numeric` (sans arrondi, il restitue le nombre JavaScript), montants en `numeric(12, 2)`, booléens `boolean NOT NULL DEFAULT false`, JSON en `jsonb` dont la forme est contrôlée. Clés : `integer GENERATED ALWAYS AS IDENTITY` pour 18 tables, `BY DEFAULT` pour `employes` et `sessions` (identifiants fixés par la démonstration), clé texte pour les référentiels.

**Matricule.** `employes.matricule` est une colonne générée et unique : `'EMP-' || CASE WHEN id < 10000 THEN lpad(id::text, 4, '0') ELSE id::text END`. Le `CASE` évite la troncature de `lpad` au-delà de 4 chiffres (`padStart` ne tronque pas, `shared/format.ts:21`). Keystone, Sage et D01 utilisent ce matricule : les identifiants sont conservés à la reprise.

**Clés étrangères.**

| Règle | Clés |
|---|---|
| `emp_id → employes.id` : `ON DELETE RESTRICT`. Le code ne supprime jamais de fiche ; une purge RGPD sera une procédure explicite. | absences, certifications, cet, demandes_collab (`emp_id` et `par_id`), demandes_keystone, entretiens, feuilles, hab_titres, inscriptions, missions, reports, taches, vaccinations, visas, voyages |
| `soldes_reprise.emp_id` : `CASCADE`, extension 1 pour 1 de la fiche (`equipes.ts:41`). | 1 |
| Codes texte : `ON UPDATE CASCADE`, pour le renommage d'équipe (`equipes.ts:91-102`) et l'harmonisation des codes (D02, D08, D17). Suppression `RESTRICT`. | `f → formations` (4), `h → habilitations` (2), `dest → destinations` (3), `projet → projets` (2), `sessions.formation`, `employes.equipe`, `plan_actions.equipe` |
| Rattachement facultatif : `SET NULL`. | `certifications.session_id`, `demandes_collab.session_id`, `voyages.chantier` (avec `ON UPDATE CASCADE`) |
| Objet sans raison d'être sans son parent : `CASCADE`. | `inscriptions.session_id`, `demandes_keystone.chantier`, `budgets.equipe` (le code supprime déjà les budgets avant l'équipe, `equipes.ts:122`) |
| `equipes.manager_id` : `SET NULL`, contrôle différé (`DEFERRABLE INITIALLY DEFERRED`), parce que `seed.ts:297` insère les équipes avant les fiches. `NULL` veut dire « validations par les RH ». | 1 |

`demandes_collab.par_id` reste en `RESTRICT` : `NULL` y signifie « demande du salarié lui-même », un `SET NULL` en changerait le sens. `chantiers.pays` n'a pas de clé : `FR` n'est pas une destination.

**Contraintes `CHECK`.** Retenues seulement si elles tiennent sur les données de démonstration et si tous les chemins d'écriture du code les respectent :

- 23 domaines fermés, repris de `shared/types.ts`, plus la liste des vaccins pour `destinations.oblig` et `rec` (statut, type de contrat, organisation du temps, type et statut d'absence, de feuille, d'entretien, de demande, vaccins, trimestre, origine du voyage, rôle du journal avec `integration` écrit par `integrations/keystone.ts:20`, etc.) ;
- règles de `normaliserProfil` (`shared/rules/profil.ts`) sur `employes` : heures seulement en temps partiel ou forfait hebdomadaire, forfait annuel en heures si et seulement si ce régime, forfait jours entre 1 et 218 si et seulement si ce régime, jours non travaillés dans 0 à 4 et seulement en temps partiel, agence seulement en intérim, année de naissance entre 1940 et 2100, fin après l'entrée ;
- feuilles : semaine commençant un lundi (`temps.ts:21`), régime figé présent dès la soumission, chaque ligne avec un projet et 5 heures entre 0 et 24 (`temps.ts:40`) ;
- sessions : places positives, inscrits entre 0 et le nombre de places ; plan : formation ou libellé, effectif positif, coût positif ; montants, jours et soldes positifs ; dates dans l'ordre pour `chantiers`, `missions`, `absences` ;
- demandes : cohérence entre le type et les colonnes renseignées (une demande de formation hors catalogue n'a pas de `f`, ligne 4 de la démonstration).

Écartées alors que la démonstration les respecte, parce que le code les contredirait : `voyages.retour >= depart` et `demandes_keystone.retour >= depart` (la route Keystone ne compare pas les dates), `visas.obtenu <= expire` (`voyages.ts:33-38` ne compare pas), forme de `taches.heures` (table supprimée par D05), unicité de `certifications (emp_id, f)` (historique voulu, `conformite.ts:32`), unicité de `equipes.manager_id`. Les deux premières pourront être ajoutées après la correction de `index.ts:147-157`.

**Unicités.** Celles de `TABLES` (`inscriptions`, `budgets`, `feuilles`), le matricule, et trois que le code respecte déjà en remplaçant la ligne existante : `vaccinations (emp_id, v)`, `visas (emp_id, dest)`, `hab_titres (emp_id, h)`. Plus `lower(equipes.nom)` (`equipes.ts:84, 97` refusent déjà les doublons).

**Essais** (PostgreSQL 16.15, rôle `cursus_app`) : schéma appliqué en 0,5 s ; démonstration chargée (417 lignes, 28 tables, mêmes effectifs que SQLite, 24 séquences recalées). Écritures du code rejouées : création de fiche sans identifiant (matricule généré), certification, renommage d'équipe en cascade (6 salariés, 2 budgets), création puis suppression d'une équipe vide, feuille saisie, soumise, validée, absence sans la colonne `keystone`, journal d'intégration, remplacement d'un vaccin, inscription puis suppression de session, acceptation d'une demande Keystone, remise à zéro. Refus attendus et obtenus : semaine hors lundi, équipe non vide supprimée, vaccin en double, fiche supprimée, date impossible, feuille soumise sans régime, ligne à 4 jours, manager inexistant, équipe en double à la casse près.

### 8.5 Droits

Aucun `GRANT` dans les migrations de Cursus. Le déclencheur `droits_ddl` donne à `matrix_lecture` les colonnes autorisées dès la création : sur `employes`, 17 colonnes sur 22 sont lisibles, `matricule` compris. Le fichier `0002_droits_matrix.sql` du prototype est inutile, et sa consigne « à relancer après chaque migration » aussi. Essai : les vues `*_v1`, créées par `cursus_app` sur le schéma rempli, sont lisibles par `matrix_app` sans aucun `GRANT` (228 lignes d'heures, 1 403 h, comme le calcul sur SQLite), et `droits.verifier()` ne signale aucune erreur.

### 8.6 Reprise des données SQLite

Script `server/scripts/sqlite-vers-postgres.ts` (prototype de 137 lignes essayé, dans `infra/postgres/correctifs/cursus-prototype.diff`) :

```
DATABASE_URL=postgres://cursus_app:…@hôte:5432/epc2i node server/scripts/sqlite-vers-postgres.ts --sqlite /data/cursus.db [--verifier] [--remplacer]
```

1. Copie horodatée du fichier SQLite et de ses fichiers `-wal` et `-shm`. Tout le travail se fait sur la copie : le constructeur `Db` modifie la base qu'il ouvre.
2. Mise à niveau de la copie par le code de Cursus (`migrate` : ancienne colonne `contrat`, régimes figés).
3. Contrôles, avec la liste des anomalies : dates au format et au calendrier, chaîne vide devenue `NULL`, JSON lisible, 37 liens sans orphelin, `NOT NULL`, domaines des `CHECK`, doublons sur les unicités. Avec `--verifier`, le script charge ensuite tout dans une transaction annulée, ce qui éprouve chaque contrainte du schéma.
4. Refus si le schéma cible contient déjà des données, sauf `--remplacer`.
5. Copie en une transaction : ordre des dépendances, `OVERRIDING SYSTEM VALUE` (identifiants conservés), `rang` = `rowid`, `absences.keystone` à `false` quand il vaut `NULL` (5 lignes de la démonstration).
6. `setval` des 24 colonnes d'identité (20 `id`, 4 `rang`).
7. Vérification : effectifs par table, comparaison profonde de `loadFull` des deux côtés, présence de la clé de session dans `settings`.

Bascule : `CURSUS_DEMO=0`, arrêt de Cursus, sauvegarde du volume `/data`, `--verifier`, reprise, démarrage avec `DATABASE_URL`, recette des écrans RH, manager et collaborateur. Retour arrière : retirer `DATABASE_URL` relance Cursus sur le fichier SQLite d'origine ; les saisies faites depuis la bascule seraient perdues, sauf script inverse (0,5 jour s'il est exigé).

### 8.7 Variables

`DATABASE_URL`, `CURSUS_DEMO=0` en production, `CURSUS_SECRET` (obligatoire en production), `CURSUS_PG_POOL` (10 par défaut), `CURSUS_DB` (repli SQLite). Inchangées : `PORT`, `CURSUS_HOST`, `CURSUS_API_PORT`, `CURSUS_INSECURE_COOKIE`, `TZ`.

## 8 bis. Arche

Arche (dépôt `Yhumiii27/Arche`) pilote les CAPEX des filiales selon la méthode DIG-PRODI. Au 22/10/2026, il n'existe
qu'en cadrage (livraison 0, documents seulement) ; ses demandes au socle sont dans `docs/DEMANDES-MATRIX.md` d'Arche.
Le socle est prêt avant son code :

- rôle `arche_app` et schéma `arche` (`init/01`, `init/02`), mot de passe `ARCHE_APP_PASSWORD` ; mêmes règles que les
  autres outils (`init/03`, `droits.verifier()`, cas 160 à 165 de `verifier-droits.sql`) ; `matrix_lecture` lit ses
  tables, colonnes sensibles exclues ; sauvegarde par schéma comprise ;
- partage (`partage/90-droits.sql`) : Arche lit `matrix.pub_pays`, `pub_sites`, `pub_organigramme`,
  `pub_correspondances`, `keystone.pub_projets`, `pub_clients`, `pub_livrables`, `pub_parc_machines`, puis les vues
  que Keystone publiera pour lui (`pub_catalogue_machines`, `pub_reponses_besoins`, `pub_jalons_projets`,
  `pub_avancement_projets`, `pub_avenants`, `pub_reserves`, `pub_pack_ingenierie`, R-186 à R-191) ; Keystone et
  Matrix lisent `arche.pub_capex`, `pub_besoins_machines`, `pub_rampup` ; Matrix lit `arche.pub_journal`, ajouté au
  journal unifié (`partage/95`). Les vues absentes sont signalées sans erreur jusqu'à leur création ;
- les vues `pub_` d'Arche sont créées par ses migrations (règle P-02) ; Matrix n'a pas de fichier `partage/` pour
  Arche tant qu'elles n'existent pas ;
- doublons avec les autres outils (`docs/doublons-a-trancher.md`), tranchés le 22/10/2026 :
  - D21, option A : Matrix fait foi pour les zones et les filiales du groupe (`matrix.zones`, `matrix.filiales`,
    vues `pub_zones` et `pub_filiales` lues par Arche et Keystone ; écran « Référentiels » de Matrix) et pour leurs
    sites (`matrix.sites.filiale_code`, ajoutée en fin de `pub_sites`). Arche ne crée ni `zones`, ni `subsidiaries`,
    ni `sites` ; Keystone relie `clients.code3` au code de la filiale. Listes vides jusqu'à la liste réelle (C-5) ;
  - D22, option A : Arche (CAPEX) et Keystone (projets) gardent chacun leur REX et publient `pub_rex`, accordée à
    `matrix_app` ; Matrix les réunira comme le journal unifié, au contrat commun du § 8 quater.

## 8 ter. Crucible

Crucible (dépôt `Yhumiii27/Crucible`) planifie et arbitre les moyens d'essais R&D partagés (laboratoire 67, partagé avec
EPC France ; PDE, laboratoire PDE, atelier mécanique). Au 22/10/2026, sa livraison 1 (plateforme) est faite, en
PostgreSQL seulement, migrations `0000` à `0002` ; ses demandes au socle sont M-1 à M-6 de son `docs/DEMANDES-MATRIX.md`.
Même démarche qu'Arche (M-07) :

- rôle `crucible_app` et schéma `crucible` (`init/01`, `init/02`), mot de passe `CRUCIBLE_APP_PASSWORD` ; mêmes règles
  que les autres outils (`init/03`, `droits.verifier()`, cas 170 à 175 de `verifier-droits.sql`) ; colonnes sensibles
  `crucible.users.entra_object_id` et `crucible.users.email` (M-3, fermées à `matrix_lecture`) ; sauvegarde par schéma ;
- partage : `partage/80-crucible.sql` recopie `crucible.pub_journal` (migration `0002_share_journal`, contrat D18), réunie
  par `partage/95` ; `partage/90-droits.sql` : Crucible lit `keystone.pub_projets`, `cursus.pub_salaries`, `pub_titres`,
  `pub_titres_detenus`, `codex.pub_documents`, `pub_revisions_document`, `matrix.pub_sites`, `pub_organigramme`, puis
  `keystone.pub_jalons` (K-2 de Crucible) et `cursus.pub_absences` (CU-1) quand ces outils les publieront ; Keystone,
  Vigie et Matrix lisent `crucible.pub_moyens` et `pub_reservations` (livraison L3 de Crucible). Les vues absentes sont
  signalées sans erreur jusqu'à leur création ;
- référentiel des sites (M-6) : le laboratoire 67 et le PDE n'y sont pas encore, leur localisation n'étant pas connue
  (question P-1 de Crucible) ; l'entité EPC France attend la liste réelle des filiales (D21, C-5 d'Arche) ;
- doublons (`data/doublons.json`, `docs/doublons-a-trancher.md`, 22/10/2026) : application des décisions déjà prises
  (D01 et D07 à D09 : Cursus fait foi pour les opérateurs, leurs habilitations et leurs absences ; D02 : lien vers
  Keystone, les projets R&D absents de Keystone restant dans Crucible (S-1 de Crucible) ; D14 et D21 : sites et entités
  lus dans Matrix, `matrix.pub_filiales` accordée à `crucible_app`) et groupe nouveau D23, tranché (M-12, option A) :
  Vigie fait foi pour les contrôles périodiques et publie `vigie.pub_controles` et `pub_suspensions_essais` (V-1, V-2
  de Crucible), accordées à `crucible_app` ; Crucible n'y saisit que la maintenance, les pannes et les travaux.

## 8 quater. Contrat commun du REX (D22)

Décision D22 (22/10/2026, option A « Deux registres, une vue commune ») : Keystone garde les leçons apprises des projets,
Arche le REX des CAPEX ; chacun publie une vue `pub_rex` et Matrix les réunit par `UNION ALL`, comme le journal unifié
(`partage/95`). Le contrat ci-dessous, validé le 23/10/2026, a été demandé aux deux outils dans leur `REQUESTS.md`
(Keystone : « Publier les leçons apprises des projets (vue pub_rex, D22) » ; Arche : « Aligner arche.pub_rex sur le
contrat commun du REX (D22) »). Lecteur : `matrix_app`, droit déjà posé par `partage/90-droits.sql`.

| # | Colonne | Type | Keystone (`lessons_learned`) | Arche (`rex_entries`) |
|---|---|---|---|---|
| 1 | `ref_source` | text | `'lessons_learned:' \|\| id` | `'rex_entries:' \|\| id` |
| 2 | `outil` | text | `'keystone'` | `'arche'` |
| 3 | `projet_code` | text | `projects.code` | projet EPC2i lié, sinon null |
| 4 | `capex_code` | text | null (le CAPEX du projet quand Keystone le connaîtra, R-190) | code du CAPEX |
| 5 | `numero` | text | `number` | null si Arche n'en tient pas |
| 6 | `categorie` | text | `theme` | catégorie |
| 7 | `titre` | text | au choix de Keystone (par exemple `number \|\| ' · ' \|\| theme`) | titre |
| 8 | `constat` | text | `what_happened` | texte du REX |
| 9 | `impact` | text | `impact` | null si Arche n'en tient pas |
| 10 | `recommandation` | text | `recommendation` | recommandation si Arche la distingue, sinon null |
| 11 | `portee` | text | `applies_to` | null si Arche n'en tient pas |
| 12 | `statut` | text | `status` | `'publie'` |
| 13 | `auteur` | text | `raised_by_name` | auteur |
| 14 | `cree_le` | timestamptz | `created_at` | `published_at` |
| 15 | `maj_le` | timestamptz | `updated_at` | `updated_at` |

Règles :

- les deux vues portent ces 15 colonnes, dans cet ordre et avec ces types : c'est ce qu'exige le `UNION ALL` ;
- une colonne propre à un outil ne vient qu'en fin de vue, après `maj_le` (Arche : `phase`) ; la vue commune de Matrix
  ne lit que les 15 colonnes communes ;
- vue `WITH (security_barrier)`, aucune colonne sensible ; données personnelles : le nom de l'auteur seulement, comme
  `pub_journal` ;
- Arche ne publie que les entrées publiées (`published_at` renseignée) ;
- contrat v1 : aucune colonne n'est retirée ni renommée ; un changement de ce type passe par `pub_rex_v2` dans les deux
  outils.

À faire côté Matrix, une fois les deux vues publiées : une vue `matrix.rex_unifie` (fichier de partage sur le modèle de
`95-matrix-journal-unifie.sql`, qui laisse de côté avec un WARNING la vue d'un outil absente ou non conforme au contrat).

## 9. Heures validées : D06, option A, réversible

Le circuit, les contrats (`data/contrats/heures-validees.schema.json`, `absences-validees.schema.json`) et les changements fonctionnels de chaque outil sont dans `docs/remplacement-lucca.md`. Ce qui concerne la base de données :

| Point | Règle |
|---|---|
| Passage des heures | Par l'API de l'outil destinataire, poussée par Cursus (flux H1, H2, H3) : les modes de repli (PGlite, SQLite) n'ont pas de serveur commun, et les heures sont des écritures chez le destinataire. Les outils lisent seulement les vues `cursus.pub_*` qui leur sont accordées (convention de partage) ; les vues `*_v1` ne leur sont pas accordées. |
| File d'envoi de Cursus | Table `cursus.evenements_sortants`, écrite dans la transaction de la validation (`temps.validate`) : le message part si et seulement si la validation est enregistrée. Elle vient avec la migration `echanges_rh` (§ 8.2). Sur le serveur, elle est lisible par Matrix sans `GRANT`. |
| Vues de contrôle | `cursus.heures_validees_v1`, `absences_validees_v1`, `annulations_v1`, `heures_site_mois_v1`, propriété de `cursus_app`, réservées au groupe `matrix_lecture`, que Matrix utilise par `matrix_app` (contrôle de complétude). Elles ne lisent aucune colonne sensible : `droits_ddl` les ouvre à Matrix dès leur création (essayé, § 8.5). `droits.verifier()` signale une vue `*_v1` qui lirait une colonne sensible, et toute vue `*_v1` accordée à un rôle d'outil. |
| Migrations des autres outils | Keystone : tables `hr_*` (dont `hr_leave_headers`), contraintes de `hours_imports` et `analytic_code` facultatif, dans sa migration `echanges_rh`. Vigie : colonnes `source`, `hours_interim`, `hours_school`, `complete`, `updated_at` de `hours_worked` et clé primaire `(month, site_id, source)`, dans la sienne. Aucune ne référence `cursus.*`. |
| Colonnes sensibles | Le contenu des messages n'en porte pas (matricule, semaine, projet, heures, site). La ligne de `cursus.journal` ne garde plus le contenu du message (lot C2) ; `payload` reste exclu de Matrix. |

**Réversibilité.** Rien n'est supprimé tant que M-03 n'est pas confirmée. Trois réglages ramènent l'état actuel : `settings.sourceHeures = 'lucca'` dans Cursus (plus de message `heures.*`), `hr.hours_source = 'lucca'` dans Keystone (les écrans relisent l'import Lucca, la saisie « Log » revient) et `VIGIE_HEURES_CURSUS_DEPUIS` vide dans Vigie (le tableau de bord relit les heures de la source actuelle, gardées à côté de celles de Cursus grâce à la clé `(month, site_id, source)`). Les tables alimentées gardent leur colonne `source`. Côté serveur, revenir à Lucca ne demande aucune migration.

## 10. Ordre de bascule

| Étape | Contenu | Condition pour passer à la suite | Retour arrière |
|---|---|---|---|
| 0 | Socle dans Coolify : ressource, variables, réseau, `verifier-droits.sql`, sauvegarde planifiée, restauration d'essai d'un schéma. Intégration continue des quatre outils prête (§ 10.1). Collecteur de Matrix qui lit les noms qualifiés `"schéma"."table"` : sans lui, `parseDrizzle` (`outils/collecteur.mjs`) ne lit plus aucune table dès la fusion de la migration de base régénérée de Codex. Fait le 15/10/2026. | Tous les cas de `verifier-droits.sql` conformes (114 avant les migrations de Vigie, 144 après : cas 200 et suivants) ; une restauration réussie, partage compris (`infra/postgres/README.md`) ; collecteur qui lit les migrations régénérées (essai : 203, 22 et 36 tables, et 28 pour `cursus/schema.sql`). | Supprimer la ressource. |
| 1 | **Codex** : le plus petit (un fichier de schéma), migration unique autorisée par son dépôt, aucune colonne sensible. | Recette des deux modes ; rafale d'imports sans erreur ; déclaration à Matrix reçue ; intégration continue verte. | Redéployer le commit précédent de Codex : l'ancien code rouvre l'ancienne base PGlite du volume (`/data/pglite`), que le garde-fou n'a pas modifiée. Retirer seulement `DATABASE_URL` ne suffit pas : le nouveau code refuse cette base (« Base PGlite antérieure au schéma… ») ; il faudrait alors vider ou déplacer `/data/pglite` et repartir de la démonstration. Dans les deux cas, les saisies faites sur le serveur sont perdues, sauf export. |
| 2 | **Vigie** : valide la protection des colonnes sensibles sur `events`. | `droits.verifier()` sans erreur ; Matrix lit `events` sans ses 10 colonnes de santé, ni `change_log.details` et `reason`, ni `benign_accidents`, `access_log` et `attachments` (§ 2.3) ; intégration continue verte. | Idem, avec `/data/db` (`VIGIE_DATA_DIR`). |
| 3 | **Keystone** : sans migration réécrite (P-02, 18/10/2026). | `db-check` sur le serveur ; test de concurrence, `createProject` compris ; intégration continue verte, sans échec nouveau par rapport à `main` (§ 5.3). | Idem, avec `/data/pg`. |
| 4 | **Cursus** : sous-étape 8.c (§ 8), le plus gros changement et les seules données RH réelles ; reprise depuis SQLite. | Recette RH, manager, collaborateur ; comparaison des instantanés ; première sauvegarde du schéma relue. | Retirer `DATABASE_URL` : Cursus rouvre son fichier SQLite d'origine, que la reprise n'a pas modifié (elle travaille sur une copie, § 8.6). Les saisies faites depuis la bascule sont perdues, sauf script inverse. |

**Pose du partage.** Après chaque étape 1 à 4, dans cet ordre : la migration de l'outil qui crée ses prérequis et ses vues `pub_` (§ 4.9 ; pour Keystone, `npm run db:migrate` ; pour Codex et Vigie, au démarrage), `10-matrix-referentiels.sql` à la première étape, le fichier de partage de l'outil (`20` à `50`, sans effet quand il recopie les vues de la migration), puis `90-droits.sql` et `95-matrix-journal-unifie.sql` (`infra/postgres/partage/README.md`). `95` réunit les `pub_journal` déjà accordées et laisse de côté, avec un avertissement, celles des outils pas encore basculés : il se rejoue après chaque outil. `60-vigie-ecr-eco.sql` attend le module ECR / ECO de Vigie. `droits.verifier()` reste sans erreur après chaque passage. Un lecteur ne lit une vue qu'une fois l'outil qui la publie basculé : jusque-là, il garde son cache ou ses substituts (`docs/convergence-des-donnees.md`, § 1.3).

**D06 et D07, en parallèle.** Les échanges RH ne sont pas une étape de cette chaîne. Le travail de Cursus commence dès que la sous-étape 8.a (couche asynchrone) est fusionnée, sur SQLite ; celui de Keystone et de Vigie dès que les contrats sont figés, sur leur base du moment. Les flux passent par l'API (§ 9) et ne demandent pas le serveur commun (`docs/remplacement-lucca.md`, § 3.9, raison 4). Marche en parallèle, critères et bascule : `docs/remplacement-lucca.md`, § 6 ; retour arrière : réglages de source (§ 9). La marche en parallèle sur données réelles attend en revanche les référentiels D01, D02, D05 et D14, dont les vues (P1 à P3) supposent Keystone et Cursus sur le serveur (étapes 3 et 4), de même que le contrôle de complétude par Matrix (`docs/remplacement-lucca.md`, § 6.3) ; avant, la file d'envoi de Cursus en tient lieu.

Matrix commence à lire chaque schéma dès la bascule de l'outil. Les étapes 1 à 4 se suivent : chaque outil reste en état de marche sur sa base embarquée tant que sa branche n'est pas fusionnée.

### 10.1 Intégration continue

Aucun des cinq dépôts n'a d'intégration continue aujourd'hui (ni `.github`, ni `.gitlab-ci.yml`, ni `.circleci`, vérifié le 15/10/2026). Le plan s'appuie pourtant sur elle (P-01, tests de Cursus sur deux moteurs, étape 3, § 12). C'est donc un lot à part entière, avec un workflow GitHub Actions par outil, `.github/workflows/postgres.yml` :

| Étape du workflow | Keystone | Codex | Vigie | Cursus |
|---|---|---|---|---|
| Installation, typecheck, lint | oui | oui | oui | typecheck |
| Tests sur la base embarquée | `vitest` (PGlite) | `vitest` (PGlite), fait (`.github/workflows/ci.yml` de Codex) | aucun : Vigie n'a pas de test | `node --test`, `CURSUS_TEST_ENGINE=sqlite` |
| Sur un service `postgres:16` (version du socle, P-01) doté du socle | `scripts/db-check-pg.ts` | fait autrement : `npm run test:pg` sur un service `postgres:16`, chaque fichier de test dans une base disposée comme le socle (§ 6.1) ; le socle lui-même n'y est pas rejoué | idem, nouveau dans Vigie | `node --test`, `CURSUS_TEST_ENGINE=pg` |
| Contrôle final | `droits.verifier()` sans erreur | idem | idem | idem |

- **Socle dans le service.** Le service PostgreSQL, à la version du socle (`postgres:16`, P-01), démarre vide ; le workflow joue ensuite les trois scripts de `infra/postgres/init/` avec `psql` depuis le runner, comme dans la procédure « Sans Docker » du README du socle. Les mots de passe des rôles sont des valeurs d'essai propres au workflow.
- **Dépendance entre dépôts.** Les scripts viennent du dépôt Matrix, privé. Chaque workflow le récupère par `actions/checkout`, à un commit fixé (variable `MATRIX_REF` du workflow), avec un jeton en lecture seule sur Matrix (secret `MATRIX_READ_TOKEN`, une clé de déploiement par outil). Un changement du socle se propage en montant `MATRIX_REF` dans chaque outil : chacun valide ainsi le socle qu'il utilise.
- **Fichiers.** Dans chaque outil : `.github/workflows/postgres.yml` ; dans Codex et Vigie : `scripts/db-check-pg.ts`. Dans Matrix : la clé de déploiement de chaque outil, et une ligne du README du socle qui rappelle de monter `MATRIX_REF` après un changement de `init/`.
- **Sans intégration continue.** Si ce lot n'est pas retenu, les mêmes commandes se lancent à la main avant chaque fusion, sur un PostgreSQL local de la version du socle, doté du socle (README du socle, « Sur un poste local »), et leur résultat est joint à la demande de fusion.

## 11. Ce que Matrix lit, et avec quel rôle

| Lecture | Rôle | Objets |
|---|---|---|
| Catalogue : tables, colonnes, types, clés | `matrix_app` | `pg_class`, `pg_attribute`, `pg_constraint`, `pg_description` des quatre schémas. `information_schema.columns` ne montre à `matrix_lecture` que les colonnes accordées (17 colonnes sur 22 pour `cursus.employes`) : il ne convient pas. Les déclarations envoyées par les outils restent la source de référence (`docs/declaration-des-tables.md`). |
| Volumétrie et tendance | `matrix_app` | `pg_class.reltuples`, `pg_stat_user_tables`, `pg_total_relation_size` (lisibles sans droit sur les données, vérifié). |
| Extraits masqués, lignes orphelines | `matrix_app`, par `matrix_lecture` | `SELECT` en nommant les colonnes. `SELECT *` est refusé sur une table qui a des colonnes sensibles ; `count(*)` fonctionne. |
| Migrations appliquées | `matrix_app` | `keystone.__drizzle_migrations`, `codex.__drizzle_migrations`, `vigie.__drizzle_migrations`, `cursus.schema_migrations`. |
| Journaux d'audit (D18) | `matrix_app` | Par exemple `codex.audit_log`, `cursus.journal` (sans `payload` ni `message`). |
| Vues publiées des outils (convention de partage) | `matrix_app` | Les 27 vues `pub_*` des quatre outils au 18/10/2026 (Keystone 12, Codex 7, Cursus 5, Vigie 3 ; 4 de plus avec le module ECR / ECO de Vigie), accordées par `infra/postgres/partage/90-droits.sql` ; `matrix.journal_unifie` (D18) les réunit pour les journaux. |
| Heures et absences validées (D06, D07) | `matrix_app`, par `matrix_lecture` | `cursus.heures_validees_v1`, `absences_validees_v1`, `annulations_v1`, `heures_site_mois_v1` (migration `echanges_rh` de Cursus). Le droit est celui du groupe `matrix_lecture`, posé par `droits_ddl` ; aucun `GRANT` à `matrix_app`. |
| Colonnes sensibles et contrôle des droits | `matrix_app` | `droits.colonnes_sensibles`, `droits.verifier()`. |
| Écriture dans un schéma d'outil | administrateur nominatif, membre de `matrix_admin` | Tout, journalisé. Jamais `matrix_app`. |

Changements dans Matrix :

- Fait le 15/10/2026 : `outils/collecteur.mjs`, `parseDrizzle`, accepte les noms qualifiés (`CREATE TABLE "keystone"."cities"`, `ALTER TABLE "keystone"."…"`, `DROP TABLE`, `RENAME`). Essai : les migrations actuelles des trois outils donnent le même résultat qu'avant (203, 22 et 36 tables) ; les migrations régénérées, lues 0 table avant le changement, en donnent autant ; `infra/postgres/cursus/schema.sql` donne 28 tables et 37 clés.
- Déjà en place : `integration/declarer-schema.mjs` écarte `__drizzle_migrations` et `schema_migrations` (`PG_TABLES`, ligne 32, et la lecture SQLite, ligne 75).
- À faire, `outils/collecteur.mjs` : lire la liste `SENSITIVE` dans `droits.colonnes_sensibles` une fois le serveur en service ; retirer `CURSUS_FK` pour Cursus dès que ses clés sont déclarées (`enrich()` les ignore déjà quand une clé existe).
- Schéma `matrix` : tables de Matrix (`docs/proposition.md`, § 4) créées par les migrations de Matrix, avec le migrateur du § 4.3 (`DB_SCHEMA = 'matrix'`).

## 12. Risques

| Risque | Effet | Parade |
|---|---|---|
| `migrate()` de Drizzle utilisé par erreur | Démarrage impossible (`permission denied for database epc2i`). | Migrateur commun (§ 4.3) ; message dans le dépannage du socle. |
| Courses entre transactions avec un pool | Erreurs de clé unique, numéros en double, mises à jour perdues (constatés dans les quatre outils). | Verrou d'écriture par outil, verrou d'actions de Cursus ; tout calcul « plus grand + 1 » dans la transaction de l'écriture (`createProject` de Keystone, références de Vigie, § 4.5). |
| `DATABASE_URL` connue au build | `next build` migre ou interroge le serveur. | Garde `NEXT_PHASE` ; variable d'exécution seulement. |
| Application Mac ou tests branchés sur le serveur | Écritures de développement dans la base commune. | `DATABASE_URL` vide dans les applications Mac et dans `vitest`. |
| Ancienne base PGlite ouverte par le nouveau code | Données invisibles sans avertissement ; application Mac qui ne démarre plus. | Garde-fou dans le module d'ouverture, avec un message qui nomme le dossier ; `db:reset`, suppression du dossier de l'application Mac (§ 4.6) ou reprise. |
| Restauration d'un schéma, partage en place | `DROP SCHEMA … CASCADE` emporte `matrix.journal_unifie` ; `--no-privileges` retire les droits des lecteurs : leurs écrans tombent en erreur. | `droits.partage_lecteurs` et `droits.verifier()` signalent les droits perdus ; procédure du README du socle (rejeu du fichier de l'outil, de 90 et de 95). |
| Colonne sensible nouvelle ou renommée hors liste | Lisible par Matrix dès sa création (nouvelle) ; table fermée (renommée). | Mettre la liste à jour avant la migration ; signalement des nouvelles colonnes par Matrix. |
| Défaut du déclencheur d'événement | Toute migration échoue. | Contrôle complet `verifier-droits.sql` (144 cas une fois Vigie migré) ; désactivation d'urgence documentée ; `droits.verifier()`. |
| Version : serveur et PGlite 18.3 différents | Une fonction d'une version plus récente que le serveur passerait en développement et échouerait sur le serveur (c'est le cas de Codex sur un serveur 16 : `pg_unicode_fast`) ; les exports de PGlite contiennent `SET transaction_timeout`. | Serveur en 18 (proposition du 22/10/2026, P-01) ; intégration continue sur la version du serveur (§ 10.1, ou contrôle manuel avant fusion) ; retrait de la ligne ; question P-01. |
| Une seule sauvegarde par nuit | Jusqu'à une journée de saisies perdue ; l'objectif de Keystone est 15 minutes (I-1b). | Archivage continu des journaux de transactions (P-08). |
| Fichiers déposés hors de la base | Restauration incomplète. | Sauvegarder `/data/files` et `/data/uploads` avec la base. |
| Démonstration chargée sur le serveur de production | Données fictives mêlées aux réelles ; reprise de Cursus bloquée. | Variables de démonstration explicites ; `CURSUS_DEMO=0`. |
| Dates impossibles acceptées par Cursus | Erreur 500 après la bascule. | `isValidDate` calendaire avant la bascule. |
| Latence de Cursus | Environ 60 requêtes par action. | Base et outil sur le même réseau Docker ; plus tard, `loadFull` en une requête. |
| PgBouncer en mode transaction | Refuse le paramètre de démarrage `options`. | `search_path` fixé aussi sur le rôle ; retirer `options` dans ce cas. |
| Mots de passe dans l'environnement du conteneur | Visibles par `docker inspect`. | Accès à l'hôte restreint ; rotation documentée (README du socle). |
| Journaux du serveur | Ils contiennent les requêtes des administrateurs, valeurs comprises. | Accès restreint, durée de conservation à fixer (P-08). |

## 13. Charge

| Lot | Jours | Remarque |
|---|---|---|
| Socle : mise en service Coolify, sauvegarde planifiée, restauration d'essai | 1 | Scripts écrits et essayés. |
| Keystone | 4 à 4,5 | Revue des 65 calculs « plus grand + 1 » comprise (§ 4.5, dont `createProject`). Hors socle : remplissage « référence » pour la production (1 à 2), reprise d'une base (0,5). |
| Codex | 2,5 à 3 | Dont 0,5 pour le verrou d'écriture et le pool à 10, transposés de Keystone. Reprise : +0,5. |
| Vigie | 3 à 4 | Dont 0,5 pour les 10 calculs de référence. Reprise : +0,5. |
| Cursus | 6 à 8 (7 au centre) | Sous-étapes 8.a à 8.c ; environ 5 en partant du prototype. Script inverse de retour arrière : +0,5 s'il est exigé. |
| Matrix : déclaration, lecture du serveur | 0,75 à 1,25 | L'adaptation du collecteur aux noms qualifiés est faite ; `declarer-schema.mjs` écarte déjà les journaux des migrations. |
| Intégration continue (§ 10.1) | 1,5 à 2 | Quatre workflows, `scripts/db-check-pg.ts` de Codex et de Vigie, clés de déploiement. |
| **Total** | **18,75 à 23,75** | Environ 21 avec les valeurs du milieu (Cursus à 7). Hors reprises, hors remplissage « référence » de Keystone, hors prérequis du partage (comptés dans `docs/convergence-des-donnees.md`, § 5), hors D06 et D07. |
| D06 et D07 : échanges RH | 17,5 | 19,5 avant convergence. Chiffrage de `docs/remplacement-lucca.md` (§ 5.5) : Cursus 6, Keystone 8, Vigie 2,5, Matrix 1. Prérequis D01, D02, D05 et D14 : 28 jours, comptés dans `docs/convergence-des-donnees.md` (§ 5.6). En parallèle des étapes 1 à 4, après la sous-étape 8.a. |

## 14. Questions ouvertes

| N° | Question |
|---|---|
| P-01 | Version du serveur. **Tranchée le 22/10/2026 : « Rester en 16 ».** Le socle revient à `postgres:16-bookworm` (volume sur `/var/lib/postgresql/data`) après la proposition du même jour de passer en 18 pour le lot 11 de Codex. Codex doit remplacer la collation `pg_unicode_fast` (propre à la 18) dans `codex_fold` avant de déployer sa v2 ; l'intégration continue des outils tourne sur 16. |
| P-02 | Tranchée le 18/10/2026 (`docs/decisions.md`) : ne rien réécrire ; le migrateur remplace `"public".` par le schéma sur le serveur (Keystone et Vigie). |
| P-03 | Tranchée le 18/10/2026 pour Vigie et Keystone (`docs/decisions.md`) : on repart de zéro. Cursus reste repris depuis SQLite. |
| P-04 | Confirmez-vous l'exclusion de `cursus.journal.payload`, `cursus.journal.message` et `cursus.demandes_collab.label` ? Faut-il aussi exclure `employes.reprise_date` et les entretiens de type `reprise`, qui révèlent une absence longue (avis RH ou DPO) ? |
| P-05 | Faut-il exclure des colonnes confidentielles de Keystone (`rate_roles.base_rate_eur`, `job_title_rates.rate_eur`, prix fournisseurs de `catalogue` et `purchasing`) ? |
| P-06 | Réseau : les cinq outils seront-ils sur le même serveur Coolify (réseau Docker, sans TLS) ? Sinon, quel certificat, et PgBouncer est-il prévu ? |
| P-07 | Qui détient le mot de passe du superutilisateur `postgres`, et qui reçoit un rôle d'administrateur nominatif ? |
| P-08 | Sauvegardes : destination hors du serveur, chiffrement, durée de conservation des sauvegardes et des journaux. L'objectif de 15 minutes de Keystone (I-1b) s'applique-t-il à tout le serveur ? Il demande l'archivage continu des journaux de transactions (pgBackRest ou WAL-G), en plus du `pg_dump` nocturne. |
| P-09 | Coolify : à confirmer à la première mise en service, la lecture des montages relatifs (`./init`) depuis le répertoire de base et le nom d'hôte du conteneur vu par les outils. Constat du 19/10/2026 : le nom du conteneur porte la date du déploiement (`postgres-<identifiant>-AAAAMMJJTHHMMSS`) et le nom sans date ne se résout pas ; le compose donne donc l'alias fixe `epc2i-postgres` sur le réseau `coolify`. |
| P-10 | D06 : date de la confirmation ou de l'abandon du remplacement de Lucca (M-03), et qui bascule `sourceHeures`. |
| P-11 | Données de démonstration : acceptées sur le serveur de bêta ; en production, faut-il un remplissage « référence » par outil (zones, calendriers, utilisateurs pour Keystone, registre des types pour Codex, sites pour Vigie) ? |
| P-12 | Tri : faut-il, plus tard, un tri français (collation ICU `fr-FR`) pour les listes affichées ? Il changerait l'ordre actuel, aligné sur PGlite. |
