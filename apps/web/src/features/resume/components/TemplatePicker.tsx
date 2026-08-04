import type { ReactNode } from 'react';
import { TEMPLATES, templateById } from '@cc/shared';
import { cn } from '../../../lib/cn.js';

/**
 * Template selection, with the ATS-safety cost stated up front.
 *
 * The warning sits beside the choice rather than behind a tooltip or an info
 * icon. Someone picking a two-column layout is choosing between looking good to
 * a human and parsing correctly for a machine, and that is a decision they can
 * only make if they are told about it before they make it.
 */
export function TemplatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}): ReactNode {
  const selected = templateById(value);
  const sorted = [...TEMPLATES].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="flex flex-col gap-3">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Template</legend>
        <div className="flex flex-col gap-1">
          {sorted.map((template) => (
            <label
              key={template.id}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm transition-colors',
                value === template.id
                  ? 'border-[var(--accent)] bg-[var(--surface-raised)]'
                  : 'border-[var(--border-hairline)] hover:bg-[var(--surface-raised)]',
              )}
            >
              <input
                type="radio"
                name="template"
                value={template.id}
                checked={value === template.id}
                onChange={() => {
                  onChange(template.id);
                }}
                className="mt-1"
              />
              <span className="flex flex-col">
                <span className="flex items-center gap-2 font-medium">
                  {template.name}
                  {!template.atsSafe && (
                    <span className="rounded bg-[var(--color-status-warning)]/20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-status-warning)] uppercase">
                      May not parse
                    </span>
                  )}
                </span>
                <span className="text-xs text-[var(--ink-muted)]">{template.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {selected && !selected.atsSafe && (
        <p
          // A live region: the warning appears in response to the user's choice,
          // and a screen-reader user who has just selected it would otherwise
          // never learn what changed.
          role="status"
          className="rounded-lg border border-[var(--color-status-warning)] p-2 text-xs"
        >
          <strong>{selected.name}</strong> is not ATS-safe. Applicant tracking systems typically
          read both columns straight across, interleaving your sidebar into your experience. Use it
          when a human reads first — a referral, a portfolio, a career fair — and switch to a
          single-column template when applying through a job board.
        </p>
      )}

      {selected === undefined && (
        <p role="status" className="rounded-lg border border-[var(--border-hairline)] p-2 text-xs">
          This resume uses a template that is no longer available, so it is being shown in the
          default one. Pick a template above to make that permanent.
        </p>
      )}
    </div>
  );
}
