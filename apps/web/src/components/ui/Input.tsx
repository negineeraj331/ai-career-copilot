import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  /** Required, deliberately. Making it optional guarantees that somebody
   *  eventually ships a placeholder-only field, which screen readers do not
   *  announce and which vanishes the moment the user types. */
  label: string;
  error?: string;
  hint?: string;
  rightSlot?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, rightSlot, className, required, ...rest },
  ref,
) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-[var(--ink-primary)]">
        {label}
        {required && (
          <span className="ml-1 text-[var(--color-status-critical)]" aria-hidden="true">
            *
          </span>
        )}
      </label>

      <div className="relative">
        <input
          ref={ref}
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          // Points at whichever helper text exists, so the error (or the hint)
          // is announced with the field rather than sitting silently beside it.
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            'w-full rounded-[var(--radius-sm)] border bg-[var(--surface-raised)] px-3 py-2.5',
            'text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)]',
            'transition-colors duration-[var(--duration-fast)]',
            error
              ? 'border-[var(--color-status-critical)]'
              : 'border-[var(--border-hairline)] focus:border-primary-500',
            rightSlot && 'pr-11',
            className,
          )}
          {...rest}
        />
        {rightSlot && (
          <div className="absolute inset-y-0 right-0 flex items-center pr-2">{rightSlot}</div>
        )}
      </div>

      {error ? (
        // `role="alert"` so the message is announced when it appears, not only
        // when the field is next focused.
        <p id={errorId} role="alert" className="text-sm text-[var(--color-status-critical)]">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-sm text-[var(--ink-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
