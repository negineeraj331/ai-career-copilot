import type { ResumeDocument, SectionKey } from '@cc/shared';

/**
 * The contract every template renderer implements.
 *
 * One prop object, no context, no data fetching: a template is a pure function
 * of a document. That is what lets the same component render the on-screen
 * preview and, in slice 1.5, the server-side PDF — a renderer that reached for
 * a hook or a store would work in the browser and fail in the export worker.
 */
export interface TemplateProps {
  readonly doc: ResumeDocument;
  /** Visible sections in their chosen order, already filtered and deduplicated. */
  readonly sections: readonly SectionKey[];
}

export type TemplateComponent = (props: TemplateProps) => React.ReactNode;
