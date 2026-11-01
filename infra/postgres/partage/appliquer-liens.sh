#!/bin/sh
# Application automatique du registre des liens de Matrix (matrix.liens) : rejoue 90-droits.sql quand c'est utile.
#
# Dans le conteneur postgres (tâche planifiée Coolify, ou à la main) :
#   docker compose exec postgres sh /opt/epc2i/partage/appliquer-liens.sh
#
# 90-droits.sql est rejoué si l'une de ces conditions est vraie, sinon rien n'est fait :
#   - premier passage dans ce conteneur, ou 90-droits.sql a changé depuis le dernier passage réussi (redéploiement) ;
#   - un lien autorisé dans matrix.liens n'a pas son droit SELECT alors que la vue existe ;
#   - un rôle d'outil lit une vue pub_ d'un autre schéma sans lien autorisé (refusé, demandé ou hors registre) ;
#   - matrix.liens n'existe pas encore (90 applique alors la convention telle quelle) ;
#   - EPC2I_LIENS_FORCER=1.
# 90-droits.sql s'exécute dans une seule transaction terminée par droits.verifier() : une erreur annule tout et la tâche
# échoue (code de sortie non nul), le serveur garde ses droits précédents.
#
# Variables :
#   PGHOST, PGPORT    serveur (défaut : socket local du conteneur)
#   PGUSER            défaut postgres (superutilisateur, ou administrateur membre de matrix_admin)
#   EPC2I_PARTAGE_DIR dossier de 90-droits.sql (défaut : dossier de ce script)
#   EPC2I_LIENS_ETAT  fichier d'état, empreinte du dernier 90-droits.sql appliqué (défaut /tmp/epc2i-liens.etat :
#                     effacé à chaque redéploiement du conteneur, ce qui provoque un passage complet)
#   EPC2I_LIENS_FORCER 1 pour rejouer 90-droits.sql sans condition

set -eu

DIR="${EPC2I_PARTAGE_DIR:-$(cd "$(dirname "$0")" && pwd)}"
FICHIER="$DIR/90-droits.sql"
ETAT="${EPC2I_LIENS_ETAT:-/tmp/epc2i-liens.etat}"
VERROU="$ETAT.verrou"
export PGUSER="${PGUSER:-postgres}"
export PGDATABASE=epc2i

[ -f "$FICHIER" ] || { echo "[liens] $FICHIER introuvable" >&2; exit 1; }

# Un seul passage à la fois (tâche lancée pendant qu'un passage manuel ou précédent tourne encore).
if ! mkdir "$VERROU" 2>/dev/null; then
  if [ -n "$(find "$VERROU" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
    echo "[liens] verrou de plus de 30 minutes repris : $VERROU"
  else
    echo "[liens] passage déjà en cours ($VERROU), rien à faire"
    exit 0
  fi
fi
trap 'rmdir "$VERROU" 2>/dev/null || true' EXIT INT TERM

empreinte=$(sha256sum "$FICHIER" | cut -d' ' -f1)
motif=""
if [ "${EPC2I_LIENS_FORCER:-0}" = 1 ]; then
  motif="passage forcé"
elif [ ! -f "$ETAT" ] || [ "$(cat "$ETAT")" != "$empreinte" ]; then
  motif="90-droits.sql nouveau dans ce conteneur"
else
  # Écarts entre le registre et les droits posés. Mêmes règles que l'étape 2 de 90-droits.sql.
  ecarts=$(psql -XAtq -v ON_ERROR_STOP=1 <<'SQL'
SELECT CASE WHEN to_regclass('matrix.liens') IS NULL THEN 'registre absent' ELSE (
  SELECT concat_ws(', ',
    nullif(format('%s lien(s) à appliquer', count(*) FILTER (WHERE manque)), '0 lien(s) à appliquer'),
    nullif(format('%s lien(s) à retirer', count(*) FILTER (WHERE NOT manque)), '0 lien(s) à retirer'))
  FROM (
    SELECT true AS manque
    FROM matrix.liens l
    JOIN pg_class c ON c.oid = to_regclass(l.vue) AND c.relkind = 'v'
    JOIN pg_roles r ON r.rolname = l.lecteur
    WHERE l.statut = 'autorise' AND NOT has_table_privilege(r.oid, c.oid, 'SELECT')
    UNION ALL
    SELECT false
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible', 'matrix') AND c.relkind = 'v'
      AND c.relname LIKE 'pub\_%' AND a.privilege_type = 'SELECT' AND a.grantee <> c.relowner
      AND pg_get_userbyid(a.grantee) IN ('keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app', 'crucible_app', 'matrix_app')
      AND NOT EXISTS (SELECT FROM matrix.liens l
                      WHERE l.vue = n.nspname || '.' || c.relname AND l.lecteur = pg_get_userbyid(a.grantee)
                        AND l.statut = 'autorise')
    UNION ALL
    -- USAGE restant sur un schéma où l'outil ne lit plus aucune vue pub_ (lien retiré par Matrix, lot P2 de M-18 :
    -- l'USAGE donné par le propriétaire du schéma ne peut être retiré que par lui).
    SELECT false
    FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(n.nspacl) a
    WHERE n.nspname IN ('keystone', 'codex', 'cursus', 'vigie', 'arche', 'crucible', 'matrix') AND a.privilege_type = 'USAGE'
      AND pg_get_userbyid(a.grantee) IN ('keystone_app', 'codex_app', 'cursus_app', 'vigie_app', 'arche_app', 'crucible_app')
      AND a.grantee <> n.nspowner
      AND NOT EXISTS (SELECT FROM pg_class v
                      WHERE v.relnamespace = n.oid AND v.relkind = 'v' AND v.relname LIKE 'pub\_%'
                        AND has_table_privilege(a.grantee, v.oid, 'SELECT'))
  ) e
) END
SQL
)
  motif="$ecarts"
fi

if [ -z "$motif" ]; then
  echo "[liens] $(date -Iseconds) : registre et droits concordent, rien à appliquer"
  exit 0
fi

echo "[liens] $(date -Iseconds) : $motif, passage de 90-droits.sql (serveur ${PGHOST:-local}, rôle $PGUSER)"
sortie=$(mktemp)
if psql -X -v ON_ERROR_STOP=1 -f "$FICHIER" > "$sortie" 2>&1; then
  # Seuls les messages utiles : liens retirés, vues absentes, contrôles.
  grep -E 'NOTICE|WARNING' "$sortie" | sed 's/^.*\(NOTICE\|WARNING\): */[liens]   /' || true
  printf '%s\n' "$empreinte" > "$ETAT"
  rm -f "$sortie"
  echo "[liens] terminé"
else
  cat "$sortie" >&2
  rm -f "$sortie"
  echo "[liens] échec : transaction annulée, droits inchangés" >&2
  exit 1
fi
