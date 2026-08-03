import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { CsrfError } from '../errors/app-error.js';

/**
 * Double-submit CSRF protection (NFR-23).
 *
 * We authenticate with cookies, which the browser attaches to cross-site
 * requests automatically — that is the whole reason CSRF exists. The defence:
 * issue a random token in a cookie the client's JavaScript *can* read, and
 * require it echoed back in a header. A cross-origin attacker can cause the
 * cookie to be sent but cannot read it, so it cannot produce the header.
 *
 * `cc_csrf` is deliberately the one non-HttpOnly cookie. That is not a
 * weakness: the token is useless without the session cookies, and the pattern
 * requires the client to read it. Tokens in `localStorage` would be the actual
 * weakness — see ADR-007.
 */

export const CSRF_COOKIE = 'cc_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time compare. A `===` here leaks token content through timing;
 *  the difference is small but the fix is free. */
function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Issues the token cookie when absent. Runs on every request so a client that
 *  lands on a GET first already holds a token by the time it posts. */
export const issueCsrfToken: RequestHandler = (req, res, next) => {
  const cookies = req.cookies as Record<string, string> | undefined;

  if (!cookies?.[CSRF_COOKIE]) {
    res.cookie(CSRF_COOKIE, generateCsrfToken(), {
      httpOnly: false, // by design — the client must echo this back
      secure: env().NODE_ENV === 'production',
      sameSite: 'lax',
      domain: env().COOKIE_DOMAIN === 'localhost' ? undefined : env().COOKIE_DOMAIN,
      path: '/',
    });
  }

  next();
};

export const verifyCsrf: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const cookies = req.cookies as Record<string, string> | undefined;
  const cookieToken = cookies?.[CSRF_COOKIE];
  const headerToken = req.header(CSRF_HEADER);

  if (!cookieToken || !headerToken || !tokensMatch(cookieToken, headerToken)) {
    next(new CsrfError());
    return;
  }

  next();
};
