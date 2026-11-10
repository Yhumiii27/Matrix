# Fiche de mise en service sur le serveur commun

État au 09/11/2026. Cette fiche met en service, dans l'ordre, ce qui est livré dans les dépôts mais pas encore appliqué sur le serveur `epc2i` :

- le déploiement de Matrix : connexion Entra ID, visionneuse et éditeur, glossaire et règles de qualité, publications en `security_barrier` ;
- les demandes D13 et D12 de Vigie, M-21 de Crucible et CX-01 de Codex ;
- les éditeurs M-19 de Vigie et de Codex.

Chaque étape dit qui la fait, où, et comment vérifier.

Conventions de la fiche :
- `psql … -f partage/NN.sql` s'exécute depuis `infra/postgres/` du dépôt Matrix, ou dans le conteneur `postgres`, où ces fichiers sont dans `/opt/epc2i/`.
- « Écran Publications » désigne l'écran de Matrix, bloc « Demandes à traiter ». Un bouton n'y apparaît que lorsque l'objet visé existe sur le serveur.
- Une étape qui échoue s'arrête sans rien changer : corriger, puis la rejouer. Tous les fichiers sont rejouables.

## 0. Avant de commencer

| | Action | Vérification |
|---|---|---|
| 0.1 | Lancer une sauvegarde : tâche planifiée Coolify du conteneur `postgres`, ou `sh /opt/epc2i/sauvegarde/sauvegarder.sh` à la main. | Un dossier daté du jour dans `/sauvegardes`, un fichier par schéma. |
| 0.2 | Noter l'état du socle : `SELECT gravite, objet, constat FROM droits.verifier() WHERE gravite = 'erreur';` (en `postgres`). | Résultat vide. Sinon, régler ces erreurs avant toute autre étape. |

## 1. Socle PostgreSQL

| | Action | Vérification |
|---|---|---|
| 1.1 | Redéployer le service `postgres` dans Coolify, pour que l'image contienne les derniers `init/` et `partage/`. | Le conteneur redémarre sans erreur. |
| 1.2 | Rejouer le socle (`infra/postgres/README.md`, « Rejouer le socle ») : `docker compose exec postgres sh -c 'for f in /docker-entrypoint-initdb.d/*.sql; do psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$f" \|\| exit 1; done'`. Il pose `droits.accorder_execution`, indispensable aux liens d'écriture (D13, D12, M-19). | `SELECT to_regprocedure('droits.accorder_execution(text,text)') IS NOT NULL;` renvoie `t`. |

## 2. Migrations des outils

Chaque outil applique ses migrations au démarrage, ou par `npm run db:migrate` pour Keystone. Redéployer, dans Coolify :

| | Outil | Migrations attendues | Ce qu'elles apportent | Vérification (en `postgres`) |
|---|---|---|---|---|
| 2.1 | Vigie | jusqu'à `0029_convergence_m02_ecr_eco` | `inbound_requests` et `pub_signaler_avancement_nc` (0026), `pub_editer` (0027), tables ECR / ECO, `pub_creer_demande_modification`, `pub_signaler_avancement_eco` (0029) | `SELECT count(*) FROM vigie.__drizzle_migrations;` est 30 ou plus ; `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE nspname = 'vigie' AND proname LIKE 'pub\_%' ORDER BY 1;` renvoie les quatre fonctions. |
| 2.2 | Codex | jusqu'à `0004_pub_editer` | `codex.pub_editer` (M-19) | `SELECT to_regproc('codex.pub_editer') IS NOT NULL;` |
| 2.3 | Keystone, Cursus, Arche, Crucible | les dernières de leur branche `main` | rien de nouveau requis par cette fiche | démarrage sans erreur |

Un outil qui refuse de migrer l'écrit dans son journal. Le tableau « En cas de problème » d'`infra/postgres/README.md` donne les remèdes connus, `pg_trgm` de Codex compris.

## 3. Fichiers de partage de Matrix

En `matrix_app`, sauf mention contraire (`partage/README.md`, « Fichiers et ordre d'exécution »).

| | Commande | Contenu |
|---|---|---|
| 3.1 | `psql "postgres://matrix_app:…@hôte:5432/epc2i" -v ON_ERROR_STOP=1 -1 -f partage/10-matrix-referentiels.sql` | Rejoué pour la filiale `SMC` « EPC France » et le site `smc` « Saint-Martin-de-Crau » (M-6 de Crucible). |
| 3.2 | Idem avec `12-matrix-liens.sql`, `13-matrix-publications.sql`, `15-matrix-edition.sql` | Registres des liens et des publications, saisies (rejouables, sans effet s'ils sont à jour). |
| 3.3 | Idem avec `16-matrix-historique.sql` | Historique des schémas sur le serveur (`matrix.historique_schemas`). |
| 3.4 | Idem avec `17-matrix-glossaire-qualite.sql` | Glossaire métier et règles de qualité (`matrix.glossaire`, `matrix.regles_qualite`). |
| 3.5 | `20` à `80` avec le rôle de chaque outil, **pas `60`** (« NE PLUS JOUER ») ; pas ceux d'un outil déjà repris par `14-reprise-publications.sql` | Contrôle des prérequis des outils. |
| 3.6 | `psql -h hôte -U postgres -d epc2i -v ON_ERROR_STOP=1 -f partage/90-droits.sql` (sans `-1`) | Convention des liens et droits des lecteurs. |
| 3.7 | `95-matrix-journal-unifie.sql`, `96-matrix-rex-unifie.sql` (en `matrix_app`) | Journal et REX unifiés. |

Vérification : `SELECT to_regclass('matrix.historique_schemas'), to_regclass('matrix.glossaire'), to_regclass('matrix.regles_qualite');` ne renvoie aucun nul, et `droits.verifier()` aucune erreur.

## 4. Inscription de Matrix dans Entra ID

À faire par l'administrateur du tenant (README, « Connexion par Microsoft Entra ID ») :

1. Entra ID › Inscriptions d'applications › Nouvelle inscription « Matrix », comptes de l'annuaire seulement. URI de redirection (Web) : `https://<adresse de Matrix>/auth/retour`.
2. Rôles d'application `Matrix.Administrateur` et `Matrix.Lecture`. Dans Applications d'entreprise › Matrix : « Affectation requise » à Oui, puis affecter les personnes ou les groupes. La DSI reçoit le rôle Administrateur (M-04).
3. Certificats et secrets : créer un secret client. Noter l'ID de l'annuaire, l'ID d'application et le secret.
4. Alertes par e-mail (M-14) : dans Autorisations des API, ajouter Microsoft Graph › permission d'application `Mail.Send`, puis « Accorder le consentement administrateur ». Créer ou choisir la boîte d'envoi (par exemple `matrix@…`). Dans Exchange Online, limiter l'application à cette seule boîte : `New-ApplicationAccessPolicy -AppId <ID d'application> -PolicyScopeGroupId <boîte d'envoi> -AccessRight RestrictAccess -Description "Matrix : alertes"`.

## 5. Déploiement de Matrix

Variables à poser dans Coolify, sur le service Matrix :

| Variable | Valeur |
|---|---|
| `MATRIX_DATABASE_URL` | `postgres://matrix_app:<MATRIX_APP_PASSWORD>@epc2i-postgres:5432/epc2i` (déjà posée si Matrix lit le serveur) |
| `MATRIX_GESTION_DATABASE_URL` | `postgres://matrix_gestion:<MATRIX_GESTION_PASSWORD>@epc2i-postgres:5432/epc2i`. Sans elle, les publications restent en brouillon. |
| `MATRIX_ENTRA_TENANT_ID`, `MATRIX_ENTRA_CLIENT_ID`, `MATRIX_ENTRA_CLIENT_SECRET` | Valeurs de l'étape 4 |
| `MATRIX_PUBLIC_URL` | `https://<adresse de Matrix>`, sans « / » final |
| `MATRIX_SESSION_SECRET` | 32 caractères au moins, aléatoire : `openssl rand -base64 48`, sans « $ » ou avec l'option « littéral » de Coolify |
| `MATRIX_MOT_DE_PASSE` | Gardé pour les scripts (`Authorization: Basic`, rôle administrateur) |
| `MATRIX_ALERTES_DESTINATAIRES` | Adresses de la DSI, séparées par des virgules : active les alertes par e-mail |
| `MATRIX_ALERTES_EXPEDITEUR` | La boîte d'envoi de l'étape 4, point 4 |

Puis redéployer.

| | Vérification |
|---|---|
| 5.1 | Le journal du conteneur affiche « Connexion par Microsoft Entra ID », sans « configuration Entra incomplète ». |
| 5.2 | `/connexion` propose « Se connecter avec Microsoft ». Une personne du rôle Administrateur arrive dans Matrix, son nom et son rôle dans l'en-tête. Une personne du rôle Lecture voit la visionneuse sans bouton d'édition. Un compte sans rôle voit « Accès non autorisé ». |
| 5.3 | `/api/sante` : le champ `historique` indique le serveur commun. Santé › Qualité affiche les 12 règles reprises de `data/regles-qualite.json`. |
| 5.4 | Le journal du conteneur affiche « Alertes par e-mail actives ». Après la première lecture du serveur, `/api/sante` (champ `alertes`) montre `dernierEnvoi` s'il y avait quelque chose à signaler, sans `derniereErreur`. Une erreur 403 signifie que `Mail.Send` ou la stratégie d'Exchange manque. |

## 6. Écran Publications : demandes à traiter

Connecté en Administrateur, dans l'écran « Publications », bloc « Demandes à traiter ». Faire les lignes dans l'ordre (6.1 à 6.11) : chaque lien d'écriture avant la publication qui lit ses demandes.

| | Ligne du bloc | Bouton | Demande | Vérification (en `postgres`) |
|---|---|---|---|---|
| 6.1 | `vigie.pub_signaler_avancement_nc` → `keystone_app` (écriture) | « Autoriser » | Vigie D13 | `SELECT has_function_privilege('keystone_app', 'vigie.pub_signaler_avancement_nc(text, text, text, text, text, text, text, text, text, timestamptz, text, text, text, text)', 'EXECUTE');` renvoie `t` |
| 6.2 | `vigie.pub_demandes_recues` | « Enregistrer en brouillon », puis « Appliquer » | Vigie D13 | `SELECT count(*) FROM vigie.pub_demandes_recues;` répond sans erreur |
| 6.3 | `vigie.pub_demandes_recues` → `keystone_app` (lecture) | « Autoriser » | Vigie D13 | `SELECT has_table_privilege('keystone_app', 'vigie.pub_demandes_recues', 'SELECT');` renvoie `t` |
| 6.4 | `vigie.pub_creer_demande_modification` → `codex_app` (écriture) | « Autoriser » | Vigie D12 | `has_function_privilege('codex_app', 'vigie.pub_creer_demande_modification(text, text, text, text, text, text, text, text, text, timestamptz)', 'EXECUTE')` renvoie `t` |
| 6.5 | `vigie.pub_signaler_avancement_eco` → `keystone_app` (écriture) | « Autoriser » | Vigie D12 | `has_function_privilege('keystone_app', 'vigie.pub_signaler_avancement_eco(text, text, text, text, text, text, text, text, text, timestamptz, text)', 'EXECUTE')` renvoie `t` |
| 6.6 | `vigie.pub_ordres_modification`, `pub_eco_approbations`, `pub_eco_effectivite`, `pub_demandes_modification` | « Enregistrer en brouillon », puis « Appliquer », pour chacune | Vigie D12 | État « Appliquée » ; lecteurs de la convention posés d'office : keystone_app et matrix_app, plus codex_app pour la quatrième |
| 6.7 | `vigie.pub_suspensions_essais` | « Enregistrer en brouillon », puis « Appliquer » | Crucible M-21 | `SELECT count(*) FROM vigie.pub_suspensions_essais;` répond sans erreur |
| 6.8 | `vigie.pub_suspensions_essais` → `crucible_app` (lecture) | « Autoriser » (déjà autorisé par la convention : la ligne peut l'afficher) | Crucible M-21 | `has_table_privilege('crucible_app', 'vigie.pub_suspensions_essais', 'SELECT')` renvoie `t` |
| 6.9 | `vigie.pub_editer` → `matrix_app` (écriture) | « Autoriser » | M-19 | Visionneuse, une table de Vigie : « Modifiable par l'outil (vigie.pub_editer) » |
| 6.10 | `codex.pub_editer` → `matrix_app` (écriture) | « Autoriser » | M-19 | Visionneuse, une table de Codex : « Modifiable par l'outil (codex.pub_editer) » |
| 6.11 | `arche.pub_capex` → `codex_app` (lecture) | « Autoriser » | Codex CX-01 | `SELECT has_table_privilege('codex_app', 'arche.pub_capex', 'SELECT');` renvoie `t`, au plus tard 15 minutes après si `pub_capex` n'est pas encore reprise par Matrix (droit posé par `appliquer-liens.sh`) |

Une publication refusée à l'application passe à l'état « erreur », avec le message de PostgreSQL ou du contrôle du serveur. La vue reste alors telle qu'elle était : il suffit de corriger, puis d'appliquer de nouveau. Si la visionneuse affiche « ne suit pas la convention » sur une fonction `pub_editer`, c'est l'outil qui doit la corriger, pas Matrix.

## 7. Contrôle final

| | Vérification |
|---|---|
| 7.1 | `SELECT gravite, objet, constat FROM droits.verifier() WHERE gravite = 'erreur';` renvoie un résultat vide. |
| 7.2 | `SELECT vue, lecteur, statut, nature FROM matrix.liens WHERE vue LIKE 'vigie.%' OR vue = 'codex.pub_editer' OR (vue, lecteur) = ('arche.pub_capex', 'codex_app') ORDER BY 1, 2;` montre les lignes de l'étape 6 en `autorise`. |
| 7.3 | Toutes les vues `pub_` reprises ou créées par Matrix ont `security_barrier=true` : `SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'v' AND c.relname LIKE 'pub\_%' AND pg_get_userbyid(c.relowner) = 'matrix_gestion' AND NOT coalesce(c.reloptions @> '{security_barrier=true}', false);` renvoie un résultat vide. Une vue appliquée avant le 08/11/2026 le devient au prochain « Appliquer ». |
| 7.4 | Écran Santé de Matrix : liens « appliqués », aucun « à appliquer ». |

## 8. Après la mise en service

Prévenir la session de Matrix : elle passera à FAITE, dans son `REQUESTS.md`, les demandes de Vigie (D13 : lien d'exécution et publication ; D12 : liens d'exécution et publications) de Crucible (M-21) et de Codex (CX-01). Les outils lecteurs peuvent alors activer leur lecture :
- Keystone : avancement des NC et des ECO, état des demandes ;
- Codex : création d'une demande de modification ;
- Crucible : suspensions des moyens d'essai ;
- Codex : miroir des CAPEX d'Arche (aucun redéploiement, la tâche « capex » lit au passage suivant).

Ce qui reste hors de cette fiche :
- Cursus doit corriger ses tests `tests/push.test.ts`, qui échouent en CI ; c'est à faire dans le dépôt Cursus.
- Questions ouvertes : M-03 (Lucca et Cursus), P-06 (TLS pour Power BI).
