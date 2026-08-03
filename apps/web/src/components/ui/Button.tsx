import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 disabled:bg-primary-300',
  secondary:
    'bg-[var(--surface-raised)] text-[var(--ink-primary)] border border-[var(--border-hairline)] hover:bg-[var(--surface-card)]',
  ghost: 'bg-transparent text-[var(--ink-secondary)] hover:bg-[var(--surface-card)]',
  danger: 'bg-[var(--color-status-critical)] text-white hover:opacity-90',
};

// Minimum 44px touch target comes from padding, not font size (NFR-30).
const SIZES: Record<Size, string> = {
  sm: 'text-sm px-3 py-2 min-h-9',
  md: 'text-sm px-4 py-2.5 min-h-11',
  lg: 'text-base px-6 py-3 min-h-12',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    fullWidth,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // `aria-disabled` alongside `disabled` keeps the button reachable by
      // screen readers, so an explanatory tooltip is still announced. A
      // pointer-events:none button is invisible to assistive technology.
      aria-disabled={disabled || loading}
      aria-busy={loading}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium',
        'transition-colors duration-[var(--duration-fast)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        // Fixed-size spinner in the icon slot: swapping content for a spinner
        // would change the button's width mid-click and move the target out
        // from under the cursor.
        <span
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : (
        leftIcon
      )}
      {children}
    </button>
  );
});
