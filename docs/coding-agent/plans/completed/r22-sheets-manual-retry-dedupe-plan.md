# Plan: R22 Sheets manual retry dedupe

- status: done
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: code

## Goal
- Complete R22-M1/R22-M2/R22-M7 for Sheets sync: terminal auth failures must not retry, manual sync transient failures should retry, and repeated manual sync requests must not enqueue duplicate jobs for the same response.

## Definition of Done
- `AUTH_REQUIRED` failures are represented as terminal BullMQ failures without processor-internal `moveToFailed()` state mutation.
- Worker error/failed listeners keep queue/job context.
- Manual sync jobs use deterministic BullMQ-safe IDs and bounded enqueue behavior.
- Manual sync transient failures use retry attempts/backoff, while `AUTH_REQUIRED` remains no-retry via `UnrecoverableError`.
- Required validation and independent review pass.

## Scope / Non-goals
- Scope:
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/worker/src/index.ts`
  - `apps/api/src/routes/forms-integrations.ts`
  - `apps/api/src/lib/queues.ts`
  - `packages/shared/src/worker-jobs.ts`
  - targeted tests required to prove the behavior
- Non-goals:
  - Google OAuth UI changes
  - database migrations
  - changing public auto-sync enqueue semantics beyond regression coverage

## Assumptions
- `z/tasks.md` is absent in this worktree; the task text in the delegation prompt is treated as authoritative.
- Work proceeds without a separate user approval pause because the parent delegation explicitly requested implementation, verification, PR, review-hook, and merge.

## Tasks

### Task_1: Manual sync deterministic retry options
- type: impl
- owns:
  - `apps/api/src/routes/forms-integrations.ts`
  - `apps/api/src/lib/queues.ts`
  - `packages/shared/src/worker-jobs.ts`
  - `apps/api/src/__tests__/forms-integrations-google-sheets-sync-auth.test.ts`
  - `apps/api/src/lib/__tests__/queues.test.ts`
  - `packages/shared/src/__tests__/worker-jobs.test.ts`
- depends_on: []
- acceptance:
  - Manual sync jobs use deterministic colon-free job IDs for the same integration/response.
  - Repeating manual sync for the same response returns/enqueues the same job ID instead of creating a distinct duplicate job ID.
  - Manual sync jobs set attempts/backoff for transient failures.
  - Full manual sync remains bounded and returns 413 over the configured response cap.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `rtk pnpm --filter @nexus-form/api test src/lib/__tests__/queues.test.ts src/__tests__/forms-integrations-google-sheets-sync-auth.test.ts`

### Task_2: Worker terminal failure regression coverage
- type: test
- owns:
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/worker/src/index.ts`
  - `apps/worker/src/handlers/__tests__/sheets-sync.test.ts`
- depends_on: [Task_1]
- acceptance:
  - OAuth token missing and refresh failure throw `UnrecoverableError` with `AUTH_REQUIRED`.
  - Sheets 401/403 are terminal `AUTH_REQUIRED`.
  - Sheets rateLimit/timeout/internal and Redis pending/lock failures remain retryable ordinary errors.
  - Worker listeners retain failed/error context behavior.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `rtk pnpm --filter @nexus-form/worker test src/handlers/__tests__/sheets-sync.test.ts`

### Task_3: Full validation, review, PR, and merge
- type: review
- owns: []
- depends_on: [Task_1, Task_2]
- acceptance:
  - Repository required validation passes.
  - Independent sub-agent review reports APPROVED with no findings.
  - PR is created, `gh-review-hook` exits 0, and the PR is merged.
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
    detail: `rtk pnpm test --silent` or the repo-compatible equivalent if Turbo rejects the former
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent sub-agent review against R22 acceptance criteria"
  - kind: command
    required: true
    owner: orchestrator
    detail: `rtk gh-review-hook` exits 0

## Task Waves
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]

## Progress Log
- 2026-06-01 Wave 0 completed: repository state and prior R22 implementation inspected; `z/tasks.md` absent, delegation prompt accepted as authoritative.
- 2026-06-01 Wave 1 completed: manual sync now uses deterministic manual job IDs and explicit per-job retry options.
  - Validation evidence:
    - `rtk pnpm --filter @nexus-form/shared test src/__tests__/worker-jobs.test.ts`
    - `rtk pnpm --filter @nexus-form/api test src/lib/__tests__/queues.test.ts src/__tests__/forms-integrations-google-sheets-sync-auth.test.ts`
    - `rtk pnpm --filter @nexus-form/worker test src/handlers/__tests__/sheets-sync.test.ts`
  - Notes:
    - Initial parallel test execution triggered workspace package resolution failures because this worktree lacked built `dist` packages; reran after `rtk pnpm install`, `rtk pnpm --filter @nexus-form/database build`, and `rtk pnpm --filter @nexus-form/shared build`.
- 2026-06-01 Wave 2 completed: repository validation passed.
  - Validation evidence:
    - `rtk pnpm lint:fix`
    - `rtk pnpm type-check`
    - `rtk pnpm test --silent` failed because Turbo requires pass-through args after `--`.
    - `rtk pnpm test -- --silent`
- 2026-06-01 Wave 3 completed: independent Reviewer returned APPROVED with no findings.
  - Validation evidence:
    - Reviewer reran targeted shared/API/worker tests and approved acceptance coverage.
- 2026-06-01 PR hook feedback fixed:
  - Summary:
    - `gh-review-hook 432` surfaced that deterministic manual job IDs could leave a retained failed/completed job in Redis, making a later manual sync a no-op while still returning `queued`.
    - Manual sync now removes retained terminal jobs before `addBulk`, preserving active-job dedupe while allowing failed/completed responses to be re-queued truthfully.
  - Validation evidence:
    - `rtk pnpm --filter @nexus-form/api test src/__tests__/forms-integrations-google-sheets-sync-auth.test.ts src/lib/__tests__/queues.test.ts`
    - `rtk pnpm lint:fix`
    - `rtk pnpm type-check`

## Decision Log
- 2026-06-01 Decision:
  - Trigger / new insight: prior merged R22 implementation used nonce manual job IDs, which conflicts with the current duplicate job acceptance.
  - Plan delta (what changed): stable manual job IDs plus per-job retry options will replace nonce manual enqueue behavior.
  - Tradeoffs considered: stable IDs prevent duplicate active jobs, while worker idempotency remains the duplicate-row guard.
  - User approval: waived by explicit implementation delegation.
- 2026-06-01 Decision:
  - Trigger / new insight: parent repository path and shared lessons file are not owned by this task.
  - Plan delta (what changed): all code/Git/PR work is constrained to `/Users/xpadev/.codex/worktrees/cd19/nexus-form`, and `docs/coding-agent/lessons.md` is excluded from task diffs.
  - Tradeoffs considered: keep correction records in this task plan to avoid cross-thread shared-file conflicts.
  - User approval: explicit supplemental instruction.
