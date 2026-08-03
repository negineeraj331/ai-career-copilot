# System Architecture — Career Copilot

**Last updated:** 2026-08-03

---

## 1. Architectural style

A **modular monolith** for the API, with work that must not block a request pushed into a
**queue-backed worker**. The frontend is a separate static SPA.

This is deliberate. Microservices for a product at this stage would buy distributed tracing
problems, network partitions, and deployment coordination in exchange for scaling we do not
need. Instead the API is internally partitioned into modules with explicit boundaries — a
module may only be reached through its service interface, never by another module's
repository. When a module genuinely needs independent scaling, that boundary is where it
gets extracted, and the extraction is mechanical.

The AI service layer, PDF rendering, and the queue worker are already separate processes,
because those are the parts with genuinely different resource profiles.

---

## 2. High-level topology

```
                         ┌──────────────┐
                         │  Cloudflare  │  DNS, TLS, WAF, CDN, DDoS
                         └──────┬───────┘
                                │
                       ┌────────┴────────┐
                       │  Nginx / Ingress │  routing, gzip, rate limit, security headers
                       └────┬────────┬────┘
                            │        │
            /  (static)     │        │   /api/*
                ┌───────────┘        └───────────┐
                ▼                                ▼
   ┌────────────────────────┐        ┌───────────────────────────┐
   │  Web (React SPA)       │        │  API (Express, N replicas)│
   │  Vite build, on CDN    │        │  stateless                │
   └────────────────────────┘        └────────┬──────────────────┘
                                              │
        ┌──────────────┬────────────────┬─────┴───────┬──────────────────┐
        ▼              ▼                ▼             ▼                  ▼
  ┌───────────┐  ┌──────────┐   ┌──────────────┐ ┌──────────┐   ┌────────────────┐
  │PostgreSQL │  │  Redis   │   │ Object Store │ │ AI Layer │   │ BullMQ Queue   │
  │ + pgvector│  │cache/rate│   │  S3 / R2     │ │ Anthropic│   │ (on Redis)     │
  │           │  │ /sessions│   │ PDFs, uploads│ │ / OpenAI │   │                │
  └───────────┘  └──────────┘   └──────────────┘ └──────────┘   └───────┬────────┘
                                                                        │
                                                                        ▼
                                                             ┌────────────────────┐
                                                             │  Worker process    │
                                                             │  email, PDF/DOCX,  │
                                                             │  import, embeddings│
                                                             │  reminders         │
                                                             └────────────────────┘

  Observability spans everything:
  Sentry (errors) · Prometheus + Grafana (metrics) · Pino → log aggregator · uptime probes
```

---

## 3. Components

### 3.1 Web (`apps/web`)

React 19 SPA built by Vite, served as static assets from a CDN. Talks only to the API over
`/api/v1`, always with credentials, never holding a token in JavaScript-readable storage.
Route-level code splitting keeps the initial bundle inside the 250 KB budget; the editor,
template renderers, and charting libraries all load on demand.

### 3.2 API (`apps/api`)

Stateless Express 5 process. Any replica can serve any request because all session state
lives in Redis and Postgres. Request lifecycle:

```
request
  → request-id + logger binding
  → helmet (security headers)
  → cors (strict allowlist)
  → body parse with size limit
  → cookie parse
  → rate limit (Redis token bucket)
  → CSRF verification (state-changing methods)
  → route match
  → Zod validation (body / query / params)
  → authenticate (access token → actor)
  → authorise (role + resource ownership, in the service)
  → controller  → service  → repository → Prisma
  → response envelope
  → terminal error handler
```

Internal module map:

```
auth/        registration, login, tokens, MFA, OAuth, sessions, audit
users/       profile, preferences, roles, quota
resumes/     CRUD, versions, diffs, sections, sharing
jobs/        job descriptions, parsing, storage
analysis/    matching, gap analysis, recommendations  (depends on ats + ai)
ats/         thin HTTP wrapper over packages/ats
ai/          AI-backed endpoints                      (depends on packages/ai)
exports/     export requests, job dispatch, download URLs
applications/ application tracker                     (v1)
interviews/  question banks, mock sessions            (v1)
admin/       administration                           (v1)
```

Dependency rule: modules depend downward on shared packages, never sideways on each other's
internals. Cross-module work goes through the other module's exported service.

### 3.3 Worker (`apps/api`, worker entrypoint)

Same image, different command. Consumes BullMQ queues:

| Queue        | Work                                        | Retries        | Notes                                    |
| ------------ | ------------------------------------------- | -------------- | ---------------------------------------- |
| `email`      | Transactional email                         | 5, exponential | Verification, reset, security alerts     |
| `export`     | PDF/DOCX/LaTeX rendering                    | 3              | Headless Chromium; the memory-hungry one |
| `import`     | Resume parse + AI structuring               | 3              | Can take 10–30 s                         |
| `embeddings` | Vector computation                          | 3              | Batched, content-hash cached             |
| `analysis`   | Long JD analysis                            | 3              | Streams progress over SSE                |
| `reminders`  | Scheduled notifications                     | 3              | Repeatable cron jobs                     |
| `cleanup`    | Expired tokens, old uploads, stale sessions | 1              | Nightly                                  |

Workers scale independently — export is CPU and memory bound, email is I/O bound.

### 3.4 Data layer

**PostgreSQL 16** — the system of record. Relational tables for identity, ownership,
versions, applications, and audit. `JSONB` for resume content and AI analysis payloads.
`pgvector` for embeddings, so semantic search is a SQL query rather than a second datastore.

**Redis 7** — five distinct concerns, namespaced by key prefix:

| Prefix      | Use                                           | TTL        |
| ----------- | --------------------------------------------- | ---------- |
| `cc:sess:`  | Device session lookup                         | 30 d       |
| `cc:rl:`    | Rate-limit counters                           | window     |
| `cc:cache:` | Response and AI-result cache                  | 5 m – 24 h |
| `cc:lock:`  | Distributed locks (version coalescing, quota) | 30 s       |
| `bull:`     | Job queues                                    | managed    |

**Object storage** — uploaded source resumes (30-day retention), generated exports, template
assets, portfolio bundles. Access exclusively via short-lived signed URLs; buckets are private.

### 3.5 AI service layer (`packages/ai`)

The only code in the system that imports a model vendor's SDK. Chat completion and
embeddings are separate interfaces with independently selected adapters — the default chat
provider exposes no embeddings endpoint, so semantic matching would break if the two were
collapsed into one. See [AI Prompt Design §2](./11-ai-prompt-design.md).

```
caller → AiService
           ├─ quota check (atomic, Redis)
           ├─ cache lookup (hash of template version + input + model)
           ├─ prompt assembly from a versioned template
           ├─ provider adapter  ──► Anthropic | OpenAI | Mock
           ├─ Zod validation of the structured output
           │     └─ one repair round-trip on failure, then typed error
           ├─ usage metering (tokens, cost, latency)
           └─ cache write
```

Every stage is observable: a Prometheus counter per template, a histogram for latency, and a
cost gauge per user tier. `MockAiProvider` returns deterministic fixtures, which is what CI
and offline development use.

---

## 4. Key data flows

### 4.1 Login with MFA

```
Browser              API                      Postgres / Redis
   │  POST /auth/login  │
   ├───────────────────►│ rate-limit check ──────────────► Redis
   │                    │ lockout check ─────────────────► Redis
   │                    │ fetch user ────────────────────► Postgres
   │                    │ argon2.verify(password)
   │                    │ MFA enrolled? ── yes
   │◄───────────────────┤ 200 { mfaRequired, mfaToken }
   │  POST /auth/mfa    │
   ├───────────────────►│ verify TOTP (±1 window)
   │                    │ create DeviceSession ──────────► Postgres
   │                    │ issue access JWT + refresh token
   │                    │ write audit entry ─────────────► Postgres
   │◄───────────────────┤ 200 + Set-Cookie ×3 (access, refresh, csrf)
```

### 4.2 Resume ↔ JD analysis

```
POST /analysis  { resumeId, jobId }
  │
  ├─ authorise: caller owns both resources
  ├─ quota: consume 1 AI action (atomic; rejects at limit)
  ├─ cache: hash(resumeVersionId + jobId + rubricVersion) → hit? return
  │
  ├─ ATS score        → packages/ats     (pure, ~10 ms, no I/O)
  ├─ JD requirements  → packages/ai      (structured extraction, cached per JD)
  ├─ embeddings       → pgvector         (computed once per version, reused)
  ├─ similarity       → cosine per requirement against resume evidence
  ├─ composite match  → 0.45·skills + 0.25·exp + 0.20·projects + 0.10·edu
  ├─ recommendations  → packages/ai      (grounded in the computed gaps only)
  │
  ├─ persist Analysis row
  └─ 200 { atsScore, matchScore, breakdown, missingSkills, recommendations }
```

Note the ordering: everything deterministic runs first and cheaply. The LLM is called only
to explain gaps that have already been computed — it is never asked to produce a number.

### 4.3 Resume import

```
POST /resumes/import (multipart)
  → MIME sniff (magic bytes, not the declared type)
  → size and page limits
  → virus scan
  → store original in object storage (30-day TTL)
  → enqueue `import` job → 202 { jobId }
                                │
  worker: extract text (pdf-parse → fallback OCR)
        → AI structuring into the Resume schema
        → Zod validation, per-field confidence
        → draft resume row, status = AWAITING_CONFIRMATION
        → notify client over SSE
  → user reviews flagged fields → confirms → resume becomes active
```

The user always confirms before an import becomes their resume. Extraction is probabilistic;
silently trusting it would corrupt their data.

---

## 5. Scaling path

| Bottleneck appears               | Response                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------- |
| API CPU                          | Add replicas — the process is stateless by design                                 |
| Database reads                   | Read replica for analytics and admin queries                                      |
| Export latency                   | Scale the export worker independently; it is already its own queue                |
| AI cost                          | Widen the cache, batch embeddings, route simple classification to a cheaper model |
| Redis memory                     | Separate instances for queue and cache                                            |
| Single-region latency            | CDN already fronts static assets; add a regional API deployment                   |
| A module needs its own lifecycle | Extract it at its existing service boundary                                       |

---

## 6. Failure behaviour

| Failure             | Blast radius                 | Behaviour                                                                                                           |
| ------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| AI provider down    | AI features only             | Typed `AI_UNAVAILABLE`; editing, scoring, export, auth all keep working                                             |
| Redis down          | Sessions, rate limits, queue | Rate limiter fails **closed** (protect the system); cache misses fall through to Postgres; queue pauses and retries |
| Postgres down       | Everything                   | Health check fails, replica removed from the load balancer, alert pages                                             |
| Object storage down | Uploads and exports          | Queued and retried; user sees "export pending" rather than an error                                                 |
| Email provider down | Verification and alerts      | Queued with backoff; user is told delivery may be delayed                                                           |
| A worker crashes    | Its queue                    | BullMQ redelivers after visibility timeout; jobs are idempotent                                                     |

Every outbound call carries a timeout, bounded jittered retry, and a circuit breaker. The
system is expected to degrade in slices, never all at once.

---

## 7. Deployment topology

| Concern  | Local               | Staging               | Production                          |
| -------- | ------------------- | --------------------- | ----------------------------------- |
| Web      | Vite dev server     | Vercel preview        | Vercel / CDN                        |
| API      | Compose container   | 1 replica             | ≥ 2 replicas behind a load balancer |
| Worker   | Compose container   | 1                     | ≥ 1, scaled per queue depth         |
| Postgres | Compose             | Managed (Neon)        | Managed, PITR, daily backup         |
| Redis    | Compose             | Managed (Upstash)     | Managed, persistence on             |
| Storage  | MinIO               | R2 bucket             | R2 bucket                           |
| Secrets  | `.env` (gitignored) | Platform secret store | Platform secret store               |

Deploys are image-based: one image, promoted from staging to production. Rollback is
redeploying the previous tag, which is why images are tagged by commit SHA rather than
`latest`. See [DevOps](./14-devops-cicd.md).
