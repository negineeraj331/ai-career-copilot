import type { OAuthProvider, PublicUser } from '@cc/shared';
import { env } from '../../../config/env.js';
import { encryptSecret } from '../../../core/crypto/tokens.js';
import { prisma } from '../../../core/db/prisma.js';
import {
  ConflictError,
  NotFoundError,
  UnauthenticatedError,
} from '../../../core/errors/app-error.js';
import { loggerFor } from '../../../core/logger/logger.js';
import { recordAudit } from '../audit.service.js';
import type { RequestMeta } from '../auth.service.js';
import { type IssuedSession, issueSession } from '../tokens.service.js';
import { githubProvider } from './github.provider.js';
import { googleProvider } from './google.provider.js';
import {
  consumeState,
  createState,
  deriveCodeChallenge,
  generateCodeVerifier,
} from './oauth.state.js';
import type { OAuthProfile, OAuthProviderAdapter } from './oauth.types.js';

const log = loggerFor('oauth');

const adapters = new Map<OAuthProvider, OAuthProviderAdapter>([
  ['GOOGLE', googleProvider],
  ['GITHUB', githubProvider],
]);

/** Test seam: swap an adapter for a stub so the flow can be exercised without
 *  contacting a real identity provider. */
export function registerAdapter(adapter: OAuthProviderAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getAdapter(provider: string): OAuthProviderAdapter {
  const adapter = adapters.get(provider.toUpperCase() as OAuthProvider);
  // 404 rather than 400: an unknown provider is an unknown route.
  if (!adapter) throw new NotFoundError('Unknown sign-in provider.');
  if (!adapter.isConfigured()) {
    throw new NotFoundError('That sign-in provider is not enabled on this deployment.');
  }
  return adapter;
}

/**
 * Redirect URIs are built from configuration, never from the request.
 *
 * Deriving one from a Host or X-Forwarded-Host header would let an attacker
 * point the provider's redirect at a host they control and collect the code.
 */
export function redirectUriFor(provider: OAuthProvider): string {
  return `${env().API_URL}/api/v1/auth/oauth/${provider.toLowerCase()}/callback`;
}

export interface AuthorizationRedirect {
  url: string;
  state: string;
}

export async function beginAuthorization(params: {
  provider: string;
  linkUserId?: string;
}): Promise<AuthorizationRedirect> {
  const adapter = getAdapter(params.provider);

  const codeVerifier = adapter.supportsPkce ? generateCodeVerifier() : undefined;
  const state = await createState({
    provider: adapter.id,
    codeVerifier,
    linkUserId: params.linkUserId,
  });

  const url = adapter.authorizationUrl({
    state,
    codeChallenge: codeVerifier ? deriveCodeChallenge(codeVerifier) : undefined,
    redirectUri: redirectUriFor(adapter.id),
  });

  return { url, state };
}

export type CallbackResult =
  | { kind: 'session'; user: PublicUser; session: IssuedSession }
  | { kind: 'linked'; provider: OAuthProvider }
  | { kind: 'mfa'; userId: string };

function toPublicUser(user: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
  tier: string;
  emailVerifiedAt: Date | null;
  mfaEnabled: boolean;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role as PublicUser['role'],
    tier: user.tier as PublicUser['tier'],
    emailVerified: user.emailVerifiedAt !== null,
    mfaEnabled: user.mfaEnabled,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Complete the handshake.
 *
 * Resolution order matters, and is deliberate:
 *
 *   1. An existing link on (provider, providerAccountId) wins. This is the
 *      stable identifier; if the user changed their Google address, we still
 *      recognise them.
 *   2. Otherwise match on our own verified email — but only if the *provider*
 *      verified it. Accepting an unverified provider email would let anyone who
 *      can register `victim@example.com` at an identity provider take over the
 *      matching account here.
 *   3. Otherwise create a new account, already verified.
 */
export async function completeCallback(params: {
  provider: string;
  code: string;
  state: string;
  meta: RequestMeta;
}): Promise<CallbackResult> {
  const stored = await consumeState(params.state);
  if (!stored) {
    // Covers a missing, expired, tampered, or already-used state — all of which
    // are the same thing from the caller's perspective: do not trust this.
    throw new UnauthenticatedError('That sign-in attempt expired. Please try again.');
  }

  const adapter = getAdapter(params.provider);
  if (stored.provider !== adapter.id) {
    throw new UnauthenticatedError('That sign-in attempt did not match. Please try again.');
  }

  const tokens = await adapter.exchangeCode({
    code: params.code,
    codeVerifier: stored.codeVerifier,
    redirectUri: redirectUriFor(adapter.id),
  });

  const profile = await adapter.fetchProfile(tokens.accessToken);

  if (stored.linkUserId) {
    await linkToExistingUser(stored.linkUserId, adapter.id, profile, tokens.expiresAt, tokens);
    return { kind: 'linked', provider: adapter.id };
  }

  const user = await resolveUser(adapter.id, profile, tokens);

  if (user.mfaEnabled) {
    // A verified provider identity is still one factor. Skipping MFA here would
    // make "sign in with Google" a way around the second factor entirely.
    return { kind: 'mfa', userId: user.id };
  }

  const session = await issueSession({
    userId: user.id,
    role: user.role as PublicUser['role'],
    rememberMe: false,
    userAgent: params.meta.userAgent,
    ipPrefix: params.meta.ipPrefix,
  });

  await prisma().user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit({
    event: 'LOGIN_SUCCESS',
    userId: user.id,
    metadata: { provider: adapter.id },
  });

  return { kind: 'session', user: toPublicUser(user), session };
}

async function resolveUser(
  provider: OAuthProvider,
  profile: OAuthProfile,
  tokens: { accessToken: string; refreshToken?: string; expiresAt?: Date },
) {
  const existingLink = await prisma().oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId },
    },
    include: { user: true },
  });

  if (existingLink && !existingLink.user.deletedAt) {
    await prisma().oAuthAccount.update({
      where: { id: existingLink.id },
      data: {
        accessTokenEnc: encryptSecret(tokens.accessToken),
        refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : undefined,
        expiresAt: tokens.expiresAt,
      },
    });
    return existingLink.user;
  }

  const byEmail = await prisma().user.findUnique({ where: { email: profile.email } });

  if (byEmail && !byEmail.deletedAt) {
    if (!profile.emailVerified) {
      // The takeover vector: without this, registering an unverified
      // victim@example.com at the provider would hand over the account.
      log.warn(
        { provider, email: profile.email },
        'refusing to link an unverified provider email to an existing account',
      );
      throw new ConflictError(
        'That email is already registered here. Sign in with your password, then link this provider from settings.',
      );
    }

    await prisma().oAuthAccount.create({
      data: {
        userId: byEmail.id,
        provider,
        providerAccountId: profile.providerAccountId,
        accessTokenEnc: encryptSecret(tokens.accessToken),
        refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : undefined,
        expiresAt: tokens.expiresAt,
      },
    });

    await recordAudit({ event: 'OAUTH_LINKED', userId: byEmail.id, metadata: { provider } });
    return byEmail;
  }

  if (!profile.emailVerified) {
    throw new UnauthenticatedError(
      'Your provider has not verified that email address. Verify it there, then try again.',
    );
  }

  const created = await prisma().user.create({
    data: {
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.avatarUrl,
      // Verified by the provider, so no verification email of our own.
      emailVerifiedAt: new Date(),
      oauthAccounts: {
        create: {
          provider,
          providerAccountId: profile.providerAccountId,
          accessTokenEnc: encryptSecret(tokens.accessToken),
          refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : undefined,
          expiresAt: tokens.expiresAt,
        },
      },
    },
  });

  await recordAudit({ event: 'REGISTER', userId: created.id, metadata: { provider } });
  await recordAudit({ event: 'OAUTH_LINKED', userId: created.id, metadata: { provider } });

  return created;
}

async function linkToExistingUser(
  userId: string,
  provider: OAuthProvider,
  profile: OAuthProfile,
  expiresAt: Date | undefined,
  tokens: { accessToken: string; refreshToken?: string },
): Promise<void> {
  const claimed = await prisma().oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId },
    },
  });

  if (claimed && claimed.userId !== userId) {
    throw new ConflictError('That provider account is already linked to a different user.');
  }

  await prisma().oAuthAccount.upsert({
    where: { userId_provider: { userId, provider } },
    create: {
      userId,
      provider,
      providerAccountId: profile.providerAccountId,
      accessTokenEnc: encryptSecret(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : undefined,
      expiresAt,
    },
    update: {
      providerAccountId: profile.providerAccountId,
      accessTokenEnc: encryptSecret(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : undefined,
      expiresAt,
    },
  });

  await recordAudit({ event: 'OAUTH_LINKED', userId, metadata: { provider } });
}

/**
 * Unlink a provider.
 *
 * Refuses when it is the user's last remaining way in. Removing it would leave
 * an account that exists, holds their data, and cannot be signed into by
 * anyone — a support ticket that our own API created.
 */
export async function unlinkProvider(userId: string, provider: string): Promise<void> {
  const normalised = provider.toUpperCase() as OAuthProvider;

  const [user, links] = await Promise.all([
    prisma().user.findUnique({ where: { id: userId } }),
    prisma().oAuthAccount.findMany({ where: { userId } }),
  ]);

  if (!user) throw new NotFoundError('User not found.');

  const link = links.find((l) => l.provider === normalised);
  if (!link) throw new NotFoundError('That provider is not linked to your account.');

  const hasPassword = Boolean(user.passwordHash);
  const otherLinks = links.filter((l) => l.provider !== normalised);

  if (!hasPassword && otherLinks.length === 0) {
    throw new ConflictError(
      'This is your only way to sign in. Set a password first, then unlink this provider.',
    );
  }

  await prisma().oAuthAccount.delete({ where: { id: link.id } });
  await recordAudit({ event: 'OAUTH_UNLINKED', userId, metadata: { provider: normalised } });
}

export async function listLinkedProviders(userId: string): Promise<OAuthProvider[]> {
  const links = await prisma().oAuthAccount.findMany({
    where: { userId },
    select: { provider: true },
  });
  return links.map((l) => l.provider);
}
