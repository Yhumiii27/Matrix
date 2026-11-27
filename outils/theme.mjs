// Affichage sombre / clair (Norma 1.0, charte « Thème sombre / clair ») : même convention que les autres outils de la
// suite — préférence par personne dans le cookie atrium-theme (dark | light, un an, tout le site), appliquée par
// l'attribut data-theme de <html>. Le serveur lit le cookie et pose l'attribut au rendu (pas de flash) ; le bouton de
// l'en-tête le change aussitôt dans le navigateur. Équivalent sans TypeScript de norma/charte/ds/theme.ts.

export const THEMES = ['dark', 'light'];
/** Même nom dans tous les outils de la suite (Norma 3.0 : suite renommée Atrium, décision du 27/11/2026). */
export const THEME_COOKIE = 'atrium-theme';
/** Ancien nom (avant le renommage en Atrium), lu seulement si le nouveau est absent, le temps que chaque navigateur
 * repose sa préférence ; jamais écrit. À retirer quand toute la suite aura suivi Norma 3.0. */
export const ANCIEN_THEME_COOKIE = 'epc2i-theme';
export const DEFAULT_THEME = 'dark';

/** Valeur du cookie → thème (toute autre valeur : le thème par défaut, sombre). */
export function themeOf(value) {
  return value === 'light' ? 'light' : DEFAULT_THEME;
}

/** En-tête Set-Cookie côté navigateur (un an, tout le site). */
export function themeCookie(theme) {
  return `${THEME_COOKIE}=${themeOf(theme)}; path=/; max-age=31536000; samesite=lax`;
}

/** Thème demandé par la requête (en-tête Cookie) : cookie atrium-theme, sinon l'ancien epc2i-theme. */
export function themeDeRequete(enteteCookie) {
  let ancien;
  for (const morceau of String(enteteCookie ?? '').split(';')) {
    const i = morceau.indexOf('=');
    if (i <= 0) continue;
    const nom = morceau.slice(0, i).trim();
    if (nom === THEME_COOKIE) return themeOf(morceau.slice(i + 1).trim());
    if (nom === ANCIEN_THEME_COOKIE && ancien === undefined) ancien = morceau.slice(i + 1).trim();
  }
  return ancien === undefined ? DEFAULT_THEME : themeOf(ancien);
}

/** Pose data-theme sur la balise <html> d'une page (la première ; une page sans <html> est rendue telle quelle). */
export function avecTheme(page, theme) {
  return String(page).replace(/<html(?![^>]*\bdata-theme=)([^>]*)>/i, `<html$1 data-theme="${themeOf(theme)}">`);
}
