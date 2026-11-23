#!/usr/bin/env bash
# Installation du StarterPack EPC2I (Matrix, Clavis, Keystone, Codex sur le serveur PostgreSQL commun).
# Fiche : README.md. Rejouable : une étape déjà faite est vérifiée, jamais refaite en double.
#
#   ./installer.sh                         prépare .env (secrets générés), construit, démarre et vérifie tout
#   ./installer.sh --annuaire <fichier>    importe aussi l'annuaire (CSV) dans Clavis
#   ./installer.sh --admin <e-mail>        crée aussi le premier administrateur de Clavis (mot de passe provisoire affiché une fois)
#   ./installer.sh --sans-construction     utilise les images déjà présentes (serveur sans accès à internet : images apportées
#                                          par « docker load », voir README.md § 9)
#
# Prérequis : Docker 24+ avec « docker compose », les dépôts Matrix, Clavis, Keystone et Codex côte à côte (EPC2I_SOURCES),
# et les noms d'hôte des outils dans le DNS interne (ou /etc/hosts des postes).
set -euo pipefail
cd "$(dirname "$0")"

ANNUAIRE=""
ADMIN=""
CONSTRUIRE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --annuaire) ANNUAIRE="${2:?fichier attendu après --annuaire}"; shift 2 ;;
    --admin) ADMIN="${2:?e-mail attendu après --admin}"; shift 2 ;;
    --sans-construction) CONSTRUIRE=0; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 2 ;;
  esac
done

etape() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok() { printf '   ok  %s\n' "$*"; }
echec() { printf '   ÉCHEC  %s\n' "$*" >&2; exit 1; }

etape "1. Vérifications"
command -v docker >/dev/null || echec "Docker n'est pas installé."
docker compose version >/dev/null 2>&1 || echec "« docker compose » est absent (Docker Compose v2)."
ok "$(docker compose version --short 2>/dev/null | sed 's/^/Docker Compose /')"
command -v openssl >/dev/null || echec "openssl est absent (génération des secrets)."

etape "2. Fichier .env (secrets générés une seule fois, jamais affichés)"
secret() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-"${1:-40}"; }
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  ok ".env créé depuis .env.example"
fi
remplir() { # remplit une variable vide de .env avec un secret
  local nom="$1" longueur="${2:-40}"
  if grep -qE "^${nom}=$" .env; then
    sed -i "s|^${nom}=$|${nom}=$(secret "$longueur")|" .env
    ok "$nom généré"
  fi
}
for v in POSTGRES_PASSWORD KEYSTONE_APP_PASSWORD CODEX_APP_PASSWORD CURSUS_APP_PASSWORD VIGIE_APP_PASSWORD ARCHE_APP_PASSWORD \
         CRUCIBLE_APP_PASSWORD CLAVIS_APP_PASSWORD MATRIX_APP_PASSWORD MATRIX_GESTION_PASSWORD EPC2I_SAUVEGARDE_PASSWORD \
         MATRIX_TOKEN; do
  remplir "$v" 32
done
remplir CLAVIS_SESSION_SECRET 48
remplir MATRIX_SESSION_SECRET 48
remplir MATRIX_MOT_DE_PASSE 20
remplir ACCES_DEMO_MOT_DE_PASSE 20
set -a; . ./.env; set +a
for h in CLAVIS_HOST KEYSTONE_HOST CODEX_HOST MATRIX_HOST; do
  [ -n "${!h:-}" ] || echec "$h est vide dans .env : renseignez l'adresse de chaque outil (voir README.md)."
done
SOURCES="${EPC2I_SOURCES:-../../..}"
for d in Matrix Clavis Keystone Codex; do
  [ -f "$SOURCES/$d/Dockerfile" ] || echec "Sources de $d introuvables dans $SOURCES/$d (EPC2I_SOURCES)."
done
ok "sources : $(cd "$SOURCES" && pwd)"

etape "3. Accès de démonstration (Keystone et Codex, jalon A)"
mkdir -p generated
HASH=$(docker run --rm caddy:2.10-alpine caddy hash-password --plaintext "$ACCES_DEMO_MOT_DE_PASSE")
printf 'basic_auth {\n\t%s %s\n}\n' "${ACCES_DEMO_UTILISATEUR:-epc2i}" "$HASH" > generated/acces-demo.caddy
ok "identifiant « ${ACCES_DEMO_UTILISATEUR:-epc2i} », mot de passe dans .env (ACCES_DEMO_MOT_DE_PASSE)"

if [ "$CONSTRUIRE" = 1 ]; then
  etape "4. Construction des images (10 à 20 minutes la première fois)"
  docker compose build
  ok "images construites"
else
  etape "4. Images déjà présentes (--sans-construction)"
  for img in epc2i-starterpack-postgres epc2i-starterpack-matrix epc2i/clavis:local epc2i/keystone:local epc2i/codex:local caddy:2.10-alpine; do
    docker image inspect "$img" >/dev/null 2>&1 || echec "image absente : $img (docker load, README.md § 9)"
  done
  ok "six images présentes"
fi

etape "5. Serveur PostgreSQL commun"
docker compose up -d postgres
for i in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q postgres)")" = healthy ] && break
  sleep 3
  [ "$i" = 60 ] && echec "PostgreSQL ne répond pas : docker compose logs postgres"
done
# Rejouer le socle : un volume créé par une version plus ancienne du socle reçoit ce qui manque (Clavis compris).
docker compose exec -T postgres sh -c 'for f in /docker-entrypoint-initdb.d/*.sql; do psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres -f "$f" > /dev/null || exit 1; done'
ok "base epc2i, rôles et schémas en place"

etape "6. Migrations des outils"
# Attaché : rend la main quand les deux migrations sont terminées (sans --exit-code-from, qui arrêterait l'autre).
docker compose up clavis-migrate keystone-migrate >/dev/null 2>&1 || true
for s in clavis-migrate keystone-migrate; do
  code=$(docker inspect -f '{{.State.ExitCode}}' "$(docker compose ps -aq "$s")")
  [ "$code" = 0 ] || echec "$s a échoué (code $code) : docker compose logs $s"
  ok "$s"
done

etape "7. Démarrage"
docker compose up -d
ok "services lancés"

etape "8. Fichiers de partage de Matrix"
psql_matrix() { docker compose exec -T -e PGPASSWORD="$MATRIX_APP_PASSWORD" postgres psql -q -h 127.0.0.1 -U matrix_app -d epc2i -v ON_ERROR_STOP=1 "$@"; }
for f in 10-matrix-referentiels 12-matrix-liens 13-matrix-publications 15-matrix-edition 16-matrix-historique 17-matrix-glossaire-qualite; do
  psql_matrix -1 -f "/opt/epc2i/partage/$f.sql" > /dev/null
  ok "$f"
done

etape "9. Santé des outils"
attendre() { # attendre <service> <port> <chemin>
  for i in $(seq 1 90); do
    docker compose exec -T "$1" node -e "fetch('http://127.0.0.1:$2$3').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" 2>/dev/null && { ok "$1"; return; }
    sleep 4
  done
  echec "$1 ne répond pas sur $3 : docker compose logs $1"
}
attendre matrix 3000 /api/sante
attendre clavis 3600 /api/health
attendre keystone 3000 /api/health
attendre codex 3000 /api/health

if [ -n "$ANNUAIRE" ]; then
  etape "10. Annuaire"
  [ -f "$ANNUAIRE" ] || echec "fichier introuvable : $ANNUAIRE"
  cp "$ANNUAIRE" import/annuaire.csv
  docker compose run --rm -T clavis-migrate npm run --silent directory:import -- /import/annuaire.csv
fi

if [ -n "$ADMIN" ]; then
  etape "11. Premier administrateur de Clavis"
  docker compose run --rm -T clavis-migrate npm run --silent admin:create -- "$ADMIN"
fi

etape "Terminé"
cat <<FIN
   Clavis    https://$CLAVIS_HOST     (connexion par e-mail et mot de passe Clavis)
   Matrix    https://$MATRIX_HOST     (mot de passe : MATRIX_MOT_DE_PASSE dans .env)
   Keystone  https://$KEYSTONE_HOST   (démonstration ; identifiant ${ACCES_DEMO_UTILISATEUR:-epc2i}, mot de passe ACCES_DEMO_MOT_DE_PASSE dans .env)
   Codex     https://$CODEX_HOST      (démonstration ; même accès que Keystone)
   Contrôles et sauvegardes : README.md.
FIN
