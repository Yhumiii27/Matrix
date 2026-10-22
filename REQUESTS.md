# Requêtes inter-applications
Format d'une entrée :
## [YYYY-MM-DD] <app demandeuse> → <cette app> — <titre court>
- Statut : OUVERTE | ACCEPTÉE | REFUSÉE | FAITE
- Demande : (quoi)
- Justification : (pourquoi, impact sur l'app demandeuse)
- Détails techniques : (tables, champs, types, endpoints, exemples)
- Validé par Guillaume le : (date)

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
