import { createHash } from 'node:crypto';

/**
 * A stable SHA-256 over a resume document.
 *
 * The point is coalescing: autosave (slice 1.3) fires on a timer, so most saves
 * arrive carrying content identical to what is already stored. Without a hash
 * every one of those appends a version row and a user's history becomes an
 * unreadable list of a hundred identical entries.
 *
 * `JSON.stringify` alone cannot do this. Its output follows insertion order, so
 * two objects that are equal in every meaningful sense hash differently purely
 * because one arrived from a form and the other from the database:
 *
 *   JSON.stringify({ a: 1, b: 2 })  !==  JSON.stringify({ b: 2, a: 1 })
 *
 * So keys are sorted at every level before serialising. Arrays are NOT sorted —
 * order is meaningful in a resume, where moving a bullet to the top is a real
 * edit that must produce a new version.
 */
export function canonicalise(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);

  // `typeof null === 'object'`, and Date/null must pass through untouched.
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();

  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    // Dropping undefined matches JSON.stringify's own behaviour for object
    // properties. Keeping it would make { a: 1 } and { a: 1, b: undefined }
    // hash differently despite serialising identically.
    if (source[key] === undefined) continue;
    sorted[key] = sortKeys(source[key]);
  }
  return sorted;
}

export function hashContent(content: unknown): string {
  return createHash('sha256').update(canonicalise(content)).digest('hex');
}
