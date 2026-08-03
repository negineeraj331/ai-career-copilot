# Build Tracker — Career Copilot

**Last updated:** 2026-08-03 · Owner: Neeraj Negi
**Current phase:** Phase 0 — Foundation · **Current phase complete.** Next: Phase 1, slice 1.1 (resume model)

This is the live status of the build. The [roadmap](./17-feature-roadmap.md) says what we
intend to build and in what order; this file says what actually exists right now. Update it in
the same PR as the work — a tracker that lags the code is worse than no tracker, because
people trust it.

**Status keys:** `TODO` · `WIP` · `DONE` · `BLOCKED` · `DEFERRED`

---

## Snapshot

| Phase                     | Slices done | Status |
| ------------------------- | ----------- | ------ |
| Documentation             | 19 / 19     | `DONE` |
| Phase 0 — Foundation      | 8 / 8       | `DONE` |
| Phase 1 — Core loop       | 0 / 9       | `TODO` |
| Phase 2 — Retention       | 0 / 7       | `TODO` |
| Phase 3 — Differentiation | 0 / 7       | `TODO` |
| Phase 4 — Scale           | 0 / 8       | `TODO` |

**Deployed:** nothing yet. **Tests:** 173 passing (73 unit, 100 integration). **Coverage:** 91.0% API lines. **Pipeline:** CI, deploy, CodeQL, Dependabot; every command verified locally.

---

## Documentation `DONE`

| Doc                                                   | Status | Notes                                            |
| ----------------------------------------------------- | ------ | ------------------------------------------------ |
| [00 TRD](./00-TRD.md)                                 | `DONE` | 8 ADRs recorded                                  |
| [01 PRD](./01-PRD.md)                                 | `DONE` | Personas, feature IDs, metrics, risks            |
| [02 SRS](./02-SRS.md)                                 | `DONE` | FR-01…FR-93, NFR-01…NFR-54                       |
| [03 System Architecture](./03-system-architecture.md) | `DONE` | Modular monolith + worker                        |
| [04 UI/UX Design System](./04-ui-ux-design-system.md) | `DONE` | Chart palette validated against our own surfaces |
| [05 Database Design](./05-database-design.md)         | `DONE` | 20 tables, indexes justified per access path     |
| [06 API Specification](./06-api-specification.md)     | `DONE` | v1 REST contract                                 |
| [07 User Flows](./07-user-flows.md)                   | `DONE` | 11 flows incl. failure branches                  |
| [08 Folder Structure](./08-folder-structure.md)       | `DONE` | Layer rules + dependency graph                   |
| [09 Component Spec](./09-component-specification.md)  | `DONE` | Primitives, charts, editor                       |
| [10 State Management](./10-state-management.md)       | `DONE` | Server/client/form/URL split                     |
| [11 AI Prompt Design](./11-ai-prompt-design.md)       | `DONE` | Verified model IDs and pricing                   |
| [12 Security Design](./12-security-design.md)         | `DONE` | Threat model + controls                          |
| [13 Testing Strategy](./13-testing-strategy.md)       | `DONE` | Layers, coverage gates                           |
| [14 DevOps / CI-CD](./14-devops-cicd.md)              | `DONE` | Pipeline, Docker, rollback                       |
| [15 Monitoring & Logging](./15-monitoring-logging.md) | `DONE` | Metrics, alerts, SLOs                            |
| [16 Coding Standards](./16-coding-standards.md)       | `DONE` | Conventions + anti-patterns                      |
| [17 Feature Roadmap](./17-feature-roadmap.md)         | `DONE` | Phases 0–4, deferrals with reasons               |
| [README index](./README.md)                           | `DONE` |                                                  |

---

## Phase 0 — Foundation `DONE`

### 0.1 Tooling `DONE`

- [x] Dedicated git repository initialised in the project folder
- [x] `.gitignore` covering env files, build output, uploads
- [x] pnpm workspace + root `package.json` scripts
- [x] `tsconfig.base.json` with strict settings
- [x] Prettier config
- [x] ESLint flat config with layer-boundary rules (controller↛Prisma, service↛express, ats↛I/O)
- [x] `docker-compose.yml` — Postgres 16 + pgvector, Redis 7, MinIO + bucket init, Mailpit
- [x] `.env.example` with every variable named
- [x] Husky + lint-staged + commitlint (both directions tested)

**Verified:** `pnpm install` clean · `pnpm lint` exit 0 · `pnpm format:check` clean ·
`docker compose config` valid · all four containers boot healthy.

**Port block: 55432 / 56379 / 59000 / 59001 / 51025 / 58025.** Not the defaults, and not the
obvious `+1` alternatives either: 5432 and 5433 are both already answered by other Postgres
servers on this machine — one of them invisible to `lsof` and to raw TCP probes, because
OrbStack proxies on demand. A connection to either could silently hit the wrong database.
`Connection refused` (genuinely nothing there) versus a Postgres `FATAL` (something else
answering) is the only reliable way to tell a free port from a shadowed one here.

### 0.2 Shared contracts `DONE`

- [x] `@cc/shared` package scaffold (ESM, built with `tsc`)
- [x] Common schemas: uuid/email/url/month, cursor pagination, error envelope, 16 error codes
- [x] Auth schemas: register, login, MFA, reset, magic link, public user, sessions, 23 audit events
- [x] Resume document schema, versioned, stable ids on every array entry
- [x] JD schemas incl. the `jd.extract` structured-output contract
- [x] Analysis schemas: ATS rules, match breakdown, recommendations, AI proposals with placeholders
- [x] Constants: match/ATS weights, limits, score bands

**Verified:** typecheck clean · 9/9 unit tests pass.

**Bug caught by a test:** `z.email().trim().toLowerCase()` validates _before_ normalising in
Zod 4, so a pasted `"  User@Example.com "` was rejected as malformed instead of cleaned.
Fixed by piping normalisation first (`z.string().trim().toLowerCase().pipe(z.email())`), which
is also what SRS FR-01 actually specifies.

### 0.3 Data layer `DONE`

- [x] Prisma schema: User, OAuthAccount, RefreshToken, DeviceSession, VerificationToken, MfaCredential, LoginAttempt, AuditLog
- [x] `prisma.config.ts` (Prisma 7 moved the connection URL out of the schema)
- [x] Initial migration applied to local Postgres
- [x] Append-only enforcement on `AuditLog` via trigger, with a pruning escape hatch
- [x] Follow-up migration dropping the `AuditLog` → `User` foreign key
- [x] Idempotent seed script (4 accounts covering verified / unverified / pro / admin)
- [x] Integration tests for the append-only guarantee

**Verified:** 8 tables created · migration drift check reports no difference · triggers present ·
UUIDv7 confirmed (version nibble `7`, lexically time-ordered) · seed idempotent across runs ·
5/5 integration tests pass.

**Design conflict caught by a test:** `onDelete: SetNull` on `AuditLog.userId` issues an
`UPDATE`, which the append-only trigger refuses — so **deleting a user was impossible**,
breaking the 30-day purge required by NFR-51. Two documented properties were mutually
exclusive and neither doc noticed. Resolved by dropping the foreign key: `userId` is now a
plain pseudonymous UUID that outlives the `User` row, which is what the retention policy
described all along. Docs 05 and 12 corrected.

### 0.4 API core `DONE`

- [x] Zod-validated env with boot-time failure, cross-field rules, all problems reported at once
- [x] Pino logger with `AsyncLocalStorage` request IDs and serialiser-level redaction
- [x] `AppError` hierarchy (15 types) + terminal error handler + response envelope
- [x] Zod validation middleware that writes the parsed result back
- [x] Helmet CSP, strict CORS allowlist, 1 MB body limits
- [x] Redis rate limiter, Lua-atomic, with a per-class failure policy
- [x] CSRF double-submit with constant-time comparison
- [x] Prisma + Redis singletons with health probes
- [x] `/health` (liveness) and `/health/ready` (dependency detail)
- [x] Graceful shutdown on SIGTERM/SIGINT with a force-exit timer

**Verified:** typecheck clean · 44/44 tests pass · server boots and serves live traffic on
`:54000` · CSRF rejects then accepts · rate limiter returns 429 with `Retry-After` after the
window budget · security headers present · SIGTERM drains and releases the port, exit 0.

**Design change — rate limiter failure mode.** docs/12 §6 specified a blanket fail-closed.
Implementing it made the cost obvious: a Redis blip would take the entire API down, including
reads with no abuse risk, contradicting the availability SLO. Now per-class — auth-sensitive
routes fail closed, everything else fails open loudly. Both branches are tested.

**Bug caught while wiring it up.** `enableOfflineQueue: false` rejects any command issued
before the socket is ready, so a one-second Redis failover would have returned 503 from every
sign-in. Buffering with a one-second `commandTimeout` keeps short interruptions invisible
while a dead Redis still fails fast.

**Port 4000 was taken** by another local project, and `localhost` resolved to it — the API
"started" while curl reached the other app. Moved to `:54000`, matching the datastore block.

### 0.5 Authentication `DONE`

- [x] Register with enumeration-safe responses + email verification
- [x] Login with timing-equalised failure paths · Logout · Logout-all
- [x] Refresh rotation with family reuse detection
- [x] Password reset (revokes all sessions) · Magic link · Change password
- [x] Device session list and revoke, with ownership checks
- [x] TOTP enrol/confirm/verify/disable + 10 single-use recovery codes
- [x] Progressive lockout (5 failures, 1→30 min backoff) · Audit logging
- [x] Mailer behind an interface, in-memory double for tests

**Verified:** typecheck clean · lint clean · 104 API tests pass · full flow exercised live
against the running server, pulling the verification token out of Mailpit: register → verify →
login → /me → refresh → sessions → audit log → logout → 401.

**Three bugs found, two of them serious:**

1. **Reuse detection revoked nothing.** The family revocation was written _inside_ the Prisma
   interactive transaction and then the function threw — which rolls the transaction back. The
   401 looked right, the audit entry appeared, and the stolen session stayed alive. Detection
   now happens inside the transaction and revocation commits outside it. Caught by asserting
   the post-conditions, not the status code.
2. **Device sessions stored full IP addresses.** The controller built `ipPrefix` from `req.ip`
   directly instead of the already-truncated request context, so sessions kept whole addresses
   while the audit log correctly kept /24s. Then the truncation helper itself turned out to
   mangle `::ffff:127.0.0.1` — the IPv4-mapped form Node returns on every dual-stack socket —
   into `ffff:127.0.0.1::`. Tests passed throughout; a live run is what exposed both.
   `truncateIp` now has its own unit tests.
3. **The login rate limiter masked account lockout.** Keyed on email+IP at the same threshold
   as lockout, so it always fired first and users got a bare 429 instead of the lockout's
   message and backoff — and keyed per-email it never caught credential stuffing at all. Now
   keyed on IP with a budget above the lockout threshold.

**Also corrected:** an over-eager password/email similarity check rejected
`live-thicket-marmalade-42` for `live-…@example.com` on the 4-character fragment "live"; the
same rule would have rejected `information-security-99` for `info-desk@…`. Minimum matched
fragment raised to five characters, with regression tests both ways.

**Deferred, not claimed:** the breach-corpus (HIBP k-anonymity) half of the password check.
The static denylist is implemented; docs/12 now says so explicitly.

### 0.6 OAuth `DONE`

- [x] Provider adapter interface with Google and GitHub implementations
- [x] Single-use `state` in Redis, consumed with an atomic `GETDEL`
- [x] PKCE (S256) for Google; declared unsupported for GitHub rather than faked
- [x] Account resolution: provider account id → verified email → create
- [x] Linking a provider to an already-signed-in account
- [x] Unlink guard refusing to remove the last login method
- [x] MFA still enforced on the OAuth path
- [x] 22 integration tests against a stub adapter — no test contacts a real provider

**Verified:** typecheck clean · lint clean · 22/22 OAuth tests, 135 across the workspace.

**Two decisions worth recording.**

_GitHub does not support PKCE for OAuth Apps._ The adapter declares `supportsPkce: false`
instead of sending a challenge that GitHub would silently discard — which would have left the
code and the docs both claiming a protection that was not there. `state` plus a server-side
exchange with a client secret is what protects that flow, and PKCE's threat model (a public
client with an interceptable redirect) does not apply to a confidential server-side client.

_Matching an existing account by email requires the provider to have verified it._ Without
that gate, anyone able to register `victim@example.com` at an identity provider could claim
the matching account here. Unverified provider emails are refused for both linking and
creation, and both paths are tested.

**One flaky test, honestly unresolved.** `refuses a forged state` failed once and then passed
8 consecutive runs; I could not reproduce it. The likeliest cause is the shared 30/min
rate-limit bucket — every test hits the same 127.0.0.1 key. Rather than declare it fixed, the
assertion now reports the actual status and body, so a recurrence names its own cause instead
of only saying "expected 302". If it returns, that output is the next step.

### 0.7 Web shell `DONE`

- [x] Vite 8 + React 19 + TypeScript + Tailwind 4 (CSS-first `@theme`)
- [x] Design tokens from doc 04, including the validated chart palette
- [x] Light/dark via OS preference and an in-app toggle, no flash of wrong theme
- [x] `prefers-reduced-motion` enforced globally, not per component
- [x] TanStack Query client, query-key factory, API client with CSRF and single-flight refresh
- [x] Session as a query (never duplicated into a store) · protected + inverse route guards
- [x] Landing, login, register, MFA, verify-email, forgot/reset password, magic link, dashboard
- [x] UI primitives: Button, Input, Skeleton, EmptyState, ErrorState, FormMessage
- [x] Route-level code splitting; 11 API-client unit tests

**Verified:** typecheck, lint, and format clean · 11/11 web tests · production build succeeds ·
dev server serves the app shell with Tailwind tokens compiled · CORS preflight from the web
origin passes with credentials and rejects a foreign origin · a real login from the browser
origin returns the user, and `/me`, `/sessions` and `/audit-log` all render live data.

**Bundle:** landing-page initial JS ≈ **123 KB gzip** against a 250 KB budget.

**Framer Motion removed.** It cost **42 KB gzip** on the landing page's critical path — about a
quarter of the entire JS budget — for three staggered fade-ins that CSS keyframes do for
nothing. The dependency is gone rather than merely unimported: an unused dependency still costs
install time and audit surface. It returns in Phase 1 for the score meter and suggestion
crossfade, where interruptible animation genuinely earns its weight. docs/00 updated.

**Two environment bugs found by running it, not by testing it.**

1. _`pnpm install` silently breaks the API._ Installing anything wipes Prisma's generated
   client out of the pnpm store, and the next start fails with "does not provide an export
   named 'PrismaClient'". Adding `postinstall: prisma generate` to `@cc/api` makes that
   self-healing instead of a recurring puzzle.
2. _Port 5173 was taken_ by another long-running local project — and bound to IPv6 only, so
   the IPv4 probe that cleared it reported it free. Web now runs on `55173`, matching the
   block used by everything else. `strictPort: true` is what surfaced it rather than letting
   Vite slide to 5174 and silently break the API's CORS allowlist.

**Also fixed:** the seed used `update: {}`, so re-running it never changed an existing user's
password while still printing the new one — credentials that simply did not work. It now
converges the password on every run.

### 0.8 Pipeline `DONE`

- [x] `ci.yml`: static matrix (lint/format/typecheck), tests on real Postgres + Redis service
      containers, coverage gate, build, bundle budget, dependency audit, image build + Trivy
- [x] `deploy.yml`: staging on `develop`, production on `main`, environment gate, migrations
      before deploy, polled health check, rollback on failure, notification
- [x] `codeql.yml` weekly + on PR · `dependabot.yml` for npm, actions, and Docker
- [x] All 10 actions pinned to commit SHAs, resolved via the GitHub API
- [x] Multi-stage Dockerfile, non-root, working `HEALTHCHECK`
- [x] `scripts/check-bundle-size.mjs` enforcing the 250 KB initial-JS budget
- [ ] Branch protection on `main`/`develop` — needs a GitHub remote, which does not exist yet

**Verified:** every CI command run locally (lint, format, typecheck, build, bundle budget,
migrate deploy, audit, tests). All workflow YAML parses. The container was built, run against
the real Postgres and Redis, and serves: `/health`, `/health/ready` reporting all dependencies
ok, a real login returning a user, Docker's own `HEALTHCHECK` reporting `healthy`, and the
process running as non-root (uid 100).

**Running the CI commands locally found three real problems** that reading the YAML would not
have. A `no-console` lint failure in the new bundle script (console _is_ a CI script's
interface — `scripts/**` is now exempt). Three unformatted files. And a **HIGH-severity
advisory**: react-router had a CSRF bypass, patched in v8. We do not use the affected RSC mode,
but "not reachable" is not a reason to ship a known-vulnerable version — migrated to
`react-router@8` (the `react-router-dom` package is folded into it in v8). Audit is now clean.

**The Dockerfile took six attempts, each a genuine bug:**

1. `tsconfig.base.json` was never copied, so `extends` resolved to nothing and tsc fell back to
   defaults — the build died inside a dependency's `.d.ts` files looking like a broken package.
2. The API build step was missing entirely; the runtime stage copied a `dist` that never existed.
3. `pnpm prune` aborts without a TTY. `CI=true` fixes it.
4. `husky init` had silently rewritten `prepare` from `husky || true` to `husky`, so pruning dev
   dependencies removed husky and the lifecycle script then failed — this would have broken
   **any** production install, not just Docker.
5. `dotenv` was a top-level import but a dev dependency, so the container crashed on startup
   before running a line. Now a guarded dynamic import: production takes config from the
   orchestrator, never from a file in the image.
6. The generated Prisma client lived in `node_modules`, and `pnpm deploy` relinked a clean
   `@prisma/client` over it — the container started with a stub that has no `PrismaClient`
   export. Fixed properly by generating into `apps/api/src/generated` so the client is a build
   artifact that travels with the code. That also removed the `postinstall: prisma generate`
   hack added in slice 0.7.

**Image size: 499 MB against a 300 MB target — unmet, and recorded rather than hidden.**
`@prisma/client@7` declares `prisma` as an _optional_ peer; because the CLI is a devDependency
of `@cc/api`, pnpm resolves it and `--prod` keeps the resolved variant plus Studio (43 MB), the
CLI (42 MB), `effect` (33 MB), pglite (24 MB), TypeScript (23 MB), `@prisma/dev` (19 MB), and
`react-dom`. Deleting those directories reaches 464 MB and was tried, but it also removes
`@prisma/client-runtime-utils`, which the generated client loads at startup — a smaller image
that does not boot is worth nothing. The CI gate sits at 800 MB so it catches a regression; a
gate pinned at an aspiration is one people switch off. Closing this means moving the CLI out of
`apps/api`'s dependencies so the optional peer never resolves.

> The 751 MB figure previously recorded here was wrong — a local arm64 measurement standing in
> for the amd64 artifact that actually deploys. Worse, `docker image inspect --format '{{.Size}}'`
> reports **compressed** size under the containerd image store and **unpacked** size under the
> classic store CI uses, a 5× gap on identical bits (151 MB vs 719 MB locally). The CI step now
> prints both numbers. Lesson: a measurement quoted without naming the platform and the tool is
> not a measurement.

**Coverage rose from 83.7% to 91.0%** by writing tests that were genuinely missing rather than
by lowering the bar: the real OAuth provider adapters (19% and 23%, because every integration
test used a stub — and they hold the provider-specific traps, like GitHub answering 200 with an
error body) and the account-management flows (change password, sign out everywhere, resend
verification) which had no tests at all. docs/13 now carries measured numbers, and records that
auth is 94.7% against a stated 95% target.

### `0.9` Published to GitHub — what the first real CI runs found `DONE`

Repository: [negineeraj331/ai-career-copilot](https://github.com/negineeraj331/ai-career-copilot),
public. CI green on `main` across all seven jobs; CodeQL green.

Three runs were needed, and every failure was a real defect that local runs could not have
caught. This is the argument for pushing early rather than polishing a pipeline nobody has run.

1. **Run 1 — typecheck, build, and tests all failed on a clean checkout.** The generated Prisma
   client is gitignored, the `postinstall` that produced it had been retired in 0.8 once
   generation moved into `src/generated`, and no CI job ran `prisma generate`. Locally the
   directory was still on disk from an earlier run, so everything passed. Anyone cloning the
   repository and following the README would have hit the same wall. Fixed by restoring
   `postinstall: prisma generate`; the Docker deploy takes `--ignore-scripts` because the CLI is
   a devDependency the `--prod` tree deliberately lacks.
2. **Run 2 — the image scan failed on six CVEs, one CRITICAL.** `tar`, `sigstore`, `picomatch`,
   and `brace-expansion`, none of them ours. All six were copies vendored inside **npm's own
   node_modules**, shipped by `node:22-alpine`. `pnpm audit` passed the same commit because none
   of it is in our lockfile — auditing a manifest and scanning an artifact answer different
   questions. The first attempted fix (pnpm overrides pinning the four packages) was a
   misdiagnosis and was reverted once `pnpm install` reported nothing to change. The real fix was
   deleting npm from the runtime image, which the Dockerfile header already claimed carried no
   package manager. It does now.
3. **Run 3 — green.**

Also corrected: the image-size figure (see above), and the Deploy workflow, which failed on every
push because no `DATABASE_URL` secret exists. It now skips migrations with a warning, matching how
it already handled a missing `DEPLOY_HOOK`.

Dependabot opened 10 PRs within minutes, and CI **failed** the `node:22-alpine` → `26-alpine`
bump — the pipeline catching a breaking change on a PR, which is exactly the job.

Still open: branch protection on `main` (now possible, since a remote finally exists), and a
hosting target — open question 5, which slice 0.8 was meant to answer and did not.

---

## Phase 1 — Core loop `TODO`

`1.1` Resume model · `1.2` ATS engine · `1.3` Editor · `1.4` Templates · `1.5` Export ·
`1.6` AI layer · `1.7` JD analysis · `1.8` AI writing · `1.9` Versions

Expanded into checklists when Phase 0 closes. See the [roadmap](./17-feature-roadmap.md#phase-1--the-core-loop-next).

---

## Phases 2–4 `TODO`

Not broken down yet — deliberately. Detailed checklists written more than one phase ahead go
stale before they are used.

---

## Decisions log

| Date       | Decision                                                        | Rationale                                                                                                                                                                                                                                                               |
| ---------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-03 | Own git repo inside the project folder                          | The enclosing repo was rooted at `/Users/neerajnegi` and tracked SSH keys, shell history, and Google Drive. Committing from there would have staged secrets. The home repo was left untouched.                                                                          |
| 2026-08-03 | Express over NestJS                                             | Explicit layering keeps every mechanism legible at this codebase size. [ADR-002](./00-TRD.md#adr-002--express-over-nestjs)                                                                                                                                              |
| 2026-08-03 | ATS scoring is deterministic, not LLM-generated                 | Reproducible, free, testable, and defensible when a user asks why they scored 78. [ADR-003](./00-TRD.md#adr-003--deterministic-ats-scoring-llm-assisted-explanation)                                                                                                    |
| 2026-08-03 | Provider-agnostic AI layer, Claude default                      | Model price and quality move quarterly; binding business logic to one SDK is a liability. [ADR-004](./00-TRD.md#adr-004--provider-agnostic-ai-layer-with-claude-as-default)                                                                                             |
| 2026-08-03 | Embeddings are a separate interface from chat                   | The default chat provider exposes no embeddings endpoint. Collapsing the two would have coupled semantic matching to a capability the adapter does not have. [AI §2](./11-ai-prompt-design.md)                                                                          |
| 2026-08-03 | argon2id instead of the specified bcrypt                        | Memory-hard; degrades GPU cracking in a way bcrypt does not. bcrypt at cost ≥ 12 remains an acceptable fallback.                                                                                                                                                        |
| 2026-08-03 | No auto-apply, ever                                             | Violates job-platform terms, produces low-quality mass applications, risks user account bans. [PRD NG2](./01-PRD.md#4-goals-and-non-goals)                                                                                                                              |
| 2026-08-03 | Dedicated host port block (55432/56379/59000/59001/51025/58025) | 5432 and 5433 are both answered by other Postgres servers on this machine, one invisible to `lsof`. Default ports risked migrating the wrong database.                                                                                                                  |
| 2026-08-03 | `AuditLog.userId` carries no foreign key                        | `SetNull` issues an UPDATE the append-only trigger refuses, making account deletion impossible (NFR-51); `Cascade` would erase the trail being audited. Caught by an integration test.                                                                                  |
| 2026-08-03 | Append-only enforced by trigger, not `REVOKE`                   | A grant does not bind the table owner, and in development the app role _is_ the owner — the guarantee would fail exactly where it is easiest to violate.                                                                                                                |
| 2026-08-03 | BRIN index on `AuditLog.createdAt` deferred                     | Prisma models indexes and has no BRIN support, so every `migrate diff` regenerates a DROP for it. Composite B-trees cover the queries until scale justifies an out-of-band migration.                                                                                   |
| 2026-08-03 | `citext` for email deferred                                     | Needs Prisma's `postgresqlExtensions` preview feature. Normalisation happens at the Zod boundary instead; documented rather than silently assumed.                                                                                                                      |
| 2026-08-03 | Prisma client generated into `src/generated`                    | In node_modules it was wiped by every install and replaced by `pnpm deploy`, so the production container booted with a stub lacking the PrismaClient export. As a build artifact it travels with the code.                                                              |
| 2026-08-03 | Migrated to react-router v8                                     | A HIGH advisory (CSRF bypass) in v7. The affected RSC mode is unused, but shipping a known-vulnerable version because the path looks unreachable is not a decision worth defending.                                                                                     |
| 2026-08-03 | Image-size gate at 800 MB, target 300 MB                        | The target is unmet at 499 MB for reasons inside Prisma's packaging. A gate set to an aspiration fails every run and gets disabled; this one catches regressions while the target stays recorded.                                                                       |
| 2026-08-03 | `postinstall: prisma generate` restored in `@cc/api`            | The generated client is gitignored and nothing regenerated it on a clean checkout, so CI failed three jobs that all passed locally. One line fixes CI and the fresh-clone path; Docker passes `--ignore-scripts` because the CLI is absent from the `--prod` tree.      |
| 2026-08-03 | npm deleted from the runtime image                              | Trivy failed on six CVEs (1 CRITICAL) vendored inside npm's own node_modules via the base image, none in our lockfile. The container runs `node dist/index.js` and never needs a package manager; removing it also denies an attacker the ability to install more code. |
| 2026-08-03 | Deploy skips migrations when `DATABASE_URL` is unset            | No hosting target is wired up, and a pipeline that fails red on every push to main teaches people to ignore red pipelines — the exact failure this workflow exists to prevent. It fails loudly once a target is configured.                                             |
| 2026-08-03 | dotenv loaded only outside production                           | A production container takes config from the orchestrator. A static import of a dev dependency crashed the container before any application code ran.                                                                                                                   |
| 2026-08-03 | Framer Motion dropped from the web app                          | 42 KB gzip on the landing critical path for three fade-ins CSS does free. Returns in Phase 1 where interruptible animation is actually needed.                                                                                                                          |
| 2026-08-03 | `postinstall: prisma generate` on @cc/api                       | Any `pnpm install` wipes the generated client, so the API fails to boot until someone remembers to regenerate it.                                                                                                                                                       |
| 2026-08-03 | Web on port 55173                                               | 5173 is held by another local project, IPv6-only — an IPv4 probe wrongly reported it free. `strictPort` surfaced it instead of sliding to 5174 and breaking CORS.                                                                                                       |
| 2026-08-03 | Tailwind 4, CSS-first, no JS config                             | `@theme` in tokens.css is the single source of truth the design system asks for; a JS config would mirror the same values in a second place.                                                                                                                            |
| 2026-08-03 | GitHub adapter declares `supportsPkce: false`                   | GitHub OAuth Apps ignore a PKCE challenge silently, so sending one would make the code and docs claim a protection that is not applied.                                                                                                                                 |
| 2026-08-03 | OAuth email matching requires provider verification             | Otherwise registering `victim@example.com` at an identity provider takes over the matching account here.                                                                                                                                                                |
| 2026-08-03 | Unlink refuses to remove the last login method                  | An account with no password and no provider is unreachable by anyone while still holding the user's data.                                                                                                                                                               |
| 2026-08-03 | Reuse-detection revocation commits outside the transaction      | Throwing from inside a Prisma interactive transaction rolls it back, so the family revocation was silently undone while the response claimed success.                                                                                                                   |
| 2026-08-03 | Login limiter keyed on IP, not email+IP                         | Keyed per-email it duplicated account lockout, masked its better message, and never caught spraying across accounts — the attack a limiter exists to stop.                                                                                                              |
| 2026-08-03 | Cookie helpers live outside the service layer                   | `tokens.service.ts` importing express violated the layer rule the ESLint config enforces; writing a cookie is an HTTP concern.                                                                                                                                          |
| 2026-08-03 | Password context match needs 5+ characters                      | A 4-character minimum rejected legitimate passwords over generic email fragments (`info`, `live`), which users cannot make sense of.                                                                                                                                    |
| 2026-08-03 | Rate limiter failure mode is per-class, not global              | A blanket fail-closed turns a Redis blip into a full API outage, contradicting the availability SLO. Auth-sensitive routes fail closed; the rest fail open loudly. Supersedes the original blanket rule.                                                                |
| 2026-08-03 | Redis offline queue stays enabled                               | With it off, any command issued during a reconnect is rejected — a one-second failover would 503 every sign-in. `commandTimeout` bounds the wait instead.                                                                                                               |
| 2026-08-03 | API on port 54000                                               | Another local project owns 4000; `localhost` resolved to it, so the API appeared to start while requests reached the other app.                                                                                                                                         |

---

## Open questions

| #   | Question                                                                             | Needed by |
| --- | ------------------------------------------------------------------------------------ | --------- |
| 1   | Embedding provider — hosted API or a local model in development?                     | Slice 1.7 |
| 2   | Voice mock interviews — browser Web Speech API or a hosted STT/TTS provider?         | Slice 4.6 |
| 3   | Keep uploaded source files after extraction, or discard at 30 days? Leaning discard. | Slice 2.1 |
| 4   | Payment provider for the Indian market (Razorpay vs Stripe)?                         | Slice 3.7 |
| 5   | Hosting target for the API — Railway, Render, or Fly.io?                             | Slice 0.8 |

---

## Risks being watched

| Risk                                      | Status      | Mitigation                                                  |
| ----------------------------------------- | ----------- | ----------------------------------------------------------- |
| Scope collapse under 40 features          | **Active**  | Roadmap phases are enforced; nothing starts out of order    |
| AI cost exceeding ₹35/user/month          | Monitored   | Model routing, content-hash caching, metered per call       |
| PDF extraction quality on unusual layouts | Not yet hit | Multi-parser fallback + manual correction UI planned in 2.1 |
| Solo bandwidth vs the schedule            | **Active**  | Phases slip whole rather than starting the next one early   |
