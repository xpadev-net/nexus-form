# R25-L2 Public URL Copy Surface

## Scope

- 設定タブに現在の公開 URL 表示とコピー操作を常設。
- 再生成成功後の toast / 新 URL 表示で、旧 URL 無効化と既存回答維持を明示。
- 共有タブの現在 URL 表示とヘッダーの公開フォーム open action を同じ URL helper に統一。
- 公開 URL 404 copy に「URL が再生成された可能性」を追加し、token や存在確認につながる情報は表示しない。

## Evidence

| 観点 | 自動検証 |
|---|---|
| 設定タブ常設 copy | `apps/web/src/components/forms/form-public-url-settings.test.tsx` |
| 再生成後の新 URL / cache 更新 / copy | `apps/web/src/components/forms/form-public-url-settings.test.tsx` |
| ヘッダー URL action | `apps/web/src/components/forms/form-editor-page.test.tsx` |
| 共有タブ URL 表示 / copy | `apps/web/src/components/forms/form-sharing-section-public-url.test.tsx` |
| 旧 URL 404 copy | `apps/web/src/components/forms/public-form-page.test.tsx` |
| 旧 URL 無効・新 URL 有効・既存回答維持 | `apps/api/src/__tests__/forms-public-url-regeneration-route.test.ts` |

## Manual QA Notes

- 実ブラウザでは公開 URL 再生成後、ヘッダーの「公開フォームを開く」、設定タブの現在 URL、共有タブの現在 URL が同じ新 URL を指すことを確認する。
- 旧 URL へアクセスした場合は汎用 404 として表示され、最新 URL をフォーム管理者に確認する案内だけが出る。
