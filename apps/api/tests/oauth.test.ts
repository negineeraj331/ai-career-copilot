import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { closeDatabase, prisma } from '../src/core/db/prisma.js';
import { closeRedis, redis } from '../src/core/redis/client.js';
import { hashPassword } from '../src/modules/auth/password.service.js';
import { registerAdapter } from '../src/modules/auth/oauth/oauth.service.js';
import type { OAuthProfile, OAuthProviderAdapter } from '../src/modules/auth/oauth/oauth.types.js';
import {
  API,
  STRONG_PASSWORD,
  type Client,
  del,
  get,
  makeClient,
  post,
  resetAuthState,
} from './helpers/auth.js';

/**
 * OAuth flows against a stub provider.
 *
 * The adapter interface exists precisely so this is possible: no test contacts
 * Google or GitHub, so the suite stays deterministic, free, and runnable
 * offline — while still exercising the parts that are ours, which is where the
 * security decisions live (state single-use, verified-email gating, account
 * linking, and the unlink guard).
 */

let app: Express;
let client: Client;

const OAUTH_EMAIL = 'oauth-user@example.com';
const EXISTING_EMAIL = 'oauth-existing@example.com';
const MANAGED = [OAUTH_EMAIL, EXISTING_EMAIL];

/** Controls what the stub returns, per test. */
const stub = {
  profile: {
    providerAccountId: 'stub-account-1',
    email: OAUTH_EMAIL,
    emailVerified: true,
    name: 'OAuth User',
  } as OAuthProfile,
  exchangeCalls: [] as { code: string; codeVerifier?: string }[],
};

const stubProvider: OAuthProviderAdapter = {
  id: 'GOOGLE',
  supportsPkce: true,
  isConfigured: () => true,
  authorizationUrl: ({ state, codeChallenge, redirectUri }) =>
    `https://stub.example/auth?state=${state}&challenge=${codeChallenge ?? ''}&redirect=${encodeURIComponent(redirectUri)}`,
  exchangeCode: ({ code, codeVerifier }) => {
    stub.exchangeCalls.push({ code, codeVerifier });
    return Promise.resolve({ accessToken: 'stub-access-token' });
  },
  fetchProfile: () => Promise.resolve(stub.profile),
};

beforeAll(() => {
  app = createApp();
  registerAdapter(stubProvider);
});

beforeEach(async () => {
  await resetAuthState(MANAGED);
  stub.exchangeCalls = [];
  stub.profile = {
    providerAccountId: 'stub-account-1',
    email: OAUTH_EMAIL,
    emailVerified: true,
    name: 'OAuth User',
  };
  client = await makeClient(app);
});

afterAll(async () => {
  await resetAuthState(MANAGED);
  await Promise.all([closeDatabase(), closeRedis()]);
});

/**
 * Assert a 302 and surface the real status and body when it is not.
 *
 * A bare `.expect(302)` reports only "expected 302, got 429", which does not
 * say *why*. These tests share one rate-limit bucket keyed on 127.0.0.1, so a
 * limiter trip is the most likely non-302 — and this turns that from a puzzle
 * into a one-line diagnosis. Added after one unreproducible failure here.
 */
function expectRedirect(res: {
  status: number;
  body?: unknown;
  headers: Record<string, string>;
}): string {
  if (res.status !== 302) {
    throw new Error(
      `Expected 302 redirect, got ${res.status}. Body: ${JSON.stringify(res.body ?? {})}`,
    );
  }
  return res.headers.location ?? '';
}

/** Runs the redirect step and returns the `state` the server issued. */
async function beginFlow(): Promise<string> {
  const res = await client.agent.get(`${API}/oauth/google`).expect(302);
  const location = res.headers.location as string;
  return new URL(location).searchParams.get('state') ?? '';
}

describe('authorization redirect', () => {
  it('redirects to the provider with state and a PKCE challenge', async () => {
    const res = await client.agent.get(`${API}/oauth/google`).expect(302);
    const url = new URL(res.headers.location as string);

    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('challenge')).toBeTruthy();
    // S256 of a 32-byte verifier is 43 base64url characters.
    expect(url.searchParams.get('challenge')).toHaveLength(43);
  });

  it('never sends the verifier itself to the provider', async () => {
    const res = await client.agent.get(`${API}/oauth/google`).expect(302);
    const location = res.headers.location as string;
    const state = new URL(location).searchParams.get('state') ?? '';

    const stored = await redis().get(`cc:oauth:state:${state}`);
    const verifier = (JSON.parse(stored ?? '{}') as { codeVerifier?: string }).codeVerifier;

    expect(verifier).toBeTruthy();
    // The whole point of PKCE: the challenge travels, the verifier does not.
    expect(location).not.toContain(verifier as string);
  });

  it('rejects an unknown provider at the route boundary', async () => {
    // 400, not 404: the Zod enum on the path parameter rejects it before the
    // service is reached. Validating at the edge is the point — an unknown
    // provider never becomes a lookup.
    await client.agent.get(`${API}/oauth/myspace`).expect(400);
  });

  it('404s for a provider with no credentials configured', async () => {
    // GitHub has no client id in the test environment.
    const res = await client.agent.get(`${API}/oauth/github`);
    expect(res.status).toBe(404);
  });
});

describe('callback', () => {
  it('creates a verified account and signs the user in', async () => {
    const state = await beginFlow();

    const res = await client.agent
      .get(`${API}/oauth/google/callback?code=stub-code&state=${state}`)
      .expect(302);

    expect(res.headers.location).toContain('/dashboard');

    const user = await prisma().user.findUnique({ where: { email: OAUTH_EMAIL } });
    expect(user).not.toBeNull();
    // The provider verified the address, so no verification email of our own.
    expect(user?.emailVerifiedAt).not.toBeNull();
    expect(user?.passwordHash).toBeNull();

    await get(client, `${API}/me`).expect(200);
  });

  it('passes the stored PKCE verifier to the token exchange', async () => {
    const state = await beginFlow();
    await client.agent
      .get(`${API}/oauth/google/callback?code=stub-code&state=${state}`)
      .expect(302);

    expect(stub.exchangeCalls).toHaveLength(1);
    expect(stub.exchangeCalls[0]?.codeVerifier).toBeTruthy();
  });

  it('refuses a state that has already been used', async () => {
    const state = await beginFlow();
    await client.agent
      .get(`${API}/oauth/google/callback?code=stub-code&state=${state}`)
      .expect(302);

    // Single use, enforced by an atomic GETDEL. A replayable state is the
    // whole CSRF hole this parameter exists to close.
    const replay = await request(app).get(
      `${API}/oauth/google/callback?code=stub-code&state=${state}`,
    );
    expect(expectRedirect(replay)).toContain('error=unauthenticated');
  });

  it('refuses a forged state', async () => {
    const res = await request(app).get(
      `${API}/oauth/google/callback?code=stub-code&state=not-a-real-state`,
    );
    expect(expectRedirect(res)).toContain('error=unauthenticated');
  });

  it('refuses a callback with no state at all', async () => {
    const res = await request(app).get(`${API}/oauth/google/callback?code=stub-code`);
    expect(expectRedirect(res)).toContain('error=invalid_callback');
  });

  it('redirects with a code when the user declines at the provider', async () => {
    const res = await request(app).get(`${API}/oauth/google/callback?error=access_denied&state=x`);
    // A dead-end JSON error page is no way to treat someone in a browser tab.
    expect(expectRedirect(res)).toContain('error=provider_denied');
  });

  it('signs an existing OAuth user back in without duplicating the account', async () => {
    const first = await beginFlow();
    await client.agent.get(`${API}/oauth/google/callback?code=c1&state=${first}`).expect(302);

    const second = await makeClient(app);
    const res2 = await second.agent.get(`${API}/oauth/google`).expect(302);
    const state2 = new URL(res2.headers.location as string).searchParams.get('state') ?? '';
    await second.agent.get(`${API}/oauth/google/callback?code=c2&state=${state2}`).expect(302);

    expect(await prisma().user.count({ where: { email: OAUTH_EMAIL } })).toBe(1);
    expect(await prisma().oAuthAccount.count({ where: { user: { email: OAUTH_EMAIL } } })).toBe(1);
  });

  it('still recognises the user when their provider email changes', async () => {
    const first = await beginFlow();
    await client.agent.get(`${API}/oauth/google/callback?code=c1&state=${first}`).expect(302);
    const original = await prisma().user.findUnique({ where: { email: OAUTH_EMAIL } });

    // Same provider account id, different address — the link keys on the id.
    stub.profile = { ...stub.profile, email: 'renamed@example.com' };

    const second = await makeClient(app);
    const res2 = await second.agent.get(`${API}/oauth/google`).expect(302);
    const state2 = new URL(res2.headers.location as string).searchParams.get('state') ?? '';
    await second.agent.get(`${API}/oauth/google/callback?code=c2&state=${state2}`).expect(302);

    const me = await get(second, `${API}/me`).expect(200);
    expect(me.body.data.user.id).toBe(original?.id);
    expect(await prisma().user.count({ where: { email: 'renamed@example.com' } })).toBe(0);
  });
});

describe('account linking on the verified-email path', () => {
  async function createPasswordUser(email: string): Promise<string> {
    const user = await prisma().user.create({
      data: {
        email,
        name: 'Existing User',
        passwordHash: await hashPassword(STRONG_PASSWORD),
        emailVerifiedAt: new Date(),
      },
    });
    return user.id;
  }

  it('links to an existing account when the provider verified the email', async () => {
    const userId = await createPasswordUser(EXISTING_EMAIL);
    stub.profile = { ...stub.profile, email: EXISTING_EMAIL, emailVerified: true };

    const state = await beginFlow();
    await client.agent.get(`${API}/oauth/google/callback?code=c&state=${state}`).expect(302);

    expect(await prisma().user.count({ where: { email: EXISTING_EMAIL } })).toBe(1);
    expect(await prisma().oAuthAccount.count({ where: { userId } })).toBe(1);
  });

  it('refuses to link when the provider has NOT verified the email', async () => {
    await createPasswordUser(EXISTING_EMAIL);
    stub.profile = { ...stub.profile, email: EXISTING_EMAIL, emailVerified: false };

    const state = await beginFlow();
    const res = await client.agent
      .get(`${API}/oauth/google/callback?code=c&state=${state}`)
      .expect(302);

    // Otherwise anyone able to register victim@example.com at an identity
    // provider could take over the matching account here.
    expect(res.headers.location).toContain('error=conflict');
    expect(await prisma().oAuthAccount.count({ where: { user: { email: EXISTING_EMAIL } } })).toBe(
      0,
    );
  });

  it('refuses to create a new account from an unverified provider email', async () => {
    stub.profile = { ...stub.profile, emailVerified: false };

    const state = await beginFlow();
    const res = await client.agent
      .get(`${API}/oauth/google/callback?code=c&state=${state}`)
      .expect(302);

    expect(res.headers.location).toContain('error=unauthenticated');
    expect(await prisma().user.count({ where: { email: OAUTH_EMAIL } })).toBe(0);
  });
});

describe('unlinking', () => {
  it('lists linked providers', async () => {
    const state = await beginFlow();
    await client.agent.get(`${API}/oauth/google/callback?code=c&state=${state}`).expect(302);

    const res = await get(client, `${API}/oauth`).expect(200);
    expect(res.body.data.providers).toEqual(['GOOGLE']);
  });

  it('refuses to unlink the only way to sign in', async () => {
    const state = await beginFlow();
    await client.agent.get(`${API}/oauth/google/callback?code=c&state=${state}`).expect(302);

    // The account has no password: unlinking would leave it unreachable by
    // anyone, which is a support ticket our own API created.
    const res = await del(client, `${API}/oauth/google`);
    expect(res.status).toBe(409);
    expect(await prisma().oAuthAccount.count({ where: { user: { email: OAUTH_EMAIL } } })).toBe(1);
  });

  it('allows unlinking once a password exists', async () => {
    const state = await beginFlow();
    await client.agent.get(`${API}/oauth/google/callback?code=c&state=${state}`).expect(302);

    await prisma().user.update({
      where: { email: OAUTH_EMAIL },
      data: { passwordHash: await hashPassword(STRONG_PASSWORD) },
    });

    await del(client, `${API}/oauth/google`).expect(204);
    expect(await prisma().oAuthAccount.count({ where: { user: { email: OAUTH_EMAIL } } })).toBe(0);
  });

  it('404s when unlinking a provider that is not linked', async () => {
    const state = await beginFlow();
    await client.agent.get(`${API}/oauth/google/callback?code=c&state=${state}`).expect(302);
    await del(client, `${API}/oauth/github`).expect(404);
  });

  it('requires authentication to unlink', async () => {
    const anon = await makeClient(app);
    await del(anon, `${API}/oauth/google`).expect(401);
  });
});

describe('MFA interaction', () => {
  it('stops at the second factor instead of signing in outright', async () => {
    const state = await beginFlow();
    await client.agent.get(`${API}/oauth/google/callback?code=c&state=${state}`).expect(302);

    await prisma().user.update({ where: { email: OAUTH_EMAIL }, data: { mfaEnabled: true } });

    const second = await makeClient(app);
    const res2 = await second.agent.get(`${API}/oauth/google`).expect(302);
    const state2 = new URL(res2.headers.location as string).searchParams.get('state') ?? '';
    const cb = await second.agent
      .get(`${API}/oauth/google/callback?code=c2&state=${state2}`)
      .expect(302);

    // Otherwise "sign in with Google" would be a way around the second factor.
    expect(cb.headers.location).toContain('/auth/mfa');
    await get(second, `${API}/me`).expect(401);
  });
});

describe('linking while signed in', () => {
  it('binds the provider to the signed-in account, not a new one', async () => {
    const userId = await prisma()
      .user.create({
        data: {
          email: EXISTING_EMAIL,
          passwordHash: await hashPassword(STRONG_PASSWORD),
          emailVerifiedAt: new Date(),
        },
      })
      .then((u) => u.id);

    await post(client, `${API}/login`, { email: EXISTING_EMAIL, password: STRONG_PASSWORD }).expect(
      200,
    );

    const start = await post(client, `${API}/oauth/google/link`).expect(200);
    const state =
      new URL(start.body.data.authorizationUrl as string).searchParams.get('state') ?? '';

    // A different address on the provider side — linking must follow the
    // signed-in session, not the email.
    stub.profile = { ...stub.profile, email: OAUTH_EMAIL, emailVerified: true };

    const cb = await client.agent
      .get(`${API}/oauth/google/callback?code=c&state=${state}`)
      .expect(302);
    expect(cb.headers.location).toContain('linked=google');

    expect(await prisma().oAuthAccount.count({ where: { userId } })).toBe(1);
    expect(await prisma().user.count({ where: { email: OAUTH_EMAIL } })).toBe(0);
  });
});
