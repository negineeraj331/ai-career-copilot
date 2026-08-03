import { SECTION_KEYS } from '@cc/shared';
import { fail, notApplicable, partial, pass, type Rule, ratio } from '../rubric.js';
import { allBullets, fullText, hasRiskyGlyphs, looksTabular } from '../text.js';

/**
 * Parseability — 30%, the heaviest component.
 *
 * These rules ask one question: will a machine reading this file recover the
 * facts it contains? Everything else in the rubric is advice; this is the part
 * where a resume is silently discarded before a human ever sees it, so it
 * carries the most weight.
 */

const riskyGlyphs: Rule = {
  id: 'parse.glyphs',
  label: 'No decorative glyphs',
  component: 'parseability',
  weight: 3,
  evaluate({ document }) {
    const subject = [document.summary ?? '', ...allBullets(document)].filter((t) => t.trim());
    // Nothing to inspect is not a clean bill of health. A rule that passes
    // vacuously lets an empty document collect points for the defects it is
    // too empty to have.
    if (subject.length === 0) return notApplicable('No prose content to inspect yet.');

    const offenders = subject.filter(hasRiskyGlyphs);
    if (offenders.length === 0) {
      return pass('No box-drawing, icon-font, or emoji characters found.');
    }
    return fail(
      `${String(offenders.length)} line(s) contain characters a parser cannot read, such as rating dots or icon glyphs.`,
      'Replace visual ratings and icons with words. A parser reads "Advanced"; it reads ●●●○○ as nothing.',
    );
  },
};

const tabularLayout: Rule = {
  id: 'parse.tabular',
  label: 'No tables or columns',
  component: 'parseability',
  weight: 3,
  evaluate({ document }) {
    const subject = [document.summary ?? '', ...allBullets(document)].filter((t) => t.trim());
    if (subject.length === 0) return notApplicable('No prose content to inspect yet.');

    const offenders = subject.filter(looksTabular);
    if (offenders.length === 0) return pass('Content reads as a single column.');
    return fail(
      `${String(offenders.length)} line(s) look like table or multi-column layout.`,
      'Move the content into ordinary lines. Most parsers read a two-column resume straight across, interleaving both columns into nonsense.',
    );
  },
};

const standardSections: Rule = {
  id: 'parse.sections',
  label: 'Standard section headings',
  component: 'parseability',
  weight: 2,
  evaluate({ document }) {
    // Custom sections are not a defect — "Publications" is legitimate. But a
    // resume whose *entire* content sits under invented headings gives a parser
    // no anchor at all, so this scores the proportion rather than banning them.
    const standard = SECTION_KEYS.filter((key) => {
      if (key === 'summary') return Boolean(document.summary);
      const value = document[key as keyof typeof document];
      return Array.isArray(value) && value.length > 0;
    }).length;
    const custom = document.customSections.length;
    const total = standard + custom;

    if (total === 0) {
      return fail(
        'The document has no populated sections.',
        'Add at least a summary and one experience or project section.',
      );
    }
    if (custom === 0) return pass('Every section uses a standard heading.');

    const share = ratio(standard, total);
    if (share >= 0.7) {
      return partial(
        share,
        `${String(custom)} custom section heading(s) alongside ${String(standard)} standard ones.`,
        'Keep custom headings for genuinely non-standard content. Anything that fits Experience, Projects, or Skills parses more reliably under those names.',
      );
    }
    return fail(
      'Most content sits under custom headings a parser will not recognise.',
      'Rename custom sections to the standard ones where the content fits.',
    );
  },
};

const machineReadableDates: Rule = {
  id: 'parse.dates',
  label: 'Machine-readable dates',
  component: 'parseability',
  weight: 2,
  evaluate({ document }) {
    // The schema already enforces YYYY-MM on every date field, so this rule
    // cannot fail on a document that validated. It stays in the rubric because
    // it is a real ATS failure mode and the score should show it was checked —
    // and it becomes load-bearing the moment slice 2.1 starts importing dates
    // parsed out of an uploaded PDF.
    const ranges = [
      ...document.experience.map((e) => e.dates),
      ...document.education.map((e) => e.dates),
      ...document.projects.flatMap((p) => (p.dates ? [p.dates] : [])),
    ];
    if (ranges.length === 0) {
      return fail(
        'No dated entries found.',
        'Add start and end dates to your experience and education.',
      );
    }
    return pass(`All ${String(ranges.length)} dated entries use an unambiguous YYYY-MM format.`);
  },
};

const contactParseable: Rule = {
  id: 'parse.contact',
  label: 'Contact details in the body',
  component: 'parseability',
  weight: 2,
  evaluate({ document }) {
    const { email, phone } = document.contact;
    if (email && phone) return pass('Email and phone are both present in the document body.');
    if (email) {
      return partial(
        0.6,
        'Email is present but no phone number is.',
        'Add a phone number. Recruiters routinely filter on its presence, and a header-only phone number is invisible to a parser.',
      );
    }
    return fail(
      'No email address in the document body.',
      'Put your email in the body text, never in a page header — most parsers never read headers.',
    );
  },
};

const singleColumnOrder: Rule = {
  id: 'parse.order',
  label: 'Sensible section order',
  component: 'parseability',
  weight: 1,
  evaluate({ document }) {
    const order = document.sections.order;
    const visible = order.filter((k) => !document.sections.hidden.includes(k));
    const experienceAt = visible.indexOf('experience');
    const educationAt = visible.indexOf('education');

    if (experienceAt === -1 || educationAt === -1) {
      return pass('Section order is unambiguous.');
    }
    // Not a parse failure so much as a ranking one: reverse-chronological
    // experience first is the convention recruiters scan for, and a resume that
    // buries it under education reads as a student's regardless of content.
    if (experienceAt < educationAt || document.experience.length === 0) {
      return pass('Experience appears before education, matching the expected order.');
    }
    return partial(
      0.5,
      'Education appears before experience.',
      'Lead with experience once you have any. Education first signals a recent graduate whether or not you are one.',
    );
  },
};

const noTextOnlyInLinks: Rule = {
  id: 'parse.links',
  label: 'Links carry readable labels',
  component: 'parseability',
  weight: 1,
  evaluate({ document }) {
    const links = document.contact.links;
    if (links.length === 0) return notApplicable('No links to check.');

    const unlabelled = links.filter((l) => l.label.trim().length < 2);
    if (unlabelled.length === 0) return pass('Every link has a readable label.');
    return partial(
      ratio(links.length - unlabelled.length, links.length),
      `${String(unlabelled.length)} link(s) have no meaningful label.`,
      'Label links "GitHub" or "Portfolio". A bare URL is fine for a parser but wastes a line for the human.',
    );
  },
};

const notEmpty: Rule = {
  id: 'parse.content',
  label: 'Document has readable content',
  component: 'parseability',
  weight: 2,
  evaluate({ document }) {
    const length = fullText(document).trim().length;
    if (length >= 400) return pass('The document contains enough text to parse meaningfully.');
    if (length >= 120) {
      return partial(
        ratio(length, 400),
        'The document is very short; a parser will extract little from it.',
        'Add detail to your experience and projects. Under roughly 200 words there is not enough for either a parser or a reader to work with.',
      );
    }
    return fail(
      'The document is effectively empty.',
      'Fill in your experience, projects, and skills before scoring.',
    );
  },
};

export const parseabilityRules: readonly Rule[] = [
  riskyGlyphs,
  tabularLayout,
  standardSections,
  machineReadableDates,
  contactParseable,
  singleColumnOrder,
  noTextOnlyInLinks,
  notEmpty,
];
