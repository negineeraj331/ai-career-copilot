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
  },
});
