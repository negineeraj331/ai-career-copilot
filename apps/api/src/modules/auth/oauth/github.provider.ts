import { env } from '../../../config/env.js';
import { ServiceUnavailableError, UnauthenticatedError } from '../../../core/errors/app-error.js';
import type { OAuthProfile, OAuthProviderAdapter, TokenResponse } from './oauth.types.js';

const AUTH_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const EMAILS_URL = 'https://api.github.com/user/emails';

const TIMEOUT_MS = 8_000;

interface GitHubUser {
  id?: number;
  login?: string;
  name?: string;
  email?: string | null;
  avatar_url?: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

function ghHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects requests without one.
    'User-Agent': 'career-copilot',
  };
}

export const githubProvider: OAuthProviderAdapter = {
  id: 'GITHUB',

  /**
   * GitHub OAuth Apps do not support PKCE.
   *
   * Marked false rather than sending a challenge anyway. GitHub ignores unknown
   * parameters, so a challenge would be silently discarded and the flow would
   * *look* PKCE-protected in our code while having none of the protection —
   * the worst of both. The single-use `state` in Redis is what protects this
   * handshake, and because we hold a client secret and the code is exchanged
   * server-side, PKCE's main threat model (a public client with an
   * interceptable redirect) does not apply here anyway.
   */
  supportsPkce: false,

  isConfigured() {
    return Boolean(env().GITHUB_CLIENT_ID && env().GITHUB_CLIENT_SECRET);
  },

  authorizationUrl({ state, redirectUri }) {
    const params = new URLSearchParams({
      client_id: env().GITHUB_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      // user:email is required: the public profile often has no address at all.
      scope: 'read:user user:email',
      state,
      allow_signup: 'true',
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }): Promise<TokenResponse> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: env().GITHUB_CLIENT_ID,
        client_secret: env().GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) throw new ServiceUnavailableError('GitHub sign-in is unavailable right now.');

    // GitHub answers 200 with `{error: "bad_verification_code"}` rather than a
    // 4xx, so checking response.ok alone would treat a failure as success.
    const json = (await response.json()) as { access_token?: string; error?: string };
    if (json.error || !json.access_token) throw new UnauthenticatedError('GitHub sign-in failed.');

    return { accessToken: json.access_token };
  },

  async fetchProfile(accessToken): Promise<OAuthProfile> {
    const [userRes, emailRes] = await Promise.all([
      fetch(USER_URL, { headers: ghHeaders(accessToken), signal: AbortSignal.timeout(TIMEOUT_MS) }),
      fetch(EMAILS_URL, {
        headers: ghHeaders(accessToken),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    ]);

    if (!userRes.ok) throw new ServiceUnavailableError('Could not read your GitHub profile.');

    const user = (await userRes.json()) as GitHubUser;
    if (!user.id) throw new UnauthenticatedError('GitHub returned an unusable profile.');

    // The profile email is null whenever the user keeps it private, which is
    // the default — so the address has to come from /user/emails, and we take
    // only a primary *verified* one.
    let email: string | undefined;
    let emailVerified = false;

    if (emailRes.ok) {
      const emails = (await emailRes.json()) as GitHubEmail[];
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      if (primary) {
        email = primary.email.toLowerCase();
        emailVerified = true;
      }
    }

    email ??= user.email?.toLowerCase();

    if (!email) {
      throw new UnauthenticatedError(
        'Your GitHub account has no verified email address. Add and verify one, then try again.',
      );
    }

    return {
      providerAccountId: String(user.id),
      email,
      emailVerified,
      name: user.name ?? user.login,
      avatarUrl: user.avatar_url,
    };
  },
};
