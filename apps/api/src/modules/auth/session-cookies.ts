import type { Response } from 'express';
import { env } from '../../config/env.js';
import type { IssuedSession } from './tokens.service.js';

/**
 * Session cookie mechanics.
 *
 * These live here rather than in tokens.service.ts because writing a cookie is
 * an HTTP concern, and a service that imports `express` cannot be tested or
 * reused without a request. The layer rule in docs/08 is enforced by lint, and
 * it caught this exact violation when the helpers were in the service.
 *
 * Cookie design rationale is in ADR-007: tokens live in HttpOnly cookies rather
 * than localStorage so a successful XSS cannot read them.
 */

export const ACCESS_COOKIE = 'cc_at';
export const REFRESH_COOKIE = 'cc_rt';

/** Scoped to the auth path so the refresh token is not transmitted on ordinary
 *  API calls, narrowing its exposure to the one endpoint that needs it. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

const ACCESS_TTL_SECONDS = 15 * 60;

function cookieBase() {
  const production = env().NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: production,
    sameSite: 'lax' as const,
    // An explicit `localhost` domain is rejected by some browsers; omitting it
    // makes the cookie host-only, which is what we want locally anyway.
    domain: env().COOKIE_DOMAIN === 'localhost' ? undefined : env().COOKIE_DOMAIN,
  };
}

export function setSessionCookies(res: Response, session: IssuedSession): void {
  res.cookie(ACCESS_COOKIE, session.accessToken, {
    ...cookieBase(),
    path: '/',
    maxAge: ACCESS_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    ...cookieBase(),
    path: REFRESH_COOKIE_PATH,
    expires: session.refreshExpiresAt,
  });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...cookieBase(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: REFRESH_COOKIE_PATH });
}
