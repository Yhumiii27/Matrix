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
| P-01 | 22/10/2026 | Le socle de `main` est passé en PostgreSQL 18 (lot 11 de Codex) alors que le serveur en service est en 16. Que faire ? | Réponse au choix proposé : « Rester en 16 (Recommandé) ». | Le socle revient à `postgres:16-bookworm`, volume sur `/var/lib/postgresql/data` : un redéploiement garde la base en service. Codex doit retirer la collation `pg_unicode_fast` (18) de sa v2 avant de la déployer. |
| M-07 | 22/10/2026 | Prendre en compte Arche (CAPEX des filiales) : bases liées, sans doublon. | « prends en compte ce nouveau soft Arche qui devra aussi voir ses bases liées et eviter les doublons » | Schéma `arche` et rôle `arche_app` dans le socle ; partage avec Keystone et Matrix ; Arche dans le catalogue, le graphe et les doublons (D21, D22). |
| M-08 / D21 | 22/10/2026 | Filiales et zones du groupe : qui fait foi ? | Réponse au choix proposé : « A · Matrix (Recommandé) ». | Matrix publie les zones, les filiales et leurs sites (`matrix.pub_zones`, `pub_filiales`, `pub_sites` avec la filiale) ; Arche les lit au lieu de créer ses tables `zones`, `subsidiaries`, `sites` ; Keystone relie ses clients au code de la filiale. |
| M-09 / D22 | 22/10/2026 | Retours d'expérience : un registre ou deux ? | Réponse au choix proposé : « A · Deux registres (Recommandé) ». | Arche garde le REX des CAPEX, Keystone celui des projets ; chacun publie une vue `pub_rex`, que Matrix réunit (comme le journal unifié). |
| M-10 | 22/10/2026 | Ajouter Crucible (moyens d'essais R&D partagés) au socle, comme Arche. | Autorisation de modifier Matrix donnée par le responsable produit dans la session de Crucible (demandes M-1 à M-6 de Crucible). | Schéma `crucible` et rôle `crucible_app` dans le socle ; `partage/80-crucible.sql` (`pub_journal`) ; lecteurs dans `partage/90-droits.sql` ; Crucible dans le journal unifié, le catalogue, le graphe et les flux F22 à F26. Sites du laboratoire 67 et du PDE en attente de leur localisation. |
| M-11 | 22/10/2026 | Prendre en compte Crucible comme Arche : bases liées et doublons. | « prends en compte Crucible comme Arche, bases liées et doublons » | Doublons de Crucible relevés : compléments de D01, D02, D07 à D09, D14, D18 à D21 (application des décisions déjà prises), groupe nouveau D23 ; `matrix.pub_filiales` accordée à Crucible (D21) ; flux F27. |
| M-12 / D23 | 22/10/2026 | Contrôles périodiques des moyens d'essai : qui fait foi ? | Réponse au choix proposé : « A · Vigie (Recommandé) ». | Vigie fait foi et publie `vigie.pub_controles` (code d'équipement commun, V-1 de Crucible) et `pub_suspensions_essais` (V-2), accordées à `crucible_app` ; Crucible en déduit l'indisponibilité d'un moyen et ne saisit que la maintenance, les pannes et les travaux. |

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
| D14 Sites | Matrix | Liste unique publiée aux outils, sites des filiales compris (D21). |
| D15 Organisation | Matrix | Organigramme à niveaux publié aux quatre outils. |
| D16 Clients et fournisseurs | Keystone | Vigie relie ses entreprises extérieures aux fournisseurs. |
| D17 Pays | Matrix | Liste ISO publiée. |
| D18 Journaux d'audit | Chaque outil | Matrix les consulte ensemble. |
| D19 Paramètres, fichiers joints | Chaque outil | Aucun changement. |
| D20 Homonymes | — | Tables toujours nommées avec leur outil. |
| D21 Filiales et zones du groupe | Matrix | Arche les lit ; Keystone relie ses clients à la filiale. |
| D22 Retours d'expérience | Arche (CAPEX) et Keystone (projets) | Une vue `pub_rex` chacun, au contrat commun validé le 23/10/2026 (`docs/architecture-postgres.md`, § 8 quater), réunies par Matrix. |
| D23 Contrôles périodiques des moyens d'essai | Vigie | Crucible lit `vigie.pub_controles` et ne saisit que la maintenance, les pannes et les travaux. |

## Questions ouvertes

| N° | Question |
|---|---|
| M-03 | Confirmation du remplacement de Lucca par Cursus (aujourd'hui provisoire). |
| M-04 | Qui documente les tables : le service informatique seul, ou un responsable par domaine ? |
| M-06 | Fournisseur d'authentification : même réponse que la question O-02 de Codex. |
