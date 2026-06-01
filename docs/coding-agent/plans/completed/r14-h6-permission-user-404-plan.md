# Plan: R14-H6 permission creation missing user response

- status: completed
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: code

## Goal
- `POST /:id/permissions` で存在しない `userId` を受けた場合に、DB FK 由来の 500 ではなく安定した 4xx domain error body を返すことを実装・検証する。

## Definition of Done
- insert 前の user 存在確認が route 上で維持される。
- 存在しない `userId` への permission 追加が 404 body を返し、permission insert へ進まない route test がある。
- 必須検証、独立レビュー、PR review hook、merge が完了する。

## Scope / Non-goals
- Scope:
  - `apps/api/src/routes/forms-permissions.ts`
  - `apps/api/src/__tests__/forms-permissions-share-links-auth.test.ts`
- Non-goals:
  - permission schema / migration の変更
  - owner transfer route の変更
  - frontend 権限 UI の変更

## Assumptions
- この worktree に `z/tasks.md` が無いため、依頼文の R14-H6 本文を正として扱う。
- 対象 route にはすでに user 存在確認が入っているため、主作業は回帰 test の追加と検証に限定する。
- ユーザーの補足により、親 repository ではなく `/Users/xpadev/.codex/worktrees/e547/nexus-form` のみで作業する。
- `docs/coding-agent/lessons.md` は複数スレッドで衝突しやすいため、このタスク専用 plan のログに補足指示を記録し、共有 lessons ファイルは変更しない。

## Tasks

### Task_1: Add route regression coverage
- type: test
- owns:
  - apps/api/src/__tests__/forms-permissions-share-links-auth.test.ts
- depends_on: []
- description: |
  Add route-level coverage for missing target users on `POST /:id/permissions`.
- acceptance:
  - missing `userId` returns `{ error: "User not found" }` with HTTP 404.
  - the transaction stops before duplicate-permission lookup and insert.
  - test imports the real `formsPermissionsRouter` while mocking auth/database boundaries.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-permissions-share-links-auth.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent review of route behavior and test coverage"

### Task_2: Full repository validation and PR flow
- type: chore
- owns:
  - docs/coding-agent/plans/active/r14-h6-permission-user-404-plan.md
  - docs/coding-agent/plans/completed/r14-h6-permission-user-404-plan.md
- depends_on: [Task_1]
- description: |
  Run required repo checks, create the PR, process review hook feedback until clean, and merge.
- acceptance:
  - required repo commands pass.
  - independent review has no unresolved findings.
  - PR is created, `gh-review-hook` exits 0, and the PR is merged.
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
  - kind: command
    required: true
    owner: orchestrator
    detail: "gh-review-hook exits 0"

## Task Waves
- Wave 1: [Task_1]
- Wave 2: [review]
- Wave 3: [Task_2]

## Progress Log
- 2026-06-01 Plan created
  - Summary:
    - R14-H6 の route 実装は既に user 存在確認済みだったため、missing user route test を追加する方針にした。
  - Validation evidence:
    - pending
  - Notes:
    - User approval: waived by explicit implementation delegation.

- 2026-06-01 Wave 1 completed: [Task_1]
  - Summary:
    - `POST /:id/permissions` の missing target user route test を追加。
    - 404 body と、duplicate permission lookup / insert へ進まないことを固定。
  - Validation evidence:
    - `pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-permissions-share-links-auth.test.ts` passed: 14 tests.
  - Notes:
    - Fresh worktree で `@nexus-form/database` の `dist` が未生成だったため、対象 test 前に `pnpm --filter @nexus-form/database build` を実行した。

- 2026-06-01 Wave 2 completed: [review]
  - Summary:
    - Independent Reviewer status: APPROVED.
    - Reviewer findings: none.
  - Validation evidence:
    - Reviewer ran `rtk pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-permissions-share-links-auth.test.ts`: pass, 14 tests.
  - Notes:
    - Reviewer noted the `selectCount` mock is acceptable because the contract is that user lookup is first and missing user halts before later queries.

- 2026-06-01 Wave 3 validation completed: [Task_2]
  - Summary:
    - Repository validation passed.
    - Plain `pnpm test --silent` is rejected by Turbo argument parsing; plain `pnpm test -- --silent` exposed existing resource-sensitive API import hook timeouts.
    - Used the repo's prior documented workaround `TURBO_CONCURRENCY=1 pnpm test -- --silent --maxWorkers=1` for final full test validation.
  - Validation evidence:
    - `pnpm lint:fix` passed: 9 tasks.
    - `pnpm type-check` passed: 16 tasks.
    - `pnpm test --silent` failed before tests: Turbo reports unexpected argument `--silent` and suggests `-- --silent`.
    - `pnpm test -- --silent` failed on existing API timeout-sensitive suites while the R14-H6 test passed.
    - `TURBO_CONCURRENCY=1 pnpm test -- --silent --maxWorkers=1` passed: 15 tasks, API 76 files / 712 tests.
  - Notes:
    - PR / review-hook / merge evidence is tracked in final closeout.

- 2026-06-01 Review hook issue fixed
  - Summary:
    - `gh-review-hook 434` exited 2 after CI success because Greptile requested success-path and duplicate-conflict coverage for `POST /:id/permissions`.
    - Added 201 success and 409 duplicate permission tests to the R14-H6 route test block.
    - Merged `origin/master` as requested by the hook; no history rewrite.
  - Validation evidence:
    - `pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-permissions-share-links-auth.test.ts` passed: 16 tests.
    - `pnpm lint:fix` passed: 9 tasks.
    - `pnpm type-check` passed: 16 tasks.
    - `TURBO_CONCURRENCY=1 pnpm test -- --silent --maxWorkers=1` passed: 15 tasks, API 76 files / 714 tests.
  - Notes:
    - Follow-up `gh-review-hook 434` rerun is required after pushing the fix.

- 2026-06-01 Pre-push validation alignment
  - Summary:
    - Local pre-push hook runs plain `turbo test`; API vitest parallelism hit the same existing timeout-sensitive suites that were already documented in validation.
    - First aligned `apps/api/vitest.config.ts` with the successful full-test validation by setting `maxWorkers: 1` and `fileParallelism: false`.
    - After Greptile review, removed the global API Vitest sequential setting and scoped `--maxWorkers=1` to the pre-push hook test command instead.
    - Replaced the order-dependent permission creation transaction mock with table-aware `.from()` matching.
  - Validation evidence:
    - `pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-permissions-share-links-auth.test.ts` passed: 16 tests.
    - `pnpm lint:fix` passed: 9 tasks.
    - `pnpm type-check` passed: 16 tasks.
    - `pnpm test -- --silent` passed: 15 tasks, API 76 files / 714 tests.
    - After Greptile follow-up changes:
      - `pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-permissions-share-links-auth.test.ts` passed: 16 tests.
      - `pnpm lint:fix` passed: 9 tasks.
      - `pnpm type-check` passed: 16 tasks.
      - `TURBO_CONCURRENCY=1 pnpm test -- --silent --maxWorkers=1` passed: 15 tasks, API 76 files / 714 tests.
  - Notes:
    - This keeps the hook on normal verification rather than bypassing pre-push checks.

## Decision Log
- 2026-06-01 Decision:
  - Trigger / new insight: 対象 route の実装は期待修正済みで、回帰 test が acceptance の主要不足だった。
  - Plan delta (what changed): 実装変更ではなく route-level regression test を追加して 404 body と insert 未実行を固定する。
  - Tradeoffs considered: service 層抽出は本タスク範囲外で、既存 route pattern に合わせた。
  - User approval: no separate approval requested; user explicitly delegated implementation through PR and merge.
- 2026-06-01 Decision:
  - Trigger / new insight: 補足指示により、`docs/coding-agent/lessons.md` は共有衝突しやすいため不要なら差分から外すことになった。
  - Plan delta (what changed): correction 記録はこの task plan の Decision Log に限定し、不要に作成した lessons file は削除する。
  - Tradeoffs considered: improvement-loop の記録要件は満たしたいが、ユーザー指定の ownership/scope 制約を優先して共有 lessons file への永続記録は行わない。
  - User approval: explicit correction in delegation follow-up.
- 2026-06-01 Decision:
  - Trigger / new insight: full test の通常 parallel 実行で、今回の変更と無関係な API import-heavy tests が hook/test timeout になった。
  - Plan delta (what changed): 既存 completed plan に記録済みの `TURBO_CONCURRENCY=1` と `--maxWorkers=1` を使い、同じ test body を resource-sensitive でない形で実行した。
  - Tradeoffs considered: timeout 設定や既存 test の修正は R14-H6 の scope を超えるため避けた。
  - User approval: no separate approval requested; this follows existing repo validation precedent.
- 2026-06-01 Decision:
  - Trigger / new insight: Greptile の review issue により、missing-user branch だけでなく同一 transaction handler の success / duplicate branch も固定する必要が出た。
  - Plan delta (what changed): R14-H6 test block に 201 と 409 の route tests を追加した。
  - Tradeoffs considered: production code は既に期待挙動を満たしているため、handler 全体の regression coverage の追加に留めた。
  - User approval: requested by review hook and follow-up delegation.
- 2026-06-01 Decision:
  - Trigger / new insight: pre-push hook の plain `turbo test` が API vitest の parallel execution timeout で失敗し、未push修正を残したまま進められなくなった。
  - Plan delta (what changed): API Vitest config に deterministic worker limit を追加し、local hook と通過済み full-test 条件を揃えた。
  - Tradeoffs considered: hook bypass は禁止されているため使わず、既存の timeout-sensitive suites を安定実行する test config 変更に限定した。
  - User approval: no separate approval requested; required to satisfy push/merge delegation without bypassing hooks.
- 2026-06-01 Decision:
  - Trigger / new insight: Greptile が API Vitest global sequential 設定と order-dependent transaction mock を指摘した。
  - Plan delta (what changed): API Vitest global 設定を戻し、pre-push hook の test command だけ `TURBO_CONCURRENCY=1 pnpm test -- --maxWorkers=1` に変更した。transaction mock は `.from()` の table identity で user / formPermission を判定するようにした。
  - Tradeoffs considered: global test slowdown は避け、hook bypass なしで local pre-push の安定性を確保する範囲に閉じた。
  - User approval: requested by review hook feedback.
