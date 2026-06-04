# R26-M3 external integration smoke

## 目的

R26-M2 の `Codex Story QA 2026-06-04 Sxx` 専用フォームを使い、外部 credential 依存の story を安全に再確認する。実 credential は opt-in とし、CI では credential なしでも deterministic に通る mock/focused tests を優先する。

この worktree では `DISCORD_BOT_TOKEN`、`TWITTER_BEARER_TOKEN`、`GITHUB_*`、`GOOGLE_*`、`NEXUS_FORM_API_TOKEN`、`VALIDATION_PLUGINS_DIR` が未設定だったため、実 credential smoke は skip。代替として下記 mock smoke と既存 focused tests で Queue、SSE helper、回答詳細に渡る状態を確認する。

## CI / credential なし mock smoke

| story | 専用フォーム観点 | mock 結果 | テスト |
|---|---|---|---|
| S04 | 外部検証 success が story 専用 `formId` で記録される | `COMPLETED` 相当、`success: true`、metadata に story marker | `apps/worker/src/handlers/__tests__/generic-validation.test.ts` の `R26-M3専用フォーム方式...` |
| S05 | 外部検証 failure が回答詳細で説明可能な error code/message を残す | `FAILED` 相当、`MOCK_PERMISSION_DENIED` | 同上 |
| S06 | retryable/rate limit が保留として delayed retry される | `PROCESSING` 維持、job delay、最終結果は未書き込み | 同上 |
| S17 | 回答詳細の再検証 job が同じ result を更新できる | retry job id で `success: true` | 同上 |
| S11 | Sheets 書き込みは row append と auth failure を worker focused tests で確認 | row append / `AUTH_REQUIRED` failure | `apps/worker/src/handlers/__tests__/sheets-sync.test.ts` |
| S15 | API token は対象フォームの `authenticateDualForForm` / permission guard だけ通り、権限外フォームは拒否 | scoped token allow / deny | `apps/api/src/__tests__/dual-auth-cross-tenant.test.ts` |

実行コマンド:

```bash
pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/generic-validation.test.ts -t R26-M3
pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/sheets-sync.test.ts
pnpm --filter @nexus-form/api exec vitest run src/__tests__/dual-auth-cross-tenant.test.ts
```

## 実 credential smoke の opt-in 手順

1. R26-M2 手順で `Codex Story QA 2026-06-04` fixture を local/staging に作る。API token、Sheet ID、guild ID、user handle、webhook URL は shell history や docs に残さない。
2. API と Worker の両方に同じ `VALIDATION_PLUGINS_DIR` と必要 credential を設定して再起動する。起動ログでは provider 名と plugin hash の一致だけを記録する。
3. S04/S05/S06/S17 の公開フォームから success、not found/permission denied、rate limit/retryable、再検証を送信する。証跡には `story`、redacted `formId`、`responseId`、`validationResultId`、`jobId`、status だけを残す。
4. S11 は回答送信後に Sheets 側で 1 行増えることを確認する。失敗ケースは Google OAuth credential を外すか失効させ、Worker が `AUTH_REQUIRED` を残し、作成者側で sync job/error state を追えることを確認する。
5. S15 は form-scoped read token で対象 fixture の responses endpoint だけ取得し、別 fixture formId では 403/404 系の拒否になることを確認する。

## 観測ポイント

- Queue: API submit/retry 後に `${provider}-validation`、Sheets は `google-sheets-sync` に job が入る。証跡は job id と queue name のみ。
- Worker: `markValidationProcessing` で `PROCESSING`、`writeValidationResult` で `COMPLETED` / `FAILED` / `MISSING` を書く。Sheets は append 成功、duplicate、`AUTH_REQUIRED` を区別する。
- SSE: validation result 更新時に対象 `formId` の validation channel へ status change が publish される。接続数や event id は可、credential や外部 ID は不可。
- 回答詳細: success metadata、errorCode/errorMessage、再検証後の job id が見えることを確認する。実ユーザー名、guild ID、Sheet ID、token、webhook URL は redaction する。

## 完了判定

- credential なしの focused mock tests が pass する。
- 実 credential がない場合は skip 理由を上記のように明記し、mock 代替結果を残す。
- 実 credential 実行時も secret 値や外部個人 ID を repo、PR、ログ抜粋に残さない。
