// Lecture d'un objet littéral JavaScript sans l'exécuter (écart E-14) : remplace Function() pour la déclaration TABLES de
// Cursus, qui exécutait du code d'un autre dépôt. Seules les données sont acceptées : objets (clés nues ou entre
// guillemets), tableaux, chaînes ('…', "…", `…` sans ${}), nombres, true, false, null, commentaires et virgules finales.
// Tout le reste (appel, variable, opérateur, gabarit avec ${}, propagation …) est refusé avec la ligne en cause.

export function lireLitteral(source) {
  let i = 0;
  const ligne = () => source.slice(0, i).split('\n').length;
  const erreur = quoi => { throw new Error(`objet littéral illisible, ligne ${ligne()} : ${quoi}`); };

  function blancs() {
    for (;;) {
      const c = source[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++;
      else if (c === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i++; }
      else if (c === '/' && source[i + 1] === '*') { const f = source.indexOf('*/', i + 2); if (f < 0) erreur('commentaire non fermé'); i = f + 2; }
      else return;
    }
  }

  function chaine() {
    const q = source[i++];
    let out = '';
    while (i < source.length && source[i] !== q) {
      let c = source[i++];
      if (q === '`' && c === '$' && source[i] === '{') erreur('gabarit avec ${…} refusé');
      if (c === '\n' && q !== '`') erreur('chaîne non fermée');
      if (c === '\\') {
        const e = source[i++];
        c = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[e] ?? e;
        if (e === 'u') { const h = source.slice(i, i + 4); if (!/^[0-9a-fA-F]{4}$/.test(h)) erreur('échappement \\u invalide'); c = String.fromCharCode(parseInt(h, 16)); i += 4; }
      }
      out += c;
    }
    if (source[i] !== q) erreur('chaîne non fermée');
    i++;
    return out;
  }

  function identifiant() {
    const m = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
    if (!m) erreur(`caractère inattendu « ${source[i] ?? 'fin du texte'} »`);
    i += m[0].length;
    return m[0];
  }

  function valeur() {
    blancs();
    const c = source[i];
    if (c === '{') return objet();
    if (c === '[') return tableau();
    if (c === "'" || c === '"' || c === '`') return chaine();
    const n = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(source.slice(i));
    if (n) { i += n[0].length; return Number(n[0]); }
    const id = identifiant();
    if (id === 'true') return true;
    if (id === 'false') return false;
    if (id === 'null') return null;
    return erreur(`valeur « ${id} » refusée : seules les données littérales sont lues`);
  }

  function objet() {
    i++;
    const out = {};
    for (;;) {
      blancs();
      if (source[i] === '}') { i++; return out; }
      if (source.startsWith('...', i)) erreur('propagation (...) refusée');
      const c = source[i];
      const cle = c === "'" || c === '"' ? chaine() : /\d/.test(c) ? String(valeur()) : identifiant();
      blancs();
      if (source[i] !== ':') erreur(`« : » attendu après la clé ${cle}`);
      i++;
      if (cle === '__proto__') erreur('clé __proto__ refusée');
      out[cle] = valeur();
      blancs();
      if (source[i] === ',') { i++; continue; }
      if (source[i] !== '}') erreur('« , » ou « } » attendu');
    }
  }

  function tableau() {
    i++;
    const out = [];
    for (;;) {
      blancs();
      if (source[i] === ']') { i++; return out; }
      out.push(valeur());
      blancs();
      if (source[i] === ',') { i++; continue; }
      if (source[i] !== ']') erreur('« , » ou « ] » attendu');
    }
  }

  const v = valeur();
  blancs();
  if (i < source.length) erreur('texte en trop après l’objet');
  return v;
}
