# Image du serveur PostgreSQL commun EPC2I : l'image officielle avec les fichiers du socle copiés dedans.
# Coolify ne fournit pas au conteneur les fichiers du dépôt montés par chemin relatif (un fichier monté y devient un
# dossier vide) : ils sont donc copiés à la construction. Après une modification de ces fichiers, redéployer.
# PostgreSQL 16 (décision du 15/10/2026). Pour figer la version mineure, remplacer par postgres:16.x-bookworm.
FROM postgres:16-bookworm

COPY init/ /docker-entrypoint-initdb.d/
COPY sauvegarde/ /opt/epc2i/sauvegarde/
COPY partage/ /opt/epc2i/partage/
COPY verifier-droits.sql /opt/epc2i/verifier-droits.sql
