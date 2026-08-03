import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { UserRole } from '@cc/shared';
import { env } from '../../config/env.js';
import { generateToken, hashToken } from '../../core/crypto/tokens.js';
import { prisma } from '../../core/db/prisma.js';
import { UnauthenticatedError } from '../../core/errors/app-error.js';
import { loggerFor } from '../../core/logger/logger.js';

const log = loggerFor('tokens');

const ACCESS_TTL_SECONDS = 15 * 60;

export interface AccessClaims {
  sub: string;
  role: UserRole;
  sid: string;
  jti: string;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env().JWT_SECRET);
}

export async function signAccessToken(claims: Omit<AccessClaims, 'jti'>): Promise<string> {
  return new SignJWT({ role: claims.role, sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setJti(randomUUID())
    .setIssuedAt()
    .setIssuer(env().API_URL)
    .setAudience(env().WEB_URL)
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      issuer: env().API_URL,
      audience: env().WEB_URL,
      algorithms: ['HS256'], // pinned: without this, an `alg: none` token would verify
    });

    if (!payload.sub || typeof payload.sid !== 'string' || typeof payload.role !== 'string') {
      throw new UnauthenticatedError();
    }

    return {
      sub: payload.sub,
      role: payload.role as UserRole,
      sid: payload.sid,
      jti: typeof payload.jti === 'string' ? payload.jti : '',
    };
  } catch {
    throw new UnauthenticatedError('Your session has expired. Please sign in again.');
  }
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  refreshExpiresAt: Date;
}

function refreshTtlDays(rememberMe: boolean): number {
  return rememberMe ? env().JWT_REFRESH_TTL_REMEMBER_DAYS : env().JWT_REFRESH_TTL_DAYS;
}

/** Creates a device session plus the first token of a new rotation family. */
export async function issueSession(params: {
  userId: string;
  role: UserRole;
  rememberMe: boolean;
  userAgent?: string;
  ipPrefix?: string;
}): Promise<IssuedSession> {
  const ttlDays = refreshTtlDays(params.rememberMe);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  const session = await prisma().deviceSession.create({
    data: {
      userId: params.userId,
      userAgent: params.userAgent?.slice(0, 500),
      ipPrefix: params.ipPrefix,
      deviceLabel: describeDevice(params.userAgent),
      expiresAt,
    },
  });

  const refreshToken = generateToken();

  await prisma().refreshToken.create({
    data: {
      userId: params.userId,
      sessionId: session.id,
      familyId: randomUUID(),
      tokenHash: hashToken(refreshToken),
      expiresAt,
    },
  });

  const accessToken = await signAccessToken({
    sub: params.userId,
    role: params.role,
    sid: session.id,
  });

  return { accessToken, refreshToken, sessionId: session.id, refreshExpiresAt: expiresAt };
}

export class RefreshReuseDetected extends Error {
  readonly userId: string;
  constructor(userId: string) {
    super('Refresh token reuse detected');
    this.userId = userId;
  }
}

/**
 * Rotate a refresh token (FR-03).
 *
 * The security property: presenting a token that is already `ROTATED` means two
 * parties hold tokens descended from the same login — the legitimate user and
 * whoever stole it. We cannot tell which is which, so the entire family is
 * revoked and both are forced to re-authenticate. That converts a stolen
 * refresh token from indefinite silent access into a detectable, self-limiting
 * event.
 *
 * The whole check-and-rotate runs in one transaction: without it, two
 * concurrent refreshes could both read an ACTIVE token and both issue a new
 * one, forking the family and defeating the detection.
 */
export async function rotateRefreshToken(params: {
  rawToken: string;
  userAgent?: string;
  ipPrefix?: string;
}): Promise<IssuedSession & { role: UserRole }> {
  const presentedHash = hashToken(params.rawToken);

  // Detection runs inside the transaction; the *revocation* must not.
  //
  // Throwing from inside an interactive Prisma transaction rolls it back — so
  // writing the revocations there and then throwing would undo them, leaving
  // the stolen session very much alive while the response claimed otherwise.
  // The 401 looked correct and the security property was silently absent. An
  // integration test asserting the post-conditions is what caught it.
  //
  // So the transaction reports the reuse without writing, and the caller-side
  // block below performs the revocation in its own committed transaction.
  const detection = await prisma().$transaction(async (tx) => {
    const existing = await tx.refreshToken.findUnique({
      where: { tokenHash: presentedHash },
      include: { user: true },
    });

    if (!existing) throw new UnauthenticatedError('Session not recognised. Please sign in again.');

    if (existing.status !== 'ACTIVE') {
      return { reuse: true as const, userId: existing.userId, familyId: existing.familyId };
    }

    if (existing.expiresAt < new Date()) {
      throw new UnauthenticatedError('Your session has expired. Please sign in again.');
    }

    if (existing.user.deletedAt) {
      throw new UnauthenticatedError('Session not recognised. Please sign in again.');
    }

    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { status: 'ROTATED', rotatedAt: new Date() },
    });

    const nextRaw = generateToken();
    await tx.refreshToken.create({
      data: {
        userId: existing.userId,
        sessionId: existing.sessionId,
        familyId: existing.familyId, // same family — that is what makes reuse detectable
        parentId: existing.id,
        tokenHash: hashToken(nextRaw),
        expiresAt: existing.expiresAt,
      },
    });

    await tx.deviceSession.update({
      where: { id: existing.sessionId },
      data: { lastSeenAt: new Date(), ipPrefix: params.ipPrefix ?? undefined },
    });

    const accessToken = await signAccessToken({
      sub: existing.userId,
      role: existing.user.role,
      sid: existing.sessionId,
    });

    return {
      reuse: false as const,
      accessToken,
      refreshToken: nextRaw,
      sessionId: existing.sessionId,
      refreshExpiresAt: existing.expiresAt,
      role: existing.user.role,
    };
  });

  if (detection.reuse) {
    // Committed on its own, outside the aborted-by-throw path above. Revoke
    // every token in the family and end every session for the user: we cannot
    // tell the legitimate holder from the thief, so both must re-authenticate.
    log.warn(
      { userId: detection.userId, familyId: detection.familyId },
      'refresh token reuse detected; revoking family and all sessions',
    );

    await prisma().$transaction([
      prisma().refreshToken.updateMany({
        where: { familyId: detection.familyId, status: { not: 'REVOKED' } },
        data: { status: 'REVOKED', revokedAt: new Date() },
      }),
      prisma().deviceSession.updateMany({
        where: { userId: detection.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    throw new RefreshReuseDetected(detection.userId);
  }

  return detection;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma().$transaction([
    prisma().refreshToken.updateMany({
      where: { sessionId, status: { not: 'REVOKED' } },
      data: { status: 'REVOKED', revokedAt: new Date() },
    }),
    prisma().deviceSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await prisma().$transaction([
    prisma().refreshToken.updateMany({
      where: {
        userId,
        status: { not: 'REVOKED' },
        ...(exceptSessionId ? { sessionId: { not: exceptSessionId } } : {}),
      },
      data: { status: 'REVOKED', revokedAt: new Date() },
    }),
    prisma().deviceSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    }),
  ]);
}

/** A human-readable device label for the session list. Best-effort only —
 *  user agents lie, and this is for recognition, not identification. */
function describeDevice(userAgent?: string): string {
  if (!userAgent) return 'Unknown device';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Chrome\//.test(userAgent)
      ? 'Chrome'
      : /Safari\//.test(userAgent)
        ? 'Safari'
        : /Firefox\//.test(userAgent)
          ? 'Firefox'
          : 'Browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(userAgent)
      ? 'macOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Unknown OS';
  return `${browser} on ${os}`;
}
