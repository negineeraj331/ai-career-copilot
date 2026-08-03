# syntax=docker/dockerfile:1

# Multi-stage: the runtime image carries no source, no dev dependencies, and no
# package manager. Built from the repository root so the workspace lockfile and
# the shared packages are in context.

# ─── deps ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app

# Manifests only, so this layer stays cached until a dependency actually
# changes — copying the whole tree here would invalidate it on every edit.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

# --ignore-scripts: the Prisma generate step needs the schema, which is not in
# context yet. It runs explicitly in the build stage below.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ─── build ───────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

# The root tsconfig every package `extends`. Omitting it does not fail loudly:
# tsc silently falls back to compiler defaults, losing esModuleInterop and
# skipLibCheck, and the build then dies deep inside a dependency's .d.ts files
# with errors that look like a broken dependency rather than missing config.
COPY tsconfig.base.json ./

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# `prisma generate` BEFORE `build`. The generator writes the client into
# apps/api/src/generated (see schema.prisma) and the build copies it into dist,
# so the client travels with the code that imports it instead of living in
# node_modules — where an install or a relink silently replaces it with a stub
# that has no PrismaClient export, and the container dies on startup.
RUN pnpm --filter @cc/shared build \
 && pnpm --filter @cc/api exec prisma generate \
 && pnpm --filter @cc/api build

# A self-contained production tree for this one project.
#
# CI=true because pnpm refuses to write over a modules directory without a TTY
# to confirm on, and a docker build has none by definition.
#
# --ignore-scripts because @cc/api has a `postinstall` that runs `prisma
# generate`, and the Prisma CLI is a devDependency that --prod deliberately
# leaves out. Without this the deploy dies on a missing binary. The client is
# already generated above and travels inside dist, so there is nothing for a
# postinstall to do here anyway.
RUN CI=true pnpm deploy --filter=@cc/api --prod --legacy --ignore-scripts /prod/api

# ─── runtime ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production

# Non-root. A container running as root turns a code-execution bug into a
# container-escape attempt rather than a contained failure.
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

# One tree: dist (including the generated Prisma client), prisma, package.json,
# and production-only node_modules with @cc/shared materialised inside it.
COPY --from=build --chown=app:app /prod/api ./

USER app
EXPOSE 4000

# Liveness, not readiness: readiness reports dependency health, and a database
# blip should not make the orchestrator kill an otherwise healthy process.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
