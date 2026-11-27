#!/usr/bin/env bash
# Répétition du renommage en Atrium (docs/renommage-atrium.md) sur des clusters PostgreSQL 16 jetables : jamais sur le
# serveur en service. Un dossier de données joue le rôle d'un volume. Elle rejoue, dans l'ordre de la fiche :
#   0. le socle d'avant le renommage (fichiers de la révision ANCIEN : base epc2i, rôle epc2i_sauvegarde), son partage
#      et quelques lignes d'essai ;
#   4. fenêtre : comptage avant (renommage/compter.sql), sauvegarde, arrêt, copie à l'identique de l'ancien « volume »
#      dans un nouveau, démarrage sur la copie, socle de cette révision rejoué (mode transition), comptage après copie
#      (identique), renommage (renommage/renommer-atrium.sql, une session d'outil encore ouverte), contrôles ;
#   7. contrôles d'après : socle rejoué, sauvegarde avec l'ancienne variable de mot de passe seule puis la nouvelle,
#      liens, verifier-droits.sql, comptage (identique, hormis le nom de la base) ;
#   R. retour arrière : retour-epc2i.sql sur la copie, puis redémarrage sur l'ancien « volume », resté intact.
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
pgctl() { su "$sysuser" -s /bin/sh -c "'$PGBIN/pg_ctl' -D '$travail/$1' $2"; }
demarrer() { pgctl "$1" "-o '-p $PGPORT -k $travail' -l '$travail/journal-$1' -w start" > /dev/null; }
arreter() { pgctl "$1" "-m fast -w stop" > /dev/null; }
fin() { for d in ancien-volume nouveau-volume; do pgctl "$d" "-m fast stop" > /dev/null 2>&1 || true; done; rm -rf "$travail"; }
trap fin EXIT
etape() { echo; echo "── $*"; }

# Mots de passe d'essai (jamais ceux du serveur en service).
export POSTGRES_PASSWORD=essai-postgres KEYSTONE_APP_PASSWORD=essai-keystone CODEX_APP_PASSWORD=essai-codex \
  CURSUS_APP_PASSWORD=essai-cursus VIGIE_APP_PASSWORD=essai-vigie ARCHE_APP_PASSWORD=essai-arche \
  CRUCIBLE_APP_PASSWORD=essai-crucible MATRIX_APP_PASSWORD=essai-matrix MATRIX_GESTION_PASSWORD=essai-gestion
mdp_sauvegarde=essai-sauvegarde-0123456789
admin() { PGOPTIONS="-c client_min_messages=warning" PGPASSWORD="$POSTGRES_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 -U postgres "$@"; }
compter() { admin -d "$1" -A -t -f "$racine/infra/postgres/renommage/compter.sql" > "$travail/$2"; }
sauvegarder() { env -i PATH="$PATH" PGHOST="$PGHOST" PGPORT="$PGPORT" "$@" sh "$racine/infra/postgres/sauvegarde/sauvegarder.sh" | grep 'début'; }

etape "Cluster jetable (ancien « volume ») sur le port $PGPORT"
echo "$POSTGRES_PASSWORD" > "$travail/mdp"; chown "$sysuser" "$travail/mdp"
su "$sysuser" -s /bin/sh -c "'$PGBIN/initdb' -D '$travail/ancien-volume' -U postgres --auth=scram-sha-256 --pwfile='$travail/mdp' > /dev/null"
demarrer ancien-volume

etape "0. Socle d'avant le renommage ($ANCIEN) : base epc2i, rôle epc2i_sauvegarde, lignes d'essai"
mkdir "$travail/ancien" && git -C "$racine" archive "$ANCIEN" infra/postgres | tar -x -C "$travail/ancien"
(cd "$travail/ancien/infra/postgres" && export EPC2I_SAUVEGARDE_PASSWORD="$mdp_sauvegarde" && unset ATRIUM_SAUVEGARDE_PASSWORD
 for f in init/0*.sql; do admin -d postgres -f "$f" > /dev/null; done
 PGOPTIONS="-c client_min_messages=warning" PGPASSWORD="$MATRIX_APP_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 -U matrix_app -d epc2i -1 -f partage/10-matrix-referentiels.sql > /dev/null
 PGOPTIONS="-c client_min_messages=warning" PGPASSWORD="$MATRIX_APP_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 -U matrix_app -d epc2i -1 -f partage/12-matrix-liens.sql > /dev/null
 PGPASSWORD="$POSTGRES_PASSWORD" EPC2I_LIENS_ETAT="$travail/etat-ancien" sh partage/appliquer-liens.sh > /dev/null)
PGPASSWORD="$KEYSTONE_APP_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 -U keystone_app -d epc2i \
  -c "CREATE TABLE keystone.essai_renommage (id int PRIMARY KEY, libelle text NOT NULL)" \
  -c "INSERT INTO keystone.essai_renommage SELECT g, 'ligne ' || g FROM generate_series(1, 1000) g"
admin -d postgres -Atc "SELECT 'base ' || datname FROM pg_database WHERE datname IN ('epc2i', 'atrium') UNION ALL SELECT 'rôle ' || rolname FROM pg_roles WHERE rolname LIKE '%\_sauvegarde'"

cd "$racine/infra/postgres"
etape "4.1–4.2. Comptage avant, sauvegarde (script de cette révision, ancienne variable de mot de passe seule)"
compter epc2i comptage-avant.txt
echo "  $(grep -c '^table ' "$travail/comptage-avant.txt") tables comptées"
sauvegarder EPC2I_SAUVEGARDE_PASSWORD="$mdp_sauvegarde" ATRIUM_SAUVEGARDE_DIR="$travail/sauvegardes"

etape "4.3. Arrêt, copie à l'identique de l'ancien volume dans le nouveau, démarrage sur la copie"
arreter ancien-volume
cp -a "$travail/ancien-volume" "$travail/nouveau-volume"
rm -f "$travail/nouveau-volume/postmaster.pid"
demarrer nouveau-volume
echo "  démarré sur la copie : $(admin -d postgres -Atc 'SHOW data_directory')"

etape "4.4. Socle de cette révision rejoué sur la copie (mode transition), comptage après copie"
(export EPC2I_SAUVEGARDE_PASSWORD="$mdp_sauvegarde"; unset ATRIUM_SAUVEGARDE_PASSWORD
 for f in init/0*.sql; do admin -d postgres -f "$f" 2>&1 | grep -E 'Étape 1|Renommage' || true; done)
compter epc2i comptage-copie.txt
diff "$travail/comptage-avant.txt" "$travail/comptage-copie.txt" && echo "  comptage identique après la copie"
[ "$(admin -d epc2i -Atc "SELECT count(*) FROM droits.verifier() WHERE gravite = 'erreur'")" = 0 ] && echo "  droits.verifier() sans erreur"

etape "4.5. Renommage (renommage/renommer-atrium.sql), une session d'outil encore ouverte"
(PGPASSWORD="$KEYSTONE_APP_PASSWORD" psql -XAtq -U keystone_app -d epc2i -c 'SELECT pg_sleep(20)' > /dev/null 2>&1 || true) &
sleep 1
admin -d postgres -f renommage/renommer-atrium.sql | grep -E 'atrium|coupées|Renommage' || true
[ "$(PGPASSWORD="$mdp_sauvegarde" psql -XAtq -U atrium_sauvegarde -d atrium -c 'SELECT current_user')" = atrium_sauvegarde ] && echo "  mot de passe de atrium_sauvegarde gardé (SCRAM)"
[ "$(PGPASSWORD="$KEYSTONE_APP_PASSWORD" psql -XAtq -U keystone_app -d atrium -c 'SHOW search_path')" = keystone ] && echo "  keystone_app : CONNECT et search_path gardés sur atrium"
[ "$(admin -d atrium -Atc "SELECT count(*) FROM droits.verifier() WHERE gravite = 'erreur'")" = 0 ] && echo "  droits.verifier() sans erreur, avant tout rejeu"
admin -d postgres -f renommage/renommer-atrium.sql > /dev/null && echo "  renommer-atrium.sql rejouable"

etape "7. Contrôles d'après : socle rejoué, sauvegardes, liens, droits, comptage"
(export ATRIUM_SAUVEGARDE_PASSWORD="$mdp_sauvegarde"; for f in init/0*.sql; do admin -d postgres -f "$f" 2>&1 | grep -E 'Étape 1|Renommage' || true; done)
sauvegarder EPC2I_SAUVEGARDE_PASSWORD="$mdp_sauvegarde" EPC2I_SAUVEGARDE_DIR="$travail/sauvegardes"
sauvegarder ATRIUM_SAUVEGARDE_PASSWORD="$mdp_sauvegarde" ATRIUM_SAUVEGARDE_DIR="$travail/sauvegardes"
PGPASSWORD="$POSTGRES_PASSWORD" ATRIUM_LIENS_FORCER=1 ATRIUM_LIENS_ETAT="$travail/etat" sh partage/appliquer-liens.sh | tail -1
admin -d postgres -f verifier-droits.sql 2>&1 | grep 'Tous les cas sont conformes'
compter atrium comptage-apres.txt
diff <(sed 1d "$travail/comptage-avant.txt") <(sed 1d "$travail/comptage-apres.txt") && echo "  comptage identique après le renommage (seule la ligne « base » change)"

etape "R. Retour arrière : retour-epc2i.sql sur la copie, puis l'ancien volume, resté intact"
admin -d postgres -f renommage/retour-epc2i.sql | grep -E 'Retour' || true
arreter nouveau-volume
demarrer ancien-volume
compter epc2i comptage-retour.txt
diff "$travail/comptage-avant.txt" "$travail/comptage-retour.txt" && echo "  ancien volume intact : base epc2i, comptage identique à celui d'avant la fenêtre"
sauvegarder EPC2I_SAUVEGARDE_PASSWORD="$mdp_sauvegarde" ATRIUM_SAUVEGARDE_DIR="$travail/sauvegardes"

echo; echo "Répétition terminée sans erreur."
