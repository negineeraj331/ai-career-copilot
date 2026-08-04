import { SECTION_KEYS, type ResumeDocument, type SectionKey } from '@cc/shared';

/**
 * The sections an export should include, in order.
 *
 * Duplicated deliberately from the web app's `orderedSections` rather than
 * imported from it: an export runs in the worker, which must not depend on
 * anything in `apps/web`. Both are thin, both are tested, and the alternative —
 * a shared UI package pulled into a headless process — costs more than these
 * fifteen lines.
 */
export function visibleSections(doc: ResumeDocument, order?: readonly SectionKey[]): SectionKey[] {
  if (order) return [...order];

  const known = new Set<string>(SECTION_KEYS);
  const seen = new Set<string>();
  const ordered = doc.sections.order.filter((k): k is SectionKey => {
    if (!known.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const missing = SECTION_KEYS.filter((k) => !seen.has(k));
  return [...ordered, ...missing].filter((k) => !doc.sections.hidden.includes(k));
}

/**
 * `.filter(Boolean)` does not narrow in TypeScript — the result stays
 * `(T | undefined)[]` and every downstream `.map` then fights the type. This
 * does the same thing and tells the compiler about it.
 */
export function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined && value !== '';
}
