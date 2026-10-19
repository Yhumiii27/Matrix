# Correctifs essayés pour la bascule vers le serveur commun

Ces fichiers sont les correctifs et prototypes écrits et essayés le 15 octobre 2026 dans des copies des dépôts, avant la bascule des outils. Ils sont gardés comme trace des essais ; **aucun n'est à appliquer** aujourd'hui, sauf le prototype de Cursus, encore utile à la sous-étape 8.a.

| Fichier | Dépôt et commit de base | État au 18/10/2026 | Remplacé par |
|---|---|---|---|
| `keystone.diff` | keystone, `9bd597e` | **Obsolète.** Il suivait l'ancien plan (`ksTable` / `pgSchema`, migration de base régénérée), écarté par la décision P-02 (18/10/2026). | Branche `claude/shared-postgres` du dépôt Keystone (demande de fusion Yhumiii27/Keystone#15) : migrations publiées intactes, réécriture `"public".` → `"keystone".` par le migrateur du serveur (`src/server/db/server-schema.ts`, `migrations.ts`), partage par `drizzle/0034_share_prerequisites.sql` et `0035_share.sql`. Plan : `docs/architecture-postgres.md`, § 5. |
| `vigie.diff` | vigie, `b658790` | **Obsolète.** Même raison (`pgSchema`, migration de base régénérée), et `VIGIE_SEED=demo` au lieu de `VIGIE_DEMO=1`. | Branche `claude/bascule-postgres` du dépôt Vigie (demande de fusion Yhumiii27/Vigie#7) : `migrateServer` (`src/db/migrations.ts`), verrous `hashtext('vigie.migrations')` et `hashtext('vigie.ecritures')`, partage par `drizzle/0008_partage_prerequis.sql` et `0009_partage.sql`. Plan : § 7. |
| `codex.diff` | codex, `8abbe38` | **Appliqué** : la bascule de Codex (`pgSchema`, migration de base régénérée, autorisée par son dépôt) est fusionnée dans `main` de Codex, avec la migration `0001_partage`. | `main` du dépôt Codex. Plan : § 6. |
| `cursus-prototype.diff` | cursus, `f70619f` | Prototype de la couche d'accès asynchrone (classe `Db` et adaptateurs, actions et routes en `async`, `server/migrations-pg/0001_init.sql` à l'ancienne forme du schéma, `0002_droits_matrix.sql` devenu inutile, script de reprise, tests sur trois moteurs). Point de départ des sous-étapes 8.a et 8.b. | Rien encore. Le schéma cible n'est pas celui du prototype : c'est `../cursus/schema.sql` (28 tables), à réaligner sur les 46 tables actuelles de Cursus. |

## Écarts connus du prototype de Cursus avec le plan

| Le prototype fait | Le plan demande (§ 8) |
|---|---|
| `openDb()` choisit PostgreSQL dès que `DATABASE_URL` est définie. | `DATABASE_URL` présente et non vide (§ 8.2). |
| Verrou des migrations pris après la création du journal ; verrou d'actions `hashtext('cursus.actions')`. | Verrou avant le journal et clé `hashtext('cursus.ecritures')` (§ 8.3). |
| Script de droits `0002`. | Aucun `GRANT` dans les migrations (§ 8.5). |

## Appliquer le prototype sur une copie

```bash
git clone <dépôt cursus> essai && cd essai
git checkout f70619f
git apply --check /chemin/vers/Matrix/infra/postgres/correctifs/cursus-prototype.diff
git apply /chemin/vers/Matrix/infra/postgres/correctifs/cursus-prototype.diff
```
