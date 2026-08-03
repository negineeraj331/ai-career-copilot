import type { Request, RequestHandler } from 'express';
import { RateLimitedError, ServiceUnavailableError } from '../errors/app-error.js';
import { loggerFor } from '../logger/logger.js';
import { redis } from '../redis/client.js';

const log = loggerFor('rate-limit');

/**
 * Redis-backed fixed-window rate limiting (NFR-24).
 *
 * ── On the failure mode ──────────────────────────────────────────────────────
 * docs/12 §6 originally specified a blanket fail-closed: if Redis is down,
 * reject everything. Implementing it exposed the cost — a Redis blip would take
 * the entire API down, including reads that carry no abuse risk at all. That
 * contradicts the 99.5% availability SLO and NFR-13's principle that the system
 * degrades in slices rather than all at once.
 *
 * So the policy is now per-class rather than global:
 *
 *   • Auth-sensitive classes (login, register, password reset, MFA) fail
 *     CLOSED. These are exactly the endpoints where an unlimited retry budget
 *     is worth something to an attacker, and a brief outage on them is a far
 *     smaller harm than an open door for credential stuffing.
 *
 *   • Everything else fails OPEN, loudly — a warning per occurrence and a
 *     counter to alert on. Losing rate limiting on resume reads for the length
 *     of a Redis outage is an acceptable, bounded risk; losing the whole
 *     product is not.
 *
 * The trade is explicit either way, which is the part that actually matters:
 * the failure behaviour of a limiter should never be an accident of how the
 * error propagates.
 */

export type FailureMode = 'closed' | 'open';

export interface RateLimitOptions {
  /** Requests permitted per window. */
  points: number;
  /** Window length in seconds. */
  durationSeconds: number;
  /** Namespace, so classes cannot collide in Redis. */
  name: string;
  failureMode?: FailureMode;
  /** Defaults to the truncated client IP. Auth routes key on email+IP instead. */
  keyFor?: (req: Request) => string;
}

/** INCR + conditional PEXPIRE must be atomic: doing them as two round trips
 *  lets a crash between them leave a key with no TTL, which silently becomes a
 *  permanent ban for that client. */
const WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return {current, redis.call('PTTL', KEYS[1])}
`;

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export async function consume(
  name: string,
  identifier: string,
  points: number,
  durationSeconds: number,
): Promise<RateLimitVerdict> {
  const key = `cc:rl:${name}:${identifier}`;
  const result = (await redis().eval(WINDOW_SCRIPT, 1, key, String(durationSeconds * 1000))) as [
    number,
    number,
  ];

  const [used, ttlMs] = result;
  const resetSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

  return {
    allowed: used <= points,
    remaining: Math.max(0, points - used),
    resetSeconds,
  };
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { points, durationSeconds, name, failureMode = 'open' } = options;
  const keyFor = options.keyFor ?? ((req: Request) => req.ip ?? 'unknown');

  return (req, res, next) => {
    void (async () => {
      let verdict: RateLimitVerdict;

      try {
        verdict = await consume(name, keyFor(req), points, durationSeconds);
      } catch (error) {
        if (failureMode === 'closed') {
          log.error(
            { err: error, limiter: name },
            'rate limiter unavailable; failing closed on a protected route',
          );
          next(
            new ServiceUnavailableError(
              'Sign-in is temporarily unavailable. Please try again shortly.',
              30,
            ),
          );
          return;
        }

        log.warn(
          { err: error, limiter: name, path: req.path },
          'rate limiter unavailable; failing open — requests are unthrottled until Redis recovers',
        );
        next();
        return;
      }

      res.setHeader('X-RateLimit-Limit', String(points));
      res.setHeader('X-RateLimit-Remaining', String(verdict.remaining));
      res.setHeader('X-RateLimit-Reset', String(verdict.resetSeconds));

      if (!verdict.allowed) {
        next(new RateLimitedError(verdict.resetSeconds));
        return;
      }

      next();
    })();
  };
}

/** Limits from docs/06 §1.6, named so routes read declaratively. */
export const limiters = {
  /** Unauthenticated traffic: 30/min per IP. */
  public: (): RequestHandler =>
    rateLimit({ name: 'public', points: 30, durationSeconds: 60, failureMode: 'open' }),

  /** Authenticated traffic: 300/min per user, falling back to IP. */
  authenticated: (): RequestHandler =>
    rateLimit({
      name: 'auth-user',
      points: 300,
      durationSeconds: 60,
      failureMode: 'open',
      keyFor: (req) => req.header('x-user-id') ?? req.ip ?? 'unknown',
    }),

  /** Login: 5 per 15 min per email+IP. Fails closed — see the note above. */
  login: (): RequestHandler =>
    rateLimit({
      name: 'login',
      points: 5,
      durationSeconds: 900,
      failureMode: 'closed',
      keyFor: (req) => {
        const email =
          typeof req.body === 'object' && req.body !== null && 'email' in req.body
            ? String((req.body as { email?: unknown }).email ?? '')
            : '';
        return `${email.toLowerCase()}|${req.ip ?? 'unknown'}`;
      },
    }),

  /** Registration: 3/hour per IP. Fails closed. */
  register: (): RequestHandler =>
    rateLimit({ name: 'register', points: 3, durationSeconds: 3600, failureMode: 'closed' }),

  /** Password reset requests: 3/hour per IP. Fails closed. */
  passwordReset: (): RequestHandler =>
    rateLimit({ name: 'pwreset', points: 3, durationSeconds: 3600, failureMode: 'closed' }),
};
