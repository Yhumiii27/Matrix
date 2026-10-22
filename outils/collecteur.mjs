// Collecteur Matrix : construit data/catalogue.json à partir des schémas des six outils.
//
// Deux sources, par ordre de priorité :
//   1. Les déclarations envoyées par les outils au démarrage (declarations/<outil>.json, contrat matrix.schema/1,
//      voir integration/declarer-schema.mjs). C'est le schéma réel de la base en service.
//   2. Le code source des dépôts voisins, en lecture seule :
//      - Keystone, Codex, Vigie : migrations Drizzle (drizzle/*.sql) + commentaires de src/**/schema*.ts
//      - Cursus : objet TABLES de server/src/db.ts (SQLite, pas de clé étrangère déclarée)
//      - Arche : migrations Drizzle dès qu'elles existent ; avant, tables de sa spécification
//        (docs/spec/02-objets.md, livraison 0), marquées « prévu »
//      - Crucible : migrations Drizzle + commentaires de src/server/db/schema/*.ts (tables crucible.table(…))
//
// À chaque passage, le collecteur compare le résultat à la collecte précédente :
//   - une table ou une colonne apparue ou disparue est ajoutée à data/historique.json ;
//   - une nouvelle table est marquée « à documenter » et comparée aux tables des autres outils (doublon possible).
//
// Usage : node outils/collecteur.mjs [dossier contenant keystone/ codex/ cursus/ vigie/ arche/ crucible/]
// Par défaut, le dossier parent du dépôt Matrix.
// Variables : MATRIX_DATA_DIR (défaut data/), MATRIX_DECLARATIONS_DIR (défaut declarations/).

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ORDER = ['keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible'];

// ── Domaines fonctionnels et descriptions ────────────────────────────────

const KEYSTONE_MODULES = {
  organisation: 'Organisation', portfolio: 'Portefeuille', planning: 'Planification', cost: 'Coûts',
  change: 'Changements & lignes de base', control: 'Risques & pilotage', work: 'Tâches & demandes',
  resources: 'Ressources & RH', platform: 'Plateforme', documents: 'Documents (index Codex)',
  contract: 'Contrat & facturation', collaboration: 'Réunions & équipe', operations: 'Essais & mise en service',
  prioritisation: 'Priorisation', suppliers: 'Fournisseurs', catalogue: 'Catalogue articles', plm: 'PLM',
  purchasing: 'Achats', stock: 'Stock', vigie: 'Miroir Vigie', quality: 'Qualité', aftersales: 'SAV',
  site: 'Chantier', cursus: 'Miroir Cursus', client: 'Portail client', engineering: 'Ingénierie',
  settings: 'Paramètres', scheduling: 'Calendriers', files: 'Fichiers & imports',
};

// Crucible : fichier de schéma (src/server/db/schema/<fichier>.ts) → domaine.
const CRUCIBLE_MODULES = { organisation: 'Organisation et droits', platform: 'Plateforme' };

// Codex : intitulés de section du schéma (en anglais) → domaine.
const CODEX_SECTIONS = {
  'Organisation (provisional until the org chart is provided)': 'Organisation',
  'Registry of document types (owned by Codex, read by Keystone)': 'Registre des types',
  'Projects (Keystone) and research programmes': 'Projets & programmes',
  'Documents': 'Documents', 'Approval workflows': 'Circuits de validation',
  'Change requests (owned by Vigie, mirrored here)': 'Demandes de modification',
  'Audit, rights, saved searches': 'Audit & droits',
};

// Cursus : pas de commentaires de schéma, descriptions et domaines saisis ici (clé = nom en base).
const CURSUS_META = {
  formations: ['Référentiels', 'Catalogue des formations'],
  habilitations: ['Référentiels', 'Types d’habilitation et prérequis'],
  destinations: ['Référentiels', 'Règles de voyage par pays (visa, vaccins)'],
  equipes: ['Référentiels', 'Équipes (le nom sert de clé)'],
  projets: ['Données Keystone', 'Codes projet pour les feuilles de temps'],
  chantiers: ['Données Keystone', 'Chantiers Keystone et besoins en habilitations'],
  employes: ['Personnel', 'Fiche salarié (matricule EMP-xxxx dérivé de l’id)'],
  certifications: ['Personnel', 'Formations suivies par salarié'],
  hab_titres: ['Personnel', 'Habilitations délivrées'],
  visas: ['Personnel', 'Visas obtenus'],
  vaccinations: ['Personnel', 'Vaccinations (donnée de santé)'],
  soldes_reprise: ['Temps & congés', 'Soldes repris de l’ancien système'],
  sessions: ['Formation & plan', 'Sessions de formation planifiées'],
  inscriptions: ['Formation & plan', 'Inscriptions aux sessions'],
  plan_actions: ['Formation & plan', 'Lignes du plan de formation'],
  budgets: ['Formation & plan', 'Budget formation par équipe et exercice'],
  voyages: ['Déplacements', 'Voyages'],
  demandes_keystone: ['Déplacements', 'Demandes de déplacement reçues de Keystone'],
  missions: ['Données Keystone', 'Affectations Keystone'],
  taches: ['Données Keystone', 'Tâches Keystone et heures prévues'],
  feuilles: ['Temps & congés', 'Feuilles de temps hebdomadaires'],
  absences: ['Temps & congés', 'Absences CP / RTT / récupération'],
  cet: ['Temps & congés', 'Dépôts sur le compte épargne-temps'],
  reports: ['Temps & congés', 'Reports de congés payés'],
  entretiens: ['Entretiens & demandes', 'Entretiens obligatoires'],
  demandes_collab: ['Entretiens & demandes', 'Demandes des salariés aux RH'],
  settings: ['Système', 'Paramètres clé / valeur'],
  journal: ['Système', 'Journal d’audit et d’intégration'],
};

// Cursus : liens logiques (colonne → table.colonne), appliqués en code et non déclarés en base.
const CURSUS_FK = {
  emp_id: ['employes', 'id'], manager_id: ['employes', 'id'], par_id: ['employes', 'id'],
  f: ['formations', 'id'], h: ['habilitations', 'id'], session_id: ['sessions', 'id'],
  dest: ['destinations', 'code'], equipe: ['equipes', 'nom'], projet: ['projets', 'code'],
  chantier: ['chantiers', 'id'],
};
const CURSUS_FK_BY_TABLE = { sessions: { formation: ['formations', 'id'] } };

// Descriptions saisies quand le schéma n'a pas de commentaire (Codex, Vigie).
const DESCRIPTIONS = {
  codex: {
    audit_log: 'Journal d’audit des actions sur les documents', change_requests: 'Demandes de modification (ECR) et de retrait, miroir de Vigie',
    departments: 'Départements ; le code à 3 lettres entre dans les identifiants', doc_types: 'Registre des 69 types de document (lu par Keystone)',
    documents: 'Fiche maîtresse du document (identifiant TYPE-CONTEXTE-SEQ)', families: 'Familles du registre des types',
    function_holders: 'Titulaires des fonctions d’approbation', project_events: 'Fil d’activité des projets',
    research_programs: 'Programmes de recherche', revisions: 'Révisions A, B… d’un document', role_permissions: 'Matrice rôles × droits',
    saved_searches: 'Recherches enregistrées', sites: 'Sites physiques', workflow_comments: 'Commentaires sur un circuit',
    workflow_steps: 'Étapes d’un circuit de validation', workflows: 'Circuits de validation d’une révision',
  },
  vigie: {
    actions: 'Plan d’actions unique (toutes origines)', audit_findings: 'Constats d’audit', audit_plan_items: 'Programme d’audits',
    certifications: 'Certifications ISO du groupe', consumptions: 'Consommations électricité / gaz / eau', contractors: 'Entreprises extérieures',
    controls: 'Contrôles périodiques réglementaires', document_versions: 'Versions des documents maîtrisés QHSE',
    documents: 'Documents maîtrisés QHSE (procédures, instructions…)', duerp_versions: 'Versions du DUERP',
    events: 'Signalements et événements (AT, presqu’accident, NC…)', map_zones: 'Zones de la carte du site',
    qualification_requirements: 'Titres exigés par personne', qualifications: 'Titres détenus par personne', requirements: 'Exigences de la veille réglementaire',
    review_items: 'Points de la revue de direction', risk_actions: 'Lien risques ↔ actions', risks: 'Risques du DUERP',
    sites: 'Sites (classement Seveso)', training_titles: 'Titres d’habilitation et de formation', waste_streams: 'Flux de déchets',
    work_units: 'Unités de travail du DUERP',
  },
};

// Données sensibles (RGPD) repérées à la main.
const SENSITIVE = {
  'cursus.employes': ['visite', 'passeport_numero', 'passeport_expire', 'naissance', 'reprise_motif'],
  'cursus.vaccinations': ['v', 'date'],
  'cursus.visas': ['type', 'obtenu', 'expire'],
  'cursus.entretiens': ['cr'],
  'vigie.events': ['injury', 'lost_days'],
};

// La liste qui fait foi est celle du socle (droits.colonnes_sensibles, infra/postgres/init/03-droits.sql, origine
// « convention ») : elle remplace la liste ci-dessus quand le fichier est là. « * » ferme la table entière.
const SOCLE_DROITS = join(here, '..', 'infra', 'postgres', 'init', '03-droits.sql');
if (existsSync(SOCLE_DROITS)) {
  const ligne = /\(\s*'(keystone|codex|cursus|vigie|arche|crucible)',\s*'(\w+)',\s*'([\w*]+)',\s*'(?:[^']|'')*',\s*'convention'\)/g;
  const lues = {};
  for (const [, app, table, col] of readFileSync(SOCLE_DROITS, 'utf8').matchAll(ligne)) (lues[`${app}.${table}`] ??= []).push(col);
  if (Object.keys(lues).length) { for (const k of Object.keys(SENSITIVE)) delete SENSITIVE[k]; Object.assign(SENSITIVE, lues); }
}

// ── Lecture des migrations Drizzle ───────────────────────────────────────

function parseDrizzle(dir) {
  const tables = new Map();
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint')) {
      const s = stmt.trim();
      let m;
      if ((m = s.match(/^CREATE TABLE (?:IF NOT EXISTS )?(?:"\w+"\.)?"(\w+)" \(([\s\S]*)\);?$/))) {
        const t = { name: m[1], columns: [], fks: [], uniques: [], pk: [] };
        for (const raw of m[2].split(/,\n/)) {
          const line = raw.trim();
          let c;
          if ((c = line.match(/^CONSTRAINT "\w+" PRIMARY KEY\(([^)]*)\)/))) t.pk = c[1].replace(/"/g, '').split(',');
          else if ((c = line.match(/^CONSTRAINT "\w+" UNIQUE(?: NULLS NOT DISTINCT)?\(([^)]*)\)/))) t.uniques.push(c[1].replace(/"/g, '').split(','));
          else if ((c = line.match(/^"(\w+)" (.+)$/))) t.columns.push(column(c[1], c[2]));
        }
        for (const col of t.columns) if (col.pk) t.pk = [col.name];
        tables.set(t.name, t);
      } else if ((m = s.match(/^ALTER TABLE (?:"\w+"\.)?"(\w+)" ADD COLUMN "(\w+)" (.+?);?$/))) {
        tables.get(m[1])?.columns.push(column(m[2], m[3]));
      } else if ((m = s.match(/^ALTER TABLE (?:"\w+"\.)?"(\w+)" DROP COLUMN "(\w+)"/))) {
        const t = tables.get(m[1]);
        if (t) t.columns = t.columns.filter(c => c.name !== m[2]);
      } else if ((m = s.match(/^ALTER TABLE (?:"\w+"\.)?"(\w+)" ADD CONSTRAINT "\w+" FOREIGN KEY \(([^)]*)\) REFERENCES "\w+"\."(\w+)"\(([^)]*)\) ON DELETE ([a-z ]+?) ON UPDATE/))) {
        tables.get(m[1])?.fks.push({
          columns: m[2].replace(/"/g, '').split(', '), table: m[3], refColumns: m[4].replace(/"/g, '').split(', '),
          onDelete: m[5], declared: true,
        });
      } else if ((m = s.match(/^ALTER TABLE (?:"\w+"\.)?"(\w+)" ADD CONSTRAINT "\w+" UNIQUE(?: NULLS NOT DISTINCT)?\(([^)]*)\)/))) {
        tables.get(m[1])?.uniques.push(m[2].replace(/"/g, '').split(','));
      } else if ((m = s.match(/^ALTER TABLE (?:"\w+"\.)?"(\w+)" RENAME TO "(\w+)"/))) {
        const t = tables.get(m[1]);
        if (t) { tables.delete(m[1]); t.name = m[2]; tables.set(m[2], t); }
      } else if ((m = s.match(/^DROP TABLE (?:IF EXISTS )?(?:"\w+"\.)?"(\w+)"/))) {
        tables.delete(m[1]);
      }
    }
  }
  return [...tables.values()];
}

function column(name, def) {
  const type = def.match(/^([a-z ]+(?:\([\d, ]+\))?(?:\[\])?)/i)?.[1].trim() ?? def;
  return {
    name, type: type.replace(/ PRIMARY KEY| NOT NULL| DEFAULT.*/g, ''),
    nullable: !/NOT NULL/.test(def), pk: /PRIMARY KEY/.test(def),
    default: def.match(/DEFAULT (.+?)(?: NOT NULL|$)/)?.[1] ?? null,
  };
}

// ── Commentaires des fichiers de schéma TypeScript ───────────────────────

function schemaComments(files, declaration = /pgTable\(\s*'(\w+)'/, ouverte = /pgTable\(\s*$/) {
  const info = {};
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    let section = null;
    lines.forEach((line, i) => {
      const sec = line.match(/^\/\/\s*[─—-]{2,}\s*(.+?)\s*[─—-]+\s*$/);
      if (sec) section = sec[1];
      const t = line.match(declaration) ?? (ouverte.test(line) ? lines[i + 1]?.match(/^\s*'(\w+)'/) : null);
      if (!t) return;
      let j = i - 1;
      const doc = [];
      while (j >= 0 && /^\s*(\/\/|\/\*\*|\*|\*\/)/.test(lines[j]) && !/[─]{3,}/.test(lines[j])) doc.unshift(lines[j--]);
      const text = doc.join(' ').replace(/\/\*\*|\*\/|^\s*\*|\/\/|\s\*\s/g, ' ').replace(/\s+/g, ' ').trim();
      info[t[1]] = { section, doc: text || null, file: basename(file, '.ts') };
    });
  }
  return info;
}

// ── Cursus : objet TABLES de db.ts ───────────────────────────────────────

const snake = s => s.replace(/[A-Z]/g, m => '_' + m.toLowerCase());

function parseCursus(file) {
  const src = readFileSync(file, 'utf8');
  const body = src.slice(src.indexOf('export const TABLES = {') + 'export const TABLES = '.length, src.indexOf('} satisfies') + 1);
  const TABLES = Function(`return (${body})`)();
  const TYPE = { text: 'TEXT', int: 'INTEGER', real: 'REAL', bool: 'INTEGER (booléen)', json: 'TEXT (JSON)' };
  return Object.entries(TABLES).map(([key, def]) => ({
    name: snake(key), pk: [snake(def.pk)], fks: [],
    columns: Object.entries(def.cols).map(([c, t]) => ({ name: snake(c), type: TYPE[t], nullable: c !== def.pk, pk: c === def.pk, default: null })),
    uniques: (def.unique ?? []).map(u => u.map(snake)),
  }));
}

// ── Arche : tables de la spécification (avant le premier code) ──────────

// Liens logiques des colonnes de la spécification (colonne → table.colonne), non déclarés en base.
const ARCHE_FK = {
  capex_id: ['capex', 'id'], site_id: ['sites', 'id'], lot_id: ['capex_lots', 'id'], gate_id: ['gates', 'id'],
  dossier_id: ['dossiers', 'id'], dossier_version_id: ['dossier_versions', 'id'], budget_version_id: ['budget_versions', 'id'],
  consultation_id: ['consultations', 'id'], circuit_step_id: ['circuit_steps', 'id'], line_id: ['production_lines', 'id'],
  review_id: ['reviews', 'id'], user_id: ['users', 'id'], sponsor_user_id: ['users', 'id'], lead_user_id: ['users', 'id'],
  owner_user_id: ['users', 'id'], expert_user_id: ['users', 'id'], by_user_id: ['users', 'id'],
  subsidiary_code: ['subsidiaries', 'code'], zone_code: ['zones', 'code'],
};

// Lignes « | `table` | `col`, `col` (`valeur` / …) … | notes | » sous les titres « ## n. Section ».
function parseArcheSpec(file) {
  const tables = [], comments = {};
  let section = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const h = line.match(/^## \d+\. (.+)$/);
    if (h) { section = h[1].trim(); continue; }
    const m = line.match(/^\| `([a-z_]+)` \| (.+?) \| (.*) \|$/);
    if (!m || !section) continue;
    const [, name, cols, notes] = m;
    const names = [...new Set([...cols.replace(/\([^)]*\)/g, '').matchAll(/`([a-z][a-z0-9_]*)`/g)].map(x => x[1]))];
    if (!names.length) continue;
    const type = c => /_at$/.test(c) ? 'timestamptz' : /(_on|_date|^day|^month)$/.test(c) ? 'date'
      : /(_keur|_pct|_eur|_rate_pct|_years)$/.test(c) ? 'numeric' : /^(phasing|flows|content|definition|options)$/.test(c) ? 'jsonb' : 'à préciser';
    const pk = names.includes('id') ? ['id'] : names.includes('code') ? ['code'] : [];
    tables.push({
      name, pk, uniques: [],
      columns: [...names, 'created_at', 'updated_at'].filter((c, i, a) => a.indexOf(c) === i)
        .map(c => ({ name: c, type: c.endsWith('_at') && ['created_at', 'updated_at'].includes(c) ? 'timestamptz' : type(c), nullable: !pk.includes(c), pk: pk.includes(c), default: null })),
      fks: names.filter(c => ARCHE_FK[c] && ARCHE_FK[c][0] !== name)
        .map(c => ({ columns: [c], table: ARCHE_FK[c][0], refColumns: [ARCHE_FK[c][1]], onDelete: null, declared: false })),
    });
    comments[name] = { section, doc: notes.replace(/`/g, '').trim() || null };
  }
  return { tables, comments };
}

// ── Sources ──────────────────────────────────────────────────────────────

function fromRepos(root) {
  const out = {};
  const ks = join(root, 'keystone');
  if (existsSync(join(ks, 'drizzle'))) {
    const dir = join(ks, 'src/server/db/schema');
    const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.ts') && !f.startsWith('_') && f !== 'index.ts').map(f => join(dir, f)) : [];
    out.keystone = { tables: parseDrizzle(join(ks, 'drizzle')), comments: schemaComments(files), source: 'dépôt (migrations Drizzle)' };
  }
  for (const id of ['codex', 'vigie']) {
    const d = join(root, id);
    if (existsSync(join(d, 'drizzle'))) {
      const s = join(d, 'src/db/schema.ts');
      out[id] = { tables: parseDrizzle(join(d, 'drizzle')), comments: existsSync(s) ? schemaComments([s]) : {}, source: 'dépôt (migrations Drizzle)' };
    }
  }
  const ar = join(root, 'arche');
  if (existsSync(join(ar, 'drizzle'))) out.arche = { tables: parseDrizzle(join(ar, 'drizzle')), comments: {}, source: 'dépôt (migrations Drizzle)' };
  else if (existsSync(join(ar, 'docs/spec/02-objets.md'))) {
    const spec = parseArcheSpec(join(ar, 'docs/spec/02-objets.md'));
    out.arche = { ...spec, source: 'spécification (docs/spec/02-objets.md, livraison 0) : tables prévues' };
  }
  const cr = join(root, 'crucible');
  if (existsSync(join(cr, 'drizzle'))) {
    const dir = join(cr, 'src/server/db/schema');
    const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.ts') && !f.startsWith('_') && f !== 'index.ts').map(f => join(dir, f)) : [];
    out.crucible = { tables: parseDrizzle(join(cr, 'drizzle')), comments: schemaComments(files, /crucible\.table\(\s*'(\w+)'/, /crucible\.table\(\s*$/), source: 'dépôt (migrations Drizzle)' };
  }
  const cu = join(root, 'cursus', 'server/src/db.ts');
  if (existsSync(cu)) out.cursus = { tables: parseCursus(cu), comments: {}, source: 'dépôt (server/src/db.ts)' };
  return out;
}

function fromDeclarations(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (doc.schema !== 'matrix.schema/1' || !ORDER.includes(doc.app)) { console.warn(`déclaration ignorée : ${f}`); continue; }
    out[doc.app] = { tables: doc.tables, declareLe: doc.declareLe, empreinte: doc.empreinte, version: doc.version };
  }
  return out;
}

// ── Enrichissement : domaine, description, liens logiques, sensibilité ───

// known : fiches déjà connues (collecte précédente ou catalogue embarqué), pour garder domaine et description
// quand la source (une déclaration, par exemple) ne les porte pas.
function enrich(app, tables, comments, known = new Map()) {
  return tables.map(t => {
    const c = comments[t.name] ?? {};
    const k = known.get(t.name) ?? {};
    let domain, description;
    if (app === 'keystone') { domain = KEYSTONE_MODULES[c.file]; description = c.doc; }
    else if (app === 'codex') { domain = CODEX_SECTIONS[c.section] ?? c.section; description = c.doc ?? DESCRIPTIONS.codex[t.name]; }
    else if (app === 'vigie') { domain = c.section; description = c.doc ?? DESCRIPTIONS.vigie[t.name]; }
    else if (app === 'arche') { domain = c.section; description = c.doc; }
    else if (app === 'crucible') { domain = CRUCIBLE_MODULES[c.file]; description = c.doc; }
    else { [domain, description] = CURSUS_META[t.name] ?? []; }
    const fks = [...t.fks];
    if (app === 'cursus') for (const col of t.columns) {
      const ref = CURSUS_FK_BY_TABLE[t.name]?.[col.name] ?? CURSUS_FK[col.name];
      if (ref && !(ref[0] === t.name && ref[1] === col.name) && !fks.some(f => f.columns.includes(col.name)))
        fks.push({ columns: [col.name], table: ref[0], refColumns: [ref[1]], onDelete: null, declared: false });
    }
    const out = { ...t, fks, domain: domain ?? k.domain ?? 'Nouvelles tables', description: description ?? k.description ?? null };
    delete out.vueLe; delete out.nouvelle; delete out.doublonsPossibles;
    const sens = SENSITIVE[`${app}.${t.name}`];
    if (sens) out.sensitive = sens.includes('*') ? out.columns.map(c => c.name) : sens;
    return out;
  });
}

// ── Doublons possibles (comparaison noms + colonnes) ─────────────────────

const SYN = {
  nom: 'name', full_name: 'name', libelle: 'label', label_fr: 'label', title: 'label', titre: 'label',
  debut: 'start', start_on: 'start', start_date: 'start', du: 'start', fin: 'end', end_on: 'end', end_date: 'end', au: 'end',
  emp_id: 'person', person_id: 'person', user_id: 'person', statut: 'status', state: 'status',
  site_id: 'site', projet: 'project', project_code: 'project', project_id: 'project', chantier: 'project',
  kind: 'type', expire: 'expires', expires_on: 'expires', obtenue: 'obtained', obtained_on: 'obtained', delivree: 'obtained',
  validite: 'validity', validity_months: 'validity', poste: 'job', job_title: 'job', equipe: 'department', department_id: 'department',
  pays: 'country', lieu: 'location', heures: 'hours', motif: 'reason', version: 'revision', letter: 'revision', number: 'code',
};
const IGNORE = new Set(['id', 'created_at', 'updated_at', 'sort', 'sort_order', 'position', 'ordre']);
const normCol = n => SYN[n] ?? n.replace(/_(id|on|at)$/, '');
const stem = s => s.replace(/_/g, '').replace(/(ies)$/, 'y').replace(/s$/, '');

export function similarTables(t, others) {
  const a = new Set(t.columns.map(c => c.name).filter(n => !IGNORE.has(n)).map(normCol));
  const res = [];
  for (const o of others) {
    const b = new Set(o.columns.map(c => c.name).filter(n => !IGNORE.has(n)).map(normCol));
    const common = [...a].filter(x => b.has(x));
    const score = common.length / ((a.size + b.size - common.length) || 1);
    const sameName = stem(t.name) === stem(o.name);
    if (sameName || (score >= 0.3 && common.length >= 3))
      res.push({ app: o.app, table: o.name, score: +score.toFixed(2), memeNom: sameName, colonnes: common });
  }
  return res.sort((x, y) => y.score - x.score).slice(0, 5);
}

// ── Assemblage, comparaison à la collecte précédente ─────────────────────

// fallback : catalogue de secours (celui embarqué dans l'image Docker) pour un outil qui n'a ni déclaration ni dépôt
// lisible ; sans lui, l'outil disparaîtrait du catalogue.
export function collect({ root, dataDir, declDir, fallback = null, now = new Date() }) {
  const repos = root ? fromRepos(root) : {};
  const decls = fromDeclarations(declDir);
  const previousFile = join(dataDir, 'catalogue.json');
  const previous = existsSync(previousFile) ? JSON.parse(readFileSync(previousFile, 'utf8')) : fallback;
  const fallbackApps = Object.fromEntries((fallback?.apps ?? []).map(a => [a.id, a]));
  const prevApps = Object.fromEntries((previous?.apps ?? []).map(a => [a.id, new Map(a.tables.map(t => [t.name, t]))]));
  const date = now.toISOString();
  const events = [];

  const apps = [];
  for (const id of ORDER) {
    const repo = repos[id], decl = decls[id], fb = fallbackApps[id];
    if (!repo && !decl && !fb) continue;
    const base = decl ?? repo ?? fb;
    const known = new Map([...(fb?.tables ?? []), ...(prevApps[id]?.values() ?? [])].map(t => [t.name, t]));
    const tables = enrich(id, base.tables, repo?.comments ?? {}, known);
    const prev = prevApps[id];
    for (const t of tables) {
      const p = prev?.get(t.name);
      if (p) {
        t.vueLe = p.vueLe ?? previous.generatedAt;
        if (p.nouvelle) t.nouvelle = p.nouvelle;
        const before = new Set(p.columns.map(c => c.name)), after = new Set(t.columns.map(c => c.name));
        for (const c of after) if (!before.has(c)) events.push({ date, app: id, type: 'colonne_ajoutee', table: t.name, colonne: c });
        for (const c of before) if (!after.has(c)) events.push({ date, app: id, type: 'colonne_supprimee', table: t.name, colonne: c });
      } else {
        t.vueLe = date;
        if (prev) { t.nouvelle = { le: date, source: decl ? 'déclaration' : 'dépôt' }; events.push({ date, app: id, type: 'table_ajoutee', table: t.name, source: t.nouvelle.source }); }
      }
    }
    if (prev) for (const name of prev.keys()) if (!tables.some(t => t.name === name)) events.push({ date, app: id, type: 'table_supprimee', table: name });
    apps.push({
      id, tables: tables.sort((a, b) => a.name.localeCompare(b.name)),
      source: decl ? `déclaration du ${decl.declareLe}` : repo ? repo.source : fb.source ?? 'catalogue embarqué',
      ...(decl ? { empreinte: decl.empreinte, version: decl.version } : {}),
    });
  }

  // Une nouvelle table est comparée à toutes les tables des autres outils.
  const all = apps.flatMap(a => a.tables.map(t => ({ ...t, app: a.id })));
  for (const a of apps) for (const t of a.tables) {
    if (!t.nouvelle) continue;
    t.doublonsPossibles = similarTables(t, all.filter(o => o.app !== a.id));
    const ev = events.find(e => e.type === 'table_ajoutee' && e.app === a.id && e.table === t.name);
    if (ev && t.doublonsPossibles.length) ev.doublonsPossibles = t.doublonsPossibles.map(d => `${d.app}.${d.table}`);
  }

  return { catalogue: { generatedAt: date, apps }, events };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? join(here, '..', '..');
  const dataDir = process.env.MATRIX_DATA_DIR ?? join(here, '..', 'data');
  const declDir = process.env.MATRIX_DECLARATIONS_DIR ?? join(here, '..', 'declarations');
  const { catalogue, events } = collect({ root, dataDir, declDir });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'catalogue.json'), JSON.stringify(catalogue, null, 1));
  const histFile = join(dataDir, 'historique.json');
  const hist = existsSync(histFile) ? JSON.parse(readFileSync(histFile, 'utf8')) : { evenements: [] };
  hist.evenements.push(...events);
  writeFileSync(histFile, JSON.stringify(hist, null, 1));
  for (const a of catalogue.apps) {
    const fk = a.tables.reduce((n, t) => n + t.fks.length, 0);
    const cols = a.tables.reduce((n, t) => n + t.columns.length, 0);
    console.log(`${a.id.padEnd(9)} ${String(a.tables.length).padStart(3)} tables  ${String(cols).padStart(4)} colonnes  ${String(fk).padStart(3)} liens  · ${a.source}`);
  }
  if (events.length) {
    console.log(`\n${events.length} changement(s) depuis la collecte précédente :`);
    for (const e of events) console.log(`  ${e.type.padEnd(18)} ${e.app}.${e.table}${e.colonne ? '.' + e.colonne : ''}${e.doublonsPossibles ? '  (doublon possible : ' + e.doublonsPossibles.join(', ') + ')' : ''}`);
  } else console.log('\nAucun changement depuis la collecte précédente.');
}
