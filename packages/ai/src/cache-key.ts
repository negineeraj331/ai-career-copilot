import { createHash } from 'node:crypto';
import type { AiFeature } from './types.js';

/**
 * The result-cache key (docs/11 §8).
 *
 * `sha256(feature + templateVersion + model + inputHash)`. Every component is
 * load-bearing:
 *
 * - **feature and templateVersion** — editing a prompt must invalidate the
 *   answers the old prompt produced, or a user sees yesterday's output from a
 *   template that no longer exists.
 * - **model** — the same input to Haiku and to Opus are different results, and
 *   serving one for the other silently downgrades what the user paid for.
 * - **inputHash** — the user's content. Hashed rather than embedded so the key
 *   is bounded and so a cache key never carries resume text.
 */
export function cacheKeyFor(params: {
  feature: AiFeature;
  templateVersion: number;
  model: string;
  input: string;
}): string {
  const inputHash = createHash('sha256').update(params.input).digest('hex');
  const composite = `${params.feature}:${String(params.templateVersion)}:${params.model}:${inputHash}`;
  return `cc:ai:${createHash('sha256').update(composite).digest('hex')}`;
}
