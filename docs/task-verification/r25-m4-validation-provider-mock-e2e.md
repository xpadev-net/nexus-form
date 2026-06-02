# R25-M4 external validation provider mock E2E verification

## 目的

Discord / GitHub / Twitter/X の外部検証プロバイダーについて、実 credential を CI に置かずに成功・失敗・保留・再検証を回帰確認できる状態を維持する。実サービス credential が必要な確認は手動 QA として分離し、credential や実アカウント値は repo に記録しない。

## CI で確認する mock / fixture

| 項目 | テスト |
|------|--------|
| Worker handler の provider 選択後の成功・失敗・保留・再検証 | `pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/generic-validation.test.ts` の `credentialなしmock providerでworker handlerの成功・失敗・保留・再検証状態を再現できる` |
| API enqueue / retry claim | `pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-public-validation-outbox.test.ts src/__tests__/validation-retry-bulk-update.test.ts` |
| Worker DB/SSE write helper | `pnpm --filter @nexus-form/worker exec vitest run src/lib/__tests__/validation-helpers.test.ts` |
| Discord fixture | `pnpm --filter @nexus-form/validation-provider-discord test` |
| GitHub mocked client fixture | `pnpm --filter @nexus-form/validation-provider-github test` |
| Twitter/X mocked client fixture | `pnpm --filter @nexus-form/validation-provider-twitter test` |
| Provider 入力ガイド・必須設定・権限不足ヒント | `pnpm --filter @nexus-form/api exec vitest run src/__tests__/validation-providers-route.test.ts` |

CI fixture は外部 API を呼ばない。Discord は `fetch` mock、GitHub / Twitter は client mock を使い、成功 metadata、存在しないユーザー、rate limit / retryAfter、認証・権限不足、malformed upstream response を検証する。

## 手動 mock E2E

1. `.env.local` と `.env` にローカル MySQL / Redis / MinIO の placeholder credential を設定する。実 Discord / GitHub / Twitter credential は不要。
2. repo 外の一時ディレクトリに mock provider を置く。外部 plugin は自己完結 `.mjs` と `plugins.lock` が必須なので、ここでは `zod` などの bare import を使わない最小 schema を同梱する。

```bash
mkdir -p /tmp/nexus-form-validation-plugins
chmod 755 /tmp/nexus-form-validation-plugins
cat >/tmp/nexus-form-validation-plugins/mock-external-provider.mjs <<'EOF'
const inputSchema = {
  parse(value) {
    if (typeof value !== "string" || !/^[a-z_]+$/.test(value)) {
      throw new Error("Mock input must be lowercase letters and underscores.");
    }
    return value;
  }
};

const configSchema = {
  parse(value) {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Mock config must be an object.");
    }
    return {};
  }
};

const metadataSchema = {
  safeParse(value) {
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      return { success: true, data: value };
    }
    return { success: false, error: new Error("Mock metadata must be an object.") };
  }
};

const rule = {
  name: "user_state",
  label: "Mock user state",
  description: "Credential-free external validation mock for R25-M4 QA.",
  inputHint: "valid_user, missing_user, permission_denied, or rate_limited",
  inputPattern: "^[a-z_]+$",
  patternTemplate: {
    id: "mock_external",
    displayName: "Mock External",
    description: "R25-M4 credential-free fixture",
    errorMessage: "Use one of the documented mock usernames.",
    placeholder: "valid_user",
    pattern: "^[a-z_]+$",
    externalService: "mock_external"
  },
  inputSchema,
  configSchema,
  metadataSchema,
  async validate(input) {
    if (input === "valid_user") {
      return { isValid: true, metadata: { fixtureCase: "success" } };
    }
    if (input === "rate_limited") {
      return {
        isValid: false,
        errorCode: "MOCK_RATE_LIMIT",
        errorMessage: "Mock provider is temporarily rate limited",
        retryAfter: 30,
        retryable: true
      };
    }
    if (input === "permission_denied") {
      return {
        isValid: false,
        errorCode: "MOCK_PERMISSION_DENIED",
        errorMessage: "Mock provider permission denied",
        retryable: false
      };
    }
    return {
      isValid: false,
      errorCode: "MOCK_USER_NOT_FOUND",
      errorMessage: `Mock user not found: ${input}`,
      retryable: false
    };
  }
};

export default {
  name: "mock_external",
  label: "Mock External",
  description: "Credential-free external validation mock for R25-M4 QA.",
  rules: { user_state: rule }
};
EOF

HASH="$(shasum -a 256 /tmp/nexus-form-validation-plugins/mock-external-provider.mjs | awk '{print $1}')"
printf '{"plugins":{"mock-external-provider.mjs":"%s"}}\n' "$HASH" >/tmp/nexus-form-validation-plugins/plugins.lock
```

3. API と Worker の両方に同じ `VALIDATION_PLUGINS_DIR=/tmp/nexus-form-validation-plugins` を設定して起動する。Worker は `mock_external-validation` queue を処理対象に含める。起動ログに `Loaded plugin "mock_external"` と同一 SHA-256 が API / Worker の両方で出ることを確認する。
4. Web で QA 用フォームを作成し、短文 question を 1 つ追加する。
5. 検証ルールで provider `mock_external`、rule `user_state`、参照 block に上記 question を選択する。
6. 公開後、公開フォームから次の入力で回答する。

| 入力 | 期待結果 |
|------|----------|
| `valid_user` | 結果が `PROCESSING` から `COMPLETED` / success `true` になり、回答詳細に成功 metadata が表示される |
| `missing_user` | `FAILED` / success `false`、失敗理由 `MOCK_USER_NOT_FOUND` と message が回答詳細に表示される |
| `permission_denied` | `FAILED` / success `false`、権限不足系の理由 `MOCK_PERMISSION_DENIED` が回答詳細に表示される |
| `rate_limited` | いったん `PROCESSING` のまま delayed retry され、上限到達後は `MOCK_RATE_LIMIT` または retry exhausted として失敗理由が表示される |

## Queue / SSE / 結果反映の確認観点

- フォーム送信時、API は `external_service_validation_result` に `PENDING` 行を作成し、`mock_external-validation` に job を enqueue する。
- Worker 開始時、`markValidationProcessing` により `PROCESSING` へ更新され、`validation_status_changed` SSE が publish される。
- Worker 完了時、`writeValidationResult` により `COMPLETED` または `FAILED` へ更新され、同じ SSE event に `success` と `validationResultId` が含まれる。
- Web の回答詳細では、失敗時に `errorCode` / `errorMessage` が確認できる。`permission_denied` は再検証しても credential / 権限を直すまで成功しないことを確認する。
- 回答詳細の再検証操作、または API の `POST /api/forms/:id/responses/:responseId/validation/retry` で対象 result を再 enqueue できることを確認する。retry job は既存 result を `PENDING` に claim し、Worker が同じ `validationResultId` を最終結果で更新する。

## 実 credential 手動 QA

実サービスで確認する場合も credential は `.env.local` または安全な secret store にだけ置く。

| Provider | 必須設定 | 権限不足の確認 |
|----------|----------|----------------|
| Discord | `DISCORD_BOT_TOKEN`、Bot が対象 guild に参加済み、メンバー検索とロール取得が可能 | Bot 未参加または権限不足の guild / role 設定で `DISCORD_BOT_NOT_IN_GUILD` または権限不足 message を確認 |
| GitHub | 任意の GitHub App credential。未設定時は未認証 API で user exists のみ確認可能 | App credential 不正、または installation 権限不足で `GITHUB_AUTH_FAILED` を確認 |
| Twitter/X | `TWITTER_BEARER_TOKEN`、Users lookup API を呼び出せるプラン / 権限 | Bearer token 不正または Users lookup 権限不足で `TWITTER_AUTH_FAILED` を確認 |

実 credential QA では、成功ケース、存在しないユーザー、権限不足、rate limit 近傍、回答詳細の失敗理由、再検証導線を確認する。実ユーザー名、token、guild ID、installation ID、rate-limit header などは PR・docs・ログ抜粋に残さない。

## 完了判定

- focused tests が pass している。
- `pnpm lint:fix`、`pnpm type-check`、`pnpm test --silent` または `pnpm test -- --silent` が pass している。
- 手動 mock E2E で Queue、SSE、回答詳細、再検証導線を確認できる。
- 実 credential が必要な確認は上記手順に分離され、repo に秘密情報を追加していない。
