import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env automatically and no longer accepts `url` in the
// datasource block, so the connection string is wired up here for the CLI.
//
// Note the split: this config serves the *CLI* (migrate, studio, introspect),
// which wants a plain URL. The *runtime* client is constructed separately with a
// driver adapter — see prisma/seed.ts and (from slice 0.4) src/core/db/prisma.ts.
// There is no `adapter` key on PrismaConfig; putting one here compiles to nothing.
loadEnv({ path: ['../../.env', '.env'], quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Empty string rather than a throw: the CLI loads this file for commands
    // like `prisma format` that need no database at all. Commands that do need
    // one fail with Prisma's own clear message.
    url: process.env.DATABASE_URL ?? '',
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
