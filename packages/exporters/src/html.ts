import type { ResumeDocument, SectionKey } from '@cc/shared';
import { isPresent, visibleSections } from './sections.js';

/**
 * Print-ready HTML — the input Chromium turns into the PDF.
 *
 * This deliberately does NOT reuse the React template components from
 * `apps/web`. FR-26 puts PDF rendering server-side to keep templates out of the
 * client bundle, and the worker must not import the web app: it would drag React
 * and Tailwind's build pipeline into a headless process to produce a string.
 *
 * The cost of that decision is real and worth naming — the on-screen preview and
 * the PDF are two implementations of the same layout, and they can drift. What
 * stops that becoming invisible is that both read the same document, both use
 * the same section ordering helper, and the golden tests here assert the content
 * is complete. Visual parity is checked by eye until slice 4.x adds snapshots.
 *
 * Styles are inline and self-contained: a PDF that depends on a stylesheet or a
 * webfont over the network renders differently — or blank — depending on whether
 * the fetch won a race with the print call.
 */

interface TemplateStyle {
  bodyFont: string;
  fontSize: string;
  headingStyle: string;
  headerAlign: 'left' | 'center';
  padding: string;
  twoColumn: boolean;
}

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const STYLES: Record<string, TemplateStyle> = {
  'minimal-ats': {
    bodyFont: SANS,
    fontSize: '10.5pt',
    headingStyle: 'text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #d4d4d4;',
    headerAlign: 'left',
    padding: '18mm',
    twoColumn: false,
  },
  'classic-serif': {
    bodyFont: SERIF,
    fontSize: '11pt',
    headingStyle: 'text-transform:uppercase;letter-spacing:.05em;',
    headerAlign: 'center',
    padding: '20mm',
    twoColumn: false,
  },
  compact: {
    bodyFont: SANS,
    fontSize: '9.5pt',
    headingStyle: 'text-transform:uppercase;letter-spacing:.08em;',
    headerAlign: 'left',
    padding: '14mm',
    twoColumn: false,
  },
  technical: {
    bodyFont: SANS,
    fontSize: '10.5pt',
    headingStyle:
      "font-family:ui-monospace,'SF Mono',Menlo,monospace;text-transform:uppercase;letter-spacing:.1em;",
    headerAlign: 'left',
    padding: '18mm',
    twoColumn: false,
  },
  academic: {
    bodyFont: SERIF,
    fontSize: '11pt',
    headingStyle: 'font-style:italic;',
    headerAlign: 'center',
    padding: '20mm',
    twoColumn: false,
  },
  'two-column': {
    bodyFont: SANS,
    fontSize: '10pt',
    headingStyle: 'text-transform:uppercase;letter-spacing:.08em;',
    headerAlign: 'left',
    padding: '16mm',
    twoColumn: true,
  },
};

/** Escapes the five characters that can break out of HTML text or an attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function range(start: string, end: string | null): string {
  return `${escapeHtml(start)} – ${end ? escapeHtml(end) : 'Present'}`;
}

function bullets(items: { text: string }[]): string {
  const kept = items.filter((b) => b.text.trim());
  if (kept.length === 0) return '';
  return `<ul>${kept.map((b) => `<li>${escapeHtml(b.text.trim())}</li>`).join('')}</ul>`;
}

const TITLES: Record<string, string> = {
  summary: 'Summary',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  skills: 'Skills',
  certifications: 'Certifications',
  achievements: 'Achievements',
};

function sectionHtml(doc: ResumeDocument, key: SectionKey): string {
  const body = ((): string => {
    switch (key) {
      case 'summary':
        return doc.summary?.trim() ? `<p>${escapeHtml(doc.summary.trim())}</p>` : '';
      case 'experience':
        return doc.experience
          .map(
            (role) => `<article>
  <div class="row"><strong>${escapeHtml(role.role || 'Role')}${
    role.company ? ` — ${escapeHtml(role.company)}` : ''
  }</strong><span class="muted">${range(role.dates.start, role.dates.end)}</span></div>
  ${bullets(role.bullets)}
  ${
    role.technologies.filter(Boolean).length > 0
      ? `<p class="muted">${role.technologies.filter(Boolean).map(escapeHtml).join(' · ')}</p>`
      : ''
  }
</article>`,
          )
          .join('');
      case 'projects':
        return doc.projects
          .map(
            (p) => `<article>
  <strong>${escapeHtml(p.name || 'Project')}</strong>
  ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ''}
  ${bullets(p.bullets)}
  ${
    p.technologies.filter(Boolean).length > 0
      ? `<p class="muted">${p.technologies.filter(Boolean).map(escapeHtml).join(' · ')}</p>`
      : ''
  }
</article>`,
          )
          .join('');
      case 'education':
        return doc.education
          .map((e) => {
            const degree = [e.degree, e.field].filter(isPresent).map(escapeHtml).join(', ');
            return `<div class="row"><span><strong>${degree || 'Degree'}</strong>${
              e.institution ? ` — ${escapeHtml(e.institution)}` : ''
            }${e.grade ? ` (${escapeHtml(e.grade)})` : ''}</span><span class="muted">${range(
              e.dates.start,
              e.dates.end,
            )}</span></div>`;
          })
          .join('');
      case 'skills':
        return doc.skills
          .filter((g) => g.skills.filter(Boolean).length > 0)
          .map(
            (g) =>
              `<p><strong>${escapeHtml(g.category || 'Skills')}:</strong> ${g.skills
                .filter(Boolean)
                .map(escapeHtml)
                .join(', ')}</p>`,
          )
          .join('');
      case 'certifications':
        return doc.certifications
          .map((c) => `<p>${escapeHtml(c.name)}${c.issuer ? ` — ${escapeHtml(c.issuer)}` : ''}</p>`)
          .join('');
      case 'achievements':
        return doc.achievements
          .map(
            (a) =>
              `<p><strong>${escapeHtml(a.title)}</strong>${
                a.description ? ` — ${escapeHtml(a.description)}` : ''
              }</p>`,
          )
          .join('');
      default:
        return '';
    }
  })();

  if (!body) return '';
  return `<section><h2>${escapeHtml(TITLES[key] ?? key)}</h2>${body}</section>`;
}

export function toPrintHtml(
  doc: ResumeDocument,
  templateId: string,
  order?: readonly SectionKey[],
): string {
  const style = STYLES[templateId] ?? STYLES['minimal-ats'];
  if (!style) throw new Error('No print style available.');

  const sections = visibleSections(doc, order);
  const { contact } = doc;

  const header = `<header style="text-align:${style.headerAlign}">
  <h1>${escapeHtml(contact.fullName || 'Your name')}</h1>
  ${contact.headline ? `<p class="headline">${escapeHtml(contact.headline)}</p>` : ''}
  <p class="muted">${[contact.email, contact.phone, contact.location]
    .filter(isPresent)
    .map(escapeHtml)
    .join(' · ')}</p>
  ${contact.links
    .map((l) => `<p class="muted">${escapeHtml(l.label)}: ${escapeHtml(l.url)}</p>`)
    .join('')}
</header>`;

  const sidebarKeys: SectionKey[] = style.twoColumn
    ? sections.filter((k) => k === 'skills' || k === 'certifications')
    : [];
  const mainKeys = sections.filter((k) => !sidebarKeys.includes(k));

  const body = style.twoColumn
    ? `<div class="cols"><aside>${sidebarKeys
        .map((k) => sectionHtml(doc, k))
        .join('')}</aside><main>${mainKeys.map((k) => sectionHtml(doc, k)).join('')}</main></div>`
    : mainKeys.map((k) => sectionHtml(doc, k)).join('');

  // `@page` sets the physical margins; the body padding is zero so the two do
  // not stack into a page with an inch of whitespace on every side.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(contact.fullName || 'Resume')}</title>
<style>
  @page { size: A4; margin: ${style.padding}; }
  * { box-sizing: border-box; }
  body { margin:0; padding:0; font-family:${style.bodyFont}; font-size:${style.fontSize};
         line-height:1.45; color:#111; }
  h1 { font-size:1.9em; margin:0 0 2px; letter-spacing:-.01em; }
  h2 { font-size:.82em; font-weight:700; margin:14px 0 6px; padding-bottom:2px; ${style.headingStyle} }
  p { margin:2px 0; }
  ul { margin:4px 0 4px 1.1em; padding:0; }
  li { margin:1px 0; }
  .muted { color:#555; font-size:.88em; }
  .headline { color:#333; }
  .row { display:flex; justify-content:space-between; gap:12px; align-items:baseline; }
  article { margin-bottom:8px; }
  header { border-bottom:1px solid #d4d4d4; padding-bottom:6px; margin-bottom:4px; }
  .cols { display:grid; grid-template-columns:1fr 2fr; gap:14px; }
  aside { border-right:1px solid #e5e5e5; padding-right:12px; }
  /* Never split a role or a heading across a page — a bullet list orphaned
     from its job title is unreadable, and it is the commonest PDF defect. */
  section, article { break-inside:avoid; page-break-inside:avoid; }
  h2 { break-after:avoid; page-break-after:avoid; }
</style>
</head>
<body>
${header}
${body}
</body>
</html>
`;
}
