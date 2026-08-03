import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../../config/env.js';

/**
 * Crypto helpers for opaque tokens and encrypted-at-rest secrets.
 *
 * Every single-use token in the system follows the same shape: generate high
 * entropy, hand the raw value to the user exactly once, and store only a hash.
 * A database dump then yields hashes, not usable tokens.
 */

/** 32 bytes of CSPRNG entropy, base64url so it is URL-safe in an email link. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * SHA-256, not argon2, and deliberately so.
 *
 * These tokens are 256 bits of random — there is no dictionary to attack and
 * nothing to slow down. argon2 here would add latency to every refresh with no
 * security gain. Passwords are different: they are low-entropy and human-chosen,
 * which is exactly when a slow KDF earns its cost.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * AES-256-GCM for values we must be able to read back — TOTP secrets, OAuth
 * provider tokens. GCM is authenticated, so tampering is detected rather than
 * silently decrypting to garbage.
 *
 * Format: iv.ciphertext.authTag, all base64. The IV is random per encryption;
 * reusing one under the same key is the classic way to destroy GCM's security.
 */
const IV_BYTES = 12;

export function encryptSecret(plaintext: string): string {
  const key = Buffer.from(env().ENCRYPTION_KEY, 'base64');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), ciphertext.toString('base64'), authTag.toString('base64')].join(
    '.',
  );
}

export function decryptSecret(payload: string): string {
  const key = Buffer.from(env().ENCRYPTION_KEY, 'base64');
  const [ivB64, dataB64, tagB64] = payload.split('.');
  if (!ivB64 || !dataB64 || !tagB64) {
    throw new Error('Malformed encrypted payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Recovery codes: 10 groups of `xxxx-xxxx`, from an unambiguous alphabet.
 *
 * No 0/O/1/I/L — these get read off a printout or a screenshot and typed by
 * hand, and a code the user cannot transcribe is a code that does not work
 * when they have lost their phone, which is the only time it matters.
 */
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateRecoveryCode(): string {
  const pick = (): string => {
    const bytes = randomBytes(4);
    return Array.from(bytes)
      .map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length])
      .join('');
  };
  return `${pick()}-${pick()}`;
}

export function normaliseRecoveryCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s/g, '');
}
