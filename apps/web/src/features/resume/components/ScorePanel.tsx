import type { ReactNode } from 'react';
import { SCORE_BANDS, scoreBand, type AtsRuleResult } from '@cc/shared';
import { cn } from '../../../lib/cn.js';
import type { AtsScoreResult } from '../api/resume.api.js';

/**
 * The live ATS score and the fixes that would move it (docs/09 §3).
 *
 * The score is deliberately never shown alone. A bare number invites the user
 * to optimise for it without knowing what it measures, and the rubric's whole
 * credibility argument is that every lost point is traceable to a named rule
 * with a human explanation.
 */

const BAND_CLASS: Record<ReturnType<typeof scoreBand>, string> = {
  CRITICAL: 'text-[var(--color-status-critical)]',
  SERIOUS: 'text-[var(--color-status-serious)]',
  WARNING: 'text-[var(--color-status-warning)]',
  GOOD: 'text-[var(--color-status-good)]',
};

export function ScorePanel({
  score,
  isStale,
}: {
  score: AtsScoreResult | undefined;
  isStale: boolean;
}): ReactNode {
  if (!score) {
    return (
      <div className="rounded-xl border border-[var(--border-hairline)] p-4">
        <p className="text-sm text-[var(--ink-muted)]">Scoring…</p>
      </div>
    );
  }

  const band = scoreBand(score.score);

  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-xl border border-[var(--border-hairline)] p-4 transition-opacity',
        // Dimmed rather than hidden while recomputing: replacing the number
        // with a spinner on every keystroke makes it unreadable, and the old
        // value is a fraction of a second stale, not wrong.
        isStale && 'opacity-60',
      )}
    >
      <div className="flex items-baseline gap-3">
        <span className={cn('text-4xl font-semibold tabular-nums', BAND_CLASS[band])}>
          {score.score}
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-medium">{SCORE_BANDS[band].label}</span>
          <span className="text-xs text-[var(--ink-muted)]">ATS score out of 100</span>
        </div>
      </div>

      <ul className="flex flex-col gap-1">
        {Object.entries(score.components).map(([name, component]) => (
          <li key={name} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 text-[var(--ink-secondary)] capitalize">{name}</span>
            <span
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-raised)]"
              role="img"
              aria-label={`${name}: ${String(component.score)} out of 100`}
            >
              <span
                className="block h-full rounded-full bg-[var(--accent)]"
                style={{ width: `${String(component.score)}%` }}
              />
            </span>
            <span className="w-8 text-right tabular-nums">{component.score}</span>
          </li>
        ))}
      </ul>

      {score.topFixes.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Fix these next</h3>
          {score.topFixes.map((fix) => (
            <Fix key={fix.id} fix={fix} />
          ))}
        </div>
      )}

      {score.topFixes.length === 0 && (
        <p className="text-sm text-[var(--color-status-good)]">
          Every rule passes. Nothing left to fix here.
        </p>
      )}
    </div>
  );
}

function Fix({ fix }: { fix: AtsRuleResult }): ReactNode {
  return (
    <details className="rounded-lg border border-[var(--border-hairline)] p-2">
      <summary className="cursor-pointer text-xs font-medium">
        {fix.label}
        <span className="ml-2 font-normal text-[var(--ink-muted)]">
          {fix.status === 'FAIL' ? 'failing' : 'partial'} · {fix.earned}/{fix.weight}
        </span>
      </summary>
      <p className="mt-2 text-xs text-[var(--ink-secondary)]">{fix.explanation}</p>
      {fix.fix && <p className="mt-1 text-xs text-[var(--ink-primary)]">{fix.fix}</p>}
    </details>
  );
}
