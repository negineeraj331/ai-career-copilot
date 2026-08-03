import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * The security design claims AuditLog is append-only (docs/12 §9). That claim is
 * enforced by a database trigger, not by application code — so it has to be
 * tested against a real database. An ORM mock would happily "pass" while the
 * production table stayed mutable.
 *
 * This is also a regression guard: a future migration that drops or replaces the
 * trigger would otherwise silently remove a security property nobody re-checks.
 */

const connectionString = process.env.DATABASE_URL;

describe.skipIf(!connectionString)('AuditLog append-only enforcement', () => {
  let prisma: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });
    const user = await prisma.user.upsert({
      where: { email: 'audit-test@example.com' },
      update: {},
      create: { email: 'audit-test@example.com', name: 'Audit Test' },
    });
    userId = user.id;
  });

  afterAll(async () => {
    // Safe to delete: AuditLog.userId carries no foreign key, so removing the
    // user neither cascades into nor updates the audit trail.
    await prisma.user.deleteMany({ where: { email: 'audit-test@example.com' } });
    await prisma.$disconnect();
  });

  it('accepts inserts', async () => {
    const entry = await prisma.auditLog.create({
      data: { userId, event: 'LOGIN_SUCCESS', outcome: 'SUCCESS' },
    });
    expect(entry.id).toBeTruthy();
  });

  it('rejects updates', async () => {
    const entry = await prisma.auditLog.create({
      data: { userId, event: 'LOGIN_FAILURE', outcome: 'FAILURE' },
    });

    await expect(
      prisma.auditLog.update({ where: { id: entry.id }, data: { outcome: 'SUCCESS' } }),
    ).rejects.toThrow(/append-only/i);

    const unchanged = await prisma.auditLog.findUnique({ where: { id: entry.id } });
    expect(unchanged?.outcome).toBe('FAILURE');
  });

  it('rejects deletes', async () => {
    const entry = await prisma.auditLog.create({
      data: { userId, event: 'LOGOUT', outcome: 'SUCCESS' },
    });

    await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(
      /append-only/i,
    );

    expect(await prisma.auditLog.findUnique({ where: { id: entry.id } })).not.toBeNull();
  });

  it('lets a user be deleted, and keeps their audit trail intact', async () => {
    const throwaway = await prisma.user.create({
      data: { email: `throwaway-${Date.now()}@example.com` },
    });
    const entry = await prisma.auditLog.create({
      data: { userId: throwaway.id, event: 'ACCOUNT_DELETED', outcome: 'SUCCESS' },
    });

    // The regression this guards: with a foreign key on AuditLog.userId, the
    // SetNull cascade issues an UPDATE, the append-only trigger refuses it, and
    // this line throws — making account deletion impossible and breaking the
    // 30-day purge required by NFR-51.
    await expect(prisma.user.delete({ where: { id: throwaway.id } })).resolves.toBeTruthy();

    const survivor = await prisma.auditLog.findUnique({ where: { id: entry.id } });
    expect(survivor).not.toBeNull();
    // The pseudonymous reference outlives the User row by design.
    expect(survivor?.userId).toBe(throwaway.id);
  });

  it('issues time-ordered UUIDv7 primary keys', async () => {
    const first = await prisma.auditLog.create({
      data: { userId, event: 'LOGIN_SUCCESS', outcome: 'SUCCESS' },
    });
    const second = await prisma.auditLog.create({
      data: { userId, event: 'LOGIN_SUCCESS', outcome: 'SUCCESS' },
    });

    // Version nibble is the 15th character of a canonical UUID string.
    expect(first.id[14]).toBe('7');
    // Time-ordered: lexical order matches insertion order, which is what keeps
    // index locality good. UUIDv4 would fail this roughly half the time.
    expect(second.id > first.id).toBe(true);
  });
});
