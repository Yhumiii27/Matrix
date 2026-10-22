# Image du serveur PostgreSQL commun EPC2I : l'image officielle avec les fichiers du socle copiés dedans.
# Coolify ne fournit pas au conteneur les fichiers du dépôt montés par chemin relatif (un fichier monté y devient un
# dossier vide) : ils sont donc copiés à la construction. Après une modification de ces fichiers, redéployer.
# PostgreSQL 18 : proposition du 22/10/2026, à confirmer (question P-01 de docs/architecture-postgres.md ; 16 depuis le
# 15/10/2026). Codex exige 18 (collation pg_unicode_fast), comme PGlite 0.5. Pour figer la version mineure, remplacer
# par postgres:18.x-bookworm. Depuis la 18, l'image range les données sous /var/lib/postgresql/18/docker : le volume se
# monte sur /var/lib/postgresql (docker-compose.yml).
FROM postgres:18-bookworm

COPY init/ /docker-entrypoint-initdb.d/
COPY sauvegarde/ /opt/epc2i/sauvegarde/
COPY partage/ /opt/epc2i/partage/
COPY verifier-droits.sql /opt/epc2i/verifier-droits.sql
