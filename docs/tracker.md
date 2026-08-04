# Build Tracker — Career Copilot

**Last updated:** 2026-08-04 · Owner: Neeraj Negi
**Current phase:** Phase 1 — Core loop · slices 1.1–1.4 done. Next: slice 1.5 (export)

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
| Phase 1 — Core loop       | 4 / 9       | `WIP`  |
| Phase 2 — Retention       | 0 / 7       | `TODO` |
| Phase 3 — Differentiation | 0 / 7       | `TODO` |
| Phase 4 — Scale           | 0 / 8       | `TODO` |

**Deployed:** nothing yet. **Tests:** 357 passing. **Coverage:** 91.7% API lines, 96.7% `@cc/ats`. **Pipeline:** CI, deploy, CodeQL, Dependabot; every command verified locally.

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

**Branch protection is on `main`.** All seven CI checks are required, branches must be up to
date before merging, history is linear, and force-pushes and deletion are refused. Reviews are
required but the approving-review count is 0 — a solo developer cannot approve their own PR, and
a rule that makes merging impossible gets deleted within a week.

`enforce_admins` is **off**, and that was tested rather than assumed: a direct push to `main`
printed "Changes must be made through a pull request" and "7 of 7 required status checks are
expected" — and then updated the ref anyway, because repository admins bypass protection. On a
solo repository where the only contributor is an admin, the rules currently constrain nobody.
Turn it on with:

```bash
gh api -X POST repos/negineeraj331/ai-career-copilot/branches/main/protection/enforce_admins
```

The trade-off is real in both directions: on, and every change — including a one-line typo fix —
goes through a PR with a full CI run; off, and the protection is documentation rather than
enforcement. Worth knowing which one is in force, which is the point of writing it down.

Still open: a hosting target — open question 5, which slice 0.8 was meant to answer and did not.

---

## Phase 1 — Core loop `WIP`

`1.1` Resume model `DONE` · `1.2` ATS engine `DONE` · `1.3` Editor `DONE` ·
`1.4` Templates `DONE` · `1.5` Export · `1.6` AI layer · `1.7` JD analysis · `1.8` AI writing ·
`1.9` Versions

### `1.4` Templates `DONE`

- [x] Renderer contract: a template is a pure function of `(doc, sections)`
- [x] Six launch templates — Minimal, Classic, Compact, Technical, Academic, Two column
- [x] `atsSafe` flags, with the warning shown beside the choice rather than behind a tooltip
- [x] Template picker in the editor; switching saves immediately and re-renders the preview
- [x] `templateId` validated against the catalogue on both sides
- [x] 42 new tests, including the first render of the composed editor page

**Verified:** lint, format, typecheck, build clean · 357 tests pass · initial bundle unchanged at
95.1 KB, templates riding in the lazy-loaded editor chunk.

**The gap flagged at the end of 1.3 is closed.** Every piece of the editor was unit-tested and
nothing had ever rendered the page they add up to, so a broken import or a bad prop would have
shipped green. `EditorPage.test.tsx` now drives the real form, preview, score, and picker against
a mocked API — and it immediately found two bugs that every unit test had passed straight over:

- **The error state was unreachable.** `if (query.isPending || !doc)` came first, so a failed load
  left `doc` null and the page showed a skeleton forever. The user got a permanent spinner where
  a retry button was supposed to be.
- **The preview rendered twice**, once per breakpoint, with CSS hiding whichever did not apply.
  Both copies were in the accessibility tree, so a screen reader announced the entire resume
  twice. There is now one preview; the grid already collapsed that column below `lg`.

**A third bug, from the template tests:** the Technical and Academic templates promote Skills and
Education to the top of the page, and did so unconditionally — resurrecting a section the user
had explicitly hidden. A template may reorder what someone chose to show; it may not overrule
what they chose to hide.

**One template is deliberately not ATS-safe.** Two column ships flagged, with the reason stated
where the choice is made. A flag nothing ever trips is decoration, and its warning path is dead
code nobody has looked at — users will find a two-column template somewhere, and it is better
that it is one which tells them the cost.

**Deviation from docs/05, recorded rather than silent:** the template catalogue lives in
`@cc/shared`, not in a `Template` table. What the row would describe is a React component that
ships in the client bundle, so a database row could name a template the deployed build cannot
render — and that failure would land on a user rather than at deploy time. The API now validates
`templateId` against exactly what the web app can draw. Revisit if templates ever become
user-authored, at which point they stop being code and a table is right.

### `1.3` Editor `DONE`

- [x] Resume list: create, open, duplicate, delete, with the stored score shown
- [x] Split-screen editor — section nav, form, live preview
- [x] Section reorder: pointer drag, keyboard lift-and-move, and Move up / Move down buttons
- [x] Show / hide sections, persisted in the document so a restored version renders as chosen
- [x] Autosave 2 s after typing stops or on blur, with `expectedVersion` on every save
- [x] Conflict handling: 409 → `X-Current-Version` → "reload theirs", never a silent overwrite
- [x] Durable offline queue in IndexedDB, replayed on reconnect and on reopen
- [x] Live ATS score with the per-rule fixes beside the form
- [x] 27 new tests (18 reorder and document helpers, 9 autosave)

**Verified:** lint, format, typecheck, build clean · 317 tests pass · initial bundle 95.1 KB of
the 250 KB budget, the editor being lazy-loaded.

**Two bugs the tests found, both real.** `orderedSections` did not deduplicate, so a document
whose stored order repeated a key rendered that section twice and handed React two children
with the same key — which it resolves by dropping one, silently and far from the cause. And
`SectionReorder` moved focus with a global `document.querySelector`, which reaches the whole
page: with a stale animation frame pending it focused a button belonging to a different render,
and the next arrow key then acted on the wrong list. Both are now impossible — the second by
scoping the query to a ref on the component's own list.

**Three ways to reorder, not one.** docs/09 calls drag-only reordering an accessibility failure
rather than a missing feature, so the keyboard protocol (space to lift, arrows to move, space to
drop, Escape to cancel, `aria-live` at every step) and plain Move up / Move down buttons are
both first-class. Drag is native HTML5 rather than `@dnd-kit`: one vertical list does not
justify the bundle. The keyboard path has the most tests precisely because drag is the part
jsdom cannot exercise, so it is the affordance that would rot unnoticed.

**Deliberate deviations from docs/09 and docs/10, recorded rather than silent:**

- **Controlled inputs instead of React Hook Form.** The preview and the score are functions of
  the whole document, so the parent re-renders on every keystroke regardless; RHF would add a
  second source of truth and a synchronisation problem without removing the render. Revisit if a
  section grows past a dozen fields.
- **ATS scoring on the server, not in a Web Worker.** docs/10 puts it in a worker to protect the
  frame budget. It is a network call today because the engine already ships behind
  `POST /ats/score` and the same pure package can be imported into a worker later without
  changing a single call site. Worth doing when the round trip becomes visible; it is not yet.
- **Only the newest queued edit per resume is kept.** Autosave emits a stream of snapshots of the
  same document, so replaying every one on reconnect would write a version per keystroke-burst
  and rebuild exactly the history spam content-hash coalescing exists to prevent.
- Resizable panes, zoom, and page-break indicators are deferred to slice 1.4, where templates
  make them meaningful.

### `1.2` ATS engine `DONE`

- [x] `packages/ats` — pure functions, no I/O, no clock, no AI (FR-40)
- [x] Five rule families, 26 rules, weighted composite (FR-41)
- [x] Every rule returns id, label, status, weight, earned, explanation, and a fix (FR-42)
- [x] `POST /ats/score` — scores a stored resume or an unsaved draft
- [x] `atsScore` written on create, update, and restore; no longer permanently null
- [x] 63 unit tests in the package, 15 integration tests over HTTP

**Verified:** 96.7% statements / 96.7% lines in `packages/ats`, against the ≥ 95% NFR-40 asks
for · 207 API tests pass · lint, format, typecheck, build, bundle budget, audit all clean.

**The purity rule was tested, not assumed.** `packages/ats` has had a no-I/O ESLint rule since
slice 0.1 with no package to guard. Adding an `@prisma/client` import to `engine.ts` now fails
the lint run with the intended message; removing it goes clean again. A guard nobody has ever
seen fire is a guard nobody should trust.

**An empty resume scored 35/100 until the output was actually read.** Every test passed. The
cause was rules passing _vacuously_: with no bullets, "no first-person pronouns" and "no
clichés" both returned PASS, so an empty document collected full marks for defects it was too
empty to have. Absence of evidence is not compliance. Those rules now return NOT_APPLICABLE and
the engine redistributes weight across the components that did apply, which dropped an empty
document to 12/100 — with a regression test pinning it under 20.

**Two rules were weaker than their own descriptions.** `parse.tabular` required three pipe
characters, so it missed `Skill | Level | Years` — the three-column skills matrix the rule
exists to catch. `read.complexity` measured clause _length_, so it missed a chain of short
clauses, which is exactly what a run-on bullet is. Both were found by tests written from the
rule's stated intent rather than from its implementation.

**Design notes.** Keyword rules fall back to a role-generic bank when no JD is attached, because
"you are missing keywords" is not a usable finding when we never supplied any — that is slice
1.7's job. Partial credit is clamped to a strict interior, so a PARTIAL that awards full or zero
marks surfaces as a bug rather than silently collapsing into PASS or FAIL. A bare year does not
count as a quantified result: "Java developer since 2019" is tenure, not impact, and counting it
would let a resume full of dates score like one full of results.

The stored `atsScore` is only the composite integer; the breakdown is recomputed on demand
because the engine is pure and sub-millisecond, and caching a derived value that a rubric-version
bump invalidates would leave stale scores behind with nothing to detect them.

### `1.1` Resume model `DONE`

- [x] `Resume` and `ResumeVersion` models, migration `20260803202631_add_resume_domain`
- [x] Full CRUD: list (cursor-paginated), create, read, update, soft delete, duplicate
- [x] Immutable version snapshots — nothing in the repository layer updates a version row
- [x] Content-hash coalescing so an unchanged save does not grow history
- [x] Optimistic concurrency via `expectedVersion`, 409 + `X-Current-Version`
- [x] Version history, single-version read, and append-only restore
- [x] 35 new tests (11 unit on the hash, 24 integration against real Postgres)

**Verified:** typecheck, lint, format clean · 188 API tests pass · API line coverage 91.7% ·
every endpoint exercised over real HTTP against the running server, including the 409 header.

**Restore appends rather than rolls back.** Moving `currentVersionId` backwards would orphan
everything written after the restored point — which is precisely the work a user is most afraid
of losing at the moment they press restore. Restoring version 2 of 3 therefore writes version 4
holding version 2's content, and version 3 stays in the timeline. There is a test asserting
version 3 survives.

**The content hash needed a canonical serialisation, not `JSON.stringify`.** Stringify follows
insertion order, so a document rebuilt from form state hashes differently from the identical
document read back out of jsonb, and every autosave would append a version despite nothing
changing. Keys are sorted at every depth; array order is left alone, because moving a bullet is
a real edit. Both directions are tested.

**Ownership is filtered in the query, never checked after the read.** Every lookup carries
`userId` in its `WHERE` clause, and a cross-user request gets 404 rather than 403 — a 403
confirms the id exists, which is itself a disclosure. A version id belonging to another resume
is refused the same way.

**The tests were mutation-checked rather than trusted for passing.** All 35 passed on the first
run, which is not evidence of anything on its own. Deleting the `userId` filter and disabling
hash coalescing each made the relevant tests fail, so they are testing behaviour rather than
restating the implementation.

**`X-Current-Version` was a contract gap, not a design choice.** docs/06 promised the 409 would
carry the server's current version, but the error envelope's `details` is `{field, message}[]`
and holds strings only — the number was reachable only by parsing prose. It now rides on a typed
`VersionConflictError` and reaches the client as a header, matching how `RateLimitedError`
already surfaces `Retry-After`. docs/06 records the header.

**Deferred to their own slices, deliberately:** import (2.1), export (1.5), diff and compare
(1.9), share links (2.5). Per-version ATS scores are `null` until the scoring engine lands in
1.2; the field exists in the contract so the shape does not change under the client later.

**A real bug found in the test helpers, and one flake still open.**

`tokenFromEmail(subject)` matched on subject alone against a single shared in-memory mailbox.
Three test files send a message whose subject is "verify your email", to three different
addresses, so the helper returned whichever landed last — one file could consume another
file's token. It now requires a recipient and matches on both, and `resetAuthState` prunes only
its own file's messages instead of calling `clear()` on the shared mailbox. Fixed; the compiler
found all 23 call sites, and one of them (`registerVerified(email)`) was passing the module
default instead of its own argument, which the change surfaced immediately.

Separately, an intermittent 401 was chased across slices 1.1 and 1.2. Three findings, one of
which corrects the entry that used to be here.

**1. A real bug: `verifyPassword` reported operational failures as "wrong password".** The
implementation wrapped the entire argon2 call in `catch { return false }`. That is right for a
stored value that is not a hash and wrong for everything else — argon2 allocates 19 MiB per
verification, and a failed allocation told the user their password was incorrect. The cause had
been converted into a plausible answer, which is what made it undiagnosable. Now a non-argon2
value still reads as a wrong password (an error there would tell an attacker which accounts have
unusual records), and an argon2 failure is allowed to throw. `tests/password-verify.test.ts`
pins the boundary, written against the library's actual behaviour after probing it: an
undecodable hash returns false, an unknown variant throws.

**2. Randomised per-test emails.** Every auth and resume test now generates its own address
instead of sharing a module constant, so no test can inherit a user row, a lockout counter, or a
mailbox entry. Good hygiene, and it removed a whole class of ordering dependency — but it did
**not** fix the 401, which recurred on a brand-new unique address.

**3. The measurements were contaminated, and the earlier entry here was wrong.** It claimed the
flake was invisible to instrumentation because Vitest orders files by size. The real cause was
simpler and entirely self-inflicted: a **background soak loop and the running `pnpm dev` server
were sharing the same Redis and Postgres** as the suite under test. Proof came from the rate
limiter — its remaining counter, which must decrease monotonically within one sequential loop,
read `29 29 27 29 29 27 28 29 26`, and Redis held `cc:rl:register` and `cc:rl:login` keys the
probe never creates. With both stopped, twelve consecutive runs read a clean `29 28 27 26 …`.
Every "isolated" reproduction attempt had another vitest process deleting the same keys and rows
mid-test.

The lesson is procedural, not technical: **a soak that runs while you are still editing, against
shared infrastructure, measures your own interference.** Run it last, run it alone.

**4. The actual cause: connection churn in the test harness, not the application.** With a clean
baseline — nothing else running, all edits finished — the suite failed **2 of 20 runs**. The two
failures looked unrelated (a 401 at `/mfa/confirm`, and `read ECONNRESET` in a resume test), and
that was the clue: `ECONNRESET` is a socket error, not an assertion. `request.agent(app)` given
an Express _app_ rather than a _server_ makes supertest bind a fresh ephemeral port per agent,
and this suite builds a client per signed-in user per test — hundreds of listen/close cycles a
run, leaving **1213 sockets in TIME_WAIT** on the machine. The 401 fits the same cause: a
request that never cleanly reached the app it was aimed at.

The fix is four lines in `tests/helpers/auth.ts`: one listening server per app, memoised in a
`WeakMap` and `unref()`ed, reused by every client. No test file changed. **40 consecutive clean
runs** follow, against 18 of 20 before — at the observed 10% failure rate that outcome has about
a 1.5% chance of being luck, which is what makes this a fix rather than a hopeful streak. The
first 20 alone would not have been enough to say so. It also explains why
every earlier hypothesis — shared emails, argon2 memory, Vitest file ordering, TOTP drift —
failed to reproduce: none of them were it, and each was a plausible story fitted to a symptom
rather than a cause traced to evidence.

Both bugs found along the way were real and are worth keeping regardless. But the flake itself
was in the harness, and four rounds of theorising cost more than one round of measuring would
have.

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
