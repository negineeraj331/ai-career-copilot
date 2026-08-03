import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui/Button.js';

/**
 * Landing page.
 *
 * The hero animation is the product thesis in five seconds: a flat line of
 * resume text reorganising into structure. It reads as decoration but it is
 * the argument — the resume is data, not a document (ADR-005).
 *
 * Animated with CSS keyframes rather than Framer Motion. Measured: importing
 * Framer Motion here put 42 KB gzip into the landing page's critical path for
 * three staggered fade-ins — roughly a quarter of the entire JS budget for an
 * effect CSS does for nothing. Framer Motion stays a dependency for the Phase 1
 * work that needs interruptible, gesture-driven animation (the score meter, the
 * suggestion crossfade), where it earns its weight. The global
 * prefers-reduced-motion override in globals.css covers this automatically, so
 * there is no JS reduced-motion check to forget either.
 */
const BEFORE = 'Worked on website. Did some backend. Used React.';
const AFTER = [
  'Built a React storefront serving 15,000 monthly users',
  'Cut page load time 37% via code splitting',
  'Designed REST APIs in Node.js, 28% faster responses',
];

export function LandingPage(): ReactNode {
  return (
    <div className="relative min-h-dvh">
      <div className="aurora" aria-hidden="true" />

      <a
        href="#main"
        className="sr-only-focusable absolute left-4 top-4 z-10 rounded bg-primary-600 px-3 py-2 text-white"
      >
        Skip to content
      </a>

      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <span className="font-semibold tracking-tight">Career&nbsp;Copilot</span>
        <nav className="flex items-center gap-2">
          <Link to="/login">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link to="/register">
            <Button size="sm">Get started</Button>
          </Link>
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Your resume, judged the way a recruiter actually judges it.
          </h1>
          <p className="mt-5 text-lg text-[var(--ink-secondary)]">
            Paste a job description. See a match score with the reasoning behind every point, the
            skills you are missing, and the exact bullets holding you back.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register">
              <Button size="lg">Analyse my resume</Button>
            </Link>
            <Link to="/login">
              <Button size="lg" variant="secondary">
                I have an account
              </Button>
            </Link>
          </div>
        </div>

        <div className="glass mt-16 rounded-[var(--radius-xl)] p-6 sm:p-8">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)]">
            Before
          </p>
          <p className="mt-2 text-[var(--ink-secondary)] line-through decoration-[var(--color-status-critical)]/50">
            {BEFORE}
          </p>

          <p className="mt-6 text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)]">
            After
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {AFTER.map((line, index) => (
              <li
                key={line}
                style={{ animationDelay: `${String(0.15 * index + 0.2)}s` }}
                className="animate-rise flex gap-2 text-[var(--ink-primary)]"
              >
                <span aria-hidden="true" className="text-[var(--color-status-good)]">
                  ✓
                </span>
                {line}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
