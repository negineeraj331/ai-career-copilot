# Testing Strategy — Career Copilot

**Last updated:** 2026-08-03

---

## 1. Philosophy

Tests exist to let us change code confidently, not to hit a coverage number. Three rules
follow from that:

1. **Test behaviour, not implementation.** A test that breaks when you rename a private
   method is a liability. A test that breaks when login stops working is an asset.
2. **Failure paths are the point.** The happy path is what you build; the error path is what
   ships broken. Every feature's tests include what happens when it goes wrong.
3. **Fast where it can be, real where it must be.** Pure logic gets millisecond unit tests.
   Auth and database code gets real Postgres and Redis, because an ORM mock proves nothing.

---

## 2. The shape of the suite

```
        ╱╲          E2E (Playwright) — ~25 specs
       ╱  ╲         Critical journeys only. Slow, brittle, invaluable.
      ╱────╲
     ╱      ╲       Integration (Vitest + Supertest) — ~180 tests
    ╱        ╲      Real HTTP, real Postgres, real Redis, mock AI.
   ╱──────────╲
  ╱            ╲    Unit (Vitest) — ~600 tests
 ╱______________╲   Pure functions, hooks, components, services.
```

Weighted toward integration more than the classic pyramid suggests, because most of our real
risk lives at boundaries: authorisation checks, token rotation, quota accounting, transaction
correctness. Those are exactly the things a unit test with a mocked repository will pass while
production fails.

---

## 3. Layers

### 3.1 Unit tests

**Tool:** Vitest. **Runtime:** no I/O, no network, no database.

Prime targets:

- **`packages/ats`** — the deterministic scoring engine. Every rule gets a passing case, a
  failing case, and a boundary case. Because the engine is pure, these are the cheapest and
  most valuable tests in the codebase.
- **`packages/shared`** — Zod schemas: valid input parses, invalid input is rejected with the
  expected error path.
- **Service logic** with repositories stubbed — token rotation state machine, quota
  arithmetic, diff computation, version coalescing.
- **React components** via Testing Library — rendered output and user-visible behaviour,
  queried by role and label rather than test IDs, so the tests double as accessibility checks.
- **Hooks** via `renderHook`.

```ts
describe('atsEngine.score', () => {
  it('is deterministic', () => {
    const a = score(fixtureResume, RUBRIC_V1);
    const b = score(fixtureResume, RUBRIC_V1);
    expect(a).toEqual(b); // the entire credibility of the feature
  });

  it('deducts the full weight when a bullet has no metric', () => {
    const result = score(resumeWithNoMetrics, RUBRIC_V1);
    const rule = result.rules.find((r) => r.id === 'read.quantified');
    expect(rule).toMatchObject({ status: 'FAIL', earned: 0 });
  });

  it('completes within the 50 ms budget', () => {
    const start = performance.now();
    score(largeResume, RUBRIC_V1);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
```

### 3.2 Integration tests

**Tool:** Vitest + Supertest against the assembled Express app (no `listen()`).
**Dependencies:** real Postgres and Redis in Docker (CI service containers), `MockAiProvider`,
in-memory `Mailer` and `ObjectStore` test doubles.

Isolation: each test file runs in a transaction rolled back afterwards, or against a
per-worker schema. Tests must be order-independent — a suite that only passes in sequence is
hiding shared state.

What integration tests own:

- Full auth flows end to end, including every failure branch
- Authorisation: user A cannot read, update, or delete user B's resources
- CSRF rejection, rate-limit enforcement, lockout timing
- Transaction correctness and rollback on failure
- Version snapshot creation, coalescing, and restore
- Quota consumption, including the concurrent-request race

```ts
describe('POST /api/v1/auth/refresh', () => {
  it('revokes the whole family when a rotated token is replayed', async () => {
    const { refreshCookie, csrf } = await loginTestUser(app);

    const first = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .set('X-CSRF-Token', csrf)
      .expect(200);

    // Replaying the original token after rotation = theft signal.
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .set('X-CSRF-Token', csrf)
      .expect(401);

    // ...and the attacker's newly issued token must also be dead.
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookiesFrom(first).refresh)
      .set('X-CSRF-Token', csrf)
      .expect(401);

    expect(await auditEvents(user.id, 'REFRESH_REUSE_DETECTED')).toHaveLength(1);
  });
});
```

That third assertion is the one that matters. A test that only checks the replay fails would
pass against an implementation that revokes one token instead of the family — which is the
bug that leaves the attacker logged in.

### 3.3 End-to-end tests

**Tool:** Playwright, Chromium + WebKit, against a fully composed stack.

Kept deliberately small — E2E tests are slow and flaky in proportion to their number. Only
journeys where a break is unacceptable:

1. Register → verify email → onboard → upload resume → see ATS score
2. Login → edit a resume → preview updates → autosave → reload shows the change
3. Paste JD → analyse → accept an AI suggestion → score increases
4. Export PDF → file downloads and is non-empty
5. Version history → restore → content matches
6. Enable MFA → log out → log in with TOTP
7. Share link → open in a fresh context → password gate → read-only render
8. Mobile viewport: editor collapses to tabs and remains operable

Anti-flake rules: no fixed `waitForTimeout`; wait on user-visible state. Select by role and
accessible name. Each spec seeds its own data through the API and cleans up after itself.
A test that fails twice in a row on `main` is quarantined and fixed, not retried into silence.

### 3.4 Accessibility tests

`axe-core` runs in component tests and on every E2E page. Violations at `serious` or
`critical` fail the build. Automated checks catch roughly 40% of real accessibility problems,
so a manual screen-reader pass (VoiceOver, NVDA) is part of release sign-off — the automation
is a floor, not a certificate.

### 3.5 Performance tests

- Lighthouse CI on preview deploys: performance ≥ 90, accessibility ≥ 95.
- Bundle size assertion against the 250 KB gzip budget; CI fails on breach.
- `k6` load profile before a major release: 100 concurrent editors, asserting API p95 < 200 ms.
- Timing assertions on the ATS engine, as above.

### 3.6 AI evaluation

Prompt quality is validated by the golden-set evaluation in
[AI Prompt Design §10](./11-ai-prompt-design.md#10-evaluation), which runs on any prompt or
schema change. The fabrication check — zero entities in the output that were absent from the
input — is a hard gate.

**No test in any layer calls a real AI provider.** CI is deterministic and free.

---

## 4. Test data

- **Factories, not fixtures**, for entities: `buildUser({ mfaEnabled: true })` with sensible
  defaults and explicit overrides. A test should state only what it cares about; everything
  else is noise that obscures intent.
- **Committed fixtures** for the things that must not drift: golden resumes, JDs, and expected
  ATS scores. When a rubric change moves a golden score, that diff is the review.
- **Seed script** for local development: a demo user with three resumes at different quality
  levels, several JDs, and a populated application tracker.

---

## 5. Coverage

| Area                    | Gate      | Measured  | Rationale                                |
| ----------------------- | --------- | --------- | ---------------------------------------- |
| Overall (API)           | 85% lines | **91.0%** | The build gate                           |
| `modules/auth`          | 90% lines | **94.7%** | An auth bug is an account takeover       |
| `core/security`         | 92% lines | **97.7%** | CSRF, rate limiting, request correlation |
| Branches (API)          | 65%       | **71.8%** | See the note below                       |
| `packages/ats`          | 95%       | —         | Not built yet (Phase 1)                  |
| Quota and billing logic | 95%       | —         | Not built yet (Phase 1)                  |

**The gates sit below the measured values, deliberately.** A threshold pinned exactly at the
current number fails on any honest refactor that happens to add one unhit branch, and a gate
people routinely lower is not a gate at all. The margin is there so a failure means something.

**Two corrections to what this document previously claimed.** It said 80% overall and 95% on
auth. The real numbers are 91.0% and 94.7% — the overall figure is comfortably better, and auth
is 0.3 points short of the stated target rather than at it. The remaining uncovered lines in
auth are error branches in the controller and service layers. Rather than adjust the number to
fit, the gap closed by writing the tests that were actually missing: the real OAuth provider
adapters (previously 19% and 23%, because every integration test used a stub) and the
account-management flows — change password, sign out everywhere, resend verification — which
had no tests at all despite being things users do.

**Branch coverage lags at 71.8%** and is gated lower than the rest. Most uncovered branches are
defensive fallbacks on third-party responses — the `?? 'unknown'` arms that only fire when a
provider returns something undocumented. Tracked rather than hidden; raising it means simulating
malformed provider payloads, which is worth doing but has not been done.

Excluded from measurement: generated Prisma client, type-only files, config, and migrations.

Coverage is a smoke detector, not a fire-safety certificate. 100% coverage of code that
asserts nothing meaningful is worth less than 60% coverage with sharp assertions on the
failure paths. Reviewers are asked to judge the assertions, not the percentage.

---

## 6. CI execution

| Stage             | Runs on                           | Duration target |
| ----------------- | --------------------------------- | --------------- |
| Lint + typecheck  | Every push                        | < 2 min         |
| Unit tests        | Every push                        | < 3 min         |
| Integration tests | Every PR, with service containers | < 6 min         |
| Build             | Every PR                          | < 4 min         |
| E2E               | Every PR to `main`, and nightly   | < 10 min        |
| Lighthouse + axe  | Preview deploys                   | < 3 min         |
| AI evaluation     | Prompt or schema changes          | < 5 min         |
| Load test         | Release candidates, manual        | —               |

Unit and integration run in parallel. A PR cannot merge unless every required check is green.

---

## 7. What we deliberately do not test

- Third-party library internals — we test our usage, not their correctness.
- Prisma's query generation — that is Prisma's test suite.
- Trivial getters, or components with no logic and no interaction.
- Exact visual appearance. Visual regression testing is high-maintenance and high-noise for a
  product with 20+ user-selectable templates; layout correctness is verified manually and by
  the Lighthouse CLS budget.
