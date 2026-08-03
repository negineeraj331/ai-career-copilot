import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { closeDatabase } from '../src/core/db/prisma.js';
import { closeRedis, redis } from '../src/core/redis/client.js';
import { resetReadinessCache } from '../src/modules/health/health.service.js';

let app: Express;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  resetReadinessCache();
  // Clear rate-limit counters so one test's traffic cannot exhaust another's
  // budget — otherwise the suite fails differently depending on test order.
  const keys = await redis().keys('cc:rl:*');
  if (keys.length > 0) await redis().del(...keys);
});

afterAll(async () => {
  await Promise.all([closeDatabase(), closeRedis()]);
});

describe('health endpoints', () => {
  it('reports liveness without touching any dependency', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.uptime).toBeGreaterThanOrEqual(0);
  });

  it('reports readiness with per-dependency detail', async () => {
    const res = await request(app).get('/health/ready').expect(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.checks.database.status).toBe('ok');
    expect(res.body.data.checks.redis.status).toBe('ok');
    // A probe that only says "unhealthy" sends the on-call engineer hunting.
    expect(res.body.data.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('does not let a non-critical dependency gate readiness', async () => {
    const res = await request(app).get('/health/ready').expect(200);
    // AI is reported but must never fail the check — pulling healthy replicas
    // over an AI outage turns a partial degradation into a full one.
    expect(res.body.data.checks.ai).toBeDefined();
    expect(res.body.data.status).toBe('ok');
  });

  it('stays reachable without a CSRF token', async () => {
    // Health sits before the CSRF and rate-limit layers on purpose: a limiter
    // outage must not make the service look unhealthy and cause a restart loop.
    await request(app).get('/health').expect(200);
  });
});

describe('request correlation', () => {
  it('issues a request id and echoes it in the response', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.meta.requestId).toBe(res.headers['x-request-id']);
  });

  it('honours a well-formed inbound request id', async () => {
    const res = await request(app).get('/health').set('x-request-id', 'trace-abc-123').expect(200);
    expect(res.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('replaces a malformed inbound request id rather than reflecting it', async () => {
    // It lands in logs and in a response header, so an unvalidated value is a
    // log-injection and response-splitting vector.
    const res = await request(app)
      .get('/health')
      .set('x-request-id', 'bad id with spaces <script>')
      .expect(200);
    expect(res.headers['x-request-id']).not.toContain('script');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('security headers', () => {
  it('sets a content security policy with no unsafe-inline scripts', async () => {
    const res = await request(app).get('/health').expect(200);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('sets the standard hardening headers', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('does not advertise the framework', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS', () => {
  it('allows the configured web origin with credentials', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', process.env.WEB_URL ?? 'http://localhost:5173')
      .expect(200);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects an unknown origin', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('never returns a wildcard origin', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', process.env.WEB_URL ?? 'http://localhost:5173');
    // A wildcard with credentials is rejected by browsers anyway — worth
    // asserting so nobody "fixes" a CORS error that way.
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('CSRF protection', () => {
  it('issues a readable CSRF cookie', async () => {
    const res = await request(app).get('/api/v1/anything');
    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    const csrf = cookies?.find((c) => c.startsWith('cc_csrf='));
    expect(csrf).toBeDefined();
    // Deliberately NOT HttpOnly: the double-submit pattern requires the client
    // to read this and echo it back in a header.
    expect(csrf).not.toContain('HttpOnly');
    expect(csrf).toContain('SameSite=Lax');
  });

  it('rejects a state-changing request with no token', async () => {
    const res = await request(app).post('/api/v1/anything').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects a mismatched token', async () => {
    const res = await request(app)
      .post('/api/v1/anything')
      .set('Cookie', 'cc_csrf=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
      .set('X-CSRF-Token', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('accepts a matching token', async () => {
    const token = 'matching-token-value-1234567890ab';
    const res = await request(app)
      .post('/api/v1/anything')
      .set('Cookie', `cc_csrf=${token}`)
      .set('X-CSRF-Token', token)
      .send({});
    // Past CSRF, so it reaches the 404 — which is the point.
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('does not require a token for safe methods', async () => {
    await request(app).get('/api/v1/anything').expect(404);
  });
});

describe('error envelope', () => {
  it('returns the standard shape for an unmatched route', async () => {
    const res = await request(app).get('/api/v1/does-not-exist').expect(404);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(res.body.meta.requestId).toBeTruthy();
    expect(res.body.meta.timestamp).toBeTruthy();
  });

  it('reports malformed JSON as a client error, not a server error', async () => {
    const token = 'matching-token-value-1234567890ab';
    const res = await request(app)
      .post('/api/v1/anything')
      .set('Cookie', `cc_csrf=${token}`)
      .set('X-CSRF-Token', token)
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    // Blaming us with a 500 for the client's broken JSON would be wrong.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('never leaks a stack trace to the client', async () => {
    const res = await request(app).get('/api/v1/does-not-exist').expect(404);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\(.*:\d+:\d+\)/);
    expect(res.body.error).not.toHaveProperty('stack');
  });
});

describe('rate limiting', () => {
  it('reports the remaining budget on every response', async () => {
    const res = await request(app).get('/api/v1/anything');
    expect(res.headers['x-ratelimit-limit']).toBe('30');
    expect(Number(res.headers['x-ratelimit-remaining'])).toBeLessThan(30);
  });

  it('rejects once the window budget is spent, with Retry-After', async () => {
    let limited: request.Response | undefined;
    for (let i = 0; i < 35; i += 1) {
      const res = await request(app).get('/api/v1/anything');
      if (res.status === 429) {
        limited = res;
        break;
      }
    }

    expect(limited).toBeDefined();
    expect(limited?.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited?.headers['retry-after'])).toBeGreaterThan(0);
  });
});
