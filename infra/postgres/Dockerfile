# Image du serveur PostgreSQL commun de la suite Atrium : l'image officielle avec les fichiers du socle copiés dedans.
# Coolify ne fournit pas au conteneur les fichiers du dépôt montés par chemin relatif (un fichier monté y devient un
# dossier vide) : ils sont donc copiés à la construction. Après une modification de ces fichiers, redéployer.
# PostgreSQL 16 (décision du 15/10/2026, confirmée le 22/10/2026 : question P-01, « Rester en 16 »). Le serveur en
# service tourne en 16 : changer de version majeure demande une sauvegarde et une restauration (ou pg_upgrade), jamais
# un simple changement d'étiquette. Pour figer la version mineure, remplacer par postgres:16.x-bookworm.
FROM postgres:16-bookworm

COPY init/ /docker-entrypoint-initdb.d/
COPY sauvegarde/ /opt/atrium/sauvegarde/
COPY partage/ /opt/atrium/partage/
COPY renommage/ /opt/atrium/renommage/
COPY ajouts/ /opt/atrium/ajouts/
COPY verifier-droits.sql /opt/atrium/verifier-droits.sql
# Renommage de la suite en Atrium (docs/renommage-atrium.md) : l'ancien chemin /opt/epc2i reste un lien vers
# /opt/atrium, pour que les tâches planifiées de Coolify écrites avant le renommage (sh /opt/epc2i/…) continuent de
# marcher jusqu'à leur mise à jour. À retirer à l'étape « Nettoyage » de la fiche.
RUN ln -s /opt/atrium /opt/epc2i
