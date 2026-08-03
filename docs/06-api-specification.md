# API Specification — Career Copilot

**Base URL:** `https://api.careercopilot.app/api/v1` · **Format:** JSON · **Last updated:** 2026-08-03

---

## 1. Conventions

### 1.1 Versioning

The version is in the path (`/api/v1`). A breaking change means a new version; the previous
version stays available for at least 90 days. Additive changes — new optional fields, new
endpoints — do not bump the version, so clients must ignore unknown response fields.

### 1.2 Response envelope

Success:

```json
{
  "success": true,
  "data": {},
  "meta": { "requestId": "01J...", "timestamp": "2026-08-03T10:15:00Z" }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields need attention.",
    "details": [{ "field": "email", "message": "Enter a valid email address." }]
  },
  "meta": { "requestId": "01J...", "timestamp": "2026-08-03T10:15:00Z" }
}
```

`message` is always safe to show a user. Internal detail — stack traces, driver errors, SQL —
never crosses the boundary; it goes to the logs against the same `requestId`.

### 1.3 Error codes

| Code                  | HTTP | Meaning                                                                                                                                                           |
| --------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`    | 400  | Request failed schema validation                                                                                                                                  |
| `UNAUTHENTICATED`     | 401  | Missing, invalid, or expired access token                                                                                                                         |
| `MFA_REQUIRED`        | 401  | Password accepted; TOTP step outstanding                                                                                                                          |
| `FORBIDDEN`           | 403  | Authenticated but not permitted                                                                                                                                   |
| `CSRF_INVALID`        | 403  | CSRF token missing or mismatched                                                                                                                                  |
| `NOT_FOUND`           | 404  | Resource absent, or not visible to this actor                                                                                                                     |
| `CONFLICT`            | 409  | State conflict (e.g. version already exists)                                                                                                                      |
| `PAYLOAD_TOO_LARGE`   | 413  | Upload exceeds limit                                                                                                                                              |
| `UNPROCESSABLE`       | 422  | Well-formed but semantically invalid                                                                                                                              |
| `RATE_LIMITED`        | 429  | Rate limit exceeded; see `Retry-After`                                                                                                                            |
| `QUOTA_EXCEEDED`      | 429  | Plan quota exhausted; upgrade path in `details`                                                                                                                   |
| `ACCOUNT_LOCKED`      | 423  | Too many failed logins                                                                                                                                            |
| `AI_UNAVAILABLE`      | 503  | AI provider failing; other features unaffected                                                                                                                    |
| `SERVICE_UNAVAILABLE` | 503  | A dependency is down, not a bug in our code. Distinct from `INTERNAL_ERROR` so a client knows to back off and retry rather than report it. Carries `Retry-After`. |
| `INTERNAL_ERROR`      | 500  | Unexpected — correlate via `requestId`                                                                                                                            |

`NOT_FOUND` is deliberately returned instead of `FORBIDDEN` when an actor asks for a resource
they do not own. Distinguishing the two leaks existence.

### 1.4 Authentication

Three cookies:

| Cookie    | Contents             | TTL                    | Flags                                                 |
| --------- | -------------------- | ---------------------- | ----------------------------------------------------- |
| `cc_at`   | Access JWT           | 15 min                 | `HttpOnly; Secure; SameSite=Lax; Path=/`              |
| `cc_rt`   | Opaque refresh token | 7 d (30 d remember-me) | `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth`   |
| `cc_csrf` | CSRF token           | session                | `Secure; SameSite=Lax` — readable by JS **by design** |

The refresh cookie is scoped to the auth path so it is not transmitted on ordinary API calls,
limiting its exposure. `cc_csrf` is the only non-`HttpOnly` cookie because the double-submit
pattern requires the client to read and echo it in `X-CSRF-Token`.

Every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) requires `X-CSRF-Token`.

### 1.5 Pagination

Cursor-based: `?limit=20&cursor=<opaque>`. Offset pagination drifts when rows are inserted
mid-scroll, which is exactly what happens on a live dashboard.

```json
{ "items": [], "pageInfo": { "hasNextPage": true, "endCursor": "..." } }
```

`limit` defaults to 20 and is capped at 100.

### 1.6 Rate limits

| Class                  | Limit   | Window                        |
| ---------------------- | ------- | ----------------------------- |
| Unauthenticated        | 30 req  | 1 min / IP                    |
| Authenticated          | 300 req | 1 min / user                  |
| Login                  | 30 req  | 15 min / IP                   |
| Registration           | 3       | 1 h / IP                      |
| Password reset request | 3       | 1 h / email                   |
| AI endpoints           | 20      | 1 min / user, plus plan quota |
| Upload                 | 10      | 1 h / user                    |
| Export                 | 30      | 1 h / user                    |

Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and
`Retry-After` on 429.

**Rate limiting and account lockout are different controls and must not be confused.** The
login limiter is keyed on **IP** and catches credential stuffing — one source spraying a
password across many accounts. Account lockout (FR-10) is keyed on **email+IP** at 5 failures
and catches brute force against one account, returning `423 ACCOUNT_LOCKED` with a progressive
backoff. An earlier design keyed the limiter on email+IP at the same threshold as lockout,
which both duplicated it and never fired for the attack a limiter exists to stop; the limiter
budget now sits well above the lockout threshold so the account-level message is what a
legitimate user sees.

### 1.7 Idempotency

`POST` endpoints that may be retried (exports, AI generation, payments) accept an
`Idempotency-Key` header. A repeat with the same key returns the original response rather
than performing the work twice. Keys are retained 24 hours.

---

## 2. Authentication endpoints

| Method | Path                             | Auth           | Description                           |
| ------ | -------------------------------- | -------------- | ------------------------------------- |
| POST   | `/auth/register`                 | —              | Create account, send verification     |
| POST   | `/auth/login`                    | —              | Password login                        |
| POST   | `/auth/mfa/verify`               | mfaToken       | Complete login with TOTP              |
| POST   | `/auth/refresh`                  | refresh cookie | Rotate tokens                         |
| POST   | `/auth/logout`                   | ✓              | Revoke current session                |
| POST   | `/auth/logout-all`               | ✓              | Revoke every session                  |
| POST   | `/auth/verify-email`             | —              | Consume verification token            |
| POST   | `/auth/resend-verification`      | —              | Re-send verification                  |
| POST   | `/auth/forgot-password`          | —              | Request reset link                    |
| POST   | `/auth/reset-password`           | —              | Consume reset token                   |
| POST   | `/auth/magic-link`               | —              | Request magic link                    |
| POST   | `/auth/magic-link/verify`        | —              | Consume magic link                    |
| GET    | `/auth/oauth/:provider`          | —              | Begin OAuth (302)                     |
| GET    | `/auth/oauth/:provider/callback` | —              | OAuth callback (302)                  |
| DELETE | `/auth/oauth/:provider`          | ✓              | Unlink (refused if last login method) |
| GET    | `/auth/oauth`                    | ✓              | List linked providers                 |
| POST   | `/auth/oauth/:provider/link`     | ✓              | Link a provider to this account       |
| GET    | `/auth/me`                       | ✓              | Current actor                         |
| GET    | `/auth/sessions`                 | ✓              | List device sessions                  |
| DELETE | `/auth/sessions/:id`             | ✓              | Revoke one session                    |
| POST   | `/auth/mfa/setup`                | ✓              | Begin TOTP enrolment                  |
| POST   | `/auth/mfa/confirm`              | ✓              | Activate TOTP                         |
| DELETE | `/auth/mfa`                      | ✓ + password   | Disable TOTP                          |
| POST   | `/auth/mfa/recovery-codes`       | ✓ + password   | Regenerate recovery codes             |
| GET    | `/auth/audit-log`                | ✓              | Own security events                   |

### `POST /auth/register`

```json
{ "email": "aditi@example.com", "password": "correct horse battery staple", "name": "Aditi" }
```

`201`:

```json
{
  "success": true,
  "data": { "message": "Check your email to verify your account.", "email": "aditi@example.com" }
}
```

Returns the identical `201` when the email already exists. Enumeration protection is more
valuable than the small UX cost of an ambiguous message.

### `POST /auth/login`

```json
{ "email": "aditi@example.com", "password": "...", "rememberMe": true }
```

`200` (no MFA) — sets `cc_at`, `cc_rt`, `cc_csrf`:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "…",
      "email": "…",
      "name": "Aditi",
      "role": "CANDIDATE",
      "tier": "FREE",
      "mfaEnabled": false
    },
    "mfaRequired": false
  }
}
```

`200` (MFA enrolled) — **no session cookies issued**:

```json
{ "success": true, "data": { "mfaRequired": true, "mfaToken": "…", "expiresIn": 300 } }
```

Errors: `401 UNAUTHENTICATED` (wrong credentials **or** unknown email — identical response),
`423 ACCOUNT_LOCKED` with `retryAfter`, `403 FORBIDDEN` when email is unverified.

### `POST /auth/refresh`

No body; reads `cc_rt`. Rotates both tokens. If the presented token was already rotated, the
entire family is revoked, all sessions end, an audit entry is written, a security email is
sent, and the response is `401`.

### `GET /auth/sessions`

```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "…",
        "device": "Chrome on macOS",
        "ipPrefix": "103.21.244.x",
        "lastSeenAt": "2026-08-03T10:00:00Z",
        "current": true
      }
    ]
  }
}
```

---

## 3. Resume endpoints

| Method | Path                                       | Description                       |
| ------ | ------------------------------------------ | --------------------------------- |
| GET    | `/resumes`                                 | List (paginated)                  |
| POST   | `/resumes`                                 | Create                            |
| GET    | `/resumes/:id`                             | Fetch with current content        |
| PATCH  | `/resumes/:id`                             | Update content or metadata        |
| DELETE | `/resumes/:id`                             | Soft delete                       |
| POST   | `/resumes/:id/duplicate`                   | Copy                              |
| POST   | `/resumes/import`                          | Upload PDF/DOCX (multipart) → 202 |
| GET    | `/resumes/import/:jobId`                   | Import job status                 |
| POST   | `/resumes/import/:jobId/confirm`           | Accept extracted data             |
| GET    | `/resumes/:id/versions`                    | Version history                   |
| GET    | `/resumes/:id/versions/:versionId`         | One version                       |
| POST   | `/resumes/:id/versions/:versionId/restore` | Restore as a new version          |
| GET    | `/resumes/:id/diff`                        | `?from=&to=` structural diff      |
| POST   | `/resumes/compare`                         | Compare two resumes on metrics    |
| POST   | `/resumes/:id/export`                      | Request export → 202              |
| GET    | `/exports/:jobId`                          | Export status + signed URL        |
| POST   | `/resumes/:id/shares`                      | Create share link                 |
| GET    | `/resumes/:id/shares`                      | List share links                  |
| DELETE | `/shares/:shareId`                         | Revoke                            |
| GET    | `/public/resumes/:slug`                    | Public view (no auth)             |

### `PATCH /resumes/:id`

```json
{ "content": { "…": "…" }, "expectedVersion": 12 }
```

`expectedVersion` implements optimistic concurrency. A mismatch returns `409 CONFLICT` with
the server's current version, so two open tabs cannot silently overwrite each other.

### `POST /resumes/:id/export`

```json
{ "format": "PDF", "templateId": "minimal-ats" }
```

`202 { "jobId": "…", "statusUrl": "/api/v1/exports/…" }` — formats: `PDF`, `DOCX`, `JSON`,
`MARKDOWN`, `LATEX`.

---

## 4. Job description and analysis

| Method | Path            | Description                    |
| ------ | --------------- | ------------------------------ |
| GET    | `/jobs`         | List saved JDs                 |
| POST   | `/jobs`         | Save and parse a JD            |
| GET    | `/jobs/:id`     | Fetch with parsed requirements |
| DELETE | `/jobs/:id`     | Delete                         |
| POST   | `/analysis`     | Analyse resume against a JD    |
| GET    | `/analysis/:id` | Fetch analysis                 |
| GET    | `/analysis`     | History (paginated)            |
| POST   | `/ats/score`    | ATS score only, no JD required |

### `POST /analysis`

```json
{ "resumeId": "…", "jobDescriptionId": "…" }
```

`200`:

```json
{
  "success": true,
  "data": {
    "id": "…",
    "atsScore": 78,
    "matchScore": 87,
    "rubricVersion": 1,
    "breakdown": {
      "skills": {
        "score": 91,
        "weight": 0.45,
        "matched": ["React", "Node.js", "Docker"],
        "missing": ["Redis", "Terraform"]
      },
      "experience": { "score": 80, "weight": 0.25, "requiredYears": 2, "detectedYears": 1.5 },
      "projects": { "score": 85, "weight": 0.2, "relevant": ["E-commerce platform"] },
      "education": { "score": 100, "weight": 0.1 }
    },
    "missingSkills": [
      {
        "skill": "Redis",
        "importance": "REQUIRED",
        "weight": 0.8,
        "suggestion": "Add caching to an existing project and quantify the latency improvement."
      }
    ],
    "recommendations": [
      {
        "id": "rec_1",
        "type": "BULLET_REWRITE",
        "severity": "HIGH",
        "message": "Three bullets have no measurable outcome.",
        "targetPath": "/experience/0/bullets/1",
        "action": { "kind": "OPEN_OPTIMIZER", "payload": { "bulletId": "…" } }
      }
    ]
  }
}
```

`targetPath` is a JSON Pointer into the resume document, so the client can scroll to and
highlight the exact field a recommendation refers to.

### `POST /ats/score`

Runs the deterministic rule engine. No AI call, no quota consumed, no cost.

```json
{
  "success": true,
  "data": {
    "score": 78,
    "rubricVersion": 1,
    "components": {
      "parseability": { "score": 92, "weight": 0.3 },
      "keywords": { "score": 71, "weight": 0.25 },
      "formatting": { "score": 85, "weight": 0.2 },
      "readability": { "score": 64, "weight": 0.15 },
      "completeness": { "score": 80, "weight": 0.1 }
    },
    "rules": [
      {
        "id": "fmt.no_tables",
        "label": "No tables in layout",
        "status": "PASS",
        "weight": 5,
        "earned": 5,
        "explanation": "Tables often parse as a single unreadable block."
      },
      {
        "id": "read.quantified",
        "label": "Bullets contain metrics",
        "status": "PARTIAL",
        "weight": 8,
        "earned": 3,
        "explanation": "4 of 12 bullets include a number.",
        "fix": "Add scale or impact to at least 5 more bullets."
      }
    ]
  }
}
```

Every point lost is traceable to a named rule with a human explanation. That is the whole
credibility argument for the score.

---

## 5. AI endpoints

All consume quota, all return schema-validated structures, all support `Idempotency-Key`.
Streaming endpoints use Server-Sent Events.

| Method | Path                    | Cost | Description                         |
| ------ | ----------------------- | ---- | ----------------------------------- |
| POST   | `/ai/bullet/generate`   | 1    | Raw input → achievement bullet      |
| POST   | `/ai/bullet/optimize`   | 1    | Before/after rewrite proposals      |
| POST   | `/ai/resume/generate`   | 5    | Full resume for a target role       |
| POST   | `/ai/skills/suggest`    | 1    | Skills derived from a JD            |
| POST   | `/ai/projects/suggest`  | 2    | Project ideas filling detected gaps |
| POST   | `/ai/cover-letter`      | 3    | Company-specific letter             |
| POST   | `/ai/linkedin/optimize` | 2    | Headline, about, experience         |
| POST   | `/ai/summary`           | 1    | Professional summary                |
| GET    | `/ai/usage`             | 0    | Quota remaining this period         |

### `POST /ai/bullet/optimize`

```json
{
  "bullets": [{ "id": "b1", "text": "Worked on website." }],
  "context": { "role": "Frontend Engineer", "jobDescriptionId": "…" }
}
```

`200`:

```json
{
  "success": true,
  "data": {
    "proposals": [
      {
        "id": "b1",
        "before": "Worked on website.",
        "after": "Built a React e-commerce storefront serving 15,000 monthly users, cutting page load time 37% through code splitting and image optimisation.",
        "rationale": "Adds the technology, the scale, and a measured outcome.",
        "confidence": 0.86,
        "placeholders": ["15,000 monthly users", "37%"]
      }
    ],
    "quotaRemaining": 47
  }
}
```

`placeholders` is the honesty mechanism. The model does not know the real numbers, so any
figure it proposes is flagged and the UI requires the user to confirm or correct it before
the bullet can be accepted. See [AI Prompt Design](./11-ai-prompt-design.md) §5.

Errors: `429 QUOTA_EXCEEDED` with `{ used, limit, resetsAt, upgradeUrl }`;
`503 AI_UNAVAILABLE` when the provider is failing.

---

## 6. Applications, interviews, platform (v1)

| Method       | Path                              | Description                           |
| ------------ | --------------------------------- | ------------------------------------- |
| GET/POST     | `/applications`                   | List / create                         |
| PATCH/DELETE | `/applications/:id`               | Update / delete                       |
| POST         | `/applications/:id/status`        | Transition, recording an event        |
| GET          | `/analytics/overview`             | Dashboard metrics                     |
| GET          | `/analytics/score-history`        | ATS trend                             |
| GET          | `/analytics/funnel`               | Application funnel                    |
| POST         | `/interviews/questions`           | Generate a question bank from a JD    |
| POST         | `/interviews/sessions`            | Start a mock interview                |
| POST         | `/interviews/sessions/:id/answer` | Submit an answer, get feedback        |
| GET          | `/notifications`                  | List                                  |
| POST         | `/notifications/:id/read`         | Mark read                             |
| GET          | `/templates`                      | List templates                        |
| GET          | `/health`                         | Liveness                              |
| GET          | `/health/ready`                   | Readiness with dependency status      |
| GET          | `/metrics`                        | Prometheus exposition (internal only) |

### `GET /health/ready`

```json
{
  "status": "ok",
  "version": "1.4.2",
  "commit": "a1b2c3d",
  "uptime": 84213,
  "checks": {
    "database": { "status": "ok", "latencyMs": 3 },
    "redis": { "status": "ok", "latencyMs": 1 },
    "storage": { "status": "ok" },
    "ai": { "status": "degraded", "message": "Elevated latency" }
  }
}
```

Returns `503` if database or Redis is down. A degraded AI provider does **not** fail
readiness — the core product still works without it, and pulling healthy replicas out of the
load balancer over an AI outage would turn a partial degradation into an outage.

---

## 7. Webhooks (v2)

Outbound webhooks for subscription events, signed with HMAC-SHA256 in `X-CC-Signature`,
including a timestamp to prevent replay. Consumers must verify before trusting the payload.
