import { fail, notApplicable, partial, pass, type Rule, ratio } from '../rubric.js';
import { allBullets, clichesIn, hasFirstPerson, startsWithActionVerb, wordCount } from '../text.js';

/**
 * Readability — 15%.
 *
 * Whether a human who reads six hundred of these a week will get anything out
 * of this one. Every rule here is about the first three words of a line, which
 * is realistically all the attention a bullet gets on the first pass.
 */

const actionVerbOpeners: Rule = {
  id: 'read.action-verbs',
  label: 'Bullets open with an action verb',
  component: 'readability',
  weight: 4,
  evaluate({ document }) {
    const bullets = allBullets(document);
    if (bullets.length === 0) return notApplicable('No bullets to check.');

    const strong = bullets.filter(startsWithActionVerb);
    const share = ratio(strong.length, bullets.length);

    if (share >= 0.8) {
      return pass(
        `${String(strong.length)} of ${String(bullets.length)} bullets open with an action verb.`,
      );
    }
    if (share >= 0.3) {
      return partial(
        share,
        `Only ${String(strong.length)} of ${String(bullets.length)} bullets open with an action verb.`,
        'Start with what you did — Built, Reduced, Led. "Worked on" and "Responsible for" describe a job description, not a person.',
      );
    }
    return fail(
      'Almost no bullets open with an action verb.',
      'Rewrite each to begin with a past-tense verb naming your contribution.',
    );
  },
};

const noFirstPerson: Rule = {
  id: 'read.first-person',
  label: 'No first-person pronouns',
  component: 'readability',
  weight: 3,
  evaluate({ document }) {
    // The summary is exempt by convention — a first-person summary is a style
    // choice many good resumes make. Bullets are not: "I built" wastes the one
    // word that should carry the verb.
    const bullets = allBullets(document);
    if (bullets.length === 0) return notApplicable('No bullets to check.');

    const offenders = bullets.filter(hasFirstPerson);
    if (offenders.length === 0) return pass('No first-person pronouns in bullets.');
    return partial(
      ratio(bullets.length - offenders.length, bullets.length),
      `${String(offenders.length)} bullet(s) use "I", "we", or "my".`,
      'Drop the pronoun. The whole document is already in your voice, and the space is better spent on the verb.',
    );
  },
};

const noCliches: Rule = {
  id: 'read.cliches',
  label: 'No filler phrases',
  component: 'readability',
  weight: 3,
  evaluate({ document }) {
    const haystack = [document.summary ?? '', ...allBullets(document)].filter((t) => t.trim());
    if (haystack.length === 0) return notApplicable('No prose to check yet.');

    const found = [...new Set(haystack.flatMap(clichesIn))];
    if (found.length === 0) return pass('No stock phrases found.');
    if (found.length <= 2) {
      return partial(
        0.5,
        `Contains ${found.map((f) => `"${f}"`).join(' and ')}.`,
        'Replace the claim with its evidence. "Team player" persuades nobody; "reviewed 40 pull requests a month across three teams" does the same job and is checkable.',
      );
    }
    return fail(
      `Contains ${String(found.length)} stock phrases: ${found.slice(0, 4).join(', ')}.`,
      'Cut all of them and state what you actually did instead.',
    );
  },
};

const sentenceComplexity: Rule = {
  id: 'read.complexity',
  label: 'Bullets are single, scannable statements',
  component: 'readability',
  weight: 2,
  evaluate({ document }) {
    const bullets = allBullets(document);
    if (bullets.length === 0) return notApplicable('No bullets to check.');

    // A bullet with several clauses is doing the work of two bullets and being
    // read as neither.
    const dense = bullets.filter((b) => {
      // Count the joins rather than the clauses. Measuring clause length missed
      // the case this rule is for — a chain of short clauses ("built X, and
      // designed Y, which did Z, while mentoring W") reads as one unparseable
      // run-on even though no individual piece is long.
      const joins = b.match(/[;,]| and | which | while /gi)?.length ?? 0;
      return joins >= 4 || wordCount(b) > 45;
    });

    if (dense.length === 0) return pass('Every bullet reads as a single statement.');
    const share = ratio(bullets.length - dense.length, bullets.length);
    if (share >= 0.7) {
      return partial(
        share,
        `${String(dense.length)} bullet(s) pack several ideas into one line.`,
        'Split them. Two bullets that each land beat one that has to be read twice.',
      );
    }
    return fail(
      'Most bullets contain several ideas each.',
      'Give every accomplishment its own line.',
    );
  },
};

export const readabilityRules: readonly Rule[] = [
  actionVerbOpeners,
  noFirstPerson,
  noCliches,
  sentenceComplexity,
];
