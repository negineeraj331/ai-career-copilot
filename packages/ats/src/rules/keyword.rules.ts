import { fail, notApplicable, partial, pass, type Rule, ratio } from '../rubric.js';
import { allSkills, fullText } from '../text.js';

/**
 * Keyword coverage — 25%.
 *
 * When a job description is attached, these rules measure coverage against its
 * terms. When one is not — which is the common case, since a user scores a
 * resume long before they paste a JD — they fall back to a role-generic bank.
 *
 * The fallback matters. "You are missing keywords" is not a usable finding when
 * we never gave the user any keywords to match, and a rule that reports FAIL in
 * that situation trains people to distrust the whole score.
 */

/**
 * Terms that read as evidence of engineering practice regardless of stack. This
 * is deliberately generic and deliberately small: a large bank would start
 * penalising people for not being the kind of engineer the bank was written by.
 */
const GENERIC_SIGNALS = [
  'test',
  'deploy',
  'design',
  'review',
  'api',
  'database',
  'performance',
  'security',
  'monitor',
  'document',
  'debug',
  'scale',
  'automate',
  'migrate',
  'refactor',
];

function normalise(term: string): string {
  return term.trim().toLowerCase();
}

/**
 * Substring matching, not word-boundary matching, and that is a considered
 * choice: "Kubernetes" should match "kubernetes-based", and "test" should match
 * "testing" and "tested". It over-matches occasionally — "scale" inside
 * "escalated" — which is the cheaper error. A missed keyword tells a user to
 * add a term they already have, which is worse than a slightly generous score.
 */
function documentContains(haystack: string, term: string): boolean {
  return haystack.includes(normalise(term));
}

const jdCoverage: Rule = {
  id: 'keyword.jd-coverage',
  label: 'Job description keyword coverage',
  component: 'keywords',
  weight: 5,
  evaluate({ document, jdKeywords }) {
    if (!jdKeywords || jdKeywords.length === 0) {
      return notApplicable('No job description attached, so there is nothing to match against.');
    }

    const haystack = fullText(document);
    const matched = jdKeywords.filter((k) => documentContains(haystack, k));
    const share = ratio(matched.length, jdKeywords.length);
    const summary = `${String(matched.length)} of ${String(jdKeywords.length)} job-description terms appear in your resume.`;

    if (share >= 0.8) return pass(summary);
    if (share >= 0.3) {
      const missing = jdKeywords.filter((k) => !documentContains(haystack, k)).slice(0, 5);
      return partial(
        share,
        `${summary} Missing: ${missing.join(', ')}.`,
        'Work the missing terms into your bullets where they are genuinely true of your experience. Do not paste a keyword list — a human reads this after the parser does.',
      );
    }
    return fail(
      summary,
      'Most of what this role asks for is absent. Either this resume needs tailoring to the role, or the role is not a match.',
    );
  },
};

const genericSignals: Rule = {
  id: 'keyword.generic',
  label: 'Evidence of engineering practice',
  component: 'keywords',
  weight: 3,
  evaluate({ document, jdKeywords }) {
    // Yields to the JD rule when one exists — measuring generic terms as well
    // would double-count vocabulary and drown out the role-specific signal.
    if (jdKeywords && jdKeywords.length > 0) {
      return notApplicable(
        'A job description is attached, so role-specific coverage is used instead.',
      );
    }

    const haystack = fullText(document);
    const found = GENERIC_SIGNALS.filter((t) => documentContains(haystack, t));
    const share = ratio(found.length, 6); // six of fifteen is a reasonable bar

    if (found.length >= 6) {
      return pass(`Your resume evidences ${String(found.length)} common engineering practices.`);
    }
    if (found.length >= 2) {
      return partial(
        share,
        `Only ${String(found.length)} common practice terms appear (for example: testing, deployment, code review, performance).`,
        'Describe how you worked, not only what you built. Testing, review, deployment, and monitoring are what distinguish a shipped system from a side project.',
      );
    }
    return fail(
      'Almost no vocabulary describing engineering practice.',
      'Add bullets covering how work was tested, reviewed, deployed, or monitored.',
    );
  },
};

const skillsDeclared: Rule = {
  id: 'keyword.skills-present',
  label: 'Skills are listed explicitly',
  component: 'keywords',
  weight: 3,
  evaluate({ document }) {
    const skills = allSkills(document);
    if (skills.length >= 8) {
      return pass(`${String(skills.length)} skills are listed in a dedicated section.`);
    }
    if (skills.length > 0) {
      return partial(
        ratio(skills.length, 8),
        `Only ${String(skills.length)} skills are listed.`,
        'List at least eight. Keyword filters read the skills section first, and an implied skill is an unmatched one.',
      );
    }
    return fail(
      'No skills section.',
      'Add one, grouped by category. It is the first place both a filter and a recruiter look.',
    );
  },
};

const skillsEvidenced: Rule = {
  id: 'keyword.skills-evidenced',
  label: 'Listed skills appear in your experience',
  component: 'keywords',
  weight: 3,
  evaluate({ document }) {
    const skills = allSkills(document);
    if (skills.length === 0) return notApplicable('No skills listed to check.');

    // Everything except the skills section itself — a skill that only appears
    // in the list is a claim; one that appears in a bullet is evidence.
    const evidence = [
      document.summary ?? '',
      ...document.experience.flatMap((e) => [...e.bullets.map((b) => b.text), ...e.technologies]),
      ...document.projects.flatMap((p) => [
        p.description ?? '',
        ...p.bullets.map((b) => b.text),
        ...p.technologies,
      ]),
    ]
      .join(' ')
      .toLowerCase();

    const backed = skills.filter((s) => evidence.includes(s));
    const share = ratio(backed.length, skills.length);

    if (share >= 0.6) {
      return pass(
        `${String(backed.length)} of ${String(skills.length)} listed skills also appear in your experience or projects.`,
      );
    }
    if (share >= 0.2) {
      return partial(
        share,
        `Only ${String(backed.length)} of ${String(skills.length)} listed skills appear anywhere else in the document.`,
        'Show the skills you claim. A long list nothing in your experience supports reads as padding, and interviewers probe exactly there.',
      );
    }
    return fail(
      'Listed skills are almost entirely unsupported by your experience or projects.',
      'Cut the list to what you can evidence, then work those terms into your bullets.',
    );
  },
};

export const keywordRules: readonly Rule[] = [
  jdCoverage,
  genericSignals,
  skillsDeclared,
  skillsEvidenced,
];
