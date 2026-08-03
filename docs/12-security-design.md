# Security Design — Career Copilot

**Last updated:** 2026-08-03

---

## 1. Threat model

We hold career histories, contact details, and job-search activity. That is data people
actively hide from their current employer. Assets, ranked by what a breach would cost the user:

| Asset                                                     | Sensitivity | Primary threat                                         |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------ |
| Resume content (employment history, contact details)      | High        | Unauthorised read, public exposure via a share link    |
| Credentials and session tokens                            | Critical    | Credential stuffing, XSS token theft, session fixation |
| Job-search activity (which companies, which applications) | High        | Inference about intent to leave a current job          |
| MFA secrets and recovery codes                            | Critical    | Account takeover                                       |
| AI provider keys, database credentials                    | Critical    | Full system compromise                                 |
| Audit logs                                                | Medium      | Tampering to hide an intrusion                         |

Adversaries we design against: opportunistic credential stuffers, an attacker with a stolen
session token, a malicious user probing for IDOR against other users' resumes, an attacker
injecting instructions through an uploaded resume, and an insider with database access.

Explicitly out of scope: a nation-state adversary, physical access to managed infrastructure,
and supply-chain compromise of the managed database provider.

---

## 2. Authentication

### 2.1 Password storage

**argon2id**, memory 19 MiB, iterations 2, parallelism 1 (the OWASP minimum configuration),
with a per-password random salt. Not bcrypt — argon2id is memory-hard, which is the property
that actually degrades GPU cracking. The spec named bcrypt; this is a deliberate upgrade, and
bcrypt would still be acceptable at cost factor ≥ 12 if a platform constraint forced it.

Password policy: minimum 12 characters, checked against a common-password deny list and a
breach corpus. **No composition rules.** Requiring a symbol and a digit reliably produces
`Password1!` — length and denylisting are the controls with evidence behind them.

### 2.2 Token architecture

| Token         | Form                                                                   | TTL                    | Storage                                               |
| ------------- | ---------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------- |
| Access        | JWT, HS256, minimal claims (`sub`, `role`, `sid`, `exp`, `iat`, `jti`) | 15 min                 | `HttpOnly` cookie                                     |
| Refresh       | 32 bytes of CSPRNG entropy, opaque                                     | 7 d / 30 d remember-me | `HttpOnly` cookie, **SHA-256 hashed in the database** |
| CSRF          | Random, readable by JS by design                                       | Session                | Non-`HttpOnly` cookie                                 |
| MFA challenge | Short-lived signed token                                               | 5 min                  | Response body, not a cookie                           |

The raw refresh token is never stored. A database dump yields hashes, not usable sessions.

**Rotation with reuse detection.** Every refresh issues a new pair and marks the presented
token `ROTATED`. Presenting an already-rotated token means two parties hold tokens descended
from one login — so the entire `familyId` is revoked, every session for that user ends, an
audit entry is written, and a security email is sent. This converts a stolen refresh token
from indefinite access into a detectable, self-limiting event.

### 2.3 Cookies

```
Set-Cookie: cc_at=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=900
Set-Cookie: cc_rt=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth; Max-Age=604800
Set-Cookie: cc_csrf=<token>; Secure; SameSite=Lax; Path=/
```

The refresh cookie is path-scoped to `/api/v1/auth` so it is not transmitted on ordinary API
calls — narrowing exposure to exactly the endpoint that needs it. `SameSite=Lax` rather than
`Strict` because `Strict` breaks the OAuth return redirect; the CSRF token covers the gap.

### 2.4 MFA

TOTP per RFC 6238 (SHA-1, 6 digits, 30 s, ±1 window). Secrets encrypted at rest with
AES-256-GCM using a key from the environment — never plaintext, because a database read
would otherwise hand over the second factor along with the first. Ten single-use recovery
codes, argon2id-hashed, displayed exactly once. Disabling MFA requires the current password.

### 2.5 OAuth

Authorisation-code flow with PKCE. `state` is signed, single-use, 10-minute TTL, and bound to
the session — this is what prevents login CSRF. Redirect URIs are exact-match allowlisted.
Provider account linking keys on the provider's stable account ID, never the email, because
emails change and are not a durable identity.

### 2.6 Lockout

Per email+IP. Five failures in 15 minutes triggers exponential backoff: 1 → 2 → 4 → 8 → 16
minutes, capped at 30. Keyed on the pair rather than the account alone so an attacker cannot
lock a known victim out of their own account by failing logins from elsewhere.

---

## 3. Authorisation

Roles: `CANDIDATE`, `MENTOR`, `RECRUITER`, `ADMIN`.

**Resource ownership is checked in the service layer, on every access, against the acting
user.** Route-level role guards are a coarse first filter, never the authorisation decision —
a `CANDIDATE` guard on `/resumes/:id` says nothing about _whose_ resume it is. IDOR is the
single most likely real vulnerability in an application shaped like this one, so:

```ts
// Every repository read that returns user-owned data takes the actor.
async function getResume(id: string, actor: Actor): Promise<Resume> {
  const resume = await repo.findById(id);
  if (!resume || resume.deletedAt) throw new NotFoundError();
  if (resume.userId !== actor.id && !canAccessOthersResume(actor, resume)) {
    throw new NotFoundError(); // 404, not 403 — 403 confirms the resource exists
  }
  return resume;
}
```

Default deny. A new endpoint without an explicit authorisation check fails review.

---

## 4. Input handling

- **Zod validation at every boundary** — body, query, params, headers, environment, webhook
  payloads. Unvalidated input never reaches a service.
- **SQL injection**: Prisma parameterises everything. Raw SQL requires review and must use
  `$queryRaw` tagged templates, never string concatenation.
- **NoSQL/operator injection**: we use Postgres, but JSONB paths built from user input are
  validated against an allowlist of known resume paths — a JSON Pointer from a request is
  untrusted.
- **XSS**: React escapes by default. `dangerouslySetInnerHTML` is banned by lint rule. The
  one place rendered HTML is unavoidable (rich-text resume sections) passes through DOMPurify
  with a strict allowlist. A CSP without `unsafe-inline` is the backstop.
- **File upload**: MIME sniffed from magic bytes, not the declared `Content-Type`; extension
  allowlist; 10 MB cap; virus scan; stored with a generated key, never the user's filename;
  served only through signed URLs from a domain that cannot execute scripts.
- **SSRF**: no endpoint fetches a user-supplied URL in v1. When JD-import-by-URL ships, it
  needs an allowlist, DNS-rebinding protection, and a block on private IP ranges.
- **Prompt injection**: uploaded resumes and pasted JDs are untrusted text. They are
  delimited, the system prompt declares content inside the delimiters to be data rather than
  instructions, and — the actual defence — all AI output is schema-constrained, so a
  successful injection still cannot produce something the caller will act on.

---

## 5. Transport and headers

TLS 1.2+ only. HSTS with `includeSubDomains; preload` in production.

```ts
helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"], // no unsafe-inline in production
      styleSrc: ["'self'", "'unsafe-inline'"], // required by Tailwind's runtime styles
      imgSrc: ["'self'", 'data:', 'https://storage.careercopilot.app'],
      connectSrc: ["'self'", 'https://api.careercopilot.app'],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' },
  noSniff: true,
});
```

`styleSrc` carrying `unsafe-inline` is a known, deliberate weakening — Tailwind emits inline
styles at runtime. It is the one exception, and it is documented rather than quietly present.

CORS: strict origin allowlist from configuration, `credentials: true`, no wildcard. A
wildcard origin with credentials is rejected by browsers anyway, which is worth knowing before
someone "fixes" a CORS error that way.

---

## 6. Rate limiting

Redis-backed fixed window, applied per IP for unauthenticated traffic and per user for
authenticated traffic. Limits are in [API Spec §1.6](./06-api-specification.md#16-rate-limits).
The counter increment and its TTL are set in a single Lua script — doing them as two round
trips lets a crash between them leave a key with no expiry, which silently becomes a permanent
ban for that client.

### Failure mode: per-class, not global

This section originally specified a blanket fail-closed. Implementing it exposed the cost: a
Redis blip would take the **entire** API down, including reads that carry no abuse risk at
all. That contradicts the 99.5% availability SLO and NFR-13's principle that the system
degrades in slices rather than all at once. The policy is now:

| Class                                | On Redis failure                                       | Why                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login, register, password reset, MFA | **Closed** (503)                                       | Exactly where an unlimited retry budget is worth something to an attacker. A brief outage on sign-in is a far smaller harm than an open door for credential stuffing. |
| Everything else                      | **Open**, with a warning log and a counter to alert on | Losing rate limiting on resume reads for the length of an outage is a bounded, acceptable risk. Losing the whole product is not.                                      |

The trade is explicit in both directions, which is the part that matters — the failure
behaviour of a limiter should never be an accident of how an error happens to propagate.
Covered by `apps/api/tests/rate-limit-failure.test.ts`, which mocks Redis into failure and
asserts both branches.

**The Redis offline queue stays enabled**, which is what makes the closed branch rare rather
than routine. With it disabled, every command issued before the socket is ready — at startup
and during any reconnect or failover — is rejected outright, so a one-second Redis failover
would return 503 from every sign-in. Buffering, bounded by a one-second `commandTimeout`,
makes short interruptions invisible while a genuinely dead Redis still fails fast.

---

## 7. Secrets

- Never in source control. `.env` is gitignored; `.env.example` carries names and dummy values only.
- Validated at boot by a Zod schema — a missing secret crashes the process immediately rather
  than surfacing as a confusing runtime failure later.
- Production secrets live in the platform's secret store, injected as environment variables.
- Rotation: JWT signing key and encryption keys quarterly, or immediately on suspected
  exposure. The JWT key supports overlapping validity so rotation does not log everyone out.
- Logging redaction is enforced at the Pino serialiser: `password`, `token`, `authorization`,
  `cookie`, `secret`, `apiKey`, `refreshToken`. Redaction at the call site is a rule people
  forget; redaction at the serialiser is a rule they cannot forget.

---

## 8. Data protection

| Data                  | At rest                        | In transit | Notes                                         |
| --------------------- | ------------------------------ | ---------- | --------------------------------------------- |
| Passwords             | argon2id hash                  | TLS        | Irreversible                                  |
| Refresh tokens        | SHA-256 hash                   | TLS        | Raw value never stored                        |
| MFA secrets           | AES-256-GCM                    | TLS        | Key from env                                  |
| Recovery codes        | argon2id hash                  | TLS        | Shown once                                    |
| OAuth provider tokens | AES-256-GCM                    | TLS        | Only stored if provider API access is needed  |
| Resume content        | Database encryption at rest    | TLS        | Owner-scoped access only                      |
| Uploaded files        | Bucket encryption              | TLS        | Private bucket, signed URLs, 30-day retention |
| IP addresses          | Truncated (/24 IPv4, /48 IPv6) | TLS        | Enough for security, less than full PII       |

Retention and deletion are specified in [Database Design §6](./05-database-design.md).
Account deletion purges PII within 30 days; audit rows keep a pseudonymous ID because a
security log that can be erased by the actor is not a security log.

---

## 9. Audit logging

Append-only, enforced in the database rather than by developer discipline.

The enforcement is a **`BEFORE UPDATE` / `BEFORE DELETE` trigger**, not a `REVOKE`. A grant-
based approach does not bind the table owner, and in development the application role _is_
the owner — so the guarantee would hold everywhere except the environment where it is easiest
to violate. The trigger raises `insufficient_privilege` for every role, superusers included.
Retention pruning is the single sanctioned exception, setting `cc.audit_log_allow_prune` for
the life of its transaction.

`AuditLog.userId` intentionally has **no foreign key**. A `SetNull` cascade issues an `UPDATE`
that the trigger refuses, which would make account deletion impossible and break NFR-51's
30-day purge; a `Cascade` would erase the very trail the deletion should leave behind. The
column is a pseudonymous UUID that outlives the `User` row — retaining it after a PII purge
is the documented behaviour, not an oversight. See
[Database Design §3.1](./05-database-design.md).

Both properties are covered by `apps/api/tests/audit-log.append-only.test.ts`, so a future
migration that drops the trigger or reintroduces the foreign key fails CI rather than quietly
removing a security property nobody re-checks.

Logged: login success/failure, logout, registration, email verification, password
change/reset, MFA enrol/disable/use, OAuth link/unlink, session revoke, refresh-token reuse,
role change, share-link creation/access, data export, account deletion, and every admin action.

Each entry: actor, event, truncated IP, user agent, resource type and ID, outcome, timestamp,
and a metadata blob. Users can read their own security events; admins can read all.

---

## 10. Dependency and pipeline security

- `pnpm audit` on every CI run; the build fails on high or critical.
- Trivy scans the built container image; build fails on high or critical in OS packages.
- CodeQL static analysis on a schedule and on pull requests.
- Dependabot for dependency and GitHub Actions updates.
- Actions pinned to a commit SHA, not a floating tag — a moved tag is a supply-chain injection.
- Lockfile committed; CI installs with `--frozen-lockfile`.
- Least-privilege `GITHUB_TOKEN` permissions per job.
- No secrets exposed to workflows triggered by `pull_request` from a fork.

---

## 11. Security checklist for every PR

- [ ] New endpoints validate input with Zod and check resource ownership in the service layer
- [ ] No secret, token, or password can reach a log
- [ ] No new `dangerouslySetInnerHTML`, `eval`, or dynamic `Function`
- [ ] Database access is parameterised
- [ ] Errors return safe messages; internals go to logs with a correlation ID
- [ ] New third-party dependencies reviewed for maintenance status and transitive weight
- [ ] Authentication or authorisation changes have explicit tests, including the denial paths
- [ ] Rate limits considered for any new expensive or enumerable endpoint

---

## 12. Incident response

1. **Detect** — alert from Sentry, uptime probe, audit-log anomaly, or report.
2. **Contain** — revoke affected sessions, rotate the implicated secret, disable the feature
   flag or endpoint.
3. **Assess** — determine scope from audit logs and request IDs; identify affected users.
4. **Notify** — affected users within 72 hours, with what happened, what data was involved,
   and what to do.
5. **Remediate** — fix, add a regression test, deploy.
6. **Review** — blameless post-mortem within a week; the action items become tickets.

A security contact is published at `/.well-known/security.txt`. Reports get an
acknowledgement within 48 hours.
