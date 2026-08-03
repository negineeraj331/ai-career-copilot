import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../../../lib/api-client.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { FormMessage } from '../../../components/feedback/States.js';
import { authApi } from '../api/auth.api.js';
import { useSetSession } from '../hooks/useSession.js';
import { AuthLayout } from '../components/AuthLayout.js';

/**
 * Request a reset link.
 *
 * The success message is identical whether or not the address exists — the API
 * answers the same way for the same enumeration reason, and a UI that said
 * "no account found" would hand back exactly what the API withheld.
 */
export function ForgotPasswordPage(): ReactNode {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch {
      // Even a failure shows the same confirmation: distinguishing them would
      // leak whether the address is registered.
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout title="Check your email">
        <FormMessage tone="info">
          If an account exists for {email || 'that address'}, we have sent a reset link. It expires
          in 30 minutes and can be used once.
        </FormMessage>
        <Link
          to="/login"
          className="mt-6 block text-center text-sm text-primary-500 hover:underline"
        >
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a link.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" loading={busy} fullWidth>
          Send reset link
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ResetPasswordPage(): ReactNode {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.resetPassword({ token, password });
      navigate('/login', { replace: true, state: { notice: 'password-reset' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset your password.');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout title="Link not valid">
        <FormMessage tone="error">
          That reset link is missing its token. Request a new one and try again.
        </FormMessage>
        <Link
          to="/forgot-password"
          className="mt-6 block text-center text-sm text-primary-500 hover:underline"
        >
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="You will be signed out everywhere else.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          hint="At least 12 characters."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" loading={busy} fullWidth>
          Set new password
        </Button>
      </form>
    </AuthLayout>
  );
}

export function VerifyEmailPage(): ReactNode {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<'working' | 'done' | 'failed'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('failed');
      setMessage('That verification link is missing its token.');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await authApi.verifyEmail(token);
        if (!cancelled) setStatus('done');
      } catch (err) {
        if (cancelled) return;
        setStatus('failed');
        setMessage(err instanceof ApiError ? err.message : 'That link is invalid or has expired.');
      }
    })();

    // Guards against React 18+ StrictMode double-invoking the effect in
    // development, which would otherwise fire the single-use token twice and
    // make the second call fail in front of the user.
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <AuthLayout title={status === 'done' ? 'Email verified' : 'Verifying your email'}>
      {status === 'working' && <FormMessage tone="info">One moment…</FormMessage>}
      {status === 'done' && (
        <>
          <FormMessage tone="success">Your email is verified. You can sign in now.</FormMessage>
          <Link
            to="/login"
            className="mt-6 block text-center text-sm text-primary-500 hover:underline"
          >
            Continue to sign in
          </Link>
        </>
      )}
      {status === 'failed' && (
        <>
          <FormMessage tone="error">{message}</FormMessage>
          <Link
            to="/login"
            className="mt-6 block text-center text-sm text-primary-500 hover:underline"
          >
            Back to sign in
          </Link>
        </>
      )}
    </AuthLayout>
  );
}

export function MagicLinkPage(): ReactNode {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      await authApi.requestMagicLink(email);
    } finally {
      setSent(true);
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout title="Check your email">
        <FormMessage tone="info">
          If an account exists for that address, we have sent a sign-in link. It expires in 10
          minutes and can be used once.
        </FormMessage>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Sign in with a link" subtitle="No password needed.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button type="submit" loading={busy} fullWidth>
          Email me a link
        </Button>
        <Link to="/login" className="text-center text-sm text-primary-500 hover:underline">
          Use a password instead
        </Link>
      </form>
    </AuthLayout>
  );
}

export function MagicLinkVerifyPage(): ReactNode {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setSession = useSetSession();
  const token = params.get('token') ?? '';
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('That link is missing its token.');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const result = await authApi.verifyMagicLink(token);
        if (cancelled) return;

        if (result.mfaRequired && result.mfaToken) {
          navigate('/mfa', { replace: true, state: { mfaToken: result.mfaToken } });
          return;
        }
        if (result.user) {
          setSession(result.user);
          navigate('/dashboard', { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'That link is invalid or has expired.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, navigate, setSession]);

  return (
    <AuthLayout title="Signing you in">
      {error ? (
        <>
          <FormMessage tone="error">{error}</FormMessage>
          <Link
            to="/magic-link"
            className="mt-6 block text-center text-sm text-primary-500 hover:underline"
          >
            Request a new link
          </Link>
        </>
      ) : (
        <FormMessage tone="info">One moment…</FormMessage>
      )}
    </AuthLayout>
  );
}
