import { fail, notApplicable, partial, pass, type Rule, ratio } from '../rubric.js';
import { allBullets, allSkills, isQuantified } from '../text.js';

/**
 * Completeness — 10%, the lightest component.
 *
 * Whether the expected sections exist at all. Light on purpose: a complete
 * resume full of weak writing is worse than a sparse one full of evidence, and
 * weighting presence heavily would reward padding.
 */

const contactBlock: Rule = {
  id: 'complete.contact',
  label: 'Contact block',
  component: 'completeness',
  weight: 3,
  evaluate({ document }) {
    const { fullName, email, phone, location, links } = document.contact;
    const have = [
      Boolean(fullName.trim()),
      Boolean(email),
      Boolean(phone?.trim()),
      Boolean(location?.trim()),
      links.length > 0,
    ].filter(Boolean).length;

    if (have >= 4) return pass(`Contact block has ${String(have)} of 5 useful fields.`);
    if (have >= 2) {
      return partial(
        ratio(have, 5),
        `Contact block has only ${String(have)} of 5 fields (name, email, phone, location, links).`,
        'Add the missing ones. Location matters more than people expect — it decides whether a role is even considered.',
      );
    }
    return fail(
      'Contact block is nearly empty.',
      'Add at minimum your name, email, and phone number.',
    );
  },
};

const experienceOrProjects: Rule = {
  id: 'complete.evidence',
  label: 'Experience or projects',
  component: 'completeness',
  weight: 4,
  evaluate({ document }) {
    const roles = document.experience.length;
    const projects = document.projects.length;

    // Either path is legitimate. A student with three substantial projects and
    // no job history is not an incomplete resume, and grading them as one would
    // be wrong about the population this product is largely for.
    if (roles >= 1 || projects >= 2) {
      return pass(
        `${String(roles)} role(s) and ${String(projects)} project(s) — enough to evidence your work.`,
      );
    }
    if (projects === 1) {
      return partial(
        0.5,
        'One project and no professional experience.',
        'Add at least one more substantial project, or any internship or freelance work.',
      );
    }
    return fail(
      'No experience or projects.',
      'This is the section that gets you interviewed. Add at least one role or two projects.',
    );
  },
};

const educationPresent: Rule = {
  id: 'complete.education',
  label: 'Education',
  component: 'completeness',
  weight: 2,
  evaluate({ document }) {
    if (document.education.length > 0) {
      return pass(`${String(document.education.length)} education entry/entries listed.`);
    }
    return partial(
      0.3,
      'No education section.',
      'Add your degree even if it is unrelated. Many filters check for its presence rather than its subject.',
    );
  },
};

const enoughSkills: Rule = {
  id: 'complete.skills',
  label: 'At least six skills',
  component: 'completeness',
  weight: 2,
  evaluate({ document }) {
    const count = allSkills(document).length;
    if (count >= 6) return pass(`${String(count)} skills listed.`);
    if (count > 0) {
      return partial(
        ratio(count, 6),
        `Only ${String(count)} skills listed.`,
        'List at least six, grouped by category — languages, frameworks, tools.',
      );
    }
    return fail('No skills listed.', 'Add a skills section.');
  },
};

const quantifiedBullets: Rule = {
  id: 'complete.quantified',
  label: 'Results are quantified',
  component: 'completeness',
  weight: 4,
  evaluate({ document }) {
    const bullets = allBullets(document);
    if (bullets.length === 0) return notApplicable('No bullets to check.');

    const quantified = bullets.filter(isQuantified);
    const share = ratio(quantified.length, bullets.length);
    const summary = `${String(quantified.length)} of ${String(bullets.length)} bullets contain a number.`;

    // 40% is the documented bar (FR-41). Demanding more would push people into
    // inventing metrics, which interviews expose faster than a low score does.
    if (share >= 0.4) return pass(summary);
    if (share > 0) {
      return partial(
        ratio(share, 0.4),
        summary,
        'Quantify more of them: users served, latency saved, percentage reduced, size of the team. A number is the difference between a claim and a result.',
      );
    }
    return fail(
      'No bullet contains a measurable result.',
      'Add numbers. "Improved performance" and "cut p95 latency from 800 ms to 120 ms" describe the same work; only one is believable.',
    );
  },
};

export const completenessRules: readonly Rule[] = [
  contactBlock,
  experienceOrProjects,
  educationPresent,
  enoughSkills,
  quantifiedBullets,
];
