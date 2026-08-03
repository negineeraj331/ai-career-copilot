import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/node_modules/**', '**/*.d.ts'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      // No `any` in committed code. Where a third-party type forces it, disable
      // this rule on that line with a comment explaining why. See docs/16 §2.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // Default exports rename freely at each import site, which breaks search
      // and refactoring. Named exports only (frameworks that demand a default
      // override this in their own config block).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Use named exports. See docs/16-coding-standards.md §4.',
        },
      ],

      // console.log in committed code loses structure and bypasses redaction.
      'no-console': ['error', { allow: ['warn', 'error'] }],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': 'error',
    },
  },

  // ── Layer boundaries (docs/08 §2) ──────────────────────────────────────────
  // A controller that imports Prisma, or a service that imports express, is a
  // review rejection. Making it a lint error means CI catches it first.
  {
    files: ['apps/api/src/modules/**/*.controller.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message: 'Controllers must not touch the database. Go through the service layer.',
            },
          ],
          patterns: [
            {
              group: ['**/core/db/**', '**/*.repository'],
              message: 'Controllers must not touch repositories. Go through the service layer.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/modules/**/*.service.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'express',
              message: 'Services must not know about HTTP. Keep req/res in the controller.',
            },
          ],
        },
      ],
    },
  },

  // Pure function library: no I/O, no dependencies beyond @cc/shared. That
  // constraint is what keeps ATS scoring deterministic and instantly testable.
  {
    files: ['packages/ats/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@prisma/client', message: 'packages/ats must stay pure — no I/O.' },
            { name: 'ioredis', message: 'packages/ats must stay pure — no I/O.' },
            { name: 'node:fs', message: 'packages/ats must stay pure — no I/O.' },
          ],
        },
      ],
    },
  },

  // ── Frontend ───────────────────────────────────────────────────────────────
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      // XSS: the single sanitised exception is documented in docs/12 §4.
      'no-restricted-properties': [
        'error',
        {
          property: 'dangerouslySetInnerHTML',
          message: 'Banned. See docs/12-security-design.md §4 for the one sanitised exception.',
        },
      ],
    },
  },

  // Tests may use default exports, console, and loose typing on fixtures.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**', '**/__tests__/**'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // Config files run in Node and often need default exports.
  {
    files: ['**/*.config.{ts,js}', 'eslint.config.js'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // Must stay last: turns off every rule Prettier owns.
  prettier,
);
