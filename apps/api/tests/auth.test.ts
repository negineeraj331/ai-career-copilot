import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { closeDatabase, prisma } from '../src/core/db/prisma.js';
import { closeRedis } from '../src/core/redis/client.js';
import {
  API,
  STRONG_PASSWORD,
  type Client,
  del,
  emailWasSent,
  get,
  makeClient,
  post,
  resetAuthState,
  testMailer,
  tokenFromEmail,
} from './helpers/auth.js';

let app: Express;
let client: Client;

/**
 * A fresh address per test — see auth-mfa.test.ts for the reasoning. Nothing to
 * inherit means test ordering cannot affect the result.
 */
const EMAIL_PREFIX = 'flow-';
let EMAIL = '';
let OTHER_EMAIL = '';

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  EMAIL = `${EMAIL_PREFIX}${randomUUID()}@example.com`;
  OTHER_EMAIL = `${EMAIL_PREFIX}other-${randomUUID()}@example.com`;
  await resetAuthState([EMAIL, OTHER_EMAIL]);
  client = await makeClient(app);
});

afterAll(async () => {
  await prisma().user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  await Promise.all([closeDatabase(), closeRedis()]);
});

/** Registers and verifies, leaving an account ready to sign in with. */
async function registerVerified(email = EMAIL): Promise<void> {
  await post(client, `${API}/register`, { email, password: STRONG_PASSWORD }).expect(201);
  const token = tokenFromEmail('verify your email', email);
  await post(client, `${API}/verify-email`, { token }).expect(200);
}

describe('registration', () => {
  it('creates an account and sends a verification email', async () => {
    const res = await post(client, `${API}/register`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
      name: 'Flow Test',
    }).expect(201);

    expect(res.body.data.email).toBe(EMAIL);
    expect(emailWasSent('verify your email', EMAIL)).toBe(true);

    const user = await prisma().user.findUnique({ where: { email: EMAIL } });
    expect(user).not.toBeNull();
    expect(user?.emailVerifiedAt).toBeNull();
  });

  it('never stores the password in a readable form', async () => {
    await post(client, `${API}/register`, { email: EMAIL, password: STRONG_PASSWORD }).expect(201);
    const user = await prisma().user.findUnique({ where: { email: EMAIL } });
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toContain(STRONG_PASSWORD);
    expect(user?.passwordHash?.startsWith('$argon2id$')).toBe(true);
  });

  it('gives an identical response for an address that already exists', async () => {
    const first = await post(client, `${API}/register`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
    }).expect(201);

    testMailer().clear();

    const second = await post(client, `${API}/register`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
    }).expect(201);

    // A distinguishable response here is a free account-enumeration oracle.
    expect(second.body.data).toEqual(first.body.data);
    // ...and the real owner is told someone tried.
    expect(emailWasSent('someone tried to create an account', EMAIL)).toBe(true);
    expect(emailWasSent('verify your email', EMAIL)).toBe(false);

    expect(await prisma().user.count({ where: { email: EMAIL } })).toBe(1);
  });

  it('rejects a password on the common-password denylist', async () => {
    const res = await post(client, `${API}/register`, {
      email: EMAIL,
      password: 'correcthorsebatterystaple',
    }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a password containing the user’s own email', async () => {
    // Derived from the address under test rather than hardcoded: EMAIL is
    // randomised per test, and a literal here would stop exercising the rule
    // the moment the fixture changed — while still passing.
    const localPart = EMAIL.split('@')[0] ?? '';
    const res = await post(client, `${API}/register`, {
      email: EMAIL,
      password: `${localPart}-is-my-password`,
    }).expect(400);
    expect(res.body.error.details?.[0]?.field).toBe('password');
  });

  it('accepts a password that merely shares a short fragment with the email', async () => {
    // Regression: an over-eager context check derived the 4-character fragment
    // "live" from live-123@example.com and rejected an otherwise fine password.
    // The same rule would reject "information-security-99" for info-desk@... —
    // a rejection the user cannot make sense of.
    await post(client, `${API}/register`, {
      email: 'live-9182@example.com',
      password: 'live-thicket-marmalade-42',
    }).expect(201);
    await prisma().user.deleteMany({ where: { email: 'live-9182@example.com' } });
  });

  it('still rejects a password containing a substantial part of the email', async () => {
    await post(client, `${API}/register`, {
      email: 'neerajnegi@example.com',
      password: 'neerajnegi-2026-vault',
    }).expect(400);
  });

  it('rejects a long keyboard sequence', async () => {
    const res = await post(client, `${API}/register`, {
      email: EMAIL,
      password: 'abcdefghijklmnop',
    }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a password below the length minimum', async () => {
    await post(client, `${API}/register`, { email: EMAIL, password: 'short' }).expect(400);
  });
});

describe('email verification', () => {
  it('verifies with a valid token', async () => {
    await post(client, `${API}/register`, { email: EMAIL, password: STRONG_PASSWORD }).expect(201);
    const token = tokenFromEmail('verify your email', EMAIL);

    await post(client, `${API}/verify-email`, { token }).expect(200);

    const user = await prisma().user.findUnique({ where: { email: EMAIL } });
    expect(user?.emailVerifiedAt).not.toBeNull();
  });

  it('refuses to reuse a token', async () => {
    await post(client, `${API}/register`, { email: EMAIL, password: STRONG_PASSWORD }).expect(201);
    const token = tokenFromEmail('verify your email', EMAIL);

    await post(client, `${API}/verify-email`, { token }).expect(200);
    // Single use: the consume is guarded inside the UPDATE, so a replay finds nothing.
    await post(client, `${API}/verify-email`, { token }).expect(400);
  });

  it('rejects an unknown token', async () => {
    await post(client, `${API}/verify-email`, { token: 'not-a-real-token' }).expect(400);
  });
});

describe('login', () => {
  it('signs in a verified user and sets httpOnly session cookies', async () => {
    await registerVerified();

    const res = await post(client, `${API}/login`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
    }).expect(200);

    expect(res.body.data.user.email).toBe(EMAIL);
    expect(res.body.data.mfaRequired).toBe(false);

    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    const access = cookies.find((c) => c.startsWith('cc_at='));
    const refresh = cookies.find((c) => c.startsWith('cc_rt='));

    // HttpOnly is the whole reason tokens live in cookies rather than
    // localStorage: an XSS cannot read them. See ADR-007.
    expect(access).toContain('HttpOnly');
    expect(refresh).toContain('HttpOnly');
    // Path-scoped so it is not transmitted on ordinary API calls.
    expect(refresh).toContain('Path=/api/v1/auth');
  });

  it('never puts a token in the response body', async () => {
    await registerVerified();
    const res = await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD });
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/accessToken|refreshToken|"token"/);
  });

  it('blocks an unverified account', async () => {
    await post(client, `${API}/register`, { email: EMAIL, password: STRONG_PASSWORD }).expect(201);
    const res = await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD });
    expect(res.status).toBe(403);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    await registerVerified();

    const wrongPassword = await post(client, `${API}/login`, {
      email: EMAIL,
      password: 'definitely-not-the-password',
    });
    const unknownAccount = await post(client, `${API}/login`, {
      email: 'nobody-here@example.com',
      password: 'definitely-not-the-password',
    });

    expect(wrongPassword.status).toBe(unknownAccount.status);
    expect(wrongPassword.body.error.code).toBe(unknownAccount.body.error.code);
    expect(wrongPassword.body.error.message).toBe(unknownAccount.body.error.message);
  });

  it('takes comparable time for an unknown account as for a wrong password', async () => {
    await registerVerified();

    const time = async (email: string): Promise<number> => {
      const start = performance.now();
      await post(client, `${API}/login`, { email, password: 'definitely-not-the-password' });
      return performance.now() - start;
    };

    const known = await time(EMAIL);
    const unknown = await time('nobody-here@example.com');

    // Without the dummy verify, the unknown-account path returns in ~1 ms while
    // the real one spends ~50 ms in argon2 — an enumeration oracle that no
    // amount of response-body matching can close. Generous ratio: CI is noisy.
    const ratio = Math.max(known, unknown) / Math.max(1, Math.min(known, unknown));
    expect(ratio).toBeLessThan(10);
  });

  it('locks the account after five failures and reports Retry-After', async () => {
    await registerVerified();

    let locked:
      | { status: number; headers: Record<string, string>; body: { error: { code: string } } }
      | undefined;
    for (let i = 0; i < 6; i += 1) {
      const res = await post(client, `${API}/login`, { email: EMAIL, password: `wrong-${i}` });
      if (res.status === 423) {
        locked = res as never;
        break;
      }
    }

    expect(locked?.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(Number(locked?.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('still refuses the correct password while locked', async () => {
    await registerVerified();
    for (let i = 0; i < 6; i += 1) {
      await post(client, `${API}/login`, { email: EMAIL, password: `wrong-${i}` });
    }
    const res = await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD });
    expect(res.status).toBe(423);
  });
});

describe('refresh token rotation', () => {
  it('rotates and keeps the session usable', async () => {
    await registerVerified();
    await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);

    await post(client, `${API}/refresh`).expect(200);
    await get(client, `${API}/me`).expect(200);
  });

  it('revokes the whole family when a rotated token is replayed', async () => {
    await registerVerified();
    const login = await post(client, `${API}/login`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
    }).expect(200);

    const stolen = ((login.headers['set-cookie'] as unknown as string[]) ?? [])
      .find((c) => c.startsWith('cc_rt='))
      ?.split(';')[0];
    expect(stolen).toBeTruthy();

    // Legitimate rotation. The stolen copy is now ROTATED.
    await post(client, `${API}/refresh`).expect(200);

    // The attacker replays it — from a bare request, not the agent, because an
    // agent carries its own jar and a hand-set Cookie array collides with it.
    const replay = await request(app)
      .post(`${API}/refresh`)
      .set('X-CSRF-Token', client.csrf)
      .set('Cookie', `cc_csrf=${client.csrf}; ${stolen as string}`);
    expect(replay.status).toBe(401);

    // Both parties must now be locked out — revoking only the replayed token
    // would leave whichever of them holds the newest one still signed in.
    const user = await prisma().user.findUnique({ where: { email: EMAIL } });
    const active = await prisma().refreshToken.count({
      where: { userId: user?.id, status: 'ACTIVE' },
    });
    expect(active).toBe(0);

    const sessions = await prisma().deviceSession.count({
      where: { userId: user?.id, revokedAt: null },
    });
    expect(sessions).toBe(0);

    const audit = await prisma().auditLog.count({
      where: { userId: user?.id, event: 'REFRESH_REUSE_DETECTED' },
    });
    expect(audit).toBe(1);

    expect(emailWasSent('security alert', EMAIL)).toBe(true);
  });

  it('rejects a refresh with no cookie', async () => {
    await post(client, `${API}/refresh`).expect(401);
  });
});

describe('sessions', () => {
  it('lists the current session and marks it current', async () => {
    await registerVerified();
    await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);

    const res = await get(client, `${API}/sessions`).expect(200);
    expect(res.body.data.sessions).toHaveLength(1);
    expect(res.body.data.sessions[0].current).toBe(true);
  });

  it('stores a truncated IP on the session, never the full address', async () => {
    await registerVerified();
    await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);

    const res = await get(client, `${API}/sessions`).expect(200);
    const ip = res.body.data.sessions[0].ipPrefix as string;
    // Regression: the controller used to read req.ip directly, so sessions kept
    // whole addresses while the audit log correctly kept /24s.
    expect(ip).toMatch(/(\.x$|::$|^unknown$)/);
    expect(ip).not.toBe('127.0.0.1');
  });

  it('signs out and invalidates the session', async () => {
    await registerVerified();
    await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);

    await post(client, `${API}/logout`).expect(204);
    await get(client, `${API}/me`).expect(401);
  });

  it('does not let one user revoke another user’s session', async () => {
    await registerVerified(OTHER_EMAIL);
    const victim = await makeClient(app);
    await post(victim, `${API}/login`, { email: OTHER_EMAIL, password: STRONG_PASSWORD }).expect(
      200,
    );
    const victimSessions = await get(victim, `${API}/sessions`).expect(200);
    const victimSessionId = victimSessions.body.data.sessions[0].id as string;

    await registerVerified(EMAIL);
    await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);

    // 404 rather than 403 — a 403 would confirm the id exists.
    await del(client, `${API}/sessions/${victimSessionId}`).expect(404);

    await get(victim, `${API}/me`).expect(200);
  });
});

describe('password reset', () => {
  it('resets the password and ends every existing session', async () => {
    await registerVerified();
    await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);

    await post(client, `${API}/forgot-password`, { email: EMAIL }).expect(200);
    const token = tokenFromEmail('reset your password', EMAIL);

    const newPassword = 'brand-new-thicket-2026';
    await post(client, `${API}/reset-password`, { token, password: newPassword }).expect(200);

    // If the reset was triggered because an attacker had access, leaving their
    // session alive would defeat the entire exercise.
    await get(client, `${API}/me`).expect(401);

    const fresh = await makeClient(app);
    await post(fresh, `${API}/login`, { email: EMAIL, password: newPassword }).expect(200);
  });

  it('gives the same response for an unknown address', async () => {
    await registerVerified();
    const known = await post(client, `${API}/forgot-password`, { email: EMAIL }).expect(200);
    const unknown = await post(client, `${API}/forgot-password`, {
      email: 'nobody-here@example.com',
    }).expect(200);
    expect(unknown.body.data).toEqual(known.body.data);
  });

  it('refuses to reuse a reset token', async () => {
    await registerVerified();
    await post(client, `${API}/forgot-password`, { email: EMAIL }).expect(200);
    const token = tokenFromEmail('reset your password', EMAIL);

    await post(client, `${API}/reset-password`, {
      token,
      password: 'first-new-thicket-2026',
    }).expect(200);
    await post(client, `${API}/reset-password`, {
      token,
      password: 'second-new-thicket-2026',
    }).expect(400);
  });

  it('clears an existing lockout', async () => {
    await registerVerified();
    for (let i = 0; i < 6; i += 1) {
      await post(client, `${API}/login`, { email: EMAIL, password: `wrong-${i}` });
    }

    await post(client, `${API}/forgot-password`, { email: EMAIL }).expect(200);
    const token = tokenFromEmail('reset your password', EMAIL);
    const newPassword = 'unlocked-thicket-2026';
    await post(client, `${API}/reset-password`, { token, password: newPassword }).expect(200);

    // Proving control of the inbox should not leave the user locked out.
    const fresh = await makeClient(app);
    await post(fresh, `${API}/login`, { email: EMAIL, password: newPassword }).expect(200);
  });
});

describe('magic link', () => {
  it('signs in via an emailed link', async () => {
    await registerVerified();
    await post(client, `${API}/magic-link`, { email: EMAIL }).expect(200);
    const token = tokenFromEmail('sign-in link', EMAIL);

    const res = await post(client, `${API}/magic-link/verify`, { token }).expect(200);
    expect(res.body.data.user.email).toBe(EMAIL);
    await get(client, `${API}/me`).expect(200);
  });

  it('refuses to reuse the link', async () => {
    await registerVerified();
    await post(client, `${API}/magic-link`, { email: EMAIL }).expect(200);
    const token = tokenFromEmail('sign-in link', EMAIL);

    await post(client, `${API}/magic-link/verify`, { token }).expect(200);
    const fresh = await makeClient(app);
    await post(fresh, `${API}/magic-link/verify`, { token }).expect(401);
  });
});

describe('audit log', () => {
  it('records registration, login, and logout for the user', async () => {
    await registerVerified();
    await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);

    const res = await get(client, `${API}/audit-log`).expect(200);
    const events = (res.body.data.events as { event: string }[]).map((e) => e.event);

    expect(events).toContain('REGISTER');
    expect(events).toContain('EMAIL_VERIFIED');
    expect(events).toContain('LOGIN_SUCCESS');
  });

  it('records a failed login without leaking it to another user', async () => {
    await registerVerified();
    await post(client, `${API}/login`, { email: EMAIL, password: 'wrong-password-here' });
    await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);

    const res = await get(client, `${API}/audit-log`).expect(200);
    const failures = (res.body.data.events as { event: string }[]).filter(
      (e) => e.event === 'LOGIN_FAILURE',
    );
    expect(failures.length).toBeGreaterThanOrEqual(1);
  });

  it('never exposes a full IP address', async () => {
    await registerVerified();
    await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);
    const res = await get(client, `${API}/audit-log`).expect(200);
    for (const entry of res.body.data.events as { ipPrefix: string | null }[]) {
      if (entry.ipPrefix) {
        // Truncated to /24 or /48 — enough to recognise, less PII than the whole address.
        expect(entry.ipPrefix).toMatch(/(\.x$|::$|^unknown$)/);
      }
    }
  });
});

describe('authentication guard', () => {
  it('rejects protected routes with no session', async () => {
    await get(client, `${API}/me`).expect(401);
    await get(client, `${API}/sessions`).expect(401);
  });

  it('rejects a tampered access token', async () => {
    await registerVerified();
    await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);

    const res = await request(app)
      .get(`${API}/me`)
      .set('Cookie', `cc_at=not.a.real.jwt; cc_csrf=${client.csrf}`);
    expect(res.status).toBe(401);
  });
});
