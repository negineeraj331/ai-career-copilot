import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { scoreBand, SCORE_BANDS } from '@cc/shared';
import { queryKeys } from '../../../lib/query-client.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { EmptyState, ErrorState, Skeleton } from '../../../components/feedback/States.js';
import { resumeApi } from '../api/resume.api.js';

/** The list of a user's resumes, and the way a new one gets made. */
export function ResumesPage(): ReactNode {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');

  const list = useQuery({
    queryKey: queryKeys.resumes.list(),
    queryFn: ({ signal }) => resumeApi.list(signal).then((r) => r.items),
  });

  const create = useMutation({
    mutationFn: (name: string) => resumeApi.create({ title: name }),
    onSuccess: ({ resume }) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.resumes.list() });
      void navigate(`/resumes/${resume.id}`);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => resumeApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.resumes.list() }),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => resumeApi.duplicate(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.resumes.list() }),
  });

  return (
    <div className="relative min-h-dvh">
      <div className="aurora" aria-hidden="true" />

      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Your resumes</h1>
          <Link to="/dashboard" className="text-sm underline">
            Account
          </Link>
        </header>

        <form
          className="flex items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate(title.trim());
          }}
        >
          <div className="flex-1">
            <Input
              label="New resume"
              placeholder="Backend Engineer — Razorpay"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              error={create.error?.message}
            />
          </div>
          <Button type="submit" loading={create.isPending} disabled={!title.trim()}>
            Create
          </Button>
        </form>

        {list.isPending && <Skeleton className="h-32 w-full" />}

        {list.isError && (
          <ErrorState
            title="Could not load your resumes"
            message={list.error.message}
            onRetry={() => void list.refetch()}
          />
        )}

        {list.data?.length === 0 && (
          <EmptyState
            title="No resumes yet"
            description="Create one above. You can start from scratch — the score will tell you what is missing."
          />
        )}

        <ul className="flex flex-col gap-3">
          {list.data?.map((resume) => {
            const band = resume.atsScore === null ? null : scoreBand(resume.atsScore);
            return (
              <li
                key={resume.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-hairline)] p-4"
              >
                <div className="flex flex-col">
                  <Link to={`/resumes/${resume.id}`} className="font-medium underline">
                    {resume.title}
                  </Link>
                  <span className="text-xs text-[var(--ink-muted)]">
                    v{resume.currentVersion ?? 1} · updated{' '}
                    {new Date(resume.updatedAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {band && (
                    <span className="text-sm">
                      <strong className="tabular-nums">{resume.atsScore}</strong>{' '}
                      <span className="text-[var(--ink-muted)]">{SCORE_BANDS[band].label}</span>
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      duplicate.mutate(resume.id);
                    }}
                  >
                    Duplicate
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      // Soft delete on the server, so this is recoverable by
                      // support rather than gone. Still worth a confirmation.
                      if (confirm(`Delete "${resume.title}"?`)) remove.mutate(resume.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
