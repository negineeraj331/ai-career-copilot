# Monitoring & Logging — Career Copilot

**Last updated:** 2026-08-03

---

## 1. What we instrument, and why

Three questions have to be answerable at 2am:

1. **Is it broken?** — health checks, uptime probes, error rate.
2. **What is broken?** — structured logs correlated by request ID, plus error traces.
3. **Is it getting worse?** — metrics, trends, SLO burn rate.

Everything below serves one of those. Instrumentation that serves none of them is noise, and
noise is what makes people ignore alerts.

---

## 2. Logging

**Pino**, structured JSON, one line per event.

### Levels

| Level   | Use                               | Example                                              |
| ------- | --------------------------------- | ---------------------------------------------------- |
| `fatal` | Process cannot continue           | Config validation failed at boot                     |
| `error` | Operation failed, needs attention | Unhandled exception, database connection lost        |
| `warn`  | Degraded but handled              | AI provider retry, cache miss storm, rate limit hit  |
| `info`  | Significant business events       | User registered, resume exported, analysis completed |
| `debug` | Development detail                | Query shapes, cache decisions                        |
| `trace` | Off outside local                 | Very verbose                                         |

Production runs at `info`. `LOG_LEVEL` overrides it without a deploy.

### Correlation

Every request gets an ID — honouring an inbound `x-request-id` from the proxy if present —
held in `AsyncLocalStorage` and attached automatically to every log line, error report, and
downstream call in that request's lifetime.

```json
{
  "level": "info",
  "time": "2026-08-03T10:15:00.123Z",
  "requestId": "01J8XKQ2M4N5P6R7S8T9",
  "userId": "01J8XKQ2M4N5P6R7S8T9",
  "method": "POST",
  "path": "/api/v1/analysis",
  "statusCode": 200,
  "durationMs": 1847,
  "msg": "analysis completed",
  "resumeVersionId": "…",
  "atsScore": 78,
  "matchScore": 87,
  "aiCostMicros": 71000
}
```

That single line answers "was this slow, for whom, and what did it cost" without a join.

### Redaction

Enforced at the Pino serialiser, not at call sites:

```ts
redact: {
  paths: [
    'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
    '*.password', '*.passwordHash', '*.token', '*.refreshToken', '*.accessToken',
    '*.secret', '*.apiKey', '*.mfaSecret', '*.recoveryCodes',
  ],
  censor: '[REDACTED]',
}
```

Redaction at the call site relies on every developer remembering, forever. Redaction at the
serialiser cannot be forgotten.

### What we never log

Passwords, tokens, cookies, MFA secrets, recovery codes, full resume content, full request
bodies for auth endpoints, and full IP addresses (truncated to /24 or /48).

---

## 3. Metrics

**Prometheus** exposition via `prom-client` at `/metrics`, scraped on the internal network
only — the endpoint is not publicly routable.

### Application

| Metric                           | Type      | Labels                   |
| -------------------------------- | --------- | ------------------------ |
| `http_request_duration_seconds`  | histogram | method, route, status    |
| `http_requests_total`            | counter   | method, route, status    |
| `http_requests_in_flight`        | gauge     |                          |
| `db_query_duration_seconds`      | histogram | operation, model         |
| `db_pool_connections`            | gauge     | state                    |
| `redis_command_duration_seconds` | histogram | command                  |
| `cache_operations_total`         | counter   | cache, result (hit/miss) |
| `queue_jobs_total`               | counter   | queue, status            |
| `queue_job_duration_seconds`     | histogram | queue                    |
| `queue_depth`                    | gauge     | queue                    |

Routes are labelled by **pattern** (`/resumes/:id`), never by resolved path — labelling by
raw path creates unbounded cardinality and will take down a Prometheus instance.

### Domain

| Metric                        | Type      | Why it exists                                          |
| ----------------------------- | --------- | ------------------------------------------------------ |
| `ai_requests_total`           | counter   | By template, model, outcome, cache hit                 |
| `ai_tokens_total`             | counter   | Input/output, by model — feeds the cost budget         |
| `ai_cost_micros_total`        | counter   | The ₹35/user budget, measured not estimated            |
| `ai_request_duration_seconds` | histogram | Streaming latency SLO                                  |
| `ats_score_computed`          | histogram | Score distribution — a sudden shift means a rubric bug |
| `analysis_completed_total`    | counter   | Activation metric                                      |
| `resume_exports_total`        | counter   | By format, outcome                                     |
| `auth_events_total`           | counter   | login/failure/lockout/refresh-reuse                    |
| `active_users`                | gauge     | DAU/MAU                                                |

`auth_events_total{event="refresh_reuse_detected"}` is a security signal — any nonzero rate
pages, because it means either a token was stolen or our rotation logic is wrong. Both need
someone awake.

---

## 4. Health checks

**`GET /health`** — liveness. Process is up, event loop responsive. No dependency calls. Fast
and cheap, because the orchestrator polls it constantly.

**`GET /health/ready`** — readiness. Checks database, Redis, storage, and AI provider with
short timeouts and cached results (5 s) so probes cannot themselves cause load.

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

Returns `503` only if database or Redis is down. **A degraded AI provider does not fail
readiness** — the core product works without it, and pulling healthy replicas out of the load
balancer over an AI outage escalates a partial degradation into a full one.

---

## 5. Error tracking

**Sentry**, both client and server, with source maps uploaded at build time.

- Every event carries release version, commit SHA, environment, and the request ID — so a log
  line and an error trace can be joined.
- `beforeSend` strips PII: no resume content, no email addresses, no tokens.
- Sampling: 100% of errors, 10% of transactions in production.
- Client errors include a breadcrumb trail of user actions, minus input values.
- Expected errors (`VALIDATION_ERROR`, `UNAUTHENTICATED`, `NOT_FOUND`) are **not** reported —
  they are normal traffic, and reporting them buries real bugs in noise.

---

## 6. Alerts

Alerts wake people. The bar is: _would I want to be woken for this?_ If not, it belongs on a
dashboard.

### Page immediately

| Condition                    | Threshold                       |
| ---------------------------- | ------------------------------- |
| Service down                 | Health check failing 2 min      |
| Error rate                   | 5xx > 2% of requests over 5 min |
| Database unreachable         | Any                             |
| p99 latency                  | > 2 s for 10 min                |
| Refresh-token reuse detected | Any occurrence                  |
| Failed-login spike           | > 10× baseline over 5 min       |
| Disk                         | > 85%                           |
| Queue depth                  | > 1,000 for 10 min              |

### Notify during working hours

| Condition          | Threshold                 |
| ------------------ | ------------------------- |
| p95 latency        | > 500 ms for 15 min       |
| AI provider errors | > 10% over 15 min         |
| Cache hit rate     | < 60% for 30 min          |
| Job failure rate   | > 5% over 30 min          |
| Certificate expiry | < 14 days                 |
| AI cost per user   | > 120% of budget for 24 h |
| Coverage drop      | > 2% on `main`            |

Every alert links to a runbook. An alert nobody knows how to action is a false alarm with
extra steps.

---

## 7. SLOs

| Service           | SLI                    | Target         | Window |
| ----------------- | ---------------------- | -------------- | ------ |
| API availability  | Non-5xx / total        | 99.5%          | 30 d   |
| API latency       | p95 < 200 ms (non-AI)  | 99% of minutes | 30 d   |
| Editor autosave   | Success rate           | 99.9%          | 30 d   |
| Export completion | Within 30 s            | 99%            | 30 d   |
| AI availability   | Non-error AI responses | 99%            | 30 d   |

Error budget policy: when 50% of the monthly budget is consumed, feature work pauses in
favour of reliability work. That rule only means anything if it is written down before the
budget is burning.

---

## 8. Dashboards

**Service health** — request rate, error rate, latency percentiles, in-flight requests,
replica count.

**Business** — signups, activation rate, analyses run, exports, ATS score distribution over
time, free→pro conversion.

**AI cost** — token spend by model and feature, cache hit rate, cost per active user against
the ₹35 line, top templates by spend.

**Infrastructure** — CPU, memory, database connections, Redis memory, queue depth per queue,
job durations.

All dashboards are defined as code in `infra/grafana/` and version-controlled. A dashboard
built by clicking in a UI is lost the first time the instance is rebuilt.

---

## 9. Distributed tracing (v2)

OpenTelemetry spans across API → database → Redis → queue → worker → AI provider. Not needed
at v1 scale — with a modular monolith, request IDs in structured logs answer the same
questions for far less operational cost. This becomes worth the effort when the first module
is extracted into its own service.

---

## 10. Runbooks

Every paging alert has a runbook in `docs/runbooks/` with: symptom, likely causes, diagnostic
commands, remediation steps, and escalation path.

Planned at MVP:

- Service down / failing health check
- Elevated error rate
- Database connection exhaustion
- Redis down — **note the rate limiter fails closed, so login will reject; this is intentional**
- AI provider outage
- Queue backlog
- Refresh-token reuse detected (security)
- Deploy rollback procedure
