// Recherche plein texte dans le catalogue (écart E-13, docs/proposition.md § 6). Module pur : testé à part
// (test/recherche.test.mjs) et recopié dans la page par outils/page.mjs (les « export » y sont retirés).
//
// Une fiche réunit ce qu'on sait d'une table : nom, domaine, description (code, base ou Matrix), documentation saisie
// dans Matrix (description, note, responsable), colonnes et leurs commentaires, flux qui la lisent ou l'alimentent.
// La requête est découpée en termes (sans accents ni majuscules ; « … » garde une expression entière) ; une table
// n'est trouvée que si chaque terme y figure quelque part. Le score favorise le nom de la table, puis le nom d'une
// colonne, puis les textes ; à score égal, la table la plus lue sur le serveur commun passe devant.

export function normaliser(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Termes d'une requête : mots, ou expressions entre guillemets ; sans doublon. */
export function termes(requete) {
  const out = [];
  for (const m of normaliser(requete).matchAll(/"([^"]+)"|«\s*([^»]+?)\s*»|(\S+)/g)) {
    const t = (m[1] ?? m[2] ?? m[3]).trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

// Poids d'un terme trouvé dans chaque champ (le meilleur champ compte pour le terme).
const POIDS = [
  ['nomExact', 100], ['nom', 40], ['colonneExacte', 30], ['colonne', 15], ['description', 10], ['documentation', 10],
  ['commentaireColonne', 6], ['domaine', 5], ['flux', 4],
];

/**
 * Score d'une fiche pour des termes : null si un terme n'y figure nulle part ; sinon { score, raisons } (raisons : où
 * chaque terme a été trouvé, pour l'afficher sous le nom de la table).
 */
export function noter(fiche, liste) {
  if (!liste.length) return { score: 0, raisons: [] };
  const nom = normaliser(fiche.nom);
  const colonnes = (fiche.colonnes ?? []).map(c => ({ nom: normaliser(c.nom), brut: c.nom, commentaire: normaliser(c.description) }));
  const textes = {
    description: normaliser(fiche.description),
    documentation: normaliser([fiche.documentation?.description, fiche.documentation?.note, fiche.documentation?.responsable].filter(Boolean).join(' ')),
    domaine: normaliser(fiche.domaine),
    flux: normaliser((fiche.flux ?? []).join(' ')),
  };
  let score = 0;
  const raisons = [];
  for (const t of liste) {
    let meilleur = null;
    const essai = (champ, ok, detail) => {
      if (!ok) return;
      const p = POIDS.find(x => x[0] === champ)[1];
      if (!meilleur || p > meilleur.p) meilleur = { p, champ, detail };
    };
    essai('nomExact', nom === t);
    essai('nom', nom.includes(t));
    const ce = colonnes.find(c => c.nom === t), cc = colonnes.find(c => c.nom.includes(t)), cm = colonnes.find(c => c.commentaire.includes(t));
    essai('colonneExacte', ce, ce?.brut);
    essai('colonne', cc, cc?.brut);
    essai('commentaireColonne', cm, cm?.brut);
    for (const champ of ['description', 'documentation', 'domaine', 'flux']) essai(champ, textes[champ].includes(t));
    if (!meilleur) return null;
    score += meilleur.p;
    const r = meilleur.champ.startsWith('colonne') || meilleur.champ === 'commentaireColonne'
      ? `${meilleur.champ === 'commentaireColonne' ? 'commentaire de ' : ''}colonne ${meilleur.detail}` : { nomExact: 'nom', nom: 'nom', description: 'description', documentation: 'documentation', domaine: 'domaine', flux: 'flux' }[meilleur.champ];
    if (!raisons.includes(r)) raisons.push(r);
  }
  return { score, raisons };
}

/**
 * Cherche dans une liste de fiches ({ cle, …, lectures }) : renvoie les fiches trouvées, triées par score puis par
 * lectures (seq_scan + idx_scan lus par la sonde), avec leurs raisons.
 */
export function chercher(fiches, requete) {
  const liste = termes(requete);
  const out = [];
  for (const f of fiches) {
    const n = noter(f, liste);
    if (n) out.push({ cle: f.cle, score: n.score, raisons: n.raisons, lectures: f.lectures ?? 0 });
  }
  return out.sort((a, b) => b.score - a.score || b.lectures - a.lectures || String(a.cle).localeCompare(String(b.cle)));
}
