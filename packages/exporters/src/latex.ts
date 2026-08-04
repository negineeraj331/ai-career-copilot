import type { ResumeDocument, SectionKey } from '@cc/shared';
import { isPresent, visibleSections } from './sections.js';

/**
 * LaTeX export.
 *
 * Emits a standalone `article` document that compiles with a stock TeX
 * distribution — no custom class file, no exotic packages. A .tex that only
 * builds with a template file we also have to ship is not portable, and
 * portability is the only reason to offer LaTeX at all.
 */

/**
 * Escaping is the whole correctness problem here.
 *
 * Ten characters are special in LaTeX, and a resume is full of them: C++,
 * 40% growth, R&D, file_name, ~/. An unescaped one does not produce a wrong
 * character — it produces a compile error, or silently swallows the rest of the
 * line, in a file the user cannot debug.
 */
export function escapeLatex(value: string): string {
  // One pass, not a chain of `.replace()` calls.
  //
  // A chain re-scans its own output: escaping the backslash first inserts
  // `\textbackslash{}`, and the next pass then escapes the braces it had just
  // introduced, producing `\textbackslash\{\}` — which typesets as literal
  // text instead of a backslash. A single regex with a lookup table cannot have
  // that bug, because nothing it emits is ever examined again.
  const MAP: Record<string, string> = {
    '\\': String.raw`\textbackslash{}`,
    '~': String.raw`\textasciitilde{}`,
    '^': String.raw`\textasciicircum{}`,
    '&': String.raw`\&`,
    '%': String.raw`\%`,
    $: String.raw`\$`,
    '#': String.raw`\#`,
    _: String.raw`\_`,
    '{': String.raw`\{`,
    '}': String.raw`\}`,
  };
  return value.replace(/[\\~^&%$#_{}]/g, (char) => MAP[char] ?? char);
}

const PREAMBLE = String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage[margin=0.75in]{geometry}
\usepackage{enumitem}
\usepackage{titlesec}
\usepackage[hidelinks]{hyperref}

% Tight lists and rules under section headings: the conventions a resume reader
% expects, expressed once rather than per section.
\setlist[itemize]{leftmargin=1.2em,itemsep=0pt,topsep=2pt,parsep=0pt}
\titleformat{\section}{\large\bfseries\uppercase}{}{0em}{}[\titlerule]
\titlespacing{\section}{0pt}{10pt}{4pt}
\pagestyle{empty}
`;

function range(start: string, end: string | null): string {
  return `${escapeLatex(start)} -- ${end ? escapeLatex(end) : 'Present'}`;
}

function itemize(items: { text: string }[]): string[] {
  const kept = items.filter((b) => b.text.trim());
  if (kept.length === 0) return [];
  return [
    String.raw`\begin{itemize}`,
    ...kept.map((b) => String.raw`  \item ${escapeLatex(b.text.trim())}`),
    String.raw`\end{itemize}`,
  ];
}

export function toLatex(doc: ResumeDocument, order?: readonly SectionKey[]): string {
  const out: string[] = [PREAMBLE, String.raw`\begin{document}`, ''];
  const { contact } = doc;

  out.push(String.raw`\begin{center}`);
  out.push(String.raw`  {\LARGE\bfseries ${escapeLatex(contact.fullName || 'Your name')}}\\[2pt]`);
  if (contact.headline) out.push(String.raw`  ${escapeLatex(contact.headline)}\\[2pt]`);
  const details = [contact.email, contact.phone, contact.location]
    .filter(isPresent)
    .map(escapeLatex);
  if (details.length > 0) out.push(String.raw`  \small ${details.join(' $\\cdot$ ')}\\`);
  for (const link of contact.links) {
    out.push(String.raw`  \small ${escapeLatex(link.label)}: \url{${link.url}}\\`);
  }
  out.push(String.raw`\end{center}`, '');

  for (const section of visibleSections(doc, order)) {
    switch (section) {
      case 'summary':
        if (doc.summary?.trim()) {
          out.push(String.raw`\section{Summary}`, escapeLatex(doc.summary.trim()), '');
        }
        break;

      case 'experience':
        if (doc.experience.length > 0) {
          out.push(String.raw`\section{Experience}`);
          for (const role of doc.experience) {
            out.push(
              String.raw`\textbf{${escapeLatex(role.role || 'Role')}}${
                role.company ? ` --- ${escapeLatex(role.company)}` : ''
              } \hfill ${range(role.dates.start, role.dates.end)}\\`,
            );
            out.push(...itemize(role.bullets));
            const tech = role.technologies.filter(Boolean).map(escapeLatex);
            if (tech.length > 0) out.push(String.raw`\textit{${tech.join(' $\\cdot$ ')}}\\`);
            out.push('');
          }
        }
        break;

      case 'projects':
        if (doc.projects.length > 0) {
          out.push(String.raw`\section{Projects}`);
          for (const project of doc.projects) {
            out.push(String.raw`\textbf{${escapeLatex(project.name || 'Project')}}\\`);
            if (project.description) out.push(`${escapeLatex(project.description)}\\`);
            out.push(...itemize(project.bullets));
            const tech = project.technologies.filter(Boolean).map(escapeLatex);
            if (tech.length > 0) out.push(String.raw`\textit{${tech.join(' $\\cdot$ ')}}\\`);
            out.push('');
          }
        }
        break;

      case 'education':
        if (doc.education.length > 0) {
          out.push(String.raw`\section{Education}`);
          for (const entry of doc.education) {
            const degree = [entry.degree, entry.field]
              .filter(isPresent)
              .map(escapeLatex)
              .join(', ');
            out.push(
              String.raw`\textbf{${degree || 'Degree'}}${
                entry.institution ? ` --- ${escapeLatex(entry.institution)}` : ''
              } \hfill ${range(entry.dates.start, entry.dates.end)}\\`,
            );
            if (entry.grade) out.push(`${escapeLatex(entry.grade)}\\`);
          }
          out.push('');
        }
        break;

      case 'skills':
        if (doc.skills.length > 0) {
          out.push(String.raw`\section{Skills}`);
          for (const group of doc.skills) {
            const skills = group.skills.filter(Boolean).map(escapeLatex);
            if (skills.length > 0) {
              out.push(
                String.raw`\textbf{${escapeLatex(group.category || 'Skills')}:} ${skills.join(', ')}\\`,
              );
            }
          }
          out.push('');
        }
        break;

      case 'certifications':
        if (doc.certifications.length > 0) {
          out.push(String.raw`\section{Certifications}`);
          out.push(
            ...itemize(
              doc.certifications.map((c) => ({
                text: `${c.name}${c.issuer ? ` — ${c.issuer}` : ''}`,
              })),
            ),
          );
          out.push('');
        }
        break;

      case 'achievements':
        if (doc.achievements.length > 0) {
          out.push(String.raw`\section{Achievements}`);
          out.push(
            ...itemize(
              doc.achievements.map((a) => ({
                text: `${a.title}${a.description ? ` — ${a.description}` : ''}`,
              })),
            ),
          );
          out.push('');
        }
        break;

      default:
        break;
    }
  }

  out.push(String.raw`\end{document}`, '');
  return out.join('\n');
}
