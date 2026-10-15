#!/bin/sh
# Sauvegarde logique du serveur commun EPC2I : un fichier pg_dump par schéma, plus les rôles.
#
# Dans le conteneur postgres (tâche planifiée Coolify, ou à la main) :
#   docker compose exec postgres sh /opt/epc2i/sauvegarde/sauvegarder.sh
# Depuis un autre poste (pg_dump 16 ou plus) :
#   PGHOST=<hôte> PGPASSWORD=<mot de passe de epc2i_sauvegarde> EPC2I_SAUVEGARDE_DIR=./sauvegardes sh sauvegarder.sh
#
# Variables :
#   EPC2I_SAUVEGARDE_DIR   dossier de destination (défaut /sauvegardes, volume epc2i_sauvegardes)
#   EPC2I_SAUVEGARDE_JOURS rétention en jours (défaut 14)
#   PGHOST, PGPORT         serveur (défaut : socket local du conteneur)
#   PGUSER                 défaut epc2i_sauvegarde (membre de pg_read_all_data)
#   PGPASSWORD             défaut EPC2I_SAUVEGARDE_PASSWORD
#
# Résultat : <dossier>/<AAAA-MM-JJ_HHMMSS>/{keystone,codex,cursus,vigie,matrix,droits}.dump, roles.sql, SHA256SUMS.
# Le dossier n'apparaît sous son nom définitif qu'une fois toutes les copies réussies.
# Les fichiers contiennent les données sensibles de Cursus et de Vigie : ils sont créés en lecture pour le seul
# propriétaire, et toute copie hors du serveur doit être chiffrée.

set -eu
umask 077

DEST="${EPC2I_SAUVEGARDE_DIR:-/sauvegardes}"
JOURS="${EPC2I_SAUVEGARDE_JOURS:-14}"
export PGUSER="${PGUSER:-epc2i_sauvegarde}"
export PGDATABASE=epc2i
if [ -z "${PGPASSWORD:-}" ] && [ -n "${EPC2I_SAUVEGARDE_PASSWORD:-}" ]; then
  export PGPASSWORD="$EPC2I_SAUVEGARDE_PASSWORD"
fi

horodatage=$(date +%Y-%m-%d_%H%M%S)
partiel="$DEST/.$horodatage.partiel"
mkdir -p "$partiel"
echo "[sauvegarde] début $(date -Iseconds), serveur ${PGHOST:-local}, rôle $PGUSER"

for schema in keystone codex cursus vigie matrix droits; do
  pg_dump --schema="$schema" --format=custom --file="$partiel/$schema.dump"
  echo "[sauvegarde] $schema : $(wc -c < "$partiel/$schema.dump") octets"
done
# Rôles, appartenances et paramètres (sans les mots de passe, que pg_dumpall ne lit qu'en superutilisateur).
pg_dumpall --database=epc2i --globals-only --no-role-passwords --file="$partiel/roles.sql"
(cd "$partiel" && sha256sum ./*.dump roles.sql > SHA256SUMS)

mv "$partiel" "$DEST/$horodatage"
echo "[sauvegarde] terminée : $DEST/$horodatage"

# Rétention : dossiers complets de plus de $JOURS jours, et essais interrompus de plus d'un jour.
find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$JOURS" -exec rm -rf {} +
find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '.*.partiel' -mtime +1 -exec rm -rf {} +
