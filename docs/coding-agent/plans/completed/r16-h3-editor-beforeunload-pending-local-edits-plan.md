# Plan: R16-H3 Editor Beforeunload Pending Local Edits

- status: done
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: code

## Goal
- Prevent data loss on the form editor by blocking browser unload only while autosave still has local edits that are pending, debounced, or in flight.

## Definition of Done
- The editor page registers `beforeunload` only for the editor page lifecycle.
- The unload decision uses the autosave hook's unsaved-state API.
- Saved/no-diff state does not trigger an unload warning.
- Pending debounce and in-flight autosave state do trigger an unload warning.
- R14-M2 keepalive duplicate-send protections remain covered.
- Required validation and independent review pass.

## Scope / Non-goals
- Scope:
  - `apps/web/src/hooks/forms/use-form-content-autosave.ts`
  - `apps/web/src/hooks/forms/use-form-content-autosave.test.tsx`
  - `apps/web/src/components/forms/form-editor-page/use-form-editor-page-model.ts`
  - `apps/web/src/components/forms/form-editor-page.test.tsx`
  - `apps/web/src/routes/_authenticated/forms/$id/edit.tsx`
- Non-goals:
  - Changing autosave API payloads or backend behavior.
  - Changing R14-M2 keepalive policy for in-flight saves.
  - Adding visible UI.
  - Changing route structure.

## Context (workspace)
- Related files/areas:
  - `use-form-content-autosave.ts` already exposes `hasUnsavedLocalEdits()`.
  - `use-form-editor-page-model.ts` already owns editor page lifecycle side effects.
  - Existing tests use jsdom, manual `createRoot`, and mocked hooks.
- Existing patterns or references:
  - `docs/coding-agent/plans/completed/r14-m2-autosave-unmount-keepalive-plan.md`
- Repo reference docs consulted:
  - `/Users/xpadev/.codex/RTK.md`
  - `AGENTS.md` / `CLAUDE.md` prompt context
  - coding-agent orchestration harness skill
- Repo rules:
  - `docs/coding-agent/rules` is absent, so validation is derived from project instructions and harness defaults.

## Open Questions
- None. Treat in-flight autosave as unsaved for beforeunload, while keeping R14-M2 duplicate keepalive avoidance unchanged.

## Assumptions
- Browser beforeunload dialogs are better verified with jsdom event assertions than full browser dialog automation.
- The delegated prompt explicitly authorizes implementation through PR and merge, so separate plan approval is waived.

## Tasks

### Task_1: Confirm beforeunload integration
- type: impl
- owns:
  - `apps/web/src/components/forms/form-editor-page/use-form-editor-page-model.ts`
  - `apps/web/src/components/forms/form-editor-page.test.tsx`
- depends_on: []
- description: |
  Keep the editor page `beforeunload` listener tied to the page model and cover warning/no-warning behavior using the autosave hook's exposed unsaved-state function.
- acceptance:
  - `beforeunload` calls `preventDefault()` only when `hasUnsavedLocalEdits()` returns true.
  - `beforeunload` leaves saved/no-diff state alone.
  - The listener is removed when the editor page unmounts.
- validation:
  - kind: unit
    required: true
    owner: worker
    detail: `rtk pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-editor-page.test.tsx`
  - kind: review
    required: true
    owner: reviewer
    detail: Independent diff review verifies listener scope and no stale state.

### Task_2: Cover autosave unsaved-state semantics
- type: test
- owns:
  - `apps/web/src/hooks/forms/use-form-content-autosave.ts`
  - `apps/web/src/hooks/forms/use-form-content-autosave.test.tsx`
- depends_on: [Task_1]
- description: |
  Ensure the autosave hook reports no unsaved edits initially and after save success, but reports unsaved edits during debounce and in-flight autosave.
- acceptance:
  - Initial loaded content reports no unsaved edits.
  - Local edit before debounce fires reports unsaved edits.
  - In-flight autosave reports unsaved edits.
  - Autosave success clears the unsaved state.
  - Existing R14-M2 in-flight keepalive tests remain valid.
- validation:
  - kind: unit
    required: true
    owner: worker
    detail: `rtk pnpm --filter @nexus-form/web exec vitest run src/hooks/forms/use-form-content-autosave.test.tsx`

### Task_3: Full validation and review
- type: review
- owns: []
- depends_on: [Task_1, Task_2]
- description: |
  Run required repository checks and independent review. Browser evidence is attempted only if the local app can be exercised meaningfully without auth/API setup blocking the beforeunload behavior.
- acceptance:
  - Required project validation commands pass.
  - Reviewer status is APPROVED.
  - Browser/component-level evidence is recorded with any limitations.
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
    detail: `rtk pnpm test -- --silent`
  - kind: e2e
    required: false
    owner: reviewer
    detail: Browser evidence if feasible; otherwise component-level evidence and blocker rationale.

## Task Waves

- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]

## E2E / Visual Validation Spec

- provider: browser/playwright if feasible; jsdom component tests as stable fallback
- artifact_root: `.playwright-cli/` if browser automation is used
- base_url: local web app if auth/API dependencies are available
- app_start_command: `rtk pnpm --filter @nexus-form/web dev`
- readiness_check: page loads and editable form route is accessible
- flows:
  - Dispatch or trigger unload with pending editor changes.
  - Dispatch or trigger unload after saved/no-diff state.
- viewports:
  - desktop
- evidence_requirements:
  - Event prevention observed for unsaved state.
  - No event prevention observed for saved state.
- known_flakiness:
  - Native beforeunload dialogs are hard to automate consistently.
  - Auth/API/db setup may block route-level browser access.

## Rollback / Safety
- Revert the test changes and any beforeunload/autosave edits as one logical change.
- Do not alter keepalive duplicate-send policy unless a failing test proves it is necessary.

## Progress Log

- 2026-06-01 Wave 0 completed: [Research]
  - Summary: Researcher found `hasUnsavedLocalEdits()` and an existing page-model `beforeunload` listener; likely implementation focus is test coverage and semantic confirmation.
  - Validation evidence: Read-only code inspection.
  - Notes: Plan approval waived because user delegated implementation through merge.
- 2026-06-01 Wave 1 completed: [Task_1]
  - Summary: Added page-level beforeunload tests for unsaved, saved, and unmounted editor states.
  - Validation evidence: `rtk pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-editor-page.test.tsx` passed after building `@nexus-form/shared`.
  - Notes: The existing page-model listener already matched the expected integration point.
- 2026-06-01 Wave 2 completed: [Task_2]
  - Summary: Added autosave hook regression coverage for initial clean state, pending debounce, in-flight save, and save success cleanup.
  - Validation evidence: `rtk pnpm --filter @nexus-form/web exec vitest run src/hooks/forms/use-form-content-autosave.test.tsx` passed after building `@nexus-form/shared`.
  - Notes: R14-M2 keepalive tests remain in the same suite and passed.
- 2026-06-01 Wave 3 validation started: [Task_3]
  - Summary: Ran required project validation.
  - Validation evidence: `rtk pnpm lint:fix` passed; `rtk pnpm type-check` passed; `rtk pnpm test -- --silent` passed.
  - Notes: Browser evidence was not attempted because native beforeunload dialogs are not stable to assert in automated browser runs and the editor route depends on app auth/API setup; component-level jsdom evidence directly covers event prevention.
- 2026-06-01 Review iteration 1 completed: [Task_3]
  - Summary: Reviewer requested stronger in-flight-only unsaved-state coverage. Added a hook test where editor content matches the saved base while an autosave remains in flight.
  - Validation evidence: `rtk pnpm --filter @nexus-form/web exec vitest run src/hooks/forms/use-form-content-autosave.test.tsx` passed; `rtk pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-editor-page.test.tsx` passed; `rtk pnpm lint:fix` passed; `rtk pnpm type-check` passed; `rtk pnpm test -- --silent` passed.
  - Notes: This closes the false-positive gap where content diff alone could satisfy the assertion.
- 2026-06-01 Wave 3 completed: [Task_3]
  - Summary: Independent Reviewer approved the final diff with no findings. Completed processes were closed by the Orchestrator.
  - Validation evidence: Reviewer status `APPROVED`; reviewer reran both targeted web tests successfully.
  - Notes: No rule or lesson candidates were identified.

## Decision Log

- 2026-06-01 Decision:
  - Trigger / new insight: Existing branch already contains the expected integration point.
  - Plan delta: Keep implementation scope narrow; add missing component/hook regression tests first.
  - Tradeoffs considered: Route-level listener cannot access autosave state cleanly; hook-level listener would be less tied to editor page lifecycle.
  - User approval: waived by explicit delegation prompt.

## Notes
- Risks:
  - `returnValue` behavior differs across browser/jsdom versions, so tests should assert `preventDefault()`/`defaultPrevented` where possible.
  - `hasUnsavedLocalEdits()` intentionally includes in-flight autosave state for unload prompts but keepalive still excludes in-flight values.
- Edge cases:
  - Reverting content to base while a pending timer exists may briefly count as unsaved because a pending local operation exists.
