# R26-M2 story fixture generator

## 目的

R26-M2 の 30 story ledger を、local/staging で再実行できる QA fixture として固定する。生成されるフォーム名は必ず `Codex Story QA 2026-06-04 Sxx` 形式になり、cleanup も同じ明示 prefix に限定する。

## 実行コマンド

dry-run:

```bash
pnpm --filter @nexus-form/api exec tsx ../../scripts/story-fixture-generator.ts --dry-run --sample-responses
```

local 生成:

```bash
NEXUS_FORM_API_TOKEN=<owner-write-or-admin-token> \
NEXUS_FORM_API_URL=http://localhost:3001 \
NEXUS_FORM_WEB_URL=http://localhost:3000 \
pnpm --filter @nexus-form/api exec tsx ../../scripts/story-fixture-generator.ts --sample-responses
```

staging 生成:

```bash
NEXUS_FORM_API_TOKEN=<staging-owner-write-or-admin-token> \
NEXUS_FORM_API_URL=https://staging.example.com \
NEXUS_FORM_WEB_URL=https://staging-web.example.com \
pnpm --filter @nexus-form/api exec tsx ../../scripts/story-fixture-generator.ts --env=staging --confirm-staging --sample-responses
```

cleanup:

```bash
NEXUS_FORM_API_TOKEN=<same-owner-write-or-admin-token> \
pnpm --filter @nexus-form/api exec tsx ../../scripts/story-fixture-generator.ts \
  --dry-run \
  --cleanup \
  --confirm-cleanup="Codex Story QA 2026-06-04"
```

削除対象を確認した後に `--dry-run` を外す:

```bash
NEXUS_FORM_API_TOKEN=<same-owner-write-or-admin-token> \
pnpm --filter @nexus-form/api exec tsx ../../scripts/story-fixture-generator.ts \
  --cleanup \
  --confirm-cleanup="Codex Story QA 2026-06-04"
```

## 安全策

- `--env local` は localhost API のみ許可する。
- `--env staging` は hostname に `staging` または `stage` を含み、かつ `--confirm-staging` が必要。
- prefix は `Codex Story QA` で始まり、日付などの run marker を含む長さが必要。
- cleanup は `--confirm-cleanup=<prefix>` が完全一致しない限り実行しない。
- cleanup 対象は API token 所有者が見えるフォームのうち、title が prefix で始まるものだけ。
- cleanup dry-run も実 API から同じ prefix 対象を列挙するため、表示された対象と本実行の削除対象が一致する。
- 削除は直接 DB ではなく既存 `DELETE /api/forms/:id` を使うため、既存 route の cascade cleanup と権限チェックを通る。

## 生成フロー

1. `GET /api/forms` で同一 title の既存 fixture を探す。
2. なければ `POST /api/forms`、あれば `PUT /api/forms/:id` で metadata を同期する。
3. `GET/PUT /api/forms/:id/content` で Plate content を保存する。
4. `GET /api/forms/:id/structure` で現在値を確認し、差分がある場合だけ `PUT /api/forms/:id/structure` で settings/confirmation などを保存する。
5. S03/S15/S26 は password が未設定の場合だけ `PATCH /api/forms/:id/structure/access-control` で password hash を API に作らせる。
6. `POST /api/forms/:id/snapshots` で snapshot を作る。既存 active snapshot がある場合は新 version を `activate` してから publish する。
7. `POST /api/forms/:id/publish` で公開する。
8. `--sample-responses` 指定時は fixture 専用 respondent UUID の回答を探し、既存回答は `PUT /api/forms/:id/responses/:responseId` で payload を同期、重複は `DELETE`、未作成なら `POST /api/forms/:id/responses` で 1 件作る。

サンプル回答は public submit ではなく owner/editor responses API を使う。理由は public submit が hCaptcha/telemetry を必須にしており、local/staging の fixture 生成で real credential や browser token を CLI に持ち込まないため。回答 payload は同じ response schema と form plateContent 由来の validator を通り、管理画面の回答一覧、CSV、analytics の QA に使える実 `formResponse` 行として保存される。

## zod 検証

`packages/shared/src/validation/story-fixture.ts` が次を検証する。

- S01-S30 が重複なく全件存在する。
- title が明示 prefix で始まる。
- block id が story 内で重複しない。
- block type と validation.type が一致する。
- structure logic の source/condition/target が既存 block id を参照する。
- sample response の question_id / question_type が answerable block と一致する。
- radio/dropdown/checkbox/grid の sample response 値が fixture の option/row/column id と一致する。

## 出力

生成後は TSV で次を一覧出力する。

| 列 | 内容 |
|---|---|
| story | S01-S30 |
| formId | 管理画面で使う form ID |
| publicUrl | `/forms/public/:publicId` の URL |
| responseIds | `--sample-responses` で作成または再利用した回答 ID |
| verificationTargets | その story で確認する機能 |

## 管理画面 QA

- `formId` を管理画面で開き、編集、snapshot 履歴、公開状態、設定タブを確認する。
- `publicUrl` を開き、公開 snapshot が表示されることを確認する。
- `responseIds` がある場合は回答一覧、回答詳細、CSV export、analytics に同じ回答が見えることを確認する。
- S03/S15/S26 の password は `codex-story-qa`。証跡には password/token/API token/実 Sheet ID/メール/webhook URL を残さない。
- Sheets、mock validation provider、実 notification はこの fixture では credential smoke しない。各 story のフォーム構造と管理画面操作面だけを確認し、credential 実連携は R26-M3 に分離する。

## 検証

- `pnpm --filter @nexus-form/shared exec vitest run src/__tests__/story-fixture.test.ts`
- `pnpm --filter @nexus-form/api exec tsx ../../scripts/story-fixture-generator.ts --dry-run --sample-responses`
