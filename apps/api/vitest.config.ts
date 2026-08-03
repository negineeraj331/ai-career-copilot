import { defineConfig } from 'vitest/config';
import { config as loadEnv } from 'dotenv';

// Integration tests talk to the real Postgres from docker-compose. Mocking an
// ORM would prove nothing about the database constraints we actually rely on.
loadEnv({ path: ['../../.env', '.env'], quiet: true });

export default defineConfig({
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test' },
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Database-backed tests share one schema; running files in parallel would
    // make them fight over rows. Revisit with per-worker schemas if this gets slow.
    fileParallelism: false,
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts', // entrypoint: wiring, exercised by running the server
        'src/**/*.test.ts',
        'src/**/*.types.ts',
        'src/generated/**', // generated Prisma client
      ],
      /**
       * Thresholds are set a few points BELOW what is currently achieved
       * (91.0% lines overall, 94.7% auth, 97.7% security — measured, not
       * aspirational). The gap is deliberate: a gate pinned exactly at the
       * current number fails on any honest refactor that happens to add an
       * unhit branch, and a gate people routinely lower is not a gate. These
       * catch a real regression without crying wolf.
       */
      thresholds: {
        lines: 85,
        statements: 85,
        functions: 85,
        // Branches lag the rest because most uncovered ones are defensive
        // fallbacks on third-party responses. Tracked, not ignored.
        branches: 65,
        'src/modules/auth/**': { lines: 90, functions: 88 },
        'src/core/security/**': { lines: 92, functions: 90 },
      },
    },
  },
});
