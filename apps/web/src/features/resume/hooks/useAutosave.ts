import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ResumeDocument } from '@cc/shared';
import { ApiError } from '../../../lib/api-client.js';
import { queryKeys } from '../../../lib/query-client.js';
import { resumeApi } from '../api/resume.api.js';
import { offlineQueue } from '../lib/offline-queue.js';

/**
 * Autosave with optimistic concurrency and an offline queue (docs/10 §6).
 *
 * Saves 2 seconds after typing stops, or immediately on blur. Every save
 * carries `expectedVersion`; a 409 means another tab or device moved ahead, and
 * the editor surfaces that rather than silently clobbering the other change.
 */

export type SaveState =
  | { status: 'idle' }
  | { status: 'dirty' }
  | { status: 'saving' }
  | { status: 'saved'; at: number }
  | { status: 'offline' }
  | { status: 'conflict'; serverVersion: number }
  | { status: 'error'; message: string };

const IDLE_DELAY_MS = 2000;

export interface UseAutosave {
  state: SaveState;
  /** Record an edit. Schedules a save; does not perform one. */
  schedule: (content: ResumeDocument) => void;
  /** Save now — used on blur and before navigating away. */
  flush: () => void;
  /** After a conflict: take the server's version and discard the local edit. */
  discardLocal: () => void;
}

export function useAutosave(resumeId: string, initialVersion: number): UseAutosave {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SaveState>({ status: 'idle' });

  // Refs, not state: these change on every keystroke and must not re-render the
  // editor. The one thing that does render — `state` — changes rarely.
  const pending = useRef<ResumeDocument | null>(null);
  const version = useRef(initialVersion);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    version.current = initialVersion;
  }, [initialVersion]);

  const save = useCallback(async (): Promise<void> => {
    const content = pending.current;
    // `inFlight` serialises saves. Without it a slow request and a fast typist
    // produce two concurrent PATCHes carrying the same `expectedVersion`; the
    // second is then rejected as a conflict against a version the user's own
    // first save had just created.
    if (!content || inFlight.current) return;

    inFlight.current = true;
    setState({ status: 'saving' });

    try {
      const { resume } = await resumeApi.update(resumeId, {
        content,
        expectedVersion: version.current,
      });

      // Only clear the buffer if nothing was typed while the request was in
      // flight; otherwise those keystrokes would be dropped on the floor.
      if (pending.current === content) pending.current = null;

      version.current = resume.currentVersion ?? version.current;
      await offlineQueue.remove(resumeId);

      queryClient.setQueryData(queryKeys.resumes.detail(resumeId), { resume });
      void queryClient.invalidateQueries({ queryKey: queryKeys.resumes.versions(resumeId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.resumes.list() });

      setState({ status: 'saved', at: Date.now() });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'NETWORK_ERROR') {
        // Keep the edit. The queue is durable, so closing the tab now still
        // preserves it, and the flush on reconnect will replay it.
        await offlineQueue.put({
          resumeId,
          content,
          expectedVersion: version.current,
          queuedAt: Date.now(),
        });
        setState({ status: 'offline' });
      } else if (error instanceof ApiError && error.status === 409) {
        setState({
          status: 'conflict',
          serverVersion: error.currentVersion ?? version.current + 1,
        });
      } else {
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not save.',
        });
      }
    } finally {
      inFlight.current = false;
    }
  }, [queryClient, resumeId]);

  const schedule = useCallback(
    (content: ResumeDocument) => {
      pending.current = content;
      setState((current) =>
        // A conflict is unresolved until the user acts on it. Overwriting it
        // with "dirty" would hide the one message they have to read.
        current.status === 'conflict' ? current : { status: 'dirty' },
      );

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void save();
      }, IDLE_DELAY_MS);
    },
    [save],
  );

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    void save();
  }, [save]);

  const discardLocal = useCallback(() => {
    pending.current = null;
    void offlineQueue.remove(resumeId);
    void queryClient.invalidateQueries({ queryKey: queryKeys.resumes.detail(resumeId) });
    setState({ status: 'idle' });
  }, [queryClient, resumeId]);

  // Replay whatever the queue is holding as soon as the connection returns.
  useEffect(() => {
    function onOnline(): void {
      void offlineQueue.get(resumeId).then((queued) => {
        if (!queued) return;
        pending.current = queued.content;
        void save();
      });
    }
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
    };
  }, [resumeId, save]);

  // Persist an unsaved edit if the tab goes away mid-timer. `pagehide` rather
  // than `beforeunload`: it fires on mobile backgrounding, which is where a tab
  // is most likely to be discarded without warning.
  useEffect(() => {
    function onPageHide(): void {
      if (pending.current) {
        void offlineQueue.put({
          resumeId,
          content: pending.current,
          expectedVersion: version.current,
          queuedAt: Date.now(),
        });
      }
    }
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [resumeId]);

  return { state, schedule, flush, discardLocal };
}
