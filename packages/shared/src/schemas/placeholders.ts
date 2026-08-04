/**
 * Unfilled placeholders in generated text.
 *
 * docs/11 §5 says the model writes an unknown figure as `[X]%` or `[N] users`
 * and lists it, and "the client enforces the other half" by disabling Accept
 * until each one is confirmed. A guarantee that lives only in the client is not
 * a guarantee — it is a convention that holds until someone writes a script, a
 * mobile client, or a bug.
 *
 * So the same detection runs on the server when a resume is saved. The rule is
 * blunt and deliberately so: a resume must never contain `[X]` in a bullet,
 * whatever produced it. The cost of the bluntness is that a user who genuinely
 * wants square brackets in their text is inconvenienced; the cost of the
 * alternative is an application sent to an employer reading "improved latency
 * by [X]%".
 */

/**
 * Matches a bracketed token that looks like a fill-in-the-blank: short, and
 * containing no lowercase prose. `[X]`, `[N]`, `[NUMBER]`, `[X]%` all match;
 * `[sic]`, `[note: revised]`, and `[2020-2024]` do not, because those are things
 * people legitimately write.
 */
const PLACEHOLDER = /\[[A-Z][A-Z0-9 _-]{0,14}\]/g;

export function findPlaceholders(text: string): string[] {
  return [...new Set(text.match(PLACEHOLDER) ?? [])];
}

export function hasPlaceholder(text: string): boolean {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(text);
}
