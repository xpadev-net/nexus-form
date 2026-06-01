# Plan: R23-L3 Safe QA Environment Docs

- status: in_progress
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: docs

## Goal
- 共有リンク作成、メール招待、Google Sheets 同期、スケジュール保存を、本番データや実外部サービスに触れずに検証するための安全な QA 手順を文書化する。

## Definition of Done
- 専用テストアカウント、テスト Google Sheet、テストメール受信先、短時間スケジュール用フォームの準備手順が明確である。
- 共有リンク作成、招待送信、権限変更/削除、Sheets 同期、スケジュール公開/非公開/スナップショット切替を安全に確認する手順がある。
- 実秘密情報、本番データ、実外部サービスを使わない前提と禁止事項が明記されている。
- docs-only 変更として、runtime/code/schema/env 値を変更しない。
- Independent Reviewer が承認し、PR 作成後に `gh-review-hook` が exit 0 になる。

## Scope / Non-goals
- Scope:
  - `docs/operations.md`
  - `e2e/README.md`
  - `docs/task-verification/r23-l3.md`
  - plan lifecycle file
- Non-goals:
  - hCaptcha / HCAPTCHA / `VITE_DISABLE_HCAPTCHA` / `FORM_SECURITY_DEV_BYPASS` 周辺の変更。
  - runtime behavior、DB schema、CI、package、実テストデータ投入の変更。
  - 実 Google OAuth 認証情報、実メール送信先、実 production Sheet、秘密情報の追加。
  - `docs/coding-agent/lessons.md` の更新。

## Context (workspace)
- Related files/areas:
  - `.env.example`: Google OAuth/Sheets、invite、schedule の非秘密テンプレート。
  - `e2e/README.md`: Playwright 実行前提と helper 説明。
  - `docs/operations.md`: 運用メモ置き場。
  - `docs/task-verification/*.md`: タスク別検証台帳の既存パターン。
- Existing patterns or references:
  - Researcher 調査で、専用 `e2e/fixtures/` は未検出。既存 E2E は helper と inline fixture 中心。
  - R23-L3 は docs-only で小さく完了可能。fixture 新設は不要と判断。
- Repo reference docs consulted:
  - `CLAUDE.md`
  - `README.md`
  - `.env.example`
  - `e2e/README.md`
  - `docs/operations.md`

## Open Questions (max 3)
- Q1: なし。

## Assumptions
- A1: R23-L3 の source of truth は委譲文であり、この worktree に `z/tasks.md` は存在しない。
- A2: 「可能なら E2E 設定/fixture の雛形」は、既存 E2E README への非秘密 QA fixture 方針の追記で満たす。runtime に読み込まれる fixture ファイルは作らない。
- A3: ユーザーが PR/merge まで明示しているため、plan approval は委譲文で承認済みとして扱う。

## Tasks

### Task_1: QA 手順 docs 追加
- type: docs
- owns:
  - `docs/operations.md`
  - `e2e/README.md`
  - `docs/task-verification/r23-l3.md`
- depends_on: []
- description: |
  R23-L3 の安全 QA 手順と検証台帳を docs-only で追加する。
- acceptance:
  - 専用テストアカウント、テスト Google Sheet、テストメール受信先、短時間スケジュール用フォームの準備手順がある。
  - 共有リンク、招待、Sheets 同期、スケジュール保存の安全な確認手順がある。
  - 本番データ、実秘密情報、外部サービス実接続を避ける禁止事項が明確である。
  - hCaptcha 関連が対象外であり変更しないことが明記されている。
  - docs-only 変更として full test waiver の根拠が記録されている。
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "`rtk git diff --check`"
  - kind: manual
    required: true
    owner: worker
    detail: "変更差分に秘密情報らしい値や hCaptcha 関連変更がないことを確認"
  - kind: command
    required: false
    owner: worker
    detail: "`rtk pnpm lint:fix`, `rtk pnpm type-check`, `rtk pnpm test -- --silent` は docs-only waiver 可"

### Task_2: Independent review
- type: review
- owns: []
- depends_on: [Task_1]
- description: |
  R23-L3 の受け入れ条件、docs-only waiver、秘密情報混入リスクを独立レビューする。
- acceptance:
  - Reviewer status が APPROVED である。
  - 指摘がある場合は修正して再レビューする。
  - hCaptcha 関連が未変更であることを確認する。
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Diff review vs R23-L3 acceptance criteria"

### Task_3: PR hook and merge
- type: chore
- owns: []
- depends_on: [Task_2]
- description: |
  Orchestrator が commit、push、PR 作成、`gh-review-hook`、merge を実行する。
- acceptance:
  - PR URL がある。
  - `gh-review-hook <PR番号>` が exit 0 で完了している。
  - PR が merge 済みで merge commit を記録している。
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "`gh-review-hook <PR番号>` exit 0"
  - kind: command
    required: true
    owner: orchestrator
    detail: "PR merge commit を確認"

## Task Waves (explicit parallel dispatch sets)

- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]

## Rollback / Safety
- docs-only 変更のため、該当 docs と plan file の revert で戻せる。
- `.env.example` の値や runtime code は変更しないため、実環境への影響はない。

## Progress Log (append-only)

- 2026-06-01 00:00 Wave 0 completed: planning/research
  - Summary: Researcher が既存 docs/env/e2e パターンと対象機能の関連箇所を調査。R23-L3 は docs-only で完了可能と判断。
  - Validation evidence: read-only research report; `z/tasks.md` は worktree 内に存在せず。
  - Notes: repo rule suite `docs/coding-agent/rules/` は未検出。
- 2026-06-01 00:00 Wave 1 completed: [Task_1]
  - Summary: Worker が R23-L3 の安全 QA 手順を docs-only で追加。Orchestrator が受け入れ条件を照合し、権限変更/削除と公開/非公開/スナップショット切替の手順を追記。
  - Validation evidence: Worker `rtk git diff --check` pass、秘密情報/hCaptcha 関連変更なし確認 pass。Orchestrator 追記後も `rtk git diff --check` pass、secret/hCaptcha scan は placeholder と対象外明記のみ。
  - Notes: docs-only waiver 可能な範囲だったが、PR 前確認として full validation も実行。
- 2026-06-01 00:00 Wave 2 completed: [Task_2]
  - Summary: Independent Reviewer が受け入れ条件、秘密情報混入リスク、hCaptcha 未変更、docs-only waiver をレビューし APPROVED。
  - Validation evidence: Reviewer status APPROVED、Findings なし。Orchestrator validation: `rtk pnpm lint:fix` pass、`rtk pnpm type-check` pass、`rtk pnpm test -- --silent` pass。
  - Notes: 実際の外部 QA 実施は手動手順依存で、自動 E2E 実装はスコープ外。

## Decision Log (append-only; re-plans and major discoveries)

- 2026-06-01 00:00 Decision: docs-only で実施
  - Trigger / new insight: 既存 E2E fixture 専用ディレクトリはなく、runtime に読まれる fixture を追加しなくても QA 手順は満たせる。
  - Plan delta (what changed): `.env.example` や code は変更せず、docs と検証台帳に限定する。
  - Tradeoffs considered: fixture ファイル新設は将来の E2E 実装には有用だが、今回の安全手順整備ではスコープ拡大になる。
  - User approval: yes; 委譲文で小さく完了、PR/merge まで明示。

## Notes
- Risks:
  - Google Sheets とメールは外部サービス依存のため、実接続は禁止し、テスト専用リソースまたは stub/mock 前提を明記する。
- Edge cases:
  - 招待メール送信実装は存在するが使用箇所が限定的なため、QA 手順ではメール本文/リンク生成とテスト受信先の扱いを分離する。
