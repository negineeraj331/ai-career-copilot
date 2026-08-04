import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RESUME_SCHEMA_VERSION, TEMPLATES, type ResumeDocument, type SectionKey } from '@cc/shared';
import { RENDERER_IDS, rendererFor } from './registry.js';

/**
 * Every template renders the same document.
 *
 * The risk with six renderers is divergence: one forgets bullets, another drops
 * technologies, and the difference only surfaces when a user exports the one
 * nobody tried. So the content assertions run against all six rather than
 * against a representative sample.
 */

const SECTIONS: SectionKey[] = [
  'summary',
  'experience',
  'education',
  'projects',
  'skills',
  'certifications',
  'achievements',
];

function doc(): ResumeDocument {
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
        bullets: [{ id: 'b1', text: 'Cut settlement latency from 800 ms to 120 ms.' }],
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
    sections: { order: SECTIONS, hidden: [] },
  } as ResumeDocument;
}

describe('catalogue and registry agree', () => {
  it('has a renderer for every advertised template', () => {
    // Metadata without a renderer means the picker offers something that draws
    // an empty page; a renderer without metadata is unreachable code.
    expect([...RENDERER_IDS].sort()).toEqual([...TEMPLATES.map((t) => t.id)].sort());
  });

  it('flags at least one template as not ATS-safe', () => {
    // The flag exists to warn people. If nothing ever trips it, it is decoration
    // and the warning path is dead code nobody has looked at.
    expect(TEMPLATES.some((t) => !t.atsSafe)).toBe(true);
  });

  it('gives every template a unique sort order and id', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    expect(new Set(TEMPLATES.map((t) => t.sortOrder)).size).toBe(TEMPLATES.length);
  });
});

describe.each(TEMPLATES.map((t) => [t.id, t.name] as const))('%s renders', (id) => {
  it('the whole document', () => {
    const Template = rendererFor(id);
    render(<Template doc={doc()} sections={SECTIONS} />);

    expect(screen.getByText('Aditi Sharma')).toBeInTheDocument();
    expect(screen.getByText(/Cut settlement latency/)).toBeInTheDocument();
    expect(screen.getByText(/Deterministic replay/)).toBeInTheDocument();
    expect(screen.getByText(/B.Tech/)).toBeInTheDocument();
    expect(screen.getByText(/Go, Rust/)).toBeInTheDocument();
    expect(screen.getByText(/CKA/)).toBeInTheDocument();
    expect(screen.getByText(/GopherCon/)).toBeInTheDocument();
    // Technologies are easy to forget in a template and are load-bearing for
    // keyword matching.
    expect(screen.getByText(/Go · Kafka/)).toBeInTheDocument();
  });

  it('uses real heading elements, which is what a parser looks for', () => {
    const Template = rendererFor(id);
    render(<Template doc={doc()} sections={SECTIONS} />);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toContain('Experience');
    expect(headings).toContain('Skills');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Aditi Sharma');
  });

  it('omits sections that have no content instead of printing an empty heading', () => {
    const Template = rendererFor(id);
    const empty = { ...doc(), projects: [], certifications: [] };
    render(<Template doc={empty} sections={SECTIONS} />);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).not.toContain('Projects');
    expect(headings).not.toContain('Certifications');
  });

  it('respects hidden and reordered sections', () => {
    const Template = rendererFor(id);
    render(<Template doc={doc()} sections={['skills', 'experience']} />);

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).not.toContain('Education');
    expect(headings).toContain('Skills');
  });
});

describe('unknown template', () => {
  it('falls back rather than rendering nothing', () => {
    // A resume created against a retired template must stay readable and
    // editable. Throwing here would lock a user out of their own document.
    const Template = rendererFor('a-template-that-was-deleted');
    render(<Template doc={doc()} sections={SECTIONS} />);
    expect(screen.getByText('Aditi Sharma')).toBeInTheDocument();
  });
});

describe('two-column layout', () => {
  it('puts skills in the sidebar and experience in the main column', () => {
    const Template = rendererFor('two-column');
    const { container } = render(<Template doc={doc()} sections={SECTIONS} />);

    const aside = container.querySelector('aside');
    const main = container.querySelector('main');
    expect(aside).not.toBeNull();
    expect(main).not.toBeNull();

    // This split is exactly what makes it unsafe, so it is worth asserting that
    // the layout the warning describes is the layout being shipped.
    expect(within(aside as HTMLElement).getByText(/Go, Rust/)).toBeInTheDocument();
    expect(within(main as HTMLElement).getByText(/Cut settlement latency/)).toBeInTheDocument();
  });
});

describe('section promotion', () => {
  it('puts skills first in the technical template', () => {
    const Template = rendererFor('technical');
    render(<Template doc={doc()} sections={SECTIONS} />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Skills');
  });

  it('puts education first in the academic template', () => {
    const Template = rendererFor('academic');
    render(<Template doc={doc()} sections={SECTIONS} />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Education');
  });

  it('does not duplicate the promoted section', () => {
    const Template = rendererFor('technical');
    render(<Template doc={doc()} sections={SECTIONS} />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.filter((h) => h === 'Skills')).toHaveLength(1);
  });
});
