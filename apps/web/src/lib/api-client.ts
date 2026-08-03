import type { ErrorCode } from '@cc/shared';

/**
 * The single HTTP entry point.
 *
 * Nothing in the app calls `fetch` directly, so credentials, CSRF, the response
 * envelope, and refresh-on-401 are handled once rather than remembered in
 * dozens of places.
 */

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:54000';
const BASE = `${API_URL}/api/v1`;

export class ApiError extends Error {
  readonly code: ErrorCode | 'NETWORK_ERROR';
  readonly status: number;
  readonly details?: { field: string; message: string }[];
  readonly requestId?: string;

  constructor(params: {
    code: ApiError['code'];
    status: number;
    message: string;
    details?: ApiError['details'];
    requestId?: string;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
    this.requestId = params.requestId;
  }

  /** Retrying a 4xx gets the same 4xx. Only these are worth another attempt. */
  get isRetryable(): boolean {
    return this.status >= 500 || this.code === 'NETWORK_ERROR';
  }
}

function readCookie(name: string): string | undefined {
  // `cc_csrf` is the one cookie deliberately readable by JavaScript: the
  // double-submit pattern requires the client to echo it back in a header.
  // The session cookies are HttpOnly and invisible here, which is the point.
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(document.cookie);
  return match?.[1];
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: ErrorCode; message: string; details?: { field: string; message: string }[] };
  meta?: { requestId?: string };
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Internal: prevents a refresh loop. */
  _retried?: boolean;
}

/**
 * Single-flight refresh.
 *
 * A page that fires five queries at once will get five simultaneous 401s. Each
 * triggering its own refresh would rotate the token five times — and refresh
 * rotation treats a second use of a rotated token as theft, so the server would
 * revoke the whole family and sign the user out. Sharing one in-flight promise
 * is not an optimisation here; it is what stops a normal page load from looking
 * like an attack.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfHeaders(),
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Cleared in `finally` so a failed refresh does not poison every later
      // attempt with a cached rejection.
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

function csrfHeaders(): Record<string, string> {
  const token = readCookie('cc_csrf');
  return token ? { 'X-CSRF-Token': decodeURIComponent(token) } : {};
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, _retried = false } = options;

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      // Session cookies ride on this. Without it the browser sends nothing and
      // every authenticated request 401s for no visible reason.
      credentials: 'include',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...csrfHeaders(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError({
      code: 'NETWORK_ERROR',
      status: 0,
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  if (response.status === 204) return undefined as T;

  let envelope: Envelope<T>;
  try {
    envelope = (await response.json()) as Envelope<T>;
  } catch {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      status: response.status,
      message: 'The server returned an unreadable response.',
    });
  }

  if (response.ok && envelope.success) return envelope.data as T;

  const code = envelope.error?.code ?? 'INTERNAL_ERROR';

  // One refresh attempt, then give up. `_retried` is what makes it exactly one:
  // without it, an expired session would loop 401 → refresh → 401 forever.
  // `/auth/` paths are excluded so a failed login does not try to refresh a
  // session that was never established.
  if (response.status === 401 && !_retried && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, { ...options, _retried: true });
  }

  throw new ApiError({
    code,
    status: response.status,
    message: envelope.error?.message ?? 'Something went wrong.',
    details: envelope.error?.details,
    requestId: envelope.meta?.requestId,
  });
}

export const apiClient = {
  get: <T>(path: string, signal?: AbortSignal) => api<T>(path, { method: 'GET', signal }),
  post: <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body }),
};

/** Absolute URL for flows the browser must navigate to rather than fetch —
 *  the OAuth redirect cannot be an XHR. */
export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}
