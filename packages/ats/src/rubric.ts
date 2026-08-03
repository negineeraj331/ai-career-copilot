import {
  ATS_RUBRIC_VERSION,
  ATS_WEIGHTS,
  type AtsComponent,
  type AtsRuleResult,
  type ResumeDocument,
} from '@cc/shared';

/**
 * The shared vocabulary every rule speaks.
 *
 * A rule is a pure function from context to result. No I/O, no clock, no
 * randomness — the ESLint config enforces the first and this interface makes
 * the rest awkward to violate. Determinism is not a nicety here: a score that
 * moves on its own is a score nobody trusts, and the user is being asked to
 * rewrite their CV on the strength of it (FR-40).
 */

export interface RuleContext {
  readonly document: ResumeDocument;
  /**
   * Keywords from a matched job description, when one exists. Absent means the
   * keyword rules fall back to a role-generic bank rather than reporting
   * failure — scoring a resume with no JD attached is the common case, and
   * "you are missing keywords we never gave you" is not a finding.
   */
  readonly jdKeywords?: readonly string[];
  readonly targetRole?: string | undefined;
}

export interface Rule {
  readonly id: string;
  readonly label: string;
  readonly component: AtsComponent;
  /** Relative weight inside its component. Components are weighted separately. */
  readonly weight: number;
  evaluate(ctx: RuleContext): RuleOutcome;
}

/**
 * What a rule reports. `earned` is a fraction of its own weight (0…1) rather
 * than an absolute, so a rule never needs to know what it is worth — reweighting
 * the rubric touches this file only.
 */
export interface RuleOutcome {
  status: AtsRuleResult['status'];
  /** 0…1. Ignored when status is NOT_APPLICABLE. */
  earned: number;
  explanation: string;
  fix?: string;
}

export const RUBRIC_VERSION = ATS_RUBRIC_VERSION;
export const COMPONENT_WEIGHTS = ATS_WEIGHTS;

/** Clamp to the 0…1 range rules are supposed to return, defensively. */
export function ratio(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, value / total));
}

export function pass(explanation: string): RuleOutcome {
  return { status: 'PASS', earned: 1, explanation };
}

export function fail(explanation: string, fix: string): RuleOutcome {
  return { status: 'FAIL', earned: 0, explanation, fix };
}

/**
 * Partial credit. A resume with six good bullets and one weak one is not the
 * same as one with none, and a rubric that says it is teaches people to ignore
 * it. `earned` is clamped to a strict interior — a PARTIAL that awards full or
 * zero credit should have been a PASS or a FAIL, and silently collapsing the
 * distinction hides a rule that is not doing what its author thought.
 */
export function partial(earned: number, explanation: string, fix: string): RuleOutcome {
  return {
    status: 'PARTIAL',
    earned: Math.max(0.01, Math.min(0.99, earned)),
    explanation,
    fix,
  };
}

export function notApplicable(explanation: string): RuleOutcome {
  return { status: 'NOT_APPLICABLE', earned: 0, explanation };
}
