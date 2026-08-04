import { DEFAULT_TEMPLATE_ID } from '@cc/shared';
import {
  AcademicTemplate,
  ClassicTemplate,
  CompactTemplate,
  MinimalTemplate,
  TechnicalTemplate,
  TwoColumnTemplate,
} from './renderers.js';
import type { TemplateComponent } from './types.js';

/**
 * id → renderer.
 *
 * The catalogue in `@cc/shared` is the source of truth for which ids exist; this
 * maps them to components. A test asserts the two agree, so adding metadata
 * without a renderer — or the reverse — fails the build rather than rendering
 * an empty page for whoever picked it.
 */
const RENDERERS: Record<string, TemplateComponent> = {
  'minimal-ats': MinimalTemplate,
  'classic-serif': ClassicTemplate,
  compact: CompactTemplate,
  technical: TechnicalTemplate,
  academic: AcademicTemplate,
  'two-column': TwoColumnTemplate,
};

export function rendererFor(templateId: string): TemplateComponent {
  // Falling back rather than throwing: a resume created against a template that
  // has since been retired must still be readable and editable. The picker will
  // show it as no longer available.
  return RENDERERS[templateId] ?? RENDERERS[DEFAULT_TEMPLATE_ID] ?? MinimalTemplate;
}

export const RENDERER_IDS = Object.keys(RENDERERS);
