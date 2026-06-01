# R23-M2 Toolbar Accessible Names Plan

## Goal

編集ツールバー / Plate controls のアイコン専用ボタンに accessible name を付与し、主要操作を role/name で取得できるようにする。

## Scope

- `apps/web/src/components/ui` 配下の toolbar 共通部品と、list/media split toolbar button の名前補完。
- エディタ挙動、デザイン、Plate plugin 構成は変更しない。

## Task Waves

- Wave 1: Task_1
- Wave 2: Task_2
- Wave 3: Task_3

## Task_1: Toolbar Common Accessible Name Support

- type: impl
- owns:
  - `apps/web/src/components/ui/toolbar.tsx`
- depends_on: []
- acceptance:
  - `ToolbarButton` が `aria-label` / `aria-labelledby` 未指定かつ string tooltip の場合、tooltip と同じ accessible name を持つ。
  - 既存の明示 accessible name は上書きしない。
  - pressed/toggle variant と通常 button の両方で同じ補完が効く。
- validation:
  - kind: test
    required: true
    owner: worker
    detail: `ToolbarButton` を role/name で取得できる component test を追加する。

## Task_2: Split Toolbar Button Names

- type: impl
- owns:
  - `apps/web/src/components/ui/list-toolbar-button.tsx`
  - `apps/web/src/components/ui/media-toolbar-button.tsx`
  - `apps/web/src/components/ui/more-toolbar-button.tsx`
- depends_on:
  - Task_1
- acceptance:
  - Bulleted list / Numbered list の primary と options button が role/name で識別できる。
  - Image media split button の primary と options button が role/name で識別できる。
  - More toolbar の tooltip/name が Insert と衝突しない。
- validation:
  - kind: test
    required: true
    owner: worker
    detail: split button primary/options を role/name で取得する component test を追加する。

## Task_3: Main Toolbar Regression Tests

- type: test
- owns:
  - `apps/web/src/components/ui/toolbar.test.tsx`
- depends_on:
  - Task_1
  - Task_2
- acceptance:
  - Undo / Redo / Insert / Bold 相当の主要 icon-only toolbar operation が role/name で取得できることを固定する。
  - テストは Plate editor runtime に依存しない最小 component-level evidence とする。
- validation:
  - kind: command
    required: true
    owner: worker
    detail: `rtk pnpm --filter @nexus-form/web exec vitest run src/components/ui/toolbar.test.tsx -- --silent`
  - kind: command
    required: true
    owner: orchestrator
    detail: `rtk pnpm lint:fix`, `rtk pnpm type-check`, `rtk pnpm test -- --silent`
  - kind: review
    required: true
    owner: reviewer
    detail: 独立 Reviewer が変更と検証結果を確認する。

## Progress Log

- 2026-06-01: Researcher 調査完了。共通 `ToolbarButton` 補完と split button 明示名が最小方針。
- 2026-06-01: Task_1/Task_2/Task_3 実装完了。component-level role/name regression test を追加。
- 2026-06-01: Reviewer APPROVED。指摘なし。任意整理として media config の未使用 `tooltip` を削除。
- 2026-06-01: `rtk pnpm --filter @nexus-form/web exec vitest run src/components/ui/toolbar.test.tsx -- --silent`, `rtk pnpm lint:fix`, `rtk pnpm type-check`, `rtk pnpm test -- --silent` が pass。

## Decision Log

- User approval waived: 親スレッドから本 worktree で R23-M2 を小さく完了する明示依頼があるため、計画承認待ちは省略する。
- UI/browser evidence: 認証付き editor flow ではなく、component-level role/name test を evidence とする。
