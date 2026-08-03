import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionReorder, type ReorderItem } from './SectionReorder.js';

/**
 * The keyboard path is the reason these tests exist.
 *
 * docs/09 calls drag-only reordering an accessibility failure rather than a
 * missing feature. Drag cannot be meaningfully tested in jsdom, so it is
 * exactly the affordance that would rot unnoticed — which is why the two that
 * can be tested are tested properly.
 */

const ITEMS: ReorderItem[] = [
  { key: 'summary', label: 'Summary', hidden: false },
  { key: 'experience', label: 'Experience', hidden: false },
  { key: 'skills', label: 'Skills', hidden: false },
];

function setup(overrides: Partial<Parameters<typeof SectionReorder>[0]> = {}) {
  const onReorder = vi.fn();
  const onToggleHidden = vi.fn();
  const onSelect = vi.fn();
  render(
    <SectionReorder
      items={ITEMS}
      onReorder={onReorder}
      onToggleHidden={onToggleHidden}
      onSelect={onSelect}
      activeKey="summary"
      {...overrides}
    />,
  );
  return { onReorder, onToggleHidden, onSelect };
}

describe('keyboard reordering', () => {
  it('lifts, moves, and drops with space and arrows', async () => {
    const user = userEvent.setup();
    const { onReorder } = setup();

    const summary = screen.getByRole('button', { name: 'Summary' });
    summary.focus();

    await user.keyboard(' ');
    expect(summary).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard('{ArrowDown}');
    expect(onReorder).toHaveBeenCalledWith(['experience', 'summary', 'skills']);
  });

  it('announces every step to a screen reader', async () => {
    const user = userEvent.setup();
    setup();

    const summary = screen.getByRole('button', { name: 'Summary' });
    summary.focus();

    await user.keyboard(' ');
    // Without this the whole interaction is silent and therefore unusable.
    expect(screen.getByText(/lifted/i)).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByText(/moved to position 2 of 3/i)).toBeInTheDocument();
  });

  it('cancels a lift on Escape without reordering', async () => {
    const user = userEvent.setup();
    const { onReorder } = setup();

    const summary = screen.getByRole('button', { name: 'Summary' });
    summary.focus();
    await user.keyboard(' ');
    await user.keyboard('{Escape}');

    expect(summary).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/move cancelled/i)).toBeInTheDocument();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('moves focus without reordering when nothing is lifted', async () => {
    const user = userEvent.setup();
    const { onReorder } = setup();

    screen.getByRole('button', { name: 'Summary' }).focus();
    await user.keyboard('{ArrowDown}');

    // Arrow keys navigate until something is deliberately picked up. Reordering
    // on a bare arrow press would rearrange the resume of anyone tabbing past.
    expect(onReorder).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Experience' })).toHaveFocus();
  });

  it('refuses to move the first item up or the last item down', async () => {
    const user = userEvent.setup();
    const { onReorder } = setup();

    const summary = screen.getByRole('button', { name: 'Summary' });
    summary.focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowUp}');

    expect(onReorder).not.toHaveBeenCalled();
  });
});

describe('button reordering', () => {
  it('offers move up and move down on every section', async () => {
    const user = userEvent.setup();
    const { onReorder } = setup();

    await user.click(screen.getByRole('button', { name: 'Move Experience up' }));
    expect(onReorder).toHaveBeenCalledWith(['experience', 'summary', 'skills']);

    await user.click(screen.getByRole('button', { name: 'Move Summary down' }));
    expect(onReorder).toHaveBeenCalledWith(['experience', 'summary', 'skills']);
  });

  it('disables the moves that would fall off the ends', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Move Summary up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Skills down' })).toBeDisabled();
  });

  it('labels the visibility toggle by what it will do', async () => {
    const user = userEvent.setup();
    const { onToggleHidden } = setup({
      items: [
        { key: 'summary', label: 'Summary', hidden: false },
        { key: 'skills', label: 'Skills', hidden: true },
      ],
    });

    expect(screen.getByRole('button', { name: 'Show Skills' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide Summary' }));
    expect(onToggleHidden).toHaveBeenCalledWith('summary');
  });
});

describe('selection', () => {
  it('marks the active section for assistive technology', () => {
    setup({ activeKey: 'experience' });
    expect(screen.getByRole('button', { name: 'Experience' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('selects a section on click', async () => {
    const user = userEvent.setup();
    const { onSelect } = setup();
    await user.click(screen.getByRole('button', { name: 'Skills' }));
    expect(onSelect).toHaveBeenCalledWith('skills');
  });
});
