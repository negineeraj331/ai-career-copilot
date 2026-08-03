import {
  ATS_COMPONENTS,
  type AtsComponent,
  type AtsRuleResult,
  type AtsScore,
  type ResumeDocument,
} from '@cc/shared';
import { COMPONENT_WEIGHTS, RUBRIC_VERSION, type Rule, type RuleContext } from './rubric.js';
import { completenessRules } from './rules/completeness.rules.js';
import { formattingRules } from './rules/formatting.rules.js';
import { keywordRules } from './rules/keyword.rules.js';
import { parseabilityRules } from './rules/parseability.rules.js';
import { readabilityRules } from './rules/readability.rules.js';

/**
 * Composes the rule families into one score (FR-40, FR-41).
 *
 * Pure: same document in, same score out, no I/O and no clock. That is what
 * makes the score defensible — a user is being asked to rewrite their CV on the
 * strength of this number, and a number that drifts between two runs of the
 * same input cannot carry that weight.
 */

export const ALL_RULES: readonly Rule[] = [
  ...parseabilityRules,
  ...keywordRules,
  ...formattingRules,
  ...readabilityRules,
  ...completenessRules,
];

export interface ScoreOptions {
  jdKeywords?: readonly string[];
  targetRole?: string | undefined;
}

/**
 * A component with every rule NOT_APPLICABLE — an empty document, or the
 * keyword family with no JD and no skills — has no opinion rather than a score
 * of zero. Redistributing its weight across the components that DID apply is
 * the honest move: penalising a resume for a question we declined to ask is how
 * a rubric produces numbers nobody can explain.
 */
function componentScore(results: readonly ScoredRule[]): { score: number; applicable: boolean } {
  const applicable = results.filter((r) => r.result.status !== 'NOT_APPLICABLE');
  if (applicable.length === 0) return { score: 0, applicable: false };

  const totalWeight = applicable.reduce((sum, r) => sum + r.rule.weight, 0);
  const earned = applicable.reduce((sum, r) => sum + r.rule.weight * r.earnedRatio, 0);

  return { score: Math.round((earned / totalWeight) * 100), applicable: true };
}

interface ScoredRule {
  rule: Rule;
  result: AtsRuleResult;
  earnedRatio: number;
}

export function scoreResume(document: ResumeDocument, options: ScoreOptions = {}): AtsScore {
  const ctx: RuleContext = {
    document,
    ...(options.jdKeywords ? { jdKeywords: options.jdKeywords } : {}),
    targetRole: options.targetRole,
  };

  const scored: ScoredRule[] = ALL_RULES.map((rule) => {
    const outcome = rule.evaluate(ctx);
    const earnedRatio = outcome.status === 'NOT_APPLICABLE' ? 0 : outcome.earned;
    return {
      rule,
      earnedRatio,
      result: {
        id: rule.id,
        label: rule.label,
        status: outcome.status,
        weight: rule.weight,
        // Absolute points, so the UI can show "3 of 4" without recomputing.
        earned: Math.round(rule.weight * earnedRatio * 100) / 100,
        explanation: outcome.explanation,
        ...(outcome.fix ? { fix: outcome.fix } : {}),
      },
    };
  });

  const components: Partial<Record<AtsComponent, { score: number; weight: number }>> = {};
  const applicableComponents: { component: AtsComponent; score: number; weight: number }[] = [];

  for (const component of ATS_COMPONENTS) {
    const inComponent = scored.filter((s) => s.rule.component === component);
    const { score, applicable } = componentScore(inComponent);
    const weight = COMPONENT_WEIGHTS[component];

    components[component] = { score, weight };
    if (applicable) applicableComponents.push({ component, score, weight });
  }

  const liveWeight = applicableComponents.reduce((sum, c) => sum + c.weight, 0);
  const total =
    liveWeight === 0
      ? 0
      : Math.round(
          applicableComponents.reduce((sum, c) => sum + c.score * c.weight, 0) / liveWeight,
        );

  return {
    score: total,
    rubricVersion: RUBRIC_VERSION,
    components: components as AtsScore['components'],
    rules: scored.map((s) => s.result),
  };
}

/**
 * The rules that cost the most points, worst first — what the UI shows as "fix
 * these next". Ranked by points actually lost, not by rule weight: a heavy rule
 * that passed is not advice.
 */
export function topFixes(score: AtsScore, limit = 5): AtsRuleResult[] {
  return score.rules
    .filter((r) => r.status === 'FAIL' || r.status === 'PARTIAL')
    .sort((a, b) => b.weight - b.earned - (a.weight - a.earned))
    .slice(0, limit);
}
