import type { ExportFormat } from '@cc/shared';

export interface ExportFormatMeta {
  readonly extension: string;
  readonly contentType: string;
  /** True when the worker needs a browser to produce it. */
  readonly needsBrowser: boolean;
}

/**
 * What each format is, in one place.
 *
 * The content type matters more than it looks: served with the wrong one, a
 * .docx downloads as a zip and a .tex opens in the browser as plain text, and
 * both look like the export is broken.
 */
export const FORMAT_META: Record<ExportFormat, ExportFormatMeta> = {
  PDF: { extension: 'pdf', contentType: 'application/pdf', needsBrowser: true },
  DOCX: {
    extension: 'docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    needsBrowser: false,
  },
  JSON: { extension: 'json', contentType: 'application/json', needsBrowser: false },
  MARKDOWN: { extension: 'md', contentType: 'text/markdown; charset=utf-8', needsBrowser: false },
  LATEX: { extension: 'tex', contentType: 'application/x-tex', needsBrowser: false },
};
