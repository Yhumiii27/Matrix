# Serveur PostgreSQL commun : plan de migration des quatre outils

État au 15 octobre 2026. Ce plan met en œuvre deux décisions de l'utilisateur (`docs/decisions.md`) :

- **M-01** : « Oui, je valide le format postgreSQL commun avec un schema par outil ».
- **M-03 / D06** : « Ce n'est pas certain que Cursus remplace Lucca a ce stade mais prépare tout comme si cela est le cas. » Le groupe D06 (temps passés) suit donc l'option A : Cursus fait foi pour la saisie des heures, Keystone et Vigie reçoivent les heures validées. Le choix reste réversible.

Le socle du serveur est écrit et essayé : `infra/postgres/` (mise en service dans `infra/postgres/README.md`). Les changements dans les outils restent à faire, sur une branche par outil (question M-05). Les flux d'heures et d'absences (contrats, changements fonctionnels par outil) sont décrits dans `docs/remplacement-lucca.md` ; ce plan-ci en traite la partie base de données.

Sommaire : 1. Principe · 2. Conventions · 3. Colonnes sensibles · 4. Règles communes aux outils Drizzle · 5. Keystone · 6. Codex · 7. Vigie · 8. Cursus · 9. Heures validées (D06) · 10. Ordre de bascule · 11. Ce que lit Matrix · 12. Risques · 13. Charge · 14. Questions ouvertes.

## 1. Principe retenu

- **Un serveur, une base, un schéma par outil.** Le serveur PostgreSQL 16 porte la base `epc2i`. Chaque outil a son schéma et un rôle de connexion qui en est le seul propriétaire. Un outil ne lit ni n'écrit dans le schéma d'un autre : les échanges restent des API (flux de `data/flux.json`).
- **Matrix lit tout, sauf les colonnes sensibles.** Il se connecte en `matrix_app`, membre du groupe `matrix_lecture`. L'écriture dans les schémas des outils passe par un administrateur nominatif, membre de `matrix_admin`, dont chaque requête est journalisée.
- **Chaque outil garde sa base embarquée en repli.** Sans `DATABASE_URL`, Keystone, Codex et Vigie ouvrent PGlite, et Cursus ouvre SQLite, comme aujourd'hui : développement, tests, application Mac (`desktop/`). Avec `DATABASE_URL`, l'outil se connecte au serveur commun. Le code de l'outil est le même dans les deux cas : il utilise le schéma de l'outil aussi dans PGlite.
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
| Transactions oubliées | `idle_in_transaction_session_timeout = 5min` pour les rôles des outils | Une transaction ouverte et oubliée garderait le verrou d'écriture de l'outil (§ 4.5). |

### 2.2 Schémas et rôles

| Rôle | Type | Propriétaire de | `search_path` | Droits |
|---|---|---|---|---|
| `keystone_app` | connexion | `keystone` | `keystone` | Tout sur son schéma ; rien ailleurs ; pas de `CREATE` ni de `TEMPORARY` sur la base. |
| `codex_app` | connexion | `codex` | `codex` | Idem. |
| `cursus_app` | connexion | `cursus` | `cursus` | Idem. |
| `vigie_app` | connexion | `vigie` | `vigie` | Idem. |
| `matrix_app` | connexion | `matrix` | `matrix` | Tout sur `matrix` ; membre de `matrix_lecture`. |
| `matrix_lecture` | groupe | | | `USAGE` sur `keystone`, `codex`, `cursus`, `vigie` et `droits` ; `SELECT` sur leurs tables et vues, sauf les colonnes sensibles ; aucun droit sur les séquences ; lecture de `droits.colonnes_sensibles` et de `droits.verifier()`. |
| `matrix_admin` | groupe, attribué nominativement | | | Tous les droits sur les tables, séquences et fonctions des cinq schémas ; peut prendre le rôle d'un outil (`SET ROLE`, sans en hériter) ; modifie la liste des colonnes sensibles, sauf celles de la convention. |
| `epc2i_sauvegarde` | connexion | | | Membre de `pg_read_all_data` : lit tout, colonnes sensibles comprises, pour `pg_dump`. |
| `postgres` | superutilisateur | `droits` | | Administration du socle seulement, jamais dans un outil. |

Le schéma `droits` est un sixième schéma, technique. Il porte la liste des colonnes sensibles et les fonctions de contrôle. Il appartient au superutilisateur, parce que le propriétaire d'un schéma peut supprimer tout objet qu'il contient : placé dans `matrix`, le dispositif serait à la merci de `matrix_app`, lui-même membre de `matrix_lecture`.

### 2.3 Colonnes sensibles

| Colonnes | Origine |
|---|---|
| `cursus.employes` : `visite`, `passeport_numero`, `passeport_expire`, `naissance`, `reprise_motif` | Convention du 15/10/2026 |
| `cursus.vaccinations` : `v`, `date` | Convention |
| `cursus.visas` : `type`, `obtenu`, `expire` | Convention |
| `cursus.entretiens` : `cr` | Convention |
| `vigie.events` : `injury`, `lost_days` | Convention |
| `cursus.journal` : `payload`, `message` ; `cursus.demandes_collab` : `label` | Proposition, à confirmer (P-04) |

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
| Table dont une colonne listée est absente (pas encore créée, renommée ou supprimée) | Aucun : la table est fermée jusqu'à la mise à jour de la liste ou la migration qui crée la colonne, avec un avertissement dans le journal de l'outil. |
| Table protégée renommée ou déplacée (repérée par son OID dans `droits.relations_protegees`) | Aucun, jusqu'à la mise à jour de la liste. |
| Vue ou vue matérialisée qui lit une colonne listée, une ligne entière d'une table protégée, ou une vue fermée | Aucun : une vue lit avec les droits de son propriétaire. La dépendance est lue dans `pg_depend`. |
| Partition ou table héritée | La liste de la table mère s'applique. |
| Séquence | Aucun. |

Il retire aussi tout droit accordé à `PUBLIC` dans les quatre schémas des outils (`matrix_lecture` en hériterait), et donne à `matrix_admin` tous les droits sur chaque relation des cinq schémas. Il n'écrit que s'il constate un écart.

La correction a lieu dans la transaction de la commande, avant son `COMMIT`. Les autres sessions ne voient la table qu'une fois corrigée : `matrix_lecture` ne lit jamais une colonne sensible, même un instant. Un `GRANT` passé par l'outil, par erreur, sur une table protégée est corrigé de la même façon. Les migrations des outils n'ont donc rien à faire.

Trois fonctions complètent le déclencheur :

- `droits.appliquer_droits()` : passe complète sur les cinq schémas, sans effet si tout est en ordre. Le rejeu du socle l'appelle ; on peut la relancer après une migration, en contrôle.
- `droits.verifier()` : liste les écarts avec une gravité (`erreur`, `attention`, `info`) : colonne sensible lisible, vue sensible lisible, droit d'écriture de `matrix_lecture`, accès d'un outil au schéma d'un autre, droit `CREATE` sur la base, attribut d'administration, propriétaire de schéma, `search_path`, administrateur non journalisé, privilège par défaut manquant, entrée de la liste sans objet, fonction `SECURITY DEFINER` d'un outil exécutable par `matrix_lecture`.
- `droits.declarer_admin(nom)` : crée un administrateur nominatif, membre de `matrix_admin`, avec `log_statement = 'all'`.

Une modification de `droits.colonnes_sensibles` réapplique les droits dans la même transaction. Les colonnes de la convention ne se retirent qu'en superutilisateur.

### 3.3 Essais

Faits sur PostgreSQL 16.15, avec le script d'entrée officiel de l'image (`docker-entrypoint.sh` de `docker-library/postgres`, version 16-bookworm), exécuté hors de Docker avec les binaires du poste (seuls le chemin des scripts et le dossier de la socket sont adaptés) :

- Les trois scripts passent au premier démarrage, puis en rejeu sur une base remplie (336 relations, 2,5 s).
- Les migrations de base régénérées par les analyses, appliquées par le rôle de chaque outil : Keystone (203 tables, 573 commandes), Codex (22 tables), Vigie (36 tables), puis `infra/postgres/cursus/schema.sql` avec le jeu de démonstration de Cursus. `droits.verifier()` ne signale aucune erreur. Pour `vigie.events`, `matrix_lecture` lit 18 colonnes sur 20.
- `infra/postgres/verifier-droits.sql` : 68 cas conformes, dont `GRANT` de l'outil à `matrix_lecture` ou à `PUBLIC`, ajout et renommage de colonne, renommage de table, vues (colonne sensible, ligne entière, vue sur vue), partitions, sauvegarde, administration.
- Coût : la migration de base de Keystone prend 3,3 s avec le déclencheur et 2,0 s sans, soit 2 ms par commande.
- Contre-essai du 15/10/2026 sur un PostgreSQL 16.15 neuf, en connexions réelles par mot de passe : scripts passés deux fois sur base vide puis rejoués sur base remplie, sans aucun changement d'état ; migrations du dépôt de chaque outil, `"public".` remplacé par le schéma (370, 38 et 58 références), puis migrations de base régénérées : 203, 22 et 36 tables dans le bon schéma, journal dans le schéma de l'outil, aucun objet dans `public` ; démonstration de Cursus générée par son code (417 lignes) et chargée avec toutes les contraintes actives ; 315 cas d'isolation entre rôles ; 292 relations et 2 722 colonnes essayées une à une par `matrix_app` : 16 refusées, exactement celles de la liste ; table protégée recréée, colonne sensible ajoutée dans les deux ordres, `GRANT` de l'outil, vues ; sauvegarde par `epc2i_sauvegarde`, puis restauration dans une base neuve et par la procédure du README.

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
- sinon : PGlite dans le dossier de données habituel, avec `create schema if not exists <schéma>; set search_path to <schéma>` avant les migrations ;
- `next build` ne doit jamais ouvrir le serveur commun : garde sur `process.env.NEXT_PHASE === 'phase-production-build'` (Next fixe cette variable pendant le build), qui force PGlite. Keystone et Vigie ouvrent la base pendant le build ; Codex non, la garde y est ajoutée par précaution ;
- une ancienne base PGlite, dont les tables sont dans `public`, est refusée avec un message clair (`npm run db:reset`, ou reprise). Sans ce garde-fou, le nouveau code crée le schéma de l'outil à côté et les anciennes données deviennent invisibles sans avertissement (constaté dans les trois outils).

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

- Les tables sont déclarées avec `pgSchema('<schéma>').table(…)` au lieu de `pgTable(…)`. Drizzle qualifie alors toutes ses requêtes (`"vigie"."sites"`) et drizzle-kit écrit `REFERENCES "<schéma>"."…"`. Avec `pgTable` et le seul `search_path`, drizzle-kit écrit `REFERENCES "public"."…"` à chaque migration, qu'il faudrait retoucher à la main.
- L'objet `pgSchema` n'est **pas exporté** par le fichier de schéma. Exporté, drizzle-kit ajoute `CREATE SCHEMA "<schéma>";` en tête de migration, que le rôle de l'outil ne peut pas exécuter (vérifié dans Keystone et Codex ; dans Vigie, l'objet exporté obligeait à retirer deux lignes de la migration générée).
- Les migrations actuelles contiennent des références `"public"` en dur : 370 dans Keystone, 38 dans Codex, 58 dans Vigie. Appliquées par le rôle de l'outil, elles échouent (`permission denied for schema public`). Il faut repartir d'une migration de base unique, régénérée. Les analyses ont comparé la structure obtenue à l'ancienne : mêmes colonnes, types, défauts, clés et règles de suppression ; seul l'ordre de quelques colonnes change.
- `drizzle.config.ts` de chaque outil :

```ts
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',          // Keystone : './src/server/db/schema/index.ts'
  out: './drizzle',
  schemaFilter: ['vigie'],                // le schéma de l'outil
  migrations: { schema: 'vigie', table: '__drizzle_migrations' },
});
```

Le bloc `migrations` ne sert qu'aux commandes de drizzle-kit (`migrate`, `studio`). À l'exécution, c'est le migrateur du § 4.3 qui tient le journal.

### 4.3 Migrateur commun

`migrate(db, { migrationsSchema })` de Drizzle place bien le journal dans le schéma de l'outil, mais lance d'abord `CREATE SCHEMA IF NOT EXISTS` (`drizzle-orm/pg-core/dialect.js:54`). PostgreSQL vérifie le droit `CREATE` sur la base avant de constater que le schéma existe : `ERROR: permission denied for database epc2i`. Accorder ce droit permettrait à l'outil de créer d'autres schémas, contre la convention. Chaque outil reçoit donc ce migrateur, qui tient le même journal que Drizzle (table `<schéma>.__drizzle_migrations`, colonnes `id`, `hash`, `created_at`, même règle d'ordre) :

```ts
// Keystone : src/server/db/migrate.ts ; Codex et Vigie : src/db/migrate.ts
import 'server-only';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { DB } from './types';

/** Schéma PostgreSQL de l'outil : ses tables et le journal de ses migrations. */
export const DB_SCHEMA = 'vigie'; // 'keystone', 'codex'
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

Essais : la même logique a tourné sur PGlite puis sur le serveur en tant que `codex_app`, avec deux instances lancées en même temps (23 tables, une seule ligne au journal). La version de Keystone (`migrateKeystone`, analyse Keystone) est identique, avec une clé de verrou constante. La version de Vigie créait le journal avant de prendre le verrou : l'analyse Keystone a observé dans ce cas une erreur `duplicate key … pg_type_typname_nsp_index` au premier démarrage simultané. Le verrou passe donc en tête.

Les clés de verrou consultatif sont communes à toute la base `epc2i` : chaque outil dérive les siennes de son nom de schéma (`hashtext('vigie.migrations')`, `hashtext('vigie.ecritures')`) pour ne jamais bloquer un autre outil.

### 4.4 Politique des dépôts sur la migration unique

| Outil | Règle du dépôt | Conséquence |
|---|---|---|
| Keystone | `CLAUDE.md:45` : « generate a new one with `npm run db:generate` and never edit an existing one ». | Exception à faire valider par le responsable produit (P-02). Plusieurs éléments vont dans ce sens : pas de production (décision I-1a), bases locales jetables (`README.md:24, 54`), chapitre 4 déjà regroupé en une migration (`docs/DELIVERY-6-PLAN.md:76`). |
| Codex | `CLAUDE.md:77-78` : « Tant qu'il n'y a pas de base de production, on régénère une migration unique ». | Permis. |
| Vigie | Aucune règle ; `README.md:12` traite les bases comme jetables (`db:reset` après toute modification du schéma). | Permis, sous réserve de la question des données réelles (P-03). |

Dans les trois outils, la migration unique est **figée** dès que le serveur commun contient des données à garder : ensuite, uniquement des migrations incrémentales.

### 4.5 Concurrence

PGlite exécute toutes les requêtes et transactions l'une après l'autre. Un pool `pg` les exécute en parallèle. Les trois outils calculent des numéros métier en « plus grand + 1 » :

- Keystone : 5 créations simultanées de risque donnent 2 succès et 3 erreurs `risks_project_id_number_unique` ;
- Codex : 17 imports sur 20 échouent sur `documents_pkey` (`nextDocId`, `src/lib/codification.ts:10-16`) ;
- Vigie : `nextRef` (`src/lib/forms.ts:76`) est appelé **hors transaction** dans 10 fonctions (`plan.ts:60`, `events.ts:239`, `prevention.ts:64, 155, 320`, `audits.ts:51`, `environment.ts:156`, `pp-import.ts:495-496`, `documents.ts:97`) : le risque existe déjà avec PGlite, la latence du réseau l'élargit.

Règle commune : **chaque transaction d'écriture prend le verrou d'écriture de l'outil**. Les écritures de l'outil passent l'une après l'autre, comme dans PGlite ; les lectures hors transaction restent parallèles. Code essayé dans Keystone (5 créations simultanées : 5 succès) :

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

Pour Vigie, les 10 calculs de référence doivent en plus entrer dans la transaction de l'écriture qu'ils préparent.

### 4.6 Application Mac, Docker, Coolify

- **Application Mac.** `next start` tourne dans le dossier du projet, et Next charge ses fichiers `.env*`. Un `DATABASE_URL` mis dans `.env.local` pour le développement brancherait l'application Mac sur le serveur commun. Dans la fonction `environment()` de chaque application : `env["DATABASE_URL"] = ""`. Next ne remplit depuis les fichiers `.env` que les clés absentes (`@next/env`, vérifié par les analyses) ; une valeur vide les bloque, et le module d'ouverture traite le vide comme une absence.
- **Dockerfile.** Ne jamais mettre `DATABASE_URL` dans l'image. Le volume `/data` reste nécessaire : il porte les fichiers déposés, et la base de repli. Mettre à jour le commentaire d'en-tête.
- **Coolify.** `DATABASE_URL` en variable d'exécution seulement (jamais disponible au build), le volume `/data` gardé, l'option de réseau prédéfini activée (`infra/postgres/README.md`).
- **Dépendances.** `pg` 8.23.1 en dépendance, `@types/pg` 8.23.1 en dépendance de développement. `drizzle-orm/node-postgres` est déjà dans `drizzle-orm` 0.45.3. `pg` est externe par défaut dans Next 16 : `serverExternalPackages` ne change pas.
- **Jeu de démonstration sur le serveur.** Seulement avec une variable explicite (`KEYSTONE_SEED_DEMO=1`, `CODEX_SEED_DEMO=1`, `VIGIE_SEED_DEMO=1`), en bêta. En production, la décision A-15 de Keystone demande des données réelles (P-11).

### 4.7 Différences de pilote

| Point | PGlite | node-postgres | Effet |
|---|---|---|---|
| `date`, `timestamp`, `timestamptz` en `mode: 'string'` | chaîne | chaîne | Aucun (Drizzle force la chaîne). |
| `timestamptz` en mode par défaut | `Date` | `Date` | Aucun (Vigie). |
| `numeric` | chaîne | chaîne | Aucun. |
| `int8` (`count(*)` sans conversion) | nombre | chaîne | Aucune requête brute concernée : toutes castent en `::int` (Keystone, Codex, Vigie vérifiés). |
| `db.execute().rows` | oui | oui | Type commun du § 4.1. |
| Version du moteur | PostgreSQL 18.3 | PostgreSQL 16 | Le SQL des trois outils n'utilise rien de propre à 17 ou 18 ; à surveiller (P-01). |

### 4.8 Déclaration à Matrix

Après les migrations, chaque outil peut appeler `introspecterPostgres` (`integration/declarer-schema.mjs`) avec une fonction qui exécute du SQL brut : `q => db.execute(sql.raw(q)).then(r => r.rows)`. La requête lit `current_schema()` : le `search_path` posé dans les deux modes suffit. Elle remonte aussi la table du journal des migrations, que Matrix doit écarter (§ 11).

## 5. Keystone

Analyse détaillée et correctif complet essayés dans une copie (39 fichiers, s'applique sans conflit) : typecheck et lint propres, tests sur PGlite, `scripts/db-check.ts` sur le serveur en tant que `keystone_app`, `next build` puis `next start` sur le serveur.

### 5.1 Fichiers

| Fichier | Changement |
|---|---|
| `src/server/db/schema/_common.ts` | `const keystoneSchema = pgSchema('keystone')` (non exporté par `schema/index.ts`), `export const ksTable = keystoneSchema.table`. |
| `src/server/db/schema/*.ts` (29 fichiers) | 203 `pgTable(` deviennent `ksTable(` ; import de `ksTable` depuis `./_common`. Remplacement mécanique. |
| `drizzle/` | Les 6 migrations sont remplacées par `0000_keystone_baseline.sql` (`drizzle-kit generate --name keystone_baseline`) : 203 `CREATE TABLE "keystone"."…"`, 0 `"public"`. Un second `generate` répond « No schema changes ». |
| `drizzle.config.ts` | `schemaFilter: ['keystone']`, `migrations: { schema: 'keystone', table: '__drizzle_migrations' }`. |
| `src/server/db/types.ts` | Type commun du § 4.1. |
| `src/server/db/migrate.ts` (nouveau) | Migrateur du § 4.3 avec `DB_SCHEMA = 'keystone'`. |
| `src/server/db/open.ts` | `openDatabase()` (PGlite) et `openServerDatabase()` (serveur), code ci-dessous. |
| `src/server/db/client.ts` | Choix du mode dans `open()`, garde de build ; `getDb` et `setDb` inchangés. |
| D06 | Rien dans la migration de base. Les tables et réglages des échanges RH (`hr_timesheets`, `hr.hours_source`…, `docs/remplacement-lucca.md`, § 5.2) viennent ensuite, dans la migration `0001` générée après la base (`docs/remplacement-lucca.md` la numérote `0006`, d'après les anciennes migrations). |
| `src/server/db/seed/index.ts:69` | Comptage de `projects` dans la transaction du remplissage (deux instances ne remplissent pas deux fois). |
| SQL brut des tests (`dal/delivery5-writes.test.ts:272-273, 460, 462`, `dal/delivery4-writes.test.ts:313-314`, `features/site/actions.test.ts:137, 142`) | Aucun changement : noms non qualifiés résolus par le `search_path`, posé aussi dans PGlite. |
| `tests/db-template.ts` (nouveau), `vitest.config.ts` | Base de test construite une fois par exécution et copiée par chaque fichier de test ; `test.env.DATABASE_URL = ''`. |
| `scripts/db-check-pg.ts` (nouveau) | `db-check` sur un PostgreSQL 16 doté du socle, pour l'intégration continue. |
| `desktop/KeystoneApp.swift` | `env["DATABASE_URL"] = ""` après la ligne 108. |
| `Dockerfile` | Commentaire des lignes 3-4 ; `KEYSTONE_DATA_DIR=/data` reste (fichiers et repli). |
| `package.json` | `pg`, `@types/pg`. `db:reset` reste valable pour PGlite. |
| `README.md`, `docs/ARCHITECTURE.md`, `CLAUDE.md` | Les deux modes, la règle « `ksTable`, jamais `pgTable` », l'exception de la migration unique, les variables. |

### 5.2 Code d'ouverture

```ts
// src/server/db/open.ts
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import { DB_SCHEMA, migrateSchema } from './migrate';
import * as schema from './schema';
import { seedIfEmpty } from './seed';
import type { DB } from './types';

const MIGRATIONS = path.join(process.cwd(), 'drizzle');

/** PGlite dans `dataDir` (en mémoire sans dossier) : développement, tests, application Mac. */
export async function openDatabase(dataDir?: string, migrationsFolder = MIGRATIONS): Promise<DB> {
  if (dataDir) fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const { rows } = await client.query<{ ancienne: boolean }>(
    `select to_regclass('public.projects') is not null and to_regclass('${DB_SCHEMA}.projects') is null as ancienne`);
  if (rows[0].ancienne) {
    await client.close();
    throw new Error(`Base PGlite antérieure au schéma ${DB_SCHEMA} dans ${dataDir} : npm run db:reset, ou reprise (docs).`);
  }
  await client.exec(`create schema if not exists ${DB_SCHEMA}; set search_path to ${DB_SCHEMA}`);
  const db: DB = drizzlePglite(client, { schema });
  await migrateSchema(db, migrationsFolder);
  await seedIfEmpty(db);
  return db;
}

export interface ServerDatabaseOptions { migrationsFolder?: string; seed?: boolean; max?: number }

/** Serveur commun EPC2I, rôle keystone_app (postgres://keystone_app:…@hôte:5432/epc2i). */
export async function openServerDatabase(url: string, opts: ServerDatabaseOptions = {}): Promise<DB> {
  const pool = new Pool({ connectionString: url, max: opts.max ?? 10, application_name: 'keystone', options: `-c search_path=${DB_SCHEMA}` });
  pool.on('error', (e) => console.error('[db] connexion inactive perdue :', e));
  const db: DB = serializeTransactions(drizzlePg(pool, { schema }));
  await migrateSchema(db, opts.migrationsFolder ?? MIGRATIONS);
  if (opts.seed) await seedIfEmpty(db);
  return db;
}

/** Verrou d'écriture de Keystone (§ 4.5). */
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

```ts
// src/server/db/client.ts, fonction open() appelée par getDb()
function open(): Promise<DB> {
  // `next build` pré-rend des pages qui lisent la base : il ne doit jamais migrer le serveur commun.
  const url = process.env.NEXT_PHASE === 'phase-production-build' ? undefined : process.env.DATABASE_URL;
  if (!url) return openDatabase(path.join(DATA_DIR, 'pg'));
  return openServerDatabase(url, {
    seed: process.env.KEYSTONE_SEED_DEMO === '1',
    max: process.env.KEYSTONE_DB_POOL_MAX ? Number(process.env.KEYSTONE_DB_POOL_MAX) : undefined,
  });
}
```

Différences avec le code essayé par l'analyse : clés de verrou dérivées du schéma (au lieu de constantes), garde-fou contre une ancienne base PGlite (repris de Vigie), message en français. La version de test qui charge une copie de la base modèle (`KEYSTONE_TEST_DB_TEMPLATE`, `PGlite.create({ loadDataDir })`) est dans l'analyse.

### 5.3 Tests

- Les 196 fichiers de test restent sur PGlite, en mémoire. La base modèle ramène l'ouverture de 6 à 9 s à 1,2 s par fichier : la suite passe de 43 à 22 minutes de temps processeur (2 646 tests réussis sur 2 649 ; les 3 échecs sont des dépassements du délai de 5 s, sans lien avec la base).
- `test.env.DATABASE_URL = ''` empêche un test d'atteindre le serveur commun.
- Un job d'intégration continue lance `scripts/db-check-pg.ts` sur un PostgreSQL 16 en conteneur, initialisé avec `infra/postgres/init/`. Le nom de schéma étant fixe, chaque exécution prend un serveur neuf.
- Test de concurrence : 5 créations simultanées de risque sur le serveur, toutes réussies.

### 5.4 Données

Pas de production (I-1a). Les bases PGlite existantes (`./.data/pg`, application Mac, éventuelle bêta Coolify `/data/pg`) contiennent le jeu de démonstration. Recommandation : repartir de la démonstration sur le serveur de bêta (`KEYSTONE_SEED_DEMO=1`). La reprise d'une base existante est essayée de bout en bout (renommer `public` en `keystone` sur une copie, `pg_dump` avec `@electric-sql/pglite-tools` 0.4.8, retrait de `SET transaction_timeout`, `psql --single-transaction` en tant que `keystone_app`) : 0,5 jour si elle est demandée (P-03). Copier aussi `/data/files`.

### 5.5 Variables

`DATABASE_URL`, `KEYSTONE_SEED_DEMO`, `KEYSTONE_DB_POOL_MAX` (10 par défaut), `KEYSTONE_DATA_DIR` (fichiers et repli). Inchangées : `KEYSTONE_DIST_DIR`, `CURSUS_API_URL`, `CURSUS_API_KEY`, `KEYSTONE_API_KEY`, `VIGIE_API_URL`, `NEXT_PUBLIC_*`.

## 6. Codex

Bascule essayée de bout en bout le 15 octobre 2026 dans une copie de Codex. Le serveur d'essai est un PostgreSQL 16.15 doté du socle (`infra/postgres/init/`) ; Codex s'y connecte en `codex_app`. Le correctif touche 17 fichiers et s'applique sans conflit sur `main`. Typecheck et lint sont propres. `next build` ne se connecte pas au serveur. La migration, son journal et le jeu de démonstration sont dans le schéma `codex`, rien n'est dans `public`. Les écrans, l'import, le webhook Vigie et les rafales d'imports passent sans erreur dans les deux modes. Deux instances démarrées ensemble ne produisent aucune erreur, et une ancienne base PGlite est refusée. Codex n'a pas de test automatisé.

### 6.1 Fichiers

| Fichier | Changement |
|---|---|
| `src/db/schema.ts` | `export const DB_SCHEMA = 'codex'` ; `const codex = pgSchema(DB_SCHEMA)` (non exporté) ; 22 `pgTable(` deviennent `codex.table(`. Les 3 index partiels sont générés qualifiés. |
| `drizzle/` | `rm -rf drizzle && npx drizzle-kit generate --name init` (règle de `CLAUDE.md:77`) : 65 `"codex"."…"`, 0 `"public"`, pas de `CREATE SCHEMA`. Un second `generate` répond « No schema changes ». |
| `drizzle.config.ts` | `schemaFilter: ['codex']`, `migrations: { schema: 'codex', table: '__drizzle_migrations' }`. |
| `src/db/types.ts` (nouveau) | Type commun du § 4.1 ; `Db` devient un alias de `DB`. |
| `src/db/migrate.ts` (nouveau) | Migrateur du § 4.3, `DB_SCHEMA` importé de `schema.ts`. |
| `src/db/index.ts` | Code ci-dessous. Le comptage brut `client.query('select count(*)::int as n from users')` (ligne 21) devient `db.select({ n: count() }).from(schema.users)`. |
| `src/db/seed.ts` | Première instruction de la transaction du remplissage (ligne 86) : `if ((await tx.$count(s.users)) > 0) return;`. Sans elle, deux instances qui démarrent ensemble sur un schéma vide avec `CODEX_SEED_DEMO=1` comptent toutes deux 0 utilisateur et remplissent toutes deux. La seconde échoue sur `duplicate key … departments_pkey` et sa première requête répond 500 (constaté). Le verrou d'écriture sérialise cette transaction : la seconde instance y trouve les utilisateurs de la première et s'arrête. Même règle que Keystone (§ 5.1, `seed/index.ts:69`). |
| `src/lib/codification.ts` | Rien : `nextDocId` est appelé dans des transactions, que le verrou d'écriture sérialise. L'analyse avait essayé un verrou propre à `nextDocId` (30 imports sur 30) ; le verrou d'écriture le rend inutile et protège aussi les contrôles d'état non verrouillés (`lockOf`, `addWorkingVersion` face à `requestValidation`, double approbation dans `decideStep`). |
| `desktop/CodexApp.swift` | `env["DATABASE_URL"] = ""` après la ligne 98. Le Swift ne se compile que sous macOS ; l'effet est vérifié avec `next start` : un `DATABASE_URL` vide dans l'environnement l'emporte sur un `.env.local` qui pointe vers le serveur (PGlite ouvert, aucune connexion), et le `.env.local` seul branche bien Codex sur le serveur. |
| `Dockerfile` (lignes 3-4), `.env.example` (section « Database » : `DATABASE_URL`, `CODEX_DB_POOL`, `CODEX_SEED_DEMO`), `README.md` (ligne 6, « Démarrer » avec un tableau des deux modes et la consigne `db:reset` pour une base antérieure au schéma, arborescence `db/`, tableau et consignes de « Mise en ligne », dont la ligne 124), `CLAUDE.md:75-78` | Les deux modes ; `codex.table(…)`, jamais `pgTable(…)` ; `pgSchema` jamais exporté ; migration unique figée dès les premières données à garder. |
| `docs/decisions.md` | La décision M-01 répond en partie à O-03 : base commune sans accès croisé, l'intégration avec Keystone reste une API. |
| `package.json`, `package-lock.json` | `pg` 8.23.1, `@types/pg` 8.23.1 en développement. Le lockfile d'origine vient de npm 11 : le mettre à jour avec npm 11 (`npx npm@11 install pg@8.23.1`). npm 10 retire les champs `libc` de tout le fichier, soit 256 lignes de bruit dans le diff. |

### 6.2 Code d'ouverture

```ts
// src/db/index.ts
import 'server-only';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { count, sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import { migrateSchema } from './migrate';
import * as schema from './schema';
import { DB_SCHEMA } from './schema';
import { seed } from './seed';
import type { DB } from './types';

export type Db = DB;
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.CODEX_DATA_DIR ?? path.join(process.cwd(), '.data'));
export const FILES_DIR = path.join(DATA_DIR, 'files');
const MIGRATIONS = path.join(process.cwd(), 'drizzle');

async function openServer(url: string): Promise<DB> {
  const pool = new Pool({ connectionString: url, max: Number(process.env.CODEX_DB_POOL) || 10, application_name: 'codex', options: `-c search_path=${DB_SCHEMA}` });
  pool.on('error', (err) => console.error('[db] connexion inactive perdue', err));
  const db: DB = drizzlePg(pool, { schema });
  const transaction = db.transaction.bind(db);
  db.transaction = ((fn, config) => transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${DB_SCHEMA}.ecritures`}))`);
    return fn(tx);
  }, config)) as DB['transaction'];
  return db;
}

async function openEmbedded(): Promise<DB> {
  const dir = path.join(DATA_DIR, 'pglite');
  const client = new PGlite(dir);
  const { rows } = await client.query<{ ancienne: boolean }>(
    `select to_regclass('public.users') is not null and to_regclass('${DB_SCHEMA}.users') is null as ancienne`);
  if (rows[0].ancienne) {
    await client.close();
    throw new Error(`Base PGlite antérieure au schéma ${DB_SCHEMA} dans ${dir} : npm run db:reset (voir README).`);
  }
  await client.exec(`create schema if not exists ${DB_SCHEMA}; set search_path to ${DB_SCHEMA}`);
  return drizzlePglite(client, { schema });
}

async function init(): Promise<DB> {
  await mkdir(FILES_DIR, { recursive: true });
  const url = process.env.NEXT_PHASE === 'phase-production-build' ? undefined : process.env.DATABASE_URL;
  const db = url ? await openServer(url) : await openEmbedded();
  await migrateSchema(db, MIGRATIONS);
  if (!url || process.env.CODEX_SEED_DEMO === '1') {
    const [{ n }] = await db.select({ n: count() }).from(schema.users);
    if (n === 0) await seed(db);
  }
  return db;
}

const g = globalThis as unknown as { __codexDb?: Promise<DB> };
export function getDb(): Promise<DB> {
  g.__codexDb ??= init().catch((err) => { g.__codexDb = undefined; throw err; });
  return g.__codexDb;
}
export { schema };
```

Ce code a tourné tel quel, avec `src/db/types.ts` du § 4.1 et `src/db/migrate.ts` du § 4.3 :

- `tsc` l'accepte avec les deux pilotes, sans retouche des fichiers qui utilisent `Db` (`access.ts`, `lifecycle.ts`, `codification.ts`, `importer.ts`, `seed.ts`).
- Le verrou d'écriture commun et le pool à 10 tiennent : 20 puis 30 imports simultanés donnent 50 réponses 201 et 50 identifiants distincts. Pendant la rafale, Codex ouvre 10 connexions `application_name = codex`.
- Le garde-fou refuse une base PGlite créée par la migration d'origine (tables dans `public`). La page répond 500, le journal de Next affiche « Base PGlite antérieure au schéma codex … », et la base reste intacte.
- Avec `CODEX_SEED_DEMO=1`, le serveur est rempli une seule fois. Un redémarrage ne rejoue ni la migration ni le remplissage.
- `next build` avec `DATABASE_URL` présente n'ouvre aucune connexion et ne crée pas `.data` : Codex n'ouvre pas la base pendant le build.

### 6.3 Tests, données, variables

- Pas de suite de tests. Recette faite le 15 octobre dans les deux modes, avec `next build` puis `next start`, et avec `next dev` sur le serveur : les 7 écrans, une fiche document, les deux exports CSV, `GET /api/registry` (23 familles, 69 types), import JSON et import multipart avec fichier (relu par `/api/documents/[id]/file`), webhook Vigie (décision, puis renvoi reconnu comme déjà appliqué), rafales d'imports simultanés. Reste à passer à la main : les 4 rôles, en français et en anglais.
- Contrôles sur le serveur après la migration : 23 tables dans `codex` (les 22 de Codex et le journal), toutes à `codex_app` ; aucune relation dans `public` ; journal `codex.__drizzle_migrations` à une ligne ; aucune clé étrangère hors de `codex` ; les 3 index partiels créés ; `matrix_lecture` lit les 23 tables ; `droits.verifier()` ne signale rien. `introspecterPostgres` déclare 23 tables, journal compris (§ 11). Dans PGlite aussi, les 23 tables et le journal sont dans `codex`.
- `migrate()` de Drizzle, lancé en `codex_app`, échoue sur `permission denied for database epc2i` sans rien créer : le migrateur du § 4.3 est nécessaire.
- Sur un clone neuf, `npm run typecheck` signale `PageProps`, `LayoutProps` et `RouteContext` introuvables tant que `next-env.d.ts` (non versionné) n'existe pas. Lancer d'abord `npx next typegen`, `next dev` ou `next build`. Le défaut existe déjà sans la bascule.
- Données : repartir de la démonstration. Reprise d'une base PGlite essayée (`pgDump --data-only`, 795 `INSERT`, séquences à jour) si une instance Coolify contient des saisies (P-03). Copier `/data/files`.
- Variables : `DATABASE_URL`, `CODEX_DB_POOL`, `CODEX_SEED_DEMO`, `CODEX_DATA_DIR` (fichiers et repli).

## 7. Vigie

Code essayé dans une copie : `tsc` et `next build` passent, les 18 routes répondent dans les deux modes. Vigie n'a pas de test automatisé. C'est le seul outil Drizzle avec des colonnes sensibles (`events.injury`, `events.lost_days`) : il valide le mécanisme du § 3 sur un vrai schéma.

### 7.1 Fichiers

| Fichier | Changement |
|---|---|
| `src/db/schema.ts` | `const vigie = pgSchema('vigie')` (non exporté) ; 36 `pgTable(` deviennent `vigie.table(` (lignes 5 à 435). Les colonnes D06 de `hours_worked` (`docs/remplacement-lucca.md`, § 5.3) viennent dans la migration suivante, `0001` (numérotée `0002` dans `docs/remplacement-lucca.md`). |
| `drizzle/` | `rm -rf drizzle && npx drizzle-kit generate --name init`. Avec l'objet non exporté, aucune ligne à retirer à la main. |
| `drizzle.config.ts` | `schemaFilter: ['vigie']`, `migrations: { schema: 'vigie', table: '__drizzle_migrations' }`. |
| `src/db/types.ts` (nouveau), `src/db/migrate.ts` (nouveau) | § 4.1 et § 4.3. |
| `src/db/index.ts` | Code ci-dessous. |
| `src/db/seed.ts` | Requête brute de la ligne 206 remplacée par `if ((await db.$count(t.sites)) > 0) return;` ; signature `seed(db: DB)`. |
| `src/db/seeds/types.ts` | `SeedTx = Parameters<Parameters<DB['transaction']>[0]>[0]`. |
| `src/server/plan.ts:59-61`, `events.ts:238-240`, `prevention.ts:64, 155, 320`, `audits.ts:51`, `environment.ts:156`, `pp-import.ts:495-496`, `documents.ts:97` | Lecture des références existantes et insertion dans la même transaction (§ 4.5). |
| `desktop-app/Sources/ServerController.swift:482-503` | `environment["DATABASE_URL"] = ""` à côté de `VIGIE_DESKTOP`. Le verrou « un seul serveur par base PGlite » reste valable. |
| `Dockerfile` (lignes 3-4, 18), `README.md` (lignes 12, 47, 60-67), `CLAUDE.md` (lignes 11-12), `.env.example` (à créer, autorisé par `.gitignore`) | Les deux modes et les variables. |
| `package.json` | `pg` en dépendance, `@types/pg` en développement (l'analyse l'avait placé par erreur dans `dependencies`). |

Aucune migration de droits dans Vigie : l'analyse avait essayé un bloc `DO` qui accordait à `matrix_lecture` les colonnes autorisées de `events`. Le socle le fait désormais pour tous les outils.

### 7.2 Code d'ouverture

```ts
// src/db/index.ts
import 'server-only';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Pool } from 'pg';
import { DB_SCHEMA, migrateSchema } from './migrate';
import * as schema from './schema';
import { seed } from './seed';
import type { DB } from './types';

export type Db = DB;
const MIGRATIONS = path.join(process.cwd(), 'drizzle');
const g = globalThis as unknown as { __vigieDb?: Promise<DB> };

// Serveur commun EPC2I (rôle vigie_app) : pool node-postgres, verrou d'écriture de Vigie.
async function openServer(url: string): Promise<DB> {
  const pool = new Pool({ connectionString: url, application_name: 'vigie', options: `-c search_path=${DB_SCHEMA}` });
  // Sans écouteur, la coupure d'une connexion inactive (redémarrage du serveur) arrêterait le processus.
  pool.on('error', (err) => console.error('[vigie] connexion PostgreSQL perdue :', err.message));
  const db: DB = drizzlePg(pool, { schema });
  const transaction = db.transaction.bind(db);
  db.transaction = ((fn, config) => transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${DB_SCHEMA}.ecritures`}))`);
    return fn(tx);
  }, config)) as DB['transaction'];
  return db;
}

// Repli sans DATABASE_URL (développement, application Mac) : PGlite dans VIGIE_DATA_DIR ou .data/vigie.
async function openEmbedded(): Promise<DB> {
  const dir = process.env.VIGIE_DATA_DIR ?? path.join(process.cwd(), '.data', 'vigie');
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const { rows } = await client.query<{ ancienne: boolean }>(
    `select to_regclass('public.sites') is not null and to_regclass('${DB_SCHEMA}.sites') is null as ancienne`);
  if (rows[0].ancienne) {
    await client.close(); // getDb() réessaiera : jamais deux PGlite ouverts sur le même dossier
    throw new Error(`Base PGlite antérieure au schéma ${DB_SCHEMA} dans ${dir} : npm run db:reset, ou export des données (voir README).`);
  }
  await client.exec(`create schema if not exists ${DB_SCHEMA}; set search_path to ${DB_SCHEMA}`);
  return drizzlePglite(client, { schema });
}

async function open(): Promise<DB> {
  // `next build` pré-rend des pages qui lisent la base : jamais le serveur commun pendant le build.
  const url = process.env.NEXT_PHASE === 'phase-production-build' ? undefined : process.env.DATABASE_URL;
  const db = url ? await openServer(url) : await openEmbedded();
  await migrateSchema(db, MIGRATIONS);
  // Jeu de démonstration : toujours en PGlite ; sur le serveur seulement avec VIGIE_SEED_DEMO=1.
  if (!url || process.env.VIGIE_SEED_DEMO === '1') await seed(db);
  return db;
}

export function getDb(): Promise<DB> {
  g.__vigieDb ??= open().catch((err) => { g.__vigieDb = undefined; throw err; });
  return g.__vigieDb;
}
export { schema };
```

Différences avec le code essayé par l'analyse (`vigie-index-propose.ts`) : même migrateur dans les deux modes, verrou pris avant la création du journal, verrou d'écriture, garde de build, `VIGIE_SEED_DEMO=1` au lieu de `VIGIE_SEED=demo`. Sur un serveur vide, Vigie ne fonctionne pas sans jeu de données (`src/lib/session.ts:23`, `src/server/events.ts:245`) : la bêta démarre avec `VIGIE_SEED_DEMO=1`.

### 7.3 Données et variables

- Données : rien n'indique une base de production (noms entre crochets, pas d'authentification). Deux bases ont pu recevoir des saisies : l'instance Coolify (`/data/db`) et l'application Mac (P-03). L'export est essayé de bout en bout ; `--column-inserts` est obligatoire, l'ordre des colonnes ayant changé dans `sites` et `prevention_plans`. Copier `/data/uploads`.
- Variables : `DATABASE_URL`, `VIGIE_SEED_DEMO`, `VIGIE_UPLOAD_DIR` (pièces jointes), `VIGIE_DATA_DIR` (repli), `VIGIE_TODAY`.

## 8. Cursus

Cursus est le seul outil sans Drizzle et sans PostgreSQL : Express 5, `node:sqlite` synchrone, une classe `Db` (`server/src/db.ts`, 195 lignes) qui crée les tables depuis l'objet `TABLES`, sans clé étrangère. Les règles métier de `shared/` travaillent sur un instantané en mémoire et n'appellent jamais la base : le client et `shared/` ne changent pas.

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
| `server/src/db.ts` | Classe abstraite `Db`, même API devenue asynchrone (`all`, `where`, `get`, `insert`, `update`, `remove`, `count`, `tx`, `getSetting`, `setSetting`) plus `query`, `clearAll`, `resyncIds`, `lockActions`. Adaptateurs `SqliteDb` et `PgDb`. `openDb()` : `DATABASE_URL` présente → `PgDb`, sinon SQLite (`CURSUS_DB` ou `data/cursus.db`). `TABLES` reste la source lue par le collecteur de Matrix. |
| `server/src/dataset.ts`, `auth.ts`, `index.ts`, `migrate.ts`, `seed.ts`, `reset.ts`, `integrations/keystone.ts`, `actions/*.ts` (8 fichiers) et `actions/context.ts` | `async`/`await` sur les 141 appels directs et leurs appelants (42 gestionnaires d'actions). Les 34 boucles `forEach` qui écrivent deviennent `for…of` (9 dans les actions, environ 25 dans `seed.ts`). Règle de lint contre les promesses non attendues. |
| `server/migrations-pg/0001_init.sql` (nouveau) | Copie de `infra/postgres/cursus/schema.sql` (§ 8.4). La migration des échanges RH (`docs/remplacement-lucca.md`, § 5.1, nommée `0003_echanges_rh.sql`) devient `0002_echanges_rh.sql` : le script de droits `0002` du prototype n'a plus lieu d'être (§ 8.5). |
| `server/scripts/sqlite-vers-postgres.ts` (nouveau) | Reprise des données (§ 8.6). |
| `tests/*.test.ts` (4 fichiers) | `fresh()` asynchrone, `assert.throws` deviennent `assert.rejects`, choix du moteur par `CURSUS_TEST_ENGINE=sqlite\|pg`. |
| `shared/dates.ts:11` | `isValidDate` contrôle aussi le calendrier : `2026-02-30` passe le contrôle de format puis échoue dans PostgreSQL (« date/time field value out of range », vérifié), soit une erreur 500. |
| `server/src/index.ts:147-157` | La route Keystone contrôle `retour >= depart` (aujourd'hui le format seulement). |
| `desktop/CursusApp.swift:77-83` | `env["DATABASE_URL"] = ""`. |
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

### 8.4 Schéma cible : `infra/postgres/cursus/schema.sql`

28 tables, noms inchangés, 37 clés étrangères, 8 unicités (7 contraintes et un index sur `lower(equipes.nom)`), 56 contraintes `CHECK`, 12 index. Le fichier suit le format de drizzle-kit, que le collecteur de Matrix sait lire. La vue `heures_validees` du prototype n'y est plus : les vues versionnées `heures_validees_v1`, `absences_validees_v1` et `heures_site_mois_v1` (`docs/remplacement-lucca.md`, § 3.9) la remplacent dans la migration des échanges RH, qui ajoute les colonnes dont elles ont besoin (`feuilles.version`, `valide_le`, `site`).

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

Aucun `GRANT` dans les migrations de Cursus. Le déclencheur `droits_ddl` donne à `matrix_lecture` les colonnes autorisées dès la création : sur `employes`, 17 colonnes sur 22 sont lisibles, `matricule` compris. Le fichier `0002_droits_matrix.sql` du prototype est inutile, et la consigne « à relancer après chaque migration » de `docs/remplacement-lucca.md` (§ 3.9) aussi. Essai : les trois vues `*_v1`, créées par `cursus_app` sur le schéma rempli, sont lisibles par `matrix_app` sans aucun `GRANT` (228 lignes d'heures, 1 403 h, comme le calcul sur SQLite), et `droits.verifier()` ne signale aucune erreur.

### 8.6 Reprise des données SQLite

Script `server/scripts/sqlite-vers-postgres.ts` (prototype de 137 lignes essayé) :

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

## 9. Heures validées : D06, option A, réversible

Le circuit, les contrats (`data/contrats/heures-validees.schema.json`, `absences-validees.schema.json`) et les changements fonctionnels de chaque outil sont dans `docs/remplacement-lucca.md`. Ce qui concerne la base de données :

| Point | Règle |
|---|---|
| Passage des heures | Par l'API de l'outil destinataire, poussée par Cursus (flux H1, H2, H3). Aucun rôle d'outil ne lit le schéma `cursus` : la convention l'interdit, et les modes de repli (PGlite, SQLite) n'ont pas de serveur commun. L'exception L-07 de `docs/remplacement-lucca.md` n'est pas nécessaire au socle. |
| File d'envoi de Cursus | Table `cursus.evenements_sortants`, écrite dans la transaction de la validation (`temps.validate`) : le message part si et seulement si la validation est enregistrée. Elle vient avec la migration des échanges RH (`0002_echanges_rh.sql`, § 8.2). Sur le serveur, elle est lisible par Matrix sans `GRANT`. |
| Vues de contrôle | `cursus.heures_validees_v1`, `absences_validees_v1`, `heures_site_mois_v1`, propriété de `cursus_app`, lues par `matrix_lecture` seulement (contrôle de complétude). Elles ne lisent aucune colonne sensible : `droits_ddl` les ouvre à Matrix dès leur création (essayé, § 8.5). |
| Migrations des autres outils | Keystone : tables `hr_*` et contraintes de `hours_imports`, dans la migration `0001` qui suit la migration de base. Vigie : colonnes `source`, `hours_interim`, `hours_school`, `complete`, `updated_at` de `hours_worked`, dans la migration `0001` qui suit la sienne. Aucune ne référence `cursus.*`. |
| Colonnes sensibles | Le contenu des messages n'en porte pas (matricule, semaine, projet, heures, site). La ligne de `cursus.journal` ne garde plus le contenu du message (lot C2) ; `payload` reste exclu de Matrix. |

**Réversibilité.** Rien n'est supprimé tant que M-03 n'est pas confirmée. Trois réglages ramènent l'état actuel : `settings.sourceHeures = 'lucca'` dans Cursus (plus de message `heures.*`), `hr.hours_source = 'lucca'` dans Keystone (les écrans relisent l'import Lucca), et la colonne `hours_worked.source` dans Vigie. Les tables alimentées gardent leur colonne `source`. Côté serveur, revenir à Lucca ne demande aucune migration.

## 10. Ordre de bascule

| Étape | Contenu | Condition pour passer à la suite | Retour arrière |
|---|---|---|---|
| 0 | Socle dans Coolify : ressource, variables, réseau, `verifier-droits.sql`, sauvegarde planifiée, restauration d'essai d'un schéma. | 68 cas conformes ; une restauration réussie. | Supprimer la ressource. |
| 1 | **Codex** : le plus petit (un fichier de schéma), migration unique autorisée par son dépôt, aucune colonne sensible. | Recette des deux modes ; rafale d'imports sans erreur ; déclaration à Matrix reçue. | Retirer `DATABASE_URL` : Codex repart sur PGlite (saisies faites sur le serveur perdues, sauf export). |
| 2 | **Vigie** : valide la protection des colonnes sensibles sur `events`. | `droits.verifier()` sans erreur ; Matrix lit `events` sans `injury` ni `lost_days`. | Idem. |
| 3 | **Keystone** : après validation de l'exception à `CLAUDE.md:45` (P-02). | `db-check` sur le serveur ; test de concurrence ; intégration continue sur PostgreSQL. | Idem. |
| 4 | **Cursus** : le plus gros changement et les seules données RH réelles ; reprise depuis SQLite. | Recette RH, manager, collaborateur ; comparaison des instantanés ; première sauvegarde du schéma relue. | Retirer `DATABASE_URL` : retour au fichier SQLite d'origine. |
| 5 | **D06** : migrations des échanges RH dans Cursus, Keystone et Vigie, puis marche en parallèle et bascule selon `docs/remplacement-lucca.md` (§ 6). | Critères de `docs/remplacement-lucca.md`, § 6.4. | Réglages de source à `lucca` (§ 9). |

Matrix commence à lire chaque schéma dès la bascule de l'outil. Une étape ne commence qu'après la précédente : chaque outil reste en état de marche sur sa base embarquée tant que sa branche n'est pas fusionnée.

## 11. Ce que Matrix lit, et avec quel rôle

| Lecture | Rôle | Objets |
|---|---|---|
| Catalogue : tables, colonnes, types, clés | `matrix_app` | `pg_class`, `pg_attribute`, `pg_constraint`, `pg_description` des quatre schémas. `information_schema.columns` ne montre à `matrix_lecture` que les colonnes accordées (17 colonnes sur 22 pour `cursus.employes`) : il ne convient pas. Les déclarations envoyées par les outils restent la source de référence (`docs/declaration-des-tables.md`). |
| Volumétrie et tendance | `matrix_app` | `pg_class.reltuples`, `pg_stat_user_tables`, `pg_total_relation_size` (lisibles sans droit sur les données, vérifié). |
| Extraits masqués, lignes orphelines | `matrix_app`, par `matrix_lecture` | `SELECT` en nommant les colonnes. `SELECT *` est refusé sur une table qui a des colonnes sensibles ; `count(*)` fonctionne. |
| Migrations appliquées | `matrix_app` | `keystone.__drizzle_migrations`, `codex.__drizzle_migrations`, `vigie.__drizzle_migrations`, `cursus.schema_migrations`. |
| Journaux d'audit (D18) | `matrix_app` | Par exemple `codex.audit_log`, `cursus.journal` (sans `payload` ni `message`). |
| Heures et absences validées (D06, D07) | `matrix_app` | `cursus.heures_validees_v1`, `absences_validees_v1`, `heures_site_mois_v1` (après la migration des échanges RH). |
| Colonnes sensibles et contrôle des droits | `matrix_app` | `droits.colonnes_sensibles`, `droits.verifier()`. |
| Écriture dans un schéma d'outil | administrateur nominatif, membre de `matrix_admin` | Tout, journalisé. Jamais `matrix_app`. |

Changements à faire dans Matrix (hors de ce lot) :

- `outils/collecteur.mjs`, `parseDrizzle` : accepter les noms qualifiés `CREATE TABLE "keystone"."cities"` et `ALTER TABLE "keystone"."…"`. Les expressions actuelles n'acceptent que `"cities"` : sans ce changement, les nouvelles migrations des trois outils ne sont plus lues.
- `integration/declarer-schema.mjs` : écarter `__drizzle_migrations` et `schema_migrations` dans la requête `PG_TABLES` (sinon Codex déclare 23 tables au lieu de 22, Keystone 204, Vigie 37, Cursus 29).
- `outils/collecteur.mjs` : lire la liste `SENSITIVE` dans `droits.colonnes_sensibles` une fois le serveur en service ; retirer `CURSUS_FK` pour Cursus dès que ses clés sont déclarées (`enrich()` les ignore déjà quand une clé existe).
- Schéma `matrix` : tables de Matrix (`docs/proposition.md`, § 4) créées par les migrations de Matrix, avec le migrateur du § 4.3 (`DB_SCHEMA = 'matrix'`).

## 12. Risques

| Risque | Effet | Parade |
|---|---|---|
| `migrate()` de Drizzle utilisé par erreur | Démarrage impossible (`permission denied for database epc2i`). | Migrateur commun (§ 4.3) ; message dans le dépannage du socle. |
| Courses entre transactions avec un pool | Erreurs de clé unique, numéros en double, mises à jour perdues (constatés dans les quatre outils). | Verrou d'écriture par outil, verrou d'actions de Cursus ; références de Vigie calculées dans la transaction. |
| `DATABASE_URL` connue au build | `next build` migre ou interroge le serveur. | Garde `NEXT_PHASE` ; variable d'exécution seulement. |
| Application Mac ou tests branchés sur le serveur | Écritures de développement dans la base commune. | `DATABASE_URL` vide dans les applications Mac et dans `vitest`. |
| Ancienne base PGlite ouverte par le nouveau code | Données invisibles sans avertissement. | Garde-fou dans le module d'ouverture ; `db:reset` ou reprise. |
| Colonne sensible nouvelle ou renommée hors liste | Lisible par Matrix dès sa création (nouvelle) ; table fermée (renommée). | Mettre la liste à jour avant la migration ; signalement des nouvelles colonnes par Matrix. |
| Défaut du déclencheur d'événement | Toute migration échoue. | 68 cas essayés ; désactivation d'urgence documentée ; `droits.verifier()`. |
| Version : serveur 16, PGlite 18.3 | Une fonction de PostgreSQL 17 ou 18 passerait en développement et échouerait sur le serveur ; les exports de PGlite contiennent `SET transaction_timeout`. | Intégration continue sur PostgreSQL 16 ; retrait de la ligne ; question P-01. |
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
| Keystone | 3 à 3,5 | Jusqu'à 4,5 avec la revue fine des 65 calculs « plus grand + 1 ». Hors socle : remplissage « référence » pour la production (1 à 2), reprise d'une base (0,5). |
| Codex | 2,5 à 3 | Dont 0,5 pour le verrou d'écriture et le pool à 10, transposés de Keystone. Reprise : +0,5. |
| Vigie | 3 à 4 | Dont 0,5 pour les 10 calculs de référence. Reprise : +0,5. |
| Cursus | 7 (6 à 8) | Environ 5 en partant du prototype. Script inverse de retour arrière : +0,5 s'il est exigé. |
| Matrix : collecteur, déclaration, lecture du serveur | 1 à 1,5 | |
| **Total** | **17,5 à 20** | Hors reprises, hors remplissage « référence » de Keystone, hors D06. |
| D06 et D07 : échanges RH | 19,5 | Chiffrage de `docs/remplacement-lucca.md` (§ 5.5), plus les prérequis D01, D02 et D14. À faire après la couche asynchrone de Cursus. |

## 14. Questions ouvertes

| N° | Question |
|---|---|
| P-01 | Version du serveur : PostgreSQL 16 est imposé, PGlite 0.5.8 embarque PostgreSQL 18.3. Garder 16, avec l'intégration continue sur 16 comme garde-fou, ou passer le serveur en 17 ou 18 pour avoir le même moteur partout ? |
| P-02 | Keystone : le responsable produit accepte-t-il la migration de base unique, en exception à `CLAUDE.md:45` ? Les anciennes migrations ne passent pas sur le serveur. |
| P-03 | Des saisies réelles sont-elles à garder dans une instance Coolify (`/data` de Keystone, Codex, Vigie ; `/data/cursus.db` de Cursus) ou dans une application Mac ? Sans réponse, chaque outil repart de sa démonstration, sauf Cursus dont la base est reprise. |
| P-04 | Confirmez-vous l'exclusion de `cursus.journal.payload`, `cursus.journal.message` et `cursus.demandes_collab.label` ? Faut-il aussi exclure `employes.reprise_date` et les entretiens de type `reprise`, qui révèlent une absence longue (avis RH ou DPO) ? |
| P-05 | Faut-il exclure des colonnes confidentielles de Keystone (`rate_roles.base_rate_eur`, `job_title_rates.rate_eur`, prix fournisseurs de `catalogue` et `purchasing`) ? |
| P-06 | Réseau : les cinq outils seront-ils sur le même serveur Coolify (réseau Docker, sans TLS) ? Sinon, quel certificat, et PgBouncer est-il prévu ? |
| P-07 | Qui détient le mot de passe du superutilisateur `postgres`, et qui reçoit un rôle d'administrateur nominatif ? |
| P-08 | Sauvegardes : destination hors du serveur, chiffrement, durée de conservation des sauvegardes et des journaux. L'objectif de 15 minutes de Keystone (I-1b) s'applique-t-il à tout le serveur ? Il demande l'archivage continu des journaux de transactions (pgBackRest ou WAL-G), en plus du `pg_dump` nocturne. |
| P-09 | Coolify : à confirmer à la première mise en service, la lecture des montages relatifs (`./init`) depuis le répertoire de base et le nom d'hôte du conteneur vu par les outils. |
| P-10 | D06 : date de la confirmation ou de l'abandon du remplacement de Lucca (M-03), et qui bascule `sourceHeures`. |
| P-11 | Données de démonstration : acceptées sur le serveur de bêta ; en production, faut-il un remplissage « référence » par outil (zones, calendriers, utilisateurs pour Keystone, registre des types pour Codex, sites pour Vigie) ? |
| P-12 | Tri : faut-il, plus tard, un tri français (collation ICU `fr-FR`) pour les listes affichées ? Il changerait l'ordre actuel, aligné sur PGlite. |
