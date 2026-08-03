# DevOps / CI-CD — Career Copilot

**Last updated:** 2026-08-03

---

## 1. Branching and release flow

```
feature/*  ──PR──►  develop  ──auto──►  staging
                       │
                       └──PR──►  main  ──auto──►  production
hotfix/*   ──PR──►  main  (then back-merged to develop)
```

- `main` is always deployable. Protected: no direct pushes, no force-push.
- `develop` is the integration branch and mirrors staging.
- Branch names: `feature/`, `fix/`, `chore/`, `docs/`, `hotfix/`.
- PRs squash-merge with a Conventional Commit subject, so `main`'s history is one commit per
  change and the changelog generates itself.

---

## 2. Quality gates

A PR cannot merge unless every one of these is green:

| Gate                | Fails when                                          |
| ------------------- | --------------------------------------------------- |
| Lint                | Any ESLint error                                    |
| Format              | Prettier check fails                                |
| Typecheck           | Any TypeScript error in any workspace               |
| Unit tests          | Any failure                                         |
| Integration tests   | Any failure                                         |
| Coverage            | Below 80% overall, or below the per-area thresholds |
| Build               | Frontend or backend build fails                     |
| Bundle size         | Initial JS exceeds 250 KB gzip                      |
| Dependency audit    | Any high or critical advisory                       |
| Container scan      | Any high or critical in the image                   |
| Migration check     | Migrations fail to apply to a fresh database        |
| E2E (PRs to `main`) | Any failure                                         |
| Review              | Fewer than one approval                             |

---

## 3. Pipeline

```
push / PR
   │
   ├─ setup ─────────── checkout, pnpm, restore cache
   │
   ├─ ┌─ lint ──────────────┐
   │  ├─ typecheck ─────────┤  (parallel)
   │  ├─ unit tests ────────┤
   │  └─ dependency audit ──┘
   │
   ├─ integration tests ──── postgres + redis service containers
   │
   ├─ ┌─ build:web ────┐
   │  └─ build:api ────┘      (parallel)
   │
   ├─ bundle size check
   ├─ docker build ────────── multi-stage, layer-cached
   ├─ trivy scan ─────────── fail on HIGH/CRITICAL
   │
   ├─ [main | develop only]
   │     ├─ push image ────── ghcr.io, tagged with the commit SHA
   │     ├─ run migrations ── against the target environment
   │     ├─ deploy ────────── rolling
   │     ├─ health check ──── poll /health/ready, up to 60 s
   │     ├─ smoke test ────── critical-path E2E against the deployed URL
   │     └─ notify ────────── Discord/Slack with status, SHA, and duration
   │
   └─ on failed health check or smoke test → automatic rollback to the previous tag
```

### Workflow files

| File                    | Trigger           | Purpose                                                      |
| ----------------------- | ----------------- | ------------------------------------------------------------ |
| `ci.yml`                | push, PR          | Everything up to and including the image scan                |
| `deploy-staging.yml`    | push to `develop` | Deploy to staging                                            |
| `deploy-production.yml` | push to `main`    | Deploy to production, gated on a manual environment approval |
| `codeql.yml`            | schedule, PR      | Static analysis                                              |
| `nightly.yml`           | cron              | Full E2E, load test, dependency freshness                    |

Actions are pinned to commit SHAs, not tags. `GITHUB_TOKEN` permissions are declared
per-job at least privilege. Workflows triggered by forked PRs get no secrets.

---

## 4. Docker

Multi-stage build. The runtime stage contains no source, no dev dependencies, and no package
manager.

```dockerfile
# ---- deps ----
FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/*/package.json packages/
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM deps AS build
COPY . .
RUN pnpm --filter @cc/api build && pnpm --filter @cc/api exec prisma generate
RUN pnpm prune --prod

# ---- runtime ----
FROM node:22-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/apps/api/dist ./dist
COPY --from=build --chown=app:app /app/apps/api/prisma ./prisma
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
```

Non-negotiables: runs as a non-root user; `.dockerignore` excludes `.env`, `.git`,
`node_modules`, and tests; images are tagged `sha-<commit>` — never `latest`, because
rollback means redeploying a specific known-good tag and `latest` makes that impossible.

The worker runs the same image with `CMD ["node", "dist/worker.js"]`. One image, two
entrypoints — so a deploy cannot leave API and worker on different code.

---

## 5. Local development

```bash
pnpm install
cp .env.example .env
pnpm db:up          # postgres, redis, minio, mailhog
pnpm db:migrate
pnpm db:seed
pnpm dev            # api :54000, web :5173
```

`docker-compose.yml` provides Postgres 16 with `pgvector`, Redis 7, MinIO (S3-compatible),
and Mailpit (SMTP capture with a web UI). Everything a developer needs runs locally, and
`AI_PROVIDER=mock` is the default — so a new contributor can run the entire product without a
single API key.

**Host ports are deliberately non-default:** Postgres `55432`, Redis `56379`, MinIO
`59000`/`59001`, Mailpit `51025`/`58025`, API `54000`. Developer machines accumulate services,
and a collision here is not a loud failure — it is a connection that silently reaches the
wrong database or the wrong application. When checking whether a port is free, note that a
proxying Docker runtime can leave `lsof` and raw TCP probes reporting nothing while a service
still answers; the reliable test is whether a real connection is refused or answered.

---

## 6. Migrations in the pipeline

Migrations run as a **separate step before** the application deploy, against the target
environment, from the same image.

- Forward-only. `prisma migrate deploy`, never `migrate dev` or `reset`.
- Breaking changes ship as expand → backfill → contract across three releases, so the old and
  new application versions can both run against the intermediate schema. This is what makes a
  rolling deploy safe.
- A failed migration halts the deploy before any new application code is live.
- Long index builds use `CREATE INDEX CONCURRENTLY` in a manual migration, outside a transaction.

---

## 7. Environments and configuration

|          | Local           | Staging         | Production                 |
| -------- | --------------- | --------------- | -------------------------- |
| Web      | Vite dev server | Vercel preview  | Vercel / CDN               |
| API      | Compose         | 1 replica       | ≥ 2 replicas               |
| Worker   | Compose         | 1               | ≥ 1, scaled on queue depth |
| Postgres | Compose         | Neon (branch)   | Neon, PITR, daily backup   |
| Redis    | Compose         | Upstash         | Upstash, persistence on    |
| Storage  | MinIO           | R2 bucket       | R2 bucket                  |
| AI       | Mock            | Real, low quota | Real, full quota           |
| Secrets  | `.env`          | Platform store  | Platform store             |

Configuration is environment variables only, validated by a Zod schema at boot. A missing or
malformed variable crashes the process at startup with a readable message — a service must
never run half-configured and fail confusingly under load.

---

## 8. Rollback

**Application:** redeploy the previous `sha-*` image tag. Automatic when the post-deploy
health check or smoke test fails; manual otherwise, and it takes about a minute.

**Database:** migrations are not automatically reverted — an automatic down-migration on a
live database is how you turn an incident into data loss. Recovery is a forward compensating
migration, or point-in-time restore for genuine corruption. The expand/contract discipline is
what makes application rollback safe without a schema rollback: the previous version still
runs against the current schema.

**Feature flags** for anything risky, so a bad feature can be switched off without a deploy.

---

## 9. Monitoring the pipeline

- Deployment notifications to Discord/Slack: status, commit SHA, author, duration, environment.
- DORA metrics tracked: deployment frequency, lead time, change failure rate, MTTR.
- Flaky tests are quarantined and ticketed, never silently retried — a retry that hides a real
  race condition is worse than a red build.
- Pipeline duration is itself monitored. Past ~15 minutes, people start batching changes and
  reviewing less carefully, which is a quality problem disguised as a speed problem.

---

## 10. Release checklist

- [ ] All CI gates green on `main`
- [ ] Migrations reviewed and applied to staging with production-shaped data
- [ ] Staging smoke-tested manually on the changed surface
- [ ] Feature flags set to their intended states
- [ ] Rollback tag noted and confirmed to exist in the registry
- [ ] On-call aware, and not deploying into a maintenance window
- [ ] Docs updated in the same PR as the change
- [ ] Post-deploy: health check green, error rate flat, key metrics within 10% of baseline
