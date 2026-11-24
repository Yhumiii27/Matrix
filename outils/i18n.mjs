// Langue de l'interface (Norma § 2 et § 7) : chaînes sources en anglais, traduites en français par ce dictionnaire ;
// le français est la langue par défaut. Préférence par personne dans le cookie matrix-lang (fr | en, un an, tout le
// site), comme ks-lang de Keystone ou arche-lang d'Arche. Le serveur pose <html lang> au rendu ; le sélecteur FR / EN de
// l'en-tête (juste avant le bouton d'affichage sombre / clair) change le cookie et recharge la page.
// Le texte saisi par les personnes et les données (noms de tables, libellés, notes) ne passent jamais par t().

export const LANG_COOKIE = 'matrix-lang';
export const LANGUES = ['fr', 'en'];
export const LANGUE_DEFAUT = 'fr';

export function langOf(value) {
  return value === 'en' ? 'en' : LANGUE_DEFAUT;
}

export function langCookie(lang) {
  return `${LANG_COOKIE}=${langOf(lang)}; path=/; max-age=31536000; samesite=lax`;
}

/** Langue d'une requête d'après son en-tête Cookie (français sans cookie ou valeur inconnue). */
export function langueDeRequete(enteteCookie) {
  for (const morceau of String(enteteCookie || '').split(';')) {
    const i = morceau.indexOf('=');
    if (i > 0 && morceau.slice(0, i).trim() === LANG_COOKIE) return langOf(morceau.slice(i + 1).trim());
  }
  return LANGUE_DEFAUT;
}

/** Pose lang sur la balise <html> d'une page (remplace celui qui y est ; une page sans <html> est rendue telle quelle). */
export function avecLangue(page, lang) {
  const l = langOf(lang);
  return String(page).replace(/<html\b([^>]*)>/i, (_, attrs) => /\slang="[^"]*"/i.test(attrs) ? `<html${attrs.replace(/(\slang=")[^"]*"/i, `$1${l}"`)}>` : `<html${attrs} lang="${l}">`);
}

/** Traduit une chaîne source anglaise ; {nom} est remplacé par vars.nom (valeur insérée telle quelle). */
export function traduire(dico, lang, source, vars) {
  const s = langOf(lang) === 'fr' ? (dico[source] ?? source) : source;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Dictionnaire anglais → français. Une clé = une seule traduction ; toute chaîne t('…') de la page y figure (test). */
export const FR = {
  // Coque : marque, barre latérale, en-tête
  'Main navigation': 'Navigation principale',
  'Data catalogue': 'Référentiel des données',
  'Linked applications': 'Applications reliées',
  'IT department': 'Service informatique',
  'Data administrator': 'Administrateur des données',
  'Search for a table, a column, a flow…': 'Rechercher une table, une colonne, un flux…',
  'Search the catalogue': 'Rechercher dans le catalogue',
  'Date the schemas were last read': 'Date de la dernière lecture des schémas',
  'Schemas read on {date}': 'Schémas lus le {date}',
  'Language': 'Langue',
  'Dark / light display': 'Affichage',
  'Dark display': 'Affichage sombre',
  'Light display': 'Affichage clair',
  'Close': 'Fermer',
  // Coque commune de Norma 2.0 (COQUE.md) : recherche de pages, tiroir, lien d'évitement, sections du fil d'Ariane
  'Main menu': 'Menu principal',
  'Menu': 'Menu',
  'Close menu': 'Fermer le menu',
  'Go to a page…': 'Aller à une page…',
  'No page matches': 'Aucune page ne correspond',
  'Skip to main content': 'Aller au contenu',
  'Catalogue': 'Catalogue',
  'Exchanges': 'Échanges',
  'Monitoring': 'Suivi',
  'Copied: {text}': 'Copié : {text}',
  '{n} group(s) to decide': '{n} groupe(s) à trancher',
  // Écrans (titres et menu)
  'Dashboard': 'Tableau de bord',
  'Home': 'Accueil',
  'Library': 'Bibliothèque',
  'Database library': 'Bibliothèque des bases',
  'Business glossary': 'Glossaire métier',
  'Data viewer': 'Visionneuse des données',
  'Link graph': 'Graphe des liens',
  'Flows between applications': 'Flux entre logiciels',
  'Duplicates': 'Doublons',
  'Duplicates to decide': 'Doublons à trancher',
  'Reference data': 'Référentiels',
  'Published reference data': 'Référentiels publiés',
  'Schema quality': 'Qualité des schémas',
  'Data health': 'Santé des données',
  'Health of tables and links': 'Santé des tables et des liens',
  'Links between tools': 'Liens entre outils',
  'Publications': 'Publications',
  'Tools’ publications': 'Publications des outils',
  'Unified log': 'Journal unifié',
  'Unified log of the tools': 'Journal unifié des outils',
  'Lessons learned': 'Retours d’expérience',
  'Identifier mappings': 'Correspondances d’identifiants',
  'Mappings': 'Correspondances',
  'Administration': 'Administration',
  // Statuts des flux, gravités, natures des doublons
  'Real': 'Réel',
  'Built on both sides': 'Implémenté des deux côtés',
  'Partial': 'Partiel',
  'Only one side is built': 'Un seul côté est construit',
  'Simulated': 'Simulé',
  'Replaced by a local write': 'Remplacé par une écriture locale',
  'Demo copy': 'Copie de démo',
  'Data copied, not synchronised': 'Données recopiées, sans synchronisation',
  'Proposed': 'Proposé',
  'Contract written, nothing built': 'Contrat écrit, rien de construit',
  'Planned': 'Prévu',
  'Announced in the interface': 'Annoncé dans l’interface',
  'Critical': 'Critique',
  'Major': 'Majeur',
  'Minor': 'Mineur',
  'Duplicate': 'Doublon',
  'Mirror': 'Miroir',
  'Overlap': 'Chevauchement',
  'Homonym': 'Homonyme',
  'Technical': 'Technique',
  // Accueil
  'Hello': 'Bonjour',
  '{date} · Here is the state of the EPC2i suite’s databases.': '{date} · Voici l’état des bases de la suite EPC2i.',
  'Open the library': 'Ouvrir la bibliothèque',
  // Panneau latéral des formulaires
  'Save': 'Enregistrer',
  'Cancel': 'Annuler',
  'Document the table': 'Documenter la table',
  'Description': 'Description',
  'Domain': 'Domaine',
  'Data owner': 'Responsable de la donnée',
  'Name or function': 'Nom ou fonction',
  'Note': 'Note',
  'Business rules, precautions, useful links…': 'Règles de gestion, précautions, liens utiles…',
  '{table}: documentation saved': '{table} : documentation enregistrée',
};
