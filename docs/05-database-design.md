# Database Design — Career Copilot

**Engine:** PostgreSQL 16 with `pgvector` · **Access:** Prisma 7 · **Last updated:** 2026-08-03

---

## 1. Design principles

1. **Relational where it is relational.** Identity, ownership, versions, and applications
   have real referential integrity requirements. They get real foreign keys.
2. **JSONB where the shape evolves.** Resume content and AI analysis payloads change shape
   as the product changes. They live in validated `JSONB` — see [ADR-005](./00-TRD.md#adr-005).
3. **Anything queried across rows is a column.** If we filter, sort, or aggregate on it, it
   is promoted out of JSONB into an indexed column.
4. **UUIDv7 primary keys.** Non-enumerable in URLs, and time-ordered so index locality stays
   good — unlike UUIDv4, which fragments B-trees.
5. **Soft delete only where recovery matters.** `deletedAt` on resumes and users. Tokens and
   sessions are deleted outright; keeping dead credentials is a liability.
6. **Timestamps everywhere.** `createdAt` and `updatedAt` on every table, `timestamptz`, UTC.
7. **Every foreign key has an index.** Postgres does not create them automatically, and their
   absence turns cascading deletes into table scans.

---

## 2. Entity relationship overview

```
                            ┌─────────────┐
                            │    User     │
                            └──────┬──────┘
                                   │ 1
       ┌───────────┬───────────┬───┴────┬────────────┬───────────────┐
       │ *         │ *         │ *      │ *          │ *             │ *
┌──────┴─────┐ ┌───┴──────┐ ┌──┴─────┐ ┌┴─────────┐ ┌┴────────────┐ ┌┴──────────┐
│OAuthAccount│ │ Refresh  │ │Device  │ │Verificat.│ │MfaCredential│ │ AuditLog  │
│            │ │  Token   │ │Session │ │  Token   │ │             │ │           │
└────────────┘ └────┬─────┘ └───┬────┘ └──────────┘ └─────────────┘ └───────────┘
                    └───────────┘  session ↔ token family

┌─────────────┐ 1      * ┌───────────────┐
│    User     ├──────────┤    Resume     │
└──────┬──────┘          └───────┬───────┘
       │                    1    │    *
       │                  ┌──────┴────────┐
       │                  │ ResumeVersion │  immutable snapshots
       │                  └──────┬────────┘
       │                         │ *
       │                  ┌──────┴────────┐
       │                  │ ResumeShare   │
       │                  └───────────────┘
       │ *
┌──────┴──────────┐  *      1 ┌──────────┐
│ JobDescription  ├───────────┤ Analysis │────► ResumeVersion
└─────────────────┘           └──────────┘
       │ 1
       │ *
┌──────┴──────────┐        ┌──────────────┐
│  Application    ├───────►│ ResumeVersion│  (the version actually sent)
└──────┬──────────┘        └──────────────┘
       │ *
┌──────┴──────────┐
│ ApplicationEvent│  status transitions
└─────────────────┘

┌─────────────┐ *      1 ┌──────────┐
│  Embedding  ├──────────┤  (owner) │  polymorphic: resume version | job description
└─────────────┘          └──────────┘

┌─────────────┐   ┌──────────┐   ┌───────────┐   ┌──────────────┐
│ AiUsageLog  │   │ Template │   │Notification│  │ Subscription │
└─────────────┘   └──────────┘   └───────────┘   └──────────────┘
```

---

## 3. Table specifications

### 3.1 Identity

#### `User`

| Column                    | Type        | Constraints                   | Notes                                           |
| ------------------------- | ----------- | ----------------------------- | ----------------------------------------------- |
| `id`                      | uuid        | PK                            | UUIDv7                                          |
| `email`                   | text        | UNIQUE, NOT NULL              | Lowercased at the boundary — see the note below |
| `emailVerifiedAt`         | timestamptz | NULL                          | NULL = unverified                               |
| `passwordHash`            | text        | NULL                          | NULL for OAuth-only accounts                    |
| `name`                    | text        | NULL                          |                                                 |
| `avatarUrl`               | text        | NULL                          |                                                 |
| `role`                    | enum        | NOT NULL, default `CANDIDATE` | CANDIDATE, MENTOR, RECRUITER, ADMIN             |
| `tier`                    | enum        | NOT NULL, default `FREE`      | FREE, PRO, TEAM                                 |
| `mfaEnabled`              | boolean     | NOT NULL, default false       | Denormalised for a cheap login-path check       |
| `failedLoginCount`        | int         | NOT NULL, default 0           |                                                 |
| `lockedUntil`             | timestamptz | NULL                          |                                                 |
| `lastLoginAt`             | timestamptz | NULL                          |                                                 |
| `deletedAt`               | timestamptz | NULL                          | Soft delete                                     |
| `createdAt` / `updatedAt` | timestamptz | NOT NULL                      |                                                 |

Indexes: `UNIQUE(email)`, `(role)` partial where `deletedAt IS NULL`, `(deletedAt)`.

Note `passwordHash` is nullable and `email` is unique — so a user who signs up with Google
and later sets a password is one row, not two. Account linking is a data-model decision, not
an application workaround.

**Email case handling — implemented, with a caveat.** `email` is a plain `text` column with a
unique index. Case-insensitivity comes from `emailSchema` in `@cc/shared`, which trims and
lowercases _before_ validating, so nothing reaches the database un-normalised. (The ordering
matters and is easy to get wrong: a trailing `.toLowerCase()` runs after the format check, so
a pasted `"  User@Example.com "` would be rejected as malformed rather than cleaned — a unit
test covers exactly this.) A `citext` column would add defence in depth for any future writer
that bypasses the schema, but it needs Prisma's `postgresqlExtensions` preview feature; it is
deferred rather than silently assumed.

#### `OAuthAccount`

| Column                         | Type             | Notes                                                           |
| ------------------------------ | ---------------- | --------------------------------------------------------------- |
| `id`                           | uuid             | PK                                                              |
| `userId`                       | uuid             | FK → User, CASCADE                                              |
| `provider`                     | enum             | GOOGLE, GITHUB                                                  |
| `providerAccountId`            | text             | Provider's stable user ID — **not** the email, which can change |
| `accessToken` / `refreshToken` | text (encrypted) | Only if we need provider API access                             |
| `expiresAt`                    | timestamptz      |                                                                 |

Indexes: `UNIQUE(provider, providerAccountId)`, `UNIQUE(userId, provider)`, `(userId)`.

#### `RefreshToken`

| Column                    | Type        | Notes                                                    |
| ------------------------- | ----------- | -------------------------------------------------------- |
| `id`                      | uuid        | PK                                                       |
| `userId`                  | uuid        | FK → User, CASCADE                                       |
| `sessionId`               | uuid        | FK → DeviceSession, CASCADE                              |
| `familyId`                | uuid        | Shared by every token descended from one login           |
| `tokenHash`               | text        | SHA-256 of the token. **The raw token is never stored.** |
| `parentId`                | uuid        | NULL                                                     | Previous token in the rotation chain |
| `status`                  | enum        | ACTIVE, ROTATED, REVOKED                                 |
| `expiresAt`               | timestamptz |                                                          |
| `rotatedAt` / `revokedAt` | timestamptz |                                                          |

Indexes: `UNIQUE(tokenHash)`, `(userId, status)`, `(familyId)`, `(expiresAt)` for cleanup.

The `familyId` column is what makes theft detection work: presenting a token already marked
`ROTATED` means two parties hold tokens from the same login, so the whole family is revoked.

#### `DeviceSession`

`id`, `userId`, `userAgent`, `ipAddress` (stored truncated — /24 for IPv4, /48 for IPv6 —
because full IPs are PII we do not need), `deviceLabel`, `lastSeenAt`, `expiresAt`, `revokedAt`.
Indexes: `(userId, revokedAt)`, `(expiresAt)`.

#### `VerificationToken`

One table for every single-use token type, discriminated by `type`: EMAIL_VERIFICATION,
PASSWORD_RESET, MAGIC_LINK, EMAIL_CHANGE. Columns: `tokenHash` (unique), `userId`, `type`,
`payload` (jsonb, e.g. the new email address), `expiresAt`, `consumedAt`.
Indexes: `UNIQUE(tokenHash)`, `(userId, type)`, `(expiresAt)`.

One table rather than four: the lifecycle is identical (hash, TTL, single use), and a shared
table means the consume-once logic is written and tested once.

#### `MfaCredential`

`userId` (unique), `secretEncrypted` (AES-256-GCM, key from env — never plaintext),
`recoveryCodeHashes` (text[], argon2id), `confirmedAt`, `lastUsedAt`.

#### `AuditLog`

`id`, `userId` (nullable — failed logins may have no known user), `event` (enum),
`ipPrefix`, `userAgent`, `resourceType`, `resourceId`, `outcome`, `metadata` (jsonb),
`createdAt`. Indexes: `(userId, createdAt DESC)`, `(event, createdAt DESC)`.

**`userId` deliberately carries no foreign key.** This was found the hard way, by a test:
`onDelete: SetNull` issues an `UPDATE` against `AuditLog`, the append-only trigger refuses
it, and account deletion becomes impossible — which would break the 30-day purge NFR-51
requires. `onDelete: Cascade` is worse still, silently erasing the security trail of the
account being removed. So `userId` is a plain nullable UUID: a pseudonymous actor reference
that outlives the `User` row by design, which is exactly the retention behaviour §6 and
[Security §8](./12-security-design.md) describe. A separate `actorId`/`actorRef` column is
therefore redundant and does not exist.

**Append-only is enforced by a trigger, not a grant.** A `REVOKE` on `UPDATE`/`DELETE` does
not bind the table owner, and in development the application role _is_ the owner — so the
guarantee would silently not hold where it is easiest to violate. `BEFORE UPDATE` and
`BEFORE DELETE` triggers raise `insufficient_privilege` for every role including superusers.
Retention pruning is the one sanctioned exception: it sets `cc.audit_log_allow_prune` for the
duration of its transaction. Verified by `apps/api/tests/audit-log.append-only.test.ts`.

**BRIN on `createdAt` is deferred.** It is the right index for an append-only table queried
by time range, but Prisma models indexes and has no BRIN support, so every `migrate diff`
regenerates a `DROP` for it — fighting the tool on every schema change. The composite B-tree
indexes cover the same queries; BRIN returns as an out-of-band migration when the table is
large enough for its size advantage to matter.

### 3.2 Resume domain

#### `Resume`

| Column             | Type        | Notes                                                                 |
| ------------------ | ----------- | --------------------------------------------------------------------- |
| `id`               | uuid        | PK                                                                    |
| `userId`           | uuid        | FK → User, CASCADE                                                    |
| `title`            | text        | "Backend SDE — Amazon"                                                |
| `templateId`       | text        | FK → Template                                                         |
| `targetRole`       | text        | NULL                                                                  |
| `currentVersionId` | uuid        | FK → ResumeVersion — the live snapshot                                |
| `atsScore`         | int         | NULL — denormalised from the latest analysis for cheap list rendering |
| `status`           | enum        | DRAFT, ACTIVE, ARCHIVED, AWAITING_CONFIRMATION                        |
| `deletedAt`        | timestamptz |                                                                       |

Indexes: `(userId, deletedAt, updatedAt DESC)` — the exact shape of the resume-list query.

#### `ResumeVersion`

| Column          | Type        | Notes                                                  |
| --------------- | ----------- | ------------------------------------------------------ |
| `id`            | uuid        | PK                                                     |
| `resumeId`      | uuid        | FK → Resume, CASCADE                                   |
| `versionNumber` | int         | Monotonic per resume                                   |
| `content`       | jsonb       | The full resume document                               |
| `contentHash`   | text        | SHA-256 — prevents storing an identical snapshot twice |
| `schemaVersion` | int         | Which Resume schema version `content` conforms to      |
| `changeSummary` | text        | Human-readable, AI-generated where useful              |
| `createdBy`     | uuid        | FK → User                                              |
| `createdAt`     | timestamptz |                                                        |

Indexes: `UNIQUE(resumeId, versionNumber)`, `(resumeId, createdAt DESC)`, `(contentHash)`.
**Immutable** — no update path exists in the repository layer. Restoring an old version
writes a new row; history is never rewritten.

#### `ResumeShare`

`id`, `resumeId`, `versionId` (pin a version, or NULL to track current), `slug` (unique),
`passwordHash` (nullable), `expiresAt`, `viewCount`, `allowDownload`, `revokedAt`.
Indexes: `UNIQUE(slug)`, `(resumeId)`.

#### `ResumeComment` (v2)

`id`, `resumeId`, `versionId`, `authorId`, `anchorPath` (JSON pointer into content),
`body`, `resolvedAt`, `parentId` for threads.

### 3.3 Job and analysis

#### `JobDescription`

`id`, `userId`, `title`, `company`, `rawText`, `sourceUrl`, `parsed` (jsonb — extracted
requirements), `parsedAt`, `contentHash`. Index: `(userId, createdAt DESC)`, `(contentHash)`.

`contentHash` exists so the same JD pasted twice reuses the existing parse and its
embeddings, rather than paying for the extraction again.

#### `Analysis`

| Column             | Type  | Notes                                                                       |
| ------------------ | ----- | --------------------------------------------------------------------------- |
| `id`               | uuid  | PK                                                                          |
| `userId`           | uuid  | FK → User                                                                   |
| `resumeVersionId`  | uuid  | FK → ResumeVersion — analysis is pinned to a snapshot, not a mutable resume |
| `jobDescriptionId` | uuid  | FK, nullable — ATS-only analysis has no JD                                  |
| `atsScore`         | int   |                                                                             |
| `matchScore`       | int   | NULL when no JD                                                             |
| `breakdown`        | jsonb | Per-component scores and evidence                                           |
| `missingSkills`    | jsonb |                                                                             |
| `recommendations`  | jsonb |                                                                             |
| `rubricVersion`    | int   | Which ATS rubric produced this — old scores stay interpretable              |
| `cacheKey`         | text  | hash(resumeVersion + jd + rubricVersion)                                    |

Indexes: `UNIQUE(cacheKey)`, `(userId, createdAt DESC)`, `(resumeVersionId)`.

`rubricVersion` matters: when the scoring rules change, historical scores must not silently
appear to be on the same scale. Charts group by rubric version.

#### `Embedding`

`id`, `ownerType` (RESUME_VERSION | JOB_DESCRIPTION | SKILL), `ownerId`, `chunkIndex`,
`text`, `vector vector(1536)`, `model`, `contentHash`.
Indexes: `(ownerType, ownerId)`, `UNIQUE(contentHash, model)`, and an HNSW index on `vector`
for cosine distance.

```sql
CREATE INDEX embedding_vector_idx ON "Embedding"
  USING hnsw (vector vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```

### 3.4 Applications (v1)

#### `Application`

`id`, `userId`, `jobDescriptionId`, `resumeVersionId` (the version actually sent — this is
the whole point of pinning versions), `company`, `role`, `status` (enum: SAVED, APPLIED, OA,
INTERVIEW, HR_ROUND, OFFER, REJECTED, WITHDRAWN), `appliedAt`, `nextActionAt`, `notes`,
`source`, `salaryRange`, `location`.
Indexes: `(userId, status)`, `(userId, nextActionAt)` for the reminder sweep.

#### `ApplicationEvent`

`id`, `applicationId`, `fromStatus`, `toStatus`, `note`, `occurredAt`. Gives a real funnel
and time-in-stage analytics rather than just a current status.

### 3.5 Platform

#### `AiUsageLog`

`id`, `userId`, `feature`, `promptTemplate`, `templateVersion`, `provider`, `model`,
`inputTokens`, `outputTokens`, `costMicros` (integer — never float for money),
`latencyMs`, `cacheHit`, `success`, `errorCode`, `createdAt`.
Indexes: `(userId, createdAt DESC)`, `(feature, createdAt DESC)`. BRIN deferred for the same reason as `AuditLog` — see §3.1.

This table is what makes the "AI cost per active user" budget measurable instead of aspirational.

#### `Template`

`id`, `name`, `category`, `previewUrl`, `component`, `isPremium`, `atsSafe` (boolean — some
visually rich templates parse badly and the UI must warn), `sortOrder`, `active`.

#### `Notification`

`id`, `userId`, `type`, `title`, `body`, `link`, `readAt`, `channel`, `sentAt`.
Index: `(userId, readAt, createdAt DESC)`.

#### `Subscription`

`id`, `userId` (unique), `tier`, `provider`, `providerSubscriptionId`, `status`,
`currentPeriodEnd`, `cancelAtPeriodEnd`.

#### `UsageQuota`

`userId` + `periodStart` (composite unique), `aiActionsUsed`, `aiActionsLimit`,
`resumesCount`, `exportsUsed`. Incremented atomically; Redis holds the hot counter and
Postgres is the durable record reconciled on period roll.

---

## 4. Indexing strategy

Indexes are added for a measured query, not by intuition. Every index below exists because a
specific access path needs it:

| Index                                       | Serves                                                 |
| ------------------------------------------- | ------------------------------------------------------ |
| `Resume(userId, deletedAt, updatedAt DESC)` | Dashboard resume list                                  |
| `ResumeVersion(resumeId, versionNumber)`    | Version history, restore                               |
| `Analysis(cacheKey)`                        | Analysis cache hit before any compute                  |
| `RefreshToken(tokenHash)`                   | Refresh path — must be a single index lookup           |
| `RefreshToken(familyId)`                    | Family revocation on reuse detection                   |
| `AuditLog(event, createdAt DESC)`           | Time-range security queries (BRIN deferred — see §3.1) |
| `Embedding` HNSW `(vector)`                 | Approximate nearest neighbour for semantic match       |
| `Application(userId, status)`               | Kanban board                                           |
| `VerificationToken(expiresAt)`              | Nightly cleanup sweep                                  |

`EXPLAIN ANALYZE` output is expected in the PR for any new index or any query over a table
projected to exceed 100k rows.

---

## 5. Migration policy

- Prisma Migrate. Migrations are code: reviewed, committed, never edited after merge.
- **Forward-only.** No `prisma migrate reset` outside local development, ever.
- Breaking changes use expand → backfill → contract across three deploys:
  1. Add the new nullable column; write to both old and new.
  2. Backfill in a batched job; verify counts match.
  3. Switch reads to the new column; drop the old one in a later release.
- Every migration is applied to staging with production-shaped data before production.
- Long-running index builds use `CREATE INDEX CONCURRENTLY`, outside a transaction.
- CI runs migrations against a fresh database on every PR, so a broken migration cannot merge.

---

## 6. Data retention

| Data                        | Retention                                                    | Mechanism           |
| --------------------------- | ------------------------------------------------------------ | ------------------- |
| Uploaded source resumes     | 30 days after extraction                                     | Nightly cleanup job |
| Expired verification tokens | 7 days past expiry                                           | Nightly             |
| Revoked refresh tokens      | 30 days                                                      | Nightly             |
| Resume versions             | Last 50 (free), unlimited (Pro)                              | Pruned on write     |
| Audit logs                  | 2 years                                                      | Partition drop      |
| AI usage logs               | 1 year                                                       | Partition drop      |
| Deleted accounts            | PII purged within 30 days; audit rows keep a pseudonymous ID | Scheduled job       |

---

## 7. Backup and recovery

- Managed Postgres with daily full backups and point-in-time recovery.
- **RPO 5 minutes, RTO 1 hour.**
- Restore is rehearsed quarterly into a scratch environment. A backup that has never been
  restored is a hypothesis, not a backup.
- Object storage versioning enabled with a 30-day delete window.
- Redis is treated as reconstructible: sessions are recoverable from Postgres, cache is
  cold-start tolerant, and queue jobs persist with AOF.
