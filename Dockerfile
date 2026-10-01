# syntax=docker/dockerfile:1
#
# One build, three targets:
#   docker build --target api     -t streetboardman-api .
#   docker build --target worker  -t streetboardman-worker .
#   docker build --target migrate -t streetboardman-migrate .
#
# api and worker share identical dependencies and code and differ only in
# their entrypoint (server/index.js vs server/worker.js — the worker runs
# the sweeps with no HTTP server, TASK-005). migrate carries the Prisma
# CLI, a devDependency, which the long-running images deliberately omit.

FROM node:22-bookworm-slim AS base
# Prisma's query engine links against OpenSSL, which the slim image lacks.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate

# Runs `prisma migrate deploy` as the owner role in DATABASE_URL — a
# one-shot job before api/worker roll out, never part of their startup.
# In ECS the command is overridden to also run
# scripts/provision-db-roles.js (no psql in this image).
FROM build AS migrate
COPY scripts ./scripts
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM build AS prod-deps
# The generated client lives in node_modules/.prisma, which prune keeps.
RUN npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
COPY server ./server
USER node

FROM runtime AS worker
CMD ["node", "server/worker.js"]

FROM runtime AS api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server/index.js"]
