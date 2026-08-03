import type { OAuthProvider } from '@cc/shared';

/**
 * The profile we need from any identity provider.
 *
 * `providerAccountId` is the provider's own stable identifier — never the
 * email. Emails change on the provider side, and keying the link on one would
 * silently re-point an account when a user renames their Google address.
 */
export interface OAuthProfile {
  providerAccountId: string;
  email: string;
  /** Whether the *provider* has verified the address. We refuse to link or
   *  create an account from an unverified one — otherwise anyone who can
   *  register an unverified address at the provider could claim our account. */
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface OAuthProviderAdapter {
  readonly id: OAuthProvider;
  /** Provider's authorisation endpoint, with our parameters applied. */
  authorizationUrl(params: { state: string; codeChallenge?: string; redirectUri: string }): string;
  exchangeCode(params: {
    code: string;
    codeVerifier?: string;
    redirectUri: string;
  }): Promise<TokenResponse>;
  fetchProfile(accessToken: string): Promise<OAuthProfile>;
  /**
   * Whether the provider actually supports PKCE.
   *
   * Not every provider does, and pretending otherwise is worse than admitting
   * it: sending a challenge to a provider that ignores it produces a flow that
   * *looks* PKCE-protected in our code and is not. See github.provider.ts.
   */
  readonly supportsPkce: boolean;
  /** False when the provider's credentials are absent from configuration. */
  isConfigured(): boolean;
}
