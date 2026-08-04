import { useState, type ReactNode } from 'react';
import type { AiProposal } from '@cc/shared';
import { Button } from '../../../components/ui/Button.js';
import { cn } from '../../../lib/cn.js';

/**
 * One AI suggestion, with the thing that makes it honest.
 *
 * `placeholders` lists every figure the model invented because it could not
 * know the real one. Accept stays disabled until each has been replaced. The
 * model flags what it does not know; the product refuses to let an unverified
 * number onto a resume silently (docs/11 §5).
 *
 * The server enforces the same rule on save, so this is the good experience
 * rather than the guarantee — but it is where the user can actually fix it.
 */
export function ProposalCard({
  proposal,
  onAccept,
  onReject,
}: {
  proposal: AiProposal;
  onAccept: (text: string) => void;
  onReject: () => void;
}): ReactNode {
  // Edited locally so the user can correct the wording as well as the figures —
  // accepting a suggestion should not mean accepting it verbatim.
  const [text, setText] = useState(proposal.after);

  const unresolved = proposal.placeholders.filter((p) => text.includes(p));
  const canAccept = unresolved.length === 0 && text.trim().length > 0;

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-[var(--border-hairline)] p-4">
      {proposal.before && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-[var(--ink-muted)] uppercase">
            Before
          </span>
          <p className="text-sm text-[var(--ink-secondary)] line-through decoration-1">
            {proposal.before}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium tracking-wide text-[var(--ink-muted)] uppercase">
          Suggested
        </label>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          className={cn(
            'w-full rounded-lg border bg-[var(--surface-card)] px-3 py-2 text-sm',
            unresolved.length > 0
              ? 'border-[var(--color-status-warning)]'
              : 'border-[var(--border-hairline)]',
          )}
        />
      </div>

      <p className="text-xs text-[var(--ink-secondary)]">
        {proposal.rationale}
        <span className="ml-2 text-[var(--ink-muted)]">
          confidence {Math.round(proposal.confidence * 100)}%
        </span>
      </p>

      {unresolved.length > 0 && (
        <p
          // A live region: the list shrinks as the user types, and a screen
          // reader user needs to know when the last one is gone and Accept has
          // become available.
          role="status"
          className="rounded-lg border border-[var(--color-status-warning)] p-2 text-xs"
        >
          <strong>Replace {unresolved.join(', ')}</strong> with your real numbers. The assistant
          could not know them, and a figure you have not checked should not go on your resume.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!canAccept}
          onClick={() => {
            onAccept(text);
          }}
        >
          Accept
        </Button>
        <Button size="sm" variant="ghost" onClick={onReject}>
          Discard
        </Button>
      </div>
    </article>
  );
}
