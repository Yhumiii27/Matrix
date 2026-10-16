# Image de mise en ligne de Matrix (Coolify ou tout hébergeur Docker).
# - Port interne : 3000.
# - Données vivantes : /data (catalogue à jour, historique des schémas, déclarations reçues des outils).
#   Y monter un volume persistant, sinon elles sont perdues à chaque déploiement.
# - MATRIX_TOKEN : jeton partagé avec Keystone, Codex, Cursus et Vigie pour déclarer leurs tables.
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    MATRIX_DATA_DIR=/data \
    TZ=Europe/Paris

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/sante').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "serveur.mjs"]
