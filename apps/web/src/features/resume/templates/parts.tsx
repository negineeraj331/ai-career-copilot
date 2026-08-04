import type { ReactNode } from 'react';
import type { ResumeDocument } from '@cc/shared';

/**
 * Section bodies shared by every template.
 *
 * Templates differ in typography, density, and arrangement — not in what a
 * bullet is. Duplicating the content logic per template is how six renderers
 * drift into six slightly different resumes from one document.
 */

export function formatRange(start: string, end: string | null): string {
  return `${start} — ${end ?? 'Present'}`;
}

export function contactLine(doc: ResumeDocument): string {
  return [doc.contact.email, doc.contact.phone, doc.contact.location].filter(Boolean).join(' · ');
}

export function ExperienceBody({ doc }: { doc: ResumeDocument }): ReactNode {
  return (
    <>
      {doc.experience.map((role) => (
        <article key={role.id} className="mb-3 last:mb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold">
              {role.role || 'Role'}
              {role.company && ` — ${role.company}`}
            </h3>
            <span className="text-[0.85em] opacity-70">
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
            <p className="mt-1 text-[0.85em] opacity-80">
              {role.technologies.filter(Boolean).join(' · ')}
            </p>
          )}
        </article>
      ))}
    </>
  );
}

export function ProjectsBody({ doc }: { doc: ResumeDocument }): ReactNode {
  return (
    <>
      {doc.projects.map((project) => (
        <article key={project.id} className="mb-3 last:mb-0">
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
            <p className="mt-1 text-[0.85em] opacity-80">
              {project.technologies.filter(Boolean).join(' · ')}
            </p>
          )}
        </article>
      ))}
    </>
  );
}

export function EducationBody({ doc }: { doc: ResumeDocument }): ReactNode {
  return (
    <>
      {doc.education.map((entry) => (
        <div key={entry.id} className="mb-1 flex flex-wrap justify-between gap-2">
          <span>
            <strong>{entry.degree || 'Degree'}</strong>
            {entry.field && `, ${entry.field}`}
            {entry.institution && ` — ${entry.institution}`}
            {entry.grade && ` (${entry.grade})`}
          </span>
          <span className="text-[0.85em] opacity-70">
            {formatRange(entry.dates.start, entry.dates.end)}
          </span>
        </div>
      ))}
    </>
  );
}

export function SkillsBody({ doc }: { doc: ResumeDocument }): ReactNode {
  return (
    <>
      {doc.skills.map((group) => (
        <p key={group.id}>
          <strong>{group.category || 'Skills'}:</strong> {group.skills.filter(Boolean).join(', ')}
        </p>
      ))}
    </>
  );
}

export function CertificationsBody({ doc }: { doc: ResumeDocument }): ReactNode {
  return (
    <>
      {doc.certifications.map((c) => (
        <p key={c.id}>
          {c.name}
          {c.issuer && ` — ${c.issuer}`}
        </p>
      ))}
    </>
  );
}

export function AchievementsBody({ doc }: { doc: ResumeDocument }): ReactNode {
  return (
    <>
      {doc.achievements.map((a) => (
        <p key={a.id}>
          <strong>{a.title}</strong>
          {a.description && ` — ${a.description}`}
        </p>
      ))}
    </>
  );
}

/** Whether a section has anything worth printing. Empty headings look broken. */
export function hasContent(doc: ResumeDocument, key: string): boolean {
  switch (key) {
    case 'summary':
      return Boolean(doc.summary?.trim());
    case 'experience':
      return doc.experience.length > 0;
    case 'projects':
      return doc.projects.length > 0;
    case 'education':
      return doc.education.length > 0;
    case 'skills':
      return doc.skills.length > 0;
    case 'certifications':
      return doc.certifications.length > 0;
    case 'achievements':
      return doc.achievements.length > 0;
    default:
      return false;
  }
}

export function SectionBody({ doc, section }: { doc: ResumeDocument; section: string }): ReactNode {
  switch (section) {
    case 'summary':
      return <p>{doc.summary}</p>;
    case 'experience':
      return <ExperienceBody doc={doc} />;
    case 'projects':
      return <ProjectsBody doc={doc} />;
    case 'education':
      return <EducationBody doc={doc} />;
    case 'skills':
      return <SkillsBody doc={doc} />;
    case 'certifications':
      return <CertificationsBody doc={doc} />;
    case 'achievements':
      return <AchievementsBody doc={doc} />;
    default:
      return null;
  }
}

export const SECTION_TITLES: Record<string, string> = {
  summary: 'Summary',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  skills: 'Skills',
  certifications: 'Certifications',
  achievements: 'Achievements',
};
