#!/bin/sh
# Sauvegarde logique du serveur commun de la suite Atrium : un fichier pg_dump par schéma, plus les rôles.
#
# Dans le conteneur postgres (tâche planifiée Coolify, ou à la main) :
#   docker compose exec postgres sh /opt/atrium/sauvegarde/sauvegarder.sh
# Depuis un autre poste (pg_dump 16 ou plus) :
#   PGHOST=<hôte> PGPASSWORD=<mot de passe de atrium_sauvegarde> ATRIUM_SAUVEGARDE_DIR=./sauvegardes sh sauvegarder.sh
#
# Variables :
#   ATRIUM_SAUVEGARDE_DIR   dossier de destination (défaut /sauvegardes, volume des sauvegardes)
#   ATRIUM_SAUVEGARDE_JOURS rétention en jours (défaut 14)
#   ATRIUM_BASE             base sauvegardée (défaut : atrium si elle répond, sinon epc2i, nom d'avant le renommage)
#   PGHOST, PGPORT          serveur (défaut : socket local du conteneur)
#   PGUSER                  défaut atrium_sauvegarde (membre de pg_read_all_data), sinon epc2i_sauvegarde
#   PGPASSWORD              défaut ATRIUM_SAUVEGARDE_PASSWORD
#
# Renommage de la suite en Atrium (docs/renommage-atrium.md) : tant que le serveur en service n'est pas renommé, le
# script garde l'ancienne base (epc2i), l'ancien rôle (epc2i_sauvegarde) et lit les anciennes variables
# (EPC2I_SAUVEGARDE_DIR, EPC2I_SAUVEGARDE_JOURS, EPC2I_SAUVEGARDE_PASSWORD) quand les nouvelles manquent. Ces replis
# se retirent une fois le renommage fait et vérifié (étape « Nettoyage » de la fiche).
#
# Résultat : <dossier>/<AAAA-MM-JJ_HHMMSS>/{keystone,codex,cursus,vigie,arche,crucible,clavis,modulus,vector,matrix,droits}.dump, roles.sql, SHA256SUMS.
# Le dossier n'apparaît sous son nom définitif qu'une fois toutes les copies réussies.
# Les fichiers contiennent les données sensibles de Cursus et de Vigie : ils sont créés en lecture pour le seul
# propriétaire, et toute copie hors du serveur doit être chiffrée.

set -eu
umask 077

DEST="${ATRIUM_SAUVEGARDE_DIR:-${EPC2I_SAUVEGARDE_DIR:-/sauvegardes}}"
JOURS="${ATRIUM_SAUVEGARDE_JOURS:-${EPC2I_SAUVEGARDE_JOURS:-14}}"
if [ -z "${PGPASSWORD:-}" ]; then
  if [ -n "${ATRIUM_SAUVEGARDE_PASSWORD:-}" ]; then export PGPASSWORD="$ATRIUM_SAUVEGARDE_PASSWORD"
  elif [ -n "${EPC2I_SAUVEGARDE_PASSWORD:-}" ]; then export PGPASSWORD="$EPC2I_SAUVEGARDE_PASSWORD"; fi
fi

# Rôle et base : ceux qui répondent, dans l'ordre nouveau nom puis ancien (renommage en cours ou pas encore fait).
roles="${PGUSER:-atrium_sauvegarde epc2i_sauvegarde}"
bases="${ATRIUM_BASE:-atrium epc2i}"
trouve=""
for r in $roles; do
  for b in $bases; do
    if psql -XAtq -U "$r" -d "$b" -c 'SELECT 1' > /dev/null 2>&1; then trouve="$r $b"; break 2; fi
  done
done
if [ -z "$trouve" ]; then
  echo "[sauvegarde] connexion impossible (rôles : $roles ; bases : $bases) : serveur arrêté, mot de passe ou nom erroné" >&2
  exit 1
fi
export PGUSER="${trouve% *}" PGDATABASE="${trouve#* }"

horodatage=$(date +%Y-%m-%d_%H%M%S)
partiel="$DEST/.$horodatage.partiel"
mkdir -p "$partiel"
echo "[sauvegarde] début $(date -Iseconds), serveur ${PGHOST:-local}, base $PGDATABASE, rôle $PGUSER"

for schema in keystone codex cursus vigie arche crucible clavis modulus vector matrix droits; do
  # Schéma pas encore créé (serveur antérieur, socle pas rejoué) : signalé, sans faire échouer la sauvegarde.
  if [ "$(psql -XAtqc "SELECT count(*) FROM pg_namespace WHERE nspname = '$schema'")" = 0 ]; then
    echo "[sauvegarde] $schema : schéma absent, ignoré (rejouer init/02-schemas.sql)"
    continue
  fi
  pg_dump --schema="$schema" --format=custom --file="$partiel/$schema.dump"
  echo "[sauvegarde] $schema : $(wc -c < "$partiel/$schema.dump") octets"
done
# Rôles, appartenances et paramètres (sans les mots de passe, que pg_dumpall ne lit qu'en superutilisateur).
pg_dumpall --database="$PGDATABASE" --globals-only --no-role-passwords --file="$partiel/roles.sql"
(cd "$partiel" && sha256sum ./*.dump roles.sql > SHA256SUMS)

mv "$partiel" "$DEST/$horodatage"
echo "[sauvegarde] terminée : $DEST/$horodatage"

# Rétention : dossiers complets de plus de $JOURS jours, et essais interrompus de plus d'un jour.
find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$JOURS" -exec rm -rf {} +
find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '.*.partiel' -mtime +1 -exec rm -rf {} +
