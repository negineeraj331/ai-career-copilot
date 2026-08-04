import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/*.test.ts'],
      /**
       * Measured before being set: 95.8% lines, 91.4% statements, 89.5%
       * functions, 80.8% branches. The gates sit below those so an honest
       * refactor does not fail the build.
       *
       * The Anthropic adapter is included rather than excluded. Its transport
       * cannot be exercised without contacting a real provider — which no test
       * here does — but everything it is actually responsible for can be: the
       * request shape that makes prompt caching work, the forced tool choice,
       * response extraction, and the error mapping that decides whether we pay
       * for a second attempt. Those are tested against a fabricated SDK.
       */
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 75 },
    },
  },
});
