import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../hooks/useSession.js';
import { Skeleton } from '../../../components/feedback/States.js';

/**
 * Route guard.
 *
 * This is convenience and UX, not security — every protected resource is
 * authorised again on the server, per request, against the acting user. A guard
 * that only lives in the client is a suggestion.
 */
export function RequireAuth(): ReactNode {
  const { isAuthenticated, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) {
    // A skeleton, not a redirect: redirecting while the session check is still
    // in flight bounces an authenticated user to /login on every hard refresh.
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Remember where they were headed so sign-in can return them there.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

/** The inverse: keep a signed-in user off the auth screens. */
export function RedirectIfAuthenticated(): ReactNode {
  const { isAuthenticated, isLoading } = useSession();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
