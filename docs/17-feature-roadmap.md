# Feature Roadmap — Career Copilot

**Last updated:** 2026-08-03 · Live status lives in [tracker.md](./tracker.md)

---

## How this roadmap works

Work ships in **vertical slices**. Every slice goes database → API → UI → tests → CI and is
genuinely usable when it lands. No slice is "the backend for X" with the UI to follow later —
that pattern produces a repository full of code that has never actually run end to end.

Slices are ordered by dependency first, then by how much each one proves. A feature is not
started until its slice is next; that rule is the only thing standing between this document
and a repo with forty half-features.

Estimates assume solo part-time work (~15 h/week). They are planning aids, not commitments.

---

## Phase 0 — Foundation `IN PROGRESS`

**Goal:** a real production skeleton. Nothing user-visible beyond auth, but everything after
this depends on it being right.

| Slice         | Contents                                                                                                                                    | Est.   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 0.1 Tooling   | pnpm monorepo, TS config, ESLint/Prettier, Docker Compose (Postgres + Redis + MinIO + MailHog), env validation                              | 1 wk   |
| 0.2 Contracts | `@cc/shared` — Zod schemas and inferred types for auth, resume, JD, analysis                                                                | 3 d    |
| 0.3 Data      | Prisma schema for identity + audit, first migration, seed script                                                                            | 4 d    |
| 0.4 API core  | Logging with request IDs, error hierarchy, Helmet, CORS, CSRF, Redis rate limiting, health endpoints                                        | 1 wk   |
| 0.5 Auth      | Register, verify, login, refresh rotation with reuse detection, logout, reset, magic link, sessions, TOTP, lockout, audit log               | 2 wk   |
| 0.6 OAuth     | Google and GitHub with PKCE, account linking                                                                                                | 4 d    |
| 0.7 Web shell | Vite + React + Tailwind + Framer Motion, design tokens, auth store, protected routes, login/register/verify/reset screens                   | 1.5 wk |
| 0.8 Pipeline  | GitHub Actions: lint, typecheck, test with service containers, coverage gate, build, audit, Trivy, image push, deploy, health check, notify | 1 wk   |

**Done when:** a user can register, verify, enable MFA, log in, see their device sessions, and
revoke one — and a push to `main` runs the full pipeline green and deploys.

---

## Phase 1 — The core loop `NEXT`

**Goal:** the thing the product is actually for. After this phase, Career Copilot is useful
even with nothing else built.

| Slice            | Contents                                                                                                                            | Est.   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.1 Resume model | Versioned resume schema, CRUD, immutable snapshots with content-hash coalescing, optimistic concurrency                             | 1.5 wk |
| 1.2 ATS engine   | `@cc/ats` — five rule families, weighted rubric, per-rule explanations, 95% test coverage                                           | 1.5 wk |
| 1.3 Editor       | Split-screen form + live preview, section reorder with a keyboard path, autosave, offline queue                                     | 2.5 wk |
| 1.4 Templates    | Renderer architecture, 6 launch templates, ATS-safety flags                                                                         | 1 wk   |
| 1.5 Export       | Server-side PDF via headless Chromium in the worker, plus DOCX/JSON/Markdown                                                        | 1 wk   |
| 1.6 AI layer     | `@cc/ai` — provider interface, Anthropic adapter, mock adapter, structured outputs, quota, caching, usage metering                  | 1.5 wk |
| 1.7 JD analysis  | JD storage and parsing, requirement extraction, embeddings + pgvector, weighted match score, missing skills, ranked recommendations | 2 wk   |
| 1.8 AI writing   | Bullet generation and optimisation, placeholder-confirmation flow, accept/reject, skill suggestions                                 | 1.5 wk |
| 1.9 Versions     | History timeline, field-level diff viewer, restore, resume comparison                                                               | 1 wk   |

**Done when:** upload a resume → get a scored, editable document → paste a JD → see a
breakdown and ranked gaps → accept an AI rewrite → watch the score move → export a PDF that
parses cleanly.

This is the milestone worth demoing. Everything before it is plumbing; everything after is
expansion.

---

## Phase 2 — Retention

**Goal:** reasons to come back after the resume is written.

| Slice                   | Contents                                                                                                       | Est.   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| 2.1 Resume import       | PDF/DOCX upload, extraction pipeline with fallbacks, AI structuring, confidence flags, confirmation screen     | 1.5 wk |
| 2.2 Application tracker | Kanban board, status transitions as events, resume-version pinning, reminders                                  | 1.5 wk |
| 2.3 Analytics           | Dashboard, score trend, application funnel, skill-gap chart, keyword cloud — all against the validated palette | 1.5 wk |
| 2.4 Notifications       | In-app centre, transactional email, reminder scheduling                                                        | 1 wk   |
| 2.5 Cover letters       | Company-specific generation grounded in resume + JD                                                            | 4 d    |
| 2.6 Smart suggestions   | Login-time surfacing: "3 saved jobs want Docker; your resume doesn't mention it"                               | 4 d    |
| 2.7 More templates      | To 20+ across all categories                                                                                   | 1 wk   |

---

## Phase 3 — Differentiation

**Goal:** the features that make this a career platform rather than a resume tool.

| Slice                     | Contents                                                                   | Est.   |
| ------------------------- | -------------------------------------------------------------------------- | ------ |
| 3.1 Interview prep        | JD-derived question banks across technical/behavioural/HR/system design    | 1 wk   |
| 3.2 Mock interview (chat) | Session model, adaptive follow-ups, scored feedback across four dimensions | 2 wk   |
| 3.3 Career roadmap        | Target role → skill gaps → projects, courses, timeline                     | 1.5 wk |
| 3.4 Project suggestions   | Gap-filling project ideas with stack and repo structure                    | 4 d    |
| 3.5 LinkedIn optimiser    | Headline, about, experience, skills                                        | 4 d    |
| 3.6 Sharing               | Slugs, password gate, expiry, QR, view analytics                           | 1 wk   |
| 3.7 Subscriptions         | Payment integration, tier enforcement, billing portal                      | 1.5 wk |

---

## Phase 4 — Scale and collaboration

| Slice                       | Contents                                              | Est.   |
| --------------------------- | ----------------------------------------------------- | ------ |
| 4.1 Roles                   | Mentor and recruiter roles, invitation flows          | 1 wk   |
| 4.2 Comments                | Anchored comments, suggested edits, resolution        | 1.5 wk |
| 4.3 Real-time collaboration | WebSocket presence, CRDT or OT for concurrent editing | 3 wk   |
| 4.4 Recruiter view          | Bookmarking, comparison, bulk download                | 1.5 wk |
| 4.5 Admin dashboard         | Users, templates, moderation, platform analytics      | 1.5 wk |
| 4.6 Voice mock interview    | STT/TTS, latency tuning, chat fallback                | 2 wk   |
| 4.7 Portfolio generator     | React + Tailwind site generation and deployment       | 2.5 wk |
| 4.8 Coding practice         | DSA question recommendations mapped to JD topics      | 1.5 wk |

---

## Deferred, with reasons

Being explicit about what we are _not_ building is as useful as the plan itself.

| Feature                   | Why it waits                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native mobile apps        | Responsive web covers the use case. A resume is edited on a laptop.                                                                                          |
| Auto-apply to jobs        | Violates most job platforms' terms, produces low-quality mass applications, and risks getting users' accounts banned. This is a permanent no, not a "later". |
| Job board / scraping      | Legally fraught and a different product. We analyse the JD you bring us.                                                                                     |
| Multi-language resumes    | Real demand exists, but the ATS rubric and prompt set would need rebuilding per language. Needs its own project.                                             |
| Chrome extension          | Genuinely useful for capturing JDs, but only once the core loop has users.                                                                                   |
| Team / bootcamp tier      | Requires the mentor role and cohort analytics from Phase 4 first.                                                                                            |
| Distributed tracing       | Request IDs in structured logs answer the same questions at monolith scale. Revisit at the first service extraction.                                         |
| Visual regression testing | High maintenance and high noise across 20+ user-selectable templates.                                                                                        |

---

## Milestones

| Milestone                | Includes | Target   |
| ------------------------ | -------- | -------- |
| **M0 — Skeleton**        | Phase 0  | Sep 2026 |
| **M1 — Core loop (MVP)** | Phase 1  | Dec 2026 |
| **M2 — Public beta**     | Phase 2  | Mar 2027 |
| **M3 — v1.0**            | Phase 3  | Jul 2027 |
| **M4 — Platform**        | Phase 4  | Dec 2027 |

If the schedule slips, phases slip whole. The alternative — starting Phase 2 with Phase 1
half-finished — is how a project ends up with forty features and nothing that works.

---

## What "impressive" actually means here

The spec listed forty features. Recruiters and interviewers do not count features; they probe
depth. A candidate who can explain refresh-token rotation with reuse detection, why the ATS
score is deterministic, and what happens when the AI provider goes down is in a completely
different conversation from one who lists forty bullet points.

So the ranking of what to build first is:

1. **M1 alone is a strong portfolio project.** A working, tested, deployed, monitored core
   loop beats a broad but shallow feature list.
2. **The production engineering is the differentiator** — CI/CD with real quality gates,
   observability, security depth. That is what separates this from the hundred other resume
   builders on GitHub.
3. **Depth in one AI feature** beats shallow versions of eight. The grounding contract and the
   placeholder-confirmation flow are more interesting to talk about than another endpoint.

Build M1 properly before touching Phase 2.
