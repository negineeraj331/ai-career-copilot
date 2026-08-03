import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicUser } from '@cc/shared';
import { ApiError } from '../../../lib/api-client.js';
import { queryKeys } from '../../../lib/query-client.js';
import { authApi } from '../api/auth.api.js';

/**
 * The current user is a *query*, not store state (docs/10 §1).
 *
 * Copying it into Zustand would create two sources of truth that drift the
 * moment a profile update lands. Everything that needs the user reads this.
 */
export function useSession() {
  const query = useQuery({
    queryKey: queryKeys.auth.session(),
    queryFn: async ({ signal }) => {
      try {
        return (await authApi.me(signal)).user;
      } catch (error) {
        // 401 is not an error here — it is the answer: nobody is signed in.
        // Letting it throw would put every logged-out visitor into an error
        // state and trigger pointless retries.
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  return {
    user: query.data ?? null,
    isLoading: query.isLoading,
    isAuthenticated: Boolean(query.data),
    error: query.error,
    refetch: query.refetch,
  };
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => authApi.logout(),
    // `onSettled`, not `onSuccess`: if the call fails because the session was
    // already dead, the local state is still stale and must be cleared. A user
    // who clicks "sign out" must end up signed out either way.
    onSettled: () => {
      queryClient.setQueryData(queryKeys.auth.session(), null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth.all });
    },
  });
}

export function useSetSession() {
  const queryClient = useQueryClient();
  return (user: PublicUser) => {
    // Seed the cache from the login response so the app does not immediately
    // re-request a user it was just handed.
    queryClient.setQueryData(queryKeys.auth.session(), user);
  };
}
