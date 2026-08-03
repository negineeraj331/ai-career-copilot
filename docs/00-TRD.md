# Technical Requirements Document — Career Copilot

**Version:** 0.1 · **Status:** Living · **Last updated:** 2026-08-03

The TRD is the engineering contract. The [PRD](./01-PRD.md) states what to build, the
[SRS](./02-SRS.md) states how it must behave; this document states what we build it _with_,
what we committed to, and why. When someone asks "why is it like this?", the answer is here.

---

## 1. Technology decisions

| Layer           | Choice                                         | Version | Why this and not the alternative                                                                                                                                                                       |
| --------------- | ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language        | TypeScript                                     | 5.7     | One language across client, server, and shared contracts. Types cross the network boundary as compile-time guarantees rather than hope.                                                                |
| Runtime         | Node.js                                        | 22 LTS  | Native fetch, stable test runner, LTS through 2027. Bun is faster but its ecosystem edge cases are not worth production risk here.                                                                     |
| Package manager | pnpm                                           | 11      | Content-addressed store, strict hoisting. Strictness is a feature: it catches phantom dependencies that npm silently permits.                                                                          |
| Monorepo        | pnpm workspaces                                | —       | Turborepo/Nx add caching we do not yet need. Add when build time justifies it, not before.                                                                                                             |
| Frontend        | React + Vite                                   | 19 / 6  | Vite's dev server is instant; React's ecosystem covers every UI need here.                                                                                                                             |
| Styling         | Tailwind CSS                                   | 3.4     | Design tokens in config, no CSS-in-JS runtime cost, purged output stays small.                                                                                                                         |
| Animation       | Framer Motion                                  | 11      | Declarative, interruptible, and honours `prefers-reduced-motion` with one setting.                                                                                                                     |
| Server state    | TanStack Query                                 | 5       | Caching, dedup, background refetch, and optimistic updates — the hard parts, solved.                                                                                                                   |
| Client state    | Zustand                                        | 5       | ~1 KB, no provider tree, no boilerplate. Redux Toolkit is overkill for the little global state we hold.                                                                                                |
| Forms           | React Hook Form + Zod                          | 7 / 4   | Uncontrolled inputs keep re-renders local; the _same_ Zod schema validates on client and server.                                                                                                       |
| Backend         | Express                                        | 5       | Deliberate choice over NestJS — see ADR-002.                                                                                                                                                           |
| ORM             | Prisma                                         | 7       | Type-safe queries generated from schema, first-class migrations, readable schema file. v7 moves the connection URL out of the schema into `prisma.config.ts` and requires a driver adapter at runtime. |
| Database        | PostgreSQL                                     | 16      | Relational integrity for users/versions/applications, JSONB for flexible resume content, `pgvector` for embeddings — one database instead of three.                                                    |
| Cache / queue   | Redis                                          | 7       | Sessions, rate-limit counters, response cache, and BullMQ job queue.                                                                                                                                   |
| Queue           | BullMQ                                         | 5       | Reliable retries, backoff, scheduling, dead-letter — on infrastructure we already run.                                                                                                                 |
| AI              | Provider-agnostic layer, Claude default        | —       | See ADR-004                                                                                                                                                                                            |
| Object storage  | S3-compatible (R2 / S3 / MinIO)                | —       | Same API in local, staging, and production.                                                                                                                                                            |
| Containers      | Docker + Compose                               | 29      | Identical images from laptop to production.                                                                                                                                                            |
| CI/CD           | GitHub Actions                                 | —       | Native to where the code lives; service containers make integration tests real.                                                                                                                        |
| Testing         | Vitest, Supertest, Playwright, Testing Library | —       | Vitest shares Vite's transform pipeline, so tests and app see identical code.                                                                                                                          |
| Errors          | Sentry                                         | —       | Source-mapped traces on both client and server.                                                                                                                                                        |
| Metrics         | Prometheus + Grafana                           | —       | `prom-client` exposition, portable across hosts.                                                                                                                                                       |
| Logs            | Pino → aggregator                              | 9       | Structured JSON, fast, with per-request correlation IDs.                                                                                                                                               |

---

## 2. Architecture Decision Records

### ADR-001 — Monorepo over polyrepo

**Status:** Accepted
**Context:** Frontend and backend share request/response shapes, validation rules, and the resume schema.
**Decision:** A single pnpm workspace with `apps/*` and `packages/*`.
**Consequences:** Contract changes are atomic — API and UI update in one commit, and CI type-checks both against the shared schema. Cost: CI must be path-filtered to avoid rebuilding everything on a README change.

### ADR-002 — Express over NestJS

**Status:** Accepted
**Context:** The spec named "Express.js or NestJS".
**Decision:** Express 5 with a hand-rolled layered structure (`routes → controllers → services → repositories`).
**Rationale:** NestJS brings DI, modules, decorators, and its own conventions. For a codebase this size that is ceremony we would spend time on instead of features, and it obscures what the framework is actually doing. Explicit layering gives the same separation of concerns while every mechanism stays legible. Express 5 also brings native async error propagation, removing the main historical reason to reach for Nest.
**Consequences:** We write our own wiring — error handling, validation middleware, module composition. We gain transparency; we lose framework-provided structure, so the folder conventions in [08](./08-folder-structure.md) must be enforced in review.

### ADR-003 — Deterministic ATS scoring, LLM-assisted explanation

**Status:** Accepted
**Context:** ATS score is the product's core credibility claim.
**Decision:** Scoring is a pure function library in `packages/ats` with zero I/O. The LLM never produces the number; it only explains and proposes fixes.
**Consequences:** Reproducible, free, sub-50 ms, fully unit-testable, and defensible when a user asks "why 78?". Cost: our rubric is our own approximation of real ATS behaviour, so it must be published, versioned, and honestly labelled as such.

### ADR-004 — Provider-agnostic AI layer with Claude as default

**Status:** Accepted
**Context:** Model quality, price, and availability all move quarterly. Binding business logic to one SDK is a liability.
**Decision:** `packages/ai` exposes an `AiProvider` interface (`complete`, `completeStructured`, `stream`) plus a separate `EmbeddingProvider`. Concrete adapters for Anthropic and OpenAI, selected by `AI_PROVIDER`; embeddings are selected independently by `EMBEDDING_PROVIDER`, because the default chat provider does not offer an embeddings endpoint. Route handlers never import a vendor SDK.
**Consequences:** Provider swap is a config change. Adapters normalise differing tool/JSON-mode semantics, which is real work but confined to one package. Enables a `MockAiProvider` so tests never hit a paid API.

### ADR-005 — Resume stored as validated JSONB, not normalised tables

**Status:** Accepted
**Context:** Resume content is deeply nested, reorderable, and its shape will evolve.
**Decision:** Content in a single JSONB column validated by a versioned Zod schema; relational columns for everything queried across resumes (owner, title, timestamps, current score).
**Consequences:** Schema evolution needs no migration for content shape — only a schema version bump plus an upgrade function. Cost: no referential integrity inside content, so validation at the boundary is mandatory, and cross-resume content queries need GIN indexes or extracted columns.

### ADR-006 — Opaque refresh tokens, JWT access tokens

**Status:** Accepted
**Decision:** Access tokens are short-lived JWTs verified without a database hit. Refresh tokens are opaque random strings, stored hashed, rotated on every use, grouped into families for reuse detection.
**Consequences:** Fast request-path auth, and true revocation at the refresh boundary. A revoked session survives at most 15 minutes on the access token — an accepted, documented trade-off.

### ADR-007 — Cookies, not `localStorage`, for tokens

**Status:** Accepted
**Decision:** `HttpOnly; Secure; SameSite=Lax` cookies, paired with double-submit CSRF tokens.
**Rationale:** Tokens in `localStorage` are readable by any successful XSS. `HttpOnly` cookies are not. The cost is CSRF exposure, which is a solved problem; XSS token theft is not.

### ADR-008 — Server-side PDF rendering

**Status:** Accepted
**Decision:** PDFs render in the worker via headless Chromium against the same React templates.
**Rationale:** Identical output for every user regardless of installed fonts or browser, template code stays out of the client bundle, and long renders do not block the request loop.

---

## 3. Environments

| Environment | Branch    | Data                                | AI provider                          | Purpose                   |
| ----------- | --------- | ----------------------------------- | ------------------------------------ | ------------------------- |
| Local       | any       | Docker Compose Postgres/Redis/MinIO | Mock by default, real with a key     | Development               |
| Test (CI)   | any PR    | Ephemeral service containers        | Always mock — deterministic and free | Automated verification    |
| Staging     | `develop` | Managed Postgres + Redis, seeded    | Real, low quota                      | Pre-production validation |
| Production  | `main`    | Managed, backed up, PITR            | Real, full quota                     | Live                      |

---

## 4. Technical budgets

Budgets are commitments, not aspirations. Breaching one is a bug with a ticket.

| Budget                   | Limit                               | Enforced by                          |
| ------------------------ | ----------------------------------- | ------------------------------------ |
| Initial JS bundle        | 250 KB gzip                         | CI size check on build output        |
| Lighthouse performance   | ≥ 90                                | CI Lighthouse job on preview deploy  |
| Lighthouse accessibility | ≥ 95                                | CI Lighthouse job                    |
| API p95 (non-AI)         | 200 ms                              | Prometheus histogram + alert         |
| ATS scoring              | 50 ms                               | Unit test with timing assertion      |
| Line coverage            | ≥ 80% overall, ≥ 95% auth/ATS/quota | Vitest thresholds; build fails below |
| Docker API image         | ≤ 300 MB                            | CI image-size check                  |
| Cold start               | ≤ 5 s to ready                      | Deployment health-check timeout      |
| AI cost per active user  | ≤ ₹35/month                         | Token metering dashboard             |

---

## 5. Cross-cutting technical requirements

**TR-01 Configuration** — every environment variable declared in one Zod schema, validated at
boot. Missing or malformed config crashes the process immediately with a readable message.
A service must never start half-configured.

**TR-02 Errors** — one `AppError` hierarchy carrying an HTTP status, a stable machine code,
a safe user message, and optional field-level details. One terminal error handler serialises
to the standard envelope. Unexpected errors log with full context and return a generic
message plus a correlation ID — internals never leak to a client.

**TR-03 Logging** — structured JSON via Pino. Every request gets an ID (honouring an inbound
`x-request-id`) propagated through logs, error reports, and downstream calls. A hard denylist
redacts passwords, tokens, cookies, and authorisation headers at the serialiser.

**TR-04 Validation** — Zod at every boundary: HTTP input, AI output, environment, and
webhook payloads. Parsing happens once, at the edge; internal code works with parsed types.

**TR-05 Authorisation** — enforced in the service layer against the resource owner, not
inferred from route shape. Every data-access function takes the acting user. The default is deny.

**TR-06 Idempotency** — mutating endpoints that may be retried (exports, payments, AI
generation) accept an `Idempotency-Key` and return the original result on replay.

**TR-07 Migrations** — Prisma Migrate, forward-only, reviewed as code. Destructive changes
land as expand → backfill → contract across separate deploys, never as one breaking migration.

**TR-08 Background work** — anything that can exceed 500 ms or call a third party runs in
BullMQ: email, PDF/DOCX export, resume import, embedding computation, scheduled reminders.
Jobs are idempotent, bounded-retry, and dead-lettered on final failure.

**TR-09 Caching** — Redis, with explicit key naming `cc:{domain}:{identifier}:{version}` and
a documented TTL per class. AI responses cache on a hash of (prompt template version + input
content + model), which makes repeated analysis of unchanged content free.

**TR-10 Graceful shutdown** — on `SIGTERM`: stop accepting connections, finish in-flight
requests, drain queue workers, close database and Redis pools, exit within 30 seconds.

---

## 6. Interfaces owned by this project

```ts
interface AiProvider {
  complete(req: CompletionRequest): Promise<CompletionResult>;
  completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  stream(req: CompletionRequest): AsyncIterable<StreamChunk>;
}

// Separate on purpose: the default chat provider (Anthropic) exposes no
// embeddings endpoint, so this is served by its own adapter selected via
// EMBEDDING_PROVIDER. See docs/11-ai-prompt-design.md §2.
interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

interface Mailer {
  send(msg: { to: string; template: TemplateId; data: Record<string, unknown> }): Promise<void>;
}

interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}

interface RateLimiter {
  consume(key: string, points: number): Promise<RateLimitVerdict>;
}
```

Every one of these has a real implementation and an in-memory test double. Tests use the
doubles; nothing in CI touches a paid or networked dependency.

---

## 7. Definition of done

A feature is done when all of these are true — not when the happy path renders.

- [ ] Behaviour matches its SRS requirement, including the error cases
- [ ] Input validated at the boundary; authorisation checked in the service layer
- [ ] Unit tests for logic, integration tests for the endpoint, including failure paths
- [ ] Coverage thresholds hold
- [ ] Loading, empty, error, and offline states implemented in the UI
- [ ] Keyboard operable, screen-reader labelled, contrast verified
- [ ] Structured logs at meaningful points; metrics for anything worth alerting on
- [ ] Affected documents updated in the same PR
- [ ] No new high or critical vulnerability from the dependency or image scan
- [ ] Feature works against the mock AI provider (so CI and offline development work)
