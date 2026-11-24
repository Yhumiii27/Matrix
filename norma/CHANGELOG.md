# Norma — journal des versions

## 1.0.3 — 24 novembre 2026

- `dependances.json` : `cytoscape` (graphe des liens de Matrix) et `rolldown` (tests de rendu de Cursus) autorisées.
- `registre/outils.json` : ports de Cursus nommés d'après leur usage (`dev` 3210 = API et serveur, `vite` 5173,
  `app_mac` 3217) au lieu d'un `api: 3217` trompeur.

## 1.0.2 — 24 novembre 2026

- `nocturne.css` : en thème clair, `figcaption`, `.text-muted` et `.card-meta` à 68 % du texte (3,7:1 → 5,2:1, seuil AA) ; relevé par
  l'a11y de Codex (plus de 400 violations en clair).
- `charte/README.md` : contraste en clair (rampe neutre inversée : texte en neutral-400 ou plus foncé).

## 1.0.1 — 24 novembre 2026

- `charte/ds/Segmented.module.css` : une option à icône seule (bouton d'affichage) a la même hauteur qu'une option
  texte (FR / EN) ; constaté par l'alignement d'Arche, qui l'avait compensé localement.

## 1.0.0 — 24 novembre 2026

Première version, à la demande du propriétaire (un dépôt pour le socle commun plutôt qu'une copie par outil).

- `REGLES.md` : règles communes rassemblées depuis les `CLAUDE.md` de Keystone, Arche, Crucible, Clavis, Codex, Vigie,
  Cursus et Matrix (langues, travail dans les dépôts, PostgreSQL commun, échanges M-17 / M-18 / M-19, Clavis, charte,
  dépendances, exploitation, ce que Claude fait seul).
- `charte/` : Nocturne de Keystone `13659c8` (`nocturne.css`, `touch.css`, composants `ds/`, principes), police Inter
  locale de Codex `69e7aec`.
- `registre/outils.json` : les neuf outils (Modulus compris), schémas, rôles, ports, connexion par Clavis.
- `dependances.json` : minimums (Next.js 16.4.6), autorisées, interdites et dérogations (PGlite : Keystone, Codex, Vigie).
- `outils/norma.mjs` : `copier` et `verifier`.
- Thème clair (propriétaire, 24 novembre 2026) : variables `[data-theme="light"]` dans `nocturne.css`, cookie
  `epc2i-theme`, `ds/theme.ts`, bouton `ds/ThemeToggle.tsx` à côté du sélecteur de langue.
- Dépendances de Cursus déclarées (Express, Vite, tests d'interface).
