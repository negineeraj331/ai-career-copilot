import { useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../../../lib/api-client.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { FormMessage } from '../../../components/feedback/States.js';
import { authApi } from '../api/auth.api.js';
import { useSetSession } from '../hooks/useSession.js';
import { AuthLayout } from '../components/AuthLayout.js';

export function MfaPage(): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const setSession = useSetSession();

  const mfaToken = (location.state as { mfaToken?: string } | null)?.mfaToken;

  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Arriving here directly means there is no half-completed login to finish.
  if (!mfaToken) return <Navigate to="/login" replace />;

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result = await authApi.verifyMfa(
        useRecovery
          ? { mfaToken: mfaToken as string, recoveryCode }
          : { mfaToken: mfaToken as string, code },
      );
      if (result.user) {
        setSession(result.user);
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      setAttempts((n) => n + 1);
      setError(err instanceof ApiError ? err.message : 'That code is not valid.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Two-factor authentication"
      subtitle={
        useRecovery
          ? 'Enter one of the recovery codes you saved when you set this up.'
          : 'Enter the 6-digit code from your authenticator app.'
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <FormMessage tone="error">{error}</FormMessage>}

        {useRecovery ? (
          <Input
            label="Recovery code"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            autoComplete="one-time-code"
            placeholder="XXXX-XXXX"
            required
            autoFocus
          />
        ) : (
          <Input
            label="Authentication code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            // `inputMode` + `one-time-code` lets phones offer the code from the
            // notification and show a numeric keypad.
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            required
            autoFocus
          />
        )}

        <Button type="submit" loading={busy} fullWidth>
          Verify
        </Button>
      </form>

      {/* Surfaced prominently only after two failures: someone whose phone is
          working should not be nudged toward burning a single-use code, but
          someone who has lost it needs the way out to be obvious. */}
      <button
        type="button"
        onClick={() => {
          setUseRecovery((v) => !v);
          setError(null);
        }}
        className={
          attempts >= 2
            ? 'mt-4 w-full text-center text-sm font-medium text-primary-500 hover:underline'
            : 'mt-4 w-full text-center text-sm text-[var(--ink-muted)] hover:underline'
        }
      >
        {useRecovery
          ? 'Use an authenticator code instead'
          : 'Lost your device? Use a recovery code'}
      </button>
    </AuthLayout>
  );
}
