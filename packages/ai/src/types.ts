import type { z } from 'zod';

/**
 * The provider contract (ADR: provider-agnostic, Claude as default).
 *
 * Every AI feature in this product asks for one thing: a **structured object**
 * matching a schema, not prose. docs/11 is explicit that no endpoint returns
 * free text for the client to regex — so the interface takes a Zod schema and
 * returns a parsed value, and a provider that cannot honour a schema cannot
 * implement it.
 *
 * `EmbeddingProvider` is deliberately a separate interface. Anthropic has no
 * embeddings endpoint, so folding embeddings into `AiProvider` would force every
 * adapter to implement a method half of them cannot, and the "not supported"
 * branch would be discovered at runtime by a user rather than at wiring time by
 * a compiler.
 */

export type AiFeature =
  | 'jd.extract'
  | 'resume.structure'
  | 'bullet.optimize'
  | 'skill.suggest'
  | 'recommendations.generate'
  | 'cover_letter.generate';

/** Which model tier a feature routes to. docs/11 §3 — the biggest cost lever. */
export type ModelTier = 'extraction' | 'structuring' | 'writing';

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens written to the provider's prompt cache (~1.25× input price). */
  cacheWriteTokens: number;
  /** Tokens served from it (~0.1× input price) — the whole point of caching. */
  cacheReadTokens: number;
}

export interface AiCallResult<T> {
  value: T;
  usage: AiUsage;
  model: string;
  provider: string;
  latencyMs: number;
  /** True when the result came from our own Redis cache and cost nothing. */
  cached: boolean;
}

export interface AiRequest<T> {
  feature: AiFeature;
  tier: ModelTier;
  /**
   * Stable across calls and cacheable by the provider. Everything variable
   * belongs in `userContent` — a timestamp or a UUID in here silently destroys
   * the prompt cache and quadruples the bill.
   */
  system: string;
  /**
   * The user's own data. Always delimited and always treated as data: docs/11
   * §10 lists prompt injection in an uploaded resume as a real threat, and the
   * schema-validated response is the control that makes an injected instruction
   * unable to change the response shape.
   */
  userContent: string;
  schema: z.ZodType<T>;
  /** JSON Schema for the provider's structured-output tool. */
  jsonSchema: Record<string, unknown>;
  /** Names the shape being requested, for the provider's tool definition. */
  schemaName: string;
  schemaDescription: string;
  maxTokens?: number;
}

export interface AiProvider {
  readonly name: string;
  /** Resolves a tier to a concrete model id, so metering records what ran. */
  modelFor(tier: ModelTier): string;
  complete<T>(request: AiRequest<T>): Promise<AiCallResult<T>>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * A provider failure the caller can act on.
 *
 * The distinction that matters is `retryable`: a rate limit or a 5xx is worth
 * another attempt, a schema violation or a refusal is not, and retrying the
 * latter burns money to get the same answer.
 */
export class AiProviderError extends Error {
  readonly retryable: boolean;
  readonly kind: 'rate_limit' | 'unavailable' | 'invalid_response' | 'refused' | 'unknown';

  constructor(
    kind: AiProviderError['kind'],
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AiProviderError';
    this.kind = kind;
    this.retryable = options.retryable ?? (kind === 'rate_limit' || kind === 'unavailable');
  }
}
