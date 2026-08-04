import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import {
  FORMAT_META,
  toJson,
  toLatex,
  toMarkdown,
  toPrintHtml,
  visibleSections,
} from '@cc/exporters';
import type { ExportFormat, ResumeDocument } from '@cc/shared';
import { loggerFor } from '../../core/logger/logger.js';

/**
 * Turns a resume document into bytes.
 *
 * The text formats come from `@cc/exporters`, which is pure and unit-tested.
 * The two that need a library or a binary live here: DOCX (the `docx` package)
 * and PDF (headless Chromium), because neither belongs in a package whose value
 * is being dependency-free.
 */

const log = loggerFor('export-render');

export interface RenderResult {
  body: Buffer;
  contentType: string;
  extension: string;
}

export async function render(
  doc: ResumeDocument,
  format: ExportFormat,
  templateId: string,
  meta: { exportedAt: string; appVersion: string },
): Promise<RenderResult> {
  const { contentType, extension } = FORMAT_META[format];

  switch (format) {
    case 'JSON':
      return { body: Buffer.from(toJson(doc, meta), 'utf8'), contentType, extension };
    case 'MARKDOWN':
      return { body: Buffer.from(toMarkdown(doc), 'utf8'), contentType, extension };
    case 'LATEX':
      return { body: Buffer.from(toLatex(doc), 'utf8'), contentType, extension };
    case 'DOCX':
      return { body: await toDocx(doc), contentType, extension };
    case 'PDF':
      return { body: await toPdf(doc, templateId), contentType, extension };
    default:
      throw new Error(`Unsupported export format: ${String(format)}`);
  }
}

/**
 * DOCX, built from the data model rather than converted from HTML.
 *
 * An HTML-to-DOCX conversion produces a file full of nested tables and absolute
 * positioning — which is precisely the structure the ATS rules warn about, so
 * the "editable" export would score worse than the PDF. Building paragraphs
 * directly gives a document Word can actually edit and a parser can read.
 */
async function toDocx(doc: ResumeDocument): Promise<Buffer> {
  const children: Paragraph[] = [];
  const { contact } = doc;

  children.push(
    new Paragraph({ text: contact.fullName || 'Your name', heading: HeadingLevel.TITLE }),
  );
  if (contact.headline) children.push(new Paragraph({ text: contact.headline }));
  const details = [contact.email, contact.phone, contact.location].filter(Boolean).join(' · ');
  if (details) children.push(new Paragraph({ text: details }));
  for (const link of contact.links) {
    children.push(new Paragraph({ text: `${link.label}: ${link.url}` }));
  }

  const heading = (text: string): Paragraph =>
    new Paragraph({ text, heading: HeadingLevel.HEADING_1 });

  for (const section of visibleSections(doc)) {
    switch (section) {
      case 'summary':
        if (doc.summary?.trim()) {
          children.push(heading('Summary'), new Paragraph({ text: doc.summary.trim() }));
        }
        break;

      case 'experience':
        if (doc.experience.length > 0) {
          children.push(heading('Experience'));
          for (const role of doc.experience) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({ text: role.role || 'Role', bold: true }),
                  new TextRun({ text: role.company ? ` — ${role.company}` : '' }),
                  new TextRun({
                    text: `  (${role.dates.start} – ${role.dates.end ?? 'Present'})`,
                    italics: true,
                  }),
                ],
              }),
            );
            for (const bullet of role.bullets.filter((b) => b.text.trim())) {
              children.push(new Paragraph({ text: bullet.text.trim(), bullet: { level: 0 } }));
            }
            const tech = role.technologies.filter(Boolean);
            if (tech.length > 0) {
              children.push(
                new Paragraph({
                  children: [new TextRun({ text: tech.join(' · '), italics: true })],
                }),
              );
            }
          }
        }
        break;

      case 'projects':
        if (doc.projects.length > 0) {
          children.push(heading('Projects'));
          for (const project of doc.projects) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: project.name || 'Project', bold: true })],
              }),
            );
            if (project.description) children.push(new Paragraph({ text: project.description }));
            for (const bullet of project.bullets.filter((b) => b.text.trim())) {
              children.push(new Paragraph({ text: bullet.text.trim(), bullet: { level: 0 } }));
            }
          }
        }
        break;

      case 'education':
        if (doc.education.length > 0) {
          children.push(heading('Education'));
          for (const entry of doc.education) {
            const degree = [entry.degree, entry.field].filter(Boolean).join(', ');
            children.push(
              new Paragraph({
                children: [
                  new TextRun({ text: degree || 'Degree', bold: true }),
                  new TextRun({ text: entry.institution ? ` — ${entry.institution}` : '' }),
                  new TextRun({
                    text: `  (${entry.dates.start} – ${entry.dates.end ?? 'Present'})`,
                    italics: true,
                  }),
                ],
              }),
            );
          }
        }
        break;

      case 'skills':
        if (doc.skills.length > 0) {
          children.push(heading('Skills'));
          for (const group of doc.skills) {
            const skills = group.skills.filter(Boolean);
            if (skills.length > 0) {
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({ text: `${group.category || 'Skills'}: `, bold: true }),
                    new TextRun({ text: skills.join(', ') }),
                  ],
                }),
              );
            }
          }
        }
        break;

      case 'certifications':
        if (doc.certifications.length > 0) {
          children.push(heading('Certifications'));
          for (const cert of doc.certifications) {
            children.push(
              new Paragraph({
                text: `${cert.name}${cert.issuer ? ` — ${cert.issuer}` : ''}`,
                bullet: { level: 0 },
              }),
            );
          }
        }
        break;

      case 'achievements':
        if (doc.achievements.length > 0) {
          children.push(heading('Achievements'));
          for (const item of doc.achievements) {
            children.push(
              new Paragraph({
                text: `${item.title}${item.description ? ` — ${item.description}` : ''}`,
                bullet: { level: 0 },
              }),
            );
          }
        }
        break;

      default:
        break;
    }
  }

  const document = new Document({ sections: [{ children }] });
  return Packer.toBuffer(document);
}

/**
 * PDF via headless Chromium (FR-26).
 *
 * `puppeteer-core` rather than `puppeteer`: the full package downloads its own
 * ~170 MB Chromium at install time, on every developer machine and every CI
 * run, to produce a browser the worker image already has. The core package is a
 * few hundred kilobytes and drives whatever binary `CHROMIUM_PATH` points at.
 *
 * The trade-off is that the browser is now an environment dependency rather
 * than a lockfile one, so a missing binary must fail with a message that says
 * exactly that instead of a stack trace from deep inside a launcher.
 */
async function toPdf(doc: ResumeDocument, templateId: string): Promise<Buffer> {
  const executablePath = process.env.CHROMIUM_PATH;
  if (!executablePath) {
    throw new Error(
      'PDF export needs a Chromium binary. Set CHROMIUM_PATH to one (the worker image installs it at /usr/bin/chromium-browser).',
    );
  }

  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath,
    // --no-sandbox is required to run Chromium as a non-root user inside a
    // container without granting it SYS_ADMIN. The page being rendered is HTML
    // we generated ourselves from a validated document, never a remote URL, so
    // there is no untrusted content for the sandbox to contain.
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    // `setContent` with a data string rather than navigating to a URL: nothing
    // is fetched, so there is no network race between the stylesheet and print.
    await page.setContent(toPrintHtml(doc, templateId), { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      // Margins come from the @page rule in the generated HTML; setting them
      // here as well would stack the two and inset every page twice.
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return Buffer.from(pdf);
  } finally {
    // Always. A leaked Chromium holds hundreds of megabytes, and a worker that
    // leaks one per failed job runs out of memory rather than reporting the
    // failure.
    await browser.close().catch((error: unknown) => {
      log.error({ err: error }, 'failed to close the browser after rendering');
    });
  }
}
