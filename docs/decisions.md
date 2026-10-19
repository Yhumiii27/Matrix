# Journal des décisions

Décisions prises par l'utilisateur, avec ses mots exacts. Une question tranchée ici ne se repose pas. Les questions encore ouvertes sont listées à la fin.

| N° | Date | Question | Décision (citation exacte) | Effet |
|---|---|---|---|---|
| M-01 | 15/10/2026 | Serveur PostgreSQL commun, un schéma par outil ? | « Oui, je valide le format postgreSQL commun avec un schema par outil » | Base `epc2i` ; schémas `keystone`, `codex`, `cursus`, `vigie`, `matrix` ; un rôle par outil, propriétaire de son seul schéma. Plan : `docs/architecture-postgres.md`, socle : `infra/postgres/`. |
| M-02 | 15/10/2026 | Doublons entre outils : quelle table garder ou fusionner ? | Liste « Décisions sur les doublons (20/20) », une option par groupe (texte intégral dans `data/doublons.json`, champ `decision.citation`). | Les 20 options proposées sont retenues : D02, D03 et D04 en option B, les autres en option A. Synthèse ci-dessous ; plan de mise en œuvre : `docs/convergence-des-donnees.md`. |
| M-03 / D06 | 15/10/2026 | Cursus remplace-t-il Lucca pour la saisie des heures ? | « Ce n'est pas certain que Cursus remplace Lucca a ce stade mais prépare tout comme si cela est le cas. » Puis, dans la liste des doublons : « D06 Temps passés : option A ». | Décision **provisoire** : option A du groupe D06 (Cursus fait foi pour la saisie ; Keystone et Vigie reçoivent les heures validées). Tout est préparé (`docs/remplacement-lucca.md`) ; rien n'est retiré de Lucca tant que ce n'est pas confirmé. |
| M-05 | 17/10/2026 | Modifier le code des quatre outils ? Par quoi reprendre le développement ? | Réponse au choix proposé : « Les trois, dans l'ordre » (Matrix seul, puis la déclaration dans les 4 outils, puis la bascule PostgreSQL). | Autorisation de modifier Keystone, Codex, Cursus et Vigie, sur une branche et avec une demande de fusion par outil à valider. |
| P-02 | 18/10/2026 | Vigie et Keystone : leurs migrations publiées écrivent « public » en dur et leurs règles interdisent de les modifier. Comment passer au schéma de l'outil ? | Réponse au choix proposé : « Ne rien réécrire (Recommandé) ». | Les migrations publiées et les fichiers de schéma (`pgTable`) restent intacts. Sur le serveur, le migrateur de l'outil remplace `"public".` par `"<schéma>".` au moment d'appliquer chaque migration, et le pool fixe `search_path=<schéma>`. La base embarquée (démonstration, application Mac, tests) reste dans `public`. Remplace la migration unique régénérée prévue par le plan (§ 5 et § 7 de `docs/architecture-postgres.md`) ; Codex, déjà basculé avec `pgSchema`, n'est pas concerné. |
| P-03 | 18/10/2026 | De vraies saisies sont-elles à garder dans les instances Coolify actuelles de Vigie ou de Keystone ? | Réponse au choix proposé : « Non, on repart de zéro ». | Pas de reprise de données pour Vigie ni pour Keystone : chaque outil démarre sur le serveur commun avec sa démonstration ou ses données de référence. Cursus reste repris depuis son fichier SQLite (§ 8). |

## Doublons : qui fait foi (décisions M-02)

| Objet | Fait foi | Les autres outils |
|---|---|---|
| D01 Personnes (salariés) | Cursus | Keystone, Codex, Vigie gardent une table réduite reliée au matricule ; Keystone garde les personnes externes. |
| D02 Projets | Keystone, codes internes compris | Codex, Vigie, Cursus : miroirs synchronisés, même code. |
| D03 Chantiers | Keystone pour la fiche ; Cursus pour les habilitations exigées | Cursus garde code projet + exigences. |
| D04 Affectations | Keystone | Cursus et Vigie : copies synchronisées. |
| D05 Tâches et heures prévues | Keystone | Cursus lit au moment de la saisie (table `taches` supprimée). |
| D06 Temps passés | Cursus (provisoire, Lucca à confirmer) | Keystone et Vigie reçoivent les heures validées. |
| D07 Absences et congés | Cursus | Keystone garde une copie en lecture. |
| D08 Catalogue des formations | Cursus | Vigie lit le catalogue. |
| D09 Titres détenus | Cursus | Vigie et Keystone lisent. |
| D10 Documents | Codex | Keystone et Vigie référencent l'identifiant Codex ; les documents QHSE de Vigie migrent dans Codex. |
| D11 Registre des types | Codex | Keystone lit `/api/registry`. |
| D12 ECR / ECO | Vigie (tables à créer) | Codex et Keystone : miroirs alimentés par Vigie. |
| D13 NC et HSE de projet | Vigie | Keystone garde ses miroirs. |
| D14 Sites | Matrix | Liste unique publiée aux quatre outils. |
| D15 Organisation | Matrix | Organigramme à niveaux publié aux quatre outils. |
| D16 Clients et fournisseurs | Keystone | Vigie relie ses entreprises extérieures aux fournisseurs. |
| D17 Pays | Matrix | Liste ISO publiée. |
| D18 Journaux d'audit | Chaque outil | Matrix les consulte ensemble. |
| D19 Paramètres, fichiers joints | Chaque outil | Aucun changement. |
| D20 Homonymes | — | Tables toujours nommées avec leur outil. |

## Questions ouvertes

| N° | Question |
|---|---|
| M-03 | Confirmation du remplacement de Lucca par Cursus (aujourd'hui provisoire). |
| M-04 | Qui documente les tables : le service informatique seul, ou un responsable par domaine ? |
| M-06 | Fournisseur d'authentification : même réponse que la question O-02 de Codex. |
