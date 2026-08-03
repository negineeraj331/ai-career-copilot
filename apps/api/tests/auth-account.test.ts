import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { closeDatabase, prisma } from '../src/core/db/prisma.js';
import { closeRedis } from '../src/core/redis/client.js';
import {
  API,
  STRONG_PASSWORD,
  type Client,
  emailWasSent,
  get,
  makeClient,
  post,
  resetAuthState,
  testMailer,
  tokenFromEmail,
} from './helpers/auth.js';

/**
 * Account-management flows that the main auth suite does not reach: changing a
 * password while signed in, signing out everywhere, and re-requesting a
 * verification email. Each is a real thing a user does and each had no test.
 */

let app: Express;
let client: Client;

/**
 * A fresh address per test — see auth-mfa.test.ts for the reasoning. Nothing to
 * inherit means test ordering cannot affect the result.
 */
const EMAIL_PREFIX = 'account-';
let EMAIL = '';

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  EMAIL = `${EMAIL_PREFIX}${randomUUID()}@example.com`;
  await resetAuthState([EMAIL]);
  client = await makeClient(app);
});

afterAll(async () => {
  await prisma().user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX } } });
  await Promise.all([closeDatabase(), closeRedis()]);
});

async function signedIn(): Promise<Client> {
  await post(client, `${API}/register`, { email: EMAIL, password: STRONG_PASSWORD }).expect(201);
  await post(client, `${API}/verify-email`, {
    token: tokenFromEmail('verify your email', EMAIL),
  }).expect(200);
  await post(client, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);
  return client;
}

describe('change password', () => {
  const NEW_PASSWORD = 'replacement-quarry-88-vault';

  it('requires the current password', async () => {
    const c = await signedIn();
    await post(c, `${API}/change-password`, {
      currentPassword: 'not-the-current-one',
      newPassword: NEW_PASSWORD,
    }).expect(401);
  });

  it('changes the password and lets the new one sign in', async () => {
    const c = await signedIn();
    await post(c, `${API}/change-password`, {
      currentPassword: STRONG_PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(200);

    const fresh = await makeClient(app);
    await post(fresh, `${API}/login`, { email: EMAIL, password: NEW_PASSWORD }).expect(200);
    await post(fresh, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(401);
  });

  it('keeps the current session alive but ends the others', async () => {
    const first = await signedIn();

    const second = await makeClient(app);
    await post(second, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);
    await get(second, `${API}/me`).expect(200);

    await post(first, `${API}/change-password`, {
      currentPassword: STRONG_PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(200);

    // Evict everyone else without logging the user out of the tab they are in.
    await get(first, `${API}/me`).expect(200);
    await get(second, `${API}/me`).expect(401);
  });

  it('rejects a weak new password', async () => {
    const c = await signedIn();
    await post(c, `${API}/change-password`, {
      currentPassword: STRONG_PASSWORD,
      newPassword: 'password123456',
    }).expect(400);
  });

  it('notifies the user by email', async () => {
    const c = await signedIn();
    testMailer().clear();
    await post(c, `${API}/change-password`, {
      currentPassword: STRONG_PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(200);
    // A password change the account owner did not make must be visible to them.
    expect(emailWasSent('your password was changed', EMAIL)).toBe(true);
  });

  it('requires authentication', async () => {
    const anon = await makeClient(app);
    await post(anon, `${API}/change-password`, {
      currentPassword: 'x',
      newPassword: 'y',
    }).expect(401);
  });
});

describe('sign out everywhere', () => {
  it('ends every session including the current one', async () => {
    const first = await signedIn();
    const second = await makeClient(app);
    await post(second, `${API}/login`, { email: EMAIL, password: STRONG_PASSWORD }).expect(200);

    await post(first, `${API}/logout-all`).expect(204);

    await get(first, `${API}/me`).expect(401);
    await get(second, `${API}/me`).expect(401);

    const user = await prisma().user.findUnique({ where: { email: EMAIL } });
    expect(
      await prisma().deviceSession.count({ where: { userId: user?.id, revokedAt: null } }),
    ).toBe(0);
  });

  it('is recorded in the audit log', async () => {
    const c = await signedIn();
    await post(c, `${API}/logout-all`).expect(204);

    const user = await prisma().user.findUnique({ where: { email: EMAIL } });
    expect(
      await prisma().auditLog.count({ where: { userId: user?.id, event: 'LOGOUT_ALL' } }),
    ).toBe(1);
  });
});

describe('resend verification', () => {
  it('sends a fresh link for an unverified account', async () => {
    await post(client, `${API}/register`, { email: EMAIL, password: STRONG_PASSWORD }).expect(201);
    testMailer().clear();

    await post(client, `${API}/resend-verification`, { email: EMAIL }).expect(200);
    expect(emailWasSent('verify your email', EMAIL)).toBe(true);
  });

  it('invalidates the previous link', async () => {
    await post(client, `${API}/register`, { email: EMAIL, password: STRONG_PASSWORD }).expect(201);
    const firstToken = tokenFromEmail('verify your email', EMAIL);

    await post(client, `${API}/resend-verification`, { email: EMAIL }).expect(200);
    const secondToken = tokenFromEmail('verify your email', EMAIL);
    expect(secondToken).not.toBe(firstToken);

    // Requesting a new link retires the old one — otherwise a link from an
    // abandoned email stays live for its whole TTL.
    await post(client, `${API}/verify-email`, { token: firstToken }).expect(400);
    await post(client, `${API}/verify-email`, { token: secondToken }).expect(200);
  });

  it('says nothing about whether the address exists', async () => {
    const known = await post(client, `${API}/resend-verification`, { email: EMAIL }).expect(200);
    const unknown = await post(client, `${API}/resend-verification`, {
      email: 'nobody-at-all@example.com',
    }).expect(200);
    expect(unknown.body.data).toEqual(known.body.data);
  });

  it('sends nothing for an already-verified account', async () => {
    await signedIn();
    testMailer().clear();

    await post(client, `${API}/resend-verification`, { email: EMAIL }).expect(200);
    expect(emailWasSent('verify your email', EMAIL)).toBe(false);
  });
});
