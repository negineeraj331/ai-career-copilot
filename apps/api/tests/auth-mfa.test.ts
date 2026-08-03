import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateSync } from 'otplib';
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
  tokenFromEmail,
} from './helpers/auth.js';

let app: Express;
let client: Client;

const EMAIL = 'mfa-test@example.com';
const MANAGED = [EMAIL];

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await resetAuthState(MANAGED);
  client = await makeClient(app);
});

afterAll(async () => {
  await resetAuthState(MANAGED);
  await Promise.all([closeDatabase(), closeRedis()]);
});

async function signedInClient(): Promise<Client> {
  await post(client, `${API}/register`, { email: EMAIL, password: STRONG_PASSWORD }).expect(201);
  await post(client, `${API}/verify-email`, { token: tokenFromEmail('verify your email') }).expect(
    200,
  );
  await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);
  return client;
}

/** Completes enrolment and returns the secret plus the recovery codes. */
async function enrolMfa(c: Client): Promise<{ secret: string; recoveryCodes: string[] }> {
  const setup = await post(c, `${API}/mfa/setup`).expect(200);
  const secret = setup.body.data.secret as string;

  const confirm = await post(c, `${API}/mfa/confirm`, {
    code: generateSync({ secret }),
  }).expect(200);

  return { secret, recoveryCodes: confirm.body.data.recoveryCodes as string[] };
}

describe('MFA enrolment', () => {
  it('returns a secret and an otpauth URI', async () => {
    const c = await signedInClient();
    const res = await post(c, `${API}/mfa/setup`).expect(200);

    expect(res.body.data.secret).toMatch(/^[A-Z2-7]+$/); // base32
    expect(res.body.data.otpauthUrl).toContain('otpauth://totp/');
    expect(res.body.data.otpauthUrl).toContain('Career%20Copilot');
  });

  it('does not enable MFA until enrolment is confirmed', async () => {
    const c = await signedInClient();
    await post(c, `${API}/mfa/setup`).expect(200);

    // A user who scans the QR then closes the tab must not be locked out by a
    // second factor they never finished setting up.
    const user = await prisma().user.findUnique({ where: { email: EMAIL } });
    expect(user?.mfaEnabled).toBe(false);
  });

  it('rejects a wrong confirmation code', async () => {
    const c = await signedInClient();
    await post(c, `${API}/mfa/setup`).expect(200);
    await post(c, `${API}/mfa/confirm`, { code: '000000' }).expect(409);

    const user = await prisma().user.findUnique({ where: { email: EMAIL } });
    expect(user?.mfaEnabled).toBe(false);
  });

  it('enables MFA and issues ten recovery codes exactly once', async () => {
    const c = await signedInClient();
    const { recoveryCodes } = await enrolMfa(c);

    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const code of recoveryCodes) {
      // Unambiguous alphabet: no 0/O/1/I/L, because these get transcribed by
      // hand at exactly the moment the user has lost their phone.
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    }

    const user = await prisma().user.findUnique({ where: { email: EMAIL } });
    expect(user?.mfaEnabled).toBe(true);
  });

  it('stores the TOTP secret encrypted, never in plaintext', async () => {
    const c = await signedInClient();
    const { secret } = await enrolMfa(c);

    const credential = await prisma().mfaCredential.findFirst({
      where: { user: { email: EMAIL } },
    });
    expect(credential?.secretEnc).toBeTruthy();
    // A database read must not hand over the second factor along with the first.
    expect(credential?.secretEnc).not.toContain(secret);
    expect(credential?.secretEnc?.split('.')).toHaveLength(3); // iv.ciphertext.tag
  });

  it('stores recovery codes only as hashes', async () => {
    const c = await signedInClient();
    const { recoveryCodes } = await enrolMfa(c);

    const credential = await prisma().mfaCredential.findFirst({
      where: { user: { email: EMAIL } },
    });
    for (const stored of credential?.recoveryCodeHashes ?? []) {
      expect(stored.startsWith('$argon2id$')).toBe(true);
      expect(recoveryCodes.some((c2) => stored.includes(c2))).toBe(false);
    }
  });
});

describe('login with MFA enabled', () => {
  it('stops at a challenge and issues no session cookies', async () => {
    const c = await signedInClient();
    await enrolMfa(c);
    await post(c, `${API}/logout`).expect(204);

    const fresh = await makeClient(app);
    const res = await post(fresh, `${API}/login`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
    }).expect(200);

    expect(res.body.data.mfaRequired).toBe(true);
    expect(res.body.data.mfaToken).toBeTruthy();

    // The password is only the first factor — no session yet.
    const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
    expect(cookies.find((k) => k.startsWith('cc_at='))).toBeUndefined();
    await get(fresh, `${API}/me`).expect(401);
  });

  it('completes sign-in with a valid TOTP code', async () => {
    const c = await signedInClient();
    const { secret } = await enrolMfa(c);
    await post(c, `${API}/logout`).expect(204);

    const fresh = await makeClient(app);
    const login = await post(fresh, `${API}/login`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
    }).expect(200);

    await post(fresh, `${API}/mfa/verify`, {
      mfaToken: login.body.data.mfaToken,
      code: generateSync({ secret }),
    }).expect(200);

    await get(fresh, `${API}/me`).expect(200);
  });

  it('rejects a wrong TOTP code', async () => {
    const c = await signedInClient();
    await enrolMfa(c);
    await post(c, `${API}/logout`).expect(204);

    const fresh = await makeClient(app);
    const login = await post(fresh, `${API}/login`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
    }).expect(200);

    await post(fresh, `${API}/mfa/verify`, {
      mfaToken: login.body.data.mfaToken,
      code: '000000',
    }).expect(401);

    await get(fresh, `${API}/me`).expect(401);
  });

  it('refuses an MFA challenge token as an access token', async () => {
    const c = await signedInClient();
    await enrolMfa(c);
    await post(c, `${API}/logout`).expect(204);

    const fresh = await makeClient(app);
    const login = await post(fresh, `${API}/login`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
    }).expect(200);

    // Distinct audience is what stops the half-authenticated token being
    // replayed as a session cookie.
    const res = await fresh.agent
      .get(`${API}/me`)
      .set('Cookie', `cc_at=${login.body.data.mfaToken as string}; cc_csrf=${fresh.csrf}`);
    expect(res.status).toBe(401);
  });

  it('requires exactly one of a code or a recovery code', async () => {
    const c = await signedInClient();
    const { secret, recoveryCodes } = await enrolMfa(c);
    await post(c, `${API}/logout`).expect(204);

    const fresh = await makeClient(app);
    const login = await post(fresh, `${API}/login`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
    }).expect(200);
    const mfaToken = login.body.data.mfaToken as string;

    await post(fresh, `${API}/mfa/verify`, { mfaToken }).expect(400);
    await post(fresh, `${API}/mfa/verify`, {
      mfaToken,
      code: generateSync({ secret }),
      recoveryCode: recoveryCodes[0],
    }).expect(400);
  });
});

describe('recovery codes', () => {
  it('signs in with a recovery code and consumes it', async () => {
    const c = await signedInClient();
    const { recoveryCodes } = await enrolMfa(c);
    await post(c, `${API}/logout`).expect(204);

    const fresh = await makeClient(app);
    const login = await post(fresh, `${API}/login`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
    }).expect(200);

    await post(fresh, `${API}/mfa/verify`, {
      mfaToken: login.body.data.mfaToken,
      recoveryCode: recoveryCodes[0],
    }).expect(200);

    await get(fresh, `${API}/me`).expect(200);

    const credential = await prisma().mfaCredential.findFirst({
      where: { user: { email: EMAIL } },
    });
    expect(credential?.recoveryCodeHashes).toHaveLength(9);
    expect(emailWasSent('recovery code was used')).toBe(true);
  });

  it('refuses to reuse a spent recovery code', async () => {
    const c = await signedInClient();
    const { recoveryCodes } = await enrolMfa(c);
    await post(c, `${API}/logout`).expect(204);

    const first = await makeClient(app);
    const login1 = await post(first, `${API}/login`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
    }).expect(200);
    await post(first, `${API}/mfa/verify`, {
      mfaToken: login1.body.data.mfaToken,
      recoveryCode: recoveryCodes[0],
    }).expect(200);

    const second = await makeClient(app);
    const login2 = await post(second, `${API}/login`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
    }).expect(200);
    // A code that still works after use is just a weaker password.
    await post(second, `${API}/mfa/verify`, {
      mfaToken: login2.body.data.mfaToken,
      recoveryCode: recoveryCodes[0],
    }).expect(401);
  });

  it('accepts a recovery code regardless of case or spacing', async () => {
    const c = await signedInClient();
    const { recoveryCodes } = await enrolMfa(c);
    await post(c, `${API}/logout`).expect(204);

    const fresh = await makeClient(app);
    const login = await post(fresh, `${API}/login`, {
      email: EMAIL,
      password: STRONG_PASSWORD,
    }).expect(200);

    // These get typed by hand off a printout.
    await post(fresh, `${API}/mfa/verify`, {
      mfaToken: login.body.data.mfaToken,
      recoveryCode: ` ${recoveryCodes[0]?.toLowerCase() ?? ''} `,
    }).expect(200);
  });
});

describe('disabling MFA', () => {
  it('requires the current password', async () => {
    const c = await signedInClient();
    await enrolMfa(c);

    // Removing a second factor must cost more than a click on a machine
    // somebody walked away from.
    await del(c, `${API}/mfa`, { password: 'not-the-right-password' }).expect(401);

    const user = await prisma().user.findUnique({ where: { email: EMAIL } });
    expect(user?.mfaEnabled).toBe(true);
  });

  it('disables MFA with the correct password and notifies the user', async () => {
    const c = await signedInClient();
    await enrolMfa(c);

    await del(c, `${API}/mfa`, { password: STRONG_PASSWORD }).expect(204);

    const user = await prisma().user.findUnique({ where: { email: EMAIL } });
    expect(user?.mfaEnabled).toBe(false);
    expect(await prisma().mfaCredential.count({ where: { userId: user?.id } })).toBe(0);
    expect(emailWasSent('multi-factor authentication was turned off')).toBe(true);
  });
});

describe('magic link with MFA enabled', () => {
  it('still requires the second factor', async () => {
    const c = await signedInClient();
    const { secret } = await enrolMfa(c);
    await post(c, `${API}/logout`).expect(204);

    const fresh = await makeClient(app);
    await post(fresh, `${API}/magic-link`, { email: EMAIL }).expect(200);
    const token = tokenFromEmail('sign-in link');

    const res = await post(fresh, `${API}/magic-link/verify`, { token }).expect(200);
    // Otherwise emailing yourself a link would be a way around MFA entirely.
    expect(res.body.data.mfaRequired).toBe(true);
    await get(fresh, `${API}/me`).expect(401);

    await post(fresh, `${API}/mfa/verify`, {
      mfaToken: res.body.data.mfaToken,
      code: generateSync({ secret }),
    }).expect(200);
    await get(fresh, `${API}/me`).expect(200);
  });
});
