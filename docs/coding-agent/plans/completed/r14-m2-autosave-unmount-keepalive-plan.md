# Plan: R14-M2 Autosave Unmount Keepalive Duplicate 409 Regression

- status: done
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: code

## Goal

- Ensure unmount keepalive never duplicates a regular in-flight autosave PUT in a way that can leave already-saved content in `pendingSave:{formId}`.

## Definition of Done

- Unmount keepalive is limited to debounce-pending content, not in-flight content.
- A unit test covers unmount while an autosave PUT is in-flight and confirms no saved content remains in `pendingSave:{formId}`.
- R22-M9 in-flight loss is not expanded into this task; it is recorded as separate follow-up scope if observed.
- `rtk pnpm lint:fix`, `rtk pnpm type-check`, and the silent test suite pass.
- Independent Reviewer approves the final diff.

## Scope / Non-goals

- Scope:
  - `apps/web/src/hooks/forms/use-form-content-autosave.ts`
  - `apps/web/src/hooks/forms/use-form-content-autosave.test.tsx`
  - harness plan artifact for this delegated workflow
- Non-goals:
  - API optimistic lock behavior changes
  - UI changes
  - R22-M9 in-flight loss recovery design
  - Parent worktree `<project-root>`

## Context (workspace)

- Related files/areas:
  - `apps/web/src/hooks/forms/use-form-content-autosave.ts`
  - `apps/web/src/hooks/forms/use-form-content-autosave.test.tsx`
- Existing patterns or references:
  - Hook tests use jsdom, fake timers, mocked `useMutation`, mocked `fetch`, and memory `localStorage`.
  - Current implementation already keeps unmount keepalive scoped to `pendingValueRef.current`.
- Repo reference docs consulted:
  - `AGENTS.md` / `CLAUDE.md`
  - `$orchestration-harness`
  - `$plan-format`
  - `$subagent-strategy`
  - `$git-workflow`
  - `$improvement-loop`

## Open Questions

- None.

## Assumptions

- `z/tasks.md` is not present in this worktree, so the parent delegation text is the task source of truth.
- The existing R14-M2 implementation may already be present; this plan still requires verification and a reviewable branch diff.

## Tasks

### Task_1: Confirm Keepalive Scope

- type: impl
- owns:
  - `apps/web/src/hooks/forms/use-form-content-autosave.ts`
- depends_on: []
- description: |
  Confirm unmount cleanup saves only debounce-pending content and does not include `inFlightValueRef.current`.
- acceptance:
  - Cleanup uses `pendingValueRef.current` as the keepalive source.
  - In-flight autosave content is not sent via keepalive.
  - Existing pending fallback behavior remains intact for true debounce-pending content.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Reviewer verifies hook diff/current logic against R14-M2 acceptance."

### Task_2: Strengthen In-Flight Regression Coverage

- type: test
- owns:
  - `apps/web/src/hooks/forms/use-form-content-autosave.test.tsx`
- depends_on: [Task_1]
- description: |
  Keep the existing in-flight unmount regression focused on the bug sequence and assert that keepalive fetch is not called at all for in-flight content.
- acceptance:
  - Test covers change -> debounce fire -> mutation in-flight -> unmount -> regular success.
  - Test asserts `pendingSave:form-1` remains absent after regular success.
  - Test asserts no keepalive/fetch request is made for the in-flight value.
- validation:
  - kind: unit
    required: true
    owner: orchestrator
    detail: "rtk pnpm --filter @nexus-form/web exec vitest run src/hooks/forms/use-form-content-autosave.test.tsx"

### Task_3: Required Repository Validation

- type: chore
- owns:
  - validation only
- depends_on: [Task_1, Task_2]
- description: |
  Run required repository checks and record evidence.
- acceptance:
  - Lint/fix completes.
  - Type check completes.
  - Test suite completes.
- validation:
  - kind: lint
    required: true
    owner: orchestrator
    detail: "rtk pnpm lint:fix"
  - kind: typecheck
    required: true
    owner: orchestrator
    detail: "rtk pnpm type-check"
  - kind: test
    required: true
    owner: orchestrator
    detail: "rtk pnpm test -- --silent"

### Task_4: Independent Review

- type: review
- owns: []
- depends_on: [Task_1, Task_2, Task_3]
- description: |
  Run a Reviewer subagent after implementation and validation.
- acceptance:
  - Reviewer status is APPROVED.
  - Any findings are fixed and re-reviewed until no blocking findings remain.
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

- Revert the branch commit if the strengthened regression assertion exposes unrelated test instability.
- Do not touch parent worktree state.

## Progress Log

- 2026-06-01 15:36 Wave 0 completed: research
  - Summary: Re-ran Researcher against the assigned worktree after correcting the path.
  - Validation evidence: Researcher identified existing R14-M2 guard and tests in the assigned worktree.
  - Notes: R22-M9 remains separate follow-up scope.
- 2026-06-01 15:40 Wave 2 completed: [Task_2]
  - Summary: Strengthened the in-flight unmount regression assertions to require no `fetch` call at all.
  - Validation evidence: `rtk pnpm --filter @nexus-form/shared build` passed, then `rtk pnpm --filter @nexus-form/web exec vitest run src/hooks/forms/use-form-content-autosave.test.tsx` passed with 13 tests.
  - Notes: The first targeted test attempt failed because `@nexus-form/shared` had no generated `dist` in this fresh worktree.
- 2026-06-01 15:50 Wave 3 completed: [Task_3]
  - Summary: Required repository validation completed.
  - Validation evidence: `rtk pnpm lint:fix` passed; `rtk pnpm type-check` passed; `rtk pnpm test -- --silent` passed.
  - Notes: `rtk pnpm test --silent` was attempted first and failed because Turbo treats `--silent` as an unknown argument unless it is passed after `--`.
- 2026-06-01 15:52 Wave 4 completed: [Task_4]
  - Summary: Independent Reviewer approved the diff.
  - Validation evidence: Reviewer status APPROVED with no findings.
  - Notes: Reviewer agreed R22-M9 should remain separate follow-up scope.

## Decision Log

- 2026-06-01 15:36 Decision: keep R22-M9 out of scope
  - Trigger / new insight: R22-M9 is the inverse risk of not persisting failed in-flight saves after unmount.
  - Plan delta (what changed): Treat R22-M9 as follow-up design work, not part of R14-M2.
  - Tradeoffs considered: Including it would require broader request-id/version tracking and failure fallback design.
  - User approval: delegated task explicitly allowed reporting split recommendation.
- 2026-06-01 15:39 Decision: keep lesson file out of scope
  - Trigger / new insight: User requested removing `docs/coding-agent/lessons.md` from this task diff.
  - Plan delta (what changed): Removed the lesson file and kept only the plan artifact plus test change.
  - Tradeoffs considered: The correction is applied in-session without adding a shared lessons artifact.
  - User approval: yes.

## Notes

- Risks:
  - The source code already appears to contain the target fix; keep the branch diff limited to test hardening and process artifacts.
- Edge cases:
  - A true debounce-pending draft should still use keepalive/fallback on unmount.
