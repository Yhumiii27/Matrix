# Requêtes inter-applications
Format d'une entrée :
## [YYYY-MM-DD] <app demandeuse> → <cette app> — <titre court>
- Statut : OUVERTE | ACCEPTÉE | REFUSÉE | FAITE
- Demande : (quoi)
- Justification : (pourquoi, impact sur l'app demandeuse)
- Détails techniques : (tables, champs, types, endpoints, exemples)
- Validé par Guillaume le : (date)

> Entrées recopiées le 22/10/2026 depuis les fichiers `docs/DEMANDES-MATRIX.md` d'Arche et de Crucible, rédigés avant
> l'ouverture de cette boîte aux lettres. Le détail technique complet reste dans ces fichiers.

## [2026-10-22] Arche → Matrix — M-1 · Rôle `arche_app`
- Statut : FAITE
- Demande : rôle de connexion `arche_app` (mot de passe `ARCHE_APP_PASSWORD`, SCRAM), accordé à `matrix_admin`, `CONNECT` sur `epc2i`.
- Justification : Arche tourne sur PostgreSQL uniquement, sur le serveur commun.
- Détails techniques : `infra/postgres/init/01-base-et-roles.sql`. Fait dans Yhumiii27/Matrix#10.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Matrix — M-2 · Schéma `arche`
- Statut : FAITE
- Demande : schéma `arche` propriété de `arche_app`, `search_path` et délai d'inactivité en transaction.
- Justification : les tables d'Arche sont déclarées dans son schéma (`arche.table(…)`).
- Détails techniques : `init/02-schemas.sql`. Fait dans Yhumiii27/Matrix#10.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Matrix — M-3 · Droits de base et colonnes sensibles
- Statut : FAITE (avec un écart)
- Demande : `arche` / `arche_app` partout où les outils sont énumérés (droits par défaut, contraintes du schéma `droits`, `droits.verifier()`) ; colonnes sensibles `users.email`, `users.entra_object_id`, `signatures.ip_hash`.
- Justification : Matrix lit les tables d'Arche sans les données d'identité ni de sécurité.
- Détails techniques : `init/03-droits.sql`. Écart : `users.email` n'est pas protégée, parce que `arche.pub_capex` publie `sponsor_email` et `chef_projet_email` (une vue `pub_` ne peut pas lire une colonne sensible). La protéger demanderait une `pub_capex_v2` sans ces colonnes.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Matrix — M-4 · Fichier de partage `70-arche.sql`
- Statut : FAITE
- Demande : copie qualifiée des vues `pub_` d'Arche, rejouable.
- Justification : convention de partage (règle P-02 : l'outil crée ses vues, Matrix en garde la copie).
- Détails techniques : `partage/70-arche.sql` : `arche.pub_journal`, `arche.pub_capex`. `pub_besoins_machines` et `pub_rampup` viendront avec les livraisons d'Arche qui les créent.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Matrix — M-5 · Droits des lecteurs
- Statut : FAITE
- Demande : Arche lit les vues `pub_` de Keystone (projets, livrables, parc machines, puis les vues R-186 à R-191), de Codex (documents, révisions, validations, types) et de Matrix (pays, sites, organigramme) ; Keystone et Matrix lisent `arche.pub_capex`, `pub_besoins_machines`, `pub_rampup`, Matrix `arche.pub_journal`.
- Justification : liens d'Arche avec les projets EPC2i et les documents.
- Détails techniques : `partage/90-droits.sql`. Les vues pas encore publiées sont signalées sans erreur.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Matrix — M-6 · Journal unifié
- Statut : FAITE
- Demande : ajouter `arche.pub_journal` à `matrix.journal_unifie`.
- Justification : décision D18 (journaux consultés ensemble par Matrix).
- Détails techniques : `partage/95-matrix-journal-unifie.sql`.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Matrix — M-7 · Sauvegardes et vérifications
- Statut : FAITE
- Demande : schéma `arche` dans la sauvegarde ; cas d'essai d'`arche_app` dans le contrôle des droits.
- Justification : même niveau de garantie que les autres outils.
- Détails techniques : `sauvegarde/sauvegarder.sh` ; `verifier-droits.sql`, cas 160 à 165.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Matrix — M-8 · Déclaration des tables
- Statut : FAITE
- Demande : accepter `app: 'arche'` sur `/api/declarations` ; Arche dans le collecteur et le catalogue.
- Justification : Arche déclarera ses tables avec son connecteur Matrix.
- Détails techniques : `serveur.mjs`, `outils/collecteur.mjs`, `data/catalogue.json`.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Matrix — M-9 · Filiales dans le référentiel d'organisation
- Statut : FAITE
- Demande : zones, filiales (code à 3 lettres, pays, zone, devise) et leurs sites publiés par Matrix.
- Justification : Arche pilote les CAPEX par filiale ; la filiale est aussi le client des projets EPC2i dans Keystone.
- Détails techniques : décision D21 (option A, Matrix fait foi) : `matrix.zones`, `matrix.filiales`, `matrix.sites.filiale_code` ; vues `pub_zones`, `pub_filiales`, `pub_sites`. Listes encore vides, en attente de la liste réelle des filiales. Côté Arche, ses tables `zones`, `subsidiaries` et `sites` deviennent des miroirs.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Crucible → Matrix — M-1 · Rôle `crucible_app`
- Statut : FAITE
- Demande : rôle de connexion `crucible_app` (`CRUCIBLE_APP_PASSWORD`, SCRAM), accordé à `matrix_admin`, `CONNECT` sur `epc2i`.
- Justification : Crucible tourne sur PostgreSQL uniquement, sur le serveur commun.
- Détails techniques : `init/01-base-et-roles.sql`. Fait dans Yhumiii27/Matrix#14.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Crucible → Matrix — M-2 · Schéma `crucible`
- Statut : FAITE
- Demande : schéma `crucible` propriété de `crucible_app`, `search_path` et délai d'inactivité en transaction.
- Justification : les tables de Crucible sont déclarées dans son schéma (`crucible.table(…)`).
- Détails techniques : `init/02-schemas.sql`. Fait dans Yhumiii27/Matrix#14.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Crucible → Matrix — M-3 · Droits de base et colonnes sensibles
- Statut : FAITE
- Demande : `crucible` / `crucible_app` partout où les outils sont énumérés ; colonnes sensibles `crucible.users.email` et `crucible.users.entra_object_id`.
- Justification : Matrix lit les tables de Crucible sans les données d'identité.
- Détails techniques : `init/03-droits.sql` ; les deux colonnes sont fermées à `matrix_lecture` ; cas 170 à 175 de `verifier-droits.sql`.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Crucible → Matrix — M-4 · Partage et droits des lecteurs
- Statut : FAITE
- Demande : fichier `partage/80-crucible.sql` ; Crucible lit `keystone.pub_projets` (puis les jalons), `cursus.pub_salaries`, `pub_titres`, `pub_titres_detenus` (puis `pub_absences`), `codex.pub_documents`, `pub_revisions_document`, `matrix.pub_sites`, `pub_organigramme` ; Keystone et Vigie lisent `crucible.pub_reservations` et `pub_moyens`.
- Justification : planifier les essais à partir des projets, des opérateurs habilités et des documents ; publier les réservations pour le planning des projets et la coactivité.
- Détails techniques : `partage/80-crucible.sql` (copie de `crucible.pub_journal`) et `partage/90-droits.sql`. Complété par Yhumiii27/Matrix#15 : `matrix.pub_filiales` (D21), `vigie.pub_controles` et `pub_suspensions_essais` (D23) accordées à `crucible_app`.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Crucible → Matrix — M-5 · Journal unifié, déclaration et catalogue
- Statut : FAITE
- Demande : `crucible.pub_journal` dans le journal unifié ; application `crucible` acceptée par `/api/declarations`, le catalogue et le collecteur.
- Justification : décision D18 ; Crucible visible dans la bibliothèque et le graphe de Matrix.
- Détails techniques : `partage/95-matrix-journal-unifie.sql`, `serveur.mjs`, `outils/collecteur.mjs`, `data/catalogue.json` (11 tables), flux F22 à F27, doublons (D23 nouveau).
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Crucible → Matrix — M-6 · Sites du laboratoire 67 et du PDE, entité EPC France
- Statut : OUVERTE
- Demande : ajouter au référentiel des sites de Matrix le site du laboratoire 67 et celui du PDE, s'ils ne sont pas Lyon, Le Havre ou Marseille ; ajouter EPC France à la liste des filiales (D21).
- Justification : `crucible.sites` et `crucible.entities` doivent reprendre les codes de Matrix (décisions D14 et D21) au lieu de tenir leur propre liste.
- Détails techniques : saisie dans l'écran « Référentiels » de Matrix (`data/referentiels.json`, tables `matrix.sites` et `matrix.filiales`). Il manque la localisation des deux sites (question P-1 de Crucible) et le code à 3 lettres d'EPC France.
- Validé par Guillaume le :

## [2026-10-22] Vigie → Matrix — Déclarer sensibles les colonnes de santé des maladies professionnelles
- Statut : OUVERTE
- Demande : ajouter à la liste des colonnes sensibles de Matrix les 6 colonnes de `vigie.events` créées par la migration 0010 de Vigie pour les maladies professionnelles (type d'événement `MP`) : `mp_table`, `mp_disease`, `mp_certificate_on`, `mp_informed_on`, `mp_questionnaire_received_on`, `mp_questionnaire_returned_on` ; puis rejouer `infra/postgres/init/03-droits.sql` et `infra/postgres/partage/90-droits.sql` et contrôler par `droits.verifier()`.
- Justification : ce sont des données de santé (Vigie : `HEALTH_LABELS` de `src/components/events/shared.ts`, réservées à l'animateur QHSE et à la direction). Une colonne absente de la liste est lisible par `matrix_lecture` dès sa création (`infra/postgres/README.md`, § colonnes sensibles) : sur tout serveur où Vigie a passé sa migration 0010, Matrix peut lire la maladie déclarée, le tableau de maladie professionnelle et les dates du certificat médical. Vigie ne peut pas s'en protéger seul (droits posés par Matrix) ; sa procédure de déploiement (`docs/EXPLOITATION.md` § 2) interdit de passer 0010 sur le serveur commun avant cette correction.
- Détails techniques :
  - `init/03-droits.sql`, bloc des colonnes sensibles de la convention (à la suite des colonnes santé des accidents du travail) :
    `('vigie', 'events', 'mp_table', 'Santé : tableau de maladie professionnelle', 'convention')`,
    `('vigie', 'events', 'mp_disease', 'Santé : maladie professionnelle déclarée', 'convention')`,
    `('vigie', 'events', 'mp_certificate_on', 'Santé : date du certificat médical initial (maladie professionnelle)', 'convention')`,
    `('vigie', 'events', 'mp_informed_on', 'Santé : date d''information par la CPAM (maladie professionnelle)', 'convention')`,
    `('vigie', 'events', 'mp_questionnaire_received_on', 'Santé : questionnaire employeur reçu le (maladie professionnelle)', 'convention')`,
    `('vigie', 'events', 'mp_questionnaire_returned_on', 'Santé : questionnaire employeur retourné le (maladie professionnelle)', 'convention')`.
  - Mêmes entrées dans `v_sensibles` de `partage/90-droits.sql`.
  - Documentation : « 10 colonnes de santé » devient 16 (`docs/architecture-postgres.md`, `docs/convergence-des-donnees.md`, README de `infra/postgres`).
  - Point lié, hors de cette demande (à arbitrer, avis du DPO) : la ligne entière d'une maladie professionnelle (victime, date, description) reste lisible tant que la protection est par colonne.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Matrix — M-10 · Partager `arche.pub_besoins_machines` dans `70-arche.sql`
- Statut : OUVERTE
- Demande : ajouter à `partage/70-arche.sql` la copie qualifiée de la vue `arche.pub_besoins_machines`, créée par la migration `drizzle/0009_share_needs.sql` d'Arche (livraison 4, fusionnée le 22 oct. 2026).
- Justification : les droits de lecture sont déjà posés dans `90-droits.sql` (lecteurs `keystone_app`, `matrix_app`) mais la vue n'est pas dans le fichier de partage que Matrix rejoue : elle n'existe sur le serveur que tant qu'Arche l'a créée.
- Détails techniques : prérequis supplémentaire `to_regclass('arche.machine_needs')`. Définition (contrat v1, brouillons non publiés) :
  ```sql
  CREATE OR REPLACE VIEW "arche"."pub_besoins_machines" WITH (security_barrier) AS
  SELECT c.code || '/B' || lpad(n.number::text, 2, '0') AS besoin_ref, c.code AS capex_code,
         'B' || lpad(n.number::text, 2, '0') AS ligne, n.catalogue_code, n.catalogue_version, n.free_label AS libelle_libre,
         n.quantity AS quantite, n.options, n.target_capacity AS capacite_visee, n.capacity_unit AS unite_capacite,
         n.need_date AS date_besoin, si.name AS site, n.status AS statut, n.comment AS commentaire,
         n.submitted_at AS soumis_le, n.ordered_on AS commande_le, n.updated_at AS maj_le
  FROM "arche"."machine_needs" n JOIN "arche"."capex" c ON c.id = n.capex_id LEFT JOIN "arche"."sites" si ON si.id = c.site_id
  WHERE n.status <> 'draft';
  COMMENT ON VIEW "arche"."pub_besoins_machines" IS 'Contrat v1 : besoins machines soumis à EPC2i (hors brouillons). Lecteurs : keystone_app, matrix_app.';
  ```
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Matrix — M-11 · Coordonnées des sites dans `pub_sites`
- Statut : OUVERTE
- Demande : ajouter à `matrix.sites` deux colonnes `latitude` et `longitude` (numeric, degrés décimaux WGS 84, facultatives) et les publier **en fin de vue** `matrix.pub_sites` (après `filiale_code`).
- Justification : Arche ajoute une carte interactive des CAPEX (reprise de la carte des projets de Keystone). Depuis D21, les sites d'Arche sont un miroir de `matrix.pub_sites` : sans coordonnées publiées par Matrix, aucun CAPEX ne peut être placé sur la carte en production (en attendant, Arche garde des coordonnées de démonstration dans sa propre table).
- Détails techniques : `latitude numeric(9,6)` entre −90 et 90, `longitude numeric(9,6)` entre −180 et 180 (contrôles `CHECK`), nulles tant qu'elles ne sont pas saisies. Exemples : usine de Kénitra 34.261 / −6.580 ; site de Thiès 14.791 / −16.926. Arche lit `code`, `libelle`, `ville`, `pays_iso2`, `filiale_code`, `latitude`, `longitude`. Contrat D14 inchangé pour les lecteurs actuels (colonnes en fin de vue).
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Arche → Matrix — M-12 · Cadre géographique des zones dans `pub_zones`
- Statut : OUVERTE
- Demande : ajouter à `matrix.zones` le cadre de chaque zone, `ouest`, `nord`, `est`, `sud` (numeric, degrés), publié **en fin de vue** `matrix.pub_zones`.
- Justification : le bouton « Zone » de la carte d'Arche cadre la vue sur la zone sélectionnée, comme `ZONE_BOUNDS` dans Keystone. Sans ce cadre, Arche le calcule à partir des sites de la zone (moins net, aucun blocage).
- Détails techniques : quatre colonnes `numeric(6,2)` facultatives, `ouest < est`, `sud < nord`. Exemples : AFN −18 / 38 / 12 / 18 ; AFO −20 / 26 / 16 / 2 ; EUR −12 / 62 / 34 / 34.
- Validé par Guillaume le : 2026-10-22

## [2026-10-22] Crucible → Matrix — M-7 · Copie de pub_moyens et pub_reservations dans partage/80-crucible.sql
- Statut : OUVERTE
- Demande : recopier à l'identique dans `infra/postgres/partage/80-crucible.sql` les deux vues créées par la migration `drizzle/0005_share_resources.sql` de Crucible (livraison 3, fusionnée dans Yhumiii27/Crucible#5) : `crucible.pub_moyens` et `crucible.pub_reservations`, avec leurs commentaires ; compléter le prérequis du fichier (`to_regclass('crucible.bookings')`, migrations 0000 à 0005). Aucun nouveau droit : `90-droits.sql` accorde déjà ces deux vues à `keystone_app`, `vigie_app` et `matrix_app`.
- Justification : règle P-02 de Matrix (le fichier de partage recrée à l'identique les vues `pub_` de chaque outil). Sans la copie, les vues existent quand même sur le serveur (la migration de Crucible les crée), mais `80-crucible.sql` ne les connaît pas : un rejeu ou un contrôle du partage les ignore.
- Détails techniques : `pub_moyens` (`code`, `nom`, `nature`, `installation_code`, `installation`, `site_code`, `entite_exploitante`, `capacite`, `granularite`, `etat`, `maj_le`) ; `pub_reservations` (`ref`, `moyen_code`, `installation_code`, `site_code`, `entite_code`, `projet_code`, `projet_keystone`, `objet`, `confidentiel`, `statut`, `debut`, `fin`, `debut_reel`, `fin_reel`, `maj_le`) — réservations confirmées, en cours ou terminées ; projet, projet Keystone et objet nuls pour un projet confidentiel (décision S-7 de Crucible). Les deux vues `WITH (security_barrier)`, propriétaire `crucible_app`, aucune colonne sensible, aucune dépendance hors du schéma `crucible`. Source exacte : `drizzle/0005_share_resources.sql` du dépôt Crucible.
- Validé par Guillaume le : 2026-10-22

## [2026-10-23] Crucible → Matrix — M-8 · Copie de pub_occupation_hebdo dans partage/80-crucible.sql
- Statut : OUVERTE
- Demande : recopier à l'identique dans `infra/postgres/partage/80-crucible.sql` la vue `crucible.pub_occupation_hebdo` créée par la migration `drizzle/0009_share_weekly.sql` de Crucible (livraison 5, fusionnée dans Yhumiii27/Crucible#8), avec son commentaire ; compléter le prérequis du fichier (`to_regclass('crucible.weekly_snapshots')`, migrations 0000 à 0009) ; accorder `SELECT` sur la vue à `matrix_app` dans `partage/90-droits.sql`.
- Justification : règle P-02 de Matrix (le fichier de partage recrée à l'identique les vues `pub_` de chaque outil) ; Matrix lit l'historique hebdomadaire d'occupation des moyens d'essais (dont le PDE, ≈ 3 M€ occupé à ≈ 30 %), décision X-4 de Crucible. Sans la copie et le droit, la vue existe sur le serveur (la migration de Crucible la crée) mais Matrix ne peut pas la lire et un rejeu du partage l'ignore.
- Détails techniques : une ligne par semaine terminée et par moyen, calculée une seule fois puis jamais recalculée. Taux en % des heures ouvertes nettes (décision P-5), nul sans heures ouvertes. Aucune colonne sensible, aucune dépendance hors du schéma `crucible`. Définition (contrat v1) :
  ```sql
  CREATE OR REPLACE VIEW "crucible"."pub_occupation_hebdo" WITH (security_barrier) AS
  SELECT s.monday AS semaine, r.code AS moyen_code, r.facility_code AS installation_code,
         s.net_open_hours AS heures_ouvertes_nettes, s.booked_hours AS heures_reservees, s.realised_hours AS heures_realisees,
         s.realised_with_prep_hours AS heures_realisees_preparation, s.blocked_hours AS heures_bloquees,
         s.no_shows AS reservations_non_tenues,
         CASE WHEN s.net_open_hours > 0 THEN round((100 * s.realised_with_prep_hours / s.net_open_hours)::numeric, 1) END AS taux_realise_pct,
         s.computed_at AS maj_le
  FROM "crucible"."weekly_snapshots" s JOIN "crucible"."resources" r ON r.id = s.resource_id;
  COMMENT ON VIEW "crucible"."pub_occupation_hebdo" IS 'Contrat v1 : occupation hebdomadaire par moyen (instantanés X-4). Lecteurs : matrix_app.';
  ```
- Validé par Guillaume le : 2026-10-23
