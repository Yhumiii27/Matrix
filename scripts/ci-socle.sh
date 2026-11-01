#!/usr/bin/env bash
# Rejoue le socle du serveur commun sur un PostgreSQL 16 d'essai et contrôle les droits (intégration continue, écart E-03).
#
# Prérequis : un serveur joignable par PGHOST / PGPORT (image infra/postgres, ou cluster local), le superutilisateur
# postgres (POSTGRES_PASSWORD) et les mots de passe des rôles, comme dans infra/postgres/.env.example. Aucun outil n'y
# est migré : on éprouve le socle, les fichiers de Matrix (10, 12, 13, 96), la reprise d'une vue pub_ d'essai (14), l'application du registre des liens
# (appliquer-liens.sh, donc 90-droits.sql) et verifier-droits.sql. À ne jamais lancer sur le serveur en service.
#
#   PGHOST=127.0.0.1 PGPORT=5432 POSTGRES_PASSWORD=… MATRIX_APP_PASSWORD=… … bash scripts/ci-socle.sh

set -euo pipefail
cd "$(dirname "$0")/../infra/postgres"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}"
admin() { PGOPTIONS="-c client_min_messages=warning" PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -X -q -v ON_ERROR_STOP=1 -U postgres "$@"; }
outil() { PGOPTIONS="-c client_min_messages=warning" PGPASSWORD="${KEYSTONE_APP_PASSWORD:?KEYSTONE_APP_PASSWORD manquant}" psql -X -q -v ON_ERROR_STOP=1 -U keystone_app -d epc2i "$@"; }
gestion() { PGOPTIONS="-c client_min_messages=warning" PGPASSWORD="${MATRIX_GESTION_PASSWORD:?MATRIX_GESTION_PASSWORD manquant}" psql -X -q -v ON_ERROR_STOP=1 -U matrix_gestion -d epc2i "$@"; }
matrix() { PGOPTIONS="-c client_min_messages=warning" PGPASSWORD="${MATRIX_APP_PASSWORD:?MATRIX_APP_PASSWORD manquant}" psql -X -q -v ON_ERROR_STOP=1 -U matrix_app -d epc2i "$@"; }
etape() { echo; echo "── $*"; }

etape "Socle : init/01 à 03 (rejoués : l'image les a déjà joués au premier démarrage)"
for f in init/0*.sql; do admin -d postgres -f "$f" > /dev/null; echo "  $f"; done

etape "Référentiels et registre des liens de Matrix (10, 12) en matrix_app"
matrix -1 -f partage/10-matrix-referentiels.sql > /dev/null
matrix -1 -f partage/12-matrix-liens.sql > /dev/null
echo "  pays : $(matrix -Atc 'SELECT count(*) FROM matrix.pays') · organigramme : $(matrix -Atc 'SELECT count(*) FROM matrix.organigramme')"

etape "Registre appliqué par appliquer-liens.sh (90-droits.sql), deux passages"
etat=$(mktemp -u)
PGPASSWORD="${POSTGRES_PASSWORD:-}" EPC2I_LIENS_ETAT="$etat" sh partage/appliquer-liens.sh
second=$(PGPASSWORD="${POSTGRES_PASSWORD:-}" EPC2I_LIENS_ETAT="$etat" sh partage/appliquer-liens.sh)
echo "$second"
grep -q 'concordent' <<< "$second" || { echo "Le second passage aurait dû ne rien appliquer." >&2; exit 1; }
echo "  liens inscrits : $(matrix -Atc 'SELECT count(*) FROM matrix.liens')"

etape "Publications (M-18) : registre (13), reprise d'une vue pub_ d'essai de Keystone (14), contrat tenu par PostgreSQL"
matrix -1 -f partage/13-matrix-publications.sql > /dev/null
outil -1 -c "CREATE TABLE keystone.ci_essai (id int PRIMARY KEY, code text NOT NULL, note text);
             CREATE VIEW keystone.pub_ci_essai AS SELECT id, code FROM keystone.ci_essai;" > /dev/null
admin -d epc2i -v outils=keystone -1 -f partage/14-reprise-publications.sql > /dev/null
proprio=$(admin -d epc2i -Atc "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'keystone.pub_ci_essai'::regclass")
[ "$proprio" = matrix_gestion ] || { echo "Propriétaire après reprise : $proprio (matrix_gestion attendu)" >&2; exit 1; }
inscrite=$(matrix -Atc "SELECT etat || ' ' || origine || ' ' || jsonb_array_length(contrat) FROM matrix.publications WHERE vue = 'keystone.pub_ci_essai'")
[ "$inscrite" = "appliquee reprise 2" ] || { echo "Registre après reprise : « $inscrite »" >&2; exit 1; }
admin -d epc2i -v outils=keystone -1 -f partage/14-reprise-publications.sql > /dev/null   # rejouable
gestion -1 -c "CREATE OR REPLACE VIEW keystone.pub_ci_essai AS SELECT id, code, note FROM keystone.ci_essai" > /dev/null
if gestion -1 -c "CREATE OR REPLACE VIEW keystone.pub_ci_essai AS SELECT id, note FROM keystone.ci_essai" > /dev/null 2>&1; then
  echo "Une colonne publiée a pu être retirée." >&2; exit 1; fi
if gestion -1 -c "INSERT INTO keystone.ci_essai VALUES (1, 'x', null)" > /dev/null 2>&1; then
  echo "matrix_gestion a pu écrire dans une table d'outil." >&2; exit 1; fi
if outil -1 -c "CREATE OR REPLACE VIEW keystone.pub_ci_essai AS SELECT id, code, note FROM keystone.ci_essai" > /dev/null 2>&1; then
  echo "L'outil a pu modifier une vue reprise par Matrix." >&2; exit 1; fi
echo "  vue reprise par matrix_gestion, inscrite au registre, colonne ajoutée, retrait refusé, aucune écriture possible"

etape "REX unifié (96) en matrix_app ; 95 attend les pub_journal des outils, absents ici"
matrix -1 -f partage/96-matrix-rex-unifie.sql > /dev/null

etape "droits.verifier() : aucune erreur"
erreurs=$(admin -d epc2i -Atc "SELECT count(*) FROM droits.verifier() WHERE gravite = 'erreur'")
admin -d epc2i -c "SELECT gravite, count(*) FROM droits.verifier() GROUP BY 1 ORDER BY 1"
[ "$erreurs" = 0 ] || { admin -d epc2i -c "SELECT * FROM droits.verifier() WHERE gravite = 'erreur'"; exit 1; }

etape "verifier-droits.sql"
sortie=$(admin -d postgres -f verifier-droits.sql 2>&1) || { echo "$sortie" >&2; exit 1; }
grep 'Tous les cas sont conformes' <<< "$sortie"

etape "Socle rejoué après le partage : toujours sans erreur"
for f in init/0*.sql; do admin -d postgres -f "$f" > /dev/null; done
[ "$(admin -d epc2i -Atc "SELECT count(*) FROM droits.verifier() WHERE gravite = 'erreur'")" = 0 ]
echo "  ok"

etape "Nettoyage de la vue d'essai (la ligne du registre reste, retirée)"
admin -d epc2i -1 -c "DROP VIEW keystone.pub_ci_essai; DROP TABLE keystone.ci_essai;" > /dev/null
matrix -c "UPDATE matrix.publications SET etat = 'retiree', modifie_par = 'ci' WHERE vue = 'keystone.pub_ci_essai'" > /dev/null
echo "  ok"
