# Plan: R22-M8 Built-in validation plugin path resolver hardening

- status: done
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: code

## Goal
- Ensure built-in validation plugin path rewriting only converts the provider package's own final `src/plugin.ts`-style path to `dist/plugin.mjs`, without rewriting ancestor directories such as `/usr/src/app`.

## Definition of Done
- API and Worker startup use a resolver helper exported from `@nexus-form/integrations`.
- The helper leaves existing `dist/plugin.mjs` paths unchanged.
- Unit tests cover deployment paths containing ancestor `/src/`.
- Required validation passes: `pnpm lint:fix`, `pnpm type-check`, and `pnpm test --silent` or the documented fallback.
- Independent Reviewer approves the change.

## Scope / Non-goals
- Scope:
  - `apps/api/src/index.ts`
  - `apps/worker/src/index.ts`
  - `packages/integrations/src/startup.ts`
  - `packages/integrations/src/index.ts`
  - `packages/integrations/src/__tests__/startup.test.ts`
  - `docs/coding-agent/plans/active/r22-m8-builtin-validation-plugin-path-resolver-plan.md`
- Non-goals:
  - Validation provider build config changes.
  - External plugin directory loading changes.
  - Dependency additions.
  - Shared `docs/coding-agent/lessons.md` changes.

## Context (workspace)
- Related files/areas:
  - `packages/integrations/src/startup.ts`
  - `packages/integrations/src/__tests__/startup.test.ts`
  - `apps/api/src/index.ts`
  - `apps/worker/src/index.ts`
- Existing patterns or references:
  - Researcher reported `normalizeBuiltinPluginPath()` is already in `packages/integrations/src/startup.ts` and exported via `packages/integrations/src/index.ts`.
  - Researcher reported API and Worker already import and call that helper.
- Repo reference docs consulted:
  - `AGENTS.md` prompt instructions.
  - `$orchestration-harness`, `$plan-format`, `$subagent-strategy`, `$engineering-quality-baselines`, `$git-workflow`.
  - `docs/coding-agent/rules/` is absent in this worktree.

## Open Questions
- None.

## Assumptions
- The built-in plugin entry remains the provider package root `src/plugin.ts` during local source execution.
- Production package resolution can already return `dist/plugin.mjs`, which must remain unchanged.

## Tasks

### Task_1: Confirm and harden shared resolver
- type: impl
- owns:
  - `packages/integrations/src/startup.ts`
  - `packages/integrations/src/index.ts`
- depends_on: []
- description: |
  Confirm or implement a shared resolver helper that rewrites only final package-local `src` plugin files and leaves production `dist/plugin.mjs` paths untouched.
- acceptance:
  - The resolver helper is in `packages/integrations`.
  - The helper does not use an unanchored `(.*)/src/` replacement.
  - `dist/plugin.mjs` input returns unchanged.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `rtk pnpm --filter @nexus-form/integrations test`

### Task_2: Use shared resolver in API and Worker startup
- type: impl
- owns:
  - `apps/api/src/index.ts`
  - `apps/worker/src/index.ts`
- depends_on: [Task_1]
- description: |
  Ensure both runtime entrypoints resolve built-in plugin specifiers with `import.meta.resolve()` and pass the file path through the shared integrations resolver.
- acceptance:
  - API startup uses `normalizeBuiltinPluginPath` from `@nexus-form/integrations`.
  - Worker startup uses `normalizeBuiltinPluginPath` from `@nexus-form/integrations`.
  - No local duplicate `/src/` rewrite remains in either entrypoint.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `rtk pnpm --filter @nexus-form/api type-check` and `rtk pnpm --filter @nexus-form/worker type-check`

### Task_3: Add ancestor `/src/` regression tests
- type: test
- owns:
  - `packages/integrations/src/__tests__/startup.test.ts`
- depends_on: [Task_1]
- description: |
  Add or verify unit tests that cover `/usr/src/app/...` production and source-like paths so ancestor `/src/` segments are not rewritten.
- acceptance:
  - `/usr/src/app/.../dist/plugin.mjs` remains unchanged.
  - `/usr/src/app/.../src/plugin.ts` rewrites to `/usr/src/app/.../dist/plugin.mjs`.
  - A nested source path that is not the final package entry is unchanged, if relevant to the helper behavior.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `rtk pnpm --filter @nexus-form/integrations test`

### Task_4: Independent review and full validation
- type: review
- owns: []
- depends_on: [Task_1, Task_2, Task_3]
- description: |
  Run required repo validation and dispatch an independent Reviewer to verify the diff, acceptance criteria, and evidence.
- acceptance:
  - Required repo commands pass or documented fallback passes.
  - Reviewer status is APPROVED.
  - Any Reviewer findings are resolved before PR.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `rtk pnpm lint:fix`
  - kind: command
    required: true
    owner: orchestrator
    detail: `rtk pnpm type-check`
  - kind: command
    required: true
    owner: orchestrator
    detail: `rtk pnpm test --silent` or `rtk pnpm test -- --silent` if Turbo rejects the first form
  - kind: review
    required: true
    owner: reviewer
    detail: Independent Reviewer approval

## Task Waves
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2, Task_3]
- Wave 3 (parallel): [Task_4]

## Rollback / Safety
- Revert the resolver helper/test/startup import changes in one commit if validation reveals an incompatible path assumption.

## Progress Log
- 2026-06-01 00:00 Wave 0 completed: Research
  - Summary: Researcher found helper/imports may already exist and identified tests to verify.
  - Validation evidence: read-only report from subagent `019e820b-e357-7531-a12c-5ed161dffa25`.
  - Notes: Repo-local `docs/coding-agent/rules/` is absent.
- 2026-06-01 16:42 Wave 1-2 completed: [Task_1, Task_2, Task_3]
  - Summary: Confirmed shared resolver is already exported from integrations and used by API/Worker; added `/usr/src/app/.../src/plugin.ts` regression fixture.
  - Validation evidence: `rtk pnpm --filter @nexus-form/integrations test` passed; `rtk pnpm --filter @nexus-form/api type-check` passed; `rtk pnpm --filter @nexus-form/worker type-check` passed.
  - Notes: Existing `/usr/src/app/.../dist/plugin.mjs` fixture already covered production path.
- 2026-06-01 16:42 Wave 3 validation completed: [Task_4]
  - Summary: Required repository validation passed.
  - Validation evidence: `rtk pnpm lint:fix` passed; `rtk pnpm type-check` passed; `rtk pnpm test --silent` failed because Turbo rejected the argument; fallback `rtk pnpm test -- --silent` passed.
  - Notes: Independent Reviewer pending.
- 2026-06-01 16:43 Wave 3 review completed: [Task_4]
  - Summary: Independent Reviewer approved with no findings.
  - Validation evidence: Reviewer `019e8222-955a-7a83-9a0e-a609a36c1484` status `APPROVED`; Reviewer also reran `rtk pnpm --filter @nexus-form/integrations test` and passed.
  - Notes: Ready for commit and PR.

## Decision Log
- 2026-06-01 00:00 Decision: continue without explicit approval pause.
  - Trigger / new insight: User explicitly instructed this delegated thread to continue through implementation, PR, hook, and merge.
  - Plan delta: Treat user instruction as approval to proceed after plan creation.
  - Tradeoffs considered: Keep changes narrowly scoped and preserve required independent review.
  - User approval: yes.

## Notes
- Quality routing note:
  - Routing level: L1
  - In-scope docs: TypeScript/JavaScript, testing/validation baseline via repository instructions
  - Out-of-scope docs: UI/E2E/security/migration because no UI, auth, schema, or data migration is touched
  - Top risks: contract/path resolution
  - Risk profile: medium because startup path resolution affects API/Worker plugin loading
