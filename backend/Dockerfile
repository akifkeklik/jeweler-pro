# Jeweler Pro API: production image.
# Multi-stage: dependencies are installed from the lockfile without dev
# dependencies; the runtime runs as the unprivileged "node" user.
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
EXPOSE 5000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- http://127.0.0.1:5000/health/ready >/dev/null || exit 1
CMD ["node", "server.js"]
