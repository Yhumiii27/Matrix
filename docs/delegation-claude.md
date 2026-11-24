# Délégation à Claude — administration de l'infrastructure EPC2I

Version du 24/11/2026, alignée sur les règles communes de la suite (`norma/REGLES.md` § 10, Norma 1.0 du 24/11/2026,
qui prévalent). Elle resserre la délégation du 10/11/2026 validée par Guillaume Garrigue (« Validé », conversation du
10/11/2026) sur deux points relevés par l'audit Norma (MX-N06) : la fusion d'une PR se fait quand le propriétaire l'a
demandé, et tout changement sur le serveur commun (droits, rôles, vues, fonctions) attend un « validé ». Les règles 1
(lecture et écriture dans le dépôt d'infrastructure), 3 (interdits) et 4 (boîte aux lettres `REQUESTS.md`) des consignes
du 22/10/2026 restent en vigueur. S'applique à toute session Claude qui administre l'infrastructure.

## 1. Ce que Claude fait seul, sans demander

- **Lire** : les dépôts de la suite, la configuration Coolify, l'état du serveur commun (sonde de Matrix, contrôles en
  lecture seule comme `infra/postgres/verifier-droits.sql`).
- **Développer sur une branche**, dans le dépôt de son outil (Matrix) ou dans un dépôt que le propriétaire l'a autorisé à
  modifier (lancement de la suite, 23/11/2026) : commits, résolution des conflits de fusion, correction d'une CI rouge.
- **Ouvrir une PR**, en brouillon. Claude peut corriger une PR ouverte par une autre session si elle est en conflit ou
  rouge ; il ne reprend pas un travail qu'une autre session est en train de mener.
- **Fusionner une PR dans `main`** quand sa CI est verte, qu'elle n'a pas de conflit **et que le propriétaire a demandé
  la fusion** (pour cette PR ou pour le lot qu'elle porte).
- **Mettre à jour la documentation** de Matrix, et le reste à faire de Matrix tenu dans Norma
  (`reste-a-faire/matrix.json`, REGLES § 3).

## 2. Ce que Claude fait seulement après un « validé » explicite

- **Écrire dans le `REQUESTS.md` d'un autre outil**, après une note détaillée au propriétaire (dépôt, demande, raison,
  conséquence d'un refus).
- **Toucher au serveur PostgreSQL commun** :
  - rejouer les scripts versionnés de ce dépôt (`infra/postgres/init/`, `infra/postgres/partage/`) ;
  - appliquer les migrations des outils ;
  - créer ou modifier des vues, des fonctions, des rôles et des droits ;
  - agir dans Matrix sur le serveur : appliquer ou retirer une publication, décider un lien entre outils.
- **Sauvegarde avant changement** : avant toute modification du schéma ou toute fusion qui déclenche une migration,
  Claude vérifie qu'une sauvegarde de moins de 24 heures existe, ou en lance une. Il la cite dans son compte rendu.
- **Supprimer, vider ou restaurer des données** : `DELETE`, `TRUNCATE`, suppression de table, de colonne ou de schéma,
  même par une migration versionnée (c'est le cas du lot 7 de la convergence) ; restauration d'une sauvegarde.
- **Coolify**, sur le projet « Outils PM » : créer, modifier ou retirer des variables d'environnement (y compris les mots
  de passe, sans jamais les afficher ni les écrire dans un dépôt), redéployer une ressource, créer et lancer des tâches
  planifiées, modifier le stockage et les réglages d'une ressource.
- Changer le mot de passe d'un rôle déjà utilisé par un outil.
- Toute action hors du projet « Outils PM » de Coolify, ou sur un dépôt hors de la suite.
- Une décision fonctionnelle ou d'architecture, comme celles de `docs/decisions.md` ; un ajout hors du cahier des charges
  (REGLES § 3).

## 3. Ce que Claude ne fait jamais

Claude ne fait jamais :
- un `DROP DATABASE` ;
- un force-push sur `main` ;
- l'écriture d'un secret ou d'une donnée personnelle dans un dépôt ;
- le contournement d'un test (test désactivé ou affaibli pour obtenir le vert) ;
- la suppression d'un dépôt, d'une branche partagée ou d'une ressource Coolify.

Pour ces actions, il décrit la commande exacte et c'est Guillaume qui l'exécute.

## 4. Compte rendu

Après chaque série d'actions, Claude donne en français un compte rendu court : ce qui a été fait, la sauvegarde
utilisée, ce qui est vérifié, et comment revenir en arrière. Une erreur ou un état inattendu est signalé tout de suite ;
Claude ne le contourne pas.

## 5. Durée et historique

La délégation vaut jusqu'à ce que Guillaume la retire ou la modifie dans la conversation. Toute modification est
reportée ici, avec sa date. En cas d'écart avec `norma/REGLES.md` § 10, les règles communes prévalent.

- 10/11/2026 : délégation large validée par Guillaume Garrigue (fusion d'une PR verte, Coolify, serveur commun sans
  « validé » préalable hors suppression et restauration).
- 24/11/2026 : alignement sur REGLES § 10 (Norma 1.0) — fusion sur demande du propriétaire ; serveur commun, Coolify et
  `REQUESTS.md` des autres outils après « validé » ; interdits complétés (donnée personnelle, contournement d'un test).
