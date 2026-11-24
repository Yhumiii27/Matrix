# Matrix — consignes pour les sessions Claude

@norma/REGLES.md

Les règles ci-dessus sont les règles communes de la suite EPC2I : copie versionnée de Norma (`norma/VERSION`), contrôlée
par `npm run norma:check` ; elles se changent dans le dépôt `Yhumiii27/Norma`, jamais ici. Ce qui suit est propre à Matrix.

- Répondre en français.
- L'administration de l'infrastructure EPC2I (GitHub, Coolify, serveur PostgreSQL commun) suit
  `docs/delegation-claude.md` : ce que Claude fait seul, ce qu'il fait après un « validé », ce qu'il ne fait jamais.
- Reste à faire de Matrix : tenu dans Norma (`reste-a-faire/matrix.json`, page globale
  https://claude.ai/artifact/Rs7kooJdowShdYUqNS8jQf ; REGLES § 3), plus de liste propre à Matrix.
- Interface : chaînes sources anglaises traduites par `outils/i18n.mjs` (`tr('…')` dans `maquette/source.html`, français
  par défaut, cookie `matrix-lang`, sélecteur FR / EN juste avant le bouton d'affichage) ; le texte saisi et les données
  ne passent jamais par `tr()`. Icônes Phosphor par `outils/icones.mjs` ; formulaires dans le panneau latéral
  (`panneau()` de la page) ; listes d'outils par `outils/registre.mjs`.
- Mise en service sur le serveur commun : `docs/mise-en-service.md` ; installation directe sur le serveur interne (sans
  Docker, répétée le 24 novembre 2026) : `docs/installation-directe.md`. Décisions : `docs/decisions.md`.
- Port de Matrix : 3700 (registre de Norma, défaut de `serveur.mjs`) ; l'image Docker garde le port interne 3000.
- Affichage sombre / clair : cookie `epc2i-theme`, attribut `data-theme` posé par `serveur.mjs` (`outils/theme.mjs`) ;
  thème clair dans `maquette/source.html` (`:root[data-theme="light"]`, valeurs de `norma/charte/nocturne.css`).
