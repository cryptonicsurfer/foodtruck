# Multi-stage build for the foodtruck Next.js 15 app (standalone output).
# Uses pnpm (the repo's lockfile is pnpm-lock.yaml) via corepack.
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ---- deps: install with the frozen lockfile (supply-chain safe, no drift) ----
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- builder: compile the standalone server bundle ----
FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined at build time, so they must be present now.
# APP_URL/DIRECTUS_URL too: next.config.ts `env:` inlines them (server code
# included), so runtime env_file does not reach them. .env is not in the build
# context (.dockerignore) — everything comes in as build-args from compose.
ARG APP_URL
ARG DIRECTUS_URL
ARG NEXT_PUBLIC_DIRECTUS_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ARG NEXT_PUBLIC_GOOGLE_MAP_ID
ENV APP_URL=$APP_URL
ENV DIRECTUS_URL=$DIRECTUS_URL
ENV NEXT_PUBLIC_DIRECTUS_URL=$NEXT_PUBLIC_DIRECTUS_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_GOOGLE_MAP_ID=$NEXT_PUBLIC_GOOGLE_MAP_ID
RUN pnpm build

# ---- runner: minimal production image ----
FROM base AS runner
WORKDIR /app
# Säkerhetsuppdateringar från Debian vid varje bygge — basimagen byggs om uppströms med
# fördröjning (perl/libpcre2-fixar saknades i node:22-slim 2026-10-19).
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --create-home nextjs

# Standalone output: server.js + a trimmed node_modules at the image root,
# static assets under .next/static, and public/ served as-is.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
