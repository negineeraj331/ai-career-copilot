import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env.js';
import { loggerFor } from '../logger/logger.js';

const log = loggerFor('prisma');

let client: PrismaClient | undefined;

/**
 * Prisma client singleton.
 *
 * Prisma 7 requires a driver adapter — the connection string is no longer read
 * from the schema. See apps/api/prisma.config.ts for the CLI side of the same
 * split.
 */
export function prisma(): PrismaClient {
  if (client) return client;

  client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env().DATABASE_URL }),
    log: env().NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  return client;
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await prisma().$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    log.warn({ err: error }, 'database ping failed');
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  if (!client) return;
  await client.$disconnect();
  client = undefined;
}
