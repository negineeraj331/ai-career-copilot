import type { ReactNode } from 'react';
import { Button } from '../../../components/ui/Button.js';
import type { SaveState } from '../hooks/useAutosave.js';

/**
 * What the autosave is doing, in words.
 *
 * Autosave without a visible state is a trust problem: the user has no way to
 * know whether closing the tab loses the last minute of work. Every state that
 * needs an action offers one — a conflict and a failed save are not something
 * to report and walk away from.
 */
export function SaveIndicator({
  state,
  onReload,
  onRetry,
}: {
  state: SaveState;
  onReload: () => void;
  onRetry: () => void;
}): ReactNode {
  return (
    <div className="flex items-center gap-2 text-sm" aria-live="polite">
      {state.status === 'idle' && <span className="text-[var(--ink-muted)]">Up to date</span>}

      {state.status === 'dirty' && (
        <span className="text-[var(--ink-muted)]">Unsaved changes…</span>
      )}

      {state.status === 'saving' && <span className="text-[var(--ink-muted)]">Saving…</span>}

      {state.status === 'saved' && (
        <span className="text-[var(--color-status-good)]">
          Saved {new Date(state.at).toLocaleTimeString()}
        </span>
      )}

      {state.status === 'offline' && (
        <span className="text-[var(--color-status-warning)]">
          Offline — your changes are saved on this device and will sync automatically.
        </span>
      )}

      {state.status === 'conflict' && (
        <span className="flex items-center gap-2 text-[var(--color-status-serious)]">
          This resume changed elsewhere (version {state.serverVersion}).
          <Button size="sm" variant="secondary" onClick={onReload}>
            Reload theirs
          </Button>
        </span>
      )}

      {state.status === 'error' && (
        <span className="flex items-center gap-2 text-[var(--color-status-critical)]">
          {state.message}
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </span>
      )}
    </div>
  );
}
