import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';
import { SECTION_TITLES, SectionBody, contactLine, hasContent } from './parts.js';
import type { TemplateProps } from './types.js';

/**
 * The six launch templates.
 *
 * Five are one flavour of the same safe idea — single column, real headings,
 * ordinary text — differing in typography, density, and what gets promoted up
 * the page. The sixth is deliberately two-column and flagged unsafe, because a
 * warning nobody ever sees is not a warning.
 *
 * They share `SingleColumn` rather than each reimplementing sections: templates
 * should differ in how a resume looks, never in what it says.
 */

/**
 * Move one section to the front, if it is present at all.
 *
 * The guard is the point: a hidden section must stay hidden no matter which
 * template is chosen.
 */
function promote(
  sections: TemplateProps['sections'],
  key: TemplateProps['sections'][number],
): TemplateProps['sections'] {
  if (!sections.includes(key)) return sections;
  return [key, ...sections.filter((s) => s !== key)];
}

interface StyleSpec {
  /** Wrapper classes: type family, base size, colour. */
  page: string;
  header: string;
  name: string;
  heading: string;
  /** Vertical rhythm between sections. */
  sectionGap: string;
}

function SingleColumn({
  doc,
  sections,
  style,
  centeredHeader = false,
}: TemplateProps & { style: StyleSpec; centeredHeader?: boolean }): ReactNode {
  return (
    <div className={cn('cc-preview bg-white text-neutral-900', style.page)}>
      <header className={cn(style.header, centeredHeader && 'text-center')}>
        <h1 className={style.name}>{doc.contact.fullName || 'Your name'}</h1>
        {doc.contact.headline && <p className="opacity-80">{doc.contact.headline}</p>}
        <p className="text-[0.85em] opacity-70">{contactLine(doc)}</p>
        {doc.contact.links.length > 0 && (
          <p className="text-[0.85em] opacity-70">
            {doc.contact.links.map((l) => `${l.label}: ${l.url}`).join(' · ')}
          </p>
        )}
      </header>

      {sections
        .filter((key) => hasContent(doc, key))
        .map((key) => (
          <section key={key} className={style.sectionGap}>
            <h2 className={style.heading}>{SECTION_TITLES[key] ?? key}</h2>
            <SectionBody doc={doc} section={key} />
          </section>
        ))}
    </div>
  );
}

export function MinimalTemplate(props: TemplateProps): ReactNode {
  return (
    <SingleColumn
      {...props}
      style={{
        page: 'p-10 text-[13px] leading-relaxed',
        header: 'border-b border-neutral-300 pb-3',
        name: 'text-2xl font-semibold tracking-tight',
        heading:
          'mb-2 border-b border-neutral-200 pb-1 text-xs font-bold tracking-widest uppercase',
        sectionGap: 'mt-5',
      }}
    />
  );
}

export function ClassicTemplate(props: TemplateProps): ReactNode {
  return (
    <SingleColumn
      {...props}
      centeredHeader
      style={{
        // A generic serif stack, not a webfont: an export must not depend on a
        // font that may not have loaded, and a missing webfont silently reflows
        // a document whose whole selling point is that it fits on one page.
        page: 'p-12 font-serif text-[13px] leading-relaxed',
        header: 'border-b-2 border-neutral-800 pb-3',
        name: 'text-3xl font-bold tracking-tight',
        heading: 'mb-2 text-sm font-bold tracking-wide uppercase',
        sectionGap: 'mt-5',
      }}
    />
  );
}

export function CompactTemplate(props: TemplateProps): ReactNode {
  return (
    <SingleColumn
      {...props}
      style={{
        // Tighter rhythm, same type size. Shrinking the font to fit is how a
        // resume becomes unreadable at exactly the moment it is being skimmed.
        page: 'p-8 text-[12.5px] leading-snug',
        header: 'border-b border-neutral-300 pb-2',
        name: 'text-xl font-semibold tracking-tight',
        heading: 'mb-1 text-[11px] font-bold tracking-widest uppercase',
        sectionGap: 'mt-3',
      }}
    />
  );
}

export function TechnicalTemplate(props: TemplateProps): ReactNode {
  // Skills first, but only if skills are actually visible. Prepending
  // unconditionally resurrected a section the user had hidden — a template may
  // reorder what someone chose to show; it may not overrule what they chose to
  // hide.
  const promoted = promote(props.sections, 'skills');
  return (
    <SingleColumn
      {...props}
      sections={promoted}
      style={{
        page: 'p-10 text-[13px] leading-relaxed',
        header: 'border-b-2 border-neutral-900 pb-3',
        name: 'text-2xl font-bold tracking-tight',
        heading: 'mb-2 font-mono text-[11px] font-bold tracking-widest text-neutral-700 uppercase',
        sectionGap: 'mt-5',
      }}
    />
  );
}

export function AcademicTemplate(props: TemplateProps): ReactNode {
  const promoted = promote(props.sections, 'education');
  return (
    <SingleColumn
      {...props}
      sections={promoted}
      centeredHeader
      style={{
        page: 'p-12 font-serif text-[13px] leading-loose',
        header: 'pb-4',
        name: 'text-2xl font-semibold tracking-wide',
        heading: 'mb-2 text-sm font-semibold italic',
        sectionGap: 'mt-6',
      }}
    />
  );
}

/**
 * The one template flagged `atsSafe: false`.
 *
 * The sidebar is the point and also the problem: most parsers read a
 * two-column layout straight across, interleaving the sidebar into the main
 * text. It ships anyway, with the warning attached, because users will find a
 * two-column resume template somewhere — better one that tells them the cost.
 */
export function TwoColumnTemplate({ doc, sections }: TemplateProps): ReactNode {
  // Narrow, contact-like sections go in the sidebar; everything narrative stays
  // in the main column, where a parser at least reads it in order.
  const SIDEBAR = new Set(['skills', 'certifications']);
  const sidebarKeys = sections.filter((key) => SIDEBAR.has(key));
  const mainKeys = sections.filter((key) => !SIDEBAR.has(key));

  return (
    <div className="cc-preview grid grid-cols-[1fr_2fr] gap-6 bg-white p-10 text-[13px] leading-relaxed text-neutral-900">
      <aside className="border-r border-neutral-200 pr-5">
        <h1 className="text-xl font-semibold tracking-tight">
          {doc.contact.fullName || 'Your name'}
        </h1>
        {doc.contact.headline && <p className="text-[0.9em] opacity-80">{doc.contact.headline}</p>}
        <p className="mt-2 text-[0.85em] break-words opacity-70">{contactLine(doc)}</p>
        {doc.contact.links.map((l) => (
          <p key={l.id} className="text-[0.85em] break-words opacity-70">
            {l.label}: {l.url}
          </p>
        ))}

        {sidebarKeys
          .filter((key) => hasContent(doc, key))
          .map((key) => (
            <section key={key} className="mt-5">
              <h2 className="mb-1 text-[11px] font-bold tracking-widest uppercase">
                {SECTION_TITLES[key] ?? key}
              </h2>
              <SectionBody doc={doc} section={key} />
            </section>
          ))}
      </aside>

      <main>
        {mainKeys
          .filter((key) => hasContent(doc, key))
          .map((key) => (
            <section key={key} className="mt-4 first:mt-0">
              <h2 className="mb-2 border-b border-neutral-200 pb-1 text-[11px] font-bold tracking-widest uppercase">
                {SECTION_TITLES[key] ?? key}
              </h2>
              <SectionBody doc={doc} section={key} />
            </section>
          ))}
      </main>
    </div>
  );
}
