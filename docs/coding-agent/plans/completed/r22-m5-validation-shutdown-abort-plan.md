# Plan: R22-M5 validation shutdown AbortError terminalization

- status: completed
- generated: 2026-05-31
- last_updated: 2026-05-31
- work_type: code

## Goal
- Worker `generic-validation` で shutdown AbortError が発生した際、`PROCESSING` に遷移済みの validation result が残留しないようにする。

## Definition of Done
- shutdown signal による AbortError は、処理開始後なら BullMQ の最終試行でなくても validation result を `FAILED` に更新する。
- shutdown 以外の provider AbortError は既存どおり非最終試行で再スローされる。
- shutdown timing の unit test を追加する。
- 必須検証、Reviewer 確認、PR 作成後の review hook が完了する。

## Scope / Non-goals
- Scope:
  - `apps/worker/src/handlers/generic-validation.ts`
  - `apps/worker/src/handlers/__tests__/generic-validation.test.ts`
- Non-goals:
  - API retry claim behavior の変更
  - database schema / migration の変更
  - external provider implementation の変更

## Assumptions
- `z/tasks.md` はこの worktree に存在しないため、依頼文と既存コードから R22-M5 の要件を復元する。
- shutdown signal が abort 済みの場合のみ、非最終試行の AbortError を terminal 扱いにする。

## Tasks

### Task_1: Implement shutdown AbortError terminalization
- type: impl
- owns:
  - apps/worker/src/handlers/generic-validation.ts
- depends_on: []
- description: |
  Distinguish worker shutdown AbortError from ordinary provider AbortError and write a failed validation result when shutdown interrupts a job after PROCESSING.
- acceptance:
  - shutdown AbortError after `markValidationProcessing` writes `VALIDATION_ABORTED_DURING_SHUTDOWN`.
  - non-shutdown AbortError on non-final BullMQ attempts still rethrows for retry.
  - existing final-attempt AbortError behavior remains compatible.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/generic-validation.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent code review for shutdown/AbortError state transitions"

### Task_2: Add shutdown timing unit coverage
- type: test
- owns:
  - apps/worker/src/handlers/__tests__/generic-validation.test.ts
- depends_on: [Task_1]
- description: |
  Add a timing-focused unit test that aborts worker shutdown after PROCESSING and before provider validation completes.
- acceptance:
  - test proves non-final shutdown AbortError writes FAILED instead of leaving PROCESSING.
  - test resets module state so the singleton shutdown signal does not leak into other tests.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/generic-validation.test.ts"
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm lint:fix"
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm type-check"
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm test -- --silent"

## Task Waves
- Wave 1: [Task_1, Task_2]
- Wave 2: [review]
- Wave 3: [git/pr/review-hook]

## Progress Log
- 2026-05-31 Plan created
  - Summary:
    - R22-M5 の要件を依頼文と既存 `AbortError` 実装から復元。
  - Validation evidence:
    - pending
  - Notes:
    - User approval: waived by explicit implementation delegation.

- 2026-05-31 Wave 1 completed: [Task_1, Task_2]
  - Summary:
    - `workerShutdownSignal.aborted` を条件に、shutdown AbortError は非最終試行でも `VALIDATION_ABORTED_DURING_SHUTDOWN` で `FAILED` に確定。
    - provider 実行中と `PROCESSING` 更新直後の shutdown timing unit test を追加。
  - Validation evidence:
    - `pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/generic-validation.test.ts` passed: 48 tests.
  - Notes:
    - Worker report integrated; changed files were inside owns.

- 2026-05-31 Wave 2 completed: [review]
  - Summary:
    - Reviewer status: APPROVED.
    - Minor plan command notation issue fixed from `pnpm test --silent` to `pnpm test -- --silent`.
  - Validation evidence:
    - `pnpm lint:fix` passed.
    - `pnpm type-check` passed.
    - `pnpm test -- --silent` passed: 15 tasks.
  - Notes:
    - `pnpm test --silent` failed because Turbo treats `--silent` as a Turbo argument unless passed after `--`.

- 2026-05-31 Review hook fix applied
  - Summary:
    - Greptile identified Discord Redis lock shutdown AbortError was wrapped as `DISCORD_DISTRIBUTED_LOCK_TIMEOUT`.
    - Inner Discord lock catch now rethrows shutdown AbortError before lock-timeout wrapping.
    - Added Discord lock shutdown timing coverage.
  - Validation evidence:
    - `pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/generic-validation.test.ts` passed: 49 tests.
    - `pnpm lint:fix` passed.
    - `pnpm type-check` passed.
    - `pnpm test -- --silent` passed: 15 tasks.
  - Notes:
    - Follow-up Reviewer status: APPROVED / 指摘なし.

- 2026-05-31 Second review hook fix applied
  - Summary:
    - Greptile identified stale comment wording and possible provider AbortError misclassification when provider abort coincides with worker shutdown.
    - Shutdown abort detection now requires the caught AbortError to be identical to `workerShutdownSignal.reason`.
    - Added coverage proving provider-origin AbortError still rethrows when worker shutdown fires before the catch.
  - Validation evidence:
    - `pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/generic-validation.test.ts` passed: 50 tests.
    - `pnpm lint:fix` passed.
    - `pnpm type-check` passed.
    - `pnpm test -- --silent` passed: 15 tasks.
  - Notes:
    - Follow-up Reviewer status: APPROVED / 指摘なし.

- 2026-05-31 Third review hook fix applied
  - Summary:
    - Greptile identified the `throwIfShuttingDown` fallback could create a new AbortError outside the identity contract.
    - `throwIfShuttingDown` now throws `workerShutdownSignal.reason` directly when present.
    - Added coverage proving a non-AbortError shutdown reason after `PROCESSING` still writes a terminal result instead of leaving `PROCESSING`.
  - Validation evidence:
    - `pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/generic-validation.test.ts` passed: 51 tests.
    - `pnpm lint:fix` passed.
    - `pnpm type-check` passed.
    - `pnpm test -- --silent` passed: 15 tasks.
  - Notes:
    - Follow-up Reviewer status: APPROVED / 指摘なし.

## Decision Log
- 2026-05-31 Decision:
  - Trigger / new insight: current implementation handles AbortError only on final BullMQ attempt, leaving non-final shutdown aborts able to keep rows in PROCESSING.
  - Plan delta (what changed): shutdown signal stateを分岐条件に入れ、shutdown abortのみ非最終試行でも FAILED に確定する。
  - Tradeoffs considered: provider-origin AbortError retry semantics are preserved to avoid broadening terminal failures.
  - User approval: no separate approval requested; user explicitly requested implementation through PR flow.
