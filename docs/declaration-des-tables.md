# Déclaration des tables à Matrix

Ce mécanisme ajoute automatiquement à la bibliothèque de Matrix toute table créée dans Keystone, Codex, Cursus ou Vigie.

## Principe

1. **L'outil déclare son schéma.** Au démarrage, juste après ses migrations, chaque outil lit le schéma réel de sa base (tables, colonnes, clés, liens) et l'envoie à Matrix : `POST /api/declarations`, au format `matrix.schema/1`.
2. **Matrix compare.** Matrix compare cette déclaration à la collecte précédente et inscrit chaque différence dans `data/historique.json` : table ajoutée, table supprimée, colonne ajoutée, colonne supprimée.
3. **La nouvelle table entre dans la bibliothèque.** Elle y figure avec la mention « Nouvelle · à documenter ». Elle apparaît aussi sur l'accueil, dans « Nouvelles tables déclarées ».
4. **Matrix la compare aux tables des autres outils.** Il le fait sur le nom et sur les colonnes. Si elle ressemble à une table existante, elle est signalée comme **doublon possible**, avant que le doublon ne s'installe.
5. **Sans déclaration, Matrix lit le code.** Tant qu'un outil n'envoie rien, Matrix lit son schéma dans le code source : migrations Drizzle pour Keystone, Codex et Vigie, `server/src/db.ts` pour Cursus.

L'envoi ne bloque jamais l'outil. Si Matrix est arrêté ou injoignable, l'outil démarre normalement et écrit un avertissement dans sa console. Une déclaration identique à la précédente, reconnue à son empreinte, est ignorée.

## Ce qui a été vérifié

Le module de lecture du schéma a été exécuté sur les vraies bases :

| Outil | Moteur testé | Résultat |
|---|---|---|
| Keystone | PGlite 0.5.8, 6 migrations | 203 tables, identiques au catalogue (colonnes, clés primaires, liens, unicités) |
| Codex | PGlite 0.5.8 | 22 tables, identiques |
| Vigie | PGlite 0.5.8 | 36 tables, identiques |
| Cursus | node:sqlite (classe `Db` du dépôt) | 28 tables, identiques |

**Essai de bout en bout.** Une table `change_orders` a été ajoutée dans une base Vigie, puis déclarée au serveur Matrix. Résultat :
- la table est ajoutée au catalogue, marquée à documenter ;
- elle est signalée comme doublon possible de `codex.change_requests` : 55 % de colonnes communes ;
- une requête sans jeton est refusée (401) ;
- un second envoi identique est ignoré.

## Mise en place dans chaque outil

Copier `integration/declarer-schema.mjs` dans l'outil, puis ajouter l'appel après les migrations. L'appel n'est pas attendu (`void`), pour ne pas retarder le démarrage.

**Codex** · `src/db/index.ts`, fonction `init()`, après `migrate(...)` :

```ts
import { introspecterPostgres, declarerSchema } from './declarer-schema.mjs';
// …
await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
void introspecterPostgres(sql => client.query(sql).then(r => r.rows))
  .then(tables => declarerSchema({ app: 'codex', version: process.env.APP_VERSION, tables }));
```

**Keystone** · `src/server/db/open.ts`, fonction `openDatabase()`, après `migrate(db, { migrationsFolder })` :

```ts
void introspecterPostgres(sql => client.query(sql).then(r => r.rows))
  .then(tables => declarerSchema({ app: 'keystone', version: process.env.APP_VERSION, tables }));
```

**Vigie** · `src/db/index.ts`, fonction `open()`, après `migrate(...)` (le client PGlite est accessible par `db.$client`) :

```ts
void introspecterPostgres(sql => db.$client.query(sql).then(r => r.rows))
  .then(tables => declarerSchema({ app: 'vigie', version: process.env.APP_VERSION, tables }));
```

**Cursus** · `server/src/index.ts`, après `migrate(db)` :

```ts
import { introspecterSqlite, declarerSchema } from './declarer-schema.mjs';
void declarerSchema({ app: 'cursus', tables: introspecterSqlite(db.sql) });
```

**Variables d'environnement à ajouter** dans chaque outil (Coolify ou `.env`) :

| Variable | Rôle |
|---|---|
| `MATRIX_URL` | Adresse de Matrix, par exemple `http://matrix:3300`. Sans elle, rien n'est envoyé (cas des tests). |
| `MATRIX_TOKEN` | Jeton partagé avec Matrix. |
| `MATRIX_DECLARATIONS_DIR` | Facultatif : écrit aussi la déclaration dans ce dossier (volume partagé, poste sans réseau). |

## Côté Matrix

En attendant l'application Matrix, un serveur minimal reçoit les déclarations :

```bash
MATRIX_TOKEN=… node outils/serveur-declarations.mjs        # écoute sur le port 3300 (MATRIX_PORT)
```

- `POST /api/declarations` : reçoit une déclaration, l'enregistre dans `declarations/<outil>.json` et relance la comparaison.
- `GET /api/declarations` : liste les dernières déclarations reçues (date, empreinte, nombre de tables).

Pour relire les schémas depuis le code des dépôts et reconstruire la maquette :

```bash
node outils/collecteur.mjs ..          # dossier contenant keystone/, codex/, cursus/, vigie/
node outils/construire-maquette.mjs
```

## Format `matrix.schema/1`

```json
{
  "schema": "matrix.schema/1",
  "app": "vigie",
  "version": "1.4.0",
  "declareLe": "2026-10-15T13:12:53.555Z",
  "empreinte": "6dad90c5fc104132",
  "tables": [
    {
      "name": "change_orders",
      "columns": [{ "name": "id", "type": "text", "nullable": false, "pk": true, "default": null }],
      "pk": ["id"],
      "fks": [{ "columns": ["requester_id"], "table": "people", "refColumns": ["id"], "onDelete": "no action", "declared": true }],
      "uniques": []
    }
  ]
}
```

## Ce qui reste à documenter à la main

La déclaration donne la structure. Il reste à compléter pour chaque nouvelle table : le domaine, la description, les données sensibles et les écrans qui l'utilisent. Aujourd'hui, ces informations sont saisies dans `outils/collecteur.mjs` et `data/usages.json` ; dans l'application Matrix, ce sera un formulaire sur la fiche de la table.
