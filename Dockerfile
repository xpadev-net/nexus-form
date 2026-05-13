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

# Create a flat node_modules for the Drizzle migration script
RUN pnpm --filter @nexus-form/database deploy --prod /tmp/db-deploy

# ── Hono API server ──
FROM base AS runner

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
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/database/node_modules ./packages/database/node_modules
COPY --from=deps /app/packages/integrations/node_modules ./packages/integrations/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy built artifacts
COPY --from=builder --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=node:node /app/packages/database/dist ./packages/database/dist
COPY --from=builder --chown=node:node /app/packages/integrations/dist ./packages/integrations/dist
COPY --from=builder --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=node:node /app/packages/validation-provider-discord/dist ./packages/validation-provider-discord/dist
COPY --from=builder --chown=node:node /app/packages/validation-provider-github/dist ./packages/validation-provider-github/dist
COPY --from=builder --chown=node:node /app/packages/validation-provider-twitter/dist ./packages/validation-provider-twitter/dist

# Copy Vite SPA dist so the API can optionally serve static files
COPY --from=builder --chown=node:node /app/apps/web/dist ./apps/web/dist

# Copy Drizzle migration script and dependencies to /migration/
COPY --from=builder --chown=node:node /tmp/db-deploy/node_modules /migration/node_modules
COPY --from=builder --chown=node:node /app/packages/database/drizzle /migration/drizzle
COPY --chown=node:node ./scripts/run-migrations.mjs /migration/run-migrations.mjs

COPY ./docker/.env.placeholder ./.env
COPY ./docker/env-replacer.sh ./
COPY ./start.sh ./

RUN chmod +x ./env-replacer.sh && \
    chmod +x ./start.sh && \
    mv .env .env.replacer && \
    mkdir -p /app/plugins/validation && \
    chown -R node:node /app/plugins

USER node

ENTRYPOINT [ "/app/env-replacer.sh" ]

CMD ["./start.sh"]
