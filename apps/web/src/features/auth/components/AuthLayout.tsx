import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Shared shell for every auth screen: aurora background, glass card, and a
 *  consistent place for the heading and footer link. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}): ReactNode {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="aurora" aria-hidden="true" />

      <Link to="/" className="mb-8 text-lg font-semibold tracking-tight text-[var(--ink-primary)]">
        Career&nbsp;Copilot
      </Link>

      <main id="main" className="glass w-full max-w-md rounded-[var(--radius-xl)] p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-[var(--ink-primary)]">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-[var(--ink-secondary)]">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </main>

      {footer && <div className="mt-6 text-sm text-[var(--ink-secondary)]">{footer}</div>}
    </div>
  );
}
