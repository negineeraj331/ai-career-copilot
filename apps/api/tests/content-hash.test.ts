import { describe, expect, it } from 'vitest';
import { canonicalise, hashContent } from '../src/modules/resume/content-hash.js';

/**
 * The hash decides whether an autosave appends a version or coalesces onto the
 * existing one. Get it wrong in one direction and history fills with identical
 * entries; wrong in the other and a real edit is silently discarded. Both
 * directions are asserted here.
 */

describe('canonicalise', () => {
  it('is insensitive to key order', () => {
    expect(canonicalise({ a: 1, b: 2 })).toBe(canonicalise({ b: 2, a: 1 }));
  });

  it('sorts keys at every depth, not just the top level', () => {
    const one = { outer: { z: 1, a: { y: 2, b: 3 } } };
    const two = { outer: { a: { b: 3, y: 2 }, z: 1 } };
    expect(canonicalise(one)).toBe(canonicalise(two));
  });

  it('preserves array order, because reordering a resume is a real edit', () => {
    expect(canonicalise([1, 2])).not.toBe(canonicalise([2, 1]));
  });

  it('sorts keys inside array elements', () => {
    expect(canonicalise([{ a: 1, b: 2 }])).toBe(canonicalise([{ b: 2, a: 1 }]));
  });

  it('treats an absent key and an undefined one as the same, matching JSON.stringify', () => {
    expect(canonicalise({ a: 1 })).toBe(canonicalise({ a: 1, b: undefined }));
  });

  it('does not confuse null with undefined', () => {
    expect(canonicalise({ a: null })).not.toBe(canonicalise({}));
  });

  it('passes primitives and null through', () => {
    expect(canonicalise(null)).toBe('null');
    expect(canonicalise(42)).toBe('42');
    expect(canonicalise('x')).toBe('"x"');
  });
});

describe('hashContent', () => {
  it('produces a stable 64-character hex digest', () => {
    const hash = hashContent({ hello: 'world' });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashContent({ hello: 'world' })).toBe(hash);
  });

  it('matches for equal documents written in different key orders', () => {
    const fromForm = { summary: 'Engineer', contact: { email: 'a@b.co', fullName: 'A' } };
    const fromDatabase = { contact: { fullName: 'A', email: 'a@b.co' }, summary: 'Engineer' };
    expect(hashContent(fromForm)).toBe(hashContent(fromDatabase));
  });

  it('differs when a single character changes', () => {
    expect(hashContent({ summary: 'Engineer' })).not.toBe(hashContent({ summary: 'Engineerr' }));
  });

  it('differs when a bullet moves, which is the reorder case', () => {
    const before = {
      bullets: [
        { id: '1', text: 'A' },
        { id: '2', text: 'B' },
      ],
    };
    const after = {
      bullets: [
        { id: '2', text: 'B' },
        { id: '1', text: 'A' },
      ],
    };
    expect(hashContent(before)).not.toBe(hashContent(after));
  });
});
