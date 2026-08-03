import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { errorHandler, notFoundHandler } from './core/errors/handler.js';
import { issueCsrfToken, verifyCsrf } from './core/security/csrf.js';
import { corsMiddleware, securityHeaders } from './core/security/headers.js';
import { limiters } from './core/security/rate-limit.js';
import { requestContext } from './core/security/request-id.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';

/**
 * Assembles the Express app. Deliberately does NOT call `listen` — that lives
 * in index.ts, so integration tests can drive the app over an ephemeral socket
 * without binding a real port or managing a server lifecycle.
 *
 * Middleware order is load-bearing and matches docs/03 §3.2:
 *
 *   request id  → nothing downstream can log without correlation
 *   headers     → set before any handler can produce a response
 *   cors        → reject disallowed origins before doing work
 *   body parse  → with a size limit
 *   cookies     → CSRF needs them parsed
 *   csrf issue  → so a client always holds a token
 *   routes      → per-route limits and CSRF verification attach here
 *   404         → anything unmatched
 *   errors      → terminal, registered last
 */
export function createApp(): Express {
  const app = express();

  // Behind Cloudflare and nginx, req.ip is the proxy without this — which would
  // silently key every rate limit to a single address. One hop: our own proxy.
  // Never `true`, which would trust a client-supplied X-Forwarded-For outright.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.disable('etag');

  app.use(requestContext);
  app.use(securityHeaders());
  app.use(corsMiddleware());

  // Health endpoints are mounted before the body parser and rate limiter:
  // probes should stay cheap, and a limiter outage must never make the service
  // look unhealthy and trigger a restart loop.
  app.use(healthRoutes());

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(issueCsrfToken);

  app.use('/api/v1', limiters.public());
  app.use('/api/v1', verifyCsrf);

  app.use('/api/v1/auth', authRoutes());

  // Further feature routers mount here as slices land (resumes in 1.1).

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
