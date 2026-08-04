/** Shared limits and magic values. Anything referenced by both API and web lives here. */

/** Version of the resume document shape. Bump when `resumeDocumentSchema` changes
 *  incompatibly, and add an upgrade function — stored documents are not migrated. */
export const RESUME_SCHEMA_VERSION = 1;

/** Version of the ATS rubric. Persisted with every score so historical values stay
 *  interpretable when the rules change. See docs/05 → Analysis.rubricVersion. */
export const ATS_RUBRIC_VERSION = 1;

export const LIMITS = {
  PASSWORD_MIN: 12,
  PASSWORD_MAX: 128,
  NAME_MAX: 100,
  EMAIL_MAX: 254,
  UPLOAD_MAX_BYTES: 10 * 1024 * 1024,
  RESUME_TITLE_MAX: 120,
  BULLET_MAX: 500,
  SUMMARY_MAX: 2000,
  JD_MIN: 100,
  JD_MAX: 30_000,
  PAGE_SIZE_DEFAULT: 20,
  PAGE_SIZE_MAX: 100,
  FREE_TIER_VERSION_HISTORY: 50,
  RECOVERY_CODE_COUNT: 10,
} as const;

/** Weights for the composite match score. Must sum to 1. See SRS FR-33. */
export const MATCH_WEIGHTS = {
  skills: 0.45,
  experience: 0.25,
  projects: 0.2,
  education: 0.1,
} as const;

/** Weights for the composite ATS score. Must sum to 1. See SRS FR-41. */
export const ATS_WEIGHTS = {
  parseability: 0.3,
  keywords: 0.25,
  formatting: 0.2,
  readability: 0.15,
  completeness: 0.1,
} as const;

/** Resume evidence below this cosine similarity counts as a missing skill (FR-34). */
export const MISSING_SKILL_THRESHOLD = 0.55;

/** Score bands drive the status colour and label on ScoreMeter. docs/09 §3. */
export const SCORE_BANDS = {
  CRITICAL: { min: 0, max: 39, label: 'Needs work' },
  SERIOUS: { min: 40, max: 59, label: 'Below par' },
  WARNING: { min: 60, max: 84, label: 'Good' },
  GOOD: { min: 85, max: 100, label: 'Strong' },
} as const;

export type ScoreBand = keyof typeof SCORE_BANDS;

export function scoreBand(score: number): ScoreBand {
  if (score >= SCORE_BANDS.GOOD.min) return 'GOOD';
  if (score >= SCORE_BANDS.WARNING.min) return 'WARNING';
  if (score >= SCORE_BANDS.SERIOUS.min) return 'SERIOUS';
  return 'CRITICAL';
}

export * from './templates.js';
