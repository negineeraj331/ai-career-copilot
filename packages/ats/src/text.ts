import type { ResumeDocument } from '@cc/shared';

/**
 * Text primitives shared by the rules. Kept here rather than duplicated so that
 * "what counts as a bullet" has exactly one answer across the rubric — two
 * rules disagreeing about that is how a score becomes unexplainable.
 */

export function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

export function wordCount(text: string): number {
  return words(text).length;
}

/** Every bullet in the document, in render order, from every section that has them. */
export function allBullets(doc: ResumeDocument): string[] {
  return [
    ...doc.experience.flatMap((e) => e.bullets.map((b) => b.text)),
    ...doc.projects.flatMap((p) => p.bullets.map((b) => b.text)),
    ...doc.education.flatMap((e) => e.highlights.map((h) => h.text)),
    ...doc.customSections.flatMap((s) => s.items.map((i) => i.text)),
  ];
}

/** Every skill name across every group, lowercased. */
export function allSkills(doc: ResumeDocument): string[] {
  return doc.skills.flatMap((g) => g.skills.map((s) => s.toLowerCase()));
}

/**
 * The document as one lowercased string, for presence checks.
 *
 * Deliberately includes technologies and skills as well as prose: a recruiter's
 * keyword search does not care which section a term appeared in, and neither
 * does an applicant tracking system.
 */
export function fullText(doc: ResumeDocument): string {
  return [
    doc.summary ?? '',
    doc.contact.headline ?? '',
    ...doc.experience.flatMap((e) => [e.company, e.role, ...e.technologies]),
    ...doc.projects.flatMap((p) => [p.name, p.description ?? '', ...p.technologies]),
    ...doc.education.flatMap((e) => [e.institution, e.degree, e.field ?? '']),
    ...doc.certifications.map((c) => c.name),
    ...doc.achievements.map((a) => `${a.title} ${a.description ?? ''}`),
    ...allSkills(doc),
    ...allBullets(doc),
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * Strong openers. Not an exhaustive list of English verbs — it is the set that
 * actually appears at the start of good resume bullets, which is a much smaller
 * and more checkable thing.
 */
const ACTION_VERBS = new Set([
  'accelerated',
  'achieved',
  'added',
  'administered',
  'advised',
  'analysed',
  'analyzed',
  'architected',
  'authored',
  'automated',
  'built',
  'championed',
  'changed',
  'collaborated',
  'consolidated',
  'converted',
  'created',
  'cut',
  'debugged',
  'decreased',
  'defined',
  'delivered',
  'deployed',
  'designed',
  'developed',
  'diagnosed',
  'directed',
  'drove',
  'eliminated',
  'enabled',
  'engineered',
  'enhanced',
  'established',
  'expanded',
  'extended',
  'facilitated',
  'fixed',
  'formed',
  'founded',
  'generated',
  'grew',
  'guided',
  'halved',
  'handled',
  'headed',
  'identified',
  'implemented',
  'improved',
  'increased',
  'initiated',
  'instituted',
  'integrated',
  'introduced',
  'investigated',
  'launched',
  'led',
  'maintained',
  'managed',
  'mentored',
  'migrated',
  'modernised',
  'modernized',
  'negotiated',
  'operated',
  'optimised',
  'optimized',
  'orchestrated',
  'organised',
  'organized',
  'overhauled',
  'owned',
  'partnered',
  'performed',
  'pioneered',
  'planned',
  'presented',
  'prioritised',
  'prioritized',
  'produced',
  'programmed',
  'proposed',
  'prototyped',
  'published',
  'raised',
  'rearchitected',
  'rebuilt',
  'reduced',
  'refactored',
  'released',
  'removed',
  'resolved',
  'restructured',
  'revamped',
  'saved',
  'scaled',
  'secured',
  'shipped',
  'simplified',
  'solved',
  'spearheaded',
  'standardised',
  'standardized',
  'streamlined',
  'strengthened',
  'supported',
  'tested',
  'trained',
  'transformed',
  'tripled',
  'doubled',
  'upgraded',
  'validated',
  'wrote',
]);

export function startsWithActionVerb(bullet: string): boolean {
  const first =
    words(bullet)[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, '') ?? '';
  return ACTION_VERBS.has(first);
}

/** First-person pronouns. A resume is written in implied first person already. */
const FIRST_PERSON = /\b(i|me|my|mine|myself|we|our|ours|us)\b/i;

export function hasFirstPerson(text: string): boolean {
  return FIRST_PERSON.test(text);
}

/**
 * Phrases that claim a quality instead of evidencing it. Every one of these is
 * a sentence the reader has seen a thousand times and learned to skip.
 */
const CLICHES = [
  'team player',
  'hard worker',
  'hard-working',
  'go-getter',
  'think outside the box',
  'thinking outside the box',
  'results-driven',
  'results driven',
  'self-starter',
  'self starter',
  'detail-oriented',
  'detail oriented',
  'responsible for',
  'duties included',
  'proven track record',
  'dynamic professional',
  'synergy',
  'best of breed',
  'go the extra mile',
  'wear many hats',
];

export function clichesIn(text: string): string[] {
  const lower = text.toLowerCase();
  return CLICHES.filter((c) => lower.includes(c));
}

/**
 * Does this bullet carry a number that means something?
 *
 * Percentages, money, multipliers, scale suffixes, and bare counts all qualify.
 * Years alone deliberately do not: "Java developer since 2019" states tenure,
 * not impact, and counting it would let a resume full of dates score as though
 * it were full of results.
 */
export function isQuantified(bullet: string): boolean {
  const withoutYears = bullet.replace(/\b(19|20)\d{2}\b/g, ' ');
  return (
    /\d+\s*%/.test(withoutYears) ||
    /[$£€₹]\s*\d/.test(withoutYears) ||
    /\b\d+(\.\d+)?\s*(x|×)\b/i.test(withoutYears) ||
    /\b\d+(\.\d+)?\s*(k|m|bn|b|lakh|crore|million|billion|thousand)\b/i.test(withoutYears) ||
    /\b\d+(\.\d+)?\s*(ms|s|sec|seconds|min|minutes|hrs|hours|days|weeks|months)\b/i.test(
      withoutYears,
    ) ||
    /\b\d{2,}\b/.test(withoutYears) ||
    /\b(halved|doubled|tripled|quadrupled)\b/i.test(withoutYears)
  );
}

/**
 * Characters an ATS parser is known to mangle: box-drawing and block glyphs
 * used to fake tables and columns, private-use-area glyphs from icon fonts, and
 * the emoji ranges. Plain punctuation and accented letters are fine and are
 * deliberately not listed.
 */
const RISKY_GLYPHS = new RegExp(
  [
    '[\\u2500-\\u257F', // box drawing — fake tables
    '\\u2580-\\u259F', // block elements — fake bar charts for "skill level"
    '\\u25A0-\\u25FF', // geometric shapes — filled/hollow rating dots
    '\\uE000-\\uF8FF', // private use area — icon fonts, which parse as nothing
    '\\u{1F000}-\\u{1F9FF}]', // emoji and pictographs
  ].join(''),
  'u',
);

export function hasRiskyGlyphs(text: string): boolean {
  return RISKY_GLYPHS.test(text);
}

/** Tab-separated or pipe-separated runs, which are usually a table in disguise. */
export function looksTabular(text: string): boolean {
  // Two pipes already means three columns — "Skill | Level | Years" is the
  // canonical case. An earlier version required three, which missed exactly the
  // three-column skills matrix this rule exists to catch.
  return /\t/.test(text) || /\|[^|]*\|/.test(text);
}
