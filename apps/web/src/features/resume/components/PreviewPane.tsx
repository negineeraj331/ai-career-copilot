import type { ReactNode } from 'react';
import type { ResumeDocument } from '@cc/shared';
import { isHidden, orderedSections } from '../lib/document.js';
import { rendererFor } from '../templates/registry.js';

/**
 * A local render of the document through the selected template (docs/09 §4).
 *
 * No network round trip — it renders what is in memory, so it tracks typing
 * rather than the last save. The template itself is a pure function of the
 * document (see templates/types.ts), which is what will let the same renderer
 * produce the server-side PDF in slice 1.5.
 *
 * `cc-preview` scopes the styles. docs/09 asks for an isolated stacking context
 * so template CSS cannot leak into app styles; a class prefix is the version of
 * that which survives being printed and exported, whereas an iframe or shadow
 * root would need the print stylesheet rebuilt inside it.
 */
export function PreviewPane({
  doc,
  templateId,
}: {
  doc: ResumeDocument;
  templateId: string;
}): ReactNode {
  const sections = orderedSections(doc).filter((key) => !isHidden(doc, key));
  const Template = rendererFor(templateId);

  return (
    <div
      className="mx-auto max-w-[52rem] shadow-sm"
      // The preview is a faithful rendering of the user's own document; a
      // screen-reader user editing the form does not need it read twice.
      aria-label="Resume preview"
      role="document"
    >
      <Template doc={doc} sections={sections} />
    </div>
  );
}
