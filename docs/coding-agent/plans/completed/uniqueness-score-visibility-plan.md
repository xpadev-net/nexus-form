# Plan: Uniqueness Score Visibility

- status: done
- generated: 2026-07-05
- last_updated: 2026-07-05
- work_type: code

## Goal
- 回答確認画面と Google Sheets 同期行で、回答ごとのユニーク度スコアを確認できるようにする。

## Definition of Done
- API の回答一覧・詳細レスポンスに `uniquenessScore` が含まれる。
- 回答詳細 UI にユニーク度スコアが表示される。
- Google Sheets 同期で `ユニーク度スコア` 列が作成・更新される。
- 関連する API/Worker/Web のテストが追加または更新される。

## Scope / Non-goals
- Scope:
  - `apps/api/src/routes/forms-responses.ts`
  - `apps/api/src/types/domain/form-responses.ts`
  - `apps/api/src/lib/forms/uniqueness-calculator.ts`
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/web/src/components/forms/response-detail-view.tsx`
  - 対応するテスト
- Non-goals:
  - DB スキーマ変更
  - ユニーク度算出アルゴリズム自体の変更
  - 既存回答の永続的な backfill

## Context (workspace)
- Related files/areas:
  - CSV export は `buildResponseExportRecords` で fingerprint からスコアを計算済み。
  - 回答一覧・詳細 API は `formResponse` 行のみ返しており、スコアを含まない。
  - Worker の Sheets 同期は独自の行生成でメタデータ列が `Response ID` のみ。
- Existing patterns or references:
  - `ResponseDetailResponseSchema` / `ResponsesListResponseSchema` で zod 契約を定義。
  - Sheets 同期は既存ヘッダーにない列を追加する方式。
- Repo reference docs consulted:
  - AGENTS.md project instructions
  - `$orchestration-harness`
  - `$plan-format`
  - `$engineering-quality-baselines`

## Open Questions
- Q1: なし。

## Assumptions
- A1: スコアは fingerprint がない回答でも既存 CSV と同じく単独回答なら `1.0000` と表示する。
- A2: Sheets の列 ID は UI/CSV と同じ日本語ラベル `ユニーク度スコア` を使う。

## Tasks

### Task_1: Add API score contract
- type: impl
- owns:
  - apps/api/src/routes/forms-responses.ts
  - apps/api/src/types/domain/form-responses.ts
  - apps/api/src/lib/forms/uniqueness-calculator.ts
- depends_on: []
- description: |
  回答一覧・詳細 API で同フォーム回答の fingerprint から `uniquenessScore` を算出して返す。
- acceptance:
  - 一覧レスポンスの各回答に `uniquenessScore` が含まれる。
  - 詳細レスポンスの `response` に `uniquenessScore` が含まれる。
  - zod スキーマで新フィールドが検証される。
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm --filter @nexus-form/api test"
  - kind: review
    required: true
    owner: orchestrator
    detail: "API contract diff review"

### Task_2: Show score in response detail UI
- type: impl
- owns:
  - apps/web/src/components/forms/response-detail-view.tsx
  - apps/web/src/components/forms/response-detail-view.test.tsx
- depends_on: [Task_1]
- description: |
  詳細 API の `uniquenessScore` を回答詳細画面に表示する。
- acceptance:
  - 詳細画面に `ユニーク度スコア` が表示される。
  - スコアは小数 4 桁で表示される。
  - スコアが未取得の場合は表示しない。
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm --filter @nexus-form/web test"
  - kind: review
    required: true
    owner: orchestrator
    detail: "UI rendering diff review"

### Task_3: Add score to Sheets sync
- type: impl
- owns:
  - apps/worker/src/handlers/sheets-sync.ts
  - apps/worker/src/handlers/__tests__/sheets-sync.test.ts
- depends_on: [Task_1]
- description: |
  Worker の Google Sheets 同期行にユニーク度スコア列を追加する。
- acceptance:
  - 新規シートに `ユニーク度スコア` ヘッダーが作られる。
  - 既存シートにも列が追加される。
  - 追記行に小数 4 桁のスコアが入る。
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm --filter @nexus-form/worker test"
  - kind: review
    required: true
    owner: orchestrator
    detail: "Sheets sync diff review"

## Task Waves
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2, Task_3]

## Rollback / Safety
- 変更はレスポンス契約への追加フィールドと Sheets 追加列のみ。問題時は該当コミットを revert する。

## Progress Log
- 2026-07-05 00:00 Wave 0 completed: investigation
  - Summary: CSV export だけがスコア計算済みで、API と Worker Sheets 独自行生成にはスコアがないことを確認。
  - Validation evidence: code inspection
  - Notes: Research waived: subagent tool unavailable in current tool set; direct bounded investigation performed.
- 2026-07-05 02:00 Wave 1 completed: [Task_1]
  - Summary: 回答一覧・詳細 API に `uniquenessScore` を追加し、zod 契約を更新。
  - Validation evidence: `pnpm --filter @nexus-form/api exec vitest run src/__tests__/unbounded-query-pagination.test.ts`; `pnpm type-check`
  - Notes: Reviewer waived: subagent tool unavailable; orchestrator diff review performed.
- 2026-07-05 02:00 Wave 2 completed: [Task_2, Task_3]
  - Summary: 回答リスト/詳細 UI と Google Sheets 同期行にユニーク度スコアを表示・出力。
  - Validation evidence: `pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-responses-page.test.tsx src/components/forms/response-detail-view.test.tsx`; `pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/sheets-sync.test.ts`; `pnpm lint:fix`; `pnpm type-check`; `pnpm test --silent`
  - Notes: UI E2E は未実行。既存 unit/jsdom テストで表示テキストを確認。

## Decision Log
- 2026-07-05 00:00 Decision:
  - Trigger / new insight: スコアは DB に保存されず fingerprint からオンデマンド計算されている。
  - Plan delta: 共通ヘルパーで API と Worker の算出を揃える。
  - Tradeoffs considered: 永続化は backfill/migration が必要なため対象外。
  - User approval: no; user requested investigation and fix in one request.

## Notes
- Risks:
  - 一覧 API はページ単位ではなく同フォーム全体の fingerprint を使って計算する必要がある。
  - 大量回答では追加クエリが発生するが、既存 CSV export と同等の計算方式に留める。
