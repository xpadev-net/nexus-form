<!-- markdownlint-disable MD013 -->

# Plan: R22-M9 Autosave In-Flight Fallback

- status: done
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: code

## Goal

- Preserve autosave content that is already in-flight when unmount/navigation happens, without reintroducing R14-M2 keepalive duplicate sends or leaving stale fallback after normal success.

## Definition of Done

- In-flight autosave content has a fallback/retry safety net after unmount/navigation.
- Normal mutation success clears stale fallback for the same content.
- R14-M2 keepalive 409 double-send prevention remains intact.
- R16-H3 unsaved-state behavior for in-flight edits remains intact.
- Required validation and independent review pass.

## Scope / Non-goals

- Scope:
  - `apps/web/src/hooks/forms/use-form-content-autosave.ts`
  - `apps/web/src/hooks/forms/use-form-content-autosave.test.tsx`
  - harness plan artifact for this delegated workflow
- Non-goals:
  - API/backend save semantics.
  - UI changes.
  - Broader autosave refactors.
  - Shared `docs/coding-agent/lessons.md` updates unless a new durable lesson is required.

## Context (workspace)

- Related files/areas:
  - `apps/web/src/hooks/forms/use-form-content-autosave.ts`
  - `apps/web/src/hooks/forms/use-form-content-autosave.test.tsx`
- Existing patterns or references:
  - `docs/coding-agent/plans/completed/r14-m2-autosave-unmount-keepalive-plan.md`
  - `docs/coding-agent/plans/completed/r16-h3-editor-beforeunload-pending-local-edits-plan.md`
- Repo reference docs consulted:
  - `/Users/xpadev/.codex/RTK.md`
  - `$orchestration-harness`
  - `$plan-format`
- Repo rules:
  - `docs/coding-agent/rules` is absent, so validation is derived from project instructions and harness defaults.

## Open Questions

- None.

## Assumptions

- The delegated prompt explicitly authorizes implementation through PR and merge, so separate plan approval is waived.
- The fallback should be scoped to the in-flight value present during unmount/navigation and cleared by normal success for that value.

## Tasks

### Task_1: Add in-flight fallback safety

- type: impl
- owns:
  - `apps/web/src/hooks/forms/use-form-content-autosave.ts`
- depends_on: []
- description: |
  Add a safety net for the in-flight autosave value when the hook unmounts or navigation unloads while the normal mutation is still unresolved.
- acceptance:
  - In-flight value is retained for fallback/retry after unmount/navigation.
  - Normal mutation success removes stale fallback for the same value.
  - Cleanup does not send a keepalive request for in-flight-only content.
  - `hasUnsavedLocalEdits()` still treats in-flight saves as unsaved.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Reviewer verifies hook behavior against R14-M2/R16-H3 constraints."

### Task_2: Cover fallback and stale cleanup

- type: test
- owns:
  - `apps/web/src/hooks/forms/use-form-content-autosave.test.tsx`
- depends_on: [Task_1]
- description: |
  Add or update focused hook tests for the in-flight unmount/navigation window and normal success cleanup.
- acceptance:
  - Test covers debounce firing, mutation becoming in-flight, then unmount/navigation before mutation settles.
  - Test proves the in-flight content remains in localStorage fallback or resend target.
  - Test proves normal success clears stale fallback for the saved content.
  - Existing keepalive no-double-send and beforeunload unsaved tests still pass.
- validation:
  - kind: unit
    required: true
    owner: orchestrator
    detail: "`rtk pnpm --filter @nexus-form/web exec vitest run src/hooks/forms/use-form-content-autosave.test.tsx`"

### Task_3: Required repository validation

- type: chore
- owns: []
- depends_on: [Task_1, Task_2]
- description: |
  Run project-required checks after focused tests pass.
- acceptance:
  - Lint/fix completes.
  - Type check completes.
  - Silent test suite completes.
- validation:
  - kind: lint
    required: true
    owner: orchestrator
    detail: "`rtk pnpm lint:fix`"
  - kind: typecheck
    required: true
    owner: orchestrator
    detail: "`rtk pnpm type-check`"
  - kind: test
    required: true
    owner: orchestrator
    detail: "`rtk pnpm test -- --silent`"

### Task_4: Independent review

- type: review
- owns: []
- depends_on: [Task_1, Task_2, Task_3]
- description: |
  Run a Reviewer subagent after implementation and validation; fix any findings and repeat until approved.
- acceptance:
  - Reviewer status is APPROVED.
  - Any findings are fixed and re-reviewed.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent review of diff, tests, and validation evidence."

## Task Waves

- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]
- Wave 4 (parallel): [Task_4]

## Rollback / Safety

- Revert the hook and focused test changes as one logical change.
- Do not change parent worktree state.

## Progress Log

- 2026-06-01 20:15 Wave 0 started: [Research]
  - Summary: Researcher dispatched for read-only context on R22-M9, target hook, and nearest tests.
  - Validation evidence: Researcher identified the in-flight normal autosave failure/unload fallback gap and the R14-M2/R16-H3 regression tests to preserve.
  - Notes: Plan approval waived by explicit delegation prompt.
- 2026-06-01 20:21 Wave 1/2 completed: [Task_1, Task_2]
  - Summary: Added localStorage fallback for in-flight autosave content on unmount without keepalive duplication, and added focused tests for fallback retention and success cleanup.
  - Validation evidence: `rtk pnpm --filter @nexus-form/web exec vitest run src/hooks/forms/use-form-content-autosave.test.tsx` passed with 15 tests after building `@nexus-form/shared`.
  - Notes: First targeted test attempt failed because `@nexus-form/shared` had no generated `dist` in this fresh worktree; `rtk pnpm --filter @nexus-form/shared build` fixed the workspace state.
- 2026-06-01 20:22 Targeted regression validation completed: [Task_2]
  - Summary: Verified adjacent 409/merge and editor beforeunload tests.
  - Validation evidence: `rtk pnpm --filter @nexus-form/web exec vitest run src/hooks/forms/use-form-content-autosave-r12.test.tsx` passed with 2 tests; `rtk pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-editor-page.test.tsx` passed with 11 tests.
  - Notes: R14-M2 no keepalive duplicate behavior and R16-H3 in-flight unsaved semantics remain covered.
- 2026-06-01 20:32 Wave 3 completed: [Task_3]
  - Summary: Required repository validation completed.
  - Validation evidence: `rtk pnpm lint:fix` passed; `rtk pnpm type-check` passed; `rtk pnpm test -- --silent` passed.
  - Notes: `lint:fix` formatted one web file; full test completed with 15 successful Turbo tasks.
- 2026-06-01 20:33 Wave 4 completed: [Task_4]
  - Summary: Independent Reviewer approved the final diff.
  - Validation evidence: Reviewer status APPROVED with no findings; reviewer also ran `rtk git diff --check -- apps/web/src/hooks/forms/use-form-content-autosave.ts apps/web/src/hooks/forms/use-form-content-autosave.test.tsx docs/coding-agent/plans/completed/r22-m9-autosave-inflight-fallback-plan.md` successfully.
  - Notes: Completed Researcher and Reviewer processes were closed by the Orchestrator.

## Decision Log

- 2026-06-01 20:15 Decision: keep implementation local and narrow
  - Trigger / new insight: Delegation explicitly restricts the task to R22-M9 only.
  - Plan delta (what changed): Single hook/test slice; no UI, API, or shared lessons work unless required.
  - Tradeoffs considered: Broader autosave abstraction is unnecessary for the data-loss window.
  - User approval: waived by explicit delegation prompt.

## Notes

- Risks:
  - Persisting in-flight fallback too early can leave stale localStorage after normal success.
  - Sending in-flight content through keepalive can reintroduce duplicate 409 behavior.
- Edge cases:
  - Pending debounce fallback and in-flight fallback may both exist during cleanup; success handling must clear only stale fallback for the saved value.
