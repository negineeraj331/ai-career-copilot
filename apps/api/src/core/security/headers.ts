import cors from 'cors';
import helmet from 'helmet';
import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { ForbiddenError } from '../errors/app-error.js';

/** Security headers (NFR-22). Values mirror docs/12 §5. */
export function securityHeaders(): RequestHandler {
  const production = env().NODE_ENV === 'production';

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // The one deliberate weakening: Tailwind emits inline styles at
        // runtime. Documented rather than quietly present.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", env().API_URL],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        ...(production ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    hsts: production ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    noSniff: true,
    // We serve JSON and set no download headers; the IE-era noOpen policy adds
    // nothing and shows up in every response.
    ieNoOpen: false,
    // Leaking the framework tells an attacker which CVE list to start from.
    hidePoweredBy: true,
  });
}

/**
 * Strict origin allowlist with credentials.
 *
 * No wildcard: a wildcard origin combined with `credentials: true` is rejected
 * by browsers anyway, which is worth knowing before someone "fixes" a CORS
 * error that way.
 */
export function corsMiddleware(): RequestHandler {
  const allowed = new Set([env().WEB_URL]);

  return cors({
    origin(origin, callback) {
      // No Origin header: same-origin, curl, or a server-to-server call. There
      // is no browser to protect, so nothing to block.
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new ForbiddenError('Origin not allowed.'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id', 'Idempotency-Key'],
    exposedHeaders: [
      'X-Request-Id',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
    maxAge: 86_400,
  });
}
