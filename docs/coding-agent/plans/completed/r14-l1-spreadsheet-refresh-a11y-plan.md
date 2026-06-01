# R14-L1 Spreadsheet Refresh A11y Plan

## Context
- The Google Sheets spreadsheet refresh icon-only button needed an accessible name.
- Repository rule suite is absent, so validation follows `CLAUDE.md` plus harness defaults.
- The task is a narrow UI accessibility fix with focused regression coverage.

## Quality Routing
- Routing level: L1
- In-scope docs: `CLAUDE.md`, `orchestration-harness`, `git-workflow`
- Top risks: accessibility regression, missing test coverage for accessible name
- Risk profile: low; single component behavior and focused test only

## Task_1
- type: impl
- owns:
  - `apps/web/src/components/forms/google-sheets-integration/spreadsheet-selector.tsx`
- depends_on: []
- acceptance:
  - Refresh icon-only button exposes the accessible name `スプレッドシート一覧を再取得`.
  - Existing click and disabled behavior remains unchanged.
- validation:
  - required: true
    owner: orchestrator
    kind: inspection
    detail: Confirm `aria-label` is applied to the refresh `Button`.

## Task_2
- type: test
- owns:
  - `apps/web/src/components/forms/google-sheets-integration/spreadsheet-selector.test.tsx`
  - `apps/web/package.json`
  - `pnpm-lock.yaml`
- depends_on:
  - Task_1
- acceptance:
  - Adds Testing Library coverage using `getByRole("button", { name: ... })`.
  - Test confirms clicking the accessible refresh button calls `onRefreshSpreadsheets`.
- validation:
  - required: true
    owner: orchestrator
    kind: test
    detail: Run targeted web Vitest for `spreadsheet-selector.test.tsx`.

## Task_3
- type: review
- owns:
  - none
- depends_on:
  - Task_1
  - Task_2
- acceptance:
  - Independent reviewer approves the diff.
  - Any findings are fixed and re-reviewed.
- validation:
  - required: true
    owner: reviewer
    kind: review
    detail: Harness reviewer checks implementation, test, dependency change, and validation evidence.

## Task_4
- type: chore
- owns:
  - git branch / PR metadata
- depends_on:
  - Task_1
  - Task_2
  - Task_3
- acceptance:
  - Required validations pass.
  - Branch is pushed, PR is created, `gh-review-hook` exits 0, and merge is completed if allowed.
- validation:
  - required: true
    owner: orchestrator
    kind: command
    detail: Capture validation command outcomes, push result, PR URL, review hook result, and merge result.

## Task Waves
- Wave 1: Task_1
- Wave 2: Task_2
- Wave 3: Task_3
- Wave 4: Task_4

## Progress Log
- 2026-06-01: Added refresh button accessible name and Testing Library regression coverage.
- 2026-06-01: `pnpm lint:fix`, `pnpm type-check`, and `pnpm test -- --silent` passed. `pnpm test --silent` was rejected by Turbo argument parsing before tests ran.
- 2026-06-01: Reviewer initially found the new test file was untracked; file was staged and reviewer approved after re-check.

## Decision Log
- 2026-06-01: Used `aria-label="スプレッドシート一覧を再取得"` to provide a direct accessible name without changing visible UI.
- 2026-06-01: Added `@testing-library/dom` as a web devDependency because the requested regression uses Testing Library `getByRole`.
- 2026-06-01: Record the reviewer-found untracked-file miss in this plan Decision Log instead of `docs/coding-agent/lessons.md`, because the delegated task workflow treats `lessons.md` as shared and conflict-prone unless essential.
- 2026-06-01: Before reviewer dispatch on tasks that add files, run `git status --short` and confirm new files are tracked or explicitly included in the review packet as untracked work that will be staged.
- 2026-06-01: `gh-review-hook` flagged the test's detached container pattern. Updated the test to append the container to `document.body` and remove it during cleanup so role queries do not mask CSS-driven hidden states in jsdom.
