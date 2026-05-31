# R22-M3/R22-M8 Env And Plugin Startup Plan

## Context

- Task source: `z/tasks.md` R22-M3 and R22-M8.
- User approval: waived because the delegation explicitly requests implementation through PR/review/merge if possible.
- Repo rule suite: absent in this worktree; following AGENTS/CLAUDE and harness skill guidance.

## Task_1

- type: impl
- owns:
  - `apps/api/src/load-env.ts`
  - `apps/worker/src/load-env.ts`
  - `packages/shared/src/node/load-env.ts`
  - `packages/shared/package.json`
- depends_on: []
- acceptance:
  - API and Worker use one shared synchronous dotenv loader.
  - The loader does not use top-level await or dynamic `await import("dotenv")`.
  - `dotenv` resolves from the calling app module so package dependency ownership stays in API/Worker.
  - Non-production missing dotenv remains a warning-only startup path.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `pnpm --filter @nexus-form/api test -- load-env-invariant`
  - kind: command
    required: true
    owner: orchestrator
    detail: full repo `pnpm lint:fix`, `pnpm type-check`, `pnpm test --silent`

## Task_2

- type: test
- owns:
  - `packages/integrations/src/startup.ts`
  - `packages/integrations/src/__tests__/startup.test.ts`
  - `apps/api/src/index.ts`
  - `apps/worker/src/index.ts`
- depends_on: []
- acceptance:
  - Built-in plugin path normalization is centralized in integrations.
  - Production `.mjs` paths are left unchanged even when an ancestor path includes `/src/`.
  - Local `.ts` plugin paths under a package final `src` segment resolve to `dist/*.mjs`.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `pnpm --filter @nexus-form/integrations test -- startup`
  - kind: review
    required: true
    owner: reviewer
    detail: independent sub-agent review finds no required fixes

## Task Waves

- Wave 1: Task_1, Task_2
- Wave 2: Reviewer pass, gh-review-hook, PR follow-up

## Progress Log

- Created plan and started Researcher context collection.
- Implemented shared synchronous dotenv loader and switched API/Worker entrypoint loaders to use it.
- Added shared loader tests and extended env loading invariant coverage.
- Added built-in plugin path regression coverage for production paths under ancestor `/src/`.
- Validation completed: `pnpm lint:fix`, `pnpm type-check`, focused package tests, API tests with `--maxWorkers=1`, and full repo test with `TURBO_CONCURRENCY=1`.
- Reviewer completed with `APPROVED` and no required fixes.

## Decision Log

- 2026-05-31: User approval wait waived because requested workflow includes implementation, validation, PR, review hook, and merge attempt.
- 2026-05-31: Plain `pnpm test -- --silent` exposed an existing resource-sensitive API import hook timeout. Used `TURBO_CONCURRENCY=1 pnpm test -- --silent --maxWorkers=1` as the final full validation command; the same API suite passes in isolation with `--maxWorkers=1`.
