import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import { LIMITS, registerSchema, type RegisterInput } from '@cc/shared';
import { ApiError } from '../../../lib/api-client.js';
import { Button } from '../../../components/ui/Button.js';
import { Input } from '../../../components/ui/Input.js';
import { FormMessage } from '../../../components/feedback/States.js';
import { authApi } from '../api/auth.api.js';
import { AuthLayout } from '../components/AuthLayout.js';

export function RegisterPage(): ReactNode {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    mode: 'onBlur',
    defaultValues: { email: '', password: '', name: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const result = await authApi.register({
        email: values.email,
        password: values.password,
        name: values.name || undefined,
      });
      setSentTo(result.email);
    } catch (error) {
      if (error instanceof ApiError) {
        // Map field errors back onto their inputs so a 400 highlights the
        // offending field rather than showing a detached banner.
        if (error.details?.length) {
          for (const detail of error.details) {
            if (
              detail.field === 'password' ||
              detail.field === 'email' ||
              detail.field === 'name'
            ) {
              setError(detail.field, { message: detail.message });
            }
          }
          return;
        }
        setFormError(error.message);
        return;
      }
      setFormError('Something went wrong. Please try again.');
    }
  });

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" subtitle={`We sent a verification link to ${sentTo}.`}>
        <FormMessage tone="info">
          The link is valid for 24 hours. If it does not arrive, check your spam folder — you can
          request another from the sign-in page.
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
    <AuthLayout
      title="Create your account"
      subtitle="Free to start. No card required."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary-500 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError && <FormMessage tone="error">{formError}</FormMessage>}

        <Input
          label="Name"
          autoComplete="name"
          hint="Optional — used on your resume header."
          error={errors.name?.message}
          {...register('name')}
        />

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
          autoComplete="new-password"
          required
          // Length is the control with evidence behind it; there are
          // deliberately no composition rules to explain. See docs/12 §2.1.
          hint={`At least ${String(LIMITS.PASSWORD_MIN)} characters. A memorable phrase beats a short jumble.`}
          error={errors.password?.message}
          {...register('password')}
        />

        <Button type="submit" loading={isSubmitting} fullWidth>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
