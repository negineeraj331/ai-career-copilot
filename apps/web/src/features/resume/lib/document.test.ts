import { describe, expect, it } from 'vitest';
import { RESUME_SCHEMA_VERSION, type ResumeDocument } from '@cc/shared';
import {
  isHidden,
  orderedSections,
  removeAt,
  reorder,
  toggleHidden,
  updateAt,
} from './document.js';

function doc(overrides: Partial<ResumeDocument> = {}): ResumeDocument {
  return {
    schemaVersion: RESUME_SCHEMA_VERSION,
    contact: { fullName: 'A', email: 'a@example.com', links: [] },
    experience: [],
    education: [],
    projects: [],
    skills: [],
    certifications: [],
    achievements: [],
    customSections: [],
    sections: { order: ['summary', 'experience'], hidden: [] },
    ...overrides,
  } as ResumeDocument;
}

describe('orderedSections', () => {
  it('appends sections missing from a stored order', () => {
    // A document written before a section existed must still show it, rather
    // than hiding it because an old order array did not mention it.
    const sections = orderedSections(doc());
    expect(sections).toContain('projects');
    expect(sections).toContain('skills');
    expect(sections[0]).toBe('summary');
  });

  it('drops keys that are not real sections', () => {
    const sections = orderedSections(
      doc({ sections: { order: ['summary', 'not-a-section'], hidden: [] } }),
    );
    expect(sections).not.toContain('not-a-section');
  });

  it('never repeats a section', () => {
    const sections = orderedSections(
      doc({ sections: { order: ['summary', 'summary', 'experience'], hidden: [] } }),
    );
    expect(new Set(sections).size).toBe(sections.length);
  });
});

describe('hidden sections', () => {
  it('toggles both ways', () => {
    const base = doc();
    const hidden = toggleHidden(base, 'projects');
    expect(isHidden(hidden, 'projects')).toBe(true);
    expect(isHidden(toggleHidden(hidden, 'projects'), 'projects')).toBe(false);
  });

  it('does not mutate the document it is given', () => {
    const base = doc();
    const snapshot = structuredClone(base);
    toggleHidden(base, 'projects');
    // A mutation here lets React skip the re-render, which presents as an
    // editor that swallows the change.
    expect(base).toEqual(snapshot);
  });
});

describe('reorder', () => {
  it('replaces the order and leaves everything else alone', () => {
    const base = doc();
    const next = reorder(base, ['experience', 'summary']);
    expect(next.sections.order).toEqual(['experience', 'summary']);
    expect(next.contact).toBe(base.contact);
  });
});

describe('list helpers', () => {
  it('updates one entry without touching the others', () => {
    const list = [
      { id: '1', text: 'a' },
      { id: '2', text: 'b' },
    ];
    const next = updateAt(list, 1, { text: 'B' });
    expect(next[1]?.text).toBe('B');
    expect(next[0]).toBe(list[0]);
    expect(list[1]?.text).toBe('b');
  });

  it('removes by index', () => {
    expect(removeAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });
});
