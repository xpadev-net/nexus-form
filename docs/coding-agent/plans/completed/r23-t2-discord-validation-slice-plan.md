# Plan: R23-T2 Discord 外部検証 Slice Fixture 固定

- status: done
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: code

## Goal
- Discord 外部検証の成功、入力ミス、timeout/5xx、retry exhaustion/stuck PROCESSING 防止を mock/fixture テストで固定する。

## Definition of Done
- Discord provider の成功 fixture と timeout/5xx の安全な失敗理由がテストで固定される。
- Worker の Discord 入力ミス、retryable result の再試行、最終試行 FAILED 書き込みがテストで固定される。
- 実 Discord credential、実ネットワーク、GitHub/Twitter provider 変更を追加しない。
- Reviewer が差分と検証結果を承認する。

## Scope / Non-goals
- Scope:
  - `packages/validation-provider-discord/src/plugin.ts`
  - `packages/validation-provider-discord/src/__tests__/plugin.test.ts`
  - `apps/worker/src/handlers/__tests__/generic-validation.test.ts`
  - 必要なら関連する最小 API repository test
- Non-goals:
  - GitHub/Twitter provider の変更
  - 実 Discord credential や実 API E2E
  - UI 実装変更

## Context (workspace)
- Related files/areas:
  - Discord provider validates guild membership and maps Discord/network failures.
  - Worker writes validation results after PROCESSING and handles retryable provider results.
- Existing patterns or references:
  - `packages/validation-provider-discord/src/__tests__/plugin.test.ts`
  - `apps/worker/src/handlers/__tests__/generic-validation.test.ts`
- Repo reference docs consulted:
  - `AGENTS.md` delegated instructions
  - `$orchestration-harness`
  - `$plan-format`
  - `$subagent-report-contract`
- Repo rules:
  - `docs/coding-agent/rules/**` is absent in this worktree. Waiver: use AGENTS/CLAUDE and harness skills directly for validation policy.

## Open Questions (max 3)
- None.

## Assumptions
- `z/tasks.md` is absent in this worktree; the delegated task text is the source of truth for R23-T2 Discord slice.
- DB/SSE/UI reflection is represented in this slice by worker `writeValidationResult` payloads; no frontend behavior changes are required.
- User's delegated instruction to finish this slice waives a separate plan approval pause.

## Tasks

### Task_1: Discord provider fixture coverage and safe external messages
- type: impl
- owns:
  - `packages/validation-provider-discord/src/plugin.ts`
  - `packages/validation-provider-discord/src/__tests__/plugin.test.ts`
- depends_on: []
- description: |
  Add a complete successful guild membership fixture and ensure timeout/5xx external failure messages do not expose low-level Discord or network internals.
- acceptance:
  - Success fixture covers guild fetch, exact member search, role fetch, metadata, and no list fallback.
  - Timeout/network and 5xx failures remain retryable.
  - Failure `errorMessage` is a fixed user-safe string without raw status text, token, URL, or low-level timeout detail.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: `rtk pnpm --filter @nexus-form/validation-provider-discord test`
  - kind: review
    required: true
    owner: reviewer
    detail: Diff review against provider acceptance criteria.

### Task_2: Worker Discord retry and stuck PROCESSING coverage
- type: test
- owns:
  - `apps/worker/src/handlers/__tests__/generic-validation.test.ts`
- depends_on: []
- description: |
  Add Discord-specific worker tests for invalid input, retryable timeout/5xx style results, and final retry exhaustion writing FAILED instead of leaving PROCESSING.
- acceptance:
  - Discord invalid input writes `INPUT_VALIDATION_ERROR` / `Invalid input format` and does not call provider validate.
  - Discord retryable result without `retryAfter` rethrows before final BullMQ attempt and does not write a result.
  - Final Discord retryable result writes failure with safe error message and no delayed retry.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: `rtk pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/generic-validation.test.ts`
  - kind: review
    required: true
    owner: reviewer
    detail: Diff review against worker acceptance criteria.

### Task_3: Final validation and review
- type: review
- owns: []
- depends_on: [Task_1, Task_2]
- description: |
  Run required repository checks and independent review. Then commit, push, create PR, run gh-review-hook to exit 0, and merge.
- acceptance:
  - Required command validation passes or any failure is explained and resolved.
  - Independent Reviewer status is APPROVED.
  - PR is created, gh-review-hook exits 0, and PR is merged.
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
    detail: Independent review after implementation.

## Task Waves (explicit parallel dispatch sets)

- Wave 1 (parallel): [Task_1, Task_2]
- Wave 2 (parallel): [Task_3]

## Rollback / Safety
- Revert the provider guard and related tests in this branch only. No migrations or external service state are changed.

## Progress Log (append-only)

- 2026-06-01 20:26 Wave 0 completed: [research]
  - Summary: Researcher mapped existing Discord provider/worker coverage and identified missing success fixture, safe external messages, and Discord-specific worker retry tests.
  - Validation evidence: Read-only research report.
  - Notes: `z/tasks.md` and repo rule suite are absent in this worktree.
- 2026-06-01 20:34 Wave 1 completed: [Task_1, Task_2]
  - Summary: Added Discord provider success fixture and safe external failure messages; added worker Discord invalid input, retry-before-final, and final-failure write tests.
  - Validation evidence: `rtk pnpm --filter @nexus-form/validation-provider-discord test` passed with 35 tests. Worker report passed targeted handler test with 54 tests; Orchestrator will re-run after minor integration wording alignment.
  - Notes: Worker initially needed `@nexus-form/integrations` and `@nexus-form/shared` build outputs before targeted vitest could resolve imports.
- 2026-06-01 20:42 Wave 2 completed: [Task_3]
  - Summary: Full required validation passed and independent Reviewer approved with no findings.
  - Validation evidence: `rtk pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/generic-validation.test.ts`, `rtk pnpm --filter @nexus-form/api exec vitest run src/lib/forms/__tests__/validation-rule-repository.test.ts`, `rtk pnpm lint:fix`, `rtk pnpm type-check`, `rtk pnpm test -- --silent`, and `rtk git diff --check` passed.
  - Notes: API smoke initially needed `@nexus-form/database` build output before targeted vitest could resolve imports.

## Decision Log (append-only; re-plans and major discoveries)

- 2026-06-01 20:26 Decision: proceed without separate plan approval pause.
  - Trigger / new insight: User delegated this thread to complete the Discord slice end-to-end.
  - Plan delta (what changed): Treat approval as waived and keep scope to provider/worker tests plus minimal guard.
  - Tradeoffs considered: API route-level tests were considered but are not needed unless provider/worker changes reveal a route defect.
  - User approval: waived by delegated completion instruction.

## Notes
- Risks:
  - Final full test suite may expose unrelated failures; investigate without reverting unrelated changes.
- Edge cases:
  - Retryable results without `retryAfter` rely on BullMQ attempts. Final-attempt tests must assert a DB/SSE write path through `writeValidationResult`.
