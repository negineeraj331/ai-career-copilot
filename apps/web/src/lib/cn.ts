/**
 * Minimal class-name joiner.
 *
 * Deliberately not `clsx` + `tailwind-merge`: two dependencies for something
 * this small is weight the bundle budget does not need to carry. It does not
 * de-duplicate conflicting Tailwind classes, so components put variant classes
 * first and let a caller's `className` come last — later classes win when
 * specificity ties, which is the ordering these components rely on.
 *
 * Accepts `unknown` rather than a narrow union on purpose. `someNode && 'cls'`
 * evaluates to `0` when `someNode` is `0` — the same React footgun that renders
 * a stray zero — and a narrow signature would reject that at the call site
 * instead of simply ignoring it here.
 */
export function cn(...values: unknown[]): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value !== '')
    .join(' ');
}
