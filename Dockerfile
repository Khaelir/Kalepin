ARG NODE_VERSION=22.14
ARG MODEL_IMAGE=model-fallback
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ patches/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

# Stage 2a: Vendor draw.io assets (parallel, cached independently)
FROM node:${NODE_VERSION}-slim AS vendor-drawio
WORKDIR /app
COPY packages/frontend/scripts/vendor-drawio.sh packages/frontend/scripts/
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && bash packages/frontend/scripts/vendor-drawio.sh \
    && rm -rf /var/lib/apt/lists/*

# Stage 2b: Build frontend (parallel)
FROM deps AS build-frontend
ARG APP_VERSION
COPY packages/shared/ packages/shared/
COPY packages/frontend/ packages/frontend/
COPY --from=vendor-drawio /app/packages/frontend/public/drawio/ packages/frontend/public/drawio/
RUN APP_VERSION=${APP_VERSION:-$(node -p "require('./package.json').version")} pnpm --filter @kalepin/frontend run build

# Stage 3: Build backend (parallel)
FROM deps AS build-backend
COPY packages/shared/ packages/shared/
COPY packages/backend/ packages/backend/
RUN pnpm --filter @kalepin/backend run build

# Stage 4a: Fallback — download model from HuggingFace (no registry needed)
FROM node:${NODE_VERSION}-slim AS model-fallback
WORKDIR /app
COPY packages/backend/scripts/download-model.mjs packages/backend/scripts/
RUN node packages/backend/scripts/download-model.mjs && mv packages/backend/models /models

# Stage 4b: Use fallback by default; override with pre-built image for fast CI builds
# e.g. --build-arg MODEL_IMAGE=ghcr.io/Khaelir/kalepin-models:e5-base
ARG MODEL_IMAGE
FROM ${MODEL_IMAGE} AS model

# Stage 5: Production dependencies only
FROM deps AS deps-prod
ENV CI=true
RUN pnpm install --frozen-lockfile --prod

# Stage 6: Runtime (just copies, no install)
FROM node:${NODE_VERSION}-slim AS runtime
WORKDIR /app

COPY --from=deps-prod /app/node_modules node_modules
COPY --from=deps-prod /app/packages/backend/node_modules packages/backend/node_modules
COPY --from=deps-prod /app/package.json package.json
COPY --from=model /models packages/backend/models
COPY packages/shared/src packages/shared/src
COPY packages/shared/package.json packages/shared/package.json
COPY --from=build-backend /app/packages/backend/dist packages/backend/dist
COPY --from=build-backend /app/packages/backend/package.json packages/backend/package.json
COPY --from=build-frontend /app/packages/frontend/dist packages/frontend/dist

RUN mkdir -p /data/vault /data/db /data/personal \
 && chown -R node:node /data /app

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Entrypoint runs as root, fixes /data ownership on volumes inherited from a
# pre-non-root deployment, then drops to uid 1000 (node) via `setpriv`
# (already in util-linux, no extra install).
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "packages/backend/dist/backend/src/main.js"]
