import type { ReactNode } from 'react';
import type { ResumeDocument } from '@cc/shared';
import { isHidden, orderedSections } from '../lib/document.js';

/**
 * A local render of the document (docs/09 §4).
 *
 * No network round trip — it renders whatever is in memory, so it tracks typing
 * rather than the last save. Templates arrive in slice 1.4; this is the plain
 * ATS-safe layout the rubric rewards: one column, standard headings, no tables,
 * no glyphs a parser cannot read.
 *
 * `cc-preview` scopes the styles. docs/09 asks for an isolated stacking context
 * so template CSS cannot leak into the app; a class prefix is the version of
 * that which survives being printed and exported, whereas an iframe or shadow
 * root would need the print stylesheet rebuilt inside it.
 */

function formatRange(start: string, end: string | null): string {
  return `${start} — ${end ?? 'Present'}`;
}

export function PreviewPane({ doc }: { doc: ResumeDocument }): ReactNode {
  const sections = orderedSections(doc).filter((key) => !isHidden(doc, key));

  return (
    <div
      className="cc-preview mx-auto max-w-[52rem] bg-white p-10 text-[13px] leading-relaxed text-neutral-900 shadow-sm"
      // The preview is a faithful rendering of the user's own document; a
      // screen-reader user editing the form does not need it read twice.
      aria-label="Resume preview"
      role="document"
    >
      <header className="border-b border-neutral-300 pb-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {doc.contact.fullName || 'Your name'}
        </h1>
        {doc.contact.headline && <p className="text-neutral-700">{doc.contact.headline}</p>}
        <p className="mt-1 text-xs text-neutral-600">
          {[doc.contact.email, doc.contact.phone, doc.contact.location].filter(Boolean).join(' · ')}
        </p>
        {doc.contact.links.length > 0 && (
          <p className="text-xs text-neutral-600">
            {doc.contact.links.map((l) => `${l.label}: ${l.url}`).join(' · ')}
          </p>
        )}
      </header>

      {sections.map((key) => {
        switch (key) {
          case 'summary':
            return doc.summary ? (
              <Section key={key} title="Summary">
                <p>{doc.summary}</p>
              </Section>
            ) : null;

          case 'experience':
            return doc.experience.length > 0 ? (
              <Section key={key} title="Experience">
                {doc.experience.map((role) => (
                  <article key={role.id} className="mb-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-semibold">
                        {role.role || 'Role'}
                        {role.company && ` — ${role.company}`}
                      </h3>
                      <span className="text-xs text-neutral-600">
                        {formatRange(role.dates.start, role.dates.end)}
                      </span>
                    </div>
                    <ul className="ml-5 list-disc">
                      {role.bullets
                        .filter((b) => b.text.trim())
                        .map((b) => (
                          <li key={b.id}>{b.text}</li>
                        ))}
                    </ul>
                    {role.technologies.filter(Boolean).length > 0 && (
                      <p className="mt-1 text-xs text-neutral-700">
                        {role.technologies.filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </article>
                ))}
              </Section>
            ) : null;

          case 'projects':
            return doc.projects.length > 0 ? (
              <Section key={key} title="Projects">
                {doc.projects.map((project) => (
                  <article key={project.id} className="mb-4">
                    <h3 className="font-semibold">{project.name || 'Project'}</h3>
                    {project.description && <p>{project.description}</p>}
                    <ul className="ml-5 list-disc">
                      {project.bullets
                        .filter((b) => b.text.trim())
                        .map((b) => (
                          <li key={b.id}>{b.text}</li>
                        ))}
                    </ul>
                    {project.technologies.filter(Boolean).length > 0 && (
                      <p className="mt-1 text-xs text-neutral-700">
                        {project.technologies.filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </article>
                ))}
              </Section>
            ) : null;

          case 'education':
            return doc.education.length > 0 ? (
              <Section key={key} title="Education">
                {doc.education.map((entry) => (
                  <div key={entry.id} className="mb-2 flex flex-wrap justify-between gap-2">
                    <span>
                      <strong>{entry.degree || 'Degree'}</strong>
                      {entry.field && `, ${entry.field}`}
                      {entry.institution && ` — ${entry.institution}`}
                      {entry.grade && ` (${entry.grade})`}
                    </span>
                    <span className="text-xs text-neutral-600">
                      {formatRange(entry.dates.start, entry.dates.end)}
                    </span>
                  </div>
                ))}
              </Section>
            ) : null;

          case 'skills':
            return doc.skills.length > 0 ? (
              <Section key={key} title="Skills">
                {doc.skills.map((group) => (
                  <p key={group.id}>
                    <strong>{group.category || 'Skills'}:</strong>{' '}
                    {group.skills.filter(Boolean).join(', ')}
                  </p>
                ))}
              </Section>
            ) : null;

          case 'certifications':
            return doc.certifications.length > 0 ? (
              <Section key={key} title="Certifications">
                {doc.certifications.map((c) => (
                  <p key={c.id}>
                    {c.name}
                    {c.issuer && ` — ${c.issuer}`}
                  </p>
                ))}
              </Section>
            ) : null;

          case 'achievements':
            return doc.achievements.length > 0 ? (
              <Section key={key} title="Achievements">
                {doc.achievements.map((a) => (
                  <p key={a.id}>
                    <strong>{a.title}</strong>
                    {a.description && ` — ${a.description}`}
                  </p>
                ))}
              </Section>
            ) : null;

          default:
            return null;
        }
      })}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="mt-5">
      {/* Standard heading text, not a graphic or an abbreviation — the
          parseability rules reward exactly this. */}
      <h2 className="mb-2 border-b border-neutral-200 pb-1 text-xs font-bold tracking-widest uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}
