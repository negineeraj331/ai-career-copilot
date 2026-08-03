import { z } from 'zod';

/**
 * Environment validation (TR-01).
 *
 * Every variable the service reads is declared here and validated once, at boot.
 * A missing or malformed value crashes the process immediately with a readable
 * message rather than surfacing later as a confusing runtime failure under load
 * — a service must never run half-configured.
 */

const nodeEnvSchema = z.enum(['development', 'test', 'production']);

/** Base64-encoded 32 bytes, for AES-256-GCM. Checked by decoded length, not by
 *  string length, because base64 padding makes the encoded length misleading. */
const encryptionKeySchema = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'Must be 32 bytes, base64-encoded');

const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema.default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    API_URL: z.url(),
    WEB_URL: z.url(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),

    JWT_SECRET: z
      .string()
      .min(32, 'Use at least 32 characters; generate with `openssl rand -base64 48`'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
    JWT_REFRESH_TTL_REMEMBER_DAYS: z.coerce.number().int().positive().default(30),
    ENCRYPTION_KEY: encryptionKeySchema,

    COOKIE_DOMAIN: z.string().default('localhost'),
    ALLOW_UNVERIFIED_LOGIN: z.stringbool().default(false),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),

    AI_PROVIDER: z.enum(['mock', 'anthropic', 'openai']).default('mock'),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    AI_MODEL_EXTRACTION: z.string().default('claude-haiku-4-5'),
    AI_MODEL_STRUCTURING: z.string().default('claude-sonnet-5'),
    AI_MODEL_WRITING: z.string().default('claude-opus-5'),

    EMBEDDING_PROVIDER: z.string().default('mock'),
    EMBEDDING_API_KEY: z.string().optional(),
    EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),

    STORAGE_ENDPOINT: z.string().optional(),
    STORAGE_REGION: z.string().default('us-east-1'),
    STORAGE_ACCESS_KEY_ID: z.string().optional(),
    STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
    STORAGE_BUCKET_UPLOADS: z.string().default('cc-uploads'),
    STORAGE_BUCKET_EXPORTS: z.string().default('cc-exports'),
    STORAGE_FORCE_PATH_STYLE: z.stringbool().default(true),

    SMTP_HOST: z.string().default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_SECURE: z.stringbool().default(false),
    MAIL_FROM: z.string().default('Career Copilot <noreply@careercopilot.local>'),

    QUOTA_FREE_AI_ACTIONS: z.coerce.number().int().nonnegative().default(10),
    QUOTA_FREE_RESUMES: z.coerce.number().int().nonnegative().default(2),
    QUOTA_PRO_AI_ACTIONS: z.coerce.number().int().nonnegative().default(500),

    SENTRY_DSN: z.string().optional(),
    METRICS_ENABLED: z.stringbool().default(true),
  })
  // Cross-field rules the per-field schemas cannot express. Catching these at
  // boot beats discovering at the first AI request that the key was never set.
  .refine((e) => e.AI_PROVIDER !== 'anthropic' || Boolean(e.ANTHROPIC_API_KEY), {
    message: 'ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic',
    path: ['ANTHROPIC_API_KEY'],
  })
  .refine((e) => e.AI_PROVIDER !== 'openai' || Boolean(e.OPENAI_API_KEY), {
    message: 'OPENAI_API_KEY is required when AI_PROVIDER=openai',
    path: ['OPENAI_API_KEY'],
  })
  .refine((e) => e.NODE_ENV !== 'production' || !e.ALLOW_UNVERIFIED_LOGIN, {
    message: 'ALLOW_UNVERIFIED_LOGIN must be false in production',
    path: ['ALLOW_UNVERIFIED_LOGIN'],
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.AI_PROVIDER !== 'mock', {
    message: 'AI_PROVIDER=mock in production would silently serve fixture data to real users',
    path: ['AI_PROVIDER'],
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Parse and cache the environment.
 *
 * Throws with every problem listed at once — reporting one missing variable per
 * restart turns a two-minute fix into a twenty-minute one.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}\n`);
  }

  cached = result.data;
  return cached;
}

export function env(): Env {
  if (!cached) return loadEnv();
  return cached;
}

/** Test-only: drop the cache so a test can load a different environment. */
export function resetEnvCache(): void {
  cached = undefined;
}

export const isProduction = (): boolean => env().NODE_ENV === 'production';
export const isTest = (): boolean => env().NODE_ENV === 'test';
