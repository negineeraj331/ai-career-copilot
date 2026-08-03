import { prisma } from '../../core/db/prisma.js';

/**
 * Progressive login lockout (FR-10).
 *
 * Keyed on email + IP prefix rather than the account alone. Keying on the
 * account would let an attacker lock a known victim out of their own account
 * simply by failing logins from anywhere — a denial-of-service handed to
 * anyone who knows an email address.
 */

const THRESHOLD = 5;
const BACKOFF_MINUTES = [1, 2, 4, 8, 16, 30];

function backoffFor(failureCount: number): number {
  const index = Math.min(failureCount - THRESHOLD, BACKOFF_MINUTES.length - 1);
  return BACKOFF_MINUTES[Math.max(0, index)] ?? 30;
}

function keyFor(email: string, ipPrefix: string): { email: string; ipPrefix: string } {
  return { email: email.toLowerCase(), ipPrefix };
}

export interface LockStatus {
  locked: boolean;
  retryAfterSeconds: number;
}

export async function checkLock(email: string, ipPrefix: string): Promise<LockStatus> {
  const record = await prisma().loginAttempt.findUnique({
    where: { email_ipPrefix: keyFor(email, ipPrefix) },
  });

  if (!record?.lockedUntil) return { locked: false, retryAfterSeconds: 0 };

  const remainingMs = record.lockedUntil.getTime() - Date.now();
  if (remainingMs <= 0) return { locked: false, retryAfterSeconds: 0 };

  return { locked: true, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
}

export async function recordFailure(email: string, ipPrefix: string): Promise<LockStatus> {
  const key = keyFor(email, ipPrefix);

  const record = await prisma().loginAttempt.upsert({
    where: { email_ipPrefix: key },
    create: { ...key, failedCount: 1, lastAttempt: new Date() },
    update: { failedCount: { increment: 1 }, lastAttempt: new Date() },
  });

  if (record.failedCount < THRESHOLD) return { locked: false, retryAfterSeconds: 0 };

  const minutes = backoffFor(record.failedCount);
  const lockedUntil = new Date(Date.now() + minutes * 60 * 1000);

  await prisma().loginAttempt.update({
    where: { email_ipPrefix: key },
    data: { lockedUntil },
  });

  return { locked: true, retryAfterSeconds: minutes * 60 };
}

/** Clear on success, and also after a completed password reset — a user who
 *  proved control of their inbox should not stay locked out. */
export async function clearFailures(email: string, ipPrefix?: string): Promise<void> {
  await prisma().loginAttempt.deleteMany({
    where: { email: email.toLowerCase(), ...(ipPrefix ? { ipPrefix } : {}) },
  });
}
