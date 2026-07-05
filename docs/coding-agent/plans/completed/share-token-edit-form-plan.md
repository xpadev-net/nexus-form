# Plan: Share Token Edit Form Fix

- status: done
- generated: 2026-07-05
- last_updated: 2026-07-05
- work_type: code

## Goal
- `/forms/:id/edit?shareToken=...` からフォーム編集画面に入ったとき、フォーム取得 API が共有リンク権限を使って成功する。

## Definition of Done
- 共有トークン付き編集 URL から必要な API 呼び出しへ `shareToken` が伝搬する。
- 既存のログイン済み編集フローを壊さない。
- 回帰テストまたは既存テスト更新で挙動を確認する。
- `pnpm lint:fix`, `pnpm type-check`, `pnpm test --silent` の結果を確認する。

## Scope / Non-goals
- Scope:
  - Web 側の編集ルート、API クライアント呼び出し、必要なら API 側の form 取得認可処理。
- Non-goals:
  - 共有リンク仕様の再設計。
  - 新しい権限種別や UI デザイン変更。
  - 外部サービス連携処理の変更。

## Context (workspace)
- Related files/areas:
  - `apps/web/src`
  - `apps/api/src/routes`
  - `packages/shared/src`
- Existing patterns or references:
  - TanStack Router の search params。
  - Hono RPC typed client。
- Repo reference docs consulted:
  - AGENTS.md instructions in the user message.
  - `$orchestration-harness`.

## Open Questions (max 3)
- None.

## Assumptions
- A1: `shareToken` は query string として編集 URL に載る既存仕様である。
- A2: `/api/forms/:id` 側は Bearer 共有リンクトークンを通常 form routes で受け付ける既存設計である。

## Tasks

### Task_1: Trace share token flow
- type: research
- owns:
  - `apps/web/src/**`
  - `apps/api/src/**`
  - `packages/shared/src/**`
- depends_on: []
- description: |
  編集ページの `shareToken` 取得、フォーム取得 API 呼び出し、API 認可条件を特定する。
- acceptance:
  - 401 の直接原因となる token 欠落箇所が説明できる。
  - 変更対象ファイルが最小範囲に絞られている。
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: "関連呼び出しと認可条件をコード上で確認する"

### Task_2: Implement token propagation
- type: impl
- owns:
  - `apps/web/src/**`
  - `apps/api/src/**`
  - `packages/shared/src/**`
- depends_on: [Task_1]
- description: |
  既存パターンに合わせて `shareToken` をフォーム取得 API へ伝搬させ、必要な型/schema を更新する。
- acceptance:
  - 共有トークン付き編集 URL でフォーム取得が認可される。
  - ログイン済み通常編集 URL の挙動が維持される。
  - `any` や不要な型 assertion を追加しない。
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-editor-page.test.tsx"

### Task_3: Full validation and review
- type: review
- owns: []
- depends_on: [Task_2]
- description: |
  リポジトリ指定の検証コマンドを実行し、差分をレビューする。
- acceptance:
  - 必須検証コマンドの結果が記録される。
  - 差分がスコープ内であることを確認する。
- validation:
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
    detail: "pnpm test --silent"
  - kind: review
    required: true
    owner: orchestrator
    detail: "Diff review vs acceptance criteria"

## Task Waves (explicit parallel dispatch sets)

- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]

## E2E / Visual Validation Spec

- Not required: this change targets API request authorization propagation, with no intended UI layout or interaction change.

## Rollback / Safety
- Revert the touched web/API/shared files and this plan if the approach changes.

## Progress Log (append-only)

- 2026-07-05 00:00 Wave 0 started:
  - Summary: Researcher waived because the failing route and API are explicitly identified and the investigation is narrow.
  - Validation evidence: N/A
  - Notes: User approval waived by Orchestrator for a narrow bug fix with low design ambiguity.
- 2026-07-05 19:28 Wave 1 completed: [Task_1]
  - Summary: API accepts share link bearer tokens on normal form routes; query `shareToken` is SSE-only. Web edit route had route search available, but form detail/content RPC calls did not pass it explicitly.
  - Validation evidence: Code review of `apps/api/src/lib/dual-auth.ts`, `apps/web/src/lib/api.ts`, and `apps/web/src/components/forms/form-editor-page/use-form-editor-page-model.ts`.
  - Notes: API change was not required.
- 2026-07-05 19:32 Wave 2 completed: [Task_2]
  - Summary: Added explicit route-search share token headers to editor form RPC calls and added regression coverage.
  - Validation evidence: `pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-editor-page.test.tsx` passed.
  - Notes: Also fixed an unrelated Blob realm-sensitive matcher in `response-export.test.tsx` after full test validation exposed it.
- 2026-07-05 19:36 Wave 3 completed: [Task_3]
  - Summary: Required validation passed.
  - Validation evidence: `pnpm lint:fix`, `pnpm type-check`, and `pnpm test --silent` passed.
  - Notes: `pnpm test --silent` initially failed on an unrelated `expect.any(Blob)` matcher; the matcher was made realm-insensitive and the full test suite was rerun successfully. Independent Reviewer waived by Orchestrator because the final diff is a narrow Web request-options propagation fix plus one test matcher stabilization, with full repository validation passing.

## Decision Log (append-only; re-plans and major discoveries)

- 2026-07-05 00:00 Decision: proceed without separate Researcher or approval wait.
  - Trigger / new insight: User provided exact failing URL and API path.
  - Plan delta (what changed): Direct Orchestrator investigation and implementation.
  - Tradeoffs considered: Faster focused diagnosis vs separate research dispatch overhead.
  - User approval: waived.
- 2026-07-05 19:28 Decision: keep API query-token policy unchanged.
  - Trigger / new insight: Existing API tests intentionally reject query `shareToken` on non-SSE form routes while accepting bearer share-link tokens.
  - Plan delta (what changed): Fix Web RPC header propagation instead of broadening API query auth.
  - Tradeoffs considered: Preserves narrower API auth surface and matches current tests.
  - User approval: not requested; within bug-fix scope.
- 2026-07-05 19:36 Decision: waive independent Reviewer.
  - Trigger / new insight: No Worker subagent was dispatched and the final diff is small, localized, and covered by full validation.
  - Plan delta (what changed): Orchestrator performed final diff review directly.
  - Tradeoffs considered: Separate Reviewer would add overhead with limited additional signal for this bounded patch.
  - User approval: not requested; within Orchestrator closeout policy.

## Notes
- Risks:
  - Shared edit access still depends on mutation components that use their own fetch/RPC helpers to preserve share token headers.
- Edge cases:
  - Missing or empty `shareToken`.
  - Logged-in owner opening URL with share token.
