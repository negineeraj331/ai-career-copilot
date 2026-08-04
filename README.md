# AI Career Copilot

An AI career platform, not a resume generator. It reads a job description, builds an
ATS-optimized resume against it, prepares you for the interview, and tracks the
application through to an outcome.

[![CI](https://github.com/negineeraj331/ai-career-copilot/actions/workflows/ci.yml/badge.svg)](https://github.com/negineeraj331/ai-career-copilot/actions/workflows/ci.yml)
[![CodeQL](https://github.com/negineeraj331/ai-career-copilot/actions/workflows/codeql.yml/badge.svg)](https://github.com/negineeraj331/ai-career-copilot/actions/workflows/codeql.yml)

> **Status: Phase 1 in progress — 8 of 9 slices.** The identity, security, and delivery
> foundation is complete and running in a container. Versioned resumes and deterministic ATS
> scoring now work end to end. The rest of what
> [`docs/01-PRD.md`](docs/01-PRD.md) describes — JD matching, AI writing, the editor, exports,
> interview prep — is **designed but not built**. See
> [Where this actually is](#where-this-actually-is) before reading further.

---

## What exists today

| Area                                                       | State           |
| ---------------------------------------------------------- | --------------- |
| Email + password auth, argon2id hashing                    | Working         |
| Google and GitHub OAuth, PKCE, account linking             | Working         |
| TOTP multi-factor with recovery codes                      | Working         |
| JWT access + refresh rotation with family reuse detection  | Working         |
| Device session list and remote revocation                  | Working         |
| Append-only audit log, enforced by a database trigger      | Working         |
| Redis rate limiting, CSRF, Helmet, request correlation     | Working         |
| Web shell: sign-up, sign-in, MFA, OAuth callback, sessions | Working         |
| CI, container image, deploy pipeline with rollback         | Working         |
| Versioned resumes: CRUD, immutable history, restore        | Working         |
| ATS scoring: 26 rules, weighted rubric, per-rule fixes     | Working         |
| JD analysis, AI writing, editor, export, interview prep    | **Not started** |

581 tests pass. API line coverage is 91.0%, the auth module 94.7% against a stated 95%, and
the ATS engine 96.7% against a required 95%. Numbers are measured, not aspirational — see
[`docs/13-testing-strategy.md`](docs/13-testing-strategy.md).

---

## Running it locally

**Prerequisites:** Node 22+, pnpm 11, Docker.

```bash
git clone https://github.com/negineeraj331/ai-career-copilot.git
cd ai-career-copilot
pnpm install

cp .env.example .env          # then generate the two secrets below
pnpm db:up                    # Postgres, Redis, MinIO, Mailpit
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`.env` ships with placeholders that are **deliberately invalid** — the app refuses to
start rather than run on a guessable key. Generate real ones:

```bash
node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log('ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('base64'))"
```

| Service                              | URL                                            |
| ------------------------------------ | ---------------------------------------------- |
| Web                                  | http://localhost:55173                         |
| API                                  | http://localhost:54000/api/v1                  |
| Health / readiness                   | http://localhost:54000/health, `/health/ready` |
| Mailpit (catches all outbound email) | http://localhost:58025                         |
| MinIO console                        | http://localhost:59001                         |

Health endpoints sit at the root, deliberately outside `/api/v1` — an orchestrator probing
liveness should not be versioned alongside the product API. Everything else is under the
prefix, and every mutating request needs the `cc_csrf` cookie echoed in an `x-csrf-token`
header:

```bash
curl -c jar http://localhost:54000/api/v1/auth/me           # sets the CSRF cookie
CSRF=$(awk '$6=="cc_csrf"{print $7}' jar)
curl -b jar -c jar -X POST http://localhost:54000/api/v1/auth/login \
  -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
  -d '{"email":"aditi@example.com","password":"seeded-lantern-oxide-97"}'
```

Ports are in a dedicated 5xxxx block rather than on 5432/6379/4000/5173. Those were all
already taken on the development machine, some by services invisible to `lsof` because
of on-demand proxying. Unusual ports cost nothing; a silent clash costs an afternoon.

**Seeded accounts** (development only, created by `pnpm db:seed`):

All share the password `seeded-lantern-oxide-97`.

| Email                    | Notes                                                   |
| ------------------------ | ------------------------------------------------------- |
| `aditi@example.com`      | verified, free tier                                     |
| `rohan@example.com`      | verified, pro tier                                      |
| `unverified@example.com` | unverified on purpose — exercises the verification gate |
| `admin@example.com`      | admin role                                              |

None have MFA enrolled; enroll from the account screen to exercise that path.

OAuth and AI stay off until you supply credentials. `AI_PROVIDER=mock` returns
deterministic fixtures, which is what the tests use — **no test ever contacts a real AI
or OAuth provider.**

## Commands

|                                                  |                                         |
| ------------------------------------------------ | --------------------------------------- |
| `pnpm dev`                                       | API and web, in parallel                |
| `pnpm test` / `pnpm test:coverage`               | tests, with the coverage gates          |
| `pnpm lint` `pnpm format:check` `pnpm typecheck` | exactly what CI runs                    |
| `pnpm build`                                     | shared packages, then apps              |
| `pnpm db:studio` / `db:reset`                    | Prisma Studio / rebuild from migrations |

---

## Architecture

```
apps/web    React 19, Vite 8, Tailwind 4, TanStack Query, Zustand
apps/api    Express 5, Prisma 7 on Postgres 16 + pgvector, Redis, BullMQ worker
packages/   shared Zod contracts — one schema, validated on both sides
            ats — the scoring rubric as pure functions, no I/O at all
            exporters — Markdown, JSON, LaTeX, print HTML, also pure
            ai — provider interface, Claude adapter, prompts, cost model
            match — deterministic JD matching, gaps, recommendations
docs/       19 documents; the design that came before the code
```

Three rules are enforced by ESLint as **errors**, not by convention:

- controllers never touch Prisma — they call services
- services never import Express — they take data, return data
- `packages/ats` performs no I/O — scoring must stay a pure function to be testable

A layering rule nobody checks is a layering rule that has already been broken. These have
both been seen to fire: the service↛express rule caught `tokens.service.ts` picking up an
Express import for cookie helpers, and the ats↛I/O rule was deliberately violated once, with
an `@prisma/client` import, to confirm it fails the build before being trusted.

**Security.** argon2id; opaque refresh tokens SHA-256 hashed at rest; refresh rotation
where reusing a spent token revokes the entire family and every session; double-submit
CSRF; per-class rate limiting (auth fails closed, everything else fails open, so a Redis
blip degrades the API instead of taking it down); IP addresses truncated before storage;
an audit log a Postgres trigger will not let you `UPDATE` or `DELETE`. Full rationale in
[`docs/12-security-design.md`](docs/12-security-design.md).

**Pipeline.** Static checks as a parallel matrix; tests against real Postgres and Redis
service containers rather than mocks, because the append-only trigger and rotation
semantics are database behaviour; coverage gates; a 250 KB gzip bundle budget; dependency
audit; image build with a Trivy scan. Deploy runs migrations first, polls health, and
rolls back on failure. All ten GitHub Actions are pinned to commit SHAs.

## Documentation

Nineteen documents in [`docs/`](docs/README.md) — PRD, SRS, architecture, design system,
database, API spec, user flows, state management, AI prompt design, security, testing,
DevOps, monitoring, coding standards, roadmap. Requirement IDs (`FR-*`, `NFR-*`) thread
through all of them.

Two worth opening first: [`docs/00-TRD.md`](docs/00-TRD.md) for the eight architecture
decision records, and [`docs/tracker.md`](docs/tracker.md), which logs what was built,
what broke, and what is still owed.

---

## Where this actually is

Phase 1, slice 8 of 9. Everything above under "What exists today" is real and verified;
everything in the product vision beyond it is design work only.

Known and recorded, not hidden:

- **The container image is 499 MB against a 300 MB target.** `@prisma/client@7` declares
  the CLI as an _optional_ peer, so `pnpm deploy --prod` keeps it and everything under it:
  Prisma Studio, `@prisma/dev`, an in-browser Postgres, TypeScript, `effect`, even
  `react-dom` — in a backend image, none of it reachable from `dist/index.js`. Hand-pruning
  reaches 464 MB but removes a package the generated client loads at startup, and an image
  that will not boot is worth nothing. The CI gate sits at 800 MB where it can catch a
  regression — a gate pinned at an aspiration is one people switch off.
  (Quote image sizes carefully: the same build measures 499 MB unpacked on the amd64 CI
  runner and 720 MB locally on arm64, and `docker image inspect` reports compressed size
  under the containerd store and unpacked size under the classic one. An earlier 751 MB
  figure recorded here was a local arm64 measurement that overstated the deployed artifact.)
- One OAuth test is flaky and is marked as such with a self-diagnosing assertion.
- Deferred with reasons in the tracker: HIBP breach-corpus password checks, `citext` for
  case-insensitive email, a BRIN index on `AuditLog.createdAt`.

## License

MIT — see [LICENSE](LICENSE).
