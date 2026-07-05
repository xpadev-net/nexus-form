# Viewer Share Readonly Plan

## Context
- User reported viewer share links can edit Plate content and can interact with settings they are not authorized to change.
- Repository rule files under `docs/coding-agent/rules/` are absent, so validation follows project `AGENTS.md` and harness defaults.
- Plan approval waived: the user asked to continue fixing the concrete regression and the scope is bounded to viewer share-link UI permission handling.

## Task_1
- type: impl
- owns:
  - `apps/web/src/components/forms/form-editor-page.tsx`
  - `apps/web/src/components/forms/form-editor-page/use-form-editor-page-model.ts`
  - `apps/web/src/components/forms/form-editor-page/editor-header-section.tsx`
  - `apps/web/src/components/editor/plate-editor*.tsx`
  - `apps/web/src/components/editor/plate-viewer*.tsx`
- depends_on: []
- acceptance:
  - Viewer share links render Plate content read-only and do not autosave content edits.
  - Viewer share links cannot activate edit-only tabs such as settings, validation, or sharing.
  - Edit-only header controls such as title save and publish/reset are not exposed to viewers.
  - Editor/owner behavior remains unchanged.
- validation:
  - required: true
    owner: orchestrator
    kind: unit
    detail: focused web component/hook tests covering viewer readonly behavior
  - required: true
    owner: reviewer
    kind: e2e
    detail: Playwright share-link E2E verifies viewer cannot edit Plate and cannot access edit-only tabs

## Task_2
- type: test
- owns:
  - `apps/web/src/components/forms/form-editor-page.test.tsx`
  - `apps/web/src/components/editor/*test.tsx`
  - `e2e/share-links.spec.ts`
- depends_on: [Task_1]
- acceptance:
  - Unit tests cover readonly Plate prop propagation and viewer tab restrictions.
  - E2E covers viewer share link page without failed hidden mutation attempts.
  - Existing editor share-link permissions still pass.
- validation:
  - required: true
    owner: orchestrator
    kind: command
    detail: `pnpm --filter @nexus-form/web exec vitest run ...`
  - required: true
    owner: orchestrator
    kind: command
    detail: `PLAYWRIGHT_SKIP_WEB_SERVER=1 BASE_URL=http://localhost:3000 pnpm test:e2e -- e2e/share-links.spec.ts`

## Task_3
- type: review
- owns:
  - all changed files
- depends_on: [Task_1, Task_2]
- acceptance:
  - Independent reviewer finds no blocking authorization/UI regressions.
  - Required validation evidence is recorded.
- validation:
  - required: true
    owner: reviewer
    kind: code-review
    detail: subagent review of final diff and validation evidence

## Task Waves
- Wave 1: Task_1
- Wave 2: Task_2
- Wave 3: Task_3

## Progress Log
- 2026-07-05: Plan created; repo rule files absent; branch `codex/fix-viewer-share-readonly` created.
- 2026-07-05: Implemented viewer read-only editor handling, disabled edit-only tabs/header actions, and added unit/E2E coverage.
- 2026-07-05: Reviewer found a Plate mode-switch escape; fixed by using `ViewerKit` for forced read-only editor instances and remounting when edit permission resolves.
- 2026-07-05: Reviewer found viewer responses-tab and stale pending-save write paths; fixed by disabling responses for viewers and adding `enabled` guards to autosave.
- 2026-07-05: Reviewer found an autosave enabled stale-closure regression; fixed by reading enabled from a ref and added false-to-true autosave recovery coverage.
- 2026-07-05: Reviewer found autosave cleanup could still flush pending writes when permission changed true-to-false; fixed cleanup to use unmount-only refs and added true-to-false coverage.
- 2026-07-05: Validation passed after final fixes: focused web vitest, share-link Playwright E2E, `pnpm lint:fix`, `pnpm type-check`, and `pnpm test --silent`.
- 2026-07-05: Final reviewer pass approved the diff with no actionable issues.
- 2026-07-05: `gh-review-hook` found form-id switch cleanup and coverage gaps; fixed autosave form-id transition cleanup, centralized edit-only tab keys, gated editor rendering on permission certainty, and added targeted tests.
- 2026-07-05: Re-validation passed after hook fixes: focused web vitest, share-link Playwright E2E, `pnpm lint:fix`, `pnpm type-check`, and `pnpm test --silent`.
- 2026-07-05: Follow-up reviewer found an async keepalive fallback edge on form-id switch; fixed non-ok keepalive fallback to always preserve the pending save for the target form.
- 2026-07-05: Final reviewer found in-flight autosave success could use the current form scope after form-id switch; fixed content save variables to carry form/query scope and added regression coverage.
- 2026-07-05: `gh-review-hook` found enabled-to-disabled autosave cleanup could drop unsaved drafts; fixed same-form permission-loss cleanup to use the keepalive/retry fallback and added regression coverage.
- 2026-07-05: `gh-review-hook` requested direct edit-only tab helper coverage and explicit test-helper return types; added both and revalidated focused tests.

## Decision Log
- 2026-07-05: Approval wait waived because the user asked for an implementation fix and the affected surface is bounded to viewer share-link UI permissions.
