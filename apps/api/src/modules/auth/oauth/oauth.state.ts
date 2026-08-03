import { createHash, randomBytes } from 'node:crypto';
import type { OAuthProvider } from '@cc/shared';
import { redis } from '../../../core/redis/client.js';

/**
 * OAuth `state` and PKCE verifier storage.
 *
 * `state` is the CSRF protection for the OAuth handshake. The callback is a GET
 * initiated by the provider's redirect, so it carries no CSRF header and no
 * body — the double-submit token cannot apply. Without a single-use state, an
 * attacker can complete their own authorisation and feed the resulting code to
 * a victim's browser, linking the attacker's identity to the victim's session.
 *
 * Stored in Redis rather than a cookie so it is genuinely single-use: deletion
 * on consumption is atomic and server-side, where a cookie could be replayed by
 * whoever holds it.
 */

const TTL_SECONDS = 600; // 10 minutes — long enough to sign in, short enough to matter

export interface OAuthStatePayload {
  provider: OAuthProvider;
  codeVerifier?: string;
  /** Where to send the browser afterwards, validated against our own origin. */
  returnTo?: string;
  /** Set when an already-signed-in user is linking a provider rather than
   *  signing in, so the callback links instead of creating an account. */
  linkUserId?: string;
}

function key(state: string): string {
  return `cc:oauth:state:${state}`;
}

/** RFC 7636: 43–128 characters of unreserved charset. 32 random bytes
 *  base64url-encoded lands at 43. */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** S256 challenge. The plain method is not offered: it provides no protection
 *  against an attacker who can read the authorisation request. */
export function deriveCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function createState(payload: OAuthStatePayload): Promise<string> {
  const state = randomBytes(32).toString('base64url');
  await redis().set(key(state), JSON.stringify(payload), 'EX', TTL_SECONDS);
  return state;
}

/**
 * Consume a state exactly once.
 *
 * GETDEL is atomic: a read-then-delete would let two concurrent callbacks both
 * observe the state as valid, which is precisely the replay this exists to
 * prevent.
 */
export async function consumeState(state: string): Promise<OAuthStatePayload | null> {
  if (!state) return null;

  const raw = await redis().getdel(key(state));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as OAuthStatePayload;
  } catch {
    return null;
  }
}
