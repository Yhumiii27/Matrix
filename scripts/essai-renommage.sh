#!/usr/bin/env bash
# Répétition du renommage en Atrium (docs/renommage-atrium.md) sur un cluster PostgreSQL 16 jetable : jamais sur le
# serveur en service. Elle rejoue, dans l'ordre de la fiche :
#   0. le socle d'avant le renommage (fichiers de la révision ANCIEN : base epc2i, rôle epc2i_sauvegarde) et son partage ;
#   2. le socle de cette révision, rejoué sur ce serveur pas encore renommé (mode transition), la sauvegarde et les liens ;
#   4. renommage/renommer-atrium.sql, puis les contrôles de l'étape 4 (mot de passe SCRAM gardé, droits, réglages) ;
#   7. le socle rejoué sur le serveur renommé, la sauvegarde avec l'ancienne variable de mot de passe seule ;
#   R. le retour arrière (retour-epc2i.sql) et la sauvegarde sur le serveur revenu à epc2i.
#
#   bash scripts/essai-renommage.sh [ANCIEN]     # ANCIEN : révision d'avant le renommage (défaut : a01da74, main au 27/11/2026)
# Prérequis : binaires PostgreSQL 16 (PGBIN, défaut /usr/lib/postgresql/16/bin), psql, un port libre (PGPORT, défaut 5497),
# un utilisateur système pour lancer le cluster (PGSYSUSER, défaut postgres si l'on est root, sinon soi-même).

set -euo pipefail
racine=$(cd "$(dirname "$0")/.." && pwd)
ANCIEN="${1:-a01da74}"   # main d'avant le renommage
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
export PGHOST=127.0.0.1 PGPORT="${PGPORT:-5497}"
[ "$(id -u)" = 0 ] && sysuser="${PGSYSUSER:-postgres}" || sysuser="$(id -un)"
travail=$(mktemp -d /var/tmp/essai-renommage.XXXXXX)
chown "$sysuser" "$travail"
arret() { su "$sysuser" -s /bin/sh -c "'$PGBIN/pg_ctl' -D '$travail/data' -m fast stop" > /dev/null 2>&1 || true; rm -rf "$travail"; }
trap arret EXIT
etape() { echo; echo "── $*"; }

# Mots de passe d'essai (jamais ceux du serveur en service).
export POSTGRES_PASSWORD=essai-postgres KEYSTONE_APP_PASSWORD=essai-keystone CODEX_APP_PASSWORD=essai-codex \
  CURSUS_APP_PASSWORD=essai-cursus VIGIE_APP_PASSWORD=essai-vigie ARCHE_APP_PASSWORD=essai-arche \
  CRUCIBLE_APP_PASSWORD=essai-crucible MATRIX_APP_PASSWORD=essai-matrix MATRIX_GESTION_PASSWORD=essai-gestion
mdp_sauvegarde=essai-sauvegarde-0123456789
admin() { PGOPTIONS="-c client_min_messages=warning" PGPASSWORD="$POSTGRES_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 -U postgres "$@"; }

etape "Cluster jetable sur le port $PGPORT"
echo "$POSTGRES_PASSWORD" > "$travail/mdp"; chown "$sysuser" "$travail/mdp"
su "$sysuser" -s /bin/sh -c "'$PGBIN/initdb' -D '$travail/data' -U postgres --auth=scram-sha-256 --pwfile='$travail/mdp' > /dev/null"
su "$sysuser" -s /bin/sh -c "'$PGBIN/pg_ctl' -D '$travail/data' -o '-p $PGPORT -k $travail' -l '$travail/journal' -w start > /dev/null"

etape "0. Socle d'avant le renommage ($ANCIEN) : base epc2i, rôle epc2i_sauvegarde"
mkdir "$travail/ancien" && git -C "$racine" archive "$ANCIEN" infra/postgres | tar -x -C "$travail/ancien"
(cd "$travail/ancien/infra/postgres" && export EPC2I_SAUVEGARDE_PASSWORD="$mdp_sauvegarde" && unset ATRIUM_SAUVEGARDE_PASSWORD
 for f in init/0*.sql; do admin -d postgres -f "$f" > /dev/null; done
 PGOPTIONS="-c client_min_messages=warning" PGPASSWORD="$MATRIX_APP_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 -U matrix_app -d epc2i -1 -f partage/12-matrix-liens.sql > /dev/null
 PGPASSWORD="$POSTGRES_PASSWORD" EPC2I_LIENS_ETAT="$travail/etat-ancien" sh partage/appliquer-liens.sh > /dev/null)
admin -d postgres -Atc "SELECT 'base ' || datname FROM pg_database WHERE datname IN ('epc2i', 'atrium') UNION ALL SELECT 'rôle ' || rolname FROM pg_roles WHERE rolname LIKE '%\_sauvegarde'"

cd "$racine/infra/postgres"
etape "2. Socle de cette révision sur le serveur pas encore renommé (seule l'ancienne variable de mot de passe est posée)"
(export EPC2I_SAUVEGARDE_PASSWORD="$mdp_sauvegarde"; unset ATRIUM_SAUVEGARDE_PASSWORD
 for f in init/0*.sql; do admin -d postgres -f "$f" 2>&1 | grep -E 'Étape|Renommage' || true; done
 PGPASSWORD= ATRIUM_SAUVEGARDE_DIR="$travail/sauvegardes" sh sauvegarde/sauvegarder.sh | grep -E 'début|terminée')
PGPASSWORD="$POSTGRES_PASSWORD" ATRIUM_LIENS_ETAT="$travail/etat" sh partage/appliquer-liens.sh | tail -1
[ "$(admin -d epc2i -Atc "SELECT count(*) FROM droits.verifier() WHERE gravite = 'erreur'")" = 0 ] && echo "  droits.verifier() sans erreur"
admin -d postgres -f verifier-droits.sql 2>&1 | grep 'Tous les cas sont conformes'

etape "4. Renommage (renommage/renommer-atrium.sql), une session d'outil encore ouverte"
(PGPASSWORD="$KEYSTONE_APP_PASSWORD" psql -XAtq -U keystone_app -d epc2i -c 'SELECT pg_sleep(20)' > /dev/null 2>&1 || true) &
sleep 1
admin -d postgres -f renommage/renommer-atrium.sql | grep -E 'atrium|coupées|Renommage' || true
[ "$(PGPASSWORD="$mdp_sauvegarde" psql -XAtq -U atrium_sauvegarde -d atrium -c 'SELECT current_user')" = atrium_sauvegarde ] && echo "  mot de passe de atrium_sauvegarde gardé (SCRAM)"
[ "$(PGPASSWORD="$KEYSTONE_APP_PASSWORD" psql -XAtq -U keystone_app -d atrium -c 'SHOW search_path')" = keystone ] && echo "  keystone_app : CONNECT et search_path gardés sur atrium"
[ "$(admin -d atrium -Atc "SELECT count(*) FROM droits.verifier() WHERE gravite = 'erreur'")" = 0 ] && echo "  droits.verifier() sans erreur, avant tout rejeu"
admin -d postgres -f renommage/renommer-atrium.sql > /dev/null && echo "  renommer-atrium.sql rejouable"

etape "7. Socle rejoué sur le serveur renommé ; sauvegarde avec l'ancienne variable seule, puis la nouvelle"
(export ATRIUM_SAUVEGARDE_PASSWORD="$mdp_sauvegarde"; for f in init/0*.sql; do admin -d postgres -f "$f" 2>&1 | grep -E 'Étape 1|Renommage' || true; done)
env -i PATH="$PATH" PGHOST="$PGHOST" PGPORT="$PGPORT" EPC2I_SAUVEGARDE_PASSWORD="$mdp_sauvegarde" EPC2I_SAUVEGARDE_DIR="$travail/sauvegardes" \
  sh sauvegarde/sauvegarder.sh | grep 'début'
env -i PATH="$PATH" PGHOST="$PGHOST" PGPORT="$PGPORT" ATRIUM_SAUVEGARDE_PASSWORD="$mdp_sauvegarde" ATRIUM_SAUVEGARDE_DIR="$travail/sauvegardes" \
  sh sauvegarde/sauvegarder.sh | grep 'début'
PGPASSWORD="$POSTGRES_PASSWORD" ATRIUM_LIENS_FORCER=1 ATRIUM_LIENS_ETAT="$travail/etat" sh partage/appliquer-liens.sh | tail -1
admin -d postgres -f verifier-droits.sql 2>&1 | grep 'Tous les cas sont conformes'

etape "R. Retour arrière (renommage/retour-epc2i.sql) : les fichiers de cette révision marchent encore"
admin -d postgres -f renommage/retour-epc2i.sql | grep -E 'epc2i|Retour' || true
env -i PATH="$PATH" PGHOST="$PGHOST" PGPORT="$PGPORT" ATRIUM_SAUVEGARDE_PASSWORD="$mdp_sauvegarde" ATRIUM_SAUVEGARDE_DIR="$travail/sauvegardes" \
  sh sauvegarde/sauvegarder.sh | grep 'début'
[ "$(admin -d epc2i -Atc "SELECT count(*) FROM droits.verifier() WHERE gravite = 'erreur'")" = 0 ] && echo "  droits.verifier() sans erreur"

echo; echo "Répétition terminée sans erreur."
