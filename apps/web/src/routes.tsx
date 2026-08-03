import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RedirectIfAuthenticated, RequireAuth } from './features/auth/components/RequireAuth.js';
import { Skeleton } from './components/feedback/States.js';

/**
 * Every route is lazy-loaded (docs/08).
 *
 * A signed-out visitor on the landing page should not download the dashboard,
 * and nobody should download the editor until they open one — that is what
 * keeps the initial bundle inside the 250 KB budget as Phase 1 lands.
 */
const LandingPage = lazy(() =>
  import('./features/marketing/LandingPage.js').then((m) => ({ default: m.LandingPage })),
);
const LoginPage = lazy(() =>
  import('./features/auth/pages/LoginPage.js').then((m) => ({ default: m.LoginPage })),
);
const RegisterPage = lazy(() =>
  import('./features/auth/pages/RegisterPage.js').then((m) => ({ default: m.RegisterPage })),
);
const MfaPage = lazy(() =>
  import('./features/auth/pages/MfaPage.js').then((m) => ({ default: m.MfaPage })),
);
const DashboardPage = lazy(() =>
  import('./features/dashboard/DashboardPage.js').then((m) => ({ default: m.DashboardPage })),
);

const passwordPages = () => import('./features/auth/pages/PasswordPages.js');
const ForgotPasswordPage = lazy(() =>
  passwordPages().then((m) => ({ default: m.ForgotPasswordPage })),
);
const ResetPasswordPage = lazy(() =>
  passwordPages().then((m) => ({ default: m.ResetPasswordPage })),
);
const VerifyEmailPage = lazy(() => passwordPages().then((m) => ({ default: m.VerifyEmailPage })));
const MagicLinkPage = lazy(() => passwordPages().then((m) => ({ default: m.MagicLinkPage })));
const MagicLinkVerifyPage = lazy(() =>
  passwordPages().then((m) => ({ default: m.MagicLinkVerifyPage })),
);

function RouteFallback(): ReactNode {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-12">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export function AppRoutes(): ReactNode {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />

        {/* A signed-in user landing on /login should go to the app, not see a
            form asking them to sign in again. */}
        <Route element={<RedirectIfAuthenticated />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/magic-link" element={<MagicLinkPage />} />
        </Route>

        {/* Token-consuming routes stay reachable either way: they are how a
            session gets established or repaired. */}
        <Route path="/mfa" element={<MfaPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/magic-link/verify" element={<MagicLinkVerifyPage />} />
        <Route path="/auth/mfa" element={<MfaPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<DashboardPage />} />
        </Route>

        <Route path="*" element={<LandingPage />} />
      </Routes>
    </Suspense>
  );
}
