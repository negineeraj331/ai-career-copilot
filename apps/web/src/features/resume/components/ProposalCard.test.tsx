import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AiProposal } from '@cc/shared';
import { ProposalCard } from './ProposalCard.js';

/**
 * The placeholder gate.
 *
 * This is the one piece of UI that exists to stop something bad reaching an
 * employer, so it gets tested in both directions: that it blocks, and that it
 * stops blocking the moment the user has actually fixed the text.
 */

function proposal(overrides: Partial<AiProposal> = {}): AiProposal {
  return {
    id: 'bullet:1',
    before: 'Responsible for the backend',
    after: 'Cut p95 latency by [X]% across [N] services.',
    rationale: 'Leads with a verb and states a measurable result.',
    confidence: 0.8,
    placeholders: ['[X]', '[N]'],
    ...overrides,
  };
}

describe('the placeholder gate', () => {
  it('blocks Accept while a placeholder is unfilled', () => {
    render(<ProposalCard proposal={proposal()} onAccept={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
  });

  it('names every placeholder that still needs a number', () => {
    render(<ProposalCard proposal={proposal()} onAccept={vi.fn()} onReject={vi.fn()} />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('[X]');
    expect(status).toHaveTextContent('[N]');
  });

  it('unblocks only once every placeholder is gone', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(<ProposalCard proposal={proposal()} onAccept={onAccept} onReject={vi.fn()} />);

    const textarea = screen.getByRole('textbox');

    // `paste` rather than `type`: userEvent reads `[N]` as a key descriptor, so
    // typing it silently drops the brackets and the test would pass for the
    // wrong reason — the gate would look satisfied because the placeholder had
    // never been entered.
    await user.clear(textarea);
    await user.click(textarea);
    await user.paste('Cut p95 latency by 60% across [N] services.');
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();

    await user.clear(textarea);
    await user.click(textarea);
    await user.paste('Cut p95 latency by 60% across 12 services.');
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onAccept).toHaveBeenCalledWith('Cut p95 latency by 60% across 12 services.');
  });

  it('lets a clean proposal be accepted immediately', () => {
    render(
      <ProposalCard
        proposal={proposal({ after: 'Cut p95 latency by 60%.', placeholders: [] })}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
  });

  it('will not accept an empty rewrite', async () => {
    const user = userEvent.setup();
    render(
      <ProposalCard
        proposal={proposal({ after: 'Something real.', placeholders: [] })}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    await user.clear(screen.getByRole('textbox'));
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
  });
});

describe('the proposal itself', () => {
  it('shows the original alongside the rewrite', () => {
    render(<ProposalCard proposal={proposal()} onAccept={vi.fn()} onReject={vi.fn()} />);
    // The user judges the change rather than being asked to trust it.
    expect(screen.getByText('Responsible for the backend')).toBeInTheDocument();
    expect(screen.getByText(/Leads with a verb/)).toBeInTheDocument();
  });

  it('omits the before block when there was nothing to compare', () => {
    render(
      <ProposalCard
        proposal={proposal({ before: null, placeholders: [] })}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    expect(screen.queryByText('Before')).not.toBeInTheDocument();
  });

  it('lets the user edit the wording, not only the numbers', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(
      <ProposalCard
        proposal={proposal({ after: 'Cut latency by 60%.', placeholders: [] })}
        onAccept={onAccept}
        onReject={vi.fn()}
      />,
    );

    const textarea = screen.getByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, 'Halved p95 latency on the checkout path.');
    await user.click(screen.getByRole('button', { name: 'Accept' }));

    // Accepting a suggestion should not mean accepting it verbatim.
    expect(onAccept).toHaveBeenCalledWith('Halved p95 latency on the checkout path.');
  });

  it('can be discarded', async () => {
    const user = userEvent.setup();
    const onReject = vi.fn();
    render(<ProposalCard proposal={proposal()} onAccept={vi.fn()} onReject={onReject} />);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onReject).toHaveBeenCalled();
  });
});
