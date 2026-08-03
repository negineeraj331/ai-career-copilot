import { scoreResume, topFixes } from '@cc/ats';
import type { AtsRuleResult, AtsScore, ResumeDocument } from '@cc/shared';
import { getResume } from '../resume/resume.service.js';

/**
 * The ATS score with its full breakdown (docs/06 `POST /ats/score`).
 *
 * The engine itself is in `packages/ats` and does no I/O — this layer is the
 * only thing that touches the database. That separation is enforced by lint,
 * and it is what keeps the rubric unit-testable without a Postgres container.
 *
 * Nothing here is cached. Scoring is a pure sub-millisecond function over a
 * document we have already loaded, so caching would add an invalidation problem
 * (rubric version, document version) in exchange for nothing measurable.
 */
export interface AtsScoreResult extends AtsScore {
  topFixes: AtsRuleResult[];
}

export function scoreDocument(
  document: ResumeDocument,
  targetRole?: string | undefined,
): AtsScoreResult {
  const score = scoreResume(document, { targetRole });
  return { ...score, topFixes: topFixes(score) };
}

/** Scores a stored resume. Ownership is enforced by `getResume`, which 404s. */
export async function scoreStoredResume(resumeId: string, userId: string): Promise<AtsScoreResult> {
  const resume = await getResume(resumeId, userId);
  return scoreDocument(resume.content, resume.targetRole ?? undefined);
}
