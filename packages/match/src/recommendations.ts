import type { Recommendation, ResumeDocument } from '@cc/shared';
import type { MatchResult } from './engine.js';

/**
 * Deterministic recommendations, derived from gaps already computed.
 *
 * These are free, instant, and reproducible. The AI layer writes better prose
 * for the same findings (slice 1.8), but the findings themselves come from
 * here — a recommendation a model invented is one nobody can trace back to a
 * rule, and "the AI suggested it" is not a reason a user can evaluate.
 *
 * `targetPath` is a JSON Pointer (RFC 6901) into the resume document, so the
 * editor can scroll to and highlight the exact field rather than making the
 * user hunt for what a sentence refers to.
 */
export function buildRecommendations(
  doc: ResumeDocument,
  match: MatchResult | null,
): Recommendation[] {
  const out: Recommendation[] = [];

  if (match) {
    // Required gaps first, and only the top few: a list of thirty is a list
    // nobody reads, and the tail is always the least important.
    const required = match.gaps.filter((g) => g.importance === 'REQUIRED').slice(0, 5);
    for (const gap of required) {
      out.push({
        id: `gap:${gap.skill}`,
        type: 'ADD_SKILL',
        severity: 'HIGH',
        message: `This role requires ${gap.skill} and your resume does not evidence it. Add it where you have genuinely used it — listing it without support is what interviews probe first.`,
        targetPath: '/skills',
      });
    }

    for (const gap of match.gaps.filter((g) => g.importance === 'PREFERRED').slice(0, 3)) {
      out.push({
        id: `gap:${gap.skill}`,
        type: 'ADD_SKILL',
        severity: 'LOW',
        message: `${gap.skill} is listed as preferred. Worth adding if you have used it.`,
        targetPath: '/skills',
      });
    }

    const { experience } = match.breakdown;
    const detected = experience.detectedYears ?? 0;
    if (experience.requiredYears !== null && detected < experience.requiredYears) {
      out.push({
        id: 'experience:short',
        type: 'ADD_SECTION',
        severity: 'MEDIUM',
        message: `The posting asks for ${String(experience.requiredYears)} years and your dated roles total ${String(detected)}. Internships, freelance work, and substantial projects count — add any that are missing.`,
        targetPath: '/experience',
      });
    }

    if (match.breakdown.projects.score < 50 && doc.projects.length === 0) {
      out.push({
        id: 'projects:none',
        type: 'ADD_PROJECT',
        severity: 'MEDIUM',
        message:
          'No projects listed. One that uses this role’s stack is the cheapest way to evidence a skill you have not been paid for.',
        targetPath: '/projects',
      });
    }
  }

  // These hold with or without a job description, because they are properties
  // of the resume rather than of the match.
  const bullets = [
    ...doc.experience.flatMap((e) =>
      e.bullets.map((b, i) => ({ b, path: `/experience/${e.id}/bullets/${String(i)}` })),
    ),
    ...doc.projects.flatMap((p) =>
      p.bullets.map((b, i) => ({ b, path: `/projects/${p.id}/bullets/${String(i)}` })),
    ),
  ];

  const unquantified = bullets.filter(({ b }) => !/\d/.test(b.text));
  if (bullets.length > 0 && unquantified.length / bullets.length > 0.6) {
    const first = unquantified[0];
    out.push({
      id: 'bullets:unquantified',
      type: 'QUANTIFY',
      severity: 'HIGH',
      message: `${String(unquantified.length)} of ${String(bullets.length)} bullets contain no number. A result without a figure reads as a claim; with one it reads as evidence.`,
      targetPath: first?.path ?? null,
    });
  }

  if (!doc.summary?.trim()) {
    out.push({
      id: 'summary:missing',
      type: 'SUMMARY_REWRITE',
      severity: 'MEDIUM',
      message:
        'No summary. Two or three sentences naming your discipline, your strongest result, and the role you want is the first thing read and the cheapest signal of fit.',
      targetPath: '/summary',
    });
  }

  // Highest severity first — the order the user should work in.
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
