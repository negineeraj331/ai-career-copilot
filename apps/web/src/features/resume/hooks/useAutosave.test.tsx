import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RESUME_SCHEMA_VERSION, type ResumeDocument } from '@cc/shared';
import type { ReactNode } from 'react';
import { ApiError } from '../../../lib/api-client.js';
import { useAutosave } from './useAutosave.js';

/**
 * Autosave is where unsaved work goes missing, so the paths that lose data are
 * the ones tested: a conflict, an offline save, and a keystroke arriving while
 * a request is already in flight.
 */

const update = vi.hoisted(() => vi.fn());
const queuePut = vi.hoisted(() => vi.fn());
const queueRemove = vi.hoisted(() => vi.fn());
const queueGet = vi.hoisted(() => vi.fn());

vi.mock('../api/resume.api.js', () => ({
  resumeApi: { update },
}));

vi.mock('../lib/offline-queue.js', () => ({
  offlineQueue: {
    put: queuePut,
    remove: queueRemove,
    get: queueGet,
    all: vi.fn(),
  },
}));

function doc(summary: string): ResumeDocument {
  return {
    schemaVersion: RESUME_SCHEMA_VERSION,
    contact: { fullName: 'A', email: 'a@example.com', links: [] },
    summary,
    experience: [],
    education: [],
    projects: [],
    skills: [],
    certifications: [],
    achievements: [],
    customSections: [],
    sections: { order: [], hidden: [] },
  } as ResumeDocument;
}

function wrapper({ children }: { children: ReactNode }): ReactNode {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  update.mockReset();
  queuePut.mockReset().mockResolvedValue(undefined);
  queueRemove.mockReset().mockResolvedValue(undefined);
  queueGet.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('debounce', () => {
  it('does not save while the user is still typing', () => {
    update.mockResolvedValue({ resume: { currentVersion: 2 } });
    const { result } = renderHook(() => useAutosave('r1', 1), { wrapper });

    act(() => {
      result.current.schedule(doc('one'));
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    act(() => {
      result.current.schedule(doc('two'));
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // The second keystroke restarted the clock, so nothing has been sent yet.
    expect(update).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe('dirty');
  });

  it('saves once the typing stops', async () => {
    update.mockResolvedValue({ resume: { currentVersion: 2 } });
    const { result } = renderHook(() => useAutosave('r1', 1), { wrapper });

    act(() => {
      result.current.schedule(doc('final'));
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
    expect(update).toHaveBeenCalledWith('r1', {
      content: expect.objectContaining({ summary: 'final' }),
      expectedVersion: 1,
    });
  });

  it('saves immediately on flush, without waiting for the timer', async () => {
    update.mockResolvedValue({ resume: { currentVersion: 2 } });
    const { result } = renderHook(() => useAutosave('r1', 1), { wrapper });

    act(() => {
      result.current.schedule(doc('blur'));
    });
    act(() => {
      result.current.flush();
    });

    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });
  });
});

describe('conflict', () => {
  it('reports the server version from the header rather than parsing prose', async () => {
    update.mockRejectedValue(
      new ApiError({
        code: 'CONFLICT',
        status: 409,
        message: 'This resume changed somewhere else.',
        currentVersion: 7,
      }),
    );
    const { result } = renderHook(() => useAutosave('r1', 1), { wrapper });

    act(() => {
      result.current.schedule(doc('mine'));
    });
    act(() => {
      result.current.flush();
    });

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'conflict', serverVersion: 7 });
    });
  });

  it('keeps showing the conflict when the user carries on typing', async () => {
    update.mockRejectedValue(
      new ApiError({ code: 'CONFLICT', status: 409, message: 'conflict', currentVersion: 7 }),
    );
    const { result } = renderHook(() => useAutosave('r1', 1), { wrapper });

    act(() => {
      result.current.schedule(doc('mine'));
    });
    act(() => {
      result.current.flush();
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe('conflict');
    });

    act(() => {
      result.current.schedule(doc('still typing'));
    });

    // Overwriting this with "unsaved changes" would bury the one message the
    // user has to act on.
    expect(result.current.state.status).toBe('conflict');
  });
});

describe('offline', () => {
  it('queues the edit durably instead of losing it', async () => {
    update.mockRejectedValue(
      new ApiError({ code: 'NETWORK_ERROR', status: 0, message: 'offline' }),
    );
    const { result } = renderHook(() => useAutosave('r1', 1), { wrapper });

    act(() => {
      result.current.schedule(doc('written on a train'));
    });
    act(() => {
      result.current.flush();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('offline');
    });
    expect(queuePut).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeId: 'r1',
        expectedVersion: 1,
        content: expect.objectContaining({ summary: 'written on a train' }),
      }),
    );
  });

  it('replays the queued edit when the connection returns', async () => {
    queueGet.mockResolvedValue({
      resumeId: 'r1',
      content: doc('queued'),
      expectedVersion: 1,
      queuedAt: 1,
    });
    update.mockResolvedValue({ resume: { currentVersion: 2 } });
    renderHook(() => useAutosave('r1', 1), { wrapper });

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('r1', {
        content: expect.objectContaining({ summary: 'queued' }),
        expectedVersion: 1,
      });
    });
  });

  it('clears the queue once a save succeeds', async () => {
    update.mockResolvedValue({ resume: { currentVersion: 2 } });
    const { result } = renderHook(() => useAutosave('r1', 1), { wrapper });

    act(() => {
      result.current.schedule(doc('ok'));
    });
    act(() => {
      result.current.flush();
    });

    await waitFor(() => {
      expect(queueRemove).toHaveBeenCalledWith('r1');
    });
  });
});

describe('concurrent saves', () => {
  it('does not send a second request while one is in flight', async () => {
    let resolveFirst: (v: unknown) => void = () => undefined;
    update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const { result } = renderHook(() => useAutosave('r1', 1), { wrapper });

    act(() => {
      result.current.schedule(doc('first'));
    });
    act(() => {
      result.current.flush();
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe('saving');
    });

    // A second flush while the first is still open. Sending it would carry the
    // same expectedVersion and be rejected as a conflict against the user's own
    // in-flight save.
    act(() => {
      result.current.schedule(doc('second'));
    });
    act(() => {
      result.current.flush();
    });
    expect(update).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({ resume: { currentVersion: 2 } });
      await Promise.resolve();
    });
  });
});
