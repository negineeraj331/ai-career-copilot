import type { ResumeDocument, SectionKey } from '@cc/shared';
import { visibleSections } from './sections.js';

/**
 * Markdown export.
 *
 * Plain text with real headings, which makes it the format that pastes cleanly
 * into an email, a GitHub profile, or an application form that only accepts
 * text. Deliberately conservative: no tables, no HTML, no reference links —
 * every one of those renders differently depending on where it lands.
 */

function range(start: string, end: string | null): string {
  return `${start} – ${end ?? 'Present'}`;
}

function bulletList(items: { text: string }[]): string[] {
  return items.filter((b) => b.text.trim()).map((b) => `- ${b.text.trim()}`);
}

export function toMarkdown(doc: ResumeDocument, order?: readonly SectionKey[]): string {
  const lines: string[] = [];
  const { contact } = doc;

  lines.push(`# ${contact.fullName || 'Your name'}`);
  if (contact.headline) lines.push(`*${contact.headline}*`);

  const details = [contact.email, contact.phone, contact.location].filter(Boolean);
  if (details.length > 0) lines.push('', details.join(' · '));
  for (const link of contact.links) lines.push(`${link.label}: ${link.url}`);

  for (const section of visibleSections(doc, order)) {
    switch (section) {
      case 'summary':
        if (doc.summary?.trim()) lines.push('', '## Summary', '', doc.summary.trim());
        break;

      case 'experience':
        if (doc.experience.length > 0) {
          lines.push('', '## Experience');
          for (const role of doc.experience) {
            lines.push('', `### ${role.role || 'Role'}${role.company ? ` — ${role.company}` : ''}`);
            lines.push(`${range(role.dates.start, role.dates.end)}`);
            const bullets = bulletList(role.bullets);
            if (bullets.length > 0) lines.push('', ...bullets);
            const tech = role.technologies.filter(Boolean);
            if (tech.length > 0) lines.push('', `*${tech.join(' · ')}*`);
          }
        }
        break;

      case 'projects':
        if (doc.projects.length > 0) {
          lines.push('', '## Projects');
          for (const project of doc.projects) {
            lines.push('', `### ${project.name || 'Project'}`);
            if (project.description) lines.push(project.description);
            const bullets = bulletList(project.bullets);
            if (bullets.length > 0) lines.push('', ...bullets);
            const tech = project.technologies.filter(Boolean);
            if (tech.length > 0) lines.push('', `*${tech.join(' · ')}*`);
          }
        }
        break;

      case 'education':
        if (doc.education.length > 0) {
          lines.push('', '## Education');
          for (const entry of doc.education) {
            const parts = [entry.degree, entry.field].filter(Boolean).join(', ');
            lines.push(
              '',
              `**${parts || 'Degree'}**${entry.institution ? ` — ${entry.institution}` : ''}`,
            );
            lines.push(
              `${range(entry.dates.start, entry.dates.end)}${entry.grade ? ` · ${entry.grade}` : ''}`,
            );
          }
        }
        break;

      case 'skills':
        if (doc.skills.length > 0) {
          lines.push('', '## Skills', '');
          for (const group of doc.skills) {
            const skills = group.skills.filter(Boolean);
            if (skills.length > 0) {
              lines.push(`**${group.category || 'Skills'}:** ${skills.join(', ')}`);
            }
          }
        }
        break;

      case 'certifications':
        if (doc.certifications.length > 0) {
          lines.push('', '## Certifications', '');
          for (const cert of doc.certifications) {
            lines.push(`- ${cert.name}${cert.issuer ? ` — ${cert.issuer}` : ''}`);
          }
        }
        break;

      case 'achievements':
        if (doc.achievements.length > 0) {
          lines.push('', '## Achievements', '');
          for (const item of doc.achievements) {
            lines.push(`- **${item.title}**${item.description ? ` — ${item.description}` : ''}`);
          }
        }
        break;

      default:
        break;
    }
  }

  // A single trailing newline: POSIX text files end with one, and its absence
  // makes `cat` and `git diff` misbehave in small annoying ways.
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}
