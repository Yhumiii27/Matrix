# Doublons à trancher

Tables qui décrivent le même objet dans plusieurs outils (Keystone, Codex, Cursus, Vigie), relevées le 15 octobre 2026.

**Méthode.**
- Les noms et les colonnes de chaque paire de tables de deux outils différents ont été comparés automatiquement (`outils/collecteur.mjs`, fonction `similarTables`).
- Chaque groupe a ensuite été vérifié dans le code et dans les jeux de démonstration : qui saisit la donnée, qui la recopie, et si les valeurs se recoupent.

**Nature du doublon.**
- **Doublon** : la même donnée est saisie deux fois.
- **Miroir** : copie locale d’une table d’un autre outil, sans synchronisation aujourd’hui.
- **Chevauchement** : objets voisins qui se recouvrent en partie.
- **Homonyme** : même nom, objets différents.
- **Technique** : table de fonctionnement propre à chaque outil.

**Comment trancher.**
- Pour chaque groupe, cochez une option dans la colonne « Décision ». L’option proposée est indiquée.
- Vous pouvez aussi choisir les options dans la maquette, écran « Doublons », puis utiliser « Copier mes décisions ».

## Synthèse

| | Objet | Nature | Gravité | Tables | Proposé | Décision |
|---|---|---|---|---|---|---|
| D01 | Personnes | Doublon | Critique | Cursus.`employes`, Keystone.`persons`, Codex.`users`, Vigie.`people` | A | ☐ A ☐ B ☐ C |
| D02 | Projets | Miroir | Critique | Keystone.`projects`, Codex.`projects`, Vigie.`keystone_projects`, Cursus.`projets` | B | ☐ A ☐ B ☐ C |
| D03 | Chantiers (fiche site d'un projet) | Doublon | Majeur | Keystone.`site_sheets`, Keystone.`site_rotations`, Cursus.`chantiers` | B | ☐ A ☐ B ☐ C |
| D04 | Affectations des personnes aux projets | Miroir | Majeur | Keystone.`allocations`, Keystone.`activity_assignments`, Cursus.`missions`, Vigie.`keystone_assignments` | B | ☐ A ☐ B |
| D05 | Tâches et heures prévues | Miroir | Mineur | Keystone.`tasks`, Cursus.`taches` | A | ☐ A ☐ B |
| D06 | Temps passés | Doublon | Critique | Cursus.`feuilles`, Keystone.`time_entries`, Keystone.`hours_lines`, Vigie.`hours_worked` | A | ☐ A ☐ B ☐ C |
| D07 | Absences et congés | Doublon | Majeur | Cursus.`absences`, Keystone.`leave_entries`, Keystone.`leave_types` | A | ☐ A ☐ B |
| D08 | Catalogue des formations et habilitations | Doublon | Majeur | Cursus.`formations`, Cursus.`habilitations`, Vigie.`training_titles` | A | ☐ A ☐ B |
| D09 | Titres détenus par les personnes | Doublon | Majeur | Cursus.`certifications`, Cursus.`hab_titres`, Vigie.`qualifications`, Keystone.`certifications` | A | ☐ A ☐ B |
| D10 | Documents | Doublon | Critique | Codex.`documents`, Codex.`revisions`, Codex.`workflows`, Keystone.`documents`, Keystone.`document_revisions`, Keystone.`document_approvals`, Vigie.`documents`, Vigie.`document_versions` | A | ☐ A ☐ B |
| D11 | Registre des types de document et circuits | Doublon | Majeur | Codex.`doc_types`, Codex.`function_holders`, Keystone.`document_types`, Keystone.`document_type_circuit_steps`, Keystone.`document_approver_assignments` | A | ☐ A ☐ B |
| D12 | Demandes et ordres de modification (ECR / ECO) | Chevauchement | Majeur | Codex.`change_requests`, Keystone.`vigie_ecos` | A | ☐ A ☐ B |
| D13 | Non-conformités et éléments HSE de projet | Miroir | Mineur | Vigie.`events`, Keystone.`vigie_ncrs`, Keystone.`vigie_hse_items` | A | ☐ A |
| D14 | Sites et établissements | Doublon | Majeur | Codex.`sites`, Vigie.`sites` | A | ☐ A ☐ B |
| D15 | Organisation : départements et équipes | Chevauchement | Majeur | Codex.`departments`, Keystone.`departments`, Cursus.`equipes` | A | ☐ A ☐ B |
| D16 | Clients, fournisseurs et entreprises extérieures | Chevauchement | Mineur | Keystone.`clients`, Keystone.`suppliers`, Vigie.`contractors` | A | ☐ A ☐ B |
| D17 | Pays | Chevauchement | Mineur | Cursus.`destinations`, Keystone.`countries`, Keystone.`public_holidays` | A | ☐ A ☐ B |
| D18 | Journaux d'audit | Technique | Mineur | Keystone.`audit_entries`, Codex.`audit_log`, Cursus.`journal` | A | ☐ A ☐ B |
| D19 | Paramètres et fichiers joints | Technique | Mineur | Keystone.`app_settings`, Cursus.`settings`, Keystone.`stored_files`, Vigie.`attachments` | A | ☐ A |
| D20 | Homonymes : même nom, objets différents | Homonyme | Mineur | Keystone.`risks`, Vigie.`risks`, Vigie.`certifications`, Keystone.`change_requests`, Cursus.`plan_actions`, Cursus.`reports` | A | ☐ A ☐ B |

## D01 · Personnes

**Doublon · Critique**

**Ce que contiennent les tables.** 11 des 25 personnes de Codex figurent aussi dans Keystone (Marie Lefebvre, Romain Aubert, Julien Wagner, Pauline Noguès…), sous un autre identifiant. Cursus et Vigie décrivent d'autres populations, sans aucun nom commun. Aucune table ne partage de clé avec une autre.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Cursus | `employes` | Fiche salarié RH (contrat, temps de travail, visite médicale) | 24 salariés, matricule EMP-xxxx dérivé de l'id entier |
| Keystone | `persons` | Personnes des projets, y compris contacts client et rôles contractuels | id uuid, short_name unique ; mêmes noms que Codex |
| Codex | `users` | Utilisateurs de la GED et comptes système | 25 personnes + comptes codex, keystone, vigie ; id texte |
| Vigie | `people` | Personnel suivi dans la matrice d'habilitations | 12 personnes, noms provisoires entre crochets ([T. Nguyen]) |

**Colonnes qui se correspondent**

- `employes.nom ↔ persons.full_name ↔ users.name ↔ people.name`
- `employes.poste ↔ persons.job_title ↔ users.title ↔ people.job`
- `employes.equipe ↔ persons.department_id ↔ users.department`
- `— ↔ persons.email ↔ — ↔ —`

**Options**

- ☐ **A. Fusionner : Cursus fait foi pour les salariés** *(proposé)* : Une seule fiche par salarié, identifiée par le matricule. Keystone, Codex et Vigie gardent une table locale réduite (matricule + données propres à l'outil). Keystone garde les personnes externes (contacts client).
- ☐ **B. Fusionner : annuaire central dans Matrix** : Matrix tient la fiche Personne (alimentée par Entra ID et Cursus) et la diffuse aux quatre outils.
- ☐ **C. Garder les quatre tables et les rapprocher** : Matrix tient une table de correspondance des identifiants. Les doubles saisies continuent.

**Pourquoi A.** Cursus est le seul outil qui connaît le contrat et l'entrée ou la sortie du salarié. Les autres n'ont besoin que d'une référence.

## D02 · Projets

**Miroir · Critique**

**Ce que contiennent les tables.** Codex est cohérent avec Keystone. Vigie et Cursus utilisent des codes que Keystone ne connaît pas. Les codes internes de Cursus (INT-…) n'ont pas d'équivalent dans Keystone.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Keystone | `projects` | Projet de référence (code, client, phase, budget) | 17 projets, codes HLT-026, NDC-031… et code analytique HAV004 |
| Codex | `projects` | Copie locale pour rattacher les documents | 3 projets, mêmes codes que Keystone (HLT-026, NDC-031, RCF-019) |
| Vigie | `keystone_projects` | Copie locale pour les listes de choix | 10 projets K-2024-097… : aucun code n'existe dans Keystone |
| Cursus | `projets` | Codes à imputer sur les feuilles de temps | 14 codes : projets K-26xx et codes internes INT-PROD, INT-HSE, ECOLE… |

**Colonnes qui se correspondent**

- `projects.code ↔ projects.code ↔ keystone_projects.id ↔ projets.code`
- `projects.name ↔ projects.name ↔ keystone_projects.title ↔ projets.nom`
- `clients.name ↔ projects.client ↔ keystone_projects.client ↔ —`

**Options**

- ☐ **A. Garder Keystone seul ; les autres deviennent des miroirs synchronisés** : Mêmes codes partout. Les copies sont mises à jour par l'API Keystone et ne sont plus saisies.
- ☐ **B. Garder Keystone et ajouter les codes internes dans Keystone** *(proposé)* : Comme A, et les codes hors projet (INT-…) deviennent des projets internes Keystone, avec leur code analytique.
- ☐ **C. Garder les tables actuelles** : Trois formats de code restent en circulation.

**Pourquoi B.** Les heures imputées sur un code interne doivent aussi remonter dans Sage X3 et Lucca, comme celles des projets.

## D03 · Chantiers (fiche site d'un projet)

**Doublon · Majeur**

**Ce que contiennent les tables.** Les deux outils décrivent le même chantier (lieu, pays, début, fin, chef, équipe), avec des codes différents. Cursus ajoute les habilitations exigées.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Keystone | `site_sheets` | Fiche chantier : lieu, pays, dates, contraintes d'accès | 1 fiche (HLT-026) ; cursus_chantier_id vide |
| Keystone | `site_rotations` | Équipe et rotations sur le chantier | 6 rotations |
| Cursus | `chantiers` | Chantier, exigences d'habilitation et équipe pour le Go / No Go | 5 chantiers K-26xx ; habs, certs, ressources en JSON |

**Colonnes qui se correspondent**

- `site_sheets.site_name ↔ chantiers.lieu`
- `site_sheets.country ↔ chantiers.pays`
- `site_sheets.start_on / end_on ↔ chantiers.debut / fin`
- `site_rotations.person_id ↔ chantiers.ressources[]`

**Options**

- ☐ **A. Keystone fait foi, exigences comprises ; Cursus lit** : Keystone stocke les habilitations exigées par chantier. Cursus calcule le verdict à partir de cette fiche.
- ☐ **B. Keystone pour le chantier, Cursus pour les exigences** *(proposé)* : Cursus garde une table réduite (code projet + exigences) et lit le reste dans Keystone.
- ☐ **C. Garder les deux** : Les dates et l'équipe sont saisies deux fois.

**Pourquoi B.** Les exigences d'habilitation relèvent des RH ; le reste de la fiche relève du projet.

## D04 · Affectations des personnes aux projets

**Miroir · Majeur**

**Ce que contiennent les tables.** Les tables de Cursus et de Vigie portent les mêmes champs (personne, projet, début, fin) et sont remplies uniquement par le jeu de démo.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Keystone | `allocations` | Charge par personne, semaine et projet | 64 lignes |
| Keystone | `activity_assignments` | Ressources affectées aux activités du planning | heures prévues et réalisées |
| Cursus | `missions` | Affectations recopiées de Keystone (alertes de congés) | 14 missions |
| Vigie | `keystone_assignments` | Affectations recopiées de Keystone (alertes d'habilitation) | 1 affectation |

**Colonnes qui se correspondent**

- `allocations.person_id ↔ missions.emp_id ↔ keystone_assignments.person_id`
- `allocations.project_id ↔ missions.projet ↔ keystone_assignments.project`
- `week_start ↔ du / au ↔ start_on / end_on`

**Options**

- ☐ **A. Keystone fait foi ; Cursus et Vigie lisent par API** : Suppression de missions et de keystone_assignments, remplacés par un appel à Keystone.
- ☐ **B. Keystone fait foi ; copies synchronisées** *(proposé)* : Les tables restent comme cache, mises à jour par Keystone.

**Pourquoi B.** Cursus et Vigie calculent des alertes en masse ; un cache local évite un appel par personne.

## D05 · Tâches et heures prévues

**Miroir · Mineur**

**Ce que contiennent les tables.** Cursus recopie les tâches pour proposer les lignes de la feuille de temps.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Keystone | `tasks` | Tâches du projet | 27 tâches |
| Cursus | `taches` | Tâches Keystone et heures prévues par jour, pour pré-remplir les feuilles | 32 lignes |

**Colonnes qui se correspondent**

- `tasks.person_id ↔ taches.emp_id`
- `tasks.activity_id → projet ↔ taches.projet`
- `tasks.title ↔ taches.tache`

**Options**

- ☐ **A. Keystone fait foi ; Cursus lit au moment de la saisie** *(proposé)* : Suppression de taches ; Keystone expose « tâches d'une personne pour une semaine » (déjà demandé par Cursus).
- ☐ **B. Garder la copie Cursus synchronisée** : La table reste, mise à jour par Keystone.

**Pourquoi A.** La table ne sert qu'à une suggestion ; la lecture directe est plus simple.

## D06 · Temps passés

**Doublon · Critique**

**Ce que contiennent les tables.** Le temps est saisi à deux endroits (Cursus et Keystone) et importé d'un troisième (Lucca). Vigie ressaisit un total mensuel.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Cursus | `feuilles` | Feuille de temps hebdomadaire validée par le manager, envoyée à Sage Paie | 49 feuilles |
| Keystone | `time_entries` | Heures saisies sur une tâche | 4 lignes |
| Keystone | `hours_lines` | Heures déclarées par personne et lot, importées de Lucca | 10 lignes |
| Vigie | `hours_worked` | Heures travaillées par site et par mois (taux TF1 / TG) | 24 lignes saisies |

**Colonnes qui se correspondent**

- `feuilles.lignes[].h ↔ time_entries.hours ↔ hours_lines.declared_h`
- `feuilles.week ↔ time_entries.work_date ↔ hours_imports.period_start`
- `feuilles.lignes[].projet ↔ — ↔ hours_imports.analytic_code`
- `Σ feuilles ↔ hours_worked.hours`

**Options**

- ☐ **A. Cursus fait foi pour la saisie ; Keystone et Vigie reçoivent les heures validées** *(proposé)* : Keystone remplit hours_lines depuis Cursus au lieu de Lucca et retire la saisie time_entries. Vigie calcule hours_worked depuis Cursus.
- ☐ **B. Lucca fait foi ; Cursus et Keystone importent** : Cursus abandonne la saisie des feuilles et garde la validation.
- ☐ **C. Keystone fait foi pour les heures projet ; Cursus pour la paie** : Deux saisies distinctes, à rapprocher chaque mois.

**Pourquoi A.** Cursus valide déjà les feuilles et alimente la paie ; une seule saisie évite les écarts entre paie et coûts projet. Point à trancher avec la DRH : Lucca est-il remplacé par Cursus ?

## D07 · Absences et congés

**Doublon · Majeur**

**Ce que contiennent les tables.** Keystone prévoit déjà d'importer les congés (source, external_id). Cursus envoie l'événement absence.validee, sans destinataire pour l'instant.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Cursus | `absences` | Demandes et validation des CP, RTT et récupérations | 9 absences |
| Keystone | `leave_entries` | Congés connus du planning de ressources | 12 lignes ; colonnes source et external_id prévues pour un import |
| Keystone | `leave_types` | Types de congé | 4 types |

**Colonnes qui se correspondent**

- `absences.emp_id ↔ leave_entries.person_id`
- `absences.du / au ↔ leave_entries.start_date / end_date`
- `absences.type ↔ leave_entries.leave_type`
- `absences.statut ↔ leave_entries.status`

**Options**

- ☐ **A. Cursus fait foi ; Keystone garde une copie en lecture** *(proposé)* : leave_entries n'est plus saisi dans Keystone, seulement alimenté par Cursus.
- ☐ **B. Garder deux saisies** : Les congés sont déclarés deux fois.

**Pourquoi A.** Le droit à congés (soldes, CET, reports) n'existe que dans Cursus.

## D08 · Catalogue des formations et habilitations

**Doublon · Majeur**

**Ce que contiennent les tables.** Mêmes codes et mêmes durées de validité : SST 24 mois, électricité 36, ATEX 36, hauteur 36, CACES R489 60. Vigie mélange formations et habilitations dans une seule liste et ajoute « Accueil sécurité » et « CACES R484 », absents de Cursus.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Cursus | `formations` | Catalogue des formations (durée, organisme, coût, validité) | 11 formations : sst, elec, atex, caces489, hauteur… |
| Cursus | `habilitations` | Types d'habilitation et prérequis | 6 habilitations |
| Vigie | `training_titles` | Titres suivis dans la matrice QHSE | 8 titres : sst, elec, atex, r489, hauteur… |

**Colonnes qui se correspondent**

- `formations.id ↔ training_titles.id`
- `formations.court ↔ training_titles.label`
- `formations.validite ↔ training_titles.validity_months`

**Options**

- ☐ **A. Cursus fait foi ; Vigie lit le catalogue** *(proposé)* : training_titles devient un miroir du catalogue Cursus. Les titres propres au QHSE (accueil sécurité) sont ajoutés dans Cursus.
- ☐ **B. Catalogue unique dans Matrix** : Matrix publie les codes de titre et leur validité aux deux outils.

**Pourquoi A.** Cursus porte déjà le coût, l'organisme et les sessions de chaque formation.

## D09 · Titres détenus par les personnes

**Doublon · Majeur**

**Ce que contiennent les tables.** Le même titre est enregistré dans deux ou trois outils. Keystone le saisit en texte libre, sans code. Les exigences par personne (vigie.qualification_requirements) et par chantier (cursus.chantiers.habs) sont deux tables différentes et restent distinctes.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Cursus | `certifications` | Formations suivies, avec date d'obtention | ≈ 66 lignes |
| Cursus | `hab_titres` | Habilitations délivrées et signées | ≈ 21 lignes |
| Vigie | `qualifications` | Titres détenus, date d'obtention et d'expiration | ≈ 39 lignes |
| Keystone | `certifications` | Certifications d'une personne, en texte libre | 8 lignes (« HV switching authorisation »…) |

**Colonnes qui se correspondent**

- `certifications.emp_id ↔ qualifications.person_id ↔ certifications.person_id`
- `certifications.f / hab_titres.h ↔ qualifications.title_id ↔ certifications.name`
- `certifications.obtenue ↔ qualifications.obtained_on`
- `— ↔ qualifications.expires_on ↔ certifications.expires_on`

**Options**

- ☐ **A. Cursus fait foi ; Vigie et Keystone lisent** *(proposé)* : vigie.qualifications et keystone.certifications deviennent des lectures de Cursus. Vigie garde ses exigences par poste.
- ☐ **B. Garder Vigie pour le QHSE et Cursus pour les RH** : Deux registres à rapprocher.

**Pourquoi A.** Le verdict Go / No Go de Cursus et les alertes de Vigie doivent reposer sur les mêmes titres.

## D10 · Documents

**Doublon · Critique**

**Ce que contiennent les tables.** La politique QHSE existe dans Codex et dans Vigie. Le P&ID du projet HLT-026 a deux numérotations (Keystone et Codex). Chaque outil a son propre circuit de validation.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Codex | `documents` | GED du groupe (identifiant TYPE-CONTEXTE-SEQ) | 62 documents, dont la « Politique qualité, sécurité et environnement » |
| Codex | `revisions` | Révisions A, B… | ≈ 165 révisions |
| Codex | `workflows` | Circuits de validation | 12 circuits |
| Keystone | `documents` | Index local des documents de projet | 42 documents ; P&ID numéroté PID-HLT-026 (Codex : PID-HLT-026-001) |
| Keystone | `document_revisions` | Révisions dans Keystone | 68 révisions |
| Keystone | `document_approvals` | Signatures dans Keystone | 96 lignes |
| Vigie | `documents` | Documents maîtrisés QHSE | 15 documents, dont POL-QHSE-001 « Politique QHSE » |
| Vigie | `document_versions` | Versions et approbations QHSE | 36 versions |

**Colonnes qui se correspondent**

- `documents.id ↔ documents.number ↔ documents.id`
- `documents.title ↔ documents.title ↔ documents.title`
- `revisions.letter ↔ document_revisions.revision ↔ document_versions.version`
- `workflow_steps ↔ document_approvals ↔ document_versions.approver_id`

**Options**

- ☐ **A. Codex fait foi ; Keystone et Vigie référencent l'identifiant Codex** *(proposé)* : Les documents de Vigie migrent dans Codex (département QUA / HSE). Keystone garde un index avec codex_id renseigné et supprime ses révisions et signatures.
- ☐ **B. Codex fait foi, sauf les documents QHSE qui restent dans Vigie** : Deux GED, avec la politique QHSE à supprimer de l'une des deux.

**Pourquoi A.** Il est déjà décidé que Codex prend tout en charge, circuits compris.

## D11 · Registre des types de document et circuits

**Doublon · Majeur**

**Ce que contiennent les tables.** Codex publie son registre (GET /api/registry). Keystone ne le lit pas et tient une liste plus courte.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Codex | `doc_types` | Registre des types (rétention, confidentialité, circuit) | 69 types, 23 familles |
| Codex | `function_holders` | Titulaires des fonctions d'approbation | ≈ 43 lignes |
| Keystone | `document_types` | Types de document de Keystone | 28 types |
| Keystone | `document_type_circuit_steps` | Étapes de circuit par type | 65 étapes |
| Keystone | `document_approver_assignments` | Approbateurs par rôle et projet | 10 lignes |

**Colonnes qui se correspondent**

- `doc_types.code ↔ document_types.code`
- `doc_types.circuit ↔ document_type_circuit_steps.role`
- `function_holders ↔ document_approver_assignments`

**Options**

- ☐ **A. Codex fait foi ; Keystone lit /api/registry** *(proposé)* : Les trois tables Keystone deviennent un cache du registre Codex.
- ☐ **B. Garder les deux registres** : Un même type peut avoir deux circuits différents.

**Pourquoi A.** L'API existe déjà côté Codex.

## D12 · Demandes et ordres de modification (ECR / ECO)

**Chevauchement · Majeur**

**Ce que contiennent les tables.** Deux outils gardent une copie d'un objet qui n'existe pas dans son outil source.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Codex | `change_requests` | Demandes de modification ou de retrait d'un document | 3 demandes ECR-2026-… |
| Keystone | `vigie_ecos` | Miroir des ordres de modification de Vigie | 6 ECO, avec approbations, articles, effectivité |
| Vigie | aucune | Aucune table | Vigie doit centraliser les ECR/ECO mais n'a ni table ni API |

**Colonnes qui se correspondent**

- `change_requests.eco_ref ↔ vigie_ecos.number`
- `change_requests.status ↔ vigie_ecos.status`

**Options**

- ☐ **A. Créer les tables ECR / ECO dans Vigie, qui fait foi** *(proposé)* : Codex et Keystone gardent des miroirs alimentés par Vigie (décision déjà prise).
- ☐ **B. Codex fait foi pour les ECR de document, Vigie pour les ECO** : Revient sur la décision de centraliser dans Vigie.

**Pourquoi A.** C'est la décision déjà actée dans Codex ; il manque la construction côté Vigie.

## D13 · Non-conformités et éléments HSE de projet

**Miroir · Mineur**

**Ce que contiennent les tables.** Les miroirs de Keystone sont remplis par un connecteur fictif ; leurs références ne correspondent à aucun événement de Vigie.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Vigie | `events` | Événements (dont NC, presqu'accidents, accidents) | 17 événements |
| Keystone | `vigie_ncrs` | Miroir des NC de Vigie | 15 NC fictives |
| Keystone | `vigie_hse_items` | Miroir des éléments HSE (plans, permis) | 5 lignes |

**Colonnes qui se correspondent**

- `events.id ↔ vigie_ncrs.vigie_ref`
- `events.keystone_project ↔ vigie_ncrs.project_code`
- `events.severity ↔ vigie_ncrs.severity`

**Options**

- ☐ **A. Vigie fait foi ; garder les miroirs Keystone** *(proposé)* : Vigie publie /api/ncrs et /api/hse selon le contrat proposé par Keystone.

**Pourquoi A.** Le miroir est voulu ; il manque l'API côté Vigie.

## D14 · Sites et établissements

**Doublon · Majeur**

**Ce que contiennent les tables.** Aucune valeur commune. Vigie attend les vrais noms de site. Les sites de chantier de Keystone (project_sites) sont un autre objet et restent à part.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Codex | `sites` | Sites du groupe | lyon, le_havre, marseille |
| Vigie | `sites` | Sites industriels (classement Seveso) | ville-a, ville-b (noms provisoires) |

**Colonnes qui se correspondent**

- `sites.key ↔ sites.id`
- `sites.label ↔ sites.label`

**Options**

- ☐ **A. Une seule liste, publiée par Matrix** *(proposé)* : Codex et Vigie lisent la même liste ; Vigie garde ses attributs Seveso.
- ☐ **B. Codex fait foi ; Vigie lit** : Même résultat, sans passer par Matrix.

**Pourquoi A.** Keystone et Cursus auront aussi besoin de la liste (rattachement des salariés et des projets).

## D15 · Organisation : départements et équipes

**Chevauchement · Majeur**

**Ce que contiennent les tables.** Trois découpages qui ne se recoupent pas : départements du groupe (Codex), services projet (Keystone) et équipes d'usine (Cursus).

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Codex | `departments` | Départements du groupe (code à 3 lettres) | 15 départements : DIR, PRJ, QUA, HSE… |
| Keystone | `departments` | Services projet, avec responsable et capacité | services d'ingénierie |
| Cursus | `equipes` | Équipes du site et manager | 6 équipes : Logistique, Maintenance, Production… |

**Colonnes qui se correspondent**

- `departments.code ↔ departments.name ↔ equipes.nom`

**Options**

- ☐ **A. Organigramme unique à niveaux, publié par Matrix** *(proposé)* : Département > service > équipe ; chaque outil choisit son niveau.
- ☐ **B. Garder trois listes et les rapprocher** : Table de correspondance dans Matrix.

**Pourquoi A.** À trancher quand l'organigramme sera fourni (question O-04 de Codex).

## D16 · Clients, fournisseurs et entreprises extérieures

**Chevauchement · Mineur**

**Ce que contiennent les tables.** Une entreprise extérieure de Vigie peut aussi être un fournisseur de Keystone. Codex et Cursus stockent le client en texte libre.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Keystone | `clients` | Clients | clients des projets |
| Keystone | `suppliers` | Fournisseurs (code X3, notes de performance) | 31 fournisseurs |
| Vigie | `contractors` | Entreprises extérieures des plans de prévention | 6 entreprises |

**Colonnes qui se correspondent**

- `suppliers.name ↔ contractors.name`

**Options**

- ☐ **A. Keystone fait foi ; Vigie relie ses entreprises aux fournisseurs** *(proposé)* : Ajout d'une colonne supplier_id dans contractors ; Vigie garde ses contacts HSE.
- ☐ **B. Garder séparé** : Pas de lien entre achats et prévention.

**Pourquoi A.** Le taux de NC fournisseur (Keystone) et les incidents d'entreprise extérieure (Vigie) se recoupent.

## D17 · Pays

**Chevauchement · Mineur**

**Ce que contiennent les tables.** Keystone identifie un pays par son nom, Cursus par son code ISO.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Cursus | `destinations` | Pays et règles de voyage (visa, vaccins) | 8 pays, code ISO à 2 lettres |
| Keystone | `countries` | Pays des projets (clé : nom) | pays par zone |
| Keystone | `public_holidays` | Jours fériés par pays | 11 jours |

**Colonnes qui se correspondent**

- `destinations.code ↔ countries.name`
- `destinations.pays ↔ countries.name`

**Options**

- ☐ **A. Liste des pays ISO publiée par Matrix** *(proposé)* : Keystone ajoute le code ISO ; Cursus garde ses règles de voyage.
- ☐ **B. Garder séparé** : Rapprochement par le nom.

**Pourquoi A.** Faible coût, évite les écarts d'orthographe.

## D18 · Journaux d'audit

**Technique · Mineur**

**Ce que contiennent les tables.** Chaque outil trace ses propres actions. Vigie n'a pas de journal.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Keystone | `audit_entries` | Journal d'audit |  |
| Codex | `audit_log` | Journal d'audit |  |
| Cursus | `journal` | Journal d'audit et d'intégration |  |

**Options**

- ☐ **A. Garder dans chaque outil ; Matrix les consulte ensemble** *(proposé)* : Vue d'audit transverse dans Matrix, en lecture.
- ☐ **B. Journal central dans Matrix** : Chaque outil écrit dans Matrix.

**Pourquoi A.** Le journal doit rester disponible même si Matrix est arrêté.

## D19 · Paramètres et fichiers joints

**Technique · Mineur**

**Ce que contiennent les tables.** Même structure, contenu propre à chaque outil. Ce ne sont pas des doublons.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Keystone | `app_settings` | Paramètres de Keystone |  |
| Cursus | `settings` | Paramètres de Cursus |  |
| Keystone | `stored_files` | Fichiers de Keystone |  |
| Vigie | `attachments` | Pièces jointes de Vigie |  |

**Colonnes qui se correspondent**

- `app_settings ↔ settings (clé / valeur)`

**Options**

- ☐ **A. Garder dans chaque outil** *(proposé)* : Aucun changement. Les fichiers qui ont valeur de document vont dans Codex (voir D10).

**Pourquoi A.** Données de fonctionnement propres à chaque outil.

## D20 · Homonymes : même nom, objets différents

**Homonyme · Mineur**

**Ce que contiennent les tables.** Aucune fusion à faire. Le risque est la confusion lors d'une requête ou d'une intégration.

| Outil | Table | Rôle | Contenu |
|---|---|---|---|
| Keystone | `risks` | Risques projet (probabilité, impact, EMV) |  |
| Vigie | `risks` | Risques professionnels du DUERP |  |
| Vigie | `certifications` | Certifications ISO du groupe | à ne pas confondre avec cursus.certifications (formations suivies) |
| Keystone | `change_requests` | Avenants et changements de projet | à ne pas confondre avec codex.change_requests (ECR) |
| Cursus | `plan_actions` | Lignes du plan de formation | à ne pas confondre avec vigie.actions (plan d'actions QHSE) |
| Cursus | `reports` | Reports de congés payés | à ne pas confondre avec keystone.status_reports |

**Options**

- ☐ **A. Garder et toujours nommer les tables avec leur outil** *(proposé)* : Matrix affiche outil.table partout. Aucun changement de code.
- ☐ **B. Renommer lors du passage sur le serveur PostgreSQL commun** : Par exemple vigie.certifications → iso_certifications, cursus.reports → reports_conges.

**Pourquoi A.** Le passage à un schéma par outil suffit à lever l'ambiguïté.
