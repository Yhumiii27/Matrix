# Journal des décisions

Décisions prises par l'utilisateur, avec ses mots exacts. Une question tranchée ici ne se repose pas. Les questions encore ouvertes sont listées à la fin.

| N° | Date | Question | Décision (citation exacte) | Effet |
|---|---|---|---|---|
| M-01 | 15/10/2026 | Serveur PostgreSQL commun, un schéma par outil ? | « Oui, je valide le format postgreSQL commun avec un schema par outil » | Base `epc2i` ; schémas `keystone`, `codex`, `cursus`, `vigie`, `matrix` ; un rôle par outil, propriétaire de son seul schéma. Plan : `docs/architecture-postgres.md`, socle : `infra/postgres/`. |
| M-03 / D06 | 15/10/2026 | Cursus remplace-t-il Lucca pour la saisie des heures ? | « Ce n'est pas certain que Cursus remplace Lucca a ce stade mais prépare tout comme si cela est le cas. » | Décision **provisoire** : option A du groupe D06 (Cursus fait foi pour la saisie ; Keystone et Vigie reçoivent les heures validées). Tout est préparé (`docs/remplacement-lucca.md`) ; rien n'est retiré de Lucca tant que ce n'est pas confirmé. |

## Questions ouvertes

| N° | Question |
|---|---|
| M-02 | Décisions sur les 19 autres groupes de doublons (`docs/doublons-a-trancher.md`), en commençant par D01 personnes, D02 projets et D10 documents. |
| M-03 | Confirmation du remplacement de Lucca par Cursus (aujourd'hui provisoire). |
| M-04 | Qui documente les tables : le service informatique seul, ou un responsable par domaine ? |
| M-05 | Autorisation de modifier le code des quatre outils (Keystone, Codex, Cursus, Vigie), sur une branche et avec une demande de fusion par outil à valider. |
| M-06 | Fournisseur d'authentification : même réponse que la question O-02 de Codex. |
