# Coding Standards — Career Copilot

**Last updated:** 2026-08-03

---

## 1. Principles

1. **Code is read far more than it is written.** Optimise for the next person, who is
   probably you in four months with no memory of this.
2. **Explicit beats clever.** A clever one-liner that needs a comment to explain it should
   have been three obvious lines.
3. **Make illegal states unrepresentable.** A type that cannot express a broken state removes
   a whole class of tests.
4. **Comments explain why, never what.** The code says what. If it doesn't, fix the code.
5. **Consistency over personal preference.** Match the surrounding file even where you'd have
   written it differently. Formatting arguments are settled by Prettier, not in review.

---

## 2. TypeScript

### Strictness

`strict: true` plus `noUncheckedIndexedAccess`, `noImplicitOverride`, and
`noFallthroughCasesInSwitch` everywhere.

- **No `any`.** Use `unknown` and narrow. If a third-party type genuinely forces `any`, add a
  comment explaining why and confine it to the smallest possible scope.
- **No non-null assertion (`!`)** except immediately after a check the compiler cannot see,
  with a comment.
- **No `as` casts** to launder a type. Parse and narrow instead. `as const` and casts to a
  narrower literal type are fine.
- **`type` for unions and object shapes; `interface` only for extensible contracts** that
  something else implements.

### Practices

```ts
// ✗ boolean parameters at call sites are unreadable
createUser(email, password, true, false);

// ✓ named options object
createUser({ email, password, sendWelcome: true, requireVerification: false });
```

```ts
// ✗ a stringly-typed status invites typos the compiler can't catch
function setStatus(s: string) {}

// ✓ a union does
type ApplicationStatus = 'SAVED' | 'APPLIED' | 'OA' | 'INTERVIEW' | 'OFFER' | 'REJECTED';
```

- Derive types from Zod schemas rather than declaring them twice:
  `type Resume = z.infer<typeof resumeSchema>` — one source of truth, no drift.
- Prefer `readonly` for arrays and properties that should not be mutated.
- Exhaustive `switch` on unions with a `never` default, so adding a variant produces a
  compile error at every place that must handle it.

---

## 3. Naming

| Kind                              | Convention                             | Example                            |
| --------------------------------- | -------------------------------------- | ---------------------------------- |
| Variable, function                | camelCase                              | `resumeVersion`, `computeAtsScore` |
| Type, interface, class, component | PascalCase                             | `ResumeVersion`, `ScoreMeter`      |
| Constant                          | SCREAMING_SNAKE                        | `MAX_UPLOAD_BYTES`                 |
| Boolean                           | `is` / `has` / `can` / `should` prefix | `isVerified`, `canEdit`            |
| Async returning a promise         | verb phrase                            | `fetchResume`, not `resumeData`    |
| Event handler                     | `handle` prefix                        | `handleSubmit`                     |
| Handler prop                      | `on` prefix                            | `onSubmit`                         |
| Zod schema                        | `*Schema`                              | `resumeSchema`                     |
| React hook                        | `use` prefix                           | `useResumeEditor`                  |
| Backend file                      | kebab-case, role suffix                | `auth.service.ts`                  |
| React component file              | PascalCase                             | `ScoreMeter.tsx`                   |
| Test file                         | mirrors subject                        | `auth.service.test.ts`             |

Names say what a thing _is_, not what type it is: `resumes`, not `resumeArray`; `user`, not
`userObj`. And no abbreviations that aren't universal — `req`/`res`/`ctx`/`id` are fine,
`usrRsm` is not.

---

## 4. Functions and modules

- **One job per function.** If you need "and" to describe it, split it.
- **Fewer than 50 lines** as a guideline. Past that, ask what it's doing twice.
- **Maximum 3 positional parameters.** More becomes an options object.
- **Guard clauses over nesting.** Return early; keep the happy path at the left margin.
- **Pure where possible.** Push I/O to the edges; keep the logic in the middle testable.
- **Named exports only.** Default exports rename freely at each import site, which breaks
  search and refactoring. The one exception is where a framework demands it.

```ts
// ✓ guard clauses — the happy path is never buried
async function restoreVersion(resumeId: string, versionId: string, actor: Actor) {
  const resume = await resumeRepo.findById(resumeId);
  if (!resume) throw new NotFoundError('Resume not found.');
  if (resume.userId !== actor.id) throw new NotFoundError('Resume not found.');

  const version = await versionRepo.findById(versionId);
  if (!version || version.resumeId !== resumeId) throw new NotFoundError('Version not found.');

  return versionService.createFrom(version, actor);
}
```

---

## 5. React

- **Function components with hooks.** No class components.
- **Rules of hooks are absolute** — no conditional calls, no calls in loops.
- **Custom hooks for reusable logic**, not for cutting a component in half arbitrarily.
- **Keys are stable IDs**, never array indices — an index key corrupts state on reorder,
  which is exactly what our drag-and-drop section editor does.
- **`useMemo`/`useCallback` only with a measured reason.** They are not free; premature
  memoisation adds noise and hides the real bottleneck.
- **No `useEffect` for data fetching.** Use TanStack Query. Effects are for synchronising with
  something outside React.
- **No `dangerouslySetInnerHTML`** — enforced by lint. The single sanitised exception is
  documented in [Security §4](./12-security-design.md).
- Colocate a component's styles, tests, and types with the component.

---

## 6. Backend

- **Layers stay in their lane.** Controller → service → repository. A controller that imports
  Prisma is a review rejection; so is a service that imports `express`.
- **Cross-module access through the other module's exported service**, never its repository.
- **Errors are typed.** Throw `AppError` subclasses with a status, a stable machine code, and
  a safe user message. Never throw a bare string.
- **`async`/`await` throughout.** No raw `.then()` chains, no callbacks.
- **Every `await` on an external call has a timeout.**
- **Transactions for multi-write operations.** Any invariant spanning two writes needs one.
- **No business logic in middleware.** Middleware is for cross-cutting concerns only.

---

## 7. Comments and documentation

```ts
// ✗ says what the code already says
// increment the counter
counter++;

// ✓ says why, which the code cannot
// Coalesce snapshots to at most one per minute — without this, a fast typist
// generates hundreds of versions per editing session and the history UI becomes useless.
if (Date.now() - lastSnapshot < 60_000) return;
```

- TSDoc on every exported function in `packages/*`.
- `// TODO(username): description` — a TODO without an owner is litter.
- `// HACK:` requires an explanation and a ticket link.
- Delete commented-out code. Git remembers it; the file should not.

---

## 8. Git

### Conventional Commits

```
<type>(<scope>): <subject>

[body]

[footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

```
feat(auth): add TOTP multi-factor authentication

Implements RFC 6238 with ±1 window drift tolerance and ten single-use
recovery codes. Secrets are AES-256-GCM encrypted at rest.

Closes #42
```

Subject in the imperative ("add", not "added"), under 72 characters, no trailing period.
The body explains _why_, since the diff already shows _what_.

### Pull requests

- One logical change. A PR touching auth, styling, and the CI config is three PRs.
- Under ~400 lines of diff where possible — review quality falls off a cliff past that.
- Description covers: what changed, why, how it was tested, and any screenshots for UI.
- Self-review the diff before requesting review. Most review comments are things the author
  would have caught reading their own diff.
- Draft PRs for work in progress.

### Review

Reviewers check: correctness, security, tests (including failure paths), naming, and whether
the docs were updated. Reviewers do **not** check formatting — that is Prettier's job.

Comment conventions: `nit:` for optional polish, `question:` for genuine uncertainty, and
anything else is a change request. Being explicit about which is which saves a round trip.

---

## 9. Tooling

- **ESLint** flat config with `typescript-eslint`, `react-hooks`, `jsx-a11y`, and
  `import` boundary rules that enforce the package dependency graph.
- **Prettier** for all formatting. Never argued about.
- **Husky + lint-staged** pre-commit: format and lint the staged files only.
- **commitlint** on commit messages.
- Local hooks are a fast first pass, not the gate. CI is the gate, because hooks can be
  skipped with `--no-verify`.

---

## 10. Anti-patterns

| Don't                                | Do                                                  |
| ------------------------------------ | --------------------------------------------------- |
| `any` to silence the compiler        | `unknown` and narrow properly                       |
| Deeply nested conditionals           | Guard clauses, early returns                        |
| Magic numbers                        | Named constants                                     |
| Duplicated logic in three places     | Extract — after the third occurrence, not the first |
| Premature abstraction                | Wait for the pattern to prove itself                |
| Barrel files re-exporting everything | Explicit imports; barrels wreck tree-shaking        |
| `console.log` in committed code      | The structured logger                               |
| Swallowing errors (`catch {}`)       | Handle, or rethrow with context                     |
| Mutating props or arguments          | Return new values                                   |
| Business logic in a component        | Extract to a hook or service                        |
| A test asserting nothing meaningful  | Assert on behaviour that could actually break       |
