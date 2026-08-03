import type { VerificationTokenType } from '@prisma/client';
import { generateToken, hashToken } from '../../core/crypto/tokens.js';
import { prisma } from '../../core/db/prisma.js';

/**
 * Single-use tokens for email verification, password reset, magic links, and
 * email changes.
 *
 * One table and one code path for all four: the lifecycle is identical (hash,
 * TTL, consume exactly once), so the consume-once logic is written and tested
 * once rather than four times — and four near-identical implementations is
 * exactly where the one that forgets to check `consumedAt` hides.
 */

export const TOKEN_TTL_MINUTES: Record<VerificationTokenType, number> = {
  EMAIL_VERIFICATION: 60 * 24,
  PASSWORD_RESET: 30,
  MAGIC_LINK: 10,
  EMAIL_CHANGE: 60,
};

export interface IssuedToken {
  raw: string;
  expiresAt: Date;
}

export async function issueVerificationToken(params: {
  userId: string;
  type: VerificationTokenType;
  payload?: Record<string, unknown>;
}): Promise<IssuedToken> {
  const raw = generateToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES[params.type] * 60 * 1000);

  // Invalidate any outstanding token of the same type. Requesting a new reset
  // link should retire the old one — otherwise a link from an email the user
  // has already abandoned stays live for its full TTL.
  await prisma().verificationToken.updateMany({
    where: { userId: params.userId, type: params.type, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  await prisma().verificationToken.create({
    data: {
      userId: params.userId,
      type: params.type,
      tokenHash: hashToken(raw),
      payload: params.payload ? (params.payload as object) : undefined,
      expiresAt,
    },
  });

  return { raw, expiresAt };
}

export interface ConsumedToken {
  userId: string;
  payload: unknown;
}

/**
 * Consume a token, atomically.
 *
 * The `consumedAt: null` guard is inside the UPDATE's WHERE clause rather than
 * a separate read-then-write, so two concurrent requests cannot both succeed
 * with the same link. A read-check-write here would let a double-clicked email
 * link consume once and reset twice.
 */
export async function consumeVerificationToken(
  rawToken: string,
  type: VerificationTokenType,
): Promise<ConsumedToken | null> {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const result = await prisma().verificationToken.updateMany({
    where: { tokenHash, type, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });

  if (result.count === 0) return null;

  const record = await prisma().verificationToken.findUnique({ where: { tokenHash } });
  if (!record) return null;

  return { userId: record.userId, payload: record.payload };
}
