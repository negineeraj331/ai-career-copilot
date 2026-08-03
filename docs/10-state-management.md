# State Management Plan — Career Copilot

**Last updated:** 2026-08-03

---

## 1. The classification that drives every decision

Most state-management pain comes from putting server data in a client store and then
hand-writing cache invalidation. We avoid it by classifying state before choosing a tool.

| Kind                   | Definition                                                             | Tool                       | Examples                                                 |
| ---------------------- | ---------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------- |
| **Server state**       | Owned by the backend; the client holds a cached copy that can go stale | TanStack Query             | Resumes, analyses, applications, templates, session      |
| **Client state**       | Owned by the client; no server truth exists                            | Zustand                    | Theme, sidebar open, active editor pane, dismissed hints |
| **Form state**         | Transient input, alive only while the form is                          | React Hook Form            | Every form                                               |
| **URL state**          | Should survive refresh and be shareable                                | React Router search params | Filters, active tab, pagination cursor, selected version |
| **Ephemeral UI state** | Local to one component                                                 | `useState`                 | Hover, dropdown open, local toggles                      |

**Rule: server data never lands in Zustand.** If a `GET` produced it, TanStack Query owns it.
The one apparent exception — the current user — is still a query (`useSession`); the auth
store holds only derived client concerns.

---

## 2. Server state — TanStack Query

### Configuration

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // a minute of freshness kills most redundant refetches
      gcTime: 5 * 60_000,
      retry: (count, err) => !isClientError(err) && count < 2, // never retry a 4xx
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: { retry: 0 }, // mutations are not idempotent by default
  },
});
```

Retrying a 4xx is pointless — a 400 will be a 400 the second time — and retrying a mutation
risks duplicate side effects. Where a retry genuinely is safe (exports, AI generation), the
endpoint accepts an `Idempotency-Key` and the mutation opts in explicitly.

### Query key convention

Hierarchical, so invalidation can be as broad or narrow as needed:

```ts
const keys = {
  resumes: {
    all: ['resumes'] as const,
    lists: () => [...keys.resumes.all, 'list'] as const,
    list: (f: Filters) => [...keys.resumes.lists(), f] as const,
    details: () => [...keys.resumes.all, 'detail'] as const,
    detail: (id: string) => [...keys.resumes.details(), id] as const,
    versions: (id: string) => [...keys.resumes.detail(id), 'versions'] as const,
  },
};
```

`invalidateQueries({ queryKey: keys.resumes.all })` clears everything resume-related;
`keys.resumes.detail(id)` clears exactly one. Keys are always built through this factory —
never inline arrays, which drift and silently miss invalidations.

### Staleness by data type

| Data                   | `staleTime`    | Reasoning                                     |
| ---------------------- | -------------- | --------------------------------------------- |
| Session / current user | 5 min          | Changes rarely; refetched on focus            |
| Resume list            | 30 s           | Frequently mutated by the user themselves     |
| Resume detail          | 0              | The editor is the source of truth while open  |
| Analysis result        | `Infinity`     | Immutable once computed — pinned to a version |
| Templates              | 1 h            | Effectively static                            |
| Quota                  | 10 s           | Must feel live as AI actions are consumed     |
| Notifications          | 30 s + polling |                                               |

### Mutations and optimistic updates

Optimistic where the outcome is near-certain and the feedback should be instant; pessimistic
where it is not.

| Mutation                | Strategy                | Why                                                 |
| ----------------------- | ----------------------- | --------------------------------------------------- |
| Resume content edit     | Optimistic              | Local-first editing; the network is not in the loop |
| Accept AI suggestion    | Optimistic              | The text is already known client-side               |
| Delete resume           | Optimistic + undo toast | Reversible for 5 s before the request fires         |
| Application status drag | Optimistic              | Kanban must feel instantaneous                      |
| Create export           | Pessimistic             | Server assigns the job ID                           |
| Run analysis            | Pessimistic             | The result is the point; there is nothing to guess  |
| Login / register        | Pessimistic             | Never fake an auth success                          |

Every optimistic mutation implements the full contract — `onMutate` cancels in-flight queries
and snapshots, `onError` rolls back to the snapshot, `onSettled` invalidates. A partial
implementation is worse than none, because the UI silently diverges from the server.

---

## 3. Client state — Zustand

Three global stores, deliberately small.

```ts
// auth.store.ts — client-side auth concerns only, never the user object
interface AuthStore {
  status: 'unknown' | 'authenticated' | 'unauthenticated';
  mfaPending: { token: string; expiresAt: number } | null;
  setStatus(s: AuthStore['status']): void;
  setMfaPending(p: AuthStore['mfaPending']): void;
  reset(): void;
}

// ui.store.ts
interface UiStore {
  sidebarOpen: boolean;
  editorPanes: { form: number; preview: number; ai: number }; // persisted
  activeMobileTab: 'edit' | 'preview' | 'ai';
  dismissedHints: string[]; // persisted
  commandPaletteOpen: boolean;
}

// theme.store.ts
interface ThemeStore {
  theme: 'light' | 'dark' | 'system';
  resolved: 'light' | 'dark';
  reducedMotion: boolean; // OS preference, mirrored for JS-driven animation
}
```

The user object lives in the `useSession()` query, not here. Duplicating it into a store
creates two sources of truth that drift the moment a profile update lands.

`persist` middleware writes `theme`, `editorPanes`, and `dismissedHints` to `localStorage`,
with an explicit `version` and `migrate` so a shape change does not crash on stale storage.

### Editor-local store

The editor has one scoped store (not global) holding: the working document, a dirty flag,
undo/redo stacks, the selected section, and the pending-mutation queue. It is created per
editor mount and torn down on unmount, so navigating away cannot leak one resume's draft into
another's session.

Undo/redo is a bounded command stack (50 entries) of inverse patches rather than full
document snapshots — snapshots of a large resume on every keystroke would be megabytes of
retained memory.

---

## 4. Form state — React Hook Form

```ts
const form = useForm<ResumeSection>({
  resolver: zodResolver(sectionSchema), // the same schema the API validates against
  mode: 'onBlur',
  reValidateMode: 'onChange',
});
```

- Uncontrolled inputs: typing in one field does not re-render the form. This is what keeps the
  100 ms preview budget achievable in a form with 60+ inputs.
- The resolver uses the schema from `packages/shared`, so client and server validation cannot
  disagree. A rule change lands in one place.
- `mode: 'onBlur'` — validating on every keystroke shows an error before the user has finished
  typing, which reads as the form arguing with them.
- Server field errors map back onto fields via `setError`, so a 422 highlights the offending
  input rather than showing a detached banner.

---

## 5. URL state

Anything that should survive a refresh or be shareable lives in the URL:

```
/resumes?status=active&sort=updated&cursor=abc
/resumes/:id/edit?section=experience&version=12
/applications?status=INTERVIEW&company=acme
/analysis/:id?tab=recommendations
```

Managed with `useSearchParams` wrapped in typed hooks that parse through Zod — URL params are
untrusted input like any other, and a malformed `?version=` should produce a sensible default,
not a crash.

---

## 6. The editing data flow

This is the one flow where the layers interact closely, so it is specified explicitly:

```
keystroke
   │
   ▼
React Hook Form (uncontrolled) — no re-render outside the field
   │  onBlur / debounce 300 ms
   ▼
editor store: apply patch to working document, mark dirty, push inverse onto undo stack
   │
   ├──► PreviewPane re-renders from the working document      (< 100 ms, local)
   ├──► ATS score recomputed via packages/ats                 (< 50 ms, pure, in a worker)
   │
   ▼  2 s idle, or blur
autosave mutation (optimistic)
   │
   ├─ onMutate:  cancel in-flight resume queries, snapshot cache, write optimistic value
   ├─ onError:   restore snapshot, toast with retry, keep the edit in the local queue
   └─ onSettled: invalidate keys.resumes.detail(id) and .versions(id)
   │
   ▼
server writes a version if the content hash changed (coalesced to ≤ 1/min)
```

The ATS recomputation runs in a Web Worker. It is pure and takes ~10–50 ms, but on the main
thread during fast typing that is enough to drop frames.

**Offline:** the mutation queue persists to IndexedDB. A banner shows offline state, editing
continues uninterrupted, and the queue flushes in order on reconnect. Conflicts surface as a
`409` and open the diff modal.

---

## 7. Caching layers

| Layer                 | Location       | Lifetime            | Purpose                                        |
| --------------------- | -------------- | ------------------- | ---------------------------------------------- |
| Component memo        | React          | Render              | Avoid recomputing derived values               |
| Query cache           | TanStack Query | 5 min gc            | Avoid refetching                               |
| Persisted client      | IndexedDB      | Until sync          | Offline edits, draft recovery                  |
| HTTP cache            | Browser        | Per `Cache-Control` | Static assets, templates                       |
| Server response cache | Redis          | 5 min – 24 h        | Expensive reads                                |
| AI result cache       | Redis          | 24 h                | Keyed on template version + input hash + model |
| Embedding cache       | Postgres       | Permanent           | Keyed on content hash — never recompute        |
| CDN                   | Cloudflare     | Per header          | Static assets                                  |

The AI and embedding caches are the ones that matter financially: re-analysing an unchanged
resume against an unchanged JD must cost nothing, and content-hash keys are what guarantee it.

---

## 8. Anti-patterns we explicitly reject

- **Server data in Zustand.** Manual cache invalidation is a bug generator; TanStack Query
  already solved it.
- **A global store for everything.** Most state is local. Global state is a cost — it makes
  components non-portable and renders harder to reason about.
- **`useEffect` for data fetching.** Race conditions, no dedup, no caching, no retry. Use a query.
- **Deriving state into state.** Compute during render; do not mirror a computed value into
  `useState` and then keep it in sync with an effect.
- **Controlled inputs on large forms.** Every keystroke re-rendering a 60-field form is exactly
  the thing that breaks the editor's latency budget.
- **`localStorage` for tokens.** See [ADR-007](./00-TRD.md#adr-007--cookies-not-localstorage-for-tokens).
- **Prop drilling past two levels.** Compose, use context, or colocate — do not thread a prop
  through five components that do not care about it.
