// Génère docs/doublons-a-trancher.md à partir de data/doublons.json (même source que la maquette).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { groupes } = JSON.parse(readFileSync(join(root, 'data/doublons.json'), 'utf8'));
const APP = { keystone: 'Keystone', codex: 'Codex', cursus: 'Cursus', vigie: 'Vigie', arche: 'Arche', crucible: 'Crucible' };
const NATURE = { doublon: 'Doublon', miroir: 'Miroir', chevauchement: 'Chevauchement', homonyme: 'Homonyme', technique: 'Technique' };
const GRAV = { critique: 'Critique', majeur: 'Majeur', mineur: 'Mineur' };
const cell = s => String(s).replace(/\|/g, '\\|');
const tables = g => g.tables.filter(t => t.table !== '—').map(t => `${APP[t.app]}.\`${t.table}\``).join(', ');

const out = [];
out.push('# Doublons à trancher', '');
out.push('Tables qui décrivent le même objet dans plusieurs outils (Keystone, Codex, Cursus, Vigie), relevées le 15 octobre 2026 ; Arche, d’après sa spécification, et Crucible, d’après sa livraison 1 et sa spécification, le 22 octobre 2026 (groupes D21 et suivants, et compléments des groupes existants).', '');
out.push('**Méthode.**');
out.push('- Les noms et les colonnes de chaque paire de tables de deux outils différents ont été comparés automatiquement (`outils/collecteur.mjs`, fonction `similarTables`).');
out.push('- Chaque groupe a ensuite été vérifié dans le code et dans les jeux de démonstration : qui saisit la donnée, qui la recopie, et si les valeurs se recoupent.', '');
out.push('**Nature du doublon.**');
out.push('- **Doublon** : la même donnée est saisie deux fois.');
out.push('- **Miroir** : copie locale d’une table d’un autre outil, sans synchronisation aujourd’hui.');
out.push('- **Chevauchement** : objets voisins qui se recouvrent en partie.');
out.push('- **Homonyme** : même nom, objets différents.');
out.push('- **Technique** : table de fonctionnement propre à chaque outil.', '');
out.push('**Comment trancher.**');
out.push('- Pour chaque groupe, cochez une option dans la colonne « Décision ». L’option proposée est indiquée.');
out.push('- Vous pouvez aussi choisir les options dans la maquette, écran « Doublons », puis utiliser « Copier mes décisions ».', '');
out.push('## Synthèse', '');
out.push('| | Objet | Nature | Gravité | Tables | Proposé | Décision |');
out.push('|---|---|---|---|---|---|---|');
const box = (g, o) => (g.decision?.option === o.id ? '☑ ' : '☐ ') + o.id;
for (const g of groupes) out.push(`| ${g.id} | ${cell(g.objet)} | ${NATURE[g.nature]} | ${GRAV[g.gravite]} | ${cell(tables(g))} | ${g.recommandation} | ${g.options.map(o => box(g, o)).join(' ')}${g.decision ? ` (${g.decision.statut})` : ''} |`);
out.push('');
for (const g of groupes) {
  out.push(`## ${g.id} · ${g.objet}`, '');
  out.push(`**${NATURE[g.nature]} · ${GRAV[g.gravite]}**`, '');
  out.push(`**Ce que contiennent les tables.** ${g.contenu}`, '');
  out.push('| Outil | Table | Rôle | Contenu |', '|---|---|---|---|');
  for (const t of g.tables) out.push(`| ${APP[t.app]} | ${t.table === '—' ? 'aucune' : '`' + t.table + '`'} | ${cell(t.role)} | ${cell(t.contenu || '')} |`);
  out.push('');
  if (g.champs.length) { out.push('**Colonnes qui se correspondent**', ''); for (const c of g.champs) out.push(`- \`${c}\``); out.push(''); }
  out.push('**Options**', '');
  for (const o of g.options) out.push(`- ${g.decision?.option === o.id ? '☑' : '☐'} **${o.id}. ${o.libelle}**${o.id === g.recommandation ? ' *(proposé)*' : ''} : ${o.effet}`);
  out.push('', `**Pourquoi ${g.recommandation}.** ${g.raison}`, '');
  if (g.decision) out.push(`**Décision ${g.decision.statut} du ${g.decision.le.split('-').reverse().join('/')}.** « ${g.decision.citation} »${g.decision.effet ? " " + g.decision.effet : ""}`, '');
}
writeFileSync(join(root, 'docs/doublons-a-trancher.md'), out.join('\n'));
console.log(`docs/doublons-a-trancher.md · ${groupes.length} groupes`);
