# Software Requirements Specification — Career Copilot

**Version:** 0.1 · **Standard:** loosely follows IEEE 830 · **Last updated:** 2026-08-03

---

## 1. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements for Career Copilot.
It is the reference used to decide whether a build is correct and complete. The [PRD](./01-PRD.md)
says what we are building and why; this document says exactly how it must behave.

### 1.2 Scope

A web application, its HTTP API, an asynchronous job worker, a PostgreSQL database, a Redis
cache/queue, object storage for generated files, and an AI service layer. Delivered as
Docker images through a GitHub Actions pipeline to staging and production environments.

### 1.3 Definitions

| Term           | Meaning                                                              |
| -------------- | -------------------------------------------------------------------- |
| ATS            | Applicant Tracking System — software that parses and filters resumes |
| JD             | Job description                                                      |
| Resume version | An immutable snapshot of resume content at a point in time           |
| AI action      | One billable LLM invocation on behalf of a user                      |
| Token family   | A chain of refresh tokens descended from one login                   |
| Match score    | Similarity between a resume and a JD, 0–100                          |
| ATS score      | Rule-based resume quality score, 0–100, independent of any JD        |

### 1.4 Actors

`Guest`, `Candidate`, `Mentor`, `Recruiter`, `Admin`, `System` (scheduler/worker).

---

## 2. Overall description

### 2.1 Product perspective

A new, self-contained system. External dependencies: an LLM provider, an email provider,
OAuth identity providers (Google, GitHub), and object storage. Every external dependency
sits behind an internal interface so it can be swapped or stubbed in tests.

### 2.2 Operating environment

- **Client:** evergreen Chrome, Firefox, Safari, Edge. Viewports 360 px → 2560 px.
- **Server:** Node.js 22 LTS on Linux x86-64, containerised.
- **Data:** PostgreSQL 16, Redis 7.

### 2.3 Design and implementation constraints

- **C1** — TypeScript in `strict` mode across every package. No `any` in committed code
  except where a third-party type forces it, and then with a justifying comment.
- **C2** — All I/O boundaries validated with Zod. Nothing untrusted reaches business logic unparsed.
- **C3** — Database access exclusively through Prisma. No raw SQL except for measured
  performance work, and then parameterised.
- **C4** — Stateless API processes. All session and cache state in Redis or Postgres so the
  API scales horizontally.
- **C5** — No secret in source control. Configuration by environment variable, validated at boot.
- **C6** — Every LLM call goes through the AI service layer. No provider SDK imported directly
  by a route handler.

### 2.4 Assumptions and dependencies

- Users supply their own truthful career data.
- The LLM provider maintains ~99.5% availability; degraded AI must not break core CRUD.
- Email delivery is asynchronous and may take up to 60 seconds.

---

## 3. Functional requirements

Each requirement maps to a PRD feature ID. Format: trigger → behaviour → outcome.

### 3.1 Authentication (FR-01 … FR-12)

**FR-01 Registration**

- Accepts email and password. Email normalised to lowercase and trimmed.
- Password minimum 12 characters, checked against a common-password deny list. Composition
  rules (symbols, mixed case) are **not** enforced — length and denylisting are the
  evidence-backed controls; arbitrary composition rules push users toward `Password1!`.
- Password hashed with argon2id (memory 19 MiB, iterations 2, parallelism 1 minimum).
- Creates an unverified user, enqueues a verification email, returns 201 with no session.
- Registering an existing email returns the **same** 201 response and sends a "someone tried
  to register with your address" email. The API must not disclose account existence.

**FR-02 Login**

- Requires a verified account, unless `ALLOW_UNVERIFIED_LOGIN` is enabled in development.
- On success issues an access token (JWT, 15 min) and a refresh token (opaque, 7 days, or
  30 days with remember-me), both as `HttpOnly; Secure; SameSite=Lax` cookies.
- Creates a `DeviceSession` recording user agent, IP, and issue time.
- If MFA is enrolled, returns 200 with `{ mfaRequired: true, mfaToken }` and issues no
  session cookies until the TOTP step completes.
- Failed login increments the attempt counter and writes an audit entry.

**FR-03 Refresh rotation**

- Presenting a valid refresh token issues a new access/refresh pair and marks the presented
  token `rotated`.
- Presenting an already-rotated token is treated as theft: the entire token family is
  revoked, all sessions for that user are ended, an audit entry of type
  `REFRESH_REUSE_DETECTED` is written, and a security email is sent.
- Refresh requires a valid CSRF token; it is a state-changing request.

**FR-04/05 OAuth**

- Google and GitHub via authorisation-code flow with PKCE and a signed `state` parameter
  (10-minute TTL, single use).
- If the verified provider email matches an existing account, the provider is linked to it;
  otherwise a new verified account is created.
- A user must retain at least one usable login method; unlinking the last one is rejected.

**FR-06 Magic link** — single-use token, 10-minute TTL, hashed at rest, invalidated on use.

**FR-07 Password reset** — single-use token, 30-minute TTL. On success: password updated,
**every** refresh token and device session revoked, confirmation email sent. Response is
identical whether or not the address exists.

**FR-08 Device sessions** — list active sessions with device, approximate location, last-seen,
and a current-session marker; revoke one or all others.

**FR-09 MFA (TOTP)** — RFC 6238, SHA-1, 6 digits, 30-second period, ±1 window drift.
Enrolment requires a verified code before activation. Ten single-use recovery codes are
issued at enrolment, stored hashed, shown exactly once. Disabling MFA requires the current password.

**FR-10 Lockout** — per email+IP. After 5 failures within 15 minutes, exponential backoff:
1, 2, 4, 8, 16 minutes, capped at 30. Counter clears on success. A successful password reset
also clears it.

**FR-11 Audit log** — append-only. Records actor, event type, IP, user agent, resource, and
outcome for: login success/failure, logout, registration, password change/reset, MFA
enrol/disable, OAuth link/unlink, session revoke, refresh reuse, role change, admin actions,
and data export/deletion. Users see their own security events; admins see all.

### 3.2 Resume management (FR-20 … FR-28)

**FR-20/22 Structure** — a resume is a JSON document conforming to the versioned Resume
schema: contact, summary, experience[], education[], projects[], skills[], certifications[],
achievements[], custom sections[]. Every array item carries a stable UUID so diffs and
comments survive reordering.

**FR-21 Import** — accepts PDF and DOCX up to 10 MB. Pipeline: MIME sniffing → virus scan →
text extraction → AI structuring → user confirmation screen. Extraction confidence is
reported per field; anything below threshold is flagged for review rather than silently
accepted. Import never overwrites an existing resume without confirmation.

**FR-23 Live editor** — preview updates within 100 ms of a keystroke (debounced render,
not a network round trip). Autosave every 2 seconds of idle, or immediately on blur.
Offline edits queue and reconcile on reconnect.

**FR-26 Export** — PDF rendered server-side for pixel fidelity and to keep templates out of
the client bundle. DOCX, JSON, Markdown, and LaTeX generated from the same data model.
Exports are generated by the worker; large exports return a job ID and notify on completion.

**FR-27 Versioning** — an immutable snapshot is written on every save that changes content
hash, at most one per 60 seconds (coalesced). Retention: last 50 versions per resume for
free tier, unlimited for Pro. Restore creates a new version rather than deleting history.

**FR-28 Comparison** — structural diff at field level plus metric comparison (ATS,
word count, readability, keyword overlap against a chosen JD).

### 3.3 JD analysis and matching (FR-30 … FR-36)

**FR-31/32 Extraction** — from raw JD text, produce: role title, seniority, required skills
with weights, preferred skills, minimum years, education requirement, responsibilities,
and company signals. Output must validate against the JD schema; a failed validation
triggers one repair attempt, then a typed error.

**FR-33 Match score** — weighted composite:

```
match = 0.45·skills + 0.25·experience + 0.20·projects + 0.10·education
```

`skills` uses semantic similarity (cosine over embeddings) with an exact-match bonus, so
"Express.js" credits a "Node.js" requirement but not fully. Each component is returned with
its own score and the evidence that produced it. Scores are integers 0–100.

**FR-34 Missing skills** — required JD skills with resume evidence below 0.55 similarity,
ranked by JD weight, each with a suggested way to acquire or evidence it.

**FR-35 Recommendations** — ranked, each with `{ type, severity, message, targetPath, action }`
where `action` is executable by the client (e.g. "add skill", "rewrite bullet").

**FR-36 Embeddings** — computed once per resume version and per JD, cached by content hash.
Re-analysis of unchanged content must not re-embed.

### 3.4 ATS engine (FR-40 … FR-43)

**FR-40** — Deterministic. Same input always yields the same score. Implemented as pure
functions with no I/O and no LLM call, so it is unit-testable and free.

**FR-41** — Composite of five sub-scores:

| Component        | Weight | Examples of rules                                                                                        |
| ---------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| Parseability     | 30%    | no tables/columns/text-in-images, standard section headings, machine-readable dates, single-column order |
| Keyword coverage | 25%    | JD keyword presence and placement (requires a JD; otherwise role-generic keyword bank)                   |
| Formatting       | 20%    | consistent tense, standard fonts, no headers/footers holding critical data, bullet length 12–30 words    |
| Readability      | 15%    | action-verb openers, no first-person pronouns, no clichés, sentence complexity                           |
| Completeness     | 10%    | contact block, ≥1 experience or ≥2 projects, education, ≥6 skills, quantified metric in ≥40% of bullets  |

**FR-42** — Every rule returns `{ id, label, status, weight, earned, explanation, fix? }`.
The UI must be able to show why any point was lost.

### 3.5 AI features (FR-50 … FR-57)

- Every AI endpoint returns a structured, schema-validated object — never free prose to be
  regex-parsed by the client.
- Every write-capable AI feature returns a _proposal_: `{ before, after, rationale, confidence }`.
  Applying it is a separate, explicit user action.
- All AI calls are quota-checked before dispatch and metered after completion.
- Failures degrade gracefully: the feature reports unavailability; nothing else breaks.

### 3.6 Interview prep, tracking, sharing, platform

Specified at the same level of detail when their slices are scheduled. See
[Feature Roadmap](./17-feature-roadmap.md). Requirements FR-60 … FR-93 are `PLANNED`.

---

## 4. Non-functional requirements

### 4.1 Performance

| ID     | Requirement                                                                 |
| ------ | --------------------------------------------------------------------------- |
| NFR-01 | API p95 < 200 ms, p99 < 500 ms for non-AI endpoints, measured at the app    |
| NFR-02 | Editor preview repaint < 100 ms after keystroke                             |
| NFR-03 | ATS scoring < 50 ms (pure computation, no network)                          |
| NFR-04 | AI endpoints stream first token < 2 s; complete < 15 s                      |
| NFR-05 | PDF export < 5 s p95                                                        |
| NFR-06 | Frontend: LCP < 2.5 s, CLS < 0.1, TBT < 200 ms on a mid-tier mobile over 4G |
| NFR-07 | Initial JS bundle < 250 KB gzipped; templates and editor code split         |

### 4.2 Scalability

| ID     | Requirement                                                                           |
| ------ | ------------------------------------------------------------------------------------- |
| NFR-08 | 10,000 registered users, 1,000 DAU, 100 concurrent editors on the v1 topology         |
| NFR-09 | API horizontally scalable — no in-process session or cache state                      |
| NFR-10 | Background work (email, PDF, embeddings, imports) runs in a queue, never in a request |
| NFR-11 | Every list endpoint is paginated; no unbounded result sets                            |

### 4.3 Availability and resilience

| ID     | Requirement                                                                          |
| ------ | ------------------------------------------------------------------------------------ |
| NFR-12 | 99.5% monthly uptime for core CRUD                                                   |
| NFR-13 | AI provider outage degrades only AI features; auth, editing, and export keep working |
| NFR-14 | Quotas enforced server-side, atomically, before dispatch — never client-side only    |
| NFR-15 | Outbound calls: timeout, bounded retry with jittered backoff, circuit breaker        |
| NFR-16 | `/health` (liveness) and `/health/ready` (dependency checks) on every service        |
| NFR-17 | Graceful shutdown: stop accepting, drain in-flight, close pools, exit within 30 s    |

### 4.4 Security

Detailed in [Security Design](./12-security-design.md). Headline requirements:

| ID     | Requirement                                                                             |
| ------ | --------------------------------------------------------------------------------------- |
| NFR-20 | Passwords argon2id; tokens hashed at rest; nothing security-relevant stored reversibly  |
| NFR-21 | TLS 1.2+ everywhere; HSTS with preload in production                                    |
| NFR-22 | Helmet baseline plus a CSP with no `unsafe-inline` in production                        |
| NFR-23 | CSRF double-submit on every cookie-authenticated state change                           |
| NFR-24 | Rate limits: global, per-IP, per-user, per-endpoint-class, backed by Redis              |
| NFR-25 | Zod validation on every request body, query, and param                                  |
| NFR-26 | Authorisation checked per resource, in the service layer, never inferred from the route |
| NFR-27 | Dependency and container scanning on every pipeline run; build fails on high/critical   |
| NFR-28 | PII encrypted at rest at the storage layer; secrets never logged                        |

### 4.5 Usability and accessibility

| ID     | Requirement                                                                              |
| ------ | ---------------------------------------------------------------------------------------- |
| NFR-30 | WCAG 2.1 AA: contrast ≥ 4.5:1, full keyboard operation, visible focus, labelled controls |
| NFR-31 | Respect `prefers-reduced-motion` — all non-essential animation disabled                  |
| NFR-32 | Every destructive action confirmable and, where feasible, undoable                       |
| NFR-33 | Errors are actionable: what failed, why, what to do — never a raw stack or code          |
| NFR-34 | Responsive 360 px → 2560 px; editor collapses to tabbed form/preview under 1024 px       |

### 4.6 Maintainability

| ID     | Requirement                                                                      |
| ------ | -------------------------------------------------------------------------------- |
| NFR-40 | Line coverage ≥ 80% overall; ≥ 95% on auth, ATS scoring, and quota logic         |
| NFR-41 | No cyclic dependencies between packages; enforced by lint                        |
| NFR-42 | Every public function in `packages/*` documented with TSDoc                      |
| NFR-43 | Migrations forward-only and reversible-by-compensation; never edited after merge |
| NFR-44 | Conventional Commits; PRs squash-merged with a clean subject                     |

### 4.7 Compliance and privacy

| ID     | Requirement                                                                             |
| ------ | --------------------------------------------------------------------------------------- |
| NFR-50 | Full data export in machine-readable form, on request, within the app                   |
| NFR-51 | Account deletion purges PII within 30 days; audit records retain a pseudonymous ID only |
| NFR-52 | Explicit consent before any resume content is sent to a third-party AI provider         |
| NFR-53 | Uploaded source files deleted 30 days after successful extraction                       |
| NFR-54 | Cookie usage disclosed; no third-party analytics cookies without consent                |

---

## 5. External interface requirements

- **API** — REST over HTTPS, JSON, versioned at `/api/v1`. Full contract in [API Specification](./06-api-specification.md).
- **AI provider** — behind `AiProvider` interface: `complete()`, `completeStructured()`, `embed()`, `stream()`.
- **Email** — behind `Mailer` interface, queued, with templated HTML and plaintext alternates.
- **Storage** — behind `ObjectStore` interface: `put()`, `get()`, `delete()`, `signedUrl()`.
- **OAuth** — standard authorisation-code + PKCE against Google and GitHub.

---

## 6. Acceptance criteria for the MVP

The MVP is done when all of the following hold:

1. A new user can register, verify email, enable MFA, log in, and see their sessions.
2. A user can upload a PDF resume and receive correctly structured, editable data.
3. A user can edit that resume in the split editor and see the preview track their typing.
4. A user can paste a JD and receive a match score with per-component breakdown, missing
   skills, and ranked recommendations.
5. A user can see an ATS score where every lost point is traceable to a named rule.
6. A user can accept an AI bullet rewrite and see the score change.
7. A user can export a PDF that opens correctly and parses cleanly in a text extractor.
8. Every version of the resume is restorable and comparable.
9. The full pipeline — lint, typecheck, test ≥80%, build, scan, image push, deploy, health
   check — runs green on a push to `main`.
10. `/health/ready` reports database, Redis, and AI provider status, and metrics are scraped.
