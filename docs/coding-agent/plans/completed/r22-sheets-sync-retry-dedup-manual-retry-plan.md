# Plan: R22 Sheets sync retry dedup manual retry

- status: done
- generated: 2026-05-31
- last_updated: 2026-05-31
- work_type: code

## Goal
- Implement R22-M1/R22-M2/R22-M7 as one Sheets sync work unit: keep terminal auth failures from retrying, make auto enqueue deterministic, make manual enqueue retryable, and preserve duplicate-row safety through worker idempotency.

## Definition of Done
- Sheets sync auth-required failures stay terminal and do not enter automatic retry loops.
- Sheets sync queue defaults do not retry automatically; duplicate safety is handled by auto job IDs plus worker idempotency.
- Auto and manual enqueue paths use shared BullMQ-safe, colon-free job IDs.
- Manual sync returns a fresh pollable job ID for explicit retries/re-syncs and remains bounded for full re-sync.
- Targeted tests and repository-required validation pass or are explicitly reported.

## Scope / Non-goals
- Scope:
  - `packages/shared/src/worker-jobs.ts`
  - `packages/shared/src/__tests__/worker-jobs.test.ts`
  - `apps/api/src/lib/queues.ts`
  - `apps/api/src/lib/__tests__/queues.test.ts`
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/routes/forms-integrations.ts`
  - `apps/api/src/__tests__/forms-integrations-google-sheets-sync-auth.test.ts`
  - `apps/api/src/__tests__/forms-public-validation-outbox.test.ts`
  - existing R22-M1 worker paths/tests if regression fixes are needed
- Non-goals:
  - Google OAuth UI redesign
  - Sheets API low-level client retry changes
  - Validation job retry semantics
  - DB schema migrations

## Context (workspace)
- Related files/areas:
  - `docs/coding-agent/plans/active/r22-m1-sheets-auth-handling-plan.md`
  - `apps/api/src/routes/forms-integrations.ts`
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/lib/queues.ts`
  - `apps/worker/src/handlers/sheets-sync.ts`
- Repo reference docs consulted:
  - `AGENTS.md`, `CLAUDE.md`
  - `$orchestration-harness`
  - `engineering-quality-baselines` TypeScript/testing references

## Open Questions (max 3)
- Q1: `z/tasks.md` is not present in this worktree, so R22-M2/R22-M7 acceptance is inferred from the task names and existing code.

## Assumptions
- A1: R22-M1 no-retry includes the existing AUTH_REQUIRED terminal handling and also requires Sheets sync queue defaults not to retry automatically.
- A2: R22-M7 manual retry maps to the existing explicit manual sync endpoint/UI rather than a new failed-job-only retry endpoint.

## Tasks

### Task_1: Centralize Sheets sync job IDs
- type: impl
- owns:
  - `packages/shared/src/worker-jobs.ts`
  - `packages/shared/src/__tests__/worker-jobs.test.ts`
- depends_on: []
- description: |
  Add shared helpers for auto and manual Sheets sync job IDs so all enqueue paths use BullMQ-safe IDs.
- acceptance:
  - Auto Sheets sync IDs are deterministic and colon-free.
  - Manual Sheets sync IDs are colon-free and include a caller nonce so explicit retries can enqueue after retained failed jobs.
  - Helpers do not require parsing source IDs back from job IDs.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `rtk pnpm --filter @nexus-form/shared test src/__tests__/worker-jobs.test.ts`

### Task_2: Apply no-retry and duplicate-safe enqueue
- type: impl
- owns:
  - `apps/api/src/lib/queues.ts`
  - `apps/api/src/lib/__tests__/queues.test.ts`
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/routes/forms-integrations.ts`
  - `apps/api/src/__tests__/forms-integrations-google-sheets-sync-auth.test.ts`
  - `apps/api/src/__tests__/forms-public-validation-outbox.test.ts`
- depends_on: [Task_1]
- description: |
  Use the shared job ID helpers on auto/manual enqueue and remove automatic Sheets queue retries.
- acceptance:
  - Sheets queue default job options no longer configure automatic attempts/backoff.
  - Auto enqueue no longer uses colon-containing job IDs.
  - Manual enqueue returns the generated first job ID and a second POST for the same response generates a fresh job ID.
  - Public submit auto enqueue has a targeted assertion for the generated duplicate-safe job ID.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `rtk pnpm --filter @nexus-form/api test src/lib/__tests__/queues.test.ts src/__tests__/forms-integrations-google-sheets-sync-auth.test.ts src/__tests__/forms-public-validation-outbox.test.ts`

### Task_3: Verify R22-M1 worker behavior remains intact
- type: test
- owns:
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/worker/src/index.ts`
  - `apps/worker/src/handlers/__tests__/sheets-sync.test.ts`
- depends_on: [Task_2]
- description: |
  Confirm the existing worker-side AUTH_REQUIRED terminal behavior still holds with queue-level no-retry.
- acceptance:
  - AUTH_REQUIRED paths still throw `UnrecoverableError`.
  - Existing idempotency tests still pass.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `rtk pnpm --filter @nexus-form/worker test src/handlers/__tests__/sheets-sync.test.ts`

### Task_4: Final validation and review
- type: review
- owns: []
- depends_on: [Task_1, Task_2, Task_3]
- description: |
  Run required repository checks and independent sub-agent review until approved.
- acceptance:
  - Required repository validation passes or a concrete blocker is reported.
  - Reviewer status is APPROVED with no open findings.
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
  - kind: review
    required: true
    owner: reviewer
    detail: "Sub-agent code review against R22 acceptance criteria"

## Task Waves
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]
- Wave 4 (parallel): [Task_4]

## Rollback / Safety
- Revert the shared job ID helper use and queue default change. Worker idempotency stays unchanged and remains the final duplicate-row guard.

## Progress Log
- 2026-05-31 Wave 0 completed: Researcher context gathered.
  - Summary: `z/tasks.md` was not found; current Sheets sync retry/dedup/manual sync code paths mapped.
  - Validation evidence: read-only sub-agent report.

- 2026-05-31 Wave 1-3 completed: implementation and targeted validation.
  - Summary:
    - Added shared Sheets sync job ID helpers.
    - Switched auto sync to a deterministic colon-free job ID.
    - Switched manual sync to request-nonce job IDs so explicit retries can run after retained failed jobs.
    - Removed Sheets queue automatic attempts/backoff.
    - Added API/shared regression tests for job IDs, no retry defaults, and manual retry.
  - Validation evidence:
    - `rtk pnpm --filter @nexus-form/shared test src/__tests__/worker-jobs.test.ts`
    - `rtk pnpm --filter @nexus-form/api test src/lib/__tests__/queues.test.ts src/__tests__/forms-integrations-google-sheets-sync-auth.test.ts src/__tests__/forms-public-validation-outbox.test.ts`
    - `rtk pnpm --filter @nexus-form/worker test src/handlers/__tests__/sheets-sync.test.ts`

- 2026-05-31 Wave 4 completed: full validation and independent review.
  - Summary:
    - First review found failed manual jobs could block explicit retry while retained.
    - Manual job ID design was updated to include a nonce.
    - Second review returned APPROVED with no findings.
  - Validation evidence:
    - `rtk pnpm lint:fix`
    - `rtk pnpm type-check`
    - `rtk pnpm test -- --silent`
    - Reviewer status: APPROVED

## Decision Log
- 2026-05-31 Decision:
  - Trigger / new insight: Requested task source `z/tasks.md` is missing from this worktree.
  - Plan delta (what changed): Implement R22-M1/M2/M7 from existing R22-M1 plan and code-level task names.
  - Tradeoffs considered: Avoid new UI/API surface unless required; strengthen existing queue/worker guarantees.
  - User approval: no explicit pause requested; implementation delegation requested.

## Notes
- Risks:
  - Retained completed/failed BullMQ jobs are bounded, so long-term duplicate-row defense still depends on worker idempotency and sheet scan.
  - Queue-level no-retry changes transient Sheets failures from automatic retry to explicit manual retry.
  - `rtk pnpm test --silent` is not accepted by Turbo in this repo; the equivalent silent test run was executed as `rtk pnpm test -- --silent`.
