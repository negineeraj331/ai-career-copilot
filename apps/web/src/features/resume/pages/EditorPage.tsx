import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ResumeDocument, SectionKey } from '@cc/shared';
import { queryKeys } from '../../../lib/query-client.js';
import { ErrorState, Skeleton } from '../../../components/feedback/States.js';
import { resumeApi, type AtsScoreResult } from '../api/resume.api.js';
import { useAutosave } from '../hooks/useAutosave.js';
import { offlineQueue } from '../lib/offline-queue.js';
import {
  SECTION_LABELS,
  isHidden,
  orderedSections,
  reorder,
  toggleHidden,
} from '../lib/document.js';
import { SectionForm } from '../components/SectionForms.js';
import { SectionReorder } from '../components/SectionReorder.js';
import { PreviewPane } from '../components/PreviewPane.js';
import { ScorePanel } from '../components/ScorePanel.js';
import { SaveIndicator } from '../components/SaveIndicator.js';
import { TemplatePicker } from '../components/TemplatePicker.js';

/**
 * Split-screen editor (slice 1.3).
 *
 * The document lives in local state while editing, not in the query cache. The
 * cache is server state; a keystroke is not. Writing every keystroke into the
 * cache would either fight refetches or require disabling them, and docs/10
 * explicitly rejects keeping a second copy of server data in client state.
 */
export function EditorPage(): ReactNode {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [doc, setDoc] = useState<ResumeDocument | null>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>('summary');
  const [recovered, setRecovered] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.resumes.detail(id),
    queryFn: ({ signal }) => resumeApi.get(id, signal).then((r) => r.resume),
    enabled: Boolean(id),
  });

  const version = query.data?.currentVersion ?? 1;
  const autosave = useAutosave(id, version);

  /**
   * A template change is metadata, not content, so it saves immediately rather
   * than joining the debounced content queue. It also does not carry
   * `expectedVersion`: switching templates cannot conflict with someone else's
   * text edit, and refusing it on that basis would be a conflict the user has
   * no way to resolve.
   */
  const templateMutation = useMutation({
    mutationFn: (templateId: string) => resumeApi.update(id, { templateId }),
    onSuccess: ({ resume }) => {
      queryClient.setQueryData(queryKeys.resumes.detail(id), { resume });
      void queryClient.invalidateQueries({ queryKey: queryKeys.resumes.list() });
    },
  });

  // Seed local state once the resume loads. A queued offline edit wins over the
  // server copy: it is strictly newer, and silently discarding it is the exact
  // data loss the durable queue exists to prevent.
  useEffect(() => {
    if (!query.data || doc) return;
    let cancelled = false;

    void offlineQueue.get(id).then((queued) => {
      if (cancelled) return;
      if (queued) {
        setDoc(queued.content);
        setRecovered(true);
      } else {
        setDoc(query.data.content);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [query.data, doc, id]);

  const onChange = useCallback(
    (next: ResumeDocument) => {
      setDoc(next);
      autosave.schedule(next);
    },
    [autosave],
  );

  const scoreQuery = useQuery<AtsScoreResult>({
    // Keyed on the document itself so the score follows what is on screen. The
    // key is the content hash rather than the resume id: two documents that
    // differ by one character must not share a cached score.
    queryKey: ['ats-draft', id, doc ? hashDoc(doc) : 'none'],
    queryFn: () => resumeApi.scoreDraft(doc as ResumeDocument),
    enabled: Boolean(doc),
    staleTime: Infinity,
    placeholderData: (previous) => previous,
  });

  const sections = useMemo(() => (doc ? orderedSections(doc) : []), [doc]);

  // Errors are checked BEFORE the loading guard. With the order reversed, a
  // failed load left `doc` null forever and the page showed a skeleton that
  // never resolved — the error branch below was unreachable, and the user got a
  // permanent spinner instead of a retry.
  if (query.isError) {
    return (
      <ErrorState
        title="Could not open this resume"
        message={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  }

  if (query.isPending || !doc) {
    return (
      <div className="flex flex-col gap-4 p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--border-hairline)] bg-[var(--surface-app)]/90 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link to="/resumes" className="text-sm underline">
              ← Resumes
            </Link>
            <h1 className="text-lg font-semibold">{query.data.title}</h1>
          </div>
          <SaveIndicator
            state={autosave.state}
            onReload={() => {
              autosave.discardLocal();
              setDoc(null);
              void query.refetch();
            }}
            onRetry={autosave.flush}
          />
        </div>

        {recovered && (
          <p className="border-t border-[var(--border-hairline)] bg-[var(--surface-raised)] px-4 py-2 text-sm">
            Restored an edit that had not reached the server.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => {
                autosave.discardLocal();
                setDoc(query.data.content);
                setRecovered(false);
              }}
            >
              Discard it and use the saved version
            </button>
          </p>
        )}
      </header>

      <div className="grid flex-1 gap-6 p-4 lg:grid-cols-[16rem_minmax(0,1fr)_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4">
          <SectionReorder
            items={sections.map((key) => ({
              key,
              label: SECTION_LABELS[key] ?? key,
              hidden: isHidden(doc, key),
            }))}
            activeKey={activeSection}
            onSelect={(key) => {
              setActiveSection(key as SectionKey);
            }}
            onReorder={(order) => {
              onChange(reorder(doc, order));
            }}
            onToggleHidden={(key) => {
              onChange(toggleHidden(doc, key));
            }}
          />
          <ScorePanel score={scoreQuery.data} isStale={scoreQuery.isFetching} />
          <TemplatePicker
            value={templateMutation.variables ?? query.data.templateId}
            onChange={(templateId) => {
              templateMutation.mutate(templateId);
            }}
          />
        </aside>

        <section aria-label={`Edit ${SECTION_LABELS[activeSection] ?? activeSection}`}>
          <h2 className="mb-4 text-sm font-semibold tracking-wide uppercase">
            {SECTION_LABELS[activeSection] ?? activeSection}
          </h2>
          <SectionForm
            section={activeSection}
            doc={doc}
            onChange={onChange}
            onBlur={autosave.flush}
          />
        </section>

        {/* One preview, not one per breakpoint.
            An earlier version rendered a desktop copy and a mobile copy and let
            CSS hide whichever did not apply. Both were still in the accessibility
            tree, so a screen reader announced the entire resume twice. The grid
            already collapses this column below `lg`, which is all the responsive
            behaviour it needed. */}
        <section aria-label="Preview" className="overflow-x-auto">
          <div className="lg:sticky lg:top-24">
            <PreviewPane
              doc={doc}
              templateId={templateMutation.variables ?? query.data.templateId}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * A cheap, stable key for the score query.
 *
 * Not a cryptographic hash and not trying to be — it only has to change when
 * the document does. The server recomputes the real score; this decides whether
 * to ask.
 */
function hashDoc(doc: ResumeDocument): string {
  const json = JSON.stringify(doc);
  let h = 0;
  for (let i = 0; i < json.length; i += 1) {
    h = (h * 31 + json.charCodeAt(i)) | 0;
  }
  return `${String(json.length)}:${String(h)}`;
}
