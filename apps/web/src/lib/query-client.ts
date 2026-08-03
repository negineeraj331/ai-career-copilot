import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client.js';

/**
 * TanStack Query owns all server state (docs/10 §2).
 *
 * Nothing fetched from the API is duplicated into Zustand — a second copy means
 * hand-written cache invalidation, which is a bug generator.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        // Never retry a 4xx: a 400 will be a 400 the second time, and retrying
        // a 401 fights the refresh logic in the API client.
        retry: (count, error) => {
          if (error instanceof ApiError && !error.isRetryable) return false;
          return count < 2;
        },
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        // Mutations are not idempotent by default. Where a retry is genuinely
        // safe, the endpoint takes an Idempotency-Key and opts in explicitly.
        retry: 0,
      },
    },
  });
}

/**
 * Query keys, built through one factory.
 *
 * Inline arrays drift — `['session']` here and `['auth','session']` there — and
 * an invalidation then silently misses. Going through the factory makes that
 * class of bug impossible.
 */
export const queryKeys = {
  auth: {
    all: ['auth'] as const,
    session: () => [...queryKeys.auth.all, 'session'] as const,
    sessions: () => [...queryKeys.auth.all, 'devices'] as const,
    auditLog: () => [...queryKeys.auth.all, 'audit'] as const,
    providers: () => [...queryKeys.auth.all, 'providers'] as const,
  },
  resumes: {
    all: ['resumes'] as const,
    list: () => [...queryKeys.resumes.all, 'list'] as const,
    detail: (id: string) => [...queryKeys.resumes.all, 'detail', id] as const,
    versions: (id: string) => [...queryKeys.resumes.all, 'versions', id] as const,
  },
} as const;
