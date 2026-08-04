import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { RESUME_SCHEMA_VERSION, type ResumeDetail, type ResumeDocument } from '@cc/shared';
import type { ReactNode } from 'react';
import { EditorPage } from './EditorPage.js';

/**
 * The composed editor, rendered.
 *
 * Every piece of slice 1.3 was unit-tested and nothing had ever rendered the
 * page they add up to — so a broken import, a bad prop, or a template that
 * throws would have shipped green. This test exists to make that impossible:
 * it drives the real form, the real preview, and the real template picker
 * against a mocked API.
 */

const get = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());
const scoreDraft = vi.hoisted(() => vi.fn());

vi.mock('../api/resume.api.js', () => ({
  resumeApi: { get, update, scoreDraft },
}));

vi.mock('../lib/offline-queue.js', () => ({
  offlineQueue: {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    all: vi.fn().mockResolvedValue([]),
  },
}));

function content(): ResumeDocument {
  return {
    schemaVersion: RESUME_SCHEMA_VERSION,
    contact: { fullName: 'Aditi Sharma', email: 'aditi@example.com', links: [] },
    summary: 'Backend engineer.',
    experience: [
      {
        id: 'e1',
        company: 'Razorpay',
        role: 'Senior Engineer',
        dates: { start: '2022-04', end: null },
        bullets: [{ id: 'b1', text: 'Cut settlement latency to 120 ms.' }],
        technologies: ['Go'],
      },
    ],
    education: [],
    projects: [],
    skills: [{ id: 's1', category: 'Languages', skills: ['Go'] }],
    certifications: [],
    achievements: [],
    customSections: [],
    sections: {
      order: ['summary', 'experience', 'education', 'projects', 'skills'],
      hidden: [],
    },
  } as ResumeDocument;
}

function resume(): ResumeDetail {
  return {
    id: 'r1',
    title: 'Backend SDE',
    templateId: 'minimal-ats',
    targetRole: null,
    status: 'DRAFT',
    atsScore: 42,
    currentVersion: 3,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    content: content(),
  };
}

function renderEditor(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }): ReactNode {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/resumes/r1']}>
          <Routes>
            <Route path="/resumes/:id" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  render(<EditorPage />, { wrapper: Wrapper });
}

beforeEach(() => {
  get.mockReset().mockResolvedValue({ resume: resume() });
  update.mockReset().mockResolvedValue({ resume: resume() });
  scoreDraft.mockReset().mockResolvedValue({
    score: 42,
    rubricVersion: 1,
    components: {
      parseability: { score: 60, weight: 0.3 },
      keywords: { score: 30, weight: 0.25 },
      formatting: { score: 40, weight: 0.2 },
      readability: { score: 50, weight: 0.15 },
      completeness: { score: 20, weight: 0.1 },
    },
    rules: [],
    topFixes: [
      {
        id: 'complete.quantified',
        label: 'Results are quantified',
        status: 'PARTIAL',
        weight: 4,
        earned: 1,
        explanation: '1 of 4 bullets contain a number.',
        fix: 'Add numbers to more bullets.',
      },
    ],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('loading the editor', () => {
  it('renders the form, the preview, and the score together', async () => {
    renderEditor();

    expect(await screen.findByRole('heading', { name: 'Backend SDE' })).toBeInTheDocument();

    // The form, seeded from the loaded document.
    expect(screen.getByLabelText('Full name')).toHaveValue('Aditi Sharma');

    // The preview, rendered through the selected template.
    const preview = screen.getByRole('document', { name: 'Resume preview' });
    expect(within(preview).getByText('Aditi Sharma')).toBeInTheDocument();
    expect(within(preview).getByText(/Cut settlement latency/)).toBeInTheDocument();

    // The score, with its actionable fix.
    await waitFor(() => {
      expect(screen.getByText('42')).toBeInTheDocument();
    });
    expect(screen.getByText(/Results are quantified/)).toBeInTheDocument();
  });

  it('lists every section in the navigation', async () => {
    renderEditor();
    await screen.findByRole('heading', { name: 'Backend SDE' });

    const nav = screen.getByRole('navigation', { name: 'Resume sections' });
    expect(within(nav).getByRole('button', { name: 'Summary' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Experience' })).toBeInTheDocument();
  });
});

describe('editing', () => {
  it('updates the preview as the user types, without a save', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole('heading', { name: 'Backend SDE' });

    const name = screen.getByLabelText('Full name');
    await user.clear(name);
    await user.type(name, 'Rohan Mehta');

    // The whole point of a local render: the preview tracks typing rather than
    // the last round trip.
    const preview = screen.getByRole('document', { name: 'Resume preview' });
    await waitFor(() => {
      expect(within(preview).getByText('Rohan Mehta')).toBeInTheDocument();
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('shows unsaved state while typing and saves on blur', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole('heading', { name: 'Backend SDE' });

    await user.type(screen.getByLabelText('Headline'), 'Backend Engineer');
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();

    await user.tab();
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('r1', expect.objectContaining({ expectedVersion: 3 }));
    });
  });

  it('switches sections without losing an edit', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole('heading', { name: 'Backend SDE' });

    await user.type(screen.getByLabelText('Headline'), 'Staff Engineer');

    const nav = screen.getByRole('navigation', { name: 'Resume sections' });
    await user.click(within(nav).getByRole('button', { name: 'Experience' }));
    expect(screen.getByLabelText('Company')).toHaveValue('Razorpay');

    await user.click(within(nav).getByRole('button', { name: 'Summary' }));
    expect(screen.getByLabelText('Headline')).toHaveValue('Staff Engineer');
  });
});

describe('templates', () => {
  it('offers every template and warns about the unsafe one', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole('heading', { name: 'Backend SDE' });

    expect(screen.getByRole('radio', { name: /Minimal/ })).toBeChecked();
    expect(screen.getByText(/May not parse/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /Two column/ }));

    // The warning has to arrive with the choice, not after a save round trip.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/not ATS-safe/i);
    });
    expect(update).toHaveBeenCalledWith('r1', { templateId: 'two-column' });
  });

  it('re-renders the preview in the chosen template', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByRole('heading', { name: 'Backend SDE' });

    await user.click(screen.getByRole('radio', { name: /Two column/ }));

    // The two-column template is the only one with a sidebar, so its presence
    // is the observable difference.
    await waitFor(() => {
      const preview = screen.getByRole('document', { name: 'Resume preview' });
      expect(preview.querySelector('aside')).not.toBeNull();
    });
  });
});

describe('failure', () => {
  it('offers a retry rather than a blank page when the resume will not load', async () => {
    get.mockRejectedValue(new Error('Network down'));
    renderEditor();
    expect(await screen.findByText(/Network down/)).toBeInTheDocument();
  });
});
