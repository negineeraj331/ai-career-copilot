import { describe, expect, it } from 'vitest';
import type { AtsRuleResult, ResumeDocument } from '@cc/shared';
import { scoreResume } from '../engine.js';
import { bullet, emptyDoc, strongDoc, weakDoc } from './fixtures.js';

/**
 * Per-rule behaviour.
 *
 * Each test drives one rule to one outcome by changing one thing about a known
 * document, so a failure names the rule and the input rather than "the score
 * moved". Scores are asserted as statuses, not as numbers — pinning exact
 * integers would make every future reweighting look like a regression.
 */

function ruleOf(doc: ResumeDocument, id: string, jdKeywords?: string[]): AtsRuleResult {
  const score = scoreResume(doc, jdKeywords ? { jdKeywords } : {});
  const rule = score.rules.find((r) => r.id === id);
  if (!rule) throw new Error(`No rule ${id}. Have: ${score.rules.map((r) => r.id).join(', ')}`);
  return rule;
}

describe('vacuous passes (regression)', () => {
  it('scores an empty document near zero, not near half', () => {
    // This was 35/100 before the rules stopped passing vacuously: with no
    // bullets, "no clichés" and "no first-person pronouns" both PASSED, and an
    // empty document collected full marks for defects it was too empty to have.
    // Absence of evidence is not compliance.
    expect(scoreResume(emptyDoc()).score).toBeLessThan(20);
  });

  it.each(['read.cliches', 'read.first-person', 'parse.glyphs', 'parse.tabular'])(
    '%s reports NOT_APPLICABLE rather than PASS on an empty document',
    (id) => {
      expect(ruleOf(emptyDoc(), id).status).toBe('NOT_APPLICABLE');
    },
  );
});

describe('parseability', () => {
  it('fails a document using rating dots instead of words', () => {
    const doc = strongDoc();
    doc.experience[0]!.bullets.push(bullet('React ●●●●○  TypeScript ●●●○○  Go ●●○○○'));
    expect(ruleOf(doc, 'parse.glyphs').status).toBe('FAIL');
  });

  it('fails a document whose bullets are a table in disguise', () => {
    const doc = strongDoc();
    doc.experience[0]!.bullets.push(bullet('Skill | Level | Years'));
    expect(ruleOf(doc, 'parse.tabular').status).toBe('FAIL');
  });

  it('accepts ordinary punctuation and accents', () => {
    const doc = strongDoc();
    doc.experience[0]!.bullets.push(
      bullet('Coordinated a résumé review across São Paulo and Zürich — 30 engineers, 2 weeks.'),
    );
    expect(ruleOf(doc, 'parse.glyphs').status).toBe('PASS');
  });

  it('marks the contact rule partial when the phone is missing', () => {
    const doc = strongDoc();
    delete doc.contact.phone;
    expect(ruleOf(doc, 'parse.contact').status).toBe('PARTIAL');
  });

  it('penalises education placed above experience', () => {
    const doc = strongDoc();
    doc.sections.order = ['summary', 'education', 'experience', 'skills'];
    expect(ruleOf(doc, 'parse.order').status).toBe('PARTIAL');
  });

  it('does not penalise order when there is no experience yet', () => {
    const doc = strongDoc();
    doc.experience = [];
    doc.sections.order = ['summary', 'education', 'experience', 'skills'];
    expect(ruleOf(doc, 'parse.order').status).toBe('PASS');
  });

  it('flags a document consisting entirely of custom sections', () => {
    const doc = emptyDoc();
    doc.customSections = [
      { id: 'c1', title: 'Stuff', items: [bullet('Did things')] },
      { id: 'c2', title: 'More stuff', items: [bullet('Did more things')] },
    ];
    expect(ruleOf(doc, 'parse.sections').status).toBe('FAIL');
  });

  it('tolerates one custom section alongside standard ones', () => {
    const doc = strongDoc();
    doc.customSections = [{ id: 'c1', title: 'Publications', items: [bullet('A paper')] }];
    expect(ruleOf(doc, 'parse.sections').status).toBe('PARTIAL');
  });

  it('flags links with no readable label', () => {
    const doc = strongDoc();
    doc.contact.links = [{ id: 'l1', label: ' ', url: 'https://example.com' }];
    expect(ruleOf(doc, 'parse.links').status).toBe('PARTIAL');
  });
});

describe('keywords', () => {
  it('passes when the resume covers most job-description terms', () => {
    const rule = ruleOf(strongDoc(), 'keyword.jd-coverage', ['Go', 'Kafka', 'PostgreSQL']);
    expect(rule.status).toBe('PASS');
  });

  it('names the missing terms when coverage is partial', () => {
    const rule = ruleOf(strongDoc(), 'keyword.jd-coverage', [
      'Go',
      'Kafka',
      'Erlang',
      'COBOL',
      'Fortran',
    ]);
    expect(rule.status).toBe('PARTIAL');
    expect(rule.explanation).toMatch(/erlang|cobol|fortran/i);
  });

  it('fails when the resume matches almost nothing the role asks for', () => {
    const rule = ruleOf(weakDoc(), 'keyword.jd-coverage', [
      'Kubernetes',
      'Terraform',
      'Prometheus',
      'Envoy',
    ]);
    expect(rule.status).toBe('FAIL');
  });

  it('matches word stems, so "test" covers "testing"', () => {
    const doc = emptyDoc();
    doc.summary = 'Engineer focused on automated testing and deployment pipelines.';
    expect(ruleOf(doc, 'keyword.jd-coverage', ['test', 'deploy']).status).toBe('PASS');
  });

  it('flags skills that appear nowhere in the experience', () => {
    const doc = strongDoc();
    doc.skills = [
      { id: 's1', category: 'Claimed', skills: ['Haskell', 'Erlang', 'Prolog', 'COBOL'] },
    ];
    const rule = ruleOf(doc, 'keyword.skills-evidenced');
    expect(['PARTIAL', 'FAIL']).toContain(rule.status);
  });

  it('passes when listed skills show up in the work described', () => {
    expect(ruleOf(strongDoc(), 'keyword.skills-evidenced').status).toBe('PASS');
  });
});

describe('formatting', () => {
  it('flags bullets that are too short to say anything', () => {
    const doc = strongDoc();
    doc.experience[0]!.bullets = [bullet('Did work'), bullet('Wrote code'), bullet('Shipped it')];
    expect(['PARTIAL', 'FAIL']).toContain(ruleOf(doc, 'format.bullet-length').status);
  });

  it('flags bullets long enough to stop being read', () => {
    const doc = strongDoc();
    const long = `Built ${'a very detailed and thoroughly described system '.repeat(4)}end to end.`;
    doc.experience[0]!.bullets = [bullet(long), bullet(long)];
    expect(['PARTIAL', 'FAIL']).toContain(ruleOf(doc, 'format.bullet-length').status);
  });

  it('flags mixed terminal punctuation', () => {
    const doc = strongDoc();
    doc.experience[0]!.bullets = [
      bullet('Reduced settlement latency from 800 ms to 120 ms across the payment pipeline.'),
      bullet('Led the migration of 40 million monthly transactions with no downtime'),
      bullet('Built the reconciliation service that detects drift within 5 minutes.'),
    ];
    expect(ruleOf(doc, 'format.punctuation').status).toBe('PARTIAL');
  });

  it('accepts either convention applied consistently', () => {
    const doc = strongDoc();
    doc.experience[0]!.bullets = [
      bullet('Reduced settlement latency from 800 ms to 120 ms across the payment pipeline'),
      bullet('Led the migration of 40 million monthly transactions with no downtime'),
      bullet('Built the reconciliation service that detects drift within 5 minutes'),
    ];
    doc.experience[1]!.bullets = [];
    doc.projects = [];
    expect(ruleOf(doc, 'format.punctuation').status).toBe('PASS');
  });

  it('asks for a headline when there is none', () => {
    const doc = strongDoc();
    delete doc.contact.headline;
    const rule = ruleOf(doc, 'format.headline');
    expect(rule.status).toBe('PARTIAL');
    expect(rule.fix).toBeTruthy();
  });

  it('suggests the target role in the headline fix when one is known', () => {
    const doc = strongDoc();
    delete doc.contact.headline;
    const score = scoreResume(doc, { targetRole: 'Staff Engineer' });
    expect(score.rules.find((r) => r.id === 'format.headline')?.fix).toContain('Staff Engineer');
  });

  it('fails a document with no summary at all', () => {
    const doc = strongDoc();
    delete doc.summary;
    expect(ruleOf(doc, 'format.summary').status).toBe('FAIL');
  });

  it('flags a summary that runs long', () => {
    const doc = strongDoc();
    doc.summary = 'Experienced backend engineer building reliable systems. '.repeat(20);
    expect(ruleOf(doc, 'format.summary').status).toBe('PARTIAL');
  });
});

describe('readability', () => {
  it('flags bullets that open with filler rather than a verb', () => {
    expect(['PARTIAL', 'FAIL']).toContain(ruleOf(weakDoc(), 'read.action-verbs').status);
  });

  it('flags first-person pronouns in bullets', () => {
    const doc = strongDoc();
    doc.experience[0]!.bullets.push(bullet('I personally rewrote the settlement pipeline myself.'));
    expect(ruleOf(doc, 'read.first-person').status).toBe('PARTIAL');
  });

  it('flags stock phrases', () => {
    const doc = strongDoc();
    doc.summary = 'A results-driven team player and self-starter with a proven track record.';
    expect(['PARTIAL', 'FAIL']).toContain(ruleOf(doc, 'read.cliches').status);
  });

  it('flags a bullet doing the work of three', () => {
    const doc = strongDoc();
    doc.experience[0]!.bullets = [
      bullet(
        'Built the ingest service, and designed the schema, which handled retries, while also mentoring two engineers, and wrote the runbooks.',
      ),
    ];
    doc.experience[1]!.bullets = [];
    doc.projects = [];
    expect(['PARTIAL', 'FAIL']).toContain(ruleOf(doc, 'read.complexity').status);
  });
});

describe('completeness', () => {
  it('accepts two solid projects in place of professional experience', () => {
    const doc = strongDoc();
    doc.experience = [];
    doc.projects = [doc.projects[0]!, { ...doc.projects[0]!, id: 'p2', name: 'second' }];
    expect(ruleOf(doc, 'complete.evidence').status).toBe('PASS');
  });

  it('gives partial credit for a single project and no roles', () => {
    const doc = strongDoc();
    doc.experience = [];
    doc.projects = [doc.projects[0]!];
    expect(ruleOf(doc, 'complete.evidence').status).toBe('PARTIAL');
  });

  it('fails a document with neither experience nor projects', () => {
    const doc = strongDoc();
    doc.experience = [];
    doc.projects = [];
    expect(ruleOf(doc, 'complete.evidence').status).toBe('FAIL');
  });

  it('does not require education outright', () => {
    const doc = strongDoc();
    doc.education = [];
    expect(ruleOf(doc, 'complete.education').status).toBe('PARTIAL');
  });

  it('passes when 40% of bullets carry a number', () => {
    expect(ruleOf(strongDoc(), 'complete.quantified').status).toBe('PASS');
  });

  it('fails when no bullet carries a measurable result', () => {
    expect(ruleOf(weakDoc(), 'complete.quantified').status).toBe('FAIL');
  });

  it('does not count a bare year as a quantified result', () => {
    // "Java developer since 2019" states tenure, not impact. Counting it would
    // let a resume full of dates score as though it were full of results.
    const doc = emptyDoc();
    doc.experience = [
      {
        id: 'e1',
        company: 'Co',
        role: 'Dev',
        dates: { start: '2019-01', end: null },
        bullets: [bullet('Working with Java since 2019 on the platform team in the London office')],
        technologies: [],
      },
    ];
    expect(ruleOf(doc, 'complete.quantified').status).toBe('FAIL');
  });

  it.each([
    ['a percentage', 'Reduced error rate by 40% across the checkout funnel for all users'],
    ['money', 'Saved $120 thousand annually by right-sizing the cluster and its storage'],
    ['a multiplier', 'Improved throughput 3x by batching writes to the ledger service'],
    ['a scale suffix', 'Served 2.5m monthly active users on the new ingest pipeline reliably'],
    ['a duration', 'Cut build time from 45 minutes to 6 minutes for the whole monorepo'],
    ['a plain count', 'Mentored 12 engineers through their first production on-call rotation'],
    ['a verb', 'Halved the p99 latency of the settlement path without adding any hardware'],
  ])('counts %s as quantified', (_label, text) => {
    const doc = emptyDoc();
    doc.experience = [
      {
        id: 'e1',
        company: 'Co',
        role: 'Dev',
        dates: { start: '2019-01', end: null },
        bullets: [bullet(text)],
        technologies: [],
      },
    ];
    expect(ruleOf(doc, 'complete.quantified').status).toBe('PASS');
  });
});
