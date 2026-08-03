import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv, resetEnvCache } from '../src/config/env.js';
import { githubProvider } from '../src/modules/auth/oauth/github.provider.js';
import { googleProvider } from '../src/modules/auth/oauth/google.provider.js';

/**
 * Unit tests for the real provider adapters, with `fetch` mocked.
 *
 * The OAuth integration tests deliberately use a stub adapter so no test
 * contacts Google or GitHub — but that left the actual adapters almost
 * untested, and they are where the provider-specific traps live: GitHub
 * answering 200 with an error body, and its profile email being null whenever
 * the user keeps it private (the default). Those are exactly the paths that
 * break in production and never in a stub.
 */

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  process.env.GOOGLE_CLIENT_ID = 'google-id';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.GITHUB_CLIENT_ID = 'github-id';
  process.env.GITHUB_CLIENT_SECRET = 'github-secret';
  // The env is parsed once and cached, so mutating process.env after boot
  // changes nothing — that is correct for a running service (configuration
  // does not change under it) and simply means a test must reload.
  resetEnvCache();
  loadEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
  resetEnvCache();
});

describe('google provider', () => {
  it('declares PKCE support and includes the S256 challenge', () => {
    expect(googleProvider.supportsPkce).toBe(true);

    const url = new URL(
      googleProvider.authorizationUrl({
        state: 'st',
        codeChallenge: 'chal',
        redirectUri: 'https://api.test/cb',
      }),
    );
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('response_type')).toBe('code');
    // Ask which account rather than silently reusing whichever Google session
    // the browser happens to hold.
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });

  it('omits PKCE parameters when no challenge is supplied', () => {
    const url = new URL(
      googleProvider.authorizationUrl({ state: 'st', redirectUri: 'https://api.test/cb' }),
    );
    expect(url.searchParams.get('code_challenge')).toBeNull();
  });

  it('sends the verifier when exchanging a code', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ access_token: 'tok', expires_in: 3600 }));

    const result = await googleProvider.exchangeCode({
      code: 'c',
      codeVerifier: 'verifier',
      redirectUri: 'https://api.test/cb',
    });

    const body = String((fetchMock.mock.calls[0]?.[1] as RequestInit).body);
    expect(body).toContain('code_verifier=verifier');
    expect(result.accessToken).toBe('tok');
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it('maps the profile and lowercases the email', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        sub: '12345',
        email: 'User@Example.COM',
        email_verified: true,
        name: 'A User',
        picture: 'https://img',
      }),
    );

    const profile = await googleProvider.fetchProfile('tok');
    expect(profile).toMatchObject({
      providerAccountId: '12345',
      email: 'user@example.com',
      emailVerified: true,
    });
  });

  it('reports emailVerified false when Google says so', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ sub: '1', email: 'a@b.com', email_verified: false }),
    );
    await expect(googleProvider.fetchProfile('tok')).resolves.toMatchObject({
      emailVerified: false,
    });
  });

  it('rejects a token response with no access token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid_grant' }));
    await expect(
      googleProvider.exchangeCode({ code: 'c', redirectUri: 'https://api.test/cb' }),
    ).rejects.toThrow();
  });

  it('surfaces a provider outage as a service error, not a crash', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 503));
    await expect(
      googleProvider.exchangeCode({ code: 'c', redirectUri: 'https://api.test/cb' }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('is unconfigured when credentials are absent', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    resetEnvCache();
    loadEnv();
    expect(googleProvider.isConfigured()).toBe(false);
  });
});

describe('github provider', () => {
  it('declares PKCE unsupported and sends no challenge', () => {
    // GitHub OAuth Apps ignore a challenge silently, so claiming support would
    // mean the code and the docs both assert a protection that is not applied.
    expect(githubProvider.supportsPkce).toBe(false);

    const url = new URL(
      githubProvider.authorizationUrl({
        state: 'st',
        codeChallenge: 'chal',
        redirectUri: 'https://api.test/cb',
      }),
    );
    expect(url.searchParams.get('code_challenge')).toBeNull();
    // user:email is required — the public profile frequently has no address.
    expect(url.searchParams.get('scope')).toContain('user:email');
  });

  it('treats a 200 response carrying an error body as a failure', async () => {
    // The trap: GitHub answers 200 with {error: "bad_verification_code"}
    // instead of a 4xx, so checking response.ok alone reads a failure as
    // success and hands an undefined token to the next call.
    fetchMock.mockResolvedValue(jsonResponse({ error: 'bad_verification_code' }));

    await expect(
      githubProvider.exchangeCode({ code: 'bad', redirectUri: 'https://api.test/cb' }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('takes the primary verified address from /user/emails', async () => {
    // user.email is null whenever the address is private, which is the default.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 99, login: 'octocat', email: null }))
      .mockResolvedValueOnce(
        jsonResponse([
          { email: 'secondary@example.com', primary: false, verified: true },
          { email: 'Primary@Example.com', primary: true, verified: true },
        ]),
      );

    const profile = await githubProvider.fetchProfile('tok');
    expect(profile.email).toBe('primary@example.com');
    expect(profile.emailVerified).toBe(true);
    expect(profile.providerAccountId).toBe('99');
  });

  it('falls back to any verified address when none is marked primary', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 7, login: 'o' })).mockResolvedValueOnce(
      jsonResponse([
        { email: 'unverified@example.com', primary: true, verified: false },
        { email: 'verified@example.com', primary: false, verified: true },
      ]),
    );

    const profile = await githubProvider.fetchProfile('tok');
    // Never the unverified one, even though it is flagged primary.
    expect(profile.email).toBe('verified@example.com');
  });

  it('refuses an account with no usable email at all', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 7, login: 'o', email: null }))
      .mockResolvedValueOnce(jsonResponse([]));

    await expect(githubProvider.fetchProfile('tok')).rejects.toThrow(/verified email/i);
  });

  it('sends the User-Agent GitHub requires', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 1, login: 'o' }))
      .mockResolvedValueOnce(jsonResponse([{ email: 'a@b.com', primary: true, verified: true }]));

    await githubProvider.fetchProfile('tok');
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    // GitHub rejects requests without one outright.
    expect(headers['User-Agent']).toBeTruthy();
  });

  it('is unconfigured when credentials are absent', () => {
    delete process.env.GITHUB_CLIENT_SECRET;
    resetEnvCache();
    loadEnv();
    expect(githubProvider.isConfigured()).toBe(false);
  });
});
