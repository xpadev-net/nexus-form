# R25-M3 appearance and brand settings verification

## Scope

作成者の設定タブにある外観設定で、質問番号、テーマ/ブランド色、ブランド名/ロゴ、余白/レイアウトの範囲を確認する。公開フォーム全体の再設計は行わず、R24-M5 の appearance 実装を主要導線から理解しやすくする最小差分に留める。

## Evidence

| 観点 | 確認方法 |
|------|----------|
| 設定範囲 | `apps/web/src/components/forms/form-appearance-settings.test.tsx` で「テーマとブランド」「レイアウトと質問番号」のコピー表示を確認 |
| プレビュー反映 | 同テストで primary color / brand name / question numbers が未保存でもライブプレビューへ即時反映されることを確認 |
| 公開 snapshot 反映 | 同テストで保存 payload が `PATCH /:id/structure/appearance` の `appearance` のみであり、UI copy が `structure.appearance` と次回公開 snapshot 反映を明示することを確認 |
| 低コントラスト警告 | 同テストで低コントラスト色の警告と、回答者に読みづらくなる可能性の注意文を確認 |
| mobile / desktop 幅 | 同テストで preview viewport の `desktop` / `mobile` 切替を確認。`apps/web/src/components/forms/form-body.test.tsx` で質問番号表示、long_text 質問種別、複数ページ navigation / submit button が既存の公開フォーム描画で回帰しないことを確認。jsdom では実ピクセルの重なりは検出できないため、今回の差分はコピーと状態表示に限定し、公開フォーム全体の responsive 再設計は行わない |
| 公開フォーム反映 | `apps/web/src/components/forms/public-form-page.test.tsx` と `apps/web/src/components/forms/form-preview-page.test.tsx` で structure / snapshot の appearance が `FormBody` に渡る既存経路を確認 |

## Commands

- `pnpm --filter @nexus-form/shared build`
- `pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-appearance-settings.test.tsx src/components/forms/form-body.test.tsx src/components/forms/form-preview-page.test.tsx src/components/forms/public-form-page.test.tsx`
- `pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-structure-appearance-route.test.ts`
- `pnpm lint:fix`
- `pnpm type-check`
- `pnpm test --silent` または Turbo 引数仕様により失敗した場合は `pnpm test -- --silent`
