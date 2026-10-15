# Remplacement de Lucca par Cursus : heures et absences

Document de préparation du 15 octobre 2026. Il repose sur la lecture du code de Keystone (commit 9bd597e), de Cursus (commit f70619f) et de Vigie, et sur des essais faits sur des copies. Les dépôts des quatre outils n'ont pas été modifiés.

Contrats publiés avec ce document :
- `data/contrats/heures-validees.schema.json` : messages `epc2i.heures.validees/1` et `epc2i.heures.annulees/1`, et réponse `epc2i.heures.site_mois/1` lue par Vigie ;
- `data/contrats/absences-validees.schema.json` : messages `epc2i.absence.validee/1` et `epc2i.absence.annulee/1`.

Les numéros de ligne renvoient aux fichiers de chaque dépôt.

## 1. Décision, préparation, réversibilité

### 1.1 La décision

| | |
|---|---|
| Parole de l'utilisateur (15/10/2026) | « Ce n'est pas certain que Cursus remplace Lucca a ce stade mais prépare tout comme si cela est le cas. » |
| Choix dans la liste des doublons | « D06 Temps passés : option A (Cursus fait foi pour la saisie ; Keystone et Vigie reçoivent les heures validées) » |
| Statut | Provisoire : M-03 reste ouverte dans `docs/decisions.md`. |
| Absences | D07 est définitive : Cursus fait foi, Keystone garde une copie en lecture. Le flux des absences ne dépend donc pas de M-03. Seule une réponse de la DRH à L-01 pourrait le remettre en cause. |

### 1.2 Ce que « préparer » veut dire

On construit tout, on fait tourner en parallèle, on ne retire rien de Lucca.

| On fait maintenant | On attend une confirmation |
|---|---|
| Publier les contrats dans Matrix (`data/contrats/`). | Passer le réglage `hr.hours_source` de Keystone à `cursus` (M-03), puis `hr.leave_source` (L-01, puisque D07 est déjà tranchée). |
| Construire les flux dans Cursus, Keystone et Vigie, derrière des réglages qui gardent le comportement actuel par défaut. | Désactiver la ligne Lucca de la table `connectors` de Keystone (`enabled = false`). |
| Remplir les correspondances : personnes, projets, sites (§ 4). | Retirer le bouton « Log » des tâches de Keystone (décision C-2b). |
| Faire une marche en parallèle sur une équipe pilote pendant deux clôtures mensuelles, avec la requête de comparaison du § 6.2. | Retirer les libellés Lucca de Keystone et le bouton « Importer le personnel (Lucca · CSV) » de Vigie. |
| Écrire la procédure de bascule et celle du retour arrière (§ 6). | Arrêter l'abonnement Lucca, sur décision de la DRH. |

Condition préalable à tout le reste : M-05, l'autorisation de modifier le code des quatre outils.

### 1.3 Ce qui reste réversible

| Élément | Retour arrière |
|---|---|
| Source des heures dans Keystone | Réglage `hr.hours_source` (`lucca` ou `cursus`) dans `app_settings`. Les écrans lisent l'import de la source choisie. |
| Source des congés dans Keystone | Réglage `hr.leave_source`. |
| Données Lucca | Jamais supprimées. Chaque table alimentée par un flux porte une colonne `source` : `hours_imports`, `leave_entries`, `hr_timesheets`, `hours_worked`. |
| Envoi des heures par Cursus | Réglage `sourceHeures` dans la table `settings` de Cursus. Avec la valeur `lucca`, Cursus n'émet plus de message `heures.*`. |
| Format des messages | Le contrat ne dépend pas de la source (`source` vaut `cursus` ou `lucca`). Un adaptateur Lucca peut produire les mêmes messages. |
| Heures de Vigie | Colonne `hours_worked.source`. |

Rien n'est irréversible avant la bascule. Les changements de Cursus (matricule, site, versions, corrections, file d'envoi) servent dans tous les cas.

### 1.4 Point de départ

- **Aucun flux Lucca réel n'existe.** Dans Keystone, le bouton « Import Lucca » change seulement une date (`src/server/dal/hr.ts:318-337`, commentaire « the Lucca connector is not modelled »). Le jeu de démonstration remplit `hours_imports`, `hours_lines`, `unassigned_hours` et `leave_entries`.
- **Cursus n'envoie rien.** `sendToKeystone` écrit les messages `heures.validees` et `absence.validee` dans `journal` (`server/src/integrations/keystone.ts:15-21`). Le message d'heures ne contient que `{matricule, semaine, projets: {code → total}}` (`server/src/actions/temps.ts:85-92`).
- **Vigie n'a aucune saisie des heures travaillées.** Seul le jeu de démonstration remplit `hours_worked` (`src/db/seed.ts:218-223`).

Remplacer Lucca revient donc à construire les flux Cursus. Il n'y a rien à débrancher dans le code.

## 2. Les flux après bascule

```
                Lucca : plus aucun flux (ligne Lucca de connectors désactivée)

 +--------------------+   H1 heures.validees, heures.annulees        +--------------------+
 |       Cursus       | -------------------------------------------> |      Keystone      |
 |  fait foi pour la  |   H2 absence.validee, absence.annulee        |  hr_timesheets     |
 |  saisie et la      | -------------------------------------------> |  hours_imports     |
 |  validation        |   Cursus pousse et renvoie en cas d'échec    |  leave_entries     |
 |                    |                                              |                    |
 |                    | <------------------------------------------- |                    |
 |                    |   P2 projets, P3 tâches de la semaine        +--------------------+
 |                    |   Cursus lit Keystone
 |                    |
 |                    |   H3 heures par site et par mois             +--------------------+
 |                    | -------------------------------------------> |       Vigie        |
 |                    |   Vigie appelle Cursus chaque nuit           |  hours_worked      |
 |                    |                                              +--------------------+
 |                    |   H4 variables de paie (inchangé)
 |                    | -------------------------------------------> Sage Paie
 +--------------------+
           |
           +-- P1 annuaire, lu par Keystone et Vigie

 Matrix (rôle matrix_lecture) lit cursus.heures_validees_v1 et keystone.hr_timesheets
 pour le contrôle de complétude (§ 6.3).
```

| Flux | De → vers | Qui déclenche | Quand | Dans `data/flux.json` |
|---|---|---|---|---|
| H1 Heures validées et annulées | Cursus → Keystone | Cursus (webhook) | À chaque validation et à chaque réouverture | F03, à réécrire |
| H2 Absences validées et annulées | Cursus → Keystone | Cursus (webhook) | À chaque validation et à chaque annulation | F03, à réécrire |
| H3 Heures travaillées par site et par mois | Cursus → Vigie | Vigie (lecture) | Chaque nuit et à la demande | F14, à réécrire |
| H4 Variables de paie | Cursus → Sage Paie | RH (`temps.pushSage`) | Inchangé | externe `sage` |
| P1 Annuaire | Cursus → Keystone, Vigie | Keystone, Vigie (lecture) | Chaque nuit | nouveau (D01) |
| P2 Projets et codes analytiques | Keystone → Cursus | Cursus (lecture) | Chaque nuit et à la demande | nouveau (D02), remplace la copie F13 |
| P3 Tâches d'une personne pour une semaine | Keystone → Cursus | Cursus (lecture) | À la proposition des lignes d'une feuille | nouveau (D05), remplace la table `taches` |
| Lucca → Keystone | retiré | | | externe `lucca`, à passer en « remplacé » à la bascule |

F01 (verdict Go / No Go) et F02 (demandes de déplacement) ne changent pas. Les messages `demande.decision` et `verdict.modifie` de Cursus pourront emprunter la même route et la même file d'envoi ; leur contrat n'est pas traité ici.

## 3. Contrat d'interface

### 3.1 Principes

1. **Un contrat par objet, indépendant de la source.** Le champ `source` vaut `cursus`, ou `lucca` si Lucca est conservé.
2. **Keystone reçoit, Vigie lit.** Keystone suit sa décision NEW-CURSUS-7 : « Cursus pousse, avec renvoi en cas d'échec ». Vigie lit, parce que sa donnée est un agrégat recalculable : une lecture répétée remplace l'envoi et ses renvois.
3. **Maille.** Pour les heures : la feuille de temps (un salarié, une semaine), avec les heures au jour. Le jour permet de ranger chaque heure dans son mois, car une semaine peut couvrir deux mois. Pour une absence : l'absence entière, ventilée par semaine.
4. **Idempotence.** La clé est `(source, id)` de la feuille ou de l'absence, avec une `version` croissante. Le `message_id` repère un message renvoyé.
5. **Aucune donnée sensible.** Les messages ne portent aucune colonne sensible de la convention, aucun texte libre, aucun motif d'absence.
6. **Contrats vérifiables.** Les fichiers JSON Schema (draft 2020-12) vivent dans Matrix. Chaque outil les copie dans son dépôt et vérifie ses messages contre eux dans ses tests.

### 3.2 Transport et sécurité

| Appel | Route | Variables chez l'appelant | Variable chez l'appelé |
|---|---|---|---|
| H1, H2 | `POST {KEYSTONE_URL}/api/integrations/cursus/events` | `KEYSTONE_URL`, `KEYSTONE_TOKEN` dans Cursus (déjà prévues, `server/src/integrations/keystone.ts:4, 13`) | `CURSUS_INBOUND_KEYS` dans Keystone |
| P2, P3 | `GET {KEYSTONE_URL}/api/integrations/cursus/projets` et `.../taches` | idem | idem |
| H3 | `GET {CURSUS_URL}/api/integrations/vigie/heures-travaillees` | `CURSUS_API_URL`, `CURSUS_API_KEY` dans Vigie | `VIGIE_API_KEY` dans Cursus |
| P1 | `GET {CURSUS_URL}/api/integrations/annuaire` | `CURSUS_API_KEY` dans Keystone (existe déjà) et dans Vigie | `KEYSTONE_API_KEY` (existe déjà, `keystone.ts:24`), `VIGIE_API_KEY` |
| Mise à jour de Vigie | `POST {VIGIE_URL}/api/integrations/cursus/sync` | tâche planifiée de Coolify | `VIGIE_SYNC_KEY` dans Vigie |

Règles communes :
- La clé passe dans l'en-tête `X-Api-Key`, comme pour F01 et F02.
- Une clé par sens et par appelant, d'au moins 32 octets aléatoires, rangée dans les variables d'environnement de Coolify.
- `CURSUS_INBOUND_KEYS` accepte une liste séparée par des virgules : on change de clé sans coupure.
- La comparaison se fait en temps constant (`crypto.timingSafeEqual` sur les empreintes SHA-256 des deux valeurs). La fonction `keystoneAuth` de Cursus compare avec `!==` (`server/src/index.ts:131-132`) : à corriger.
- Hors démonstration, un outil refuse d'activer une intégration dont la clé vaut la valeur de démonstration (`demo-keystone`).
- Les échanges passent par le réseau Docker interne de Coolify ou en HTTPS, jamais en HTTP sur Internet.
- La route de Keystone ignore le cookie de persona `ks-role` et n'applique pas le contrôle d'origine de `src/app/api/import/route.ts:19-28`, prévu pour un navigateur. Elle refuse un corps de plus de 256 Ko (413) et un type autre que `application/json` (415).

**Sans serveur distant.** Sans `KEYSTONE_URL`, Cursus garde son comportement actuel (une ligne dans `journal`) et marque le message `simule`. C'est le cas des applications de bureau : `desktop/CursusApp.swift` ne fixe pas `KEYSTONE_URL` et `desktop/KeystoneApp.swift` ne fixe pas `CURSUS_API_URL`. Les tests de Keystone envoient les exemples des fichiers JSON Schema à la route. Aucun mode de repli ne demande donc de route de rattrapage.

### 3.3 Heures validées : `epc2i.heures.validees/1`

Envoyé par `temps.validate`. Exemple : une feuille validée une première fois, rouverte, puis validée à nouveau (version 3).

```json
{
  "schema": "epc2i.heures.validees/1",
  "message_id": "3f0c6a1e-6b7d-4c39-9a0e-2d1f7b0c5e11",
  "type": "heures.validees",
  "source": "cursus",
  "emis_le": "2026-10-05T10:00:03+02:00",
  "feuille": {
    "id": "412",
    "matricule": "EMP-0018",
    "semaine": "2026-09-28",
    "version": 3,
    "valide_le": "2026-10-05T10:00:00+02:00",
    "type_contrat": "cdi",
    "total_h": 44,
    "lignes": [
      {
        "ligne": 1, "projet": "HLT-026", "analytique": "HAV004", "tache": "T-2314",
        "jours": [
          { "date": "2026-09-28", "heures": 10 }, { "date": "2026-09-29", "heures": 10 },
          { "date": "2026-09-30", "heures": 8 }, { "date": "2026-10-01", "heures": 8 },
          { "date": "2026-10-02", "heures": 7 }
        ]
      },
      {
        "ligne": 2, "projet": "INT-MAINT", "analytique": null, "tache": null,
        "jours": [ { "date": "2026-09-30", "heures": 1 } ]
      }
    ]
  }
}
```

| Champ | Origine dans Cursus | Destination dans Keystone |
|---|---|---|
| `feuille.id` | `feuilles.id`, en texte | `hr_timesheets.external_id` |
| `feuille.matricule` | `employes.matricule` (aujourd'hui `matricule(id)`, `shared/format.ts:21`) | `persons.matricule`, puis `person_id` |
| `feuille.semaine` | `feuilles.week` (lundi) | `hr_timesheets.week_start` |
| `feuille.version` | `feuilles.version` (nouvelle colonne) | `hr_timesheets.version` |
| `feuille.valide_le` | `feuilles.valide_le` (nouvelle colonne) | `hr_timesheets.validated_at` |
| `feuille.type_contrat` | `feuilles.contrat.typeContrat`, figé à la soumission | `hr_timesheets.contract_type` |
| `feuille.total_h` | somme des `lignes[].h` | `hr_timesheets.total_h`, contrôle |
| `lignes[].ligne` | rang de la ligne, à partir de 1 | `hr_timesheet_lines.line_no` |
| `lignes[].projet` | `lignes[].projet`, code Keystone après D02 | `project_code`, puis `project_id` par `projects.code` |
| `lignes[].analytique` | `projets.analytique` (miroir de Keystone) | `analytic_code` ; sert à trouver le projet si `projet` est nul |
| `lignes[].tache` | `lignes[].tacheKeystone` (nouveau champ), rempli par la proposition des lignes | `task_number`, puis `task_id` par `tasks.number` |
| `lignes[].jours[].date` | `week` + rang du jour | `hr_timesheet_lines.work_date` |
| `lignes[].jours[].heures` | `lignes[].h[i]`, jours à zéro omis | `hr_timesheet_lines.hours` |

Contrôles du récepteur en plus du schéma (réponse 400 si l'un échoue) : `semaine` est un lundi ; chaque `date` est comprise entre `semaine` et `semaine + 6` ; une date n'apparaît qu'une fois par ligne ; `total_h` égale la somme des heures à 0,01 h près.

Les intérimaires et les cadres dirigeants sont envoyés, alors que Sage Paie les exclut (`shared/rules/temps.ts:118-126`) : leurs heures comptent aussi sur les projets.

**Règles de réception dans Keystone**, dans une seule transaction :
1. Clé invalide : 401.
2. Contenu invalide : 400 avec la liste des erreurs.
3. `message_id` déjà présent dans `hr_inbound_events` : 200, statut `deja_recu`.
4. Version inférieure ou égale à celle de `hr_timesheets` pour `(source, external_id)` : 200, statut `version_ignoree`. Rien ne change.
5. Sinon : l'en-tête est mis à jour, toutes les lignes de la feuille sont remplacées, chaque ligne est rapprochée (personne, projet, tâche), puis Keystone recalcule les couples (projet, mois) touchés par l'ancienne et la nouvelle version.
6. Réponse 200, statut `applique`, avec la liste des anomalies.

**Anomalies.** Une donnée inconnue ne bloque pas l'envoi. La ligne est gardée dans la copie avec son anomalie, et elle est reprise au prochain recalcul.

| Anomalie | Cause | Traitement |
|---|---|---|
| `personne_inconnue` | matricule absent de `persons.matricule` | Ligne non projetée (`hours_lines.person_id` est obligatoire). Reprise quand l'annuaire relie la personne. |
| `projet_inconnu` | ni `projet` ni `analytique` ne désignent un projet | Ligne non projetée. Reprise à la création du projet. |
| `tache_inconnue` | `tache` absente de `tasks.number` | Heures rangées dans `unassigned_hours` du projet. |
| `tache_autre_projet` | la tâche appartient à un autre projet | Idem. |
| `tache_sans_activite` | `tasks.activity_id` est nul : pas de lot WBS | Idem. |

**Effet dans les tables de Keystone** (recalcul d'un couple projet × mois pour la source `cursus`) :

| Table | Contenu recalculé |
|---|---|
| `hours_imports` | Une ligne par (projet, mois, source) : `period_start` = 1er du mois, `analytic_code` = `projects.analytic_code`, à défaut le code reçu, `imported_on` = date du recalcul, `source = 'cursus'`, `matching_mode = 'resource_wp'`. |
| `hours_lines` | Une ligne par (personne, lot WBS de niveau 1). Le lot se trouve en remontant tâche → `activities.wbs_node_id` → ancêtre de niveau 1 (`wbs_nodes.parent_id`). `declared_h` = somme des heures du mois. `planned_h` : voir L-03 ; proposition : `activity_assignments.planned_hours` de la personne, au prorata des jours ouvrés de l'activité dans le mois. |
| `unassigned_hours` | Une ligne par (personne, projet, mois) pour les heures sans tâche utilisable. Clé stable `source_key` = `cursus:EMP-0018:2026-09:HLT-026`. Une affectation faite à la main (`assigned_wbs_node_id`, `assigned_at`) est conservée d'un recalcul à l'autre grâce à cette clé. |
| `tasks.logged_h` | Après la bascule : heures de `time_entries` saisies avant la bascule, plus les heures reçues de Cursus sur la tâche. |

Les codes internes (INT-*, ECOLE) deviennent des projets internes de Keystone (D02 option B). Le total hors projet par personne et par semaine (NEW-CURSUS-6) se calcule depuis `hr_timesheet_lines` sur ces projets.

### 3.4 Corrections et annulations

Aujourd'hui, une feuille validée ne peut plus changer : `editable` refuse toute saisie (`server/src/actions/temps.ts:25`) et aucune action ne la rouvre. Le contrat ajoute un circuit de correction.

| Étape dans Cursus | Statut de la feuille | `version` | Message |
|---|---|---|---|
| Validation par le manager ou les RH | `validee` | 1 | `heures.validees` |
| Réouverture par les RH (`temps.rouvrir`, nouvelle action, motif obligatoire gardé dans Cursus) | `rejetee` (à corriger) | 2 | `heures.annulees` |
| Correction, soumission, puis nouvelle validation (circuit existant) | `validee` | 3 | `heures.validees` |

Exemple : la feuille 412 du § 3.3 est rouverte une seconde fois (version 4).

```json
{
  "schema": "epc2i.heures.annulees/1",
  "message_id": "9b1d2c3e-4f50-4a61-8b72-c3d4e5f60718",
  "type": "heures.annulees",
  "source": "cursus",
  "emis_le": "2026-10-07T08:15:02+02:00",
  "feuille": { "id": "412", "matricule": "EMP-0018", "semaine": "2026-09-28", "version": 4, "annule_le": "2026-10-07T08:15:00+02:00" }
}
```

- **Dans Keystone**, `heures.annulees` supprime les lignes de la feuille, garde l'en-tête avec `hr_timesheets.status = 'cancelled'` et recalcule les mois touchés.
- **Le motif de réouverture ne part pas** : il peut contenir un texte personnel.
- **Feuille déjà transmise à Sage Paie** (`feuilles.sage = true`). La réouverture reste possible. La nouvelle validation doit alors garder les mêmes totaux par jour que ceux transmis. Cursus les garde dans une nouvelle colonne `feuilles.sage_jours`, remplie par `temps.pushSage`. On peut donc corriger la répartition entre projets sans toucher à la paie. Si les totaux changent, `temps.validate` refuse et renvoie vers les RH : la régularisation de paie reste à définir (L-09).
- **Absences.** Une nouvelle action `absence.annuler` (RH ou valideur) passe une absence validée au statut `annulee`, augmente `version` et émet `absence.annulee`. Une modification de dates se fait par une annulation suivie d'une nouvelle absence.

### 3.5 Absences validées : `epc2i.absence.validee/1`

Envoyé par `absence.demander` quand le manager pose l'absence lui-même, et par `absence.decider` quand il valide (`server/src/actions/absences.ts:21, 34`). Les demandes en attente ne partent pas. Exemple : un congé du jeudi 5 au vendredi 13 novembre 2026, avec le 11 novembre férié.

```json
{
  "schema": "epc2i.absence.validee/1",
  "message_id": "5a7e9c10-2b3d-4e5f-8a9b-0c1d2e3f4a5b",
  "type": "absence.validee",
  "source": "cursus",
  "emis_le": "2026-10-01T09:00:02+02:00",
  "absence": {
    "id": "57", "matricule": "EMP-0014", "version": 1, "valide_le": "2026-10-01T09:00:00+02:00",
    "categorie": "conge", "du": "2026-11-05", "au": "2026-11-13", "jours": 6,
    "semaines": [
      { "lundi": "2026-11-02", "du": "2026-11-05", "au": "2026-11-06", "jours": 2 },
      { "lundi": "2026-11-09", "du": "2026-11-09", "au": "2026-11-13", "jours": 4 }
    ]
  }
}
```

- **Catégorie seule.** `categorie` vaut `conge` pour CP, RTT et RECUP, et `absence` pour tout autre type que Cursus gérerait plus tard. Le motif reste dans Cursus. C'est l'option retenue par Keystone pour NEW-CURSUS-4 : « Keystone ne garde que les dates et un type simple (congé ou absence), sans le motif ». Le détail CP, RTT, RECUP pourra s'ajouter en champ facultatif si L-08 le demande.
- **Cursus fait le décompte.** `jours` suit `Domain.countDays` (`shared/domain.ts:160-172`) : week-ends, fériés et jours non travaillés du temps partiel exclus.
- **Ventilation en un seul parcours.** Cursus parcourt la période de `du` à `au` et range chaque jour décompté dans sa semaine. Un découpage semaine par semaine donnerait un autre total pour un CP de temps partiel : `countDays` traite à part les jours non travaillés du début de période.

Annulation :

```json
{ "schema": "epc2i.absence.annulee/1", "message_id": "6b8f0d21-3c4e-4f60-9bac-1d2e3f405b6c", "type": "absence.annulee",
  "source": "cursus", "emis_le": "2026-10-12T14:30:01+02:00",
  "absence": { "id": "57", "matricule": "EMP-0014", "version": 2, "annule_le": "2026-10-12T14:30:00+02:00" } }
```

**Correspondance avec `leave_entries`** (une ligne par semaine) :

| Colonne | Valeur |
|---|---|
| `person_id` | par `persons.matricule` ; matricule inconnu : le message est gardé dans `hr_inbound_events` avec l'anomalie `personne_inconnue` et rejoué quand la personne est reliée |
| `leave_type` | nouveaux codes `conge` et `absence` dans `leave_types` (et dans `LeaveType`, `src/server/db/codes.ts:277-278`) |
| `week_start`, `start_date`, `end_date`, `days` | `semaines[].lundi`, `du`, `au`, `jours` |
| `status` | `approved` |
| `source`, `external_id`, `external_version` | `cursus`, `cursus:absence:57`, `version` (nouvelle colonne) |

Les lignes de l'absence sont supprimées puis réinsérées quand la version est supérieure. Nouvelle contrainte `UNIQUE(source, external_id, week_start)`. Les deux codes `conge` et `absence` sont insérés par la migration elle-même : le seed ne remplit qu'une base vide (`src/server/db/seed/index.ts:68`).

### 3.6 Heures travaillées pour Vigie : `epc2i.heures.site_mois/1`

`GET {CURSUS_URL}/api/integrations/vigie/heures-travaillees?depuis=2025-10&jusqua=2026-10`, en-tête `X-Api-Key`. Réponse décrite par `#/$defs/heuresSiteMois` dans `heures-validees.schema.json` :

```json
{ "schema": "epc2i.heures.site_mois/1", "source": "cursus", "calcule_le": "2026-10-15T06:00:00+02:00",
  "mois": [ { "mois": "2026-09", "site": "ville-a", "heures_salaries": 4120, "heures_interim": 310, "heures_ecole": 56,
              "feuilles_attendues": 104, "feuilles_validees": 98, "complet": false } ] }
```

Calcul dans Cursus :
- feuilles validées seulement ; chaque jour rangé dans son mois ;
- site figé sur la feuille à la soumission (nouvelle colonne `feuilles.site`, copiée de `employes.site` comme `contrat` l'est aujourd'hui) ;
- trois totaux séparés : salariés hors intérim, intérimaires, cours en CFA (codes listés dans le réglage `codesEcole`, `ECOLE` par défaut). Vigie choisit ce qu'il compte (L-06) ;
- les salariés au forfait jours saisissent des heures : `temps.submit` refuse une feuille sans heure (`server/src/actions/temps.ts:71`). Aucune conversion jours → heures n'est donc nécessaire ;
- `complet` vaut vrai quand toutes les feuilles attendues du mois sont validées (définition dans le schéma).

Dans Vigie, une tâche quotidienne relit les 13 derniers mois et met à jour `hours_worked(month, site_id)`. Un site inconnu de `vigie.sites` est ignoré et signalé. Comme la donnée se recalcule entièrement, la lecture répétée ne crée pas de doublon.

### 3.7 Réponses et renvois

| Réponse de Keystone | Corps | Ce que fait Cursus |
|---|---|---|
| 200 | `{"recu": true, "statut": "applique" \| "deja_recu" \| "version_ignoree", "anomalies": [{"ligne": 2, "code": "projet_inconnu", "valeur": "INT-MAINT"}]}` | Message marqué `envoye`. Les anomalies s'affichent dans Keystone, pas dans Cursus. |
| 400 | `{"recu": false, "erreurs": ["feuille.total_h : 43 au lieu de 44"]}` | Message marqué `rejete`, sans renvoi. Alerte dans Paramètres › Intégrations. |
| 401 | | Renvois comme pour 5xx, alerte immédiate (erreur de configuration). |
| 413, 415 | | Comme 400. |
| 5xx ou pas de réponse en 10 s | | Renvoi après 1 min, 5 min, 30 min, 2 h, puis toutes les 6 h. Alerte au bout de 24 h. |

- **Ordre.** Un message n'est pas envoyé tant qu'un message plus ancien de la même clé (`feuille:412`, `absence:57`) attend. Les autres clés continuent.
- **Reprise manuelle.** Après une longue panne, les RH ou le service informatique remettent en file les messages depuis une date (bouton « Renvoyer » et script `server/scripts/renvoyer-keystone.ts --depuis AAAA-MM-JJ`). Les messages renvoyés gardent leur `message_id` : Keystone les reconnaît.
- **Reprise de l'historique.** Le même script envoie, à la mise en service, les feuilles validées depuis une date à fixer (L-11).

### 3.8 Évolution du contrat

- Un champ facultatif ajouté garde le même identifiant (`/1`). On met d'abord à jour le fichier dans Matrix, puis les récepteurs, puis l'émetteur.
- Un champ retiré ou un changement de sens donne une nouvelle version (`/2`). Le récepteur accepte les deux versions pendant la transition.
- Les fichiers sont stricts (`additionalProperties: false`) : un champ inattendu, par exemple une colonne sensible ajoutée par erreur, est refusé dès les tests de Cursus.
- Les récepteurs activent le contrôle des formats (`date`, `date-time`, `uuid`). Keystone écrit le schéma zod équivalent (zod 4.6.5 est déjà une dépendance) ; un test vérifie que les exemples du fichier passent.

### 3.9 Vue SQL ou API : recommandation

**Recommandation : aucun flux ne passe par une vue lue par `keystone_app` ou `vigie_app`.** Les flux H1, H2 et H3 passent par l'API. Le schéma `cursus` contient des vues versionnées, lisibles par `matrix_lecture` seulement, pour le contrôle de complétude (§ 6.3).

Raisons :
1. **La convention l'interdit.** Chaque rôle d'outil n'a « aucun accès aux autres schémas ». Une vue lue par `keystone_app` demande `USAGE` sur le schéma `cursus` : c'est une exception (L-07).
2. **Les modes de repli n'ont pas de serveur commun.** Sans `DATABASE_URL`, Keystone et Vigie tournent sur PGlite et Cursus sur SQLite : la vue n'existe pas. L'API est donc nécessaire dans tous les cas. Une vue ferait un second canal à maintenir.
3. **Keystone a choisi que Cursus pousse** (NEW-CURSUS-7). Une vue oblige Keystone à interroger Cursus.
4. **Le calendrier se découple.** L'API marche avec Cursus sur SQLite. Le remplacement de Lucca n'attend donc pas la migration de Cursus vers PostgreSQL.
5. **Le modèle interne de Cursus reste libre.** Les lignes de feuille sont en JSON (`feuilles.lignes`). Une vue lue par un autre outil figerait ce modèle ; l'API le cache.

Ce qui passe par une vue :

| Vue (schéma `cursus`, propriétaire `cursus_app`) | Lue par | Usage |
|---|---|---|
| `heures_validees_v1` | `matrix_lecture` | Contrôle de complétude (§ 6.3), comparaisons ponctuelles |
| `absences_validees_v1` | `matrix_lecture` | Même usage pour les absences |
| `heures_site_mois_v1` | `matrix_lecture` ; `vigie_app` seulement si L-07 est accepté | Contrôle ; option pour Vigie sur le serveur commun |

Les colonnes portent les mêmes noms que les champs JSON. Le prototype de schéma PostgreSQL préparé pour la migration de Cursus (`0001_init.sql`, dossier de travail de l'analyse) contient une vue `heures_validees` d'une autre forme (une ligne par feuille et par projet, sans le jour) : elle est remplacée par `heures_validees_v1`. Les migrations de Keystone et de Vigie ne doivent jamais référencer `cursus.*`.

```sql
-- Schéma cursus, exécuté par cursus_app. Essai sur PGlite 0.5.10 (PostgreSQL 18.6).
CREATE VIEW heures_validees_v1 WITH (security_barrier) AS
SELECT f.id AS feuille_id, f.version, f.valide_le, e.matricule, f.week AS semaine, e.type_contrat,
       l.ord::int AS ligne, l.v->>'projet' AS projet, NULLIF(l.v->>'tacheKeystone', '') AS tache,
       (f.week + d.i) AS date, (l.v->'h'->>d.i)::numeric AS heures, f.site
FROM feuilles f
JOIN employes e ON e.id = f.emp_id
CROSS JOIN LATERAL jsonb_array_elements(f.lignes) WITH ORDINALITY AS l(v, ord)
CROSS JOIN generate_series(0, 4) AS d(i)
WHERE f.statut = 'validee' AND COALESCE((l.v->'h'->>d.i)::numeric, 0) > 0;

CREATE VIEW absences_validees_v1 WITH (security_barrier) AS
SELECT a.id AS absence_id, a.version, a.valide_le, e.matricule,
       CASE WHEN a.type IN ('CP', 'RTT', 'RECUP') THEN 'conge' ELSE 'absence' END AS categorie, a.du, a.au
FROM absences a JOIN employes e ON e.id = a.emp_id
WHERE a.statut = 'validee';

CREATE VIEW heures_site_mois_v1 WITH (security_barrier) AS
SELECT to_char(date, 'YYYY-MM') AS mois, site,
       COALESCE(sum(heures) FILTER (WHERE type_contrat <> 'interim' AND projet <> 'ECOLE'), 0) AS heures_salaries,
       COALESCE(sum(heures) FILTER (WHERE type_contrat = 'interim' AND projet <> 'ECOLE'), 0) AS heures_interim,
       COALESCE(sum(heures) FILTER (WHERE projet = 'ECOLE'), 0) AS heures_ecole
FROM heures_validees_v1
GROUP BY 1, 2;
-- Droits : posés par le script de droits de matrix_lecture (0002), qui couvre aussi les vues ; à relancer après chaque migration.
-- Aucun GRANT à keystone_app ni à vigie_app.
```

Résultats de l'essai (scripts listés en annexe) :
- `keystone_app` et `vigie_app` reçoivent `permission denied for schema cursus` : la convention tient ;
- `matrix_app` lit la vue ; la semaine du 28/09 se range en 28 h en septembre et 15 h en octobre sur HLT-026 ;
- `matrix_app` reçoit `permission denied for table employes` sur `visite` ;
- l'agrégat sépare bien salariés, intérimaires et heures de CFA.

`heures_site_mois_v1` ne calcule pas `complet` : il faudrait les contrats, les absences et les fériés. Si L-07 est accepté, Vigie pourrait la lire sur le serveur commun. L'API resterait la référence.

## 4. Prérequis bloquants

| Prérequis | Groupe (statut) | Ce qu'il faut | Bloque |
|---|---|---|---|
| Correspondance des personnes | D01 (définitive) | Matricule stable et unique dans Cursus : colonne générée `employes.matricule`, identifiants conservés à la reprise (le matricule est calculé depuis `id`, `shared/format.ts:21`). Colonne `employes.email`. Annuaire Cursus (P1). Colonne `persons.matricule` dans Keystone, remplie par rapprochement sur l'e-mail puis sur le nom, avec confirmation à la main. Aujourd'hui, aucun nom n'est commun entre les personnes de démonstration de Cursus et de Keystone. | H1, H2 : lignes en `personne_inconnue` |
| Projets et codes analytiques | D02 option B (définitive) | Codes INT-* et ECOLE créés comme projets internes de Keystone, avec leur code analytique et un indicateur « interne » dans `projects` (absent aujourd'hui). Route P2. Table `projets` de Cursus en miroir (`numero`, `analytique`, `interne`, `actif`). Passage des anciens codes (K-2614…) vers les codes de Keystone, y compris dans `feuilles.lignes[].projet`, par un script journalisé. | H1 : lignes en `projet_inconnu` |
| Lien tâche Cursus ↔ lot WBS Keystone | D05 option A (définitive), NEW-CURSUS-5, R-6a | Route P3 : `GET .../taches?matricule=EMP-0018&semaine=2026-09-28` → `[{tache: "T-2314", projet: "HLT-026", lot: "1.3", heures_prevues: [8,8,8,8,7]}]`. `temps.suggest` la lit avant la transaction et remplit `lignes[].tacheKeystone`. La table `taches` est supprimée. | Le détail par lot. Sans lui, les heures restent au niveau du projet, dans « To assign ». |
| Temps passés | D06 option A (provisoire) | Confirmation de M-03. | La bascule seulement (étape 3 du § 6.1) |
| Absences | D07 option A (définitive) | D01 en place ; codes `conge` et `absence` dans `leave_types`. | H2 |
| Sites | D14 option A (définitive) | Liste publiée par Matrix ; `employes.site` dans Cursus ; identifiants de `vigie.sites` alignés (aujourd'hui `ville-a` et `ville-b`, noms provisoires). | H3 |
| Code des outils | M-05 | Autorisation de modifier Keystone, Cursus et Vigie. | Tout |
| Rôle actuel de Lucca | L-01 | Réponse de la DRH. | La bascule et le retrait |

## 5. Changements par outil

Chaque évolution de base passe par une nouvelle migration, jamais par la modification d'une migration existante. Le journal des migrations reste dans le schéma de l'outil (`migrationsSchema` pour Drizzle, `cursus.schema_migrations` pour Cursus).

### 5.1 Cursus

À faire après l'étape 2 de sa migration vers PostgreSQL (interface `Db` asynchrone, adaptateur SQLite seul), pour ne pas convertir deux fois les nouvelles actions. Ce travail ne dépend pas du passage effectif sur le serveur commun.

| Lot | Fichiers | Contenu | Jours |
|---|---|---|---|
| C1 Données | `server/src/db.ts` (`TABLES`, l. 15-38) ; migration PostgreSQL `server/migrations-pg/0003_echanges_rh.sql` ; `shared/types.ts:101-105` | `employes.email`, `employes.site` ; `feuilles.version`, `valide_le`, `site`, `sage_jours` ; `absences.version`, `valide_le` ; `AbsenceStatut` + `annulee` ; `LigneTemps.tacheKeystone` ; `projets.numero`, `analytique`, `interne`, `actif` ; table `evenements_sortants` (`id`, `cible`, `type`, `cle`, `version`, `message_id` unique, `payload`, `statut`, `tentatives`, `prochain_essai`, `erreur`, `cree_le`, `envoye_le`) ; réglages `sourceHeures`, `codesEcole` ; vues `*_v1` du § 3.9 | 0,5 |
| C2 File d'envoi | `server/src/integrations/keystone.ts` ; nouveau `server/src/integrations/envoi.ts` ; nouveau `server/scripts/renvoyer-keystone.ts` | `sendToKeystone` écrit dans `evenements_sortants`, dans la transaction de l'action. Une boucle envoie hors transaction, toutes les 10 s, avec les renvois du § 3.7. La ligne de `journal` ne garde plus le contenu du message. | 1,5 |
| C3 Contenu des messages | nouveau `shared/rules/echanges.ts` ; `server/src/actions/temps.ts:85-92` ; `server/src/actions/absences.ts:12-36` | Fonctions pures qui construisent les quatre messages et la ventilation par semaine. Appel dans `temps.validate`, `absence.demander`, `absence.decider`. | 1 |
| C4 Corrections | `server/src/actions/temps.ts`, `absences.ts` ; `shared/domain.ts:155`, `shared/rules/conges.ts:128`, `client/src/pages/Missions.tsx:38` ; `client/src/pages/Temps.tsx`, `Absences.tsx` | Actions `temps.rouvrir` (RH) et `absence.annuler`. Règle des totaux par jour pour une feuille déjà transmise à Sage (`sage_jours`, rempli par `temps.pushSage`). Les trois filtres `statut !== 'refusee'` excluent aussi `annulee`. Boutons « Rouvrir » et « Annuler ». | 1 |
| C5 Tâches de Keystone | `server/src/actions/temps.ts:45-65` ; `shared/rules/temps.ts:94-100` ; `server/src/index.ts:99-121` | `temps.suggest` lit P3 avant la transaction et remplit `tacheKeystone`. `temps.addLine` propose les tâches de la semaine. Suppression de `taches` (D05). | 1 |
| C6 Vigie et site | nouveau `shared/rules/heures-site.ts` ; `server/src/index.ts` ; `client/src/pages/Collaborateurs.tsx` ; `temps.submit` (l. 67-75) | Route H3 avec `VIGIE_API_KEY`. Saisie du site du salarié. Site figé sur la feuille à la soumission. | 1 |
| C7 Sécurité | `server/src/index.ts:131-132` | Comparaison en temps constant, une clé par appelant, refus des clés de démonstration hors `CURSUS_DEMO`. | 0,25 |
| C8 Tests | nouveau `tests/echanges.test.ts` ; `tests/server.test.ts` | Messages vérifiés contre les deux fichiers JSON Schema ; ventilation par semaine et par mois ; versions ; réouverture ; renvoi ; doublon ; règle Sage. | 1 |
| **Total Cursus** | | | **7,25** |

### 5.2 Keystone

| Lot | Fichiers | Contenu | Jours |
|---|---|---|---|
| K1 Données | `src/server/db/schema/organisation.ts:32-53`, `resources.ts:100-184`, nouveau `schema/hr-feed.ts`, `codes.ts:277-278` ; migration `drizzle/0006_*.sql` générée par drizzle-kit | `persons.matricule` (unique, nul pour les externes). `hours_imports` : `UNIQUE(project_id, period_start, source)` à la place de `UNIQUE(project_id, period_start)` (l. 156). `unassigned_hours.source_key` et `UNIQUE(import_id, source_key)`. Tables `hr_timesheets`, `hr_timesheet_lines`, `hr_inbound_events` (`message_id` unique, `payload`, `status`, `received_at`). `leave_entries.external_version` et `UNIQUE(source, external_id, week_start)`. Codes `conge` et `absence`. Réglages `hr.hours_source` et `hr.leave_source` (`lucca` par défaut). | 0,5 |
| K2 Route d'entrée | nouveau `src/app/api/integrations/cursus/events/route.ts` ; nouveau `src/server/integrations/cursus/inbound.ts` (clé, taille, zod) | `POST` du § 3.3, réponses du § 3.7, journal `hr_inbound_events`, trace dans l'audit. | 1 |
| K3 Réception et recalcul | nouveaux `src/server/integrations/cursus/timesheets.ts` et `leave.ts` | Copie fidèle, rapprochement, anomalies, recalcul des couples (projet, mois), `tasks.logged_h`, `leave_entries`. Reprise des anomalies quand `persons.matricule` ou un projet change. | 2 |
| K4 Routes lues par Cursus | nouveaux `src/app/api/integrations/cursus/projets/route.ts` et `taches/route.ts` | P2 et P3. Ils servent aussi D02 et D05. | 1 |
| K5 Écrans | `src/server/dal/hr.ts:195-217` (congés), `281-316` (heures), `340-354` (« Assign ») ; `src/features/hr/hours-view.tsx`, `leave-view.tsx`, `primary-buttons.tsx:38-44`, `actions.ts:92-150`, `forms.ts` ; `src/config/screens.ts:73` ; `src/domain/home.ts:606` ; `src/server/dal/shell.ts:286` ; `src/server/dal/integrations.ts` et `src/server/db/seed/settings.ts:45-53` | L'écran Heures lit l'import de la source active et affiche les anomalies. « Assign » désigne la ligne par son `id` au lieu de sa `position`. Le calendrier des congés filtre sur la source active et additionne les jours d'une même semaine : aujourd'hui il ne lit qu'une ligne par personne et par semaine. Les libellés prennent le nom de la source. « Import Lucca » et « Sync Lucca » disparaissent pour la source `cursus`. Ligne Cursus de `connectors` : périmètre « heures, absences ». | 1,5 |
| K6 Import CSV Lucca | `src/server/interchange/table.ts:11-15`, `table-import.ts` | Nouveau type `lucca_hours` pour charger les exports Lucca pendant la marche en parallèle (`source = 'lucca'`). Sert aussi au retour arrière. | 1 |
| K7 Retrait de « Log » (C-2b), à la bascule | `src/features/mywork/task-sheet.tsx:455`, `src/features/mywork/actions.ts:121-127`, `src/server/dal/tasks.ts:317-330` ; `src/server/dal/kpis.ts:178-186` | Plus de saisie dans `time_entries` ; l'historique reste. L'indicateur « Hours logged » de l'accueil lit `hr_timesheet_lines`. | 0,5 |
| K8 Tests | `src/features/hr/*.test.ts`, `src/domain/hr.test.ts`, `src/server/dal/home.test.ts`, `delivery5-writes.test.ts`, `chapter4-foundation.test.ts`, `src/features/admin/*.test.ts`, fichiers golden ; nouveaux tests de la route et du recalcul | Clé, doublon, version ancienne, 400, anomalies, mois à cheval, affectation conservée, annulation, absences. | 1,5 |
| **Total Keystone** | | | **9** |

### 5.3 Vigie

| Lot | Fichiers | Contenu | Jours |
|---|---|---|---|
| V1 Données | `src/db/schema.ts:26-31` ; migration `drizzle/0002_*.sql` | `hours_worked.source` (`demo` pour les lignes existantes), `hours_interim`, `hours_school`, `complete`, `updated_at`. `hours` reste la valeur utilisée par le TF1. | 0,25 |
| V2 Connecteur | nouveau `src/server/integrations/cursus.ts` ; nouveau `src/app/api/integrations/cursus/sync/route.ts` | Lecture de H3, mise à jour des 13 derniers mois. La route est appelée chaque nuit par une tâche planifiée de Coolify avec `VIGIE_SYNC_KEY`. La mise à jour tourne dans le processus de l'application, car PGlite n'accepte qu'un processus. Bouton « Actualiser depuis Cursus » pour l'administration QHSE. | 1 |
| V3 Tableau de bord | `src/lib/data/dashboard.ts:15-33` ; `src/lib/data/audits.ts:145-152` ; `src/app/revue-de-direction/page.tsx:62` | Fenêtre corrigée : `h.month > yearAgo.slice(0, 7)` (l. 31) garde le mois d'il y a un an, donc 13 mois dès que le mois en cours existe. Proposition : 12 mois clos pour les heures et les événements (L-06). Mention « provisoire » si un mois est incomplet. | 0,5 |
| V4 Tests | nouveau test (Vigie n'a pas de script de test dans `package.json`) | Mise à jour des heures et fenêtre de 12 mois. | 0,5 |
| **Total Vigie** | | | **2,25** |

### 5.4 Matrix

| Lot | Contenu | Jours |
|---|---|---|
| M1 Flux | `data/flux.json` : F03 et F14 réécrits, P1 à P3 ajoutés, Lucca en « remplacé (provisoire) ». | 0,25 |
| M2 Contrôles | Contrôle de complétude chaque nuit (§ 6.3) et requête de comparaison (§ 6.2) exécutés avec `matrix_lecture` ; résultat dans l'écran Flux. | 0,75 |
| **Total Matrix** | | **1** |

### 5.5 Récapitulatif

| Outil | Jours |
|---|---|
| Cursus | 7,25 |
| Keystone | 9 |
| Vigie | 2,25 |
| Matrix | 1 |
| **Total de construction** | **19,5** |
| Prérequis D01, D02 option B et D14 (ordre de grandeur, à confirmer dans le plan de convergence) | environ 6,5 |
| Suivi de la marche en parallèle (deux clôtures) | environ 4 |

Cursus, Keystone et Vigie peuvent avancer en même temps une fois les contrats figés.

## 6. Plan de transition

### 6.1 Étapes

| Étape | Contenu | Critère de passage |
|---|---|---|
| 0. Référentiels | D01, D02 option B, D05 et D14 en place pour l'équipe pilote. | 100 % des salariés de l'équipe pilote reliés à une personne Keystone ; 100 % des codes saisis reliés à un projet. |
| 1. Construction | Flux du § 3 construits ; Keystone garde `hr.hours_source = 'lucca'` et `hr.leave_source = 'lucca'` et reçoit les messages Cursus sans les afficher. | Recette de bout en bout : validation, réouverture, nouvelle validation, annulation d'absence, renvoi après une panne de 2 h de Keystone, message en double, version ancienne. |
| 2. Marche en parallèle | Deux clôtures mensuelles sur l'équipe pilote. Lucca reste la référence. Chaque mois, l'export Lucca est chargé dans Keystone (type `lucca_hours`). La requête du § 6.2 tourne chaque semaine et à la clôture ; le contrôle du § 6.3 tourne chaque nuit. | Critères du § 6.4. |
| 3. Bascule (après M-03 et L-01) | Le 1er d'un mois, pour qu'aucun mois ne mélange deux sources : `hr.hours_source` et `hr.leave_source` passent à `cursus`, toutes les équipes saisissent dans Cursus, Vigie prend `source = 'cursus'` à partir de ce mois, la ligne Lucca de `connectors` passe à `enabled = false`, « Log » est retiré. Les absences peuvent basculer plus tôt, dès la réponse à L-01, puisque D07 est tranchée. | Une clôture complète sans retour arrière. |
| 4. Retrait | Reprise des soldes de CP et de RTT si Lucca les tient (table `soldes_reprise` de Cursus) ; libellés Lucca retirés de Keystone ; bouton Lucca de Vigie (`src/components/skills/SkillMatrix.tsx:168`) retiré ; `CLAUDE.md:22` de Vigie mis à jour. | Accord écrit de la DRH, puis arrêt de l'abonnement. |

### 6.2 Requête de comparaison

Elle compare, dans le schéma `keystone`, les heures des deux sources par projet, personne et mois. Elle compte les heures rapprochées (`hours_lines`) et les heures à affecter (`unassigned_hours`), comme le total « déclaré » de l'écran Heures (`src/domain/hr.ts:306-317`). Elle tourne avec `keystone_app` (écran Keystone) ou `matrix_lecture`. Elle a été essayée sur PGlite 0.5.10 avec les deux rôles.

```sql
-- $1 et $2 : premier et dernier mois comparés (1er du mois).
WITH declare AS (
  SELECT i.source, i.project_id, i.period_start, l.person_id, l.declared_h AS h
  FROM keystone.hours_imports i JOIN keystone.hours_lines l ON l.import_id = i.id
  UNION ALL
  SELECT i.source, i.project_id, i.period_start, u.person_id, u.hours
  FROM keystone.hours_imports i JOIN keystone.unassigned_hours u ON u.import_id = i.id
), par_personne AS (
  SELECT project_id, period_start, person_id,
         COALESCE(sum(h) FILTER (WHERE source = 'lucca'), 0)  AS h_lucca,
         COALESCE(sum(h) FILTER (WHERE source = 'cursus'), 0) AS h_cursus
  FROM declare
  WHERE period_start BETWEEN $1::date AND $2::date
  GROUP BY 1, 2, 3
), par_projet AS (
  SELECT project_id, period_start, sum(h_lucca) AS p_lucca, sum(h_cursus) AS p_cursus
  FROM par_personne GROUP BY 1, 2
)
SELECT pr.code AS projet, to_char(pp.period_start, 'YYYY-MM') AS mois,
       COALESCE(pe.matricule, pe.short_name) AS personne,
       pp.h_lucca, pp.h_cursus, pp.h_cursus - pp.h_lucca AS ecart_h,
       abs(pp.h_cursus - pp.h_lucca) > 4 AS hors_seuil_personne,
       round(100 * (pj.p_cursus - pj.p_lucca) / NULLIF(pj.p_lucca, 0), 1) AS ecart_projet_pct,
       abs(pj.p_cursus - pj.p_lucca) > 0.02 * pj.p_lucca AS hors_seuil_projet
FROM par_personne pp
JOIN par_projet pj USING (project_id, period_start)
JOIN keystone.projects pr ON pr.id = pp.project_id
JOIN keystone.persons pe ON pe.id = pp.person_id
ORDER BY projet, mois, abs(pp.h_cursus - pp.h_lucca) DESC, personne;
```

Les lignes en anomalie `personne_inconnue` ou `projet_inconnu` ne sont pas projetées : elles n'apparaissent pas dans cette requête. Elles comptent dans le critère « zéro anomalie » du § 6.4.

### 6.3 Contrôle de complétude

Il vérifie, chaque nuit, qu'aucun message ne s'est perdu entre Cursus et Keystone. Il tourne avec `matrix_lecture`, le rôle de lecture de Matrix, qui voit les deux schémas. Il suppose Cursus sur le serveur commun. Avant cela, la file d'envoi de Cursus (statuts `rejete` et `en_erreur`) tient ce rôle.

```sql
-- Les validations de moins d'une heure sont ignorées : leurs messages peuvent être encore en file.
SELECT c.feuille_id, c.matricule, c.semaine, c.version AS version_cursus, k.version AS version_keystone,
       CASE WHEN k.external_id IS NULL THEN 'absente' ELSE 'version en retard' END AS ecart
FROM (SELECT DISTINCT feuille_id, matricule, semaine, version, valide_le FROM cursus.heures_validees_v1) c
LEFT JOIN keystone.hr_timesheets k ON k.source = 'cursus' AND k.external_id = c.feuille_id::text
WHERE (k.external_id IS NULL OR k.version < c.version)
  AND c.valide_le < now() - interval '1 hour'
UNION ALL
SELECT k.external_id::int, k.matricule, k.week_start, NULL, k.version, 'annulation non reçue'
FROM keystone.hr_timesheets k
WHERE k.source = 'cursus' AND k.status = 'validated'
  AND k.received_at < now() - interval '1 hour'
  AND NOT EXISTS (SELECT 1 FROM cursus.heures_validees_v1 c WHERE c.feuille_id::text = k.external_id)
ORDER BY 1;
```

L'essai a bien signalé une feuille absente de Keystone et une feuille reçue en version 1 alors que Cursus est en version 2.

### 6.4 Critères de bascule

Tous doivent être remplis sur les deux clôtures de la marche en parallèle :

| Critère | Seuil |
|---|---|
| Écart par projet et par mois | 2 % au plus |
| Écart par personne, projet et mois | 4 h au plus |
| Écarts restants | Chacun expliqué par écrit (oubli de saisie, correction tardive, erreur de code) |
| Anomalies `personne_inconnue` et `projet_inconnu` à la clôture | Zéro |
| Contrôle de complétude (§ 6.3) ou file d'envoi de Cursus | Vide sept nuits de suite avant la clôture |
| Paie | Variables Sage Paie de l'équipe pilote identiques à celles de la paie réelle du mois (contrôle utile si la paie passe aujourd'hui par Lucca, L-01) |
| Vigie | TF1 et TG calculés sur les heures Cursus présentés à la HSE et acceptés |
| Décisions | M-03 confirmée par l'utilisateur ; L-01 tranchée par la DRH |

### 6.5 Retour arrière si Lucca est conservé

D06 passerait alors à l'option B (« Lucca fait foi ; Cursus et Keystone importent ») ou C.

| Outil | Action |
|---|---|
| Keystone | `hr.hours_source` revient à `lucca`. Les heures Lucca arrivent par l'import CSV `lucca_hours` (lot K6), ou par un adaptateur Lucca qui produit `epc2i.heures.validees/1` avec `source = 'lucca'` vers la même route. Le coût de cet adaptateur dépend de l'API Lucca, non étudiée. Recalcul, écrans et requêtes ne changent pas. |
| Cursus | `sourceHeures` passe à `lucca` : plus de message `heures.*`. Les absences continuent (D07 est définitive), sauf réponse contraire à L-01. Avec l'option B, Cursus garde la validation et importe les heures Lucca : coût à chiffrer à ce moment-là. |
| Vigie | Continue de lire Cursus si Cursus garde les feuilles validées. Sinon, `source = 'lucca'` par un import à prévoir. |
| Données | Rien n'est supprimé. `hr_timesheets` garde l'historique reçu de Cursus. |

Pendant la première clôture après la bascule, le retour arrière consiste seulement à remettre les deux réglages à `lucca` : les imports Lucca de la marche en parallèle sont encore là.

## 7. Questions ouvertes

| N° | Question | Pour qui | Bloque |
|---|---|---|---|
| L-01 | Quel est le rôle actuel de Lucca ? Modules en service ; envoi d'absences, d'arrêts maladie ou de primes à Sage Paie ; notes de frais ; soldes de CP et de RTT à reprendre. Cursus n'envoie à Sage Paie que des rubriques d'heures (`shared/rules/temps.ts:102-141`). | DRH | Bascule et retrait |
| L-02 | Le matricule `EMP-0018` de Cursus est-il le matricule de paie connu de Sage Paie ? Cursus l'envoie déjà comme tel (`shared/rules/temps.ts:136`). Sinon, quel identifiant faut-il porter dans `employes.matricule` ? | DRH | D01 |
| L-03 | D'où viennent les heures prévues (`hours_lines.planned_h` et `heures_prevues` de P3) : `activity_assignments.planned_hours` au prorata, ou `tasks.estimate_h` ? | Utilisateur (Keystone) | Écran Heures |
| L-04 | Majorations : la feuille Cursus a 5 jours, sans nuit, dimanche ni astreinte, et ses heures supplémentaires sont hebdomadaires ; Keystone majore au-delà de 8 h par jour (`rate_multipliers`). Faut-il étendre la feuille Cursus, ou simplifier la valorisation de Keystone ? Si la feuille est étendue, le contrat gagne un champ facultatif `rubriques`. | Utilisateur, DRH | Valorisation (C-2a) |
| L-05 | Intérimaires : leurs heures valorisées au taux du rôle s'ajoutent-elles aux factures de l'agence reçues dans Sage X3 ? Si oui, le coût réel compte deux fois (C-2a). | Utilisateur (contrôle de gestion) | Valorisation |
| L-06 | TF1 et TG de Vigie : compter les heures des intérimaires ? celles des cours en CFA ? calculer sur 12 mois clos ? | HSE | Tableau de bord Vigie |
| L-07 | Accepte-t-on une exception à la convention (`USAGE` sur le schéma `cursus` et `SELECT` sur une vue pour `keystone_app` ou `vigie_app`) ? Recommandation : non (§ 3.9). | Utilisateur | Rien |
| L-08 | Dans Keystone, la catégorie seule (congé ou absence) suffit-elle, ou faut-il le détail CP, RTT, RECUP ? Qui fournit la maladie et la formation, que Keystone affiche aujourd'hui (`sick`, `training`) ? | Utilisateur | Écran Congés |
| L-09 | Quelle régularisation de paie pour une feuille déjà transmise à Sage Paie dont les totaux par jour changent ? | DRH | Corrections |
| L-10 | Quelle équipe pilote et quels mois pour la marche en parallèle ? La DRH accepte-t-elle une double saisie Lucca et Cursus pendant deux mois ? | DRH | Étape 2 |
| L-11 | Depuis quelle date envoie-t-on à Keystone les feuilles déjà validées dans Cursus ? | Utilisateur | Mise en service |
| L-12 | Combien de temps Keystone garde-t-il les messages reçus (`hr_inbound_events`) ? Proposition : 13 mois. | DPO | Mise en service |
| L-13 | Les documents de Keystone présentent Lucca comme déjà retiré (`docs/BACKLOG.md:52`, `CLAUDE.md:32`, contexte de C-2a dans `docs/DECISIONS.md`). Qui les aligne sur le statut provisoire de M-03, et quand ? | Utilisateur | Rien |

## Annexe : vérifications

Vérifié dans le code :
- `hours_imports` : `UNIQUE(project_id, period_start)` (`src/server/db/schema/resources.ts:156`), ce qui interdit deux sources sur le même mois ;
- « Assign » cherche la ligne par sa `position` (`src/server/dal/hr.ts:340-354`) ;
- le calendrier des congés ne lit qu'une ligne par personne et par semaine (`src/server/dal/hr.ts:213`) ;
- Keystone n'a aucune route d'appel machine : seules `api/tasks`, `api/export`, `api/import` et `api/interchange` existent ;
- les deux applications de bureau tournent sans serveur distant (`desktop/KeystoneApp.swift:105-108`, `desktop/CursusApp.swift:78-82`) ;
- Cursus : aucune action ne rouvre une feuille validée ni n'annule une absence ; `temps.submit` refuse une feuille sans heure ; la saisie couvre 5 jours (`setCell`, `di < 5`) ;
- Cursus : `checkAbsence` refuse une absence de zéro jour décompté (`shared/rules/conges.ts:143`) ;
- Vigie : `hours_worked` n'est écrit que par le seed ; le filtre de `dashboard.ts:31` garde 13 mois dès que le mois en cours est présent.

Essais sur PGlite 0.5.10 (PostgreSQL 18.6), dans le dossier de travail temporaire `/tmp/claude-0/-home-user-Matrix/d8a2a4dd-fe98-51a8-8dc7-fc86068b1112/scratchpad/wf/lucca/` (non versionné) :
- `essai.sql` et `run.mjs` : rôles et schémas de la convention, vues `*_v1`, droits, requête de comparaison avec `keystone_app` et `matrix_app`, contrôle de complétude ;
- `valider.py` : les deux fichiers JSON Schema sont valides (draft 2020-12) ; leurs exemples passent ; sont refusés un champ inconnu (`visite`, `motif`, `nature`, `libelle`), des heures à zéro, une version 0, une date impossible, un numéro de tâche mal formé, une ligne sans projet ni code analytique.
