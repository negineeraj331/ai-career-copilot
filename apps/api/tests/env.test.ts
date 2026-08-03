import { beforeEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../src/config/env.js';

/** A valid baseline each test mutates one field of, so a failure names exactly
 *  one cause instead of leaving you to diff two large objects. */
function baseEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    PORT: '4000',
    API_URL: 'http://localhost:4000',
    WEB_URL: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://cc:pw@localhost:55432/career_copilot',
    REDIS_URL: 'redis://localhost:56379',
    JWT_SECRET: 'a'.repeat(48),
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  };
}

describe('environment validation', () => {
  beforeEach(() => resetEnvCache());

  it('accepts a minimal valid environment and applies defaults', () => {
    const env = loadEnv(baseEnv());
    expect(env.PORT).toBe(4000);
    expect(env.AI_PROVIDER).toBe('mock');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.JWT_REFRESH_TTL_DAYS).toBe(7);
  });

  it('coerces numeric strings, since every env var arrives as a string', () => {
    const env = loadEnv({ ...baseEnv(), PORT: '8080', EMBEDDING_DIMENSIONS: '768' });
    expect(env.PORT).toBe(8080);
    expect(env.EMBEDDING_DIMENSIONS).toBe(768);
  });

  it('parses booleans from strings', () => {
    expect(loadEnv({ ...baseEnv(), METRICS_ENABLED: 'false' }).METRICS_ENABLED).toBe(false);
    resetEnvCache();
    expect(loadEnv({ ...baseEnv(), METRICS_ENABLED: 'true' }).METRICS_ENABLED).toBe(true);
  });

  it('rejects a missing required variable', () => {
    const env = baseEnv();
    delete env.DATABASE_URL;
    expect(() => loadEnv(env)).toThrow(/DATABASE_URL/);
  });

  it('reports every problem at once, not just the first', () => {
    const env = baseEnv();
    delete env.DATABASE_URL;
    delete env.JWT_SECRET;
    env.API_URL = 'not-a-url';

    // One restart per missing variable turns a two-minute fix into a long one.
    try {
      loadEnv(env);
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = String(error);
      expect(message).toMatch(/DATABASE_URL/);
      expect(message).toMatch(/JWT_SECRET/);
      expect(message).toMatch(/API_URL/);
    }
  });

  it('rejects a short JWT secret', () => {
    expect(() => loadEnv({ ...baseEnv(), JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects an encryption key that is not 32 decoded bytes', () => {
    // Base64 padding makes encoded length misleading, so the check decodes.
    const sixteenBytes = Buffer.alloc(16, 1).toString('base64');
    expect(() => loadEnv({ ...baseEnv(), ENCRYPTION_KEY: sixteenBytes })).toThrow(/ENCRYPTION_KEY/);
  });

  it('accepts exactly 32 decoded bytes', () => {
    const key = Buffer.alloc(32, 1).toString('base64');
    expect(() => loadEnv({ ...baseEnv(), ENCRYPTION_KEY: key })).not.toThrow();
  });

  describe('cross-field rules', () => {
    it('requires an Anthropic key when that provider is selected', () => {
      expect(() => loadEnv({ ...baseEnv(), AI_PROVIDER: 'anthropic' })).toThrow(
        /ANTHROPIC_API_KEY/,
      );
    });

    it('accepts the Anthropic provider once its key is present', () => {
      expect(() =>
        loadEnv({ ...baseEnv(), AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-test' }),
      ).not.toThrow();
    });

    it('refuses unverified login in production', () => {
      expect(() =>
        loadEnv({
          ...baseEnv(),
          NODE_ENV: 'production',
          ALLOW_UNVERIFIED_LOGIN: 'true',
          AI_PROVIDER: 'anthropic',
          ANTHROPIC_API_KEY: 'sk-ant-test',
        }),
      ).toThrow(/ALLOW_UNVERIFIED_LOGIN/);
    });

    it('refuses the mock AI provider in production', () => {
      // Otherwise real users would be served fixture data with no error anywhere.
      expect(() => loadEnv({ ...baseEnv(), NODE_ENV: 'production' })).toThrow(/AI_PROVIDER/);
    });
  });
});
