import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { loginSchema } from '@cc/shared';
import type { z } from 'zod';
import { ApiError, apiUrl } from '../../../lib/api-client.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { FormMessage } from '../../../components/feedback/States.js';
import { authApi } from '../api/auth.api.js';
import { useSetSession } from '../hooks/useSession.js';
import { AuthLayout } from '../components/AuthLayout.js';

export function LoginPage(): ReactNode {
  const navigate = useNavigate();
  const setSession = useSetSession();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    // Three generics, because `rememberMe` has a Zod default: the form's INPUT
    // type has it optional, the parsed OUTPUT has it required. Declaring only
    // one type makes the resolver and the submit handler disagree.
  } = useForm<z.input<typeof loginSchema>, unknown, z.output<typeof loginSchema>>({
    // The same schema the API validates against, imported from @cc/shared —
    // client and server validation cannot disagree because there is one of it.
    resolver: zodResolver(loginSchema),
    // onBlur, not onChange: validating every keystroke shows an error before
    // the user has finished typing, which reads as the form arguing with them.
    mode: 'onBlur',
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await authApi.login(values);

      if (result.mfaRequired && result.mfaToken) {
        // No session yet — the password is only the first factor. The token is
        // carried in router state rather than the URL so it never lands in
        // browser history or a shared link.
        navigate('/mfa', { state: { mfaToken: result.mfaToken } });
        return;
      }

      if (result.user) {
        setSession(result.user);
        navigate('/dashboard', { replace: true });
      }
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(
          error.code === 'ACCOUNT_LOCKED'
            ? 'Too many attempts. Please wait a few minutes and try again.'
            : error.message,
        );
        return;
      }
      setFormError('Something went wrong. Please try again.');
    }
  });

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Pick up where you left off."
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="font-medium text-primary-500 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && <FormMessage tone="error">{formError}</FormMessage>}

        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          error={errors.email?.message}
          {...register('email')}
        />

        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          error={errors.password?.message}
          {...register('password')}
        />

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-[var(--ink-secondary)]">
            <input
              type="checkbox"
              className="size-4 accent-primary-600"
              {...register('rememberMe')}
            />
            Remember me
          </label>
          <Link to="/forgot-password" className="text-sm text-primary-500 hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" loading={isSubmitting} fullWidth>
          Sign in
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-xs text-[var(--ink-muted)]">
        <span className="h-px flex-1 bg-[var(--border-hairline)]" />
        or
        <span className="h-px flex-1 bg-[var(--border-hairline)]" />
      </div>

      <div className="flex flex-col gap-2">
        {/* Plain anchors, not fetch: the OAuth handshake is a browser
            navigation to a third-party origin and cannot be an XHR. */}
        <Button
          variant="secondary"
          fullWidth
          onClick={() => {
            window.location.href = apiUrl('/auth/oauth/google');
          }}
        >
          Continue with Google
        </Button>
        <Button
          variant="secondary"
          fullWidth
          onClick={() => {
            window.location.href = apiUrl('/auth/oauth/github');
          }}
        >
          Continue with GitHub
        </Button>
        <Link
          to="/magic-link"
          className="mt-1 text-center text-sm text-primary-500 hover:underline"
        >
          Email me a sign-in link instead
        </Link>
      </div>
    </AuthLayout>
  );
}
