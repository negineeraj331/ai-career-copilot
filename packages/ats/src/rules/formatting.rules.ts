import { fail, notApplicable, partial, pass, type Rule, ratio } from '../rubric.js';
import { allBullets, wordCount } from '../text.js';

/**
 * Formatting — 20%.
 *
 * Rules about the shape of the writing rather than its content: bullet length,
 * tense consistency, terminal punctuation. These are the things a reader
 * notices without being able to say why the document felt careless.
 */

const BULLET_MIN = 12;
const BULLET_MAX = 30;

const bulletLength: Rule = {
  id: 'format.bullet-length',
  label: 'Bullets are 12–30 words',
  component: 'formatting',
  weight: 4,
  evaluate({ document }) {
    const bullets = allBullets(document);
    if (bullets.length === 0) return notApplicable('No bullets to measure.');

    const inRange = bullets.filter((b) => {
      const n = wordCount(b);
      return n >= BULLET_MIN && n <= BULLET_MAX;
    });
    const share = ratio(inRange.length, bullets.length);

    if (share >= 0.8) {
      return pass(
        `${String(inRange.length)} of ${String(bullets.length)} bullets are a readable length.`,
      );
    }

    const tooShort = bullets.filter((b) => wordCount(b) < BULLET_MIN).length;
    const tooLong = bullets.filter((b) => wordCount(b) > BULLET_MAX).length;
    const detail = [
      tooShort > 0 ? `${String(tooShort)} under ${String(BULLET_MIN)} words` : '',
      tooLong > 0 ? `${String(tooLong)} over ${String(BULLET_MAX)} words` : '',
    ]
      .filter(Boolean)
      .join(', ');

    if (share >= 0.4) {
      return partial(
        share,
        `${detail}.`,
        'Short bullets state a task without impact; long ones stop being read. Aim for one accomplishment, its method, and its result.',
      );
    }
    return fail(
      `Most bullets fall outside 12–30 words (${detail}).`,
      'Rewrite so each bullet is a single accomplishment with a measurable result.',
    );
  },
};

const tenseConsistency: Rule = {
  id: 'format.tense',
  label: 'Consistent tense within a role',
  component: 'formatting',
  weight: 3,
  evaluate({ document }) {
    // Only current roles are checkable this way: a past role should be entirely
    // past tense, but "led" and "leads" both appear legitimately in a current
    // one, so the rule confines itself to what it can judge without guessing.
    const past = document.experience.filter((e) => e.dates.end !== null);
    const checkable = past.filter((e) => e.bullets.length >= 2);
    if (checkable.length === 0) {
      return notApplicable('No completed roles with enough bullets to compare.');
    }

    const mixed = checkable.filter((role) => {
      const present = role.bullets.filter((b) => /^\w+s\b/.test(b.text.trim())).length;
      const other = role.bullets.length - present;
      return present > 0 && other > 0;
    });

    if (mixed.length === 0) return pass('Each completed role uses one tense throughout.');
    return partial(
      ratio(checkable.length - mixed.length, checkable.length),
      `${String(mixed.length)} completed role(s) mix present and past tense between bullets.`,
      'Use past tense throughout a role you have left. Mixed tense inside one job reads as an unedited copy-paste.',
    );
  },
};

const terminalPunctuation: Rule = {
  id: 'format.punctuation',
  label: 'Consistent bullet punctuation',
  component: 'formatting',
  weight: 2,
  evaluate({ document }) {
    const bullets = allBullets(document);
    if (bullets.length < 3) return notApplicable('Too few bullets to judge consistency.');

    const withPeriod = bullets.filter((b) => b.trim().endsWith('.')).length;
    const without = bullets.length - withPeriod;

    if (withPeriod === 0 || without === 0) {
      return pass('Bullet punctuation is consistent throughout.');
    }
    // Either convention is fine; mixing them is what looks careless.
    const dominant = Math.max(withPeriod, without);
    return partial(
      ratio(dominant, bullets.length),
      `${String(withPeriod)} bullets end with a full stop and ${String(without)} do not.`,
      'Pick one and apply it everywhere. Which one does not matter; the inconsistency is what shows.',
    );
  },
};

const headlinePresent: Rule = {
  id: 'format.headline',
  label: 'A headline states the target role',
  component: 'formatting',
  weight: 2,
  evaluate({ document, targetRole }) {
    const headline = document.contact.headline?.trim() ?? '';
    if (headline.length >= 8) {
      return pass(`Headline present: "${headline}".`);
    }
    const suggestion = targetRole ? ` For example: "${targetRole}".` : '';
    return partial(
      0.2,
      'No headline under your name.',
      `Add one naming the role you are applying for.${suggestion} It is the first line read and the cheapest signal of fit.`,
    );
  },
};

const summaryLength: Rule = {
  id: 'format.summary',
  label: 'Summary is present and concise',
  component: 'formatting',
  weight: 3,
  evaluate({ document }) {
    const summary = document.summary?.trim() ?? '';
    if (summary.length === 0) {
      return fail(
        'No professional summary.',
        'Add two or three sentences covering what you do, your strongest evidence for it, and what you are looking for.',
      );
    }
    const n = wordCount(summary);
    if (n >= 25 && n <= 80) return pass(`Summary is ${String(n)} words — a readable length.`);
    if (n < 25) {
      return partial(
        ratio(n, 25),
        `Summary is only ${String(n)} words.`,
        'Too short to say anything specific. Name your discipline, your strongest result, and your target.',
      );
    }
    return partial(
      ratio(80, n),
      `Summary is ${String(n)} words, long enough that it will be skimmed past.`,
      'Cut to under 80 words. The summary earns attention for the rest of the page; it does not replace it.',
    );
  },
};

export const formattingRules: readonly Rule[] = [
  bulletLength,
  tenseConsistency,
  terminalPunctuation,
  headlinePresent,
  summaryLength,
];
