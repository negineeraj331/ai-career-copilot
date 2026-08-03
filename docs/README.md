# Career Copilot — Documentation Index

Every document that defines what this product is, how it is built, and how it is
operated. Read them in the order below if you are new to the project.

| #   | Document                                                   | Purpose                                                                                       | Priority |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------- |
| 00  | [TRD.md](./00-TRD.md)                                      | Technical Requirements Document — the engineering contract that ties every other doc together | ★★★★★    |
| 01  | [PRD.md](./01-PRD.md)                                      | Product vision, personas, features, success metrics                                           | ★★★★★    |
| 02  | [SRS.md](./02-SRS.md)                                      | Functional and non-functional requirements, constraints                                       | ★★★★★    |
| 03  | [System Architecture](./03-system-architecture.md)         | Services, data flow, deployment topology                                                      | ★★★★★    |
| 04  | [UI/UX Design System](./04-ui-ux-design-system.md)         | Tokens, typography, spacing, components, motion                                               | ★★★★☆    |
| 05  | [Database Design](./05-database-design.md)                 | ER model, tables, indexes, migration policy                                                   | ★★★★☆    |
| 06  | [API Specification](./06-api-specification.md)             | REST endpoints, payloads, errors, versioning                                                  | ★★★★☆    |
| 07  | [User Flows](./07-user-flows.md)                           | Journey maps per feature                                                                      | ★★★★☆    |
| 08  | [Folder Structure](./08-folder-structure.md)               | Monorepo layout and module boundaries                                                         | ★★★★☆    |
| 09  | [Component Specification](./09-component-specification.md) | Reusable frontend components and their contracts                                              | ★★★☆☆    |
| 10  | [State Management Plan](./10-state-management.md)          | Server state, client state, caching, forms                                                    | ★★★☆☆    |
| 11  | [AI Prompt Design](./11-ai-prompt-design.md)               | System prompts, structured outputs, evaluation                                                | ★★★☆☆    |
| 12  | [Security Design](./12-security-design.md)                 | AuthN/AuthZ, crypto, threat model, controls                                                   | ★★★☆☆    |
| 13  | [Testing Strategy](./13-testing-strategy.md)               | Unit, integration, E2E, a11y, performance                                                     | ★★★☆☆    |
| 14  | [DevOps / CI-CD](./14-devops-cicd.md)                      | Pipelines, Docker, environments, rollback                                                     | ★★★☆☆    |
| 15  | [Monitoring & Logging](./15-monitoring-logging.md)         | Metrics, logs, traces, alerts, SLOs                                                           | ★★★☆☆    |
| 16  | [Coding Standards](./16-coding-standards.md)               | Naming, linting, commits, review rules                                                        | ★★★☆☆    |
| 17  | [Feature Roadmap](./17-feature-roadmap.md)                 | MVP → v1 → v2 → future                                                                        | ★★☆☆☆    |
| —   | [tracker.md](./tracker.md)                                 | Live build tracker: what is done, in progress, and blocked                                    | —        |

## Document conventions

- **Requirement IDs** are stable and referenced across documents. `FR-*` functional,
  `NFR-*` non-functional, `SEC-*` security, `AI-*` AI behaviour.
- **Status tags**: `PLANNED`, `IN PROGRESS`, `IMPLEMENTED`, `DEFERRED`.
- A document is the single source of truth for its domain. If code and doc disagree,
  that is a bug in one of them — fix both in the same pull request.
- Any change to an API contract, database table, or security control requires the
  corresponding document to be updated in the same PR. CI does not enforce this;
  code review does.

## Quick orientation

**What is this?** An AI career platform: import or write a resume, analyse it against a
real job description, get an ATS score with actionable fixes, generate tailored resumes
and cover letters, prepare for interviews, and track applications — with production-grade
authentication, CI/CD, and observability underneath.

**Why does it exist?** Resume builders format documents. They do not tell you whether you
will pass the screen. Career Copilot closes the loop between _what a job asks for_ and
_what your resume proves_.

**Stack**: TypeScript everywhere. React + Vite + Tailwind on the front, Express + Prisma +
PostgreSQL + Redis on the back, a provider-agnostic AI layer defaulting to Claude, Docker
and GitHub Actions for delivery.
