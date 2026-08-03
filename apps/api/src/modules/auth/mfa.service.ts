import { hash, verify } from '@node-rs/argon2';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { LIMITS } from '@cc/shared';
import { env } from '../../config/env.js';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCode,
  normaliseRecoveryCode,
} from '../../core/crypto/tokens.js';
import { prisma } from '../../core/db/prisma.js';
import { ConflictError, NotFoundError } from '../../core/errors/app-error.js';

/**
 * TOTP multi-factor authentication (FR-09), RFC 6238.
 *
 * otplib 13 expresses drift as `epochTolerance` in SECONDS, not as a count of
 * windows — 30 seconds is the ±1 step the security design specifies. Phone
 * clocks are routinely a few seconds out, and a zero-drift policy produces
 * support tickets rather than security; going wider meaningfully extends how
 * long a shoulder-surfed code stays usable.
 */
const EPOCH_TOLERANCE_SECONDS = 30;

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export interface MfaEnrolment {
  secret: string;
  otpauthUrl: string;
}

/**
 * Begin enrolment. The credential row is created but left unconfirmed, and
 * `User.mfaEnabled` stays false — a user who scans a QR code and then closes
 * the tab must not end up locked out of their own account by a second factor
 * they never finished setting up.
 */
export async function beginEnrolment(userId: string, email: string): Promise<MfaEnrolment> {
  const existing = await prisma().mfaCredential.findUnique({ where: { userId } });
  if (existing?.confirmedAt) {
    throw new ConflictError('Multi-factor authentication is already enabled.');
  }

  const secret = generateSecret();
  const secretEnc = encryptSecret(secret);

  await prisma().mfaCredential.upsert({
    where: { userId },
    create: { userId, secretEnc, recoveryCodeHashes: [] },
    update: { secretEnc, recoveryCodeHashes: [], confirmedAt: null },
  });

  // The URI is returned rather than a rendered QR image: generating the image
  // belongs to the client, and keeping it there avoids shipping an image
  // encoder into the API for one screen.
  const otpauthUrl = generateURI({ issuer: 'Career Copilot', label: email, secret });

  return { secret, otpauthUrl };
}

export function verifyTotp(secret: string, code: string): boolean {
  try {
    return verifySync({ secret, token: code, epochTolerance: EPOCH_TOLERANCE_SECONDS }).valid;
  } catch {
    // A malformed secret or token must read as "did not match", never as a
    // 500 that tells an attacker their input was structurally interesting.
    return false;
  }
}

export async function verifyUserTotp(userId: string, code: string): Promise<boolean> {
  const credential = await prisma().mfaCredential.findUnique({ where: { userId } });
  if (!credential) return false;
  return verifyTotp(decryptSecret(credential.secretEnc), code);
}

/**
 * Confirm enrolment by proving the authenticator app works, then hand back the
 * recovery codes — shown exactly once, stored only as argon2 hashes.
 */
export async function confirmEnrolment(userId: string, code: string): Promise<string[]> {
  const credential = await prisma().mfaCredential.findUnique({ where: { userId } });
  if (!credential) throw new NotFoundError('Start multi-factor setup first.');
  if (credential.confirmedAt)
    throw new ConflictError('Multi-factor authentication is already enabled.');

  if (!verifyTotp(decryptSecret(credential.secretEnc), code)) {
    throw new ConflictError('That code did not match. Check your authenticator app and try again.');
  }

  const codes = Array.from({ length: LIMITS.RECOVERY_CODE_COUNT }, generateRecoveryCode);
  const hashes = await Promise.all(
    codes.map((c) => hash(normaliseRecoveryCode(c), ARGON2_OPTIONS)),
  );

  await prisma().$transaction([
    prisma().mfaCredential.update({
      where: { userId },
      data: { confirmedAt: new Date(), recoveryCodeHashes: hashes },
    }),
    prisma().user.update({ where: { id: userId }, data: { mfaEnabled: true } }),
  ]);

  return codes;
}

/**
 * Consume a recovery code. Single use — a code that still works after being
 * used is just a weaker password.
 *
 * Every stored hash is checked rather than short-circuiting on the first match,
 * so the work done does not reveal how many codes remain.
 */
export async function consumeRecoveryCode(userId: string, rawCode: string): Promise<boolean> {
  const credential = await prisma().mfaCredential.findUnique({ where: { userId } });
  if (!credential || credential.recoveryCodeHashes.length === 0) return false;

  const candidate = normaliseRecoveryCode(rawCode);
  const results = await Promise.all(
    credential.recoveryCodeHashes.map(async (stored) => {
      try {
        return await verify(stored, candidate, ARGON2_OPTIONS);
      } catch {
        return false;
      }
    }),
  );

  const matchIndex = results.findIndex(Boolean);
  if (matchIndex === -1) return false;

  const remaining = credential.recoveryCodeHashes.filter((_, i) => i !== matchIndex);
  await prisma().mfaCredential.update({
    where: { userId },
    data: { recoveryCodeHashes: remaining, lastUsedAt: new Date() },
  });

  return true;
}

export async function disableMfa(userId: string): Promise<void> {
  await prisma().$transaction([
    prisma().mfaCredential.deleteMany({ where: { userId } }),
    prisma().user.update({ where: { id: userId }, data: { mfaEnabled: false } }),
  ]);
}

export async function remainingRecoveryCodes(userId: string): Promise<number> {
  const credential = await prisma().mfaCredential.findUnique({ where: { userId } });
  return credential?.recoveryCodeHashes.length ?? 0;
}

/** Short-lived token bridging the password step and the TOTP step. It is not a
 *  session: it carries no privileges beyond "this password was just verified". */
export function mfaChallengeTtlSeconds(): number {
  return 300;
}

export function mfaIssuer(): string {
  return env().API_URL;
}
