import type { AiUsage } from './types.js';

/**
 * What a call cost, in micros (millionths of a US dollar).
 *
 * Integers, never floats. docs/05 says the same about `costMicros`: money in
 * floating point accumulates rounding error, and a budget measured with a
 * drifting number is not measured. Micros give six decimal places of precision,
 * which is more than enough when the smallest real charge is ~$0.000001.
 *
 * List prices from docs/11 §3, verified against the model table rather than
 * recalled. If they change, this is the single place to change them — and the
 * `AiUsageLog` rows already written keep the price that applied at the time,
 * because the cost is computed at call time and stored.
 */

export interface ModelPricing {
  /** US dollars per million input tokens. */
  inputPerMillion: number;
  outputPerMillion: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-5': { inputPerMillion: 5.0, outputPerMillion: 25.0 },
  'claude-sonnet-5': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-haiku-4-5': { inputPerMillion: 1.0, outputPerMillion: 5.0 },
};

/**
 * Cache multipliers, from the provider's own documentation: a token written to
 * the prompt cache bills at ~1.25× input, and one read back at ~0.1×. Ignoring
 * these would make a warm call look identical in cost to a cold one, which
 * would hide the single biggest saving the design depends on.
 */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export function costMicros(model: string, usage: AiUsage): number {
  const pricing = MODEL_PRICING[model];
  // An unknown model costs zero rather than throwing: metering must never be
  // the thing that fails a request the user already paid for in latency. The
  // gap shows up as a suspiciously free row, which is easy to spot.
  if (!pricing) return 0;

  const perToken = (perMillion: number): number => perMillion / 1_000_000;

  const dollars =
    usage.inputTokens * perToken(pricing.inputPerMillion) +
    usage.cacheWriteTokens * perToken(pricing.inputPerMillion) * CACHE_WRITE_MULTIPLIER +
    usage.cacheReadTokens * perToken(pricing.inputPerMillion) * CACHE_READ_MULTIPLIER +
    usage.outputTokens * perToken(pricing.outputPerMillion);

  return Math.round(dollars * 1_000_000);
}

export function formatMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(6)}`;
}
