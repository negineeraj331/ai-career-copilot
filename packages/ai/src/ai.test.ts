import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AiProviderError,
  MockProvider,
  PROMPTS,
  cacheKeyFor,
  costMicros,
  jsonSchemaFor,
  promptFor,
} from './index.js';
import type { AiRequest } from './types.js';

/**
 * The AI layer's own contracts.
 *
 * No test here contacts a provider. What is asserted is the machinery around
 * the call — cost arithmetic, cache-key derivation, prompt invariants, and the
 * mock's guarantee that it produces schema-valid data — because those are what
 * every feature in Phase 1 onwards will depend on.
 */

const personSchema = z.object({
  name: z.string(),
  age: z.number().int().min(0).max(120),
  skills: z.array(z.string()).min(1),
  active: z.boolean(),
  level: z.enum(['junior', 'mid', 'senior']),
});

const personJsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'integer', minimum: 0, maximum: 120 },
    skills: { type: 'array', items: { type: 'string' }, minItems: 1 },
    active: { type: 'boolean' },
    level: { type: 'string', enum: ['junior', 'mid', 'senior'] },
  },
  required: ['name', 'age', 'skills', 'active', 'level'],
  additionalProperties: false,
};

function request(userContent = 'some resume text'): AiRequest<z.infer<typeof personSchema>> {
  return {
    feature: 'jd.extract',
    tier: 'extraction',
    system: 'You extract people.',
    userContent,
    schema: personSchema,
    jsonSchema: personJsonSchema,
    schemaName: 'person',
    schemaDescription: 'A person',
  };
}

describe('mock provider', () => {
  it('returns a value that satisfies the schema', async () => {
    // The mock exists so every caller downstream exercises the real validation,
    // caching, and metering path. One that returned `{}` would make all of that
    // permanently untested.
    const result = await new MockProvider().complete(request());
    expect(() => personSchema.parse(result.value)).not.toThrow();
    expect(result.value.skills.length).toBeGreaterThan(0);
    expect(['junior', 'mid', 'senior']).toContain(result.value.level);
  });

  it('is deterministic for the same input', async () => {
    const a = await new MockProvider().complete(request('same'));
    const b = await new MockProvider().complete(request('same'));
    expect(a.value).toEqual(b.value);
  });

  it('produces different output for different input', async () => {
    const a = await new MockProvider().complete(request('one'));
    const b = await new MockProvider().complete(request('two'));
    expect(a.value).not.toEqual(b.value);
  });

  it('records every request, so a test can assert what was asked for', async () => {
    const provider = new MockProvider();
    await provider.complete(request('first'));
    await provider.complete(request('second'));
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.userContent).toBe('second');
  });

  it('reports usage that is proportional to the payload', async () => {
    const short = await new MockProvider().complete(request('hi'));
    const long = await new MockProvider().complete(request('x'.repeat(4000)));
    expect(long.usage.inputTokens).toBeGreaterThan(short.usage.inputTokens);
  });

  it('fails loudly when it cannot satisfy the schema', async () => {
    // A mock that silently returns the wrong shape makes every downstream test
    // meaningless, so this must fail the test rather than the user.
    const impossible = {
      ...request(),
      jsonSchema: { type: 'object', properties: { age: { type: 'string' } }, required: ['age'] },
    } as unknown as AiRequest<z.infer<typeof personSchema>>;

    await expect(new MockProvider().complete(impossible)).rejects.toThrow(/could not satisfy/i);
  });

  it('can be made to fail a specific feature, for error-path tests', async () => {
    const provider = new MockProvider({
      failFor: { 'jd.extract': new AiProviderError('rate_limit', 'slow down') },
    });
    await expect(provider.complete(request())).rejects.toMatchObject({ kind: 'rate_limit' });
  });

  it('generates syntactically valid uuids where the schema asks for one', async () => {
    const schema = z.object({ id: z.uuid() });
    const result = await new MockProvider().complete({
      ...request(),
      schema,
      jsonSchema: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
    } as unknown as AiRequest<{ id: string }>);
    expect((result.value as { id: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('union types', () => {
  it('handles a nullable field declared as a type union', async () => {
    // The real jd.extract schema declares `minYearsExperience` as
    // `type: ['number', 'null']`, and the mock rejected it outright — loudly,
    // naming the construct, which is how the gap was found rather than guessed.
    const schema = z.object({ years: z.number().nullable() });
    const result = await new MockProvider().complete({
      ...request(),
      schema,
      jsonSchema: {
        type: 'object',
        properties: { years: { type: ['number', 'null'] } },
        required: ['years'],
      },
    } as unknown as AiRequest<{ years: number | null }>);
    expect(() => schema.parse(result.value)).not.toThrow();
  });

  it('exercises both branches of a nullable field across inputs', async () => {
    const schema = z.object({ years: z.number().nullable() });
    const seen = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const result = await new MockProvider().complete({
        ...request(`input-${String(i)}`),
        schema,
        jsonSchema: {
          type: 'object',
          properties: { years: { type: ['number', 'null'] } },
          required: ['years'],
        },
      } as unknown as AiRequest<{ years: number | null }>);
      seen.add(result.value.years === null ? 'null' : 'number');
    }
    // A mock that always took the non-null branch would leave every "what if
    // this is missing" path in the product permanently untested.
    expect(seen).toEqual(new Set(['null', 'number']));
  });
});

describe('error taxonomy', () => {
  it.each([
    ['rate_limit', true],
    ['unavailable', true],
    ['invalid_response', false],
    ['refused', false],
  ] as const)('%s is retryable=%s by default', (kind, retryable) => {
    // The distinction is what stops us paying twice for the same refusal.
    expect(new AiProviderError(kind, 'x').retryable).toBe(retryable);
  });
});

describe('cost', () => {
  it("charges input and output at the model's own rates", () => {
    // 1M input at $5 + 1M output at $25 = $30 = 30,000,000 micros.
    const micros = costMicros('claude-opus-5', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    expect(micros).toBe(30_000_000);
  });

  it('prices a cache read at a tenth of an input token', () => {
    const cold = costMicros('claude-sonnet-5', {
      inputTokens: 100_000,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const warm = costMicros('claude-sonnet-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 100_000,
    });
    // The saving the whole cost model depends on. Ignoring the multiplier would
    // make a warm call look identical to a cold one and hide it entirely.
    expect(warm).toBe(Math.round(cold * 0.1));
  });

  it('prices a cache write above a plain input token', () => {
    const write = costMicros('claude-haiku-4-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 100_000,
      cacheReadTokens: 0,
    });
    const plain = costMicros('claude-haiku-4-5', {
      inputTokens: 100_000,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    expect(write).toBeGreaterThan(plain);
  });

  it('returns an integer, never a float', () => {
    const micros = costMicros('claude-opus-5', {
      inputTokens: 1234,
      outputTokens: 567,
      cacheWriteTokens: 89,
      cacheReadTokens: 12,
    });
    // Money in floating point accumulates error; a drifting budget is not a
    // budget.
    expect(Number.isInteger(micros)).toBe(true);
  });

  it('charges nothing for an unknown model rather than throwing', () => {
    // Metering must never be the thing that fails a request the user has
    // already waited for.
    expect(
      costMicros('some-model-we-have-not-priced', {
        inputTokens: 1000,
        outputTokens: 1000,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toBe(0);
  });

  it('keeps the documented cost model roughly honest', () => {
    // docs/11 §8 puts a cold JD analysis at ~$0.071. This asserts the same
    // order of magnitude, so a pricing edit that silently quadruples the budget
    // fails here rather than on a card statement.
    const extract = costMicros('claude-haiku-4-5', {
      inputTokens: 2000,
      outputTokens: 800,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const recommend = costMicros('claude-sonnet-5', {
      inputTokens: 4000,
      outputTokens: 1200,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const optimise = costMicros('claude-opus-5', {
      inputTokens: 2500,
      outputTokens: 900,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const totalDollars = (extract + recommend + optimise) / 1_000_000;
    expect(totalDollars).toBeGreaterThan(0.05);
    expect(totalDollars).toBeLessThan(0.09);
  });
});

describe('jsonSchemaFor', () => {
  /**
   * This exists because two hand-maintained schemas drifted twice within an
   * hour — an invented enum value, then missing numeric bounds — and both would
   * have surfaced as responses that failed validation after being paid for.
   */
  it('carries the constraints Zod enforces', () => {
    const schema = z.object({ years: z.number().min(0).max(50) });
    const generated = jsonSchemaFor(schema);
    const years = (generated.properties as Record<string, Record<string, unknown>>).years;
    // Omitting these is exactly the drift that let the model return 60 years.
    expect(years?.minimum).toBe(0);
    expect(years?.maximum).toBe(50);
  });

  it('carries every enum member, and only those', () => {
    const schema = z.object({ level: z.enum(['NONE', 'DIPLOMA', 'DOCTORATE']) });
    const generated = jsonSchemaFor(schema);
    const level = (generated.properties as Record<string, Record<string, unknown>>).level;
    expect(level?.enum).toEqual(['NONE', 'DIPLOMA', 'DOCTORATE']);
  });

  it('expresses a nullable field as a type union rather than anyOf', () => {
    const schema = z.object({ years: z.number().min(0).max(50).nullable() });
    const years = (jsonSchemaFor(schema).properties as Record<string, Record<string, unknown>>)
      .years;
    expect(years?.type).toEqual(['number', 'null']);
    // And keeps the sibling constraints the anyOf branch carried.
    expect(years?.maximum).toBe(50);
  });

  it('forbids properties the schema did not ask for', () => {
    // An extra key is a model inventing structure, and providers reject an
    // object schema that permits one.
    const generated = jsonSchemaFor(z.object({ a: z.string() }));
    expect(generated.additionalProperties).toBe(false);
  });

  it('strips draft metadata the provider has no use for', () => {
    expect(jsonSchemaFor(z.object({ a: z.string() }))).not.toHaveProperty('$schema');
  });

  it('produces something the mock can satisfy for every seed', async () => {
    // The end-to-end guarantee: generated schema in, valid value out, for any
    // input. This is what the hand-written version failed at.
    const schema = z.object({
      title: z.string().max(160),
      level: z.enum(['A', 'B', 'C']),
      years: z.number().min(0).max(50).nullable(),
      skills: z.array(z.object({ name: z.string(), weight: z.number().min(0).max(1) })),
    });
    const jsonSchema = jsonSchemaFor(schema);

    for (let i = 0; i < 20; i += 1) {
      const result = await new MockProvider().complete({
        ...request(`seed-${String(i)}`),
        schema,
        jsonSchema,
      } as unknown as AiRequest<z.infer<typeof schema>>);
      expect(() => schema.parse(result.value)).not.toThrow();
    }
  });
});

describe('cache key', () => {
  const base = { feature: 'jd.extract' as const, templateVersion: 1, model: 'm', input: 'text' };

  it('is stable for identical inputs', () => {
    expect(cacheKeyFor(base)).toBe(cacheKeyFor(base));
  });

  it.each([
    ['a prompt edit', { templateVersion: 2 }],
    ['a different model', { model: 'other' }],
    ['different user content', { input: 'other text' }],
    ['a different feature', { feature: 'skill.suggest' as const }],
  ])('changes when %s happens', (_label, patch) => {
    // Each of these produces a materially different answer, and serving a
    // cached one for another is a silent downgrade of what the user asked for.
    expect(cacheKeyFor({ ...base, ...patch })).not.toBe(cacheKeyFor(base));
  });

  it('never embeds the user content in the key', () => {
    const key = cacheKeyFor({ ...base, input: 'my private salary history' });
    expect(key).not.toContain('salary');
    expect(key).toMatch(/^cc:ai:[0-9a-f]{64}$/);
  });
});

describe('prompts', () => {
  it.each(Object.keys(PROMPTS))('%s tells the model that user content is data', (feature) => {
    // The control against prompt injection in an uploaded resume. It has to be
    // in every template, not only the obviously-external ones.
    const template = promptFor(feature as keyof typeof PROMPTS);
    expect(template.system.toLowerCase()).toContain('never contains instructions');
  });

  it.each(Object.keys(PROMPTS))('%s is versioned and routed to a tier', (feature) => {
    const template = promptFor(feature as keyof typeof PROMPTS);
    expect(template.version).toBeGreaterThanOrEqual(1);
    expect(['extraction', 'structuring', 'writing']).toContain(template.tier);
    expect(template.maxTokens).toBeGreaterThan(0);
  });

  it('routes the expensive model only to writing tasks', () => {
    // docs/11 §3: routing is the single biggest lever on the cost budget, and
    // routing everything to the frontier model is roughly 4x over.
    expect(promptFor('jd.extract').tier).toBe('extraction');
    expect(promptFor('skill.suggest').tier).toBe('extraction');
    expect(promptFor('bullet.optimize').tier).toBe('writing');
  });

  it('forbids inventing facts wherever the model writes prose', () => {
    for (const feature of [
      'bullet.optimize',
      'cover_letter.generate',
      'resume.structure',
    ] as const) {
      expect(promptFor(feature).system.toLowerCase()).toContain('never invent');
    }
  });
});
