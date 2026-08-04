import {
  AiProviderError,
  AnthropicProvider,
  MockProvider,
  cacheKeyFor,
  costMicros,
  promptFor,
  type AiFeature,
  type AiProvider,
} from '@cc/ai';
import type { z } from 'zod';
import { env } from '../../config/env.js';
import { AiUnavailableError, UnprocessableError } from '../../core/errors/app-error.js';
import { prisma } from '../../core/db/prisma.js';
import { loggerFor } from '../../core/logger/logger.js';
import { redis } from '../../core/redis/client.js';
import { reserve, type Tier } from './quota.service.js';

/**
 * The AI service layer (docs/03 §3.2): quota → cache → dispatch → validate →
 * meter, in that order.
 *
 * The order is the design. Quota first so a rejected request never costs
 * anything. Cache second so an unchanged input is free and does not consume
 * quota either. Metering last and unconditional, because a call that failed
 * still cost money and a budget that only counts successes understates itself.
 */

const log = loggerFor('ai-service');

const CACHE_TTL_SECONDS = 24 * 60 * 60;

let provider: AiProvider | undefined;

export function aiProvider(): AiProvider {
  if (provider) return provider;

  if (env().AI_PROVIDER === 'anthropic') {
    const apiKey = env().ANTHROPIC_API_KEY;
    // Checked at first use rather than at boot: the API serves plenty of
    // traffic that never touches AI, and refusing to start over a missing key
    // would take the whole service down for a feature most requests do not use.
    if (!apiKey) throw new AiUnavailableError('The AI provider is not configured.');

    provider = new AnthropicProvider({
      apiKey,
      models: {
        extraction: env().AI_MODEL_EXTRACTION,
        structuring: env().AI_MODEL_STRUCTURING,
        writing: env().AI_MODEL_WRITING,
      },
    });
  } else {
    provider = new MockProvider();
  }

  return provider;
}

/** Test seam. Swapping the provider is how features are tested without a key. */
export function setAiProvider(next: AiProvider | undefined): void {
  provider = next;
}

export interface RunOptions<T> {
  feature: AiFeature;
  userId: string;
  tier: Tier;
  /** The user's own content. Also the cache input, so it must be stable. */
  input: string;
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  schemaDescription: string;
}

export interface RunResult<T> {
  value: T;
  cached: boolean;
  costMicros: number;
  model: string;
}

export async function run<T>(options: RunOptions<T>): Promise<RunResult<T>> {
  const template = promptFor(options.feature);
  const active = aiProvider();
  const model = active.modelFor(template.tier);

  const key = cacheKeyFor({
    feature: options.feature,
    templateVersion: template.version,
    model,
    input: options.input,
  });

  // Cache before quota: a repeat of an unchanged request is free to serve and
  // must not spend a unit the user could have used on something new.
  const hit = await readCache<T>(key, options.schema);
  if (hit) {
    await meter({
      userId: options.userId,
      feature: options.feature,
      template,
      provider: active.name,
      model,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      cost: 0,
      latencyMs: 0,
      cacheHit: true,
      success: true,
    });
    return { value: hit, cached: true, costMicros: 0, model };
  }

  const reservation = await reserve(options.userId, options.tier);

  try {
    const result = await active.complete({
      feature: options.feature,
      tier: template.tier,
      system: template.system,
      userContent: options.input,
      schema: options.schema,
      jsonSchema: options.jsonSchema,
      schemaName: options.schemaName,
      schemaDescription: options.schemaDescription,
      maxTokens: template.maxTokens,
    });

    const cost = costMicros(result.model, result.usage);

    await Promise.all([
      writeCache(key, result.value),
      meter({
        userId: options.userId,
        feature: options.feature,
        template,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        cost,
        latencyMs: result.latencyMs,
        cacheHit: false,
        success: true,
      }),
    ]);

    return { value: result.value, cached: false, costMicros: cost, model: result.model };
  } catch (error) {
    const providerError = error instanceof AiProviderError ? error : undefined;

    // The unit goes back only when nothing was actually paid for. A refusal or
    // a schema violation means the provider ran the call and billed us, so
    // returning the quota there would let a user with malformed input consume
    // real money without limit.
    const paidFor = providerError?.kind === 'refused' || providerError?.kind === 'invalid_response';
    if (!paidFor) await reservation.release();

    await meter({
      userId: options.userId,
      feature: options.feature,
      template,
      provider: active.name,
      model,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      cost: 0,
      latencyMs: 0,
      cacheHit: false,
      success: false,
      errorCode: providerError?.kind ?? 'unknown',
    });

    log.error({ err: error, feature: options.feature, model }, 'AI call failed');
    throw toUserFacing(providerError);
  }
}

function toUserFacing(error: AiProviderError | undefined): Error {
  switch (error?.kind) {
    case 'refused':
      return new UnprocessableError(
        'The assistant could not work with this content. Try rephrasing it.',
      );
    case 'invalid_response':
      return new AiUnavailableError('The assistant returned something unusable. Please try again.');
    default:
      // Everything else is "the provider is having a bad time", which is a 503
      // and explicitly says the rest of the product still works — an AI outage
      // must not read as a total outage.
      return new AiUnavailableError();
  }
}

async function readCache<T>(key: string, schema: z.ZodType<T>): Promise<T | undefined> {
  try {
    const raw = await redis().get(key);
    if (!raw) return undefined;
    // Re-validated on the way out. A cached value was written by a previous
    // deployment, possibly under a schema that has since changed, and trusting
    // it would surface as a rendering crash far from the cause.
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    // A cache miss is always safe. Failing the request because Redis is
    // unreachable would turn a cost optimisation into an availability risk.
    log.warn({ err: error }, 'AI cache read failed; treating as a miss');
    return undefined;
  }
}

async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    await redis().set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
  } catch (error) {
    log.warn({ err: error }, 'AI cache write failed; the result is still returned');
  }
}

async function meter(params: {
  userId: string;
  feature: AiFeature;
  template: { feature: string; version: number };
  provider: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  cost: number;
  latencyMs: number;
  cacheHit: boolean;
  success: boolean;
  errorCode?: string;
}): Promise<void> {
  try {
    await prisma().aiUsageLog.create({
      data: {
        userId: params.userId,
        feature: params.feature,
        promptTemplate: params.template.feature,
        templateVersion: params.template.version,
        provider: params.provider,
        model: params.model,
        inputTokens: params.usage.inputTokens,
        outputTokens: params.usage.outputTokens,
        cacheReadTokens: params.usage.cacheReadTokens,
        cacheWriteTokens: params.usage.cacheWriteTokens,
        costMicros: params.cost,
        latencyMs: params.latencyMs,
        cacheHit: params.cacheHit,
        success: params.success,
        ...(params.errorCode ? { errorCode: params.errorCode } : {}),
      },
    });
  } catch (error) {
    // Metering must never fail a request the user has already waited for. The
    // gap shows up as a missing row, which is visible in the cost dashboard.
    log.error({ err: error, feature: params.feature }, 'failed to record AI usage');
  }
}

/** What a user has spent this month — the number the budget is judged against. */
export async function costSummary(userId: string): Promise<{
  calls: number;
  cacheHits: number;
  costMicros: number;
}> {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await prisma().aiUsageLog.findMany({
    where: { userId, createdAt: { gte: since } },
    select: { costMicros: true, cacheHit: true },
  });

  return {
    calls: rows.length,
    cacheHits: rows.filter((r) => r.cacheHit).length,
    costMicros: rows.reduce((sum, r) => sum + r.costMicros, 0),
  };
}
