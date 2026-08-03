# Build Tracker — Career Copilot

**Last updated:** 2026-08-03 · Owner: Neeraj Negi
**Current phase:** Phase 0 — Foundation · **Current slice:** 0.6 OAuth (next)

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
| Phase 0 — Foundation      | 4.9 / 8     | `WIP`  |
| Phase 1 — Core loop       | 0 / 9       | `TODO` |
| Phase 2 — Retention       | 0 / 7       | `TODO` |
| Phase 3 — Differentiation | 0 / 7       | `TODO` |
| Phase 4 — Scale           | 0 / 8       | `TODO` |

**Deployed:** nothing yet. **Tests:** 113 passing (35 unit, 78 integration). **Pipeline:** not yet configured.

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

## Phase 0 — Foundation `WIP`

### 0.1 Tooling `WIP`

- [x] Dedicated git repository initialised in the project folder
- [x] `.gitignore` covering env files, build output, uploads
- [x] pnpm workspace + root `package.json` scripts
- [x] `tsconfig.base.json` with strict settings
- [x] Prettier config
- [x] ESLint flat config with layer-boundary rules (controller↛Prisma, service↛express, ats↛I/O)
- [x] `docker-compose.yml` — Postgres 16 + pgvector, Redis 7, MinIO + bucket init, Mailpit
- [x] `.env.example` with every variable named
- [ ] Husky + lint-staged + commitlint

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

### 0.6 OAuth `TODO`

- [ ] Google (PKCE + signed state) · GitHub · Account linking + unlink guard

### 0.7 Web shell `TODO`

- [ ] Vite + React + TS + Tailwind + Framer Motion
- [ ] Design tokens from doc 04 · dark/light + `prefers-reduced-motion`
- [ ] TanStack Query client · API client with CSRF and refresh-on-401
- [ ] Auth store · protected routes
- [ ] Login, register, verify, forgot, reset, MFA screens
- [ ] UI primitives: Button, Input, Dialog, Toast, Card, Skeleton, EmptyState, ErrorState

### 0.8 Pipeline `TODO`

- [ ] `ci.yml`: lint, typecheck, unit, integration (service containers), coverage gate, build, bundle size, audit, Docker build, Trivy
- [ ] `deploy-staging.yml` and `deploy-production.yml` with health check + rollback
- [ ] `codeql.yml`, `nightly.yml`, `dependabot.yml`
- [ ] Branch protection on `main` and `develop`
- [ ] Notification webhook

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

| Date       | Decision                                                        | Rationale                                                                                                                                                                                                |
| ---------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-03 | Own git repo inside the project folder                          | The enclosing repo was rooted at `/Users/neerajnegi` and tracked SSH keys, shell history, and Google Drive. Committing from there would have staged secrets. The home repo was left untouched.           |
| 2026-08-03 | Express over NestJS                                             | Explicit layering keeps every mechanism legible at this codebase size. [ADR-002](./00-TRD.md#adr-002--express-over-nestjs)                                                                               |
| 2026-08-03 | ATS scoring is deterministic, not LLM-generated                 | Reproducible, free, testable, and defensible when a user asks why they scored 78. [ADR-003](./00-TRD.md#adr-003--deterministic-ats-scoring-llm-assisted-explanation)                                     |
| 2026-08-03 | Provider-agnostic AI layer, Claude default                      | Model price and quality move quarterly; binding business logic to one SDK is a liability. [ADR-004](./00-TRD.md#adr-004--provider-agnostic-ai-layer-with-claude-as-default)                              |
| 2026-08-03 | Embeddings are a separate interface from chat                   | The default chat provider exposes no embeddings endpoint. Collapsing the two would have coupled semantic matching to a capability the adapter does not have. [AI §2](./11-ai-prompt-design.md)           |
| 2026-08-03 | argon2id instead of the specified bcrypt                        | Memory-hard; degrades GPU cracking in a way bcrypt does not. bcrypt at cost ≥ 12 remains an acceptable fallback.                                                                                         |
| 2026-08-03 | No auto-apply, ever                                             | Violates job-platform terms, produces low-quality mass applications, risks user account bans. [PRD NG2](./01-PRD.md#4-goals-and-non-goals)                                                               |
| 2026-08-03 | Dedicated host port block (55432/56379/59000/59001/51025/58025) | 5432 and 5433 are both answered by other Postgres servers on this machine, one invisible to `lsof`. Default ports risked migrating the wrong database.                                                   |
| 2026-08-03 | `AuditLog.userId` carries no foreign key                        | `SetNull` issues an UPDATE the append-only trigger refuses, making account deletion impossible (NFR-51); `Cascade` would erase the trail being audited. Caught by an integration test.                   |
| 2026-08-03 | Append-only enforced by trigger, not `REVOKE`                   | A grant does not bind the table owner, and in development the app role _is_ the owner — the guarantee would fail exactly where it is easiest to violate.                                                 |
| 2026-08-03 | BRIN index on `AuditLog.createdAt` deferred                     | Prisma models indexes and has no BRIN support, so every `migrate diff` regenerates a DROP for it. Composite B-trees cover the queries until scale justifies an out-of-band migration.                    |
| 2026-08-03 | `citext` for email deferred                                     | Needs Prisma's `postgresqlExtensions` preview feature. Normalisation happens at the Zod boundary instead; documented rather than silently assumed.                                                       |
| 2026-08-03 | Reuse-detection revocation commits outside the transaction      | Throwing from inside a Prisma interactive transaction rolls it back, so the family revocation was silently undone while the response claimed success.                                                    |
| 2026-08-03 | Login limiter keyed on IP, not email+IP                         | Keyed per-email it duplicated account lockout, masked its better message, and never caught spraying across accounts — the attack a limiter exists to stop.                                               |
| 2026-08-03 | Cookie helpers live outside the service layer                   | `tokens.service.ts` importing express violated the layer rule the ESLint config enforces; writing a cookie is an HTTP concern.                                                                           |
| 2026-08-03 | Password context match needs 5+ characters                      | A 4-character minimum rejected legitimate passwords over generic email fragments (`info`, `live`), which users cannot make sense of.                                                                     |
| 2026-08-03 | Rate limiter failure mode is per-class, not global              | A blanket fail-closed turns a Redis blip into a full API outage, contradicting the availability SLO. Auth-sensitive routes fail closed; the rest fail open loudly. Supersedes the original blanket rule. |
| 2026-08-03 | Redis offline queue stays enabled                               | With it off, any command issued during a reconnect is rejected — a one-second failover would 503 every sign-in. `commandTimeout` bounds the wait instead.                                                |
| 2026-08-03 | API on port 54000                                               | Another local project owns 4000; `localhost` resolved to it, so the API appeared to start while requests reached the other app.                                                                          |

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
