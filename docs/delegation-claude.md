# Délégation à Claude — administration de l'infrastructure EPC2I

Version du 10/11/2026, validée par Guillaume Garrigue (« Validé », conversation du 10/11/2026). Remplace les règles 2
(validation explicite avant d'agir) et 5 (sauvegarde avant fusion ou migration) des consignes d'infrastructure données
le 22/10/2026 ; les règles 1 (lecture et écriture dans le dépôt d'infrastructure), 3 (interdits) et 4 (boîte aux
lettres `REQUESTS.md`) restent en vigueur. S'applique à toute session Claude qui administre l'infrastructure.

## 1. Ce que Claude fait seul, sans demander

- **GitHub**, sur les sept dépôts (Keystone, Codex, Vigie, Cursus, Arche, Crucible, Matrix) :
  - créer des branches, des commits et des PR ;
  - résoudre les conflits de fusion ;
  - corriger une CI rouge ;
  - fusionner une PR dans `main` quand sa CI est verte et qu'elle n'a pas de conflit.

  Claude peut corriger une PR ouverte par une autre session si elle est en conflit ou rouge. Il ne fusionne pas un
  travail qu'une autre session est en train de mener.
- **Coolify**, sur le projet « Outils PM » :
  - créer, modifier ou retirer des variables d'environnement, y compris les mots de passe, sans jamais les afficher ni
    les écrire dans un dépôt ;
  - redéployer une ressource ;
  - créer et lancer des tâches planifiées ;
  - modifier le stockage et les réglages d'une ressource.
- **Serveur PostgreSQL commun** :
  - rejouer les scripts versionnés de ce dépôt (`infra/postgres/init/`, `infra/postgres/partage/`,
    `infra/postgres/verifier-droits.sql`) ;
  - appliquer les migrations des outils ;
  - créer et modifier des vues, des fonctions, des rôles et des droits ;
  - agir dans Matrix : publications et liens.
- **Sauvegarde avant changement** : avant toute modification du schéma ou toute fusion qui déclenche une migration,
  Claude vérifie qu'une sauvegarde de moins de 24 heures existe, ou en lance une. Il la cite dans son compte rendu.

## 2. Ce que Claude fait seulement après un « validé » explicite

- Supprimer ou vider des données : `DELETE`, `TRUNCATE`, suppression de table, de colonne ou de schéma, même par une
  migration versionnée. C'est le cas du lot 7 de la convergence.
- Restaurer une sauvegarde.
- Changer le mot de passe d'un rôle déjà utilisé par un outil.
- Toute action hors du projet « Outils PM » de Coolify, ou sur un dépôt hors des sept.
- Une décision fonctionnelle ou d'architecture, comme celles de `docs/decisions.md`.

## 3. Ce que Claude ne fait jamais

La règle 3 reste inchangée. Claude ne fait jamais :
- un `DROP DATABASE` ;
- un force-push sur `main` ;
- la suppression d'un dépôt, d'une branche partagée ou d'une ressource Coolify ;
- l'écriture d'un secret dans un fichier commité.

Pour ces actions, il décrit la commande exacte et c'est Guillaume qui l'exécute.

## 4. Compte rendu

Après chaque série d'actions, Claude donne en français un compte rendu court : ce qui a été fait, la sauvegarde
utilisée, ce qui est vérifié, et comment revenir en arrière. Une erreur ou un état inattendu est signalé tout de suite ;
Claude ne le contourne pas.

## 5. Durée

La délégation vaut jusqu'à ce que Guillaume la retire ou la modifie dans la conversation. Toute modification est
reportée ici, avec sa date.
