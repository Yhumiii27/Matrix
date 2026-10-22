# Image du serveur PostgreSQL commun EPC2I : l'image officielle avec les fichiers du socle copiés dedans.
# Coolify ne fournit pas au conteneur les fichiers du dépôt montés par chemin relatif (un fichier monté y devient un
# dossier vide) : ils sont donc copiés à la construction. Après une modification de ces fichiers, redéployer.
# PostgreSQL 16 (décision du 15/10/2026). Retour en 16 le 22/10/2026 : le passage à 18 (proposition P-01) a été
# déployé sur le volume de production initialisé en 16, que l'image 18 refuse d'ouvrir (boucle de redémarrage). Le
# passage à 18 se fera avec la reprise des données (README, « Version de PostgreSQL »).
FROM postgres:16-bookworm

COPY init/ /docker-entrypoint-initdb.d/
COPY sauvegarde/ /opt/epc2i/sauvegarde/
COPY partage/ /opt/epc2i/partage/
COPY verifier-droits.sql /opt/epc2i/verifier-droits.sql
