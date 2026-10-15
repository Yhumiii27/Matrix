# Correctifs essayés pour la bascule vers le serveur commun

Ces fichiers sont les correctifs et prototypes que cite `docs/architecture-postgres.md` (§ 5 à 8). Ils ont été écrits et essayés le 15 octobre 2026 dans des copies des dépôts. Ils ne sont fusionnés nulle part : la modification du code des outils attend la réponse à la question M-05 (`docs/decisions.md`).

**Le plan fait foi.** Quand le code d'un correctif diffère du plan, c'est le plan qu'il faut appliquer. Les écarts connus sont listés plus bas.

| Fichier | Dépôt et commit de base | Fichiers | Contenu |
|---|---|---|---|
| `keystone.diff` | keystone, `9bd597e` | 40 | `ksTable` sur les 29 fichiers de schéma, `drizzle.config.ts`, `src/server/db/types.ts`, `migrate.ts` (`migrateKeystone`), `open.ts`, `client.ts`, base modèle des tests (`tests/db-template.ts`, `KEYSTONE_TEST_DB_TEMPLATE`, `vitest.config.ts`), `scripts/db-check-pg.ts`, `package.json`. |
| `codex.diff` | codex, `8abbe38` | 17 | `src/db/schema.ts`, `types.ts`, `migrate.ts`, `index.ts`, `seed.ts`, migration de base régénérée, `drizzle.config.ts`, `desktop/CodexApp.swift`, `Dockerfile`, `.env.example`, `README.md`, `CLAUDE.md`, `docs/decisions.md`, `package.json`, `package-lock.json`. |
| `vigie.diff` | vigie, `b658790` | 12 | `src/db/index.ts` (version de l'analyse, dite `vigie-index-propose.ts` dans le plan), `schema.ts`, `seed.ts`, `seeds/types.ts`, migration de base régénérée (les deux anciennes migrations sont retirées), `drizzle.config.ts`, `package.json`, `package-lock.json`. |
| `cursus-prototype.diff` | cursus, `f70619f` | 25 | Prototype de la couche d'accès asynchrone : classe `Db` et adaptateurs (`server/src/db.ts`), actions et routes en `async`, `server/migrations-pg/0001_init.sql` (ancienne forme du schéma), `0002_droits_matrix.sql` (devenu inutile, § 8.5 du plan), script de reprise `server/scripts/sqlite-vers-postgres.ts`, tests sur trois moteurs. |

Le schéma cible de Cursus n'est pas celui du prototype : c'est `../cursus/schema.sql`.

## Appliquer un correctif sur une copie

```bash
git clone <dépôt> essai && cd essai
git checkout <commit de base>
git apply --check /chemin/vers/Matrix/infra/postgres/correctifs/<outil>.diff
git apply /chemin/vers/Matrix/infra/postgres/correctifs/<outil>.diff
```

Les quatre correctifs passent `git apply --check` sur leur commit de base (contrôle du 15/10/2026). Sur un commit plus récent, des conflits sont possibles : le remplacement `pgTable` → table du schéma est mécanique et se refait.

## Écarts avec le plan

| Outil | Le correctif fait | Le plan demande |
|---|---|---|
| Keystone | Clés de verrou constantes ; pas de garde-fou contre une ancienne base PGlite. | Clés dérivées du schéma (`hashtext('keystone.migrations')`, `hashtext('keystone.ecritures')`), garde-fou et message du § 5.2, comptage du remplissage dans la transaction (§ 5.1). |
| Keystone | `createProject` inchangé. | Numéro et code analytique calculés dans la transaction de l'écriture (§ 4.5). |
| Codex | Conforme au § 6 au moment de l'essai. | Message du garde-fou qui nomme le dossier quand `CODEX_DATA_DIR` est fixé (§ 4.6). |
| Vigie | Migrateur propre au serveur, journal créé avant le verrou ; `migrate()` de Drizzle gardé pour PGlite ; pas de verrou d'écriture ; `VIGIE_SEED=demo` ; comptage du remplissage hors transaction ; `nextRef` hors transaction. | Migrateur commun du § 4.3 dans les deux modes, verrou en tête ; verrou d'écriture (§ 4.5) ; `VIGIE_SEED_DEMO=1` ; comptage en première instruction de la transaction du remplissage ; 10 calculs de référence dans la transaction de l'écriture (§ 7.1). |
| Cursus | `openDb()` choisit PostgreSQL dès que `DATABASE_URL` est définie ; verrou des migrations pris après la création du journal ; verrou d'actions `hashtext('cursus.actions')` ; script de droits `0002`. | `DATABASE_URL` présente et non vide (§ 8.2) ; verrou avant le journal et clé `hashtext('cursus.ecritures')` (§ 8.3) ; aucun `GRANT` dans les migrations (§ 8.5). |
