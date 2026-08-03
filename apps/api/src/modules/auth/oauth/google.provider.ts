import { env } from '../../../config/env.js';
import { ServiceUnavailableError, UnauthenticatedError } from '../../../core/errors/app-error.js';
import type { OAuthProfile, OAuthProviderAdapter, TokenResponse } from './oauth.types.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

const TIMEOUT_MS = 8_000;

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

async function postForm(url: string, body: URLSearchParams): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    // Every outbound call carries a timeout (TR-04). A provider that hangs must
    // not hold an Express request open indefinitely.
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new ServiceUnavailableError('Google sign-in is unavailable right now.');
  }
  return response.json();
}

export const googleProvider: OAuthProviderAdapter = {
  id: 'GOOGLE',
  supportsPkce: true,

  isConfigured() {
    return Boolean(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);
  },

  authorizationUrl({ state, codeChallenge, redirectUri }) {
    const params = new URLSearchParams({
      client_id: env().GOOGLE_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      // Ask for the account chooser rather than silently reusing whichever
      // Google session the browser happens to hold.
      prompt: 'select_account',
    });

    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, codeVerifier, redirectUri }): Promise<TokenResponse> {
    const body = new URLSearchParams({
      code,
      client_id: env().GOOGLE_CLIENT_ID ?? '',
      client_secret: env().GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });
    if (codeVerifier) body.set('code_verifier', codeVerifier);

    const json = (await postForm(TOKEN_URL, body)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!json.access_token) throw new UnauthenticatedError('Google sign-in failed.');

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
    };
  },

  async fetchProfile(accessToken): Promise<OAuthProfile> {
    const response = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) throw new ServiceUnavailableError('Could not read your Google profile.');

    const info = (await response.json()) as GoogleUserInfo;
    if (!info.sub || !info.email)
      throw new UnauthenticatedError('Google returned no email address.');

    return {
      providerAccountId: info.sub,
      email: info.email.toLowerCase(),
      emailVerified: info.email_verified === true,
      name: info.name,
      avatarUrl: info.picture,
    };
  },
};
