/**
 * Vector similarity, and the lexical fallback that runs when there are no
 * vectors.
 *
 * The design point: matching must produce a defensible answer with **no**
 * embedding provider configured. Lexical matching catches the exact and
 * near-exact cases, which is most of them — a job asking for "Kubernetes"
 * against a resume that says "Kubernetes" needs no semantics. Embeddings are
 * additive, closing the gap on "Postgres" versus "PostgreSQL" and "CI/CD"
 * versus "continuous delivery".
 *
 * Building it the other way round — semantics first, lexical as a fallback —
 * would mean the product produces nothing useful until an embedding key exists,
 * and would hide a broken embedding path behind results that still look
 * plausible.
 */

/**
 * Cosine similarity of two vectors, in [-1, 1].
 *
 * Zero for a zero-magnitude vector rather than NaN: an all-zero embedding is a
 * provider failure, and NaN would propagate silently into a score the user is
 * shown.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalise(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Aliases that lexical matching would otherwise miss and that appear constantly
 * in real postings. Deliberately short: a large hand-maintained synonym table
 * is a second, worse embedding model that nobody updates. Anything beyond this
 * is what the vectors are for.
 */
const ALIASES: Record<string, string[]> = {
  postgresql: ['postgres', 'psql'],
  javascript: ['js', 'ecmascript'],
  typescript: ['ts'],
  kubernetes: ['k8s'],
  'continuous integration': ['ci'],
  'continuous delivery': ['cd', 'continuous deployment'],
  'machine learning': ['ml'],
  'amazon web services': ['aws'],
  'google cloud platform': ['gcp'],
  'user interface': ['ui'],
  'user experience': ['ux'],
  react: ['reactjs', 'react.js'],
  node: ['nodejs', 'node.js'],
  'rest api': ['rest', 'restful'],
};

function expand(term: string): string[] {
  const key = normalise(term);
  const forms = new Set<string>([key]);
  for (const alias of ALIASES[key] ?? []) forms.add(alias);
  for (const [canonical, aliases] of Object.entries(ALIASES)) {
    if (aliases.includes(key)) {
      forms.add(canonical);
      for (const a of aliases) forms.add(a);
    }
  }
  return [...forms];
}

/**
 * Does `haystack` evidence `term`?
 *
 * Substring rather than word-boundary matching, for the same reason the ATS
 * keyword rules use it: "Kubernetes" should match "kubernetes-based", and
 * "test" should match "testing". It over-matches occasionally, which is the
 * cheaper error — telling a user to add a skill they already list is worse than
 * a slightly generous match.
 */
export function lexicalMatch(haystack: string, term: string): boolean {
  const text = normalise(haystack);
  return expand(term).some((form) => form.length > 1 && text.includes(form));
}
