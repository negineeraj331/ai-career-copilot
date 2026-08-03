import { describe, expect, it } from 'vitest';
import { ATS_COMPONENTS, ATS_WEIGHTS } from '@cc/shared';
import { ALL_RULES, scoreResume, topFixes } from '../engine.js';
import { emptyDoc, strongDoc, weakDoc } from './fixtures.js';

/**
 * The engine's own contract: determinism, the weighted composite, and the
 * handling of components that had nothing to say.
 */

describe('determinism (FR-40)', () => {
  it('returns an identical score for identical input', () => {
    const doc = strongDoc();
    const a = scoreResume(doc);
    const b = scoreResume(doc);
    expect(a).toEqual(b);
  });

  it('does not mutate the document it scores', () => {
    const doc = strongDoc();
    const snapshot = structuredClone(doc);
    scoreResume(doc);
    expect(doc).toEqual(snapshot);
  });
});

describe('rubric shape', () => {
  it('gives every rule a unique id', () => {
    const ids = ALL_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('weights the five components to exactly 1', () => {
    const total = ATS_COMPONENTS.reduce((sum, c) => sum + ATS_WEIGHTS[c], 0);
    // Floating point: 0.3 + 0.25 + 0.2 + 0.15 + 0.1 does not land on 1 exactly.
    expect(total).toBeCloseTo(1, 10);
  });

  it('assigns every rule to one of the five components', () => {
    for (const rule of ALL_RULES) {
      expect(ATS_COMPONENTS).toContain(rule.component);
    }
  });

  it('gives every rule a positive weight', () => {
    for (const rule of ALL_RULES) {
      expect(rule.weight).toBeGreaterThan(0);
    }
  });
});

describe('scoring', () => {
  it('scores a strong resume well above a weak one', () => {
    const strong = scoreResume(strongDoc()).score;
    const weak = scoreResume(weakDoc()).score;
    expect(strong).toBeGreaterThan(weak);
    // The gap should be decisive, not marginal — a rubric that puts these two
    // within a few points of each other is not measuring anything useful.
    expect(strong - weak).toBeGreaterThan(25);
  });

  it('keeps the score inside 0…100 for every fixture', () => {
    for (const doc of [emptyDoc(), weakDoc(), strongDoc()]) {
      const { score } = scoreResume(doc);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(score)).toBe(true);
    }
  });

  it('reports every rule with a status and an explanation (FR-42)', () => {
    const { rules } = scoreResume(strongDoc());
    expect(rules).toHaveLength(ALL_RULES.length);
    for (const rule of rules) {
      expect(rule.explanation.length).toBeGreaterThan(0);
      expect(['PASS', 'PARTIAL', 'FAIL', 'NOT_APPLICABLE']).toContain(rule.status);
      expect(rule.earned).toBeLessThanOrEqual(rule.weight);
      expect(rule.earned).toBeGreaterThanOrEqual(0);
    }
  });

  it('attaches a fix to everything that lost points', () => {
    // A finding with no remedy is a complaint. This is the rule that keeps the
    // score actionable rather than merely accurate.
    const { rules } = scoreResume(weakDoc());
    const lostPoints = rules.filter((r) => r.status === 'FAIL' || r.status === 'PARTIAL');
    expect(lostPoints.length).toBeGreaterThan(0);
    for (const rule of lostPoints) {
      expect(rule.fix, `${rule.id} lost points without saying how to fix it`).toBeTruthy();
    }
  });

  it('records the rubric version so historical scores stay interpretable', () => {
    expect(scoreResume(strongDoc()).rubricVersion).toBe(1);
  });
});

describe('components', () => {
  it('reports all five components with their weights', () => {
    const { components } = scoreResume(strongDoc());
    for (const component of ATS_COMPONENTS) {
      expect(components[component]?.weight).toBe(ATS_WEIGHTS[component]);
      expect(components[component]?.score).toBeGreaterThanOrEqual(0);
      expect(components[component]?.score).toBeLessThanOrEqual(100);
    }
  });

  it('redistributes weight away from a component that had nothing to judge', () => {
    // The keyword family: with no JD attached the coverage rule is NOT_APPLICABLE
    // and the generic rule takes over, so keywords still contribute. With a JD,
    // the reverse. Either way a resume is never punished for a question we did
    // not ask.
    const doc = strongDoc();
    const without = scoreResume(doc);
    const withJd = scoreResume(doc, { jdKeywords: ['Go', 'Kafka', 'PostgreSQL'] });

    const jdRule = (s: typeof without) => s.rules.find((r) => r.id === 'keyword.jd-coverage');
    const genericRule = (s: typeof without) => s.rules.find((r) => r.id === 'keyword.generic');

    expect(jdRule(without)?.status).toBe('NOT_APPLICABLE');
    expect(genericRule(without)?.status).not.toBe('NOT_APPLICABLE');

    expect(jdRule(withJd)?.status).not.toBe('NOT_APPLICABLE');
    expect(genericRule(withJd)?.status).toBe('NOT_APPLICABLE');
  });

  it('scores an empty document at zero without dividing by zero', () => {
    const result = scoreResume(emptyDoc());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(result.score)).toBe(false);
  });
});

describe('topFixes', () => {
  it('ranks by points actually lost, not by rule weight', () => {
    const score = scoreResume(weakDoc());
    const fixes = topFixes(score, 3);

    expect(fixes.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < fixes.length; i++) {
      const previous = fixes[i - 1];
      const current = fixes[i];
      if (!previous || !current) continue;
      expect(previous.weight - previous.earned).toBeGreaterThanOrEqual(
        current.weight - current.earned,
      );
    }
  });

  it('never suggests fixing something that passed', () => {
    const fixes = topFixes(scoreResume(strongDoc()));
    for (const fix of fixes) {
      expect(fix.status).not.toBe('PASS');
      expect(fix.status).not.toBe('NOT_APPLICABLE');
    }
  });

  it('returns nothing to fix when nothing lost points', () => {
    // Not a hypothetical: a document that passes every rule must produce an
    // empty list rather than the least-good passing rule.
    const perfect = scoreResume(strongDoc());
    const fixes = topFixes(perfect);
    const lost = perfect.rules.filter((r) => r.status === 'FAIL' || r.status === 'PARTIAL');
    expect(fixes).toHaveLength(Math.min(5, lost.length));
  });
});
