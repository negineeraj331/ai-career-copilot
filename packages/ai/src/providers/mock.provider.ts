import { createHash } from 'node:crypto';
import {
  AiProviderError,
  type AiCallResult,
  type AiProvider,
  type AiRequest,
  type ModelTier,
} from '../types.js';

/**
 * The deterministic provider used by tests and offline development.
 *
 * It is not a stub that returns `{}`. It builds a value that actually satisfies
 * the requested JSON Schema, so every caller — validation, caching, metering,
 * the UI rendering the result — exercises the same path it would in production.
 * A mock that returns something the schema rejects would make the tests assert
 * the error path forever without anyone noticing.
 *
 * Deterministic by construction: the same request produces the same output, so
 * a test can assert on the value rather than merely that a call happened. No
 * test in this repository ever contacts a real provider.
 */

export interface MockProviderOptions {
  /** Feature names that should fail, for exercising error paths. */
  failFor?: Partial<Record<string, AiProviderError>>;
  /** Simulated latency, so timeout and ordering logic can be tested. */
  latencyMs?: number;
}

export class MockProvider implements AiProvider {
  readonly name = 'mock';
  private readonly options: MockProviderOptions;
  /** Every request seen, so tests can assert what was actually asked for. */
  readonly calls: AiRequest<unknown>[] = [];

  constructor(options: MockProviderOptions = {}) {
    this.options = options;
  }

  modelFor(tier: ModelTier): string {
    return `mock-${tier}`;
  }

  async complete<T>(request: AiRequest<T>): Promise<AiCallResult<T>> {
    this.calls.push(request as AiRequest<unknown>);

    const failure = this.options.failFor?.[request.feature];
    if (failure) throw failure;

    if (this.options.latencyMs) {
      await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
    }

    // A stable seed from the request, so identical input gives identical output
    // and different input gives different output — both of which tests rely on.
    const seed = createHash('sha256')
      .update(`${request.feature}:${request.userContent}`)
      .digest('hex');

    const value = buildFromSchema(request.jsonSchema, seed);
    const parsed = request.schema.safeParse(value);
    if (!parsed.success) {
      // Loud on purpose. A mock that silently returns schema-violating data
      // makes every test downstream meaningless, so this fails the test rather
      // than the user.
      throw new AiProviderError(
        'invalid_response',
        `The mock provider could not satisfy the ${request.schemaName} schema. ` +
          `Either the schema uses a construct buildFromSchema does not handle, or it disagrees with the Zod schema. ` +
          `Issues: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }

    const inputTokens = Math.ceil((request.system.length + request.userContent.length) / 4);
    return {
      value: parsed.data,
      usage: {
        inputTokens,
        outputTokens: Math.ceil(JSON.stringify(value).length / 4),
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      },
      model: this.modelFor(request.tier),
      provider: this.name,
      latencyMs: this.options.latencyMs ?? 1,
      cached: false,
    };
  }
}

/**
 * Builds a value satisfying a JSON Schema.
 *
 * Handles the subset this product's schemas actually use — objects, arrays,
 * strings, numbers, booleans, enums, and `const`. Anything else throws rather
 * than guessing, because a mock that quietly returns the wrong shape is worse
 * than one that stops and says so.
 */
function buildFromSchema(schema: Record<string, unknown>, seed: string, depth = 0): unknown {
  if (depth > 8) throw new Error('Schema nested too deeply for the mock provider.');

  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const index = parseInt(seed.slice(depth * 2, depth * 2 + 2), 16) % schema.enum.length;
    return schema.enum[index];
  }

  // JSON Schema allows a union of types, and the real schemas use it for
  // nullable fields (`type: ['number', 'null']`). One member is chosen from the
  // seed rather than always taking the first, so both branches of a nullable
  // field get exercised across different inputs — a mock that always returned
  // the non-null form would leave every "what if this is null" path untested.
  if (Array.isArray(schema.type)) {
    const types = schema.type as string[];
    const pick = types[parseInt(seed.slice(0, 2), 16) % types.length] ?? types[0];
    return buildFromSchema({ ...schema, type: pick }, `${seed}u`, depth);
  }

  switch (schema.type) {
    case 'object': {
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      const required = new Set((schema.required as string[] | undefined) ?? []);
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(properties)) {
        // Optional properties are populated too: leaving them out would mean
        // the mock only ever exercises the sparse path, and the rendering code
        // that reads them would go untested.
        out[key] = buildFromSchema(child, `${seed}${key}`, depth + 1);
      }
      for (const key of required) {
        if (!(key in out)) out[key] = `mock-${key}`;
      }
      return out;
    }

    case 'array': {
      const items = (schema.items ?? { type: 'string' }) as Record<string, unknown>;
      const min = typeof schema.minItems === 'number' ? schema.minItems : 1;
      const count = Math.max(min, 2);
      return Array.from({ length: count }, (_, i) =>
        buildFromSchema(items, `${seed}${String(i)}`, depth + 1),
      );
    }

    case 'string': {
      if (schema.format === 'uuid') return uuidFrom(seed);
      const min = typeof schema.minLength === 'number' ? schema.minLength : 0;
      const base = `mock ${seed.slice(0, 8)}`;
      return base.length >= min ? base : base.padEnd(min, 'x');
    }

    case 'integer':
    case 'number': {
      const min = typeof schema.minimum === 'number' ? schema.minimum : 0;
      const max = typeof schema.maximum === 'number' ? schema.maximum : min + 100;
      const span = Math.max(1, max - min);
      return min + (parseInt(seed.slice(0, 4), 16) % span);
    }

    case 'boolean':
      return parseInt(seed.slice(0, 2), 16) % 2 === 0;

    case 'null':
      return null;

    default:
      throw new Error(
        `The mock provider cannot build a value for schema type ${String(schema.type)}.`,
      );
  }
}

/** A syntactically valid UUIDv4 derived from the seed, so ids are stable. */
function uuidFrom(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    `4${h.slice(13, 16)}`,
    `${((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join('-');
}
