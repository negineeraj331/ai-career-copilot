import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../src/core/errors/handler.js';
import { requestContext } from '../src/core/security/request-id.js';

/**
 * What the limiter does when Redis is *unavailable* — the case that decides
 * whether a cache outage becomes an open door or a full outage.
 *
 * docs/12 §6 originally specified a blanket fail-closed. That would take the
 * whole API down on a Redis blip, including reads with no abuse risk, which
 * contradicts the availability SLO. The implemented policy is per-class:
 * auth-sensitive routes fail closed, everything else fails open loudly.
 *
 * Redis is mocked to throw rather than pointed at a dead port, so the test
 * asserts the decision the middleware makes rather than waiting out a timeout.
 */
vi.mock('../src/core/redis/client.js', () => ({
  redis: () => ({
    eval: () => Promise.reject(new Error('ECONNREFUSED')),
  }),
  pingRedis: () => Promise.resolve(false),
  closeRedis: () => Promise.resolve(),
}));

const { rateLimit } = await import('../src/core/security/rate-limit.js');

function appWith(mode: 'open' | 'closed') {
  const app = express();
  app.use(requestContext);
  app.use(rateLimit({ name: `test-${mode}`, points: 5, durationSeconds: 60, failureMode: mode }));
  app.get('/probe', (_req, res) => {
    res.json({ served: true });
  });
  app.use(errorHandler);
  return app;
}

afterEach(() => vi.clearAllMocks());

describe('rate limiter with Redis unavailable', () => {
  it('fails OPEN for ordinary traffic, so a Redis blip is not an outage', async () => {
    const res = await request(appWith('open')).get('/probe').expect(200);
    expect(res.body.served).toBe(true);
  });

  it('fails CLOSED on auth-sensitive routes, so it is not an open door', async () => {
    const res = await request(appWith('closed')).get('/probe');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('tells a failed-closed client when to retry', async () => {
    const res = await request(appWith('closed')).get('/probe');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('gives a failed-closed client a safe message with no internals', async () => {
    const res = await request(appWith('closed')).get('/probe');
    expect(res.body.error.message).not.toMatch(/ECONNREFUSED|redis/i);
    expect(res.body.meta.requestId).toBeTruthy();
  });
});
