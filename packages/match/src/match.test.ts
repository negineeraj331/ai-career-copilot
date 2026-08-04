import { describe, expect, it } from 'vitest';
import {
  MATCH_WEIGHTS,
  RESUME_SCHEMA_VERSION,
  type ParsedJobDescription,
  type ResumeDocument,
} from '@cc/shared';
import {
  buildRecommendations,
  cosineSimilarity,
  lexicalMatch,
  matchResume,
  normalise,
  totalExperienceYears,
} from './index.js';

/**
 * The match score is a number a user is asked to act on — to rewrite their
 * resume, or to decide not to apply. So the tests are about defensibility: that
 * it is reproducible, that it cannot be gamed by padding, and that every
 * component moves for a reason someone could explain out loud.
 */

const NOW = new Date('2026-08-01T00:00:00.000Z');

function resume(overrides: Partial<ResumeDocument> = {}): ResumeDocument {
  return {
    schemaVersion: RESUME_SCHEMA_VERSION,
    contact: { fullName: 'A', email: 'a@example.com', links: [] },
    summary: 'Backend engineer.',
    experience: [
      {
        id: 'e1',
        company: 'Razorpay',
        role: 'Senior Engineer',
        dates: { start: '2022-08', end: null },
        bullets: [{ id: 'b1', text: 'Cut p95 latency from 800 ms to 120 ms.' }],
        technologies: ['Go', 'Kafka'],
      },
    ],
    education: [
      {
        id: 'ed1',
        institution: 'LPU',
        degree: 'B.Tech',
        dates: { start: '2016-08', end: '2020-05' },
        highlights: [],
      },
    ],
    projects: [],
    skills: [{ id: 's1', category: 'Languages', skills: ['Go', 'PostgreSQL'] }],
    certifications: [],
    achievements: [],
    customSections: [],
    sections: { order: [], hidden: [] },
    ...overrides,
  } as ResumeDocument;
}

function jd(overrides: Partial<ParsedJobDescription> = {}): ParsedJobDescription {
  return {
    roleTitle: 'Backend Engineer',
    seniority: 'SENIOR',
    requiredSkills: [
      { name: 'Go', importance: 'REQUIRED', weight: 1 },
      { name: 'Kafka', importance: 'REQUIRED', weight: 1 },
    ],
    preferredSkills: [{ name: 'Terraform', importance: 'PREFERRED', weight: 0.5 }],
    minYearsExperience: 4,
    educationRequirement: 'BACHELORS',
    responsibilities: [],
    companySignals: [],
    ...overrides,
  } as ParsedJobDescription;
}

describe('determinism', () => {
  it('gives the same score for the same input', () => {
    const a = matchResume({ document: resume(), jd: jd() }, NOW);
    const b = matchResume({ document: resume(), jd: jd() }, NOW);
    expect(a).toEqual(b);
  });

  it('weights the components exactly as documented', () => {
    const { breakdown, score } = matchResume({ document: resume(), jd: jd() }, NOW);
    const recomputed = Math.round(
      breakdown.skills.score * MATCH_WEIGHTS.skills +
        breakdown.experience.score * MATCH_WEIGHTS.experience +
        breakdown.projects.score * MATCH_WEIGHTS.projects +
        breakdown.education.score * MATCH_WEIGHTS.education,
    );
    // The composite must be derivable from the parts, or the breakdown shown to
    // the user does not explain the number above it.
    expect(score).toBe(recomputed);
  });
});

describe('skills', () => {
  it('counts a skill evidenced anywhere in the resume, not just the skills list', () => {
    const doc = resume({ skills: [] });
    // "Go" and "Kafka" only appear in a role's technologies here.
    const { breakdown } = matchResume({ document: doc, jd: jd() }, NOW);
    expect(breakdown.skills.matched).toContain('Go');
    expect(breakdown.skills.matched).toContain('Kafka');
  });

  it('weights a required skill above a preferred one', () => {
    const missingRequired = matchResume(
      {
        document: resume({
          skills: [{ id: 's', category: 'x', skills: ['Terraform'] }],
          experience: [],
        }),
        jd: jd(),
      },
      NOW,
    );
    const missingPreferred = matchResume({ document: resume(), jd: jd() }, NOW);

    // Missing what the posting insists on must hurt more than missing a
    // nice-to-have, or the number cannot inform a decision to apply.
    expect(missingRequired.breakdown.skills.score).toBeLessThan(
      missingPreferred.breakdown.skills.score,
    );
  });

  it('reports gaps worst-first', () => {
    const { gaps } = matchResume(
      { document: resume({ skills: [], experience: [], projects: [] }), jd: jd() },
      NOW,
    );
    expect(gaps[0]?.importance).toBe('REQUIRED');
    expect(gaps.at(-1)?.importance).toBe('PREFERRED');
  });

  it('reports no score at all for a posting it could not read', () => {
    // Probing real numbers caught this: an unreadable posting scored 45, which
    // reads as "mediocre fit" when the truth is "we could not parse it". A
    // parse failure presented as a middling result is worse than none, because
    // the user acts on it.
    const result = matchResume(
      { document: resume(), jd: jd({ requiredSkills: [], preferredSkills: [] }) },
      NOW,
    );
    expect(result.score).toBeNull();
    // The breakdown still says what was computable.
    expect(result.breakdown.experience.detectedYears).toBeGreaterThan(0);
  });

  it('finds evidence inside a project bullet, not just its technologies', () => {
    // A skill someone only mentions in a project bullet is still evidence, and
    // this was the one evidence source no test exercised.
    const doc = resume({
      skills: [],
      experience: [],
      projects: [
        {
          id: 'p1',
          name: 'ledger',
          description: 'A ledger.',
          bullets: [{ id: 'b', text: 'Streamed entries through Kafka into Go workers.' }],
          technologies: [],
        },
      ],
    });
    const { breakdown } = matchResume({ document: doc, jd: jd() }, NOW);
    expect(breakdown.skills.matched).toEqual(expect.arrayContaining(['Go', 'Kafka']));
  });

  it('matches an alias in either direction', () => {
    // The resume writes the canonical form and the posting the abbreviation.
    const doc = resume({
      skills: [{ id: 's', category: 'x', skills: ['Continuous integration'] }],
      experience: [],
    });
    const posting = jd({
      requiredSkills: [{ name: 'CI', importance: 'REQUIRED', weight: 1 }],
      preferredSkills: [],
    });
    expect(matchResume({ document: doc, jd: posting }, NOW).breakdown.skills.matched).toEqual([
      'CI',
    ]);
  });

  it('matches common aliases that lexical comparison would miss', () => {
    const doc = resume({ skills: [{ id: 's', category: 'x', skills: ['Postgres', 'k8s'] }] });
    const posting = jd({
      requiredSkills: [
        { name: 'PostgreSQL', importance: 'REQUIRED', weight: 1 },
        { name: 'Kubernetes', importance: 'REQUIRED', weight: 1 },
      ],
      preferredSkills: [],
    });
    expect(matchResume({ document: doc, jd: posting }, NOW).breakdown.skills.score).toBe(100);
  });
});

describe('experience', () => {
  it('merges overlapping roles instead of summing them', () => {
    const doc = resume({
      experience: [
        {
          id: 'a',
          company: 'X',
          role: 'Dev',
          dates: { start: '2020-01', end: '2022-01' },
          bullets: [],
          technologies: [],
        },
        {
          id: 'b',
          company: 'Y',
          role: 'Consultant',
          dates: { start: '2021-01', end: '2023-01' },
          bullets: [],
          technologies: [],
        },
      ],
    });
    // Two overlapping two-year roles are three years, not four. Summing would
    // let a resume inflate itself by splitting one job into several entries.
    expect(totalExperienceYears(doc, NOW)).toBe(3);
  });

  it('treats an open-ended role as running to today', () => {
    const doc = resume({
      experience: [
        {
          id: 'a',
          company: 'X',
          role: 'Dev',
          dates: { start: '2024-08', end: null },
          bullets: [],
          technologies: [],
        },
      ],
    });
    expect(totalExperienceYears(doc, NOW)).toBe(2);
  });

  it('caps at 100, so a long career cannot mask missing skills', () => {
    const doc = resume({
      experience: [
        {
          id: 'a',
          company: 'X',
          role: 'Dev',
          dates: { start: '2000-01', end: null },
          bullets: [],
          technologies: [],
        },
      ],
    });
    expect(matchResume({ document: doc, jd: jd() }, NOW).breakdown.experience.score).toBe(100);
  });

  it('scores on presence when the posting sets no bar', () => {
    const posting = jd({ minYearsExperience: null });
    const withRoles = matchResume({ document: resume(), jd: posting }, NOW);
    const without = matchResume({ document: resume({ experience: [] }), jd: posting }, NOW);
    expect(withRoles.breakdown.experience.score).toBe(100);
    expect(without.breakdown.experience.score).toBe(0);
  });
});

describe('projects', () => {
  it('counts only projects relevant to the posting', () => {
    const doc = resume({
      projects: [
        { id: 'p1', name: 'kafka-replay', bullets: [], technologies: ['Go', 'Kafka'] },
        { id: 'p2', name: 'knitting blog', bullets: [], technologies: ['WordPress'] },
      ],
    });
    const { breakdown } = matchResume({ document: doc, jd: jd() }, NOW);
    expect(breakdown.projects.relevant).toEqual(['kafka-replay']);
  });

  it('cannot be gamed by adding irrelevant projects', () => {
    const irrelevant = Array.from({ length: 10 }, (_, i) => ({
      id: `p${String(i)}`,
      name: `blog-${String(i)}`,
      bullets: [],
      technologies: ['WordPress'],
    }));
    const { breakdown } = matchResume(
      { document: resume({ projects: irrelevant }), jd: jd() },
      NOW,
    );
    expect(breakdown.projects.score).toBe(0);
  });
});

describe('education', () => {
  it('does not penalise a missing degree when the posting does not ask', () => {
    const posting = jd({ educationRequirement: 'NONE' });
    const { breakdown } = matchResume({ document: resume({ education: [] }), jd: posting }, NOW);
    expect(breakdown.education.score).toBe(80);
  });

  it('penalises a missing degree when the posting requires one', () => {
    const { breakdown } = matchResume({ document: resume({ education: [] }), jd: jd() }, NOW);
    expect(breakdown.education.score).toBe(0);
  });
});

describe('embeddings', () => {
  it('works with no vectors at all', () => {
    // The product must produce a defensible answer before an embedding key
    // exists. Lexical matching is the floor, not the fallback.
    const { score } = matchResume({ document: resume(), jd: jd() }, NOW);
    expect(score).not.toBeNull();
    expect(score as number).toBeGreaterThan(0);
  });

  it('closes a gap that lexical matching alone would miss', () => {
    const doc = resume({
      skills: [{ id: 's', category: 'x', skills: ['message brokers'] }],
      experience: [],
    });
    const posting = jd({
      requiredSkills: [{ name: 'Kafka', importance: 'REQUIRED', weight: 1 }],
      preferredSkills: [],
    });

    const lexicalOnly = matchResume({ document: doc, jd: posting }, NOW);
    expect(lexicalOnly.breakdown.skills.matched).toHaveLength(0);

    const withVectors = matchResume(
      {
        document: doc,
        jd: posting,
        vectors: {
          jd: new Map([['kafka', [1, 0, 0]]]),
          resume: [{ term: 'message brokers', vector: [0.9, 0.1, 0] }],
        },
      },
      NOW,
    );
    expect(withVectors.breakdown.skills.matched).toEqual(['Kafka']);
  });

  it('does not match two unrelated terms that merely have vectors', () => {
    const doc = resume({
      skills: [{ id: 's', category: 'x', skills: ['knitting'] }],
      experience: [],
    });
    const posting = jd({
      requiredSkills: [{ name: 'Kafka', importance: 'REQUIRED', weight: 1 }],
      preferredSkills: [],
    });
    const result = matchResume(
      {
        document: doc,
        jd: posting,
        vectors: {
          jd: new Map([['kafka', [1, 0, 0]]]),
          resume: [{ term: 'knitting', vector: [0, 1, 0] }],
        },
      },
      NOW,
    );
    // Below the documented threshold, a "match" is two unrelated terms that
    // happen to live in the same region of the space.
    expect(result.breakdown.skills.matched).toHaveLength(0);
  });
});

describe('cosine similarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 rather than NaN for a zero vector', () => {
    // An all-zero embedding is a provider failure; NaN would propagate silently
    // into a score shown to a user.
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(Number.isNaN(cosineSimilarity([0, 0], [0, 0]))).toBe(false);
  });

  it('returns 0 for mismatched lengths instead of comparing garbage', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe('lexical matching', () => {
  it.each([
    ['kubernetes-based platform', 'Kubernetes', true],
    ['wrote tests', 'test', true],
    ['Postgres 16', 'PostgreSQL', true],
    ['knitting', 'Kafka', false],
  ])('%s vs %s', (haystack, term, expected) => {
    expect(lexicalMatch(haystack, term)).toBe(expected);
  });

  it('normalises punctuation and case', () => {
    expect(normalise('  Node.JS!  ')).toBe('node.js');
  });
});

describe('recommendations', () => {
  it('leads with required gaps', () => {
    const match = matchResume(
      { document: resume({ skills: [], experience: [], projects: [] }), jd: jd() },
      NOW,
    );
    const recs = buildRecommendations(resume({ skills: [] }), match);
    expect(recs[0]?.severity).toBe('HIGH');
    expect(recs[0]?.type).toBe('ADD_SKILL');
  });

  it('points at a field the editor can scroll to', () => {
    const match = matchResume({ document: resume({ skills: [] }), jd: jd() }, NOW);
    for (const rec of buildRecommendations(resume({ skills: [] }), match)) {
      if (rec.targetPath !== null) expect(rec.targetPath.startsWith('/')).toBe(true);
    }
  });

  it('produces resume-level advice with no job description at all', () => {
    const recs = buildRecommendations(resume({ summary: undefined }), null);
    expect(recs.some((r) => r.type === 'SUMMARY_REWRITE')).toBe(true);
  });

  it('flags unquantified bullets only when most of them are', () => {
    const quantified = resume({
      experience: [
        {
          id: 'e',
          company: 'X',
          role: 'Dev',
          dates: { start: '2022-01', end: null },
          bullets: [{ id: 'b', text: 'Cut latency by 60 percent.' }],
          technologies: [],
        },
      ],
    });
    expect(buildRecommendations(quantified, null).some((r) => r.type === 'QUANTIFY')).toBe(false);

    const vague = resume({
      experience: [
        {
          id: 'e',
          company: 'X',
          role: 'Dev',
          dates: { start: '2022-01', end: null },
          bullets: [
            { id: 'b1', text: 'Worked on the backend.' },
            { id: 'b2', text: 'Helped the team.' },
          ],
          technologies: [],
        },
      ],
    });
    expect(buildRecommendations(vague, null).some((r) => r.type === 'QUANTIFY')).toBe(true);
  });

  it('never returns more advice than a person will read', () => {
    const posting = jd({
      requiredSkills: Array.from({ length: 30 }, (_, i) => ({
        name: `skill-${String(i)}`,
        importance: 'REQUIRED' as const,
        weight: 1,
      })),
      preferredSkills: [],
    });
    const match = matchResume({ document: resume({ skills: [] }), jd: posting }, NOW);
    const recs = buildRecommendations(resume({ skills: [] }), match);
    // A list of thirty is a list nobody reads, and the tail is always the least
    // important.
    expect(recs.length).toBeLessThanOrEqual(12);
  });
});
