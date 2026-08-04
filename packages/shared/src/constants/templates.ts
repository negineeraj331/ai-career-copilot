/**
 * The template catalogue (docs/05 `Template`).
 *
 * Metadata lives here rather than in the database because the thing it
 * describes is a React component that ships in the client bundle: a database
 * row could name a template the deployed build cannot render, and the failure
 * would land on the user rather than at deploy time. Keeping the list in
 * `@cc/shared` means the API validates `templateId` against exactly what the web
 * app can draw, and adding a template is one commit that changes both.
 *
 * Deviation from docs/05 recorded in docs/tracker.md. Revisit if templates ever
 * become user-authored, at which point they stop being code and a table is
 * right.
 */

export interface TemplateMeta {
  readonly id: string;
  readonly name: string;
  readonly category: 'ats' | 'classic' | 'modern' | 'academic';
  readonly description: string;
  /**
   * False means a parser is likely to mangle it. The UI must warn rather than
   * quietly hand someone a resume that reads beautifully and scans as noise —
   * that is the whole reason this flag exists instead of a house style.
   */
  readonly atsSafe: boolean;
  readonly premium: boolean;
  readonly sortOrder: number;
}

export const TEMPLATES: readonly TemplateMeta[] = [
  {
    id: 'minimal-ats',
    name: 'Minimal',
    category: 'ats',
    description: 'Single column, standard headings, nothing a parser can trip over. The default.',
    atsSafe: true,
    premium: false,
    sortOrder: 1,
  },
  {
    id: 'classic-serif',
    name: 'Classic',
    category: 'classic',
    description: 'Serif type and centred header. Traditional industries, consulting, law.',
    atsSafe: true,
    premium: false,
    sortOrder: 2,
  },
  {
    id: 'compact',
    name: 'Compact',
    category: 'ats',
    description: 'Tighter spacing to fit a long history on one page without shrinking the type.',
    atsSafe: true,
    premium: false,
    sortOrder: 3,
  },
  {
    id: 'technical',
    name: 'Technical',
    category: 'modern',
    description: 'Skills and stack promoted up the page. Built for engineering screens.',
    atsSafe: true,
    premium: false,
    sortOrder: 4,
  },
  {
    id: 'academic',
    name: 'Academic',
    category: 'academic',
    description: 'Education first, room for publications and long-form detail.',
    atsSafe: true,
    premium: false,
    sortOrder: 5,
  },
  {
    id: 'two-column',
    name: 'Two column',
    category: 'modern',
    description:
      'A sidebar for skills and contact details. Looks sharp to a human; most parsers read the two columns straight across and interleave them into nonsense.',
    // Deliberately shipped as unsafe rather than omitted. A flag no template
    // ever trips is a flag nobody believes, and users will find a two-column
    // template somewhere — better here, with the warning attached.
    atsSafe: false,
    premium: false,
    sortOrder: 6,
  },
] as const;

export const TEMPLATE_IDS = TEMPLATES.map((t) => t.id);

export const DEFAULT_TEMPLATE_ID = 'minimal-ats';

export function templateById(id: string): TemplateMeta | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function isKnownTemplate(id: string): boolean {
  return TEMPLATES.some((t) => t.id === id);
}
