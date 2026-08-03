/**
 * Conventional Commits (docs/16 §8).
 *
 * Enforced by a hook rather than by review, because a commit message cannot be
 * fixed after the fact without rewriting history — catching it at write time is
 * the only cheap moment.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    // The body carries the reasoning, so it needs room. 100 is the default and
    // is routinely too tight for an explanation worth writing.
    'body-max-line-length': [1, 'always', 120],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
  },
};
