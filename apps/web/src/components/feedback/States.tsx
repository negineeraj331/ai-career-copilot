import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Button } from '../ui/Button.js';

/** Matches the final content's dimensions so nothing shifts on load — this is
 *  the main defence for the CLS budget (NFR-06). */
export function Skeleton({ className }: { className?: string }): ReactNode {
  return (
    <div
      className={cn('animate-pulse rounded-[var(--radius-sm)] bg-[var(--surface-card)]', className)}
      aria-hidden="true"
    />
  );
}

/** Never renders a bare "No data": every empty state says what belongs here and
 *  offers the action that creates it. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}): ReactNode {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-hairline)] px-6 py-12 text-center">
      <h3 className="text-lg font-semibold text-[var(--ink-primary)]">{title}</h3>
      <p className="max-w-sm text-sm text-[var(--ink-secondary)]">{description}</p>
      {action && (
        <Button onClick={action.onClick} className="mt-2">
          {action.label}
        </Button>
      )}
    </div>
  );
}

/**
 * What failed, and what to do about it — never a stack trace.
 *
 * The correlation id is shown because it is the one thing that turns "it broke"
 * into a log line somebody can actually find.
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  requestId,
  onRetry,
}: {
  title?: string;
  message: string;
  requestId?: string;
  onRetry?: () => void;
}): ReactNode {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-status-critical)]/30 bg-[var(--color-status-critical)]/5 px-6 py-8 text-center"
    >
      <h3 className="text-base font-semibold text-[var(--ink-primary)]">{title}</h3>
      <p className="max-w-sm text-sm text-[var(--ink-secondary)]">{message}</p>
      {requestId && (
        <code className="rounded bg-[var(--surface-card)] px-2 py-1 font-mono text-xs text-[var(--ink-muted)]">
          {requestId}
        </code>
      )}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * Inline form-level message.
 *
 * `role="alert"` on errors so the message is announced immediately — a user who
 * submits a form and hears nothing has no idea it failed.
 */
export function FormMessage({
  tone,
  children,
}: {
  tone: 'error' | 'success' | 'info';
  children: ReactNode;
}): ReactNode {
  const tones = {
    error: 'border-[var(--color-status-critical)]/30 bg-[var(--color-status-critical)]/5',
    success: 'border-[var(--color-status-good)]/30 bg-[var(--color-status-good)]/5',
    info: 'border-[var(--border-hairline)] bg-[var(--surface-card)]',
  } as const;

  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-[var(--radius-sm)] border px-3 py-2.5 text-sm text-[var(--ink-primary)]',
        tones[tone],
      )}
    >
      {children}
    </p>
  );
}
