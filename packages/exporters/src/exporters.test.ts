import { describe, expect, it } from 'vitest';
import { RESUME_SCHEMA_VERSION, type ResumeDocument } from '@cc/shared';
import { escapeHtml, escapeLatex, toJson, toLatex, toMarkdown, toPrintHtml } from './index.js';
import { visibleSections } from './sections.js';

/**
 * Exporters are pure string builders, so they are cheap to test exhaustively —
 * and worth it: an export is the artifact a user sends to an employer, and a
 * dropped section or a broken escape is discovered by the recruiter, not by us.
 */

function doc(overrides: Partial<ResumeDocument> = {}): ResumeDocument {
  return {
    schemaVersion: RESUME_SCHEMA_VERSION,
    contact: {
      fullName: 'Aditi Sharma',
      headline: 'Backend Engineer',
      email: 'aditi@example.com',
      phone: '+91 98765 43210',
      location: 'Bengaluru',
      links: [{ id: 'l1', label: 'GitHub', url: 'https://github.com/aditi' }],
    },
    summary: 'Backend engineer with five years in payments.',
    experience: [
      {
        id: 'e1',
        company: 'Razorpay',
        role: 'Senior Engineer',
        dates: { start: '2022-04', end: null },
        bullets: [{ id: 'b1', text: 'Cut p95 latency from 800 ms to 120 ms.' }],
        technologies: ['Go', 'Kafka'],
      },
    ],
    education: [
      {
        id: 'ed1',
        institution: 'LPU',
        degree: 'B.Tech',
        field: 'Computer Science',
        dates: { start: '2016-08', end: '2020-05' },
        grade: '8.4 CGPA',
        highlights: [],
      },
    ],
    projects: [
      {
        id: 'p1',
        name: 'ledger-lite',
        description: 'Embeddable double-entry ledger.',
        bullets: [{ id: 'pb1', text: 'Deterministic replay over 2 million events.' }],
        technologies: ['Rust'],
      },
    ],
    skills: [{ id: 's1', category: 'Languages', skills: ['Go', 'Rust'] }],
    certifications: [{ id: 'c1', name: 'CKA', issuer: 'CNCF' }],
    achievements: [{ id: 'a1', title: 'Speaker, GopherCon India' }],
    customSections: [],
    sections: {
      order: ['summary', 'experience', 'education', 'projects', 'skills'],
      hidden: [],
    },
    ...overrides,
  } as ResumeDocument;
}

describe('visibleSections', () => {
  it('drops hidden sections and appends ones the order forgot', () => {
    const sections = visibleSections(
      doc({ sections: { order: ['summary'], hidden: ['projects'] } }),
    );
    expect(sections).toContain('experience');
    expect(sections).not.toContain('projects');
    expect(sections[0]).toBe('summary');
  });

  it('deduplicates a repeated key', () => {
    const sections = visibleSections(
      doc({ sections: { order: ['summary', 'summary', 'skills'], hidden: [] } }),
    );
    expect(sections.filter((s) => s === 'summary')).toHaveLength(1);
  });
});

describe.each([
  ['markdown', (d: ResumeDocument) => toMarkdown(d)],
  ['latex', (d: ResumeDocument) => toLatex(d)],
  ['html', (d: ResumeDocument) => toPrintHtml(d, 'minimal-ats')],
] as const)('%s carries the whole document', (_name, render) => {
  it('includes every populated section', () => {
    const out = render(doc());
    // The failure mode worth guarding is silent omission, which is why each
    // section is asserted individually rather than by a length check.
    expect(out).toContain('Aditi Sharma');
    expect(out).toContain('Backend Engineer');
    expect(out).toContain('aditi@example.com');
    expect(out).toContain('Razorpay');
    expect(out).toContain('Cut p95 latency');
    expect(out).toContain('ledger-lite');
    expect(out).toContain('Deterministic replay');
    expect(out).toContain('B.Tech');
    expect(out).toContain('Rust');
  });

  it('omits sections the user hid', () => {
    const out = render(doc({ sections: { order: ['summary', 'experience'], hidden: ['skills'] } }));
    expect(out).not.toContain('Kafka, Rust');
  });

  it('does not print a heading for an empty section', () => {
    const out = render(doc({ projects: [], certifications: [], achievements: [] }));
    expect(out).not.toMatch(/Projects/);
    expect(out).not.toMatch(/Certifications/);
  });

  it('renders "Present" for a role that has not ended', () => {
    expect(render(doc())).toContain('Present');
  });

  it('is deterministic', () => {
    expect(render(doc())).toBe(render(doc()));
  });
});

describe('LaTeX escaping', () => {
  it.each([
    ['ampersand', 'R&D', '\\&'],
    ['percent', '40% growth', '\\%'],
    ['underscore', 'file_name', '\\_'],
    ['hash', 'C# developer', '\\#'],
    ['dollar', '$1.2M saved', '\\$'],
    ['braces', 'set {a, b}', '\\{'],
    ['tilde', '~/projects', '\\textasciitilde{}'],
    ['caret', '2^10', '\\textasciicircum{}'],
    ['backslash', 'C:\\path', '\\textbackslash{}'],
  ])('escapes %s', (_label, input, expected) => {
    // Each of these is a real string from a real resume, and an unescaped one
    // does not render wrongly — it fails to compile, in a file the user cannot
    // debug.
    expect(escapeLatex(input)).toContain(expected);
  });

  it('does not double-escape the backslashes it introduces', () => {
    // Order matters: escaping backslashes after inserting them would turn every
    // command into literal text.
    expect(escapeLatex('50%')).toBe('50\\%');
    expect(escapeLatex('a&b')).toBe('a\\&b');
  });

  it('emits a real \\cdot separator, not the literal word', () => {
    // Regression: the separator was written as ' $\\cdot$ ' inside a normal
    // string literal, so JavaScript collapsed \\c to c and every export
    // typeset "cdot" as text between the contact details. Lint found it; this
    // keeps it found.
    const out = toLatex(doc());
    expect(out).toContain('\\cdot');
    expect(out).not.toMatch(/\$cdot\$/);
  });

  it('escapes content reaching the document, not just the helper', () => {
    const out = toLatex(doc({ summary: 'Cut costs by 40% and grew R&D' }));
    expect(out).toContain('40\\%');
    expect(out).toContain('R\\&D');
  });
});

describe('HTML escaping', () => {
  it('neutralises markup in user content', () => {
    // A resume is user-supplied text rendered into a document by a browser. A
    // <script> in a name must not become a script, even in a headless render.
    const out = toPrintHtml(doc({ summary: '<script>alert(1)</script>' }), 'minimal-ats');
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes quotes so an attribute cannot be broken out of', () => {
    expect(escapeHtml('a"b')).toBe('a&quot;b');
    expect(escapeHtml("a'b")).toBe('a&#39;b');
  });
});

describe('print HTML', () => {
  it('sets an A4 page box with real margins', () => {
    const out = toPrintHtml(doc(), 'minimal-ats');
    expect(out).toContain('@page');
    expect(out).toContain('size: A4');
  });

  it('avoids splitting a role across a page break', () => {
    // The commonest PDF defect is a bullet list orphaned from its job title.
    expect(toPrintHtml(doc(), 'minimal-ats')).toContain('break-inside:avoid');
  });

  it('renders the two-column template with a sidebar', () => {
    const out = toPrintHtml(doc(), 'two-column');
    expect(out).toContain('<aside>');
    expect(out).toContain('grid-template-columns');
  });

  it('falls back to the default style for an unknown template', () => {
    const out = toPrintHtml(doc(), 'a-template-that-was-retired');
    expect(out).toContain('Aditi Sharma');
    expect(out).not.toContain('<aside>');
  });

  it('inlines every style, so nothing depends on a network fetch', () => {
    const out = toPrintHtml(doc(), 'minimal-ats');
    // A PDF whose stylesheet lost a race with the print call renders blank.
    expect(out).not.toContain('<link');
    expect(out).not.toContain('@import');
  });
});

describe('JSON', () => {
  it('round-trips the document unchanged', () => {
    const source = doc();
    const parsed = JSON.parse(toJson(source, { exportedAt: 'T', appVersion: '0.1.0' })) as {
      resume: ResumeDocument;
      schemaVersion: number;
    };
    expect(parsed.resume).toEqual(source);
    expect(parsed.schemaVersion).toBe(RESUME_SCHEMA_VERSION);
  });

  it('is reproducible, because the timestamp is passed in', () => {
    const a = toJson(doc(), { exportedAt: 'T', appVersion: '0.1.0' });
    const b = toJson(doc(), { exportedAt: 'T', appVersion: '0.1.0' });
    expect(a).toBe(b);
  });
});

describe('markdown', () => {
  it('uses real headings rather than bold text', () => {
    const out = toMarkdown(doc());
    expect(out).toMatch(/^# Aditi Sharma$/m);
    expect(out).toMatch(/^## Experience$/m);
  });

  it('never leaves more than one blank line', () => {
    expect(toMarkdown(doc())).not.toMatch(/\n{3,}/);
  });

  it('ends with exactly one newline', () => {
    const out = toMarkdown(doc());
    expect(out.endsWith('\n')).toBe(true);
    expect(out.endsWith('\n\n')).toBe(false);
  });
});

describe('empty document', () => {
  it('still produces a valid file in every format', () => {
    const empty = doc({
      summary: undefined,
      experience: [],
      education: [],
      projects: [],
      skills: [],
      certifications: [],
      achievements: [],
    });
    // Exporting a blank resume is not an error state. It should produce a
    // well-formed, nearly empty document rather than throwing.
    expect(() => toMarkdown(empty)).not.toThrow();
    expect(toLatex(empty)).toContain('\\end{document}');
    expect(toPrintHtml(empty, 'minimal-ats')).toContain('</html>');
  });
});
