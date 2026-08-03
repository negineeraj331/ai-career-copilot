import { SignJWT, jwtVerify } from 'jose';
import type { AuditLogEntry, DeviceSession, PublicUser } from '@cc/shared';
import { env } from '../../config/env.js';
import { prisma } from '../../core/db/prisma.js';
import {
  AccountLockedError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from '../../core/errors/app-error.js';
import { loggerFor } from '../../core/logger/logger.js';
import { mailer } from '../../services/mailer/mailer.js';
import { recordAudit } from './audit.service.js';
import * as lockout from './lockout.service.js';
import * as mfa from './mfa.service.js';
import {
  burnTimeLikeAVerify,
  checkPasswordStrength,
  hashPassword,
  verifyPassword,
} from './password.service.js';
import {
  type IssuedSession,
  RefreshReuseDetected,
  issueSession,
  revokeAllSessions,
  revokeSession,
  rotateRefreshToken,
} from './tokens.service.js';
import { consumeVerificationToken, issueVerificationToken } from './verification.service.js';

const log = loggerFor('auth.service');

export interface RequestMeta {
  userAgent?: string;
  ipPrefix: string;
}

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

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Register (FR-01).
 *
 * Returns an identical response whether or not the address is already taken,
 * and sends a "someone tried to register with your address" email in the
 * collision case. A distinguishable response here is a free account-enumeration
 * oracle, and knowing which of a leaked email list has accounts is exactly what
 * makes credential stuffing efficient.
 */
export async function register(
  input: { email: string; password: string; name?: string },
  meta: RequestMeta,
): Promise<void> {
  const strength = checkPasswordStrength(input.password, [input.email, input.name ?? '']);
  if (!strength.ok) {
    throw new ValidationError([
      { field: 'password', message: strength.reason ?? 'Choose a stronger password.' },
    ]);
  }

  const existing = await prisma().user.findUnique({ where: { email: input.email } });

  if (existing) {
    await mailer().send({
      to: input.email,
      subject: 'Someone tried to create an account with your email',
      text:
        'Someone tried to register a Career Copilot account using this address.\n\n' +
        'You already have an account, so nothing has changed. If this was you, sign in instead — ' +
        'or reset your password if you have forgotten it.\n\n' +
        'If it was not you, you can safely ignore this message.',
    });
    await recordAudit({
      event: 'REGISTER',
      userId: existing.id,
      outcome: 'FAILURE',
      metadata: { reason: 'email_already_registered', userAgent: meta.userAgent },
    });
    return;
  }

  const user = await prisma().user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
    },
  });

  const token = await issueVerificationToken({ userId: user.id, type: 'EMAIL_VERIFICATION' });

  await mailer().send({
    to: user.email,
    subject: 'Verify your email',
    text:
      `Welcome to Career Copilot.\n\nVerify your email to finish setting up your account:\n` +
      `${env().WEB_URL}/verify-email?token=${token.raw}\n\nThis link expires in 24 hours.`,
  });

  await recordAudit({
    event: 'REGISTER',
    userId: user.id,
    metadata: { userAgent: meta.userAgent },
  });
}

export async function verifyEmail(token: string): Promise<void> {
  const consumed = await consumeVerificationToken(token, 'EMAIL_VERIFICATION');
  if (!consumed)
    throw new ValidationError([
      { field: 'token', message: 'That link is invalid or has expired.' },
    ]);

  await prisma().user.update({
    where: { id: consumed.userId },
    data: { emailVerifiedAt: new Date() },
  });

  await recordAudit({ event: 'EMAIL_VERIFIED', userId: consumed.userId });
}

export async function resendVerification(email: string): Promise<void> {
  const user = await prisma().user.findUnique({ where: { email } });
  // Silent when unknown or already verified — same enumeration reasoning.
  if (!user || user.emailVerifiedAt) return;

  const token = await issueVerificationToken({ userId: user.id, type: 'EMAIL_VERIFICATION' });
  await mailer().send({
    to: user.email,
    subject: 'Verify your email',
    text: `Verify your email:\n${env().WEB_URL}/verify-email?token=${token.raw}\n\nThis link expires in 24 hours.`,
  });
}

// ─── Login ───────────────────────────────────────────────────────────────────

export interface LoginResult {
  kind: 'session';
  user: PublicUser;
  session: IssuedSession;
}

export interface MfaChallengeResult {
  kind: 'mfa';
  mfaToken: string;
  expiresIn: number;
}

const MFA_AUDIENCE = 'cc:mfa-challenge';

async function signMfaChallenge(userId: string): Promise<string> {
  return (
    new SignJWT({ purpose: 'mfa' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setIssuer(env().API_URL)
      // A distinct audience is what stops this being replayed as an access
      // token: verifyAccessToken requires the web-app audience and would reject it.
      .setAudience(MFA_AUDIENCE)
      .setExpirationTime(`${mfa.mfaChallengeTtlSeconds()}s`)
      .sign(new TextEncoder().encode(env().JWT_SECRET))
  );
}

async function verifyMfaChallenge(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env().JWT_SECRET), {
      issuer: env().API_URL,
      audience: MFA_AUDIENCE,
      algorithms: ['HS256'],
    });
    if (!payload.sub) throw new UnauthenticatedError();
    return payload.sub;
  } catch {
    throw new UnauthenticatedError('That verification step expired. Please sign in again.');
  }
}

/**
 * Login (FR-02).
 *
 * Every failure path costs roughly the same wall-clock time and returns the
 * same message, so neither the response nor its timing reveals whether an
 * account exists.
 */
export async function login(
  input: { email: string; password: string; rememberMe: boolean },
  meta: RequestMeta,
): Promise<LoginResult | MfaChallengeResult> {
  const lock = await lockout.checkLock(input.email, meta.ipPrefix);
  if (lock.locked) throw new AccountLockedError(lock.retryAfterSeconds);

  const user = await prisma().user.findUnique({ where: { email: input.email } });

  if (!user || !user.passwordHash || user.deletedAt) {
    // Burn comparable time before failing, or a missing account answers in ~1 ms
    // while a real one takes ~50 ms of argon2 — an enumeration oracle no amount
    // of response-body matching can close.
    await burnTimeLikeAVerify();
    await lockout.recordFailure(input.email, meta.ipPrefix);
    await recordAudit({
      event: 'LOGIN_FAILURE',
      userId: user?.id ?? null,
      outcome: 'FAILURE',
      metadata: { reason: 'unknown_account', userAgent: meta.userAgent },
    });
    throw new UnauthenticatedError('Email or password is incorrect.');
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    const status = await lockout.recordFailure(input.email, meta.ipPrefix);
    await recordAudit({
      event: 'LOGIN_FAILURE',
      userId: user.id,
      outcome: 'FAILURE',
      metadata: { reason: 'bad_password', userAgent: meta.userAgent },
    });
    if (status.locked) {
      await recordAudit({ event: 'ACCOUNT_LOCKED', userId: user.id, outcome: 'FAILURE' });
      throw new AccountLockedError(status.retryAfterSeconds);
    }
    throw new UnauthenticatedError('Email or password is incorrect.');
  }

  if (!user.emailVerifiedAt && !env().ALLOW_UNVERIFIED_LOGIN) {
    throw new ForbiddenError(
      'Verify your email address to sign in. Check your inbox for the link.',
    );
  }

  await lockout.clearFailures(input.email, meta.ipPrefix);

  if (user.mfaEnabled) {
    // No session cookies yet — the password is only the first factor.
    return {
      kind: 'mfa',
      mfaToken: await signMfaChallenge(user.id),
      expiresIn: mfa.mfaChallengeTtlSeconds(),
    };
  }

  return {
    kind: 'session',
    user: toPublicUser(user),
    session: await startSession(user, input.rememberMe, meta),
  };
}

async function startSession(
  user: { id: string; role: string; email: string },
  rememberMe: boolean,
  meta: RequestMeta,
): Promise<IssuedSession> {
  const session = await issueSession({
    userId: user.id,
    role: user.role as PublicUser['role'],
    rememberMe,
    userAgent: meta.userAgent,
    ipPrefix: meta.ipPrefix,
  });

  await prisma().user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginCount: 0 },
  });

  await recordAudit({
    event: 'LOGIN_SUCCESS',
    userId: user.id,
    metadata: { userAgent: meta.userAgent },
  });
  return session;
}

export async function completeMfa(
  input: { mfaToken: string; code?: string; recoveryCode?: string; rememberMe?: boolean },
  meta: RequestMeta,
): Promise<LoginResult> {
  const userId = await verifyMfaChallenge(input.mfaToken);

  const user = await prisma().user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) throw new UnauthenticatedError();

  let passed = false;
  let usedRecoveryCode = false;

  if (input.code) {
    passed = await mfa.verifyUserTotp(userId, input.code);
  } else if (input.recoveryCode) {
    passed = await mfa.consumeRecoveryCode(userId, input.recoveryCode);
    usedRecoveryCode = passed;
  }

  if (!passed) {
    await recordAudit({ event: 'MFA_CHALLENGE_FAILED', userId, outcome: 'FAILURE' });
    await lockout.recordFailure(user.email, meta.ipPrefix);
    throw new UnauthenticatedError('That code is not valid.');
  }

  if (usedRecoveryCode) {
    const remaining = await mfa.remainingRecoveryCodes(userId);
    await recordAudit({ event: 'RECOVERY_CODE_USED', userId, metadata: { remaining } });
    await mailer().send({
      to: user.email,
      subject: 'A recovery code was used on your account',
      text:
        `A multi-factor recovery code was just used to sign in to your Career Copilot account.\n\n` +
        `You have ${remaining} unused code(s) left.\n\n` +
        `If this was not you, change your password immediately.`,
    });
  }

  return {
    kind: 'session',
    user: toPublicUser(user),
    session: await startSession(user, input.rememberMe ?? false, meta),
  };
}

// ─── Session lifecycle ───────────────────────────────────────────────────────

export async function refresh(rawToken: string, meta: RequestMeta): Promise<IssuedSession> {
  try {
    return await rotateRefreshToken({
      rawToken,
      userAgent: meta.userAgent,
      ipPrefix: meta.ipPrefix,
    });
  } catch (error) {
    if (error instanceof RefreshReuseDetected) {
      await recordAudit({
        event: 'REFRESH_REUSE_DETECTED',
        userId: error.userId,
        outcome: 'FAILURE',
        metadata: { userAgent: meta.userAgent },
      });

      const user = await prisma().user.findUnique({ where: { id: error.userId } });
      if (user) {
        await mailer().send({
          to: user.email,
          subject: 'Security alert: we signed you out of every device',
          text:
            'We detected a sign-in token being reused on your Career Copilot account, which can ' +
            'mean it was copied by someone else.\n\n' +
            'As a precaution we have signed you out everywhere. Sign in again to continue, and ' +
            'change your password if you did not expect this.',
        });
      }

      log.warn({ userId: error.userId }, 'refresh reuse: all sessions revoked');
      throw new UnauthenticatedError('For your security we signed you out. Please sign in again.');
    }
    throw error;
  }
}

export async function logout(sessionId: string, userId: string): Promise<void> {
  await revokeSession(sessionId);
  await recordAudit({ event: 'LOGOUT', userId });
}

export async function logoutAll(userId: string): Promise<void> {
  await revokeAllSessions(userId);
  await recordAudit({ event: 'LOGOUT_ALL', userId });
}

export async function listSessions(
  userId: string,
  currentSessionId: string,
): Promise<DeviceSession[]> {
  const sessions = await prisma().deviceSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
  });

  return sessions.map((s) => ({
    id: s.id,
    device: s.deviceLabel ?? 'Unknown device',
    ipPrefix: s.ipPrefix ?? 'unknown',
    lastSeenAt: s.lastSeenAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    current: s.id === currentSessionId,
  }));
}

export async function revokeOneSession(userId: string, sessionId: string): Promise<void> {
  const session = await prisma().deviceSession.findUnique({ where: { id: sessionId } });
  // 404 rather than 403 for someone else's session: distinguishing them
  // confirms the id exists.
  if (!session || session.userId !== userId) throw new NotFoundError('Session not found.');

  await revokeSession(sessionId);
  await recordAudit({
    event: 'SESSION_REVOKED',
    userId,
    resourceType: 'DeviceSession',
    resourceId: sessionId,
  });
}

// ─── Password reset and magic links ──────────────────────────────────────────

export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma().user.findUnique({ where: { email } });

  // Silent for unknown addresses. The caller always returns 200.
  if (user && !user.deletedAt) {
    const token = await issueVerificationToken({ userId: user.id, type: 'PASSWORD_RESET' });
    await mailer().send({
      to: user.email,
      subject: 'Reset your password',
      text:
        `Reset your Career Copilot password:\n${env().WEB_URL}/reset-password?token=${token.raw}\n\n` +
        `This link expires in 30 minutes and can be used once.\n\n` +
        `If you did not request this, you can ignore it — your password has not changed.`,
    });
    await recordAudit({ event: 'PASSWORD_RESET_REQUESTED', userId: user.id });
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const consumed = await consumeVerificationToken(token, 'PASSWORD_RESET');
  if (!consumed)
    throw new ValidationError([
      { field: 'token', message: 'That link is invalid or has expired.' },
    ]);

  const user = await prisma().user.findUnique({ where: { id: consumed.userId } });
  if (!user)
    throw new ValidationError([{ field: 'token', message: 'That link is no longer valid.' }]);

  const strength = checkPasswordStrength(newPassword, [user.email, user.name ?? '']);
  if (!strength.ok) {
    throw new ValidationError([
      { field: 'password', message: strength.reason ?? 'Choose a stronger password.' },
    ]);
  }

  await prisma().user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(newPassword),
      // Completing a reset proves control of the inbox; a verified address is
      // implied, and the lockout should not survive.
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    },
  });

  // Every existing session dies. If the reset was triggered because an attacker
  // had access, leaving their session alive would defeat the entire exercise.
  await revokeAllSessions(user.id);
  await lockout.clearFailures(user.email);

  await mailer().send({
    to: user.email,
    subject: 'Your password was changed',
    text:
      'Your Career Copilot password was just changed and you have been signed out of all devices.\n\n' +
      'If this was not you, reset your password again immediately and contact support.',
  });

  await recordAudit({ event: 'PASSWORD_RESET_COMPLETED', userId: user.id });
}

export async function requestMagicLink(email: string): Promise<void> {
  const user = await prisma().user.findUnique({ where: { email } });
  if (!user || user.deletedAt) return;

  const token = await issueVerificationToken({ userId: user.id, type: 'MAGIC_LINK' });
  await mailer().send({
    to: user.email,
    subject: 'Your sign-in link',
    text:
      `Sign in to Career Copilot:\n${env().WEB_URL}/magic-link?token=${token.raw}\n\n` +
      `This link expires in 10 minutes and can be used once.`,
  });
  await recordAudit({ event: 'MAGIC_LINK_REQUESTED', userId: user.id });
}

export async function verifyMagicLink(
  token: string,
  meta: RequestMeta,
): Promise<LoginResult | MfaChallengeResult> {
  const consumed = await consumeVerificationToken(token, 'MAGIC_LINK');
  if (!consumed) throw new UnauthenticatedError('That link is invalid or has expired.');

  const user = await prisma().user.findUnique({ where: { id: consumed.userId } });
  if (!user || user.deletedAt) throw new UnauthenticatedError('That link is no longer valid.');

  // Following an emailed link proves inbox control, so it verifies the address.
  if (!user.emailVerifiedAt) {
    await prisma().user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }

  await recordAudit({ event: 'MAGIC_LINK_USED', userId: user.id });

  // A magic link is one factor. If MFA is on, it still has to be satisfied —
  // otherwise emailing a link would be a way around the second factor entirely.
  if (user.mfaEnabled) {
    return {
      kind: 'mfa',
      mfaToken: await signMfaChallenge(user.id),
      expiresIn: mfa.mfaChallengeTtlSeconds(),
    };
  }

  return {
    kind: 'session',
    user: toPublicUser(user),
    session: await startSession(user, false, meta),
  };
}

// ─── MFA management ──────────────────────────────────────────────────────────

export async function setupMfa(userId: string): Promise<mfa.MfaEnrolment> {
  const user = await prisma().user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User not found.');
  return mfa.beginEnrolment(userId, user.email);
}

export async function confirmMfa(userId: string, code: string): Promise<string[]> {
  const codes = await mfa.confirmEnrolment(userId, code);
  await recordAudit({ event: 'MFA_ENABLED', userId });
  return codes;
}

export async function disableMfa(userId: string, password: string): Promise<void> {
  const user = await prisma().user.findUnique({ where: { id: userId } });
  if (!user?.passwordHash) throw new NotFoundError('User not found.');

  // Re-authenticate: removing a second factor must cost more than a click on a
  // machine someone walked away from.
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw new UnauthenticatedError('That password is not correct.');
  }

  await mfa.disableMfa(userId);
  await recordAudit({ event: 'MFA_DISABLED', userId });

  await mailer().send({
    to: user.email,
    subject: 'Multi-factor authentication was turned off',
    text:
      'Multi-factor authentication was just disabled on your Career Copilot account.\n\n' +
      'If this was not you, turn it back on and change your password immediately.',
  });
}

// ─── Profile and audit ───────────────────────────────────────────────────────

export async function currentUser(userId: string): Promise<PublicUser> {
  const user = await prisma().user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) throw new UnauthenticatedError();
  return toPublicUser(user);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  currentSessionId: string,
): Promise<void> {
  const user = await prisma().user.findUnique({ where: { id: userId } });
  if (!user?.passwordHash) throw new NotFoundError('User not found.');

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new UnauthenticatedError('Your current password is not correct.');
  }

  const strength = checkPasswordStrength(newPassword, [user.email, user.name ?? '']);
  if (!strength.ok) {
    throw new ValidationError([
      { field: 'newPassword', message: strength.reason ?? 'Choose a stronger password.' },
    ]);
  }

  await prisma().user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  // Keep the current session; end every other one. A password change should
  // evict anyone else without logging the user out of the tab they are in.
  await revokeAllSessions(userId, currentSessionId);
  await recordAudit({ event: 'PASSWORD_CHANGED', userId });

  await mailer().send({
    to: user.email,
    subject: 'Your password was changed',
    text: 'Your Career Copilot password was just changed. Other devices have been signed out.',
  });
}

export async function auditLogFor(userId: string, limit = 50): Promise<AuditLogEntry[]> {
  const entries = await prisma().auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return entries.map((e) => ({
    id: e.id,
    event: e.event,
    outcome: e.outcome,
    ipPrefix: e.ipPrefix,
    userAgent: e.userAgent,
    createdAt: e.createdAt.toISOString(),
  }));
}

export { ConflictError };
