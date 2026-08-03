import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../lib/query-client.js';
import { authApi } from '../auth/api/auth.api.js';
import { useLogout, useSession } from '../auth/hooks/useSession.js';
import { Button } from '../../components/ui/Button.js';
import { EmptyState, ErrorState, Skeleton } from '../../components/feedback/States.js';
import { useThemeStore } from '../../store/theme.store.js';

/**
 * Placeholder dashboard for slice 0.7.
 *
 * It exists so the auth flow lands somewhere real and so device sessions and
 * the security log are visible end to end. The actual product surface arrives
 * with the resume editor in Phase 1.
 */
export function DashboardPage(): ReactNode {
  const { user } = useSession();
  const logout = useLogout();
  const { theme, setTheme } = useThemeStore();

  const sessions = useQuery({
    queryKey: queryKeys.auth.sessions(),
    queryFn: () => authApi.sessions().then((r) => r.sessions),
  });

  const audit = useQuery({
    queryKey: queryKeys.auth.auditLog(),
    queryFn: () => authApi.auditLog().then((r) => r.events),
  });

  return (
    <div className="relative min-h-dvh">
      <div className="aurora" aria-hidden="true" />

      <header className="border-b border-[var(--border-hairline)]">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4">
          <span className="font-semibold tracking-tight">Career&nbsp;Copilot</span>
          <div className="flex items-center gap-2">
            <label className="sr-only-focusable" htmlFor="theme-select">
              Theme
            </label>
            <select
              id="theme-select"
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
              className="rounded-[var(--radius-sm)] border border-[var(--border-hairline)] bg-[var(--surface-raised)] px-2 py-1.5 text-sm"
            >
              <option value="system">System theme</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => logout.mutate()}
              loading={logout.isPending}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10">
        <section>
          <h1 className="text-2xl font-bold">Welcome{user?.name ? `, ${user.name}` : ''}</h1>
          <p className="mt-1 text-sm text-[var(--ink-secondary)]">
            {user?.email}
            {user?.emailVerified ? ' · verified' : ' · unverified'}
            {user?.mfaEnabled ? ' · 2FA on' : ''}
          </p>
        </section>

        <section className="glass rounded-[var(--radius-lg)] p-6">
          <EmptyState
            title="No resumes yet"
            description="The resume editor, ATS scoring, and job-description matching arrive in the next phase. Authentication is what is live today."
          />
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Active devices</h2>
          {sessions.isLoading && <Skeleton className="h-20 w-full" />}
          {sessions.isError && (
            <ErrorState
              message="Could not load your sessions."
              onRetry={() => void sessions.refetch()}
            />
          )}
          {sessions.data && (
            <ul className="flex flex-col gap-2">
              {sessions.data.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--border-hairline)] px-4 py-3 text-sm"
                >
                  <span>
                    {s.device}
                    {s.current && (
                      <span className="ml-2 rounded-full bg-[var(--color-status-good)]/15 px-2 py-0.5 text-xs text-[var(--color-status-good)]">
                        this device
                      </span>
                    )}
                  </span>
                  <span className="text-[var(--ink-muted)]">{s.ipPrefix}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Recent security activity</h2>
          {audit.isLoading && <Skeleton className="h-20 w-full" />}
          {audit.data && (
            <ul className="flex flex-col gap-1 text-sm">
              {audit.data.slice(0, 8).map((e) => (
                <li key={e.id} className="flex justify-between gap-4 py-1">
                  <span className="text-[var(--ink-primary)]">
                    {e.event.toLowerCase().replaceAll('_', ' ')}
                  </span>
                  <span className="text-[var(--ink-muted)]">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
