# Folder Structure — Career Copilot

**Last updated:** 2026-08-03

---

## 1. Repository root

```
career-copilot/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # lint, typecheck, test, build, scan
│   │   ├── deploy-staging.yml      # develop → staging
│   │   ├── deploy-production.yml   # main → production
│   │   └── codeql.yml              # scheduled static analysis
│   ├── ISSUE_TEMPLATE/
│   ├── dependabot.yml
│   └── pull_request_template.md
├── apps/
│   ├── api/                        # Express server + queue worker
│   └── web/                        # React SPA
├── packages/
│   ├── shared/                     # contracts: Zod schemas + inferred types
│   ├── ats/                        # deterministic scoring engine (pure)
│   ├── ai/                         # provider-agnostic AI layer
│   └── config/                     # shared eslint / tsconfig / tailwind presets
├── docs/                           # this documentation set
├── infra/
│   ├── docker/                     # Dockerfiles, nginx conf
│   ├── compose/                    # compose overrides per environment
│   └── grafana/                    # dashboards as code
├── scripts/                        # dev and ops scripts
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── eslint.config.js
├── .env.example
└── README.md
```

---

## 2. `apps/api`

```
apps/api/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── index.ts                    # HTTP entrypoint
│   ├── worker.ts                   # queue worker entrypoint (same image)
│   ├── app.ts                      # Express app assembly — no listen()
│   │
│   ├── config/
│   │   ├── env.ts                  # Zod-validated environment. Throws at boot.
│   │   └── constants.ts
│   │
│   ├── core/                       # framework-level concerns, no business logic
│   │   ├── errors/
│   │   │   ├── app-error.ts        # AppError hierarchy
│   │   │   └── handler.ts          # terminal error middleware
│   │   ├── http/
│   │   │   ├── envelope.ts         # success/error response shape
│   │   │   ├── async-handler.ts
│   │   │   └── validate.ts         # Zod middleware factory
│   │   ├── logger/
│   │   │   ├── logger.ts           # pino, with redaction
│   │   │   └── request-context.ts  # AsyncLocalStorage request ID
│   │   ├── security/
│   │   │   ├── helmet.ts
│   │   │   ├── cors.ts
│   │   │   ├── csrf.ts
│   │   │   ├── rate-limit.ts
│   │   │   └── sanitize.ts
│   │   ├── db/
│   │   │   ├── prisma.ts           # singleton client
│   │   │   └── transaction.ts
│   │   ├── redis/
│   │   │   ├── client.ts
│   │   │   └── cache.ts
│   │   └── queue/
│   │       ├── queues.ts           # queue definitions
│   │       └── register-workers.ts
│   │
│   ├── modules/                    # business logic, one folder per bounded context
│   │   ├── auth/
│   │   │   ├── auth.routes.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── auth.repository.ts
│   │   │   ├── auth.schemas.ts
│   │   │   ├── tokens.service.ts   # JWT + refresh rotation + families
│   │   │   ├── mfa.service.ts
│   │   │   ├── oauth/
│   │   │   │   ├── google.provider.ts
│   │   │   │   └── github.provider.ts
│   │   │   ├── audit.service.ts
│   │   │   └── __tests__/
│   │   ├── users/
│   │   ├── resumes/
│   │   │   ├── resumes.routes.ts
│   │   │   ├── resumes.controller.ts
│   │   │   ├── resumes.service.ts
│   │   │   ├── resumes.repository.ts
│   │   │   ├── versions.service.ts
│   │   │   ├── diff.service.ts
│   │   │   └── __tests__/
│   │   ├── jobs/
│   │   ├── analysis/
│   │   ├── ats/
│   │   ├── ai/
│   │   ├── exports/
│   │   ├── applications/
│   │   ├── interviews/
│   │   ├── notifications/
│   │   ├── admin/
│   │   └── health/
│   │
│   ├── middleware/
│   │   ├── authenticate.ts         # access token → actor
│   │   ├── authorize.ts            # role guard (resource checks live in services)
│   │   └── quota.ts
│   │
│   ├── jobs/                       # queue processors
│   │   ├── email.processor.ts
│   │   ├── export.processor.ts
│   │   ├── import.processor.ts
│   │   ├── embedding.processor.ts
│   │   └── cleanup.processor.ts
│   │
│   ├── services/                   # cross-cutting infrastructure adapters
│   │   ├── mailer/
│   │   ├── storage/
│   │   └── pdf/
│   │
│   └── utils/
│
├── tests/
│   ├── setup.ts
│   ├── helpers/                    # factories, auth helpers, db reset
│   └── integration/
├── Dockerfile
├── vitest.config.ts
├── tsconfig.json
└── package.json
```

### Layer rules — enforced in review

```
routes  →  controller  →  service  →  repository  →  Prisma
```

| Layer      | May do                                          | May **not** do                       |
| ---------- | ----------------------------------------------- | ------------------------------------ |
| Route      | Declare path, attach middleware, validate       | Contain logic                        |
| Controller | Parse request, call one service, shape response | Touch Prisma, contain business rules |
| Service    | Business logic, authorisation, orchestration    | Know about `req`/`res`               |
| Repository | Database access                                 | Contain business rules               |

A controller that imports Prisma is a review rejection. A service that imports `express` is a
review rejection. These two rules alone prevent most of the structural rot that turns a
monolith into a tangle.

**Cross-module access** goes through the other module's exported service, never its
repository. `analysis.service.ts` may call `resumesService.getById()`; it may not call
`resumesRepository`.

---

## 3. `apps/web`

```
apps/web/
├── public/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes.tsx                  # route definitions, lazy boundaries
│   │
│   ├── features/                   # organised by feature, not by file type
│   │   ├── auth/
│   │   │   ├── components/
│   │   │   ├── hooks/              # useLogin, useRegister, useSession
│   │   │   ├── api/                # typed API calls
│   │   │   ├── pages/
│   │   │   └── schemas.ts
│   │   ├── resume-editor/
│   │   │   ├── components/
│   │   │   │   ├── SectionForm/
│   │   │   │   ├── PreviewPane/
│   │   │   │   ├── AiPanel/
│   │   │   │   └── SectionReorder/
│   │   │   ├── hooks/
│   │   │   ├── store/              # editor-local Zustand slice
│   │   │   └── pages/
│   │   ├── analysis/
│   │   ├── dashboard/
│   │   ├── applications/
│   │   ├── interviews/
│   │   ├── templates/
│   │   ├── settings/
│   │   └── admin/
│   │
│   ├── components/                 # shared, feature-agnostic
│   │   ├── ui/                     # primitives: Button, Input, Dialog, Toast…
│   │   ├── charts/                 # ScoreMeter, TrendLine, Funnel, KeywordCloud
│   │   ├── layout/                 # AppShell, Sidebar, TopBar
│   │   └── feedback/               # EmptyState, ErrorState, Skeleton
│   │
│   ├── lib/
│   │   ├── api-client.ts           # fetch wrapper: credentials, CSRF, refresh-on-401
│   │   ├── query-client.ts         # TanStack Query configuration
│   │   ├── errors.ts
│   │   └── format.ts
│   │
│   ├── store/                      # global Zustand slices only
│   │   ├── auth.store.ts
│   │   ├── ui.store.ts
│   │   └── theme.store.ts
│   │
│   ├── hooks/                      # generic: useDebounce, useMediaQuery, useOnline
│   ├── styles/
│   │   ├── tokens.css              # design tokens as CSS custom properties
│   │   └── globals.css
│   └── types/
│
├── e2e/                            # Playwright
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── vitest.config.ts
└── package.json
```

### Frontend rules

- **Feature-first, not type-first.** Everything for the editor lives under
  `features/resume-editor/`. Grouping by file type (`all components/`, `all hooks/`) scatters
  a single change across the tree.
- A component graduates to `components/ui/` only when a **second** feature needs it. Premature
  sharing produces components with six props that do nothing well.
- `components/ui/` never imports from `features/`. Dependencies point one way.
- Every route is lazy-loaded. The editor, template renderers, and chart library are the three
  largest chunks and none of them belong in the initial bundle.

---

## 4. `packages/`

```
packages/shared/src/
├── schemas/
│   ├── resume.schema.ts            # versioned resume document schema
│   ├── auth.schema.ts
│   ├── job.schema.ts
│   ├── analysis.schema.ts
│   └── common.schema.ts
├── types/
├── constants/
└── index.ts

packages/ats/src/
├── engine.ts                       # composes rules → score
├── rules/
│   ├── parseability.rules.ts
│   ├── keyword.rules.ts
│   ├── formatting.rules.ts
│   ├── readability.rules.ts
│   └── completeness.rules.ts
├── rubric.ts                       # weights, rubric version, rule/outcome types
├── text.ts                         # shared text primitives, so two rules cannot
│                                   #   disagree about what counts as a bullet
└── __tests__/

packages/ai/src/
├── ai-service.ts                   # quota → cache → prompt → provider → validate → meter
├── providers/
│   ├── anthropic.provider.ts
│   ├── openai.provider.ts
│   └── mock.provider.ts            # deterministic fixtures for tests and offline dev
├── prompts/                        # versioned templates, one file each
├── schemas/                        # Zod schemas for every structured output
└── __tests__/
```

**`packages/ats` has no I/O and no dependencies beyond `packages/shared`.** That constraint is
what makes it a pure function library: instantly testable, trivially cacheable, and
impossible to make non-deterministic by accident.

### Dependency direction

```
apps/web  ──►  packages/shared
apps/api  ──►  packages/shared, packages/ats, packages/ai
packages/ats ──►  packages/shared
packages/ai  ──►  packages/shared
packages/shared ──►  (nothing)
```

No cycles. No package imports an app. Enforced by `eslint-plugin-import` boundary rules, so
a violation fails CI rather than relying on someone noticing in review.

---

## 5. Naming conventions

| Kind                 | Convention                  | Example                |
| -------------------- | --------------------------- | ---------------------- |
| React component file | PascalCase                  | `ScoreMeter.tsx`       |
| Hook                 | camelCase, `use` prefix     | `useResumeEditor.ts`   |
| Backend module file  | kebab-case with role suffix | `auth.service.ts`      |
| Test                 | mirrors subject             | `auth.service.test.ts` |
| Zod schema           | `*.schema.ts`               | `resume.schema.ts`     |
| Type/interface       | PascalCase, no `I` prefix   | `ResumeVersion`        |
| Constant             | SCREAMING_SNAKE             | `MAX_UPLOAD_BYTES`     |
| Database table       | PascalCase singular         | `ResumeVersion`        |
| Database column      | camelCase                   | `createdAt`            |
| API path             | kebab-case plural           | `/resume-versions`     |
| Env var              | SCREAMING_SNAKE             | `DATABASE_URL`         |
| Redis key            | `cc:{domain}:{id}`          | `cc:sess:01J…`         |
| Queue                | kebab-case                  | `resume-export`        |
