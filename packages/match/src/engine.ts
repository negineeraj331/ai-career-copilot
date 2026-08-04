import {
  MATCH_WEIGHTS,
  MISSING_SKILL_THRESHOLD,
  type MatchBreakdown,
  type ParsedJobDescription,
  type ResumeDocument,
  type SkillRequirement,
} from '@cc/shared';
import { cosineSimilarity, lexicalMatch, normalise } from './similarity.js';

/**
 * The deterministic match engine (FR-33).
 *
 * Same resume and same job description always produce the same score. Nothing
 * here calls a model: the number a user is asked to act on has to be
 * reproducible and explainable, and "the AI said 72" is neither. The AI layer
 * writes the prose around this; it does not produce the number.
 */

export interface SkillVector {
  term: string;
  vector: readonly number[];
}

export interface MatchInput {
  document: ResumeDocument;
  jd: ParsedJobDescription;
  /**
   * Optional embeddings, keyed by normalised term. Absent means lexical-only
   * matching, which still works — see similarity.ts for why that is the right
   * way round.
   */
  vectors?: {
    jd: Map<string, readonly number[]>;
    resume: SkillVector[];
  };
}

export interface MatchResult {
  /**
   * Null when the posting yielded no requirements at all.
   *
   * A resume scored against an unreadable job description came out at 45 — a
   * number that reads as "mediocre fit" when the truth is "we could not read
   * the posting". Presenting a parse failure as a middling result is worse than
   * presenting nothing, because the user acts on it. The breakdown is still
   * populated so they can see what was computed.
   */
  score: number | null;
  breakdown: MatchBreakdown;
  /** Requirements with no evidence, worst first. */
  gaps: { skill: string; importance: SkillRequirement['importance']; weight: number }[];
}

/** Everything in the resume that could evidence a skill, as one lowercase blob. */
function evidenceText(doc: ResumeDocument): string {
  return [
    doc.summary ?? '',
    doc.contact.headline ?? '',
    ...doc.skills.flatMap((g) => [g.category, ...g.skills]),
    ...doc.experience.flatMap((e) => [
      e.role,
      e.company,
      ...e.technologies,
      ...e.bullets.map((b) => b.text),
    ]),
    ...doc.projects.flatMap((p) => [
      p.name,
      p.description ?? '',
      ...p.technologies,
      ...p.bullets.map((b) => b.text),
    ]),
    ...doc.certifications.map((c) => c.name),
  ].join(' ');
}

/**
 * Total months of professional experience, from the date ranges.
 *
 * Overlapping roles are merged rather than summed: someone who consulted for
 * two clients in the same year has one year of experience, not two, and summing
 * would let a resume inflate itself by splitting one job into three entries.
 */
export function totalExperienceYears(doc: ResumeDocument, now = new Date()): number {
  const intervals = doc.experience
    .map((role) => ({
      start: monthIndex(role.dates.start),
      end: role.dates.end ? monthIndex(role.dates.end) : monthIndexOf(now),
    }))
    .filter((i) => i.end >= i.start)
    .sort((a, b) => a.start - b.start);

  let months = 0;
  let cursor = -Infinity;
  for (const interval of intervals) {
    const from = Math.max(interval.start, cursor);
    if (interval.end > from) {
      months += interval.end - from;
      cursor = interval.end;
    }
  }
  return Math.round((months / 12) * 10) / 10;
}

function monthIndex(value: string): number {
  const [year, month] = value.split('-').map(Number);
  return (year ?? 0) * 12 + ((month ?? 1) - 1);
}

function monthIndexOf(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function skillIsEvidenced(
  requirement: SkillRequirement,
  evidence: string,
  input: MatchInput,
): boolean {
  if (lexicalMatch(evidence, requirement.name)) return true;

  const jdVector = input.vectors?.jd.get(normalise(requirement.name));
  if (!jdVector || !input.vectors) return false;

  // Semantic fallback. The threshold is documented (FR-34) rather than tuned
  // until the numbers looked nice: below it, the "match" is usually two
  // unrelated terms that happen to live in the same region of the space.
  return input.vectors.resume.some(
    (candidate) => cosineSimilarity(jdVector, candidate.vector) >= MISSING_SKILL_THRESHOLD,
  );
}

export function matchResume(input: MatchInput, now = new Date()): MatchResult {
  const evidence = evidenceText(input.document);

  // ── Skills ────────────────────────────────────────────────────────────────
  // Required and preferred are weighted differently: missing something the
  // posting insists on is not the same as missing a nice-to-have, and scoring
  // them equally makes the number useless for deciding whether to apply.
  //
  // The schema keeps them in two arrays; they are flattened here because the
  // importance is already on each entry, and two loops that must stay in sync
  // is one loop too many.
  const requirements: SkillRequirement[] = [
    ...input.jd.requiredSkills,
    ...input.jd.preferredSkills,
  ];
  const weightOf = (r: SkillRequirement): number => (r.importance === 'REQUIRED' ? 1 : 0.4);

  const matched: string[] = [];
  const missing: string[] = [];
  const gaps: MatchResult['gaps'] = [];

  let earned = 0;
  let available = 0;

  for (const requirement of requirements) {
    const weight = weightOf(requirement);
    available += weight;
    if (skillIsEvidenced(requirement, evidence, input)) {
      matched.push(requirement.name);
      earned += weight;
    } else {
      missing.push(requirement.name);
      gaps.push({ skill: requirement.name, importance: requirement.importance, weight });
    }
  }

  // No stated requirements is not a perfect match; it is an unanswerable
  // question. Scoring it 100 would tell a user they are ideal for a posting we
  // could not read.
  const skillsScore = available === 0 ? 0 : Math.round((earned / available) * 100);
  gaps.sort((a, b) => b.weight - a.weight || a.skill.localeCompare(b.skill));

  // ── Experience ────────────────────────────────────────────────────────────
  const detectedYears = totalExperienceYears(input.document, now);
  const requiredYears = input.jd.minYearsExperience ?? null;

  const experienceScore = ((): number => {
    if (requiredYears === null) {
      // Nothing to measure against. Score on presence rather than guessing a
      // bar the posting never set.
      return detectedYears > 0 ? 100 : 0;
    }
    if (requiredYears === 0) return 100;
    // Capped at 100: three times the required experience is not three times the
    // match, and letting it run over would let a long career mask missing
    // skills.
    return Math.min(100, Math.round((detectedYears / requiredYears) * 100));
  })();

  // ── Projects ──────────────────────────────────────────────────────────────
  const relevant = input.document.projects
    .filter((project) =>
      requirements.some((r: SkillRequirement) =>
        lexicalMatch(
          [project.name, project.description ?? '', ...project.technologies].join(' '),
          r.name,
        ),
      ),
    )
    .map((p) => p.name);

  const projectsScore = ((): number => {
    if (input.document.projects.length === 0) return 0;
    if (requirements.length === 0) return 50;
    // Two relevant projects is full marks. Beyond that it is padding, and the
    // reader stopped at the second one anyway.
    return Math.min(100, Math.round((relevant.length / 2) * 100));
  })();

  // ── Education ─────────────────────────────────────────────────────────────
  const educationScore = ((): number => {
    const has = input.document.education.length > 0;
    const required = input.jd.educationRequirement;
    // "NONE" means the posting does not ask, so a resume without a degree is
    // not penalised — but one with a degree is not rewarded either, or the
    // score would drift on something the employer said was irrelevant.
    if (required === 'NONE') return has ? 100 : 80;
    return has ? 100 : 0;
  })();

  const breakdown: MatchBreakdown = {
    skills: { score: skillsScore, weight: MATCH_WEIGHTS.skills, matched, missing },
    experience: {
      score: experienceScore,
      weight: MATCH_WEIGHTS.experience,
      requiredYears,
      detectedYears,
    },
    projects: { score: projectsScore, weight: MATCH_WEIGHTS.projects, relevant },
    education: { score: educationScore, weight: MATCH_WEIGHTS.education },
  };

  const evaluable = requirements.length > 0;
  const score = evaluable
    ? Math.round(
        skillsScore * MATCH_WEIGHTS.skills +
          experienceScore * MATCH_WEIGHTS.experience +
          projectsScore * MATCH_WEIGHTS.projects +
          educationScore * MATCH_WEIGHTS.education,
      )
    : null;

  return { score, breakdown, gaps };
}
