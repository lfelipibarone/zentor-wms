# Context: monorepo root (Dokploy Docker Context = /)
FROM node:20-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/mobile/package.json ./apps/mobile/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app /app
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN pnpm --filter @wms/shared build \
  && pnpm --filter @wms/api db:generate \
  && pnpm --filter @wms/api build

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3333
ENV HOST=0.0.0.0
COPY --from=build /app /app
EXPOSE 3333
# Usa env do Dokploy (não depende de arquivo .env)
CMD ["node", "apps/api/dist/index.js"]
