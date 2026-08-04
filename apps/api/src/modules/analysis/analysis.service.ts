import { createHash } from 'node:crypto';
import { scoreResume } from '@cc/ats';
import { buildRecommendations, matchResume } from '@cc/match';
import {
  ATS_RUBRIC_VERSION,
  resumeDocumentSchema,
  type AnalysisResult,
  type MissingSkill,
  type ParsedJobDescription,
} from '@cc/shared';
import { Prisma } from '../../generated/prisma/index.js';
import { prisma } from '../../core/db/prisma.js';
import { NotFoundError, UnprocessableError } from '../../core/errors/app-error.js';
import { parsedOf } from '../job/job.service.js';

/**
 * An analysis: the ATS score, the match against a job description, the gaps,
 * and what to do about them.
 *
 * Everything here is deterministic. The AI layer contributes the extracted
 * requirements (once, cached per posting) and — from slice 1.8 — better prose
 * for the same findings. The numbers and the findings themselves come from
 * `@cc/ats` and `@cc/match`, so the same inputs always produce the same output
 * and every point is traceable to a named rule.
 */

/**
 * hash(resumeVersion + jd + rubricVersion).
 *
 * `rubricVersion` is in the key so a scoring change produces a new analysis
 * rather than silently serving a number computed under rules that no longer
 * exist — the same reason the column is stored alongside the score.
 */
export function analysisCacheKey(params: {
  resumeVersionId: string;
  jobDescriptionId: string | null;
  rubricVersion: number;
}): string {
  return createHash('sha256')
    .update(
      `${params.resumeVersionId}:${params.jobDescriptionId ?? 'none'}:${String(params.rubricVersion)}`,
    )
    .digest('hex');
}

export async function createAnalysis(params: {
  userId: string;
  resumeId: string;
  jobDescriptionId?: string | undefined;
}): Promise<AnalysisResult> {
  const resume = await prisma().resume.findFirst({
    where: { id: params.resumeId, userId: params.userId, deletedAt: null },
    include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
  });
  if (!resume) throw new NotFoundError('That resume does not exist.');

  const version = resume.versions[0];
  if (!version) throw new UnprocessableError('This resume has no content to analyse.');

  let jd: ParsedJobDescription | null = null;
  if (params.jobDescriptionId) {
    const row = await prisma().jobDescription.findFirst({
      where: { id: params.jobDescriptionId, userId: params.userId },
    });
    if (!row) throw new NotFoundError('That job description does not exist.');
    jd = parsedOf(row);
    if (!jd) {
      // Extraction has not run or did not produce anything usable. Analysing
      // against nothing would produce a number that looks like a verdict.
      throw new UnprocessableError(
        'That job description has not been read yet. Try again in a moment.',
      );
    }
  }

  const cacheKey = analysisCacheKey({
    resumeVersionId: version.id,
    jobDescriptionId: params.jobDescriptionId ?? null,
    rubricVersion: ATS_RUBRIC_VERSION,
  });

  const existing = await prisma().analysis.findUnique({ where: { cacheKey } });
  if (existing) return toResult(existing);

  const document = resumeDocumentSchema.parse(version.content);
  const ats = scoreResume(document, jd ? { targetRole: jd.roleTitle } : {});
  const match = jd ? matchResume({ document, jd }) : null;

  const missingSkills: MissingSkill[] = (match?.gaps ?? []).map((gap) => ({
    skill: gap.skill,
    importance: gap.importance,
    weight: gap.weight,
    // Deterministic for now. Slice 1.8 replaces this with a grounded AI
    // suggestion — but the gap it addresses is still computed here, so the
    // advice can always be traced back to a rule rather than to a model's mood.
    suggestion:
      gap.importance === 'REQUIRED'
        ? `Add evidence of ${gap.skill} to a role or project where you genuinely used it.`
        : `Mention ${gap.skill} if you have used it; it is listed as preferred.`,
  }));

  const recommendations = buildRecommendations(document, match);

  const created = await prisma().analysis.create({
    data: {
      userId: params.userId,
      resumeVersionId: version.id,
      jobDescriptionId: params.jobDescriptionId ?? null,
      atsScore: ats.score,
      matchScore: match?.score ?? null,
      breakdown: match ? match.breakdown : Prisma.JsonNull,
      missingSkills,
      recommendations,
      rubricVersion: ATS_RUBRIC_VERSION,
      cacheKey,
    },
  });

  // Denormalised so the resume list renders without recomputing. Only the
  // ATS score: the match score belongs to a posting, not to the resume.
  await prisma().resume.update({
    where: { id: resume.id },
    data: { atsScore: ats.score },
  });

  return toResult(created);
}

export async function getAnalysis(id: string, userId: string): Promise<AnalysisResult> {
  const row = await prisma().analysis.findFirst({ where: { id, userId } });
  if (!row) throw new NotFoundError('That analysis does not exist.');
  return toResult(row);
}

export async function listAnalyses(userId: string, resumeId?: string): Promise<AnalysisResult[]> {
  const rows = await prisma().analysis.findMany({
    where: {
      userId,
      ...(resumeId ? { resumeVersion: { resumeId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return rows.map(toResult);
}

function toResult(row: {
  id: string;
  resumeVersionId: string;
  jobDescriptionId: string | null;
  atsScore: number;
  matchScore: number | null;
  rubricVersion: number;
  breakdown: unknown;
  missingSkills: unknown;
  recommendations: unknown;
  createdAt: Date;
}): AnalysisResult {
  return {
    id: row.id,
    resumeVersionId: row.resumeVersionId,
    jobDescriptionId: row.jobDescriptionId,
    atsScore: row.atsScore,
    matchScore: row.matchScore,
    rubricVersion: row.rubricVersion,
    breakdown: (row.breakdown ?? null) as AnalysisResult['breakdown'],
    missingSkills: (row.missingSkills ?? []) as MissingSkill[],
    recommendations: (row.recommendations ?? []) as AnalysisResult['recommendations'],
    createdAt: row.createdAt.toISOString(),
  };
}
