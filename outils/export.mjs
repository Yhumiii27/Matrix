// Exports du catalogue et API de lecture (écart E-12, docs/proposition.md § 6). Fonctions pures : elles prennent le
// catalogue (data/catalogue.json), l'édition (documentation saisie) et l'état de santé (lignage des vues pub_), et
// rendent du texte. serveur.mjs les sert sous /api/export/… et /api/catalogue/… ; aucune donnée des tables n'est lue,
// seulement leur structure.

const OUTILS = ['keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible'];
const NOMS = { keystone: 'Keystone', codex: 'Codex', cursus: 'Cursus', vigie: 'Vigie', arche: 'Arche', crucible: 'Crucible' };

// Fiches à plat : une par table, documentation de Matrix appliquée, sensibles et vues qui la publient.
export function fiches(catalogue, { edition = null, sante = null, outil = null } = {}) {
  const doc = edition?.documentation ?? {};
  const vues = sante?.vues ?? [];
  const out = [];
  for (const a of catalogue.apps) {
    if (outil && a.id !== outil) continue;
    for (const t of a.tables) {
      const cle = `${a.id}.${t.name}`, d = doc[cle] ?? {};
      const sens = new Set(t.sensitive ?? []);
      out.push({
        outil: a.id, table: t.name, cle,
        domaine: d.domaine ?? t.domain ?? null, description: d.description ?? t.description ?? null,
        responsable: d.responsable ?? null, note: d.note ?? null,
        cle_primaire: t.pk ?? [], unicites: t.uniques ?? [],
        colonnes: t.columns.map(c => ({ nom: c.name, type: c.type ?? null, obligatoire: c.nullable === false, sensible: sens.has(c.name),
          description: c.description ?? null, reference: (t.fks ?? []).find(f => f.columns.includes(c.name)) ?? null })),
        liens: (t.fks ?? []).map(f => ({ colonnes: f.columns, table: f.table, colonnes_cibles: f.refColumns ?? [], declare: f.declared !== false })),
        publiee_par: vues.filter(v => (v.sources ?? []).some(s => s.startsWith(cle + '.'))).map(v => ({ vue: v.vue, lecteurs: (v.lecteurs ?? []).filter(l => /_app$/.test(l)),
          colonnes: (v.lignage ?? []).filter(c => c.sources.some(s => s.table === cle)).map(c => ({ colonne: c.colonne, genre: c.genre, sources: c.sources.filter(s => s.table === cle).map(s => s.colonne) })) })),
        nouvelle: Boolean(t.nouvelle),
      });
    }
  }
  return out;
}

// ── CSV (séparateur « ; » et BOM UTF-8 : s'ouvre tel quel dans Excel en français) ──
const cellule = v => {
  const s = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
  return /[;"\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s;
};
const csv = (entetes, lignes) => '﻿' + [entetes, ...lignes].map(l => l.map(cellule).join(';')).join('\r\n') + '\r\n';

export function csvTables(liste) {
  return csv(['outil', 'table', 'domaine', 'description', 'colonnes', 'cle_primaire', 'liens', 'colonnes_sensibles', 'responsable', 'publiee_par', 'a_documenter'],
    liste.map(f => [NOMS[f.outil] ?? f.outil, f.table, f.domaine, f.description, f.colonnes.length, f.cle_primaire, f.liens.length,
      f.colonnes.filter(c => c.sensible).map(c => c.nom), f.responsable, f.publiee_par.map(v => v.vue), f.nouvelle ? 'oui' : '']));
}

export function csvColonnes(liste) {
  return csv(['outil', 'table', 'colonne', 'type', 'obligatoire', 'cle_primaire', 'reference', 'sensible', 'description'],
    liste.flatMap(f => f.colonnes.map(c => [NOMS[f.outil] ?? f.outil, f.table, c.nom, c.type, c.obligatoire ? 'oui' : 'non',
      f.cle_primaire.includes(c.nom) ? 'oui' : '', c.reference ? `${c.reference.table}.${(c.reference.refColumns ?? []).join(',')}` : '',
      c.sensible ? 'oui' : '', c.description])));
}

// ── Dictionnaire de données (HTML autonome, imprimable en PDF depuis le navigateur) ──
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GENRE = { directe: 'telle quelle', transformee: 'transformée', calculee: 'calculée' };

export function dictionnaireHtml(liste, { titre = 'Dictionnaire des données', genereLe = new Date().toISOString() } = {}) {
  const parOutil = OUTILS.map(o => [o, liste.filter(f => f.outil === o)]).filter(([, l]) => l.length);
  const date = new Date(genereLe).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const table = f => `<section class="table" id="${h(f.cle)}"><h3>${h(f.table)} <small>${h(f.domaine ?? '')}</small></h3>
    ${f.description ? `<p>${h(f.description)}</p>` : '<p class="vide">Pas encore de description.</p>'}
    ${f.responsable || f.note ? `<p class="meta">${f.responsable ? `Responsable : ${h(f.responsable)}. ` : ''}${h(f.note ?? '')}</p>` : ''}
    <table><thead><tr><th>Colonne</th><th>Type</th><th>Oblig.</th><th>Référence</th><th>Description</th></tr></thead><tbody>
    ${f.colonnes.map(c => `<tr><td class="mono">${h(c.nom)}${f.cle_primaire.includes(c.nom) ? ' <b>clé</b>' : ''}${c.sensible ? ' <i>sensible</i>' : ''}</td><td class="mono">${h(c.type)}</td><td>${c.obligatoire ? 'oui' : ''}</td>
      <td class="mono">${c.reference ? `${h(c.reference.table)}.${h((c.reference.refColumns ?? []).join(', '))}` : ''}</td><td>${h(c.description ?? '')}</td></tr>`).join('')}</tbody></table>
    ${f.publiee_par.length ? `<p class="meta">Publiée par ${f.publiee_par.map(v => `<span class="mono">${h(v.vue)}</span> (lue par ${h(v.lecteurs.join(', ') || 'aucun outil')}${v.colonnes.length ? ' : ' + v.colonnes.map(c => `${h(c.sources.join(' + '))} → ${h(c.colonne)}, ${GENRE[c.genre]}`).join(' ; ') : ''})`).join(' ; ')}.</p>` : ''}
    </section>`;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${h(titre)}</title>
<style>
body { font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1c1c22; margin: 32px auto; max-width: 1080px; padding: 0 16px; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 32px 0 8px; border-bottom: 2px solid #5b4bdb; padding-bottom: 4px; }
h3 { font-size: 15px; margin: 22px 0 4px; font-family: ui-monospace, Menlo, monospace; } h3 small { font: 12px system-ui, sans-serif; color: #666; }
table { border-collapse: collapse; width: 100%; margin: 6px 0; } th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #ddd; vertical-align: top; }
th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #555; } .mono { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
b { color: #5b4bdb; font-size: 10px; } i { color: #b3261e; font-size: 10px; font-style: normal; } .meta, .vide { color: #555; } .sommaire { columns: 3; font-size: 12px; }
@media print { body { margin: 0; max-width: none; } h2 { break-before: page; } .table { break-inside: avoid-page; } a { color: inherit; text-decoration: none; } }
</style></head><body>
<h1>${h(titre)}</h1><p class="meta">Généré par Matrix le ${h(date)} · ${liste.length} table(s) · ${liste.reduce((n, f) => n + f.colonnes.length, 0)} colonne(s). Structure seulement : aucune donnée des tables. Pour un PDF : Fichier › Imprimer › Enregistrer au format PDF.</p>
${parOutil.map(([o, l]) => `<h2>${h(NOMS[o])} <small>(${l.length} tables)</small></h2>
<div class="sommaire">${l.map(f => `<div><a href="#${h(f.cle)}">${h(f.table)}</a></div>`).join('')}</div>
${l.map(table).join('\n')}`).join('\n')}
</body></html>
`;
}

// ── Diagramme entité-relation (Mermaid erDiagram) : s'affiche dans GitHub, les wikis, mermaid.live ──
const ident = s => String(s).replace(/[^A-Za-z0-9_]/g, '_');
const typeMermaid = t => (String(t ?? 'inconnu').split('(')[0].trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '') || 'inconnu');

export function diagrammeMermaid(liste) {
  const noms = new Set(liste.map(f => f.table));
  const lignes = ['erDiagram'];
  for (const f of liste) {
    lignes.push(`  ${ident(f.table)} {`);
    for (const c of f.colonnes) {
      const marques = [f.cle_primaire.includes(c.nom) && 'PK', c.reference && 'FK'].filter(Boolean).join(',');
      lignes.push(`    ${typeMermaid(c.type)} ${ident(c.nom)}${marques ? ' ' + marques : ''}`);
    }
    lignes.push('  }');
  }
  for (const f of liste) for (const l of f.liens) {
    if (!noms.has(l.table)) continue;   // table cible hors de l'extrait (autre domaine)
    const obligatoire = l.colonnes.every(n => f.colonnes.find(c => c.nom === n)?.obligatoire);
    lignes.push(`  ${ident(l.table)} ||--o{ ${ident(f.table)} : "${l.colonnes.join(', ').replace(/"/g, '')}${l.declare ? '' : ' (logique)'}${obligatoire ? '' : ' (facultatif)'}"`);
  }
  return lignes.join('\n') + '\n';
}
