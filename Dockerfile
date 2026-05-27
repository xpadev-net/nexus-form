FROM node:24-alpine AS base
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
WORKDIR /app
RUN corepack enable pnpm

# ── Install dependencies ──
FROM base AS deps

COPY ./package.json ./pnpm-workspace.yaml ./pnpm-lock.yaml ./
COPY ./apps/api/package.json ./apps/api/
COPY ./apps/web/package.json ./apps/web/
COPY ./packages/database/package.json ./packages/database/
COPY ./packages/integrations/package.json ./packages/integrations/
COPY ./packages/shared/package.json ./packages/shared/
COPY ./packages/validation-provider-discord/package.json ./packages/validation-provider-discord/
COPY ./packages/validation-provider-github/package.json ./packages/validation-provider-github/
COPY ./packages/validation-provider-twitter/package.json ./packages/validation-provider-twitter/

RUN pnpm install --frozen-lockfile --prod=false

# ── Build all packages ──
FROM deps AS builder

COPY ./tsconfig.json ./
COPY ./apps/api/ ./apps/api/
COPY ./apps/web/ ./apps/web/
COPY ./packages/database/ ./packages/database/
COPY ./packages/integrations/ ./packages/integrations/
COPY ./packages/shared/ ./packages/shared/
COPY ./packages/validation-provider-discord/ ./packages/validation-provider-discord/
COPY ./packages/validation-provider-github/ ./packages/validation-provider-github/
COPY ./packages/validation-provider-twitter/ ./packages/validation-provider-twitter/

# Build shared packages first, then validation providers (apps/api resolves
# their `./plugin` exports at runtime via import.meta.resolve), then apps.
RUN pnpm --filter @nexus-form/shared build && \
    pnpm --filter @nexus-form/database build && \
    pnpm --filter @nexus-form/integrations build && \
    pnpm --filter "@nexus-form/validation-provider-*" build && \
    pnpm --filter @nexus-form/api build && \
    pnpm --filter @nexus-form/web build

# Override validation-provider dist with CI pre-built artifacts so that
# plugin content hashes are identical across API and Worker images.
# Wildcard loop handles any provider matching validation-provider-* naming.
COPY ci-prebuilt/ ./ci-prebuilt/
RUN if [ -d ci-prebuilt/packages ]; then \
      for pkg in ci-prebuilt/packages/*; do \
        [ -f "$pkg/plugin.mjs" ] || continue; \
        name=$(basename "$pkg"); \
        cp "$pkg/plugin.mjs" "packages/$name/dist/plugin.mjs"; \
      done && \
      rm -rf ci-prebuilt; \
    fi

# Create a flat node_modules for the Drizzle migration script
RUN pnpm --filter @nexus-form/database deploy --prod /tmp/db-deploy
RUN mkdir -p /app/plugins/validation

# ── Hono API server ──
FROM deps AS runtime-deps

RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @nexus-form/api

FROM gcr.io/distroless/nodejs24-debian12:latest AS runner
WORKDIR /app

# Copy workspace structure for pnpm to resolve workspace: links
COPY --from=deps /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=deps /app/apps/api/package.json ./apps/api/
COPY --from=deps /app/packages/database/package.json ./packages/database/
COPY --from=deps /app/packages/integrations/package.json ./packages/integrations/
COPY --from=deps /app/packages/shared/package.json ./packages/shared/
COPY --from=deps /app/packages/validation-provider-discord/package.json ./packages/validation-provider-discord/
COPY --from=deps /app/packages/validation-provider-github/package.json ./packages/validation-provider-github/
COPY --from=deps /app/packages/validation-provider-twitter/package.json ./packages/validation-provider-twitter/

# Copy node_modules trees
COPY --from=runtime-deps /app/node_modules ./node_modules

# Copy built artifacts
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/integrations/dist ./packages/integrations/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/validation-provider-discord/dist ./packages/validation-provider-discord/dist
COPY --from=builder /app/packages/validation-provider-github/dist ./packages/validation-provider-github/dist
COPY --from=builder /app/packages/validation-provider-twitter/dist ./packages/validation-provider-twitter/dist

# Copy Drizzle migration script and dependencies to /migration/
COPY --from=builder /tmp/db-deploy/node_modules /migration/node_modules
COPY --from=builder /app/packages/database/drizzle /migration/drizzle
COPY ./scripts/run-migrations.mjs /migration/run-migrations.mjs
COPY --from=builder --chown=65532:65532 /app/plugins/validation /app/plugins/validation
COPY --from=builder --chown=65532:65532 /app/apps/web/dist ./apps/web/dist

COPY ./docker/start.mjs /app/start.mjs
ENV NODE_PATH=/app/node_modules

ARG GIT_HASH
ENV GIT_HASH=${GIT_HASH}
USER 65532:65532

ENTRYPOINT ["/nodejs/bin/node", "/app/start.mjs"]
