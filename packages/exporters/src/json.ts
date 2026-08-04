import type { ResumeDocument } from '@cc/shared';

/**
 * JSON export — the document exactly as stored, plus provenance.
 *
 * This is the format that makes the data portable: a user can take it and
 * rebuild their resume elsewhere without asking us for anything. `schemaVersion`
 * and `exportedAt` travel with it so a file found on a disk two years from now
 * is still interpretable.
 *
 * `exportedAt` is passed in rather than read from the clock, which keeps this
 * function pure and the export byte-for-byte reproducible in tests.
 */
export function toJson(
  doc: ResumeDocument,
  meta: { exportedAt: string; appVersion: string },
): string {
  return `${JSON.stringify(
    {
      $schema: 'https://careercopilot.app/schemas/resume/v1.json',
      schemaVersion: doc.schemaVersion,
      exportedAt: meta.exportedAt,
      exportedBy: `career-copilot@${meta.appVersion}`,
      resume: doc,
    },
    null,
    2,
  )}\n`;
}
