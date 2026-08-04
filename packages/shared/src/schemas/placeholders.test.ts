import { describe, expect, it } from 'vitest';
import { findPlaceholders, hasPlaceholder } from './placeholders.js';

/**
 * The one thing this must not do is let `[X]%` reach an employer, and the one
 * thing it must not do *too* eagerly is reject text a person actually wrote.
 * Both directions are tested, because a guard that fires on ordinary prose gets
 * switched off.
 */

describe('detects a fill-in-the-blank', () => {
  it.each([
    'Improved latency by [X]%',
    'Served [N] users',
    'Reduced cost by [AMOUNT]',
    'Led a team of [TEAM SIZE]',
    'Cut build time by [X]',
  ])('%s', (text) => {
    expect(hasPlaceholder(text)).toBe(true);
    expect(findPlaceholders(text).length).toBeGreaterThan(0);
  });
});

describe('leaves real writing alone', () => {
  it.each([
    'Rewrote the parser [sic] as documented',
    'Worked there [2020-2024]',
    'Shipped v2 [note: renamed later]',
    'Used the C[++] toolchain',
    'No brackets at all here',
  ])('%s', (text) => {
    // A guard that fires on ordinary prose is one people learn to work around.
    expect(hasPlaceholder(text)).toBe(false);
  });
});

describe('reporting', () => {
  it('lists each distinct placeholder once', () => {
    expect(findPlaceholders('[X]% faster and [X]% cheaper for [N] users')).toEqual(['[X]', '[N]']);
  });

  it('is not affected by a previous call', () => {
    // A global regex carries lastIndex between calls, which makes `test()`
    // alternate true and false on identical input. This is that bug's guard.
    const text = 'Improved by [X]%';
    expect(hasPlaceholder(text)).toBe(true);
    expect(hasPlaceholder(text)).toBe(true);
    expect(hasPlaceholder(text)).toBe(true);
  });
});
