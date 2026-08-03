import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

loadEnv({ path: ['../../.env', '.env'], quiet: true });

/**
 * Development seed. Creates the accounts needed to exercise the auth flows by
 * hand without registering through the UI every time.
 *
 * Idempotent — safe to re-run. Uses upsert on email so repeated runs converge
 * rather than colliding on the unique index.
 */

// OWASP minimum for argon2id. Mirrored in the auth service; when that lands,
// both should import a single shared constant rather than duplicating it.
const ARGON2_OPTIONS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

const DEMO_PASSWORD = 'correct horse battery staple';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database.');
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const passwordHash = await hash(DEMO_PASSWORD, ARGON2_OPTIONS);
    const now = new Date();

    const candidate = await prisma.user.upsert({
      where: { email: 'aditi@example.com' },
      update: {},
      create: {
        email: 'aditi@example.com',
        name: 'Aditi Sharma',
        passwordHash,
        emailVerifiedAt: now,
        role: 'CANDIDATE',
        tier: 'FREE',
      },
    });

    const pro = await prisma.user.upsert({
      where: { email: 'rohan@example.com' },
      update: {},
      create: {
        email: 'rohan@example.com',
        name: 'Rohan Mehta',
        passwordHash,
        emailVerifiedAt: now,
        role: 'CANDIDATE',
        tier: 'PRO',
      },
    });

    // Unverified on purpose: the verification-gate path needs a subject.
    const unverified = await prisma.user.upsert({
      where: { email: 'unverified@example.com' },
      update: {},
      create: {
        email: 'unverified@example.com',
        name: 'Unverified User',
        passwordHash,
        role: 'CANDIDATE',
        tier: 'FREE',
      },
    });

    const admin = await prisma.user.upsert({
      where: { email: 'admin@example.com' },
      update: {},
      create: {
        email: 'admin@example.com',
        name: 'Platform Admin',
        passwordHash,
        emailVerifiedAt: now,
        role: 'ADMIN',
        tier: 'TEAM',
      },
    });

    // A device session + refresh token for the candidate, so session-listing and
    // rotation can be exercised without going through a full login first.
    const existingSession = await prisma.deviceSession.findFirst({
      where: { userId: candidate.id, revokedAt: null },
    });

    if (!existingSession) {
      const session = await prisma.deviceSession.create({
        data: {
          userId: candidate.id,
          userAgent: 'Seed/1.0 (macOS; Chrome)',
          ipPrefix: '127.0.0.x',
          deviceLabel: 'Seeded device',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await prisma.refreshToken.create({
        data: {
          userId: candidate.id,
          sessionId: session.id,
          familyId: randomUUID(),
          // A placeholder hash: the raw token is never stored, and this seeded
          // one is deliberately not derivable from anything usable.
          tokenHash: `seed-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    }

    // Conditional, not upserted: AuditLog is append-only, so there is no update
    // path to converge on. Writing unconditionally would grow the table by one
    // row per seed run and quietly break this script's idempotency claim.
    const seededAudit = await prisma.auditLog.findFirst({
      where: { userId: candidate.id, event: 'REGISTER' },
    });

    if (!seededAudit) {
      await prisma.auditLog.create({
        data: {
          userId: candidate.id,
          event: 'REGISTER',
          outcome: 'SUCCESS',
          ipPrefix: '127.0.0.x',
          userAgent: 'Seed/1.0',
          metadata: { source: 'seed' },
        },
      });
    }

    const counts = {
      users: await prisma.user.count(),
      sessions: await prisma.deviceSession.count(),
      auditEntries: await prisma.auditLog.count(),
    };

    process.stdout.write(
      [
        'Seed complete.',
        `  users        : ${counts.users}`,
        `  sessions     : ${counts.sessions}`,
        `  audit entries: ${counts.auditEntries}`,
        '',
        'Accounts (all share the same password):',
        `  ${candidate.email}    CANDIDATE / FREE, verified`,
        `  ${pro.email}    CANDIDATE / PRO, verified`,
        `  ${unverified.email}  CANDIDATE / FREE, UNVERIFIED`,
        `  ${admin.email}     ADMIN / TEAM, verified`,
        `  password: ${DEMO_PASSWORD}`,
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${String(error)}\n`);
  process.exitCode = 1;
});
