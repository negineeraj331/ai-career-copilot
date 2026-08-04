import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AiProviderError, MockProvider } from '@cc/ai';
import { closeDatabase, prisma } from '../src/core/db/prisma.js';
import { closeRedis, redis } from '../src/core/redis/client.js';
import { run, setAiProvider, costSummary } from '../src/modules/ai/ai.service.js';
import { reserve, usage } from '../src/modules/ai/quota.service.js';

/**
 * The AI service layer against real Redis and Postgres.
 *
 * What is being tested is the money: that a rejected request never pays, that
 * an unchanged request is free, and that every call — including the failed ones
 * — leaves a row behind. A mocked Redis would make the quota tests assert that
 * we call INCR, which is not the question; the question is whether two
 * concurrent requests can both slip past a limit of one.
 */

const schema = z.object({ summary: z.string(), score: z.number().int().min(0).max(100) });
const jsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    score: { type: 'integer', minimum: 0, maximum: 100 },
  },
  required: ['summary', 'score'],
  additionalProperties: false,
};

function options(userId: string, input = 'some content', tier: 'FREE' | 'PRO' = 'PRO') {
  return {
    feature: 'jd.extract' as const,
    userId,
    tier,
    input,
    schema,
    jsonSchema,
    schemaName: 'extraction',
    schemaDescription: 'An extraction',
  };
}

let userId: string;

beforeEach(async () => {
  userId = randomUUID();
  setAiProvider(new MockProvider());
  // Quota and cache keys are namespaced, so clearing ours cannot disturb
  // another suite running against the same Redis.
  const keys = await redis().keys('cc:ai:*');
  const quota = await redis().keys('cc:quota:ai:*');
  if ([...keys, ...quota].length > 0) await redis().del(...keys, ...quota);
});

afterEach(() => {
  setAiProvider(undefined);
});

afterAll(async () => {
  await prisma().aiUsageLog.deleteMany({ where: { feature: 'jd.extract' } });
  await Promise.all([closeDatabase(), closeRedis()]);
});

describe('the happy path', () => {
  it('returns a schema-valid value and records what it cost', async () => {
    const result = await run(options(userId));

    expect(() => schema.parse(result.value)).not.toThrow();
    expect(result.cached).toBe(false);
    expect(result.model).toBe('mock-extraction');

    const rows = await prisma().aiUsageLog.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.success).toBe(true);
    expect(rows[0]?.inputTokens).toBeGreaterThan(0);
    expect(rows[0]?.promptTemplate).toBe('jd.extract');
    expect(rows[0]?.templateVersion).toBe(1);
  });
});

describe('caching', () => {
  it('serves an unchanged request from cache without calling the provider', async () => {
    const provider = new MockProvider();
    setAiProvider(provider);

    const first = await run(options(userId, 'identical'));
    const second = await run(options(userId, 'identical'));

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.value).toEqual(first.value);
    // The provider was asked exactly once. This is the saving the whole cost
    // model depends on.
    expect(provider.calls).toHaveLength(1);
  });

  it('does not spend quota on a cache hit', async () => {
    await run(options(userId, 'identical', 'FREE'));
    const afterFirst = await usage(userId, 'FREE');

    await run(options(userId, 'identical', 'FREE'));
    const afterSecond = await usage(userId, 'FREE');

    // A repeat of something already answered must not cost the user a unit they
    // could have spent on something new.
    expect(afterSecond.used).toBe(afterFirst.used);
  });

  it('records a cache hit as a call that cost nothing', async () => {
    await run(options(userId, 'identical'));
    await run(options(userId, 'identical'));

    const rows = await prisma().aiUsageLog.findMany({ where: { userId } });
    expect(rows).toHaveLength(2);
    const cached = rows.find((r) => r.cacheHit);
    expect(cached?.costMicros).toBe(0);
    expect(cached?.success).toBe(true);
  });

  it('treats different content as a different question', async () => {
    const provider = new MockProvider();
    setAiProvider(provider);
    await run(options(userId, 'one'));
    await run(options(userId, 'two'));
    expect(provider.calls).toHaveLength(2);
  });
});

describe('quota', () => {
  it('refuses once the allowance is spent, before touching the provider', async () => {
    const provider = new MockProvider();
    setAiProvider(provider);
    const limit = (await usage(userId, 'FREE')).limit;

    for (let i = 0; i < limit; i += 1) {
      await run(options(userId, `unique-${String(i)}`, 'FREE'));
    }
    const callsBefore = provider.calls.length;

    await expect(run(options(userId, 'one-too-many', 'FREE'))).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });

    // Never pay for a call we are going to reject.
    expect(provider.calls).toHaveLength(callsBefore);
  });

  it('does not let concurrent requests slip past the limit', async () => {
    // The reason the counter is a Lua INCR rather than read-then-write. With a
    // read-then-write, every one of these sees the same count and proceeds.
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        reserve(userId, 'FREE').then((r) => ({ index: i, used: r.used })),
      ),
    );

    const granted = results.filter((r) => r.status === 'fulfilled');
    const limit = (await usage(userId, 'FREE')).limit;
    expect(granted).toHaveLength(limit);

    // And each got a distinct slot, so nothing double-counted.
    const slots = granted.map((r) => (r as PromiseFulfilledResult<{ used: number }>).value.used);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('gives the unit back when the provider was never actually paid', async () => {
    setAiProvider(
      new MockProvider({
        failFor: { 'jd.extract': new AiProviderError('unavailable', 'provider down') },
      }),
    );

    const before = await usage(userId, 'FREE');
    await expect(run(options(userId, 'x', 'FREE'))).rejects.toThrow();
    const after = await usage(userId, 'FREE');

    // A provider outage must not silently burn a user's month.
    expect(after.used).toBe(before.used);
  });

  it('keeps the unit when the provider ran the call and billed us', async () => {
    setAiProvider(
      new MockProvider({
        failFor: { 'jd.extract': new AiProviderError('refused', 'declined') },
      }),
    );

    const before = await usage(userId, 'FREE');
    await expect(run(options(userId, 'x', 'FREE'))).rejects.toThrow();
    const after = await usage(userId, 'FREE');

    // A refusal was generated and billed. Refunding here would let malformed
    // input consume real money without limit.
    expect(after.used).toBe(before.used + 1);
  });

  it('gives a pro account a larger allowance than a free one', async () => {
    const free = await usage(randomUUID(), 'FREE');
    const pro = await usage(randomUUID(), 'PRO');
    expect(pro.limit).toBeGreaterThan(free.limit);
  });
});

describe('failure', () => {
  it('records a failed call, because it still cost money', async () => {
    setAiProvider(
      new MockProvider({
        failFor: { 'jd.extract': new AiProviderError('rate_limit', 'slow down') },
      }),
    );

    await expect(run(options(userId))).rejects.toThrow();

    const rows = await prisma().aiUsageLog.findMany({ where: { userId } });
    // A budget that counts only successes understates itself.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.success).toBe(false);
    expect(rows[0]?.errorCode).toBe('rate_limit');
  });

  it('translates a provider refusal into something a user can act on', async () => {
    setAiProvider(
      new MockProvider({ failFor: { 'jd.extract': new AiProviderError('refused', 'no') } }),
    );
    await expect(run(options(userId))).rejects.toMatchObject({ code: 'UNPROCESSABLE' });
  });

  it('reports an outage as a 503 that says the rest still works', async () => {
    setAiProvider(
      new MockProvider({ failFor: { 'jd.extract': new AiProviderError('unavailable', 'down') } }),
    );
    await expect(run(options(userId))).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
      status: 503,
    });
  });

  it("does not leak the provider's own error text to the user", async () => {
    setAiProvider(
      new MockProvider({
        failFor: {
          'jd.extract': new AiProviderError(
            'unknown',
            'sk-ant-key-rejected at line 42 of vendor.js',
          ),
        },
      }),
    );

    await expect(run(options(userId))).rejects.not.toMatchObject({
      message: expect.stringContaining('sk-ant'),
    });
  });
});

describe('cost summary', () => {
  it('adds up the month, separating the calls that were free', async () => {
    await run(options(userId, 'a'));
    await run(options(userId, 'a')); // cached
    await run(options(userId, 'b'));

    const summary = await costSummary(userId);
    expect(summary.calls).toBe(3);
    expect(summary.cacheHits).toBe(1);
    expect(summary.costMicros).toBeGreaterThanOrEqual(0);
  });
});
