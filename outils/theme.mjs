// Affichage sombre / clair (Norma 1.0, charte « Thème sombre / clair ») : même convention que les autres outils de la
// suite — préférence par personne dans le cookie epc2i-theme (dark | light, un an, tout le site), appliquée par
// l'attribut data-theme de <html>. Le serveur lit le cookie et pose l'attribut au rendu (pas de flash) ; le bouton de
// l'en-tête le change aussitôt dans le navigateur. Équivalent sans TypeScript de norma/charte/ds/theme.ts.

export const THEMES = ['dark', 'light'];
/** Même nom dans tous les outils de la suite. */
export const THEME_COOKIE = 'epc2i-theme';
export const DEFAULT_THEME = 'dark';

/** Valeur du cookie → thème (toute autre valeur : le thème par défaut, sombre). */
export function themeOf(value) {
  return value === 'light' ? 'light' : DEFAULT_THEME;
}

/** En-tête Set-Cookie côté navigateur (un an, tout le site). */
export function themeCookie(theme) {
  return `${THEME_COOKIE}=${themeOf(theme)}; path=/; max-age=31536000; samesite=lax`;
}

/** Thème demandé par la requête (en-tête Cookie). */
export function themeDeRequete(enteteCookie) {
  for (const morceau of String(enteteCookie ?? '').split(';')) {
    const i = morceau.indexOf('=');
    if (i > 0 && morceau.slice(0, i).trim() === THEME_COOKIE) return themeOf(morceau.slice(i + 1).trim());
  }
  return DEFAULT_THEME;
}

/** Pose data-theme sur la balise <html> d'une page (la première ; une page sans <html> est rendue telle quelle). */
export function avecTheme(page, theme) {
  return String(page).replace(/<html(?![^>]*\bdata-theme=)([^>]*)>/i, `<html$1 data-theme="${themeOf(theme)}">`);
}
