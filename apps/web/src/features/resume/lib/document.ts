import { SECTION_KEYS, type ResumeDocument, type SectionKey } from '@cc/shared';

/**
 * Immutable edits to a resume document.
 *
 * Every helper returns a new document. Mutating in place would let React skip a
 * re-render because the reference is unchanged, which shows up as an input that
 * appears to swallow keystrokes — and it would corrupt the autosave buffer,
 * which holds a reference rather than a copy.
 */

export const SECTION_LABELS: Record<string, string> = {
  summary: 'Summary',
  experience: 'Experience',
  education: 'Education',
  projects: 'Projects',
  skills: 'Skills',
  certifications: 'Certifications',
  achievements: 'Achievements',
};

/** Stable ids for new array entries — reorders and diffs depend on them. */
export function newId(): string {
  return crypto.randomUUID();
}

export function setField<K extends keyof ResumeDocument>(
  doc: ResumeDocument,
  key: K,
  value: ResumeDocument[K],
): ResumeDocument {
  return { ...doc, [key]: value };
}

export function updateAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

export function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/**
 * The visible sections in their chosen order.
 *
 * Unknown keys in the stored order are dropped and missing ones appended, so a
 * document written by an older or newer schema still renders every section it
 * has instead of silently hiding one.
 */
export function orderedSections(doc: ResumeDocument): SectionKey[] {
  const known = new Set<string>(SECTION_KEYS);
  const seen = new Set<string>();
  const ordered = doc.sections.order.filter((k): k is SectionKey => {
    // Deduplicated as well as filtered. A repeated key renders the section
    // twice and, worse, gives React two children with the same key — which it
    // resolves by dropping one, silently and at a distance from the cause.
    if (!known.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const missing = SECTION_KEYS.filter((k) => !seen.has(k));
  return [...ordered, ...missing];
}

export function isHidden(doc: ResumeDocument, key: string): boolean {
  return doc.sections.hidden.includes(key);
}

export function toggleHidden(doc: ResumeDocument, key: string): ResumeDocument {
  const hidden = isHidden(doc, key)
    ? doc.sections.hidden.filter((k) => k !== key)
    : [...doc.sections.hidden, key];
  return { ...doc, sections: { ...doc.sections, hidden } };
}

export function reorder(doc: ResumeDocument, order: string[]): ResumeDocument {
  return { ...doc, sections: { ...doc.sections, order } };
}

export const emptyExperience = () => ({
  id: newId(),
  company: '',
  role: '',
  dates: { start: '2024-01', end: null as string | null },
  bullets: [],
  technologies: [],
});

export const emptyEducation = () => ({
  id: newId(),
  institution: '',
  degree: '',
  dates: { start: '2020-08', end: '2024-05' as string | null },
  highlights: [],
});

export const emptyProject = () => ({
  id: newId(),
  name: '',
  bullets: [],
  technologies: [],
});

export const emptySkillGroup = () => ({
  id: newId(),
  category: '',
  skills: [''],
});
