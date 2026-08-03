# Product Requirements Document — Career Copilot

**Status:** Living document · **Owner:** Neeraj Negi · **Last updated:** 2026-08-03

---

## 1. Problem statement

Job seekers, especially early-career engineers, apply to dozens of roles with a single
generic resume. They do not know:

1. Whether an applicant tracking system will parse their resume at all.
2. Which of the job's required skills their resume fails to evidence.
3. How to phrase what they did so it reads as impact rather than activity.
4. What to build or learn next to become competitive for the role they want.

Existing tools solve step zero — formatting — and stop. The feedback loop that actually
determines whether someone gets an interview is left to guesswork.

## 2. Product vision

> A career copilot that reads the job you want, reads the resume you have, and closes the
> gap between them — then keeps working after you hit apply.

Career Copilot is not a document editor with AI bolted on. The resume is a **structured
data model**; the document is one rendering of it. Because the data is structured, the
system can score it, diff it, version it, match it against a job description, generate a
cover letter from it, build a portfolio site from it, and quiz you on it.

## 3. Target users

### Persona A — "Final-year Aditi" (primary)

Final-year CS student, 4 projects, no internship. Applying to 60+ companies through
campus portals and LinkedIn. Cannot tell why she is being rejected pre-interview.
**Needs:** ATS validation, keyword gap analysis, better bullet phrasing, project ideas
that fill a visible gap.
**Success looks like:** her resume scores above 85 for a target JD, and she gets shortlisted.

### Persona B — "Switching Rohan" (primary)

2 years in service-based IT, wants a product company backend role. Has real experience but
describes it in ticket language.
**Needs:** experience rewriting with quantified impact, role-targeted resume variants,
skill roadmap, interview prep on the gap between what he does and what the JD asks.

### Persona C — "Recruiter Priya" (secondary, v2)

Screens candidates and receives shared resume links.
**Needs:** clean read-only view, bookmarking, side-by-side comparison, comments.

### Persona D — "Mentor Sameer" (secondary, v2)

Senior engineer reviewing a junior's resume.
**Needs:** comment and suggest-edit access without an account sprawl.

## 4. Goals and non-goals

### Goals

- **G1** — Give every user a defensible, explainable ATS score, not a black-box number.
- **G2** — Turn a job description into a concrete, ranked action list.
- **G3** — Make resume iteration safe: every change versioned, comparable, restorable.
- **G4** — Extend past the resume into interview readiness and application tracking.
- **G5** — Operate as a real production system: authenticated, monitored, continuously deployed.

### Non-goals (explicitly out of scope)

- **NG1** — We are not a job board. We do not host or scrape listings.
- **NG2** — We do not auto-apply to jobs on the user's behalf. Auto-application is against
  most job platforms' terms of service, produces low-quality mass applications, and
  exposes users to account bans. The product optimises quality per application, not volume.
- **NG3** — We do not fabricate experience. The AI rewrites and reframes what the user
  actually did; it never invents employers, dates, or metrics. See [AI Prompt Design](./11-ai-prompt-design.md) §5.
- **NG4** — No native mobile apps in v1. Responsive web only.

## 5. Feature set

Features carry a requirement ID used throughout the docs and an MVP/v1/v2 tier.

### 5.1 Identity and account (MVP)

| ID    | Feature                                         | Notes                                      |
| ----- | ----------------------------------------------- | ------------------------------------------ |
| FR-01 | Email + password registration with verification | argon2id hashing                           |
| FR-02 | Login with session issuance                     | access + refresh token pair                |
| FR-03 | Refresh token rotation with reuse detection     | family revocation on replay                |
| FR-04 | Google OAuth                                    |                                            |
| FR-05 | GitHub OAuth                                    | doubles as project import source in v2     |
| FR-06 | Magic-link login                                | single-use, 10-minute TTL                  |
| FR-07 | Forgot / reset password                         | single-use token, invalidates all sessions |
| FR-08 | Device session list and remote revoke           | UA + IP + last-seen                        |
| FR-09 | TOTP multi-factor auth with recovery codes      |                                            |
| FR-10 | Login attempt lockout                           | progressive backoff                        |
| FR-11 | Audit log of security-relevant events           | user-visible subset                        |
| FR-12 | Remember-me                                     | extends refresh TTL only                   |

### 5.2 Resume core (MVP)

| ID    | Feature                                      | Notes                                                                 |
| ----- | -------------------------------------------- | --------------------------------------------------------------------- |
| FR-20 | Create resume from scratch                   | structured sections                                                   |
| FR-21 | Import existing resume (PDF/DOCX)            | text extraction → AI structuring                                      |
| FR-22 | Structured extraction into editable entities | skills, experience, projects, education, certifications, achievements |
| FR-23 | Split-screen live editor                     | form left, rendered preview right, keystroke-level sync               |
| FR-24 | Section reorder, show/hide, drag-and-drop    |                                                                       |
| FR-25 | Template selection                           | 20+ across Minimal / FAANG / Startup / Creative / Dark                |
| FR-26 | Export PDF, DOCX, JSON, Markdown, LaTeX      | server-rendered PDF for fidelity                                      |
| FR-27 | Resume version history                       | immutable snapshots, restore, diff                                    |
| FR-28 | Resume A/B comparison                        | ATS, length, readability, keyword overlap                             |

### 5.3 Job description intelligence (MVP)

| ID    | Feature                                | Notes                                                     |
| ----- | -------------------------------------- | --------------------------------------------------------- |
| FR-30 | Paste/import a job description         | stored per user                                           |
| FR-31 | Requirement extraction                 | hard skills, soft skills, years, education, nice-to-haves |
| FR-32 | Keyword extraction with weighting      | required vs preferred                                     |
| FR-33 | Resume ↔ JD match score with breakdown | skills / experience / projects / education                |
| FR-34 | Missing-skill report                   | ranked by JD weight                                       |
| FR-35 | Ranked improvement recommendations     | each maps to a one-click action                           |
| FR-36 | Semantic matching via embeddings       | catches "Node" ≈ "Express" ≈ "backend JS"                 |

### 5.4 ATS engine (MVP)

| ID    | Feature                                                                   | Notes                                          |
| ----- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| FR-40 | Deterministic ATS score, 0–100                                            | **rule-based, not LLM** — must be reproducible |
| FR-41 | Sub-scores: parseability, keywords, formatting, readability, completeness |                                                |
| FR-42 | Per-rule pass/fail with explanation and fix                               |                                                |
| FR-43 | Score history over time                                                   | charted                                        |

### 5.5 AI writing assistance (MVP → v1)

| ID    | Feature                                                          | Tier |
| ----- | ---------------------------------------------------------------- | ---- |
| FR-50 | Bullet generator: raw input → quantified achievement bullet      | MVP  |
| FR-51 | Bullet optimiser: before/after with accept/reject per suggestion | MVP  |
| FR-52 | Full resume generation for a target role/level                   | v1   |
| FR-53 | Skill suggestions derived from JD                                | MVP  |
| FR-54 | Project suggestions with tech stack and repo structure           | v1   |
| FR-55 | Cover letter generation, company-specific                        | v1   |
| FR-56 | LinkedIn optimiser: headline, about, experience, skills          | v1   |
| FR-57 | Portfolio site generation (React + Tailwind, deployable)         | v2   |

### 5.6 Interview preparation (v1)

| ID    | Feature                                                                   |
| ----- | ------------------------------------------------------------------------- |
| FR-60 | JD-derived question bank: technical, behavioural, HR, system design       |
| FR-61 | Mock interview via chat                                                   |
| FR-62 | Mock interview via voice                                                  |
| FR-63 | Scored feedback: communication, confidence, technical accuracy, structure |
| FR-64 | DSA question recommendations mapped to JD topics                          |

### 5.7 Application tracking and analytics (v1)

| ID    | Feature                                                                    |
| ----- | -------------------------------------------------------------------------- |
| FR-70 | Kanban tracker: Applied → OA → Interview → HR → Offer / Rejected           |
| FR-71 | Link each application to the resume version actually sent                  |
| FR-72 | Analytics: applications over time, score trend, response rate, offer ratio |
| FR-73 | Reminders: follow-up, interview, stale application                         |
| FR-74 | Career roadmap: target role → skills, projects, courses, timeline          |
| FR-75 | Smart login suggestions ("3 saved JDs want Docker; your resume has none")  |

### 5.8 Sharing and collaboration (v2)

| ID    | Feature                                                    |
| ----- | ---------------------------------------------------------- |
| FR-80 | Public share link with slug, optional password, expiry, QR |
| FR-81 | View analytics on shared links                             |
| FR-82 | Mentor invite: comment and suggest edits                   |
| FR-83 | Real-time collaborative editing                            |
| FR-84 | Recruiter view: bookmark, comment, download, compare       |

### 5.9 Platform (v1 → v2)

| ID    | Feature                                                |
| ----- | ------------------------------------------------------ |
| FR-90 | Role-based access: Candidate, Mentor, Recruiter, Admin |
| FR-91 | Admin dashboard: users, templates, reports, analytics  |
| FR-92 | Notifications: in-app, email, push                     |
| FR-93 | Subscription tiers and quota enforcement               |

## 6. Monetisation

| Tier       | Price     | Limits                                                                                               |
| ---------- | --------- | ---------------------------------------------------------------------------------------------------- |
| Free       | ₹0        | 2 resumes, 10 AI actions/month, 5 templates, basic ATS                                               |
| Pro        | ₹399/mo   | Unlimited resumes, 500 AI actions/month, all templates, full ATS, mock interviews, portfolio builder |
| Teams (v2) | ₹2,999/mo | Mentor seats, cohort analytics — for placement cells and bootcamps                                   |

AI actions are metered because they carry real marginal cost. Quota enforcement is a
first-class backend concern, not a UI toggle. See [SRS](./02-SRS.md) NFR-14.

## 7. Success metrics

| Metric                         | Definition                            | Target (6 months post-launch) |
| ------------------------------ | ------------------------------------- | ----------------------------- |
| Activation                     | % of signups reaching a scored resume | ≥ 60%                         |
| Core value delivered           | % of users who run ≥1 JD analysis     | ≥ 45%                         |
| Score improvement              | Median ATS delta, first → best resume | ≥ +18 points                  |
| Retention (W4)                 | Users active in week 4                | ≥ 25%                         |
| Interview rate (self-reported) | Applications → interviews             | ≥ 15%                         |
| Free → Pro conversion          |                                       | ≥ 4%                          |
| AI cost per active user        | Token spend ÷ MAU                     | ≤ ₹35/month                   |

## 8. Key product decisions and their rationale

**D1 — The ATS score is rule-based, not AI-generated.**
A score that changes when you re-run it with the same input is not a score, it is a mood.
Deterministic rules are auditable, explainable, free to compute, and testable in CI. The
LLM explains and improves; it does not grade.

**D2 — The resume is data, not a document.**
Everything downstream — scoring, diffing, exports, portfolio generation, cover letters —
depends on structure. Storing formatted text would forfeit all of it.

**D3 — AI suggestions are always proposals, never silent edits.**
Every AI change surfaces as before/after with explicit accept or reject. Users are
accountable for their resume's accuracy in an interview; the tool must never put words in
their mouth without consent.

**D4 — Ship vertical slices, not horizontal layers.**
Each milestone is usable end to end. A half-finished feature that works beats four
features stubbed at the API layer.

**D5 — No auto-apply.** See NG2.

## 9. Risks

| Risk                                          | Impact                                                  | Mitigation                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| AI hallucinates experience the user never had | Severe — candidate fails interview, product loses trust | Grounding constraints in system prompts; suggestions require explicit accept; never invent employers/dates/metrics |
| LLM API cost scales past revenue              | High                                                    | Per-tier quotas, response caching keyed on content hash, small models for classification, embeddings computed once |
| ATS scoring is a guess dressed as precision   | Medium — credibility                                    | Publish the rubric; every point is traceable to a named rule the user can read                                     |
| PDF parsing fails on unusual layouts          | Medium                                                  | Multi-parser fallback chain; manual correction UI; never block the user on extraction                              |
| Scope collapse under feature count            | High                                                    | Roadmap tiers are enforced; a feature is not started until its slice is next                                       |
| Third-party OAuth or email provider outage    | Medium                                                  | Password login always available; email queued with retry                                                           |

## 10. Open questions

- Voice mock interviews: browser Web Speech API (free, inconsistent) vs a hosted STT/TTS
  provider (accurate, metered)? Decide before FR-62.
- Do we store raw uploaded resume files after extraction, or discard them? Leaning discard
  after 30 days for privacy and storage cost.
- Recruiter role: full marketplace or invite-only link recipients? v2 discovery needed.
