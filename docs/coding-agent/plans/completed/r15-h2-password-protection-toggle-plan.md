# Plan: R15-H2 Password Protection Toggle

- status: done
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: code

## Goal
- 編集画面の公開メニューで、パスワード保護 ON 時にパスワード入力と確定を必須にし、保存成功後に `password` 条件が保持されることを UI とテストで確認する。

## Definition of Done
- パスワード保護 ON は確認ダイアログ経由でのみ保存される。
- 空文字や8文字未満では有効化されず、ダイアログ内と toast に原因が出る。
- キャンセル時は入力が破棄され、既存状態へ明確にロールバックされる。
- 保存失敗時はダイアログ内と toast に同じ原因が出る。
- `formStructure` 関連 cache と publish menu 表示が保存後に stale にならない。
- 関連 unit/component test と必須コマンドが通る。

## Scope / Non-goals
- Scope:
  - `apps/web/src/hooks/forms/use-form-access-control.ts`
  - `apps/web/src/components/forms/form-publish-menu/**`
  - 必要な web test
  - UI/component-level validation evidence
- Non-goals:
  - 公開フォーム側のパスワード入力仕様変更
  - API の password hash 方式変更
  - 外部認証、role、domain access control の拡張

## Context (workspace)
- Related files/areas:
  - 指定の `apps/web/src/components/forms/form-access-control.tsx` と `apps/web/src/routes/forms.$id.edit.tsx` は現行ツリーに存在せず、実体は hook と `_authenticated/forms/$id/edit.tsx` および publish menu 配下に分割済み。
  - `apps/web/src/hooks/forms/form-structure-query-keys.ts` は R3-C10 の `formStructure` key 分離済み。
- Existing patterns or references:
  - shadcn/Radix `Dialog`、`Input`、`Button` と `sonner` toast。
  - React Query mutation 成功時に query invalidation。
- Repo reference docs consulted:
  - `/Users/xpadev/.codex/plugins/cache/agent-harness/coding-agent-orchestration-harness/0.4.0/skills/orchestration-harness/SKILL.md`
  - `/Users/xpadev/.codex/plugins/cache/agent-harness/coding-agent-orchestration-harness/0.4.0/skills/plan-format/SKILL.md`
  - `/Users/xpadev/.codex/plugins/cache/agent-harness/coding-agent-orchestration-harness/0.4.0/skills/engineering-quality-baselines/SKILL.md`

## Open Questions (max 3)
- Q1: API route 直接テストを追加する必要があるか。
- Q2: Browser の認証状態が無い場合、component-level evidence で代替するか。

## Assumptions
- A1: ユーザーが実装・検証・PR・merge まで委任しているため、Plan Gate の明示承認は Orchestrator waiver とする。
- A2: API は既に `enabled` かつ password 不在を拒否するため、主修正は frontend の確定フローとテストに置く。

## Tasks

### Task_1: Access-Control Save And Cache Flow
- type: impl
- owns:
  - apps/web/src/hooks/forms/use-form-access-control.ts
  - apps/web/src/hooks/forms/**/*.test.*
- depends_on: []
- description: |
  パスワード保護保存後に必要な formStructure 関連 cache と差分表示が更新されることを保証する。
- acceptance:
  - access-control PATCH 成功後に access-control query が invalidated される。
  - logic structure、form diff、unpublished changes の stale 表示が残らない。
  - 保存失敗時の原因が呼び出し側で取得できる。
- validation:
  - kind: unit
    required: true
    owner: worker
    detail: "access-control hook または周辺の focused test で invalidation と error propagation を確認する"

### Task_2: Password Dialog Enable Flow
- type: impl
- owns:
  - apps/web/src/components/forms/form-publish-menu/**
- depends_on: [Task_1]
- description: |
  toggle ON では直接保存せず入力モーダルを開き、確定時だけ password を payload に含めて保存する。キャンセルと失敗時の rollback/error 表示を明確にする。
- acceptance:
  - Switch ON は enable dialog を開くだけで mutation しない。
  - パスワード未入力での新規有効化は拒否され、dialog alert と toast に出る。
  - 確定時のみ `{ enabled: true, password: ... }` が保存される。
  - キャンセル時は switch 表示が保存済み状態に戻り、入力が残らない。
  - 保存失敗時は dialog alert と toast に同じ原因が出る。
- validation:
  - kind: component
    required: true
    owner: worker
    detail: "publish menu/model の component or hook test で enable/cancel/failure を確認する"

### Task_3: Required Validation And UI Evidence
- type: test
- owns:
  - apps/web/src/**/*.test.*
  - .playwright-cli/**
- depends_on: [Task_2]
- description: |
  focused tests と必要な UI/component evidence を実行し、repo 必須コマンドを通す。
- acceptance:
  - focused web tests が通る。
  - `pnpm lint:fix`, `pnpm type-check`, `pnpm test --silent` が通る。Turbo 都合で失敗する場合は指定フォールバックを記録する。
  - Browser 認証が詰まる場合は component-level evidence と理由を明示する。
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
    detail: "pnpm test --silent or pnpm test -- --silent"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Browser or component-level evidence for password ON -> save -> reload-equivalent retention"

### Task_4: Independent Review And PR Closeout
- type: review
- owns: []
- depends_on: [Task_3]
- description: |
  独立 reviewer で差分と evidence を確認し、PR 作成後 `gh-review-hook` を exit 0 まで回して merge する。
- acceptance:
  - Reviewer status が APPROVED。
  - PR が作成されている。
  - `gh-review-hook <PR番号>` が exit 0。
  - merge commit が記録される。
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "acceptance criteria, tests, UI evidence review"
  - kind: command
    required: true
    owner: orchestrator
    detail: "gh-review-hook <PR番号>"

## Task Waves (explicit parallel dispatch sets)

- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]
- Wave 4 (parallel): [Task_4]

## E2E / Visual Validation Spec

- provider: Browser plugin if auth/local app setup is available; otherwise component-level Vitest/jsdom evidence.
- artifact_root: `.playwright-cli/` when browser evidence is produced.
- base_url: `http://localhost:3000`
- app_start_command: `pnpm dev` if full app validation is feasible.
- readiness_check: web app responds on port 3000.
- flows:
  - Open edit form publish menu.
  - Toggle password protection ON.
  - Confirm dialog opens and switch is not saved yet.
  - Empty submit shows inline error and toast.
  - Valid password submit calls save and reload-equivalent data shows enabled with `hasPassword`.
  - Cancel closes dialog and restores saved state.
- viewports:
  - desktop 1280x800 minimum if browser validation runs.
- evidence_requirements:
  - test output and, if browser runs, screenshot or trace path.
- known_flakiness:
  - Auth/session state may block full route validation; component-level evidence is acceptable with explicit note.

## Rollback / Safety
- Revert only files touched by this branch. Do not modify unrelated user changes or `docs/coding-agent/lessons.md`.

## Progress Log (append-only)

- 2026-06-01 00:00 Wave 0 completed: [research]
  - Summary: Researcher identified current implementation paths, dialog/toast patterns, query key separation, and test gaps.
  - Validation evidence: Research report from subagent `019e8204-9167-75e3-9c8d-670ad944fabc`.
  - Notes: Repo rule suite absent in this worktree; harness skill and AGENTS/CLAUDE instructions used.
- 2026-06-01 16:40 Wave 1-2 completed: [Task_1, Task_2]
  - Summary: Password enable flow now rejects blank/whitespace passwords before mutation, clears stale dialog errors before save, and invalidates access-control, logic, diff, and unpublished-change caches after save.
  - Validation evidence: `rtk pnpm --filter @nexus-form/web exec vitest run src/hooks/forms/use-form-access-control.test.tsx src/components/forms/form-publish-menu.test.tsx` passed with 6 tests.
  - Notes: Full browser route validation was not run because auth/session setup is not available in this delegated worktree; component-level jsdom evidence covers the required ON -> save -> reload-equivalent retention flow.
- 2026-06-01 16:42 Wave 3 completed: [Task_3]
  - Summary: Required repo validation completed.
  - Validation evidence: `rtk pnpm lint:fix` passed; `rtk pnpm type-check` passed; `rtk pnpm test --silent` failed because Turbo rejects pass-through-less `--silent`; `rtk pnpm test -- --silent` passed.
  - Notes: Focused tests and full web test run include password dialog component-level evidence.
- 2026-06-01 16:42 Wave 4 completed: [Task_4]
  - Summary: Independent Reviewer approved the diff and reran focused tests.
  - Validation evidence: Reviewer `019e821e-1af1-7de0-82cb-30d842ab99a7` status `APPROVED`; reviewer command `rtk pnpm --filter @nexus-form/web exec vitest run src/hooks/forms/use-form-access-control.test.tsx src/components/forms/form-publish-menu.test.tsx` passed.
  - Notes: Reviewer suggested adding whitespace-only evidence; added and validated.

## Decision Log (append-only; re-plans and major discoveries)

- 2026-06-01 00:00 Decision:
  - Trigger / new insight: User delegated implementation through merge and requested no blocking parent orchestration.
  - Plan delta (what changed): Plan approval is waived by Orchestrator; execution proceeds directly.
  - Tradeoffs considered: Waiting for explicit approval would conflict with delegated implementation request.
  - User approval: waived; delegation prompt is treated as implementation authorization.

## Notes
- Risks:
  - `useFormAccessControl` hook-level toast and model-level toast can duplicate failure messages.
  - Snapshot/cache paths may need targeted invalidation to avoid stale publish menu state.
- Edge cases:
  - Existing disabled password may be reusable only when `hasPassword` is true.
  - Empty hint and omitted hint have different persistence semantics.
