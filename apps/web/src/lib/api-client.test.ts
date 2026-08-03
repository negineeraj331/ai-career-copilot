import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from './api-client.js';

/**
 * The API client is where a silent mistake costs the most: a dropped CSRF
 * header 403s every mutation, and an unbounded refresh loop signs users out.
 * Neither shows up in a typecheck.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ok<T>(data: T): Response {
  return jsonResponse({ success: true, data, meta: { requestId: 'req-1' } });
}

function fail(code: string, status: number, message = 'nope'): Response {
  return jsonResponse(
    { success: false, error: { code, message }, meta: { requestId: 'req-1' } },
    status,
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'cc_csrf=csrf-token-value';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request basics', () => {
  it('sends credentials so session cookies actually ride along', async () => {
    fetchMock.mockResolvedValue(ok({ hello: 'world' }));
    await apiClient.get('/thing');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    // Without this the browser sends no cookies and every authenticated call
    // 401s for no visible reason.
    expect(init.credentials).toBe('include');
  });

  it('echoes the CSRF cookie back as a header', async () => {
    fetchMock.mockResolvedValue(ok({}));
    await apiClient.post('/thing', { a: 1 });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBe('csrf-token-value');
  });

  it('unwraps the success envelope', async () => {
    fetchMock.mockResolvedValue(ok({ value: 42 }));
    await expect(apiClient.get<{ value: number }>('/thing')).resolves.toEqual({ value: 42 });
  });

  it('handles 204 with no body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiClient.delete('/thing')).resolves.toBeUndefined();
  });

  it('turns an error envelope into a typed ApiError', async () => {
    fetchMock.mockResolvedValue(fail('VALIDATION_ERROR', 400, 'Some fields need attention.'));

    await expect(apiClient.post('/thing', {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Some fields need attention.',
      requestId: 'req-1',
    });
  });

  it('reports a network failure as a readable error, not a raw TypeError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await apiClient.get('/thing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NETWORK_ERROR');
    expect((error as ApiError).message).toMatch(/connection/i);
  });
});

describe('refresh on 401', () => {
  it('refreshes once and replays the original request', async () => {
    fetchMock
      .mockResolvedValueOnce(fail('UNAUTHENTICATED', 401))
      .mockResolvedValueOnce(ok({ refreshed: true }))
      .mockResolvedValueOnce(ok({ value: 'after refresh' }));

    await expect(apiClient.get('/resumes')).resolves.toEqual({ value: 'after refresh' });

    const paths = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(paths[1]).toContain('/auth/refresh');
    expect(paths[2]).toContain('/resumes');
  });

  it('gives up after one refresh instead of looping forever', async () => {
    fetchMock
      .mockResolvedValueOnce(fail('UNAUTHENTICATED', 401))
      .mockResolvedValueOnce(ok({ refreshed: true }))
      .mockResolvedValueOnce(fail('UNAUTHENTICATED', 401));

    await expect(apiClient.get('/resumes')).rejects.toMatchObject({ status: 401 });
    // Three calls total: original, refresh, retry. A fourth would mean a loop.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not attempt a refresh for /auth/ routes', async () => {
    fetchMock.mockResolvedValue(fail('UNAUTHENTICATED', 401, 'Email or password is incorrect.'));

    await expect(apiClient.post('/auth/login', {})).rejects.toMatchObject({ status: 401 });
    // A failed login must not try to refresh a session that never existed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares ONE refresh across concurrent 401s', async () => {
    // The regression that matters: five parallel queries each triggering their
    // own refresh would rotate the token five times, and rotation treats a
    // reused token as theft — so the server would revoke the family and sign
    // the user out. A normal page load must not look like an attack.
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('/auth/refresh')) return Promise.resolve(ok({ refreshed: true }));
      const callsSoFar = fetchMock.mock.calls.filter(
        (c) => !String(c[0]).includes('/auth/refresh'),
      ).length;
      return Promise.resolve(callsSoFar <= 3 ? fail('UNAUTHENTICATED', 401) : ok({ value: 'ok' }));
    });

    await Promise.all([
      apiClient.get('/a').catch(() => null),
      apiClient.get('/b').catch(() => null),
      apiClient.get('/c').catch(() => null),
    ]);

    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('allows a later refresh after an earlier one failed', async () => {
    // The in-flight promise is cleared in `finally`; without that, one failed
    // refresh would poison every subsequent attempt with a cached rejection.
    fetchMock
      .mockResolvedValueOnce(fail('UNAUTHENTICATED', 401))
      .mockResolvedValueOnce(fail('UNAUTHENTICATED', 401)) // refresh fails
      .mockResolvedValueOnce(fail('UNAUTHENTICATED', 401))
      .mockResolvedValueOnce(ok({ refreshed: true })) // second refresh succeeds
      .mockResolvedValueOnce(ok({ value: 'recovered' }));

    await expect(apiClient.get('/first')).rejects.toMatchObject({ status: 401 });
    await expect(apiClient.get('/second')).resolves.toEqual({ value: 'recovered' });
  });
});
