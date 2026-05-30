# Plan: R22-M1 Sheets AUTH_REQUIRED terminal handling and worker error context

- status: in_progress
- generated: 2026-05-31
- last_updated: 2026-05-31
- work_type: code

## Goal
- `R22-M1` に沿って、Sheets 認証失敗を worker 側で terminal 扱いに統一し、worker レベルの `error`/`failed` イベントに queue/job 文脈を含める。

## Definition of Done
- `AUTH_REQUIRED` 分岐で retry を再発生させない形が worker 処理で実装される。
- worker の `error`/`failed` ログに queue 名・ジョブ識別情報が含まれる。
- 既存の API/worker テスト（既存ケース）を壊さない。

## Scope / Non-goals
- Scope:
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/worker/src/index.ts`
- Non-goals:
  - M7/M2/M3/M4 以降のタスク対応

## Open Questions (max 3)
- Q1: none
- Q2:
- Q3:

## Assumptions
- Q1:
- Q2:

## Tasks

### Task_1: Implement terminal AUTH_REQUIRED handling in sheets sync handler
- type: impl
- owns:
  - apps/worker/src/handlers/sheets-sync.ts
- depends_on: []
- description: |
  Ensure `AUTH_REQUIRED` paths keep the current no-retry intent explicit and avoid processor-internal failure state races.
- acceptance:
  - `AUTH_REQUIRED` paths still discard the job state and throw a terminal-compatible error object.
  - Existing auth failure behavior in unit tests remains unchanged from call-site perspective.
- validation:
  - kind: review
    required: true
    owner: worker
    detail: "Diff review for terminal failure branch and side effects (discard + no retry semantics)"

### Task_2: Add worker queue/job context logging for error paths
- type: impl
- owns:
  - apps/worker/src/index.ts
- depends_on: [Task_1]
- description: |
  Add queue/job context to failed and worker error logs and emit a Sentry message for error events.
- acceptance:
  - `failed` handler logs job and attempts context.
  - `error` handler logs queue context and records a Sentry message.
- validation:
  - kind: review
    required: true
    owner: worker
    detail: "Diff review for added logging context fields and Sentry usage"

## Task Waves
- Wave 1: [Task_1]
- Wave 2: [Task_2]

## Progress Log
- 2026-05-31 Wave 1 completed: [Task_1]
  - Summary:
    - `AUTH_REQUIRED` terminal branchを `UnrecoverableError` に変更し、`job.discard()` 後の throw で再試行不可扱いに統一
  - Validation evidence:
    - `pnpm --filter @nexus-form/worker lint`
    - `pnpm --filter @nexus-form/worker type-check`
    - `pnpm --filter @nexus-form/worker test src/handlers/__tests__/sheets-sync.test.ts`
  - Notes:

- 2026-05-31 Wave 2 completed: [Task_2]
  - Summary:
    - `worker` イベントで queue/job 文脈を含むログと Sentry message を追加
  - Validation evidence:
    - `pnpm --filter @nexus-form/worker lint`
    - `pnpm --filter @nexus-form/worker type-check`
    - `pnpm --filter @nexus-form/worker test`
  - Notes:

## Decision Log
- 2026-05-31 Decision:
  - Trigger / new insight: `R22-M1` requirement was partially満たされていたが `error/failed` コンテキスト記録が弱い状態
  - Plan delta (what changed): 2タスクでハンドラと worker イベントの両方を更新
  - Tradeoffs considered: UnrecoverableError を使って no-retry を明示
  - User approval: no (continuation request)
