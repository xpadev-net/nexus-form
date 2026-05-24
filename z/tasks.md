# nexus-form コードベースレビュー 対応タスク（ラウンド3）

レビュー日: 2026-05-17 / 対象: 全ワークスペース（apps 3 + packages 6、TS/TSX 約 85,000 行）
レビュー手法: agent swarm による 6 領域分担レビュー（apps/api ルート / apps/api 認可・セキュリティ / apps/web ルート・データ層 / apps/web コンポーネント・フック / apps/worker・integrations / packages/database・shared・設定）。

**再レビュー更新（2026-05-17）:** 6 エージェントによる全コードベース再スキャンを実施。既存 R3 タスクの大半が未着手のまま再指摘され（退行ではなく未対応）、加えて新規 Critical 4 件・新規 High 10 件・新規 Medium/Low 多数を検出した。新規分は各フェーズ末尾に `R3-C8` 以降の連番で追記している（既存 ID は PR 参照との整合のため不変）。新規 Critical 4 件（R3-C8〜C11）は実ファイルで再現を確認済み。

**追加再レビュー更新（2026-05-20）:** サブエージェント 5 領域（API セキュリティ / Web / Worker・Integrations / DB・Infra / 横断品質）で追加レビューを実施。既存 R4 指摘と重複する項目は重要度・修正範囲を再評価し、未反映の指摘は末尾の「ラウンド5」に追記した。横断確認では `rtk pnpm type-check` と `rtk pnpm test --silent` の成功報告を得ている。

**最新セルフレビュー反映（2026-05-20 JST）:** サブエージェント 4 領域（API / Web / Worker・Integrations / Data・Tooling）と親側の横断確認で再レビューを実施。Critical 級の再指摘は既存 R4/R5 に統合済みのため新 ID を重複発行せず、未反映の具体的な差分のみ末尾の「ラウンド7」に追記した。確認コマンドは `rtk pnpm type-check`, `rtk pnpm lint`, `rtk pnpm test --silent` が通過。レビュー専用のため `pnpm lint:fix` は実行していない。

**進捗反映（2026-05-22 JST）:** `master` @ `dc27e1d`（PR #290 マージ後）時点の完了状況を各ラウンド見出し直下に追記。検証台帳は `docs/task-verification/`（`r8-t1.md`, `r9-c1-c5.md`, `r9-h1-h7.md`, `r11-*.md`, `r12-t1-t2.md`）。Web テストは `@nexus-form/web` でファイル逐次実行（`scripts/run-vitest-sequential.mjs`）。

各タスクは `ID / 重要度 / 対象ファイル / 問題 / 修正内容 / 依存 / 検証` で構成。
重要度: 🔴 Critical → 🟠 High → 🟡 Medium → 🟢 Low。

---

## ラウンド2（R2-C1〜R2-T1）の完了状況

ラウンド2の計画は git 履歴上で**全タスク完了済み**（再着手不要）。確認できた対応コミット:

- ✅ **R2-C1 / R2-H1 / R2-H2 / R2-H3**（authz Phase 1）— `2d0f9c9`, `7116b23`、回帰テスト `dde55dd`〜`fa62029`（PR #32）
- ✅ **R2-H4〜R2-H5 / R2-M5〜R2-M9 / R2-L6 / R2-L7**（worker Phase 2）— `48029dc`（PR #28）, `8df79bc`
- ✅ **R2-H6 / R2-M10〜R2-M16**（frontend Phase 3）— `2852661`, `05d3e6e`, `abf2f50`, `194aa18`
- ✅ **R2-M1〜R2-M4**（API Medium Phase 4）— `a033b8a`, `6e4e9ac`, `9b07f00`, `c5fc1aa`
- ✅ **R2-L1〜R2-L5**（Low Phase 5）— `40ab4f3`, `0e2a778`, `0a6da96`

⚠️ ラウンド3 で再指摘・退行・新規発見されたもの:
- 旧 **R2-H5**（プラグインサンドボックス）— ドキュメント整備のみで実行時検証が無く、ハッシュ検証欠如のまま。**R3-C4** に格上げ。
- 旧 **R2-M7**（API/Worker プラグインドリフト）— 実行時ガード未実装。**R3-H9** に継続。

---

## Phase 0: 緊急 hotfix（Critical）

### R3-C1. `POST /api/tokens/validate` がトークンオラクルになっている
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #33、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/tokens.ts:269-292`
- **問題:** 当エンドポイントはルーター冒頭の `withDualAuth()`（`tokens.ts:63`）のみで保護され、**所有者チェックが一切ない**。任意の認証済みユーザーがリクエストボディに他人の（または推測した）トークン文字列を渡し、(1) 有効性、(2) 所有者 `user_id`、(3) `scopes` を取得できる。さらに `validateApiToken` 内の `lastUsedAt` 更新により、**自分が所有しないトークンの監査ログを改ざん**できる。
- **修正内容:**
  1. フロントエンドに「自分のトークン疎通確認」用途が無ければ当エンドポイントを**削除**する。
  2. 用途がある場合は、検証されたトークンの `user_id` がリクエスト元 `dualAuthContext.user_id` と一致する場合のみ詳細を返し、不一致時は `{ valid: false }` のみ返す。最低限 `user_id` / `scopes` の返却は所有者限定にする。
- **依存:** なし（最優先・単独着手可）
- **検証:** 他ユーザーのトークン文字列を渡しても `user_id`/`scopes` が漏れないこと（→ R3-T1）。

### R3-C2. 停止（suspended）ユーザーがセッション認証経路でほぼ全データルートにアクセス可能
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #34、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/lib/dual-auth.ts:147-171`（`authenticateWithSession`）
- **問題:** `requireAuth`（`middleware.ts:29-40`）は `user.isSuspended` をチェックするが、これを使うのは `/api/auth-ext` ルーターのみ。`/api/forms/*`・`/api/forms/:id/responses/*`・`/api/tokens/*` 等はすべて `withDualAuth` / `withDualFormAuth` 経由で、これらが使う `authenticateWithSession` は `isSuspended` を一切確認しない。**停止アカウントでも有効セッションさえあればフォーム閲覧・編集・回答削除・共有リンク発行・トークン作成が可能**で、`isSuspended` 機能は実質無効。
- **修正内容:** `authenticateWithSession` で `session.user.isSuspended` を確認し、停止中なら `null` を返す（または専用の 403 を返す）。API トークン経路でも、トークン所有者の `isSuspended` を `validateApiToken` でチェックする。
- **依存:** なし
- **検証:** 停止ユーザーのセッションでフォーム系エンドポイントが 403 になること（→ R3-T1）。

### R3-C3. 本番環境で `/api` 相対パスのリクエストが API サーバーに到達しない
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #35、`gh-review-hook` exit 0）
- **対象:** `apps/web/src/components/forms/google-sheets-integration.tsx:526` ほか、`apps/web/src/components/forms/form-response-settings.tsx:29`、`apps/web/src/lib/validation/validation-providers.ts:16`
- **問題:** これらは `fetch("/api/...")` / `fetchJson(`/api/...`)` のように相対パスでリクエストする。`vite.config.ts` の `server.proxy` は**開発サーバー専用**で本番ビルドでは効かない。本番では Web SPA は API（ポート 3001 / `VITE_API_URL`）と別オリジン配信のため、相対 `/api` は SPA 自身のオリジンに飛び 404/HTML を返す。Google Sheets 連携・回答設定・検証プロバイダ取得が本番で全滅する。
- **修正内容:** 全リクエストを `baseUrl`（`@/lib/api`）起点にする。可能なら hono-rpc `client` 経由に統一（`PATCH /:id/settings/responses` のように API 側ルートが未定義なら、API にルートを追加して型安全化）。最低限 `fetchJson(`${baseUrl}/api/...`)` に統一し `credentials: "include"` を付ける。
- **依存:** なし
- **検証:** 本番相当ビルド（別オリジン構成）で Google Sheets 連携・回答設定・検証プロバイダ取得が動作すること。

### R3-C4. バリデーションプラグインの任意コード実行（RCE）— ハッシュ検証欠如
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #36、`gh-review-hook` exit 0）
- **対象:** `packages/integrations/src/plugin-loader.ts:31,165-179`
- **問題:** `loadPluginFromSpecifier` は `VALIDATION_PLUGINS_DIR` 内の任意の `.js`/`.mjs` を無条件に `import` 実行する。`realpath`+`relative` のチェックはシンボリックリンク脱出を防ぐのみで、**ファイル内容は一切検証しない**。SHA-256 はログ出力しているだけで許可リスト照合も署名検証もない。`VALIDATION_PLUGINS_DIR` に書き込み権限を持つ者は API・Worker 両プロセスでコード実行が可能（旧 R2-H5 のドキュメント整備では未解決）。
- **修正内容:**
  1. 期待 SHA-256 のマニフェスト（`plugins.lock` 等）を用意し、ハッシュ不一致のプラグインはロード拒否する。
  2. 起動時にプラグインディレクトリのパーミッションを検証（group/other 書き込み不可）。
  3. 本番では `VALIDATION_PLUGINS_DIR` を読み取り専用マウントとする運用を必須要件として `docs/external-plugins.md` に明記。
- **依存:** R3-H9（ドリフトガード）と同じ起動経路のため同時実施を推奨。
- **検証:** マニフェストに無い/ハッシュ不一致の `.mjs` がロード拒否されること。

### R3-C5. Sheets 同期の冪等性ウィンドウによる行欠落・重複
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #37、`gh-review-hook` exit 0）
- **対象:** `apps/worker/src/handlers/sheets-sync.ts:218-245`
- **問題:** `setIdempotencyKey(key, 90, "pending")` → `appendRows` → `setIdempotencyKey(key, 86400, "done")` の順で、`appendRows` 成功後・`"done"` 書込み前のクラッシュ/Redis 障害時、行は書かれたまま冪等性キーは `"pending"`（TTL 90 秒）のまま残る。`attempts: 3` + 指数バックオフ 30 秒（`apps/api/src/lib/queues.ts:16-22`）下でリトライが `"pending"` を見て `throw` し dead-letter 化、90 秒経過後の手動リトライでは**重複行**が発生する。
- **修正内容:** `"done"` キーの TTL を手動リトライ想定窓（例 7 日）より長くする。または `appendRows` の `updatedRange` を `"done"` の値に保存し、`"pending"` 検出時に Sheets を再読込して当該 `responseId` 行の有無を確認してから判断する。
- **依存:** なし
- **検証:** `appendRows` 後のクラッシュをシミュレートしても行欠落・重複が発生しないこと。

### R3-C6. `apiToken.scopes` / `apiToken.formIds` が型なし `json` で zod 検証なし
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #38、`gh-review-hook` exit 0）
- **対象:** `packages/database/src/schema.ts:199-200`、`packages/shared`
- **問題:** `scopes` / `formIds` は API トークン認可（dual-auth）の中核データだが `json` 型のままで、`packages/shared` に検証スキーマが無い。プロジェクト規約「すべての共有データ契約を zod で検証」「`json` カラムは読み出し時に再パース」に違反。不正形状が DB に入ると認可ロジックが予期せぬ挙動になる（権限昇格リスク）。`googleOAuthToken.scopes`、`formValidationRule.configJson`、`systemSetting.value`、`formSnapshot.validationRulesJson`/`plateContent` も同様に未検証。
- **修正内容:** `packages/shared` に `apiTokenScopesSchema` / `apiTokenFormIdsSchema`（`z.array(z.string())` 等）を定義し、書き込み・読み出し双方で `parse` する。上記の他 `json` カラムにも専用スキーマを定義する。
- **依存:** なし
- **検証:** 不正形状の `scopes`/`formIds` が書き込み・読み出し時に弾かれること。

### R3-C7. バリデーションフックのレース未対策・`useCharacterCount` の stale 化
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #39、`gh-review-hook` exit 0）
- **対象:** `apps/web/src/components/form/hooks/useDateValidation.ts:28-77`、`apps/web/src/hooks/forms/useShortTextValidation.ts:27-73`、`apps/web/src/components/form/hooks/useTimeValidation.ts:28-77`、`apps/web/src/components/form/hooks/useCharacterCount.ts:28`
- **問題:**
  1. `useGenericValidation`（`useGenericValidation.ts:35-86`）は `currentRequestId` ref で「最新リクエストのみ state 更新」のレース対策を実装済みだが、上記 3 フックは debounce 後の非同期検証にリクエスト ID 追跡が無い。debounce 由来の古い検証と blur 由来の新しい検証が交差すると古い `setValidationError` が後勝ちし、誤エラー表示・エラー取りこぼしが起きる。
  2. `useCharacterCount` は `useState(initialValue.length)` で初期化し `onChange` 経由でしか更新されないため、下書き復元・ページ遷移など外部からの `value` 変更に追従せず文字数カウンタが stale 化する。
- **修正内容:**
  1. 3 フックに `useGenericValidation` と同じ `requestId` ref パターンを導入。構造が同一なので `useGenericValidation` をベースに 1 つに共通化するのが望ましい。
  2. `useCharacterCount` は `currentLength` を state に持たず `value.length` から派生させ、`updateLength` を廃止する。
- **依存:** なし
- **検証:** 高速な入力切替・blur 連打で誤エラーが出ないこと、外部からの値変更で文字数表示が追従すること。

### R3-C8. フィンガープリント一括削除 API が WHERE 句喪失で全件削除しうる（再レビュー新規）
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #40、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/fingerprint.ts:243-284`（DELETE `/manage`）
- **問題:** ガード（L250）は `!responseId && !formId && !before` のみを弾くため `formId` 指定があれば通過する。だが `formId` 指定フォームの回答が 0 件のとき `responseIds` が空配列になり、`formId && responseIds.length > 0` 分岐が `undefined` を返す。`responseId`・`before` も未指定なら `and(undefined, undefined, undefined)` で WHERE 句が消滅し、`db.delete(fingerprintDetail)` が **`fingerprintDetail` テーブル全行を削除**する。admin 専用だが回復不能なデータ損失。実ファイルで再現確認済み。
- **修正内容:** `formId` 指定かつ `responseIds.length === 0` の場合は削除を実行せず `{ deleted: 0 }` を返す。または絞り込み句が常に 1 つ以上残ることを保証する（例: `inArray(..., responseIds.length ? responseIds : ["__none__"])`）。最低限、生成された `where` が `undefined` でないことを実行前にアサートする。
- **依存:** なし（最優先・単独着手可）
- **検証:** 回答 0 件のフォーム ID を渡しても他フォームのフィンガープリント行が削除されないこと。

### R3-C9. 共有リンク用 API トークンが `lookupHash` を保存せず認証不能（再レビュー新規）
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #41、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/lib/tokens/share-link-token.ts:111-123`
- **問題:** `createApiTokenForShareLink` の `db.insert(apiToken).values({...})` は `lookupHash` を設定しない（`scopes`/`formIds`/`tokenHash` 等は設定済み）。一方 `validateApiToken`（`apps/api/src/lib/tokens/validate.ts:38-42`）は `eq(apiToken.lookupHash, computeLookupHash(token))` で完全一致検索する。`lookupHash` カラムは nullable（`schema.ts`）のため、共有リンク経由で発行したトークンは **すべての検証で行が見つからず 401 になり、共有リンク機能が機能停止**している。通常トークン発行（`generate.ts`）は `lookupHash` を正しく設定しているため共有リンクのみ壊れている。実ファイルで再現確認済み。
- **修正内容:** `share-link-token.ts` の insert 値に `lookupHash: computeLookupHash(plainToken)` を追加する（`./hash` から `computeLookupHash` を import）。
- **依存:** なし
- **検証:** 共有リンクで発行したトークンが `validateApiToken` で正しく解決されアクセスできること（→ R3-T2 で回帰テスト化）。

### R3-C10. `formStructure` query key 衝突で autosave とアクセス制御更新が相互上書き（再レビュー新規）
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #42、`gh-review-hook` exit 0）
- **対象:** `apps/web/src/hooks/forms/use-form-logic-management.ts:39,48,70,97,113`、`apps/web/src/hooks/forms/use-form-access-control.ts:21,57`
- **問題:** 2 つのフックが同一の query key `["formStructure", formId]` を共有する。`useFormLogicManagement` はロジック編集のたびに `structure` 全体を再取得し `saveStructure` でそのまま PUT し、同キーを invalidate する。`useFormAccessControl` も同キーを読み・invalidate する。両フックが同一画面でマウントされていると、ロジック保存とアクセス制御（パスワード保護等）更新が交差したとき、**古いキャッシュ済み構造で PUT してもう片方の変更を上書き**しうる。フック内 mutex はフック間競合を防げない。実ファイルでキー共有を確認済み。
- **修正内容:** サーバ側 `structure` 更新を version 付き楽観ロックにするのが本筋。短期対策として、(1) ロジックとアクセス制御の更新を別 query key・別 API ルート（差分パッチ）に分離する、(2) 保存前の再取得を `gcTime: 0` で確実にネットワークから取得する。
- **依存:** R3-H15（query key 安定化）と同領域。
- **検証:** ロジック編集とアクセス制御変更を交互に行っても双方の変更が失われないこと。

### R3-C11. 評価質問のラジオグループで複数の `checked` が同時に true（再レビュー新規）
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #43、`gh-review-hook` exit 0）
- **対象:** `apps/web/src/components/form/rating-question.tsx:176,192`
- **問題:** 評価アイコンを同一 `name` の `<input type="radio">` で実装しているが、`checked={isActive}` の `isActive` が `ratingValue <= currentValue`（L176）。「3」を選ぶと 1・2・3 すべての radio が `checked` になる。同一グループ内で複数 radio を制御 `checked` にするのは React の制約違反で、コンソール警告が出るうえ DOM 実選択状態と乖離する。実ファイルで確認済み。
- **修正内容:** input の選択状態は `checked={ratingValue === currentValue}` とする。塗りつぶし表現（`ratingValue <= currentValue`）はアイコンの見た目 prop（`renderIcon` の `isActive`）にのみ用い、選択状態と視覚状態を分離する。
- **依存:** なし
- **検証:** 任意の評価値を選択したとき選択中の radio が 1 つだけになり、コンソール警告が出ないこと。

---

## Phase 1: API High

### R3-H1. `block-analytics` が全回答行をメモリにロードし OOM リスク
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #44、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-responses.ts:438-475`（`GET /:id/responses/block-analytics`）
- **問題:** 全回答行を `responseDataJson` 付きでメモリにロードし `aggregateAllBlocks` で集計する。回答数が多いフォームで OOM。
- **修正内容:** 集計を SQL 側（`GROUP BY`）へ寄せる、または回答件数の上限/サンプリングを設ける。
- **依存:** なし
- **検証:** 大量回答フォームでメモリ使用量が一定に収まること。

### R3-H2. `POST /services/cache/clear` が `redis.flushdb()` で Redis DB 全体を破壊
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #45、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/services.ts:301`
- **問題:** `force=true` 分岐で `redis.flushdb()` を呼び、BullMQ ジョブ・SSE Pub/Sub・レートリミットキー・テレメトリトークン等を含む Redis DB 全体を消去する。admin + `force` でガードされていても破壊範囲が過大。
- **修正内容:** `service:cache:*` 等のプレフィックスに限定した `SCAN`+`DEL` に変更し、`flushdb` を廃止する。
- **依存:** なし
- **検証:** キャッシュクリアで BullMQ ジョブ・SSE チャネル等が消えないこと。

### R3-H3. 公開フォーム送信の検証順序（captcha 前に回答バリデーション・DB 操作）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #46、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-public.ts:288, 302`
- **問題:** 回答バリデーション（`validateResponseData`, L288）が hCaptcha 検証（L302）より先に実行される。未認証の攻撃者が captcha コストを払わず「フィールド構造が妥当か」のフィードバックを得られ、`processFormSchedule` を含む DB 操作も captcha 前に走る。
- **修正内容:** hCaptcha 検証を最優先に実行し、その後に回答バリデーション・スケジュール処理を行う。
- **依存:** なし
- **検証:** 不正な captcha トークンでは回答バリデーション結果も DB 操作も発生しないこと。

### R3-H4. `processFormSchedule` のエラーが握り潰される
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #47、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-detail.ts:48`、`apps/api/src/routes/forms-public.ts:183, 257`
- **問題:** `processFormSchedule(...).catch(() => {})` / `.catch(() => null)` で、publish/unpublish/snapshot 切替という状態変更操作の失敗が `logError`/Sentry に届かず完全に消える。
- **修正内容:** 少なくとも `logError` + `captureError` でログ出力する。
- **依存:** なし
- **検証:** スケジュール処理失敗時にログ/Sentry にイベントが残ること。

### R3-H5. ページネーション無しの無制限クエリ
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #48、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-responses.ts:375-387`（`/responses/ids`）, `:425-436`（`/responses/analytics`）、`forms-structure.ts:318-336`（`/snapshots`）, `:467-474`（`/schedule`）、`forms-validation-rules.ts:29-33`（`/validation-rules`）
- **問題:** いずれも `limit` 無しで全件返却。レコード増加に伴いメモリ・帯域・レイテンシが線形悪化。
- **修正内容:** `limit`/`offset`（またはカーソル）ベースのページネーションを導入する。
- **依存:** R3-H1 と同ファイル（`forms-responses.ts`）のため同時実施を推奨。
- **検証:** 各エンドポイントが上限件数で頭打ちになること。

### R3-H19. `getShareLinkRole` が共有リンクの有効期限を検証しない（再レビュー新規）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #49、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/lib/dual-auth.ts:373-391`
- **問題:** `getShareLinkRole`（`withDualFormAuth` / `checkFormAccess` から共有リンク API トークン経由で呼ばれる）は `isActive` と `formId` 一致のみ確認し `expiresAt` を検証しない。一方 `permission-service.ts` の `validateShareLink` および `share-link-token.ts:57` の `validateShareLinkInternal` は `expiresAt` を判定している。結果、**期限切れの共有リンクに紐づく API トークンでフォームへアクセスし続けられる**（ロジック不整合）。
- **修正内容:** `getShareLinkRole` の SELECT に `expiresAt` を加え、`if (link.expiresAt && link.expiresAt <= new Date()) return null;` を追加する。
- **依存:** なし
- **検証:** 期限切れ共有リンク由来のトークンでフォームアクセスが拒否されること。

### R3-H20. VIEWER 共有リンク保持者が全回答・分析データを閲覧できる（再レビュー新規）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #50、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/lib/dual-auth.ts:476` 付近、`apps/api/src/routes/forms-responses.ts:262` ほか VIEWER ゲートのルート群
- **問題:** `dual-auth.ts` の共有リンク分岐は `requiredRole === "VIEWER"` のとき role 不問で許可 (`return`) する。`/:id/responses*` 系は `withDualFormAuth("VIEWER")` で保護されているため、**VIEWER 共有リンクの保持者がそのフォームの全回答・回答詳細・ID 一覧・分析データを閲覧可能**になる。同じ懸念が `forms-snapshots.ts`/`forms-structure.ts`/`forms-validation-rules.ts`/`forms-detail.ts` の VIEWER ゲートにも及ぶ。
- **修正内容:** 回答閲覧系エンドポイントは最低でも `EDITOR` を要求するか、共有リンク分岐に「回答閲覧は OWNER/EDITOR の DB 権限を要する」専用判定を追加する。VIEWER 共有リンクの製品仕様（フォーム閲覧・回答のみを意図しているか）をチームで確認のうえ決定する。
- **依存:** なし。保留セクションの「external-service 権限委譲」と同根の論点。
- **検証:** VIEWER 共有リンク由来のトークンで回答一覧・分析エンドポイントが拒否されること。

### R3-H21. 信頼できないヘッダーからの無検証 IP 採用でレート制限・CAPTCHA を回避可能（再レビュー新規）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #51、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/lib/rate-limit.ts:19-23`（`getClientIp`）、`apps/api/src/lib/ip-address/strategies.ts:30-56`
- **問題:** `x-forwarded-for` / `x-real-ip` / `cf-connecting-ip` を無条件・無検証で先頭値採用する。リバースプロキシがこれらを上書きしない構成では、攻撃者が任意の `X-Forwarded-For` を送るだけでレート制限キーを変え放題になり、`auth_action`（15 分 10 回）のブルートフォース制限を完全に回避できる。hCaptcha の `remoteip`、テレメトリ IP ハッシュにも波及する。
- **修正内容:** 信頼するプロキシ段数を env（`TRUSTED_PROXY_COUNT`）で持ち、`x-forwarded-for` を分割して末尾から N 番目を採用する。`net.isIP()` で検証し不正値は `unknown` 扱い。プロキシ無し構成ではソケットの remote address を使う。
- **依存:** なし
- **検証:** 偽装 `X-Forwarded-For` を変えてもレート制限キーが固定され、ブルートフォース制限が機能すること。

### R3-H22. S3 プリサインド URL 生成にキー/バケット検証が無くパストラバーサルの恐れ（再レビュー新規）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #52、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/lib/s3/client.ts:64-98`（`generatePresignedUrl`/`generatePresignedUploadUrl`）、`apps/api/src/lib/s3/base-service.ts`（`generateDownloadUrl`/`generatePresignedPutUrl`）
- **問題:** 引数 `key` を一切検証せず `GetObjectCommand`/`PutObjectCommand` に渡す。`key` がユーザー入力由来の経路では `prod/../other-tenant/...` のようなキーや他フォームのキーを指定して **任意オブジェクトの署名付き URL を取得**しうる。`moveToProd` の `tmpKey.replace("tmp/", "prod/")` も `tmp/` を含まないキーで無変換のまま本番バケットへ書き込む。
- **修正内容:** プリサインド URL 系関数の入口で `key` を検証する（許可プレフィックス `tmp/` または `prod/` で始まる、`..` を含まない、想定 form/user スコープに一致）。`base-service` 側でキー所有権をルートのコンテキストと突き合わせる。
- **依存:** なし
- **検証:** 不正な `key`（`..` 含む・他ユーザー名前空間）でプリサインド URL 生成が拒否されること。

### R3-H23. テレメトリ IP ソルトの開発デフォルトが固定値で IP を逆引き可能（再レビュー新規）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #53、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/lib/telemetry/tokens.ts:6-18`（`hashIPAddress`）
- **問題:** 本番では `TELEMETRY_IP_SALT` 必須だが、非本番では `"default-salt-change-in-production"` の固定値を使う。SHA-256(ip + 既知ソルト) は全 IPv4 空間の総当たりで即座に逆引き可能で、ステージング等で IP（個人情報）が事実上平文同等になる。`sessions/jwt.ts:hashIp` は `AUTH_SECRET` 由来ソルトにフォールバックしており、こちらの方が安全。
- **修正内容:** テレメトリも `AUTH_SECRET` 派生ソルトにフォールバックするか、全環境でランダムソルトを必須にする。
- **依存:** なし
- **検証:** 固定ソルトが使われず、環境ごとに異なるソルトでハッシュされること。

### R3-H24. `FingerprintAnonymizer` のシングルトン Map が無制限蓄積し相関リーク（再レビュー新規）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #54、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/lib/fingerprint/anonymizer.ts:44` 付近
- **問題:** プロセス常駐シングルトンが `anonymizedIdMap: Map<string,string>` にフィンガープリントハッシュごとのエントリを永続蓄積する。削除も上限も無く長時間稼働で OOM。さらにリクエスト/フォーム横断でマップが共有されるため、同一フィンガープリントに同じ匿名 UUID が一貫して付与され、**異なるフォーム間で同一回答者の相関が取れてしまう**情報リーク。
- **修正内容:** マップをメソッド呼び出しスコープのローカル変数にする（`getAnonymizedFingerprints` 内で `new Map()`）。シングルトンに横断状態を持たせない。
- **依存:** なし
- **検証:** 長時間稼働でメモリが一定に収まり、別フォームの匿名 ID が相関しないこと。

---

## Phase 2: Worker High

### R3-H6. プロバイダーの `retryAfter` がバックオフに反映されない
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #55、gh-review-hook exit 0、merged）
- **対象:** `apps/worker/src/handlers/generic-validation.ts:263-265`
- **問題:** レート制限時にプロバイダーが返す `result.retryAfter`（秒）を、ハンドラは `throw new Error("Rate limited, retry after Ns")` するだけ。BullMQ は `defaultJobOptions.backoff`（指数 30 秒）で再試行するため、プロバイダー指定の待機時間が完全に破棄される（Discord/GitHub の意図したバックオフが無視される）。
- **修正内容:** `job.moveToDelayed(Date.now() + retryAfter * 1000, token)` を使う、または `retryAfter` をエラーに乗せて BullMQ のカスタムバックオフ関数で読み取る。
- **依存:** なし
- **検証:** プロバイダーが `retryAfter` を返した場合、その時間だけ遅延して再試行されること。

### R3-H7. `ConcurrentDeleteError` が無限リトライ対象になる
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #56、gh-review-hook exit 0、merged）
- **対象:** `apps/worker/src/handlers/generic-validation.ts:97-103`、`apps/worker/src/lib/validation-helpers.ts:225-238`
- **問題:** `markValidationProcessing` は対象行が並行削除されると `ConcurrentDeleteError` を throw するが、`handleGenericValidation` はこれを catch しない。行削除済み（恒久状態）にもかかわらず `attempts: 3` で 3 回再試行される。
- **修正内容:** `markValidationProcessing` 呼び出しを try/catch で囲み、`ConcurrentDeleteError` の場合は `writeValidationResult` を行わず `return { ok: false, error: "Result row deleted" }` で正常終了する。
- **依存:** なし
- **検証:** 検証中に回答が削除されてもジョブが即座にターミナル化し再試行されないこと。

### R3-H8. Discord の fetch にタイムアウトが無い
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #57、gh-review-hook exit 0、merged）
- **対象:** `packages/validation-provider-discord/src/requests.ts:32-56`、`plugin.ts:142-156`（`fetchUserGuilds`）
- **問題:** `discordFetchWithRetry` / `fetchUserGuilds` の `fetch` が `AbortSignal` を設定しておらず、Discord 接続がハングすると Worker の concurrency スロット（5）を無期限に占有する。Google Sheets クライアントや `pingDiscordApi` が timeout を設定しているのと非対称。
- **修正内容:** `signal: AbortSignal.timeout(DISCORD_API_TIMEOUT_MS)` を全 `fetch` に追加。タイムアウト値は env から読む（`parsePositiveIntEnv` を共有化）。
- **依存:** なし
- **検証:** Discord 応答がハングしてもジョブが一定時間で失敗し、スロットが解放されること。

### R3-H9. API/Worker のプラグインドリフトに実行時ガードが無い（旧 R2-M7 継続）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #58、gh-review-hook exit 0、merged）
- **対象:** `apps/worker/src/index.ts`、`packages/integrations/src/startup.ts:49-83`
- **問題:** CLAUDE.md は API と Worker が同一プラグインを読むことを必須とするが、`startupPlugins` はマニフェスト比較・ハッシュ交換・起動時アサーションを一切行わない。片側のみにプラグインを追加/再起動すると、API が `${provider}-validation` キューに enqueue しても Worker が該当 Worker を生成せずジョブが無言で滞留する。
- **修正内容:** 起動時に登録プロバイダー名 + 各 `.mjs` の SHA-256 のセットを Redis に記録し、API/Worker 間で照合。不一致なら起動失敗または警告/メトリクス化する。
- **依存:** R3-C4 と同じ起動経路のため同時実施を推奨。
- **検証:** 片側のみにプラグインを追加した状態で不一致が検出されること。

### R3-H10. グローバル例外ハンドラが graceful shutdown を経由しない
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #59、gh-review-hook exit 0、merged）
- **対象:** `apps/worker/src/index.ts:78-88`
- **問題:** `unhandledRejection` / `uncaughtException` ハンドラが `gracefulShutdown` を呼ばず `process.exit(1)` する。実行中の BullMQ ジョブが `worker.close()` でドレインされず、Redis 上で stalled job として `lockDuration` 経過まで残る。
- **修正内容:** ハンドラ内で `gracefulShutdown` を呼ぶ（`uncaughtException` 後はプロセス状態不定のため短いタイムアウトで強制終了するのは現状維持で可）。最低限 `unhandledRejection` は graceful path を試みる。
- **依存:** なし
- **検証:** 例外発生時に実行中ジョブがドレインされてから終了すること。

### R3-H25. `isTokenExpired` が破損 `expiryDate` でリフレッシュを無効化する（再レビュー新規）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #60、gh-review-hook exit 0、merged）
- **対象:** `apps/worker/src/lib/oauth-token-store.ts:98-102`
- **問題:** `isTokenExpired` は `Date.parse` が `NaN` のとき `false`（＝期限内）を返す。`expiryDate` が破損していると **OAuth トークンが永久にリフレッシュされず**、Google Sheets API 呼び出しが 401 で失敗し続ける。
- **修正内容:** 解釈不能な `expiryDate` は期限切れ扱い（`true`）にするか、明示的にエラーを投げる。
- **依存:** なし
- **検証:** 破損した `expiryDate` でトークンリフレッシュが発火すること。

### R3-H26. BullMQ ジョブペイロードが zod 検証されていない（再レビュー新規）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #61、subagent review 通過、local validation 通過）
- **対象:** `apps/worker/src/handlers/generic-validation.ts:54-66`、`apps/worker/src/handlers/sheets-sync.ts:26-40`
- **問題:** `GenericValidationJob` / `SheetsSyncJob` は TypeScript の型注釈のみで、ハンドラ境界で `job.data` を zod 検証していない。ジョブペイロードは Worker にとってのリクエスト境界であり、CLAUDE.md「全リクエスト/レスポンスを zod スキーマで検証」に違反する。enqueue 側のバグや旧形式のジョブが残ると `undefined` が下流へ流れる。R3-C6（DB の `json` カラム検証）とは別問題。
- **修正内容:** 各ジョブの zod スキーマを定義し、ハンドラ冒頭で `schema.parse(job.data)` する。`@nexus-form/shared` に置けば enqueue 側（API）と共有できる。
- **依存:** R3-C6 と同じ「zod 契約整備」方針。
- **検証:** 不正形状のジョブペイロードがハンドラ冒頭で弾かれること。

### R3-H27. バリデーションプロバイダーの `inputSchema` が文字種を検証しない（再レビュー新規）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #62、subagent review 通過、local validation 通過）
- **対象:** `packages/validation-provider-discord/src/plugin.ts:23`、`packages/validation-provider-github/src/plugin.ts:11`、`packages/validation-provider-twitter/src/plugin.ts:11`
- **問題:** `DiscordInputSchema` 等は `z.string().min().max()` で**長さのみ**検証する。Worker は `inputSchema.parse` → `normalizeInput` → 再 `inputSchema.parse` の順で処理する（`generic-validation.ts`）ため、`patternTemplate.pattern`（`^[a-zA-Z0-9_.]{2,32}$` 等）はサーバーサイドで一切適用されない。結果、`searchGuildMembers` のクエリや GitHub の URL パスへ任意文字種の回答者入力が到達する（Twitter は `validate()` 冒頭の `isValidTwitterUsername` で救済されるが Discord/GitHub は無防備）。
- **修正内容:** 各 `inputSchema` を `z.string().regex(...)` で `patternTemplate.pattern` と同一の文字種制約にする。Twitter のインライン検証も `inputSchema` に統合し一貫させる。
- **依存:** なし
- **検証:** パターン外の文字を含む入力が `inputSchema.parse` で弾かれ外部 API に到達しないこと。

### R3-H28. Redis チャンネル名ヘルパーが `formId` を無検証で連結（再レビュー新規）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #63、subagent review 通過、local validation 通過）
- **対象:** `packages/shared/src/sse-events.ts:48-54`（`getValidationChannel`/`getEditorChannel`）
- **問題:** 任意文字列を受け取り長さ・文字種の制約なしに `form:validation:${formId}` を生成する。共有ユーティリティとして export される以上、呼び出し側がサーバー生成 ID を渡す前提に依存すべきでない。`formId` に `*` や改行が含まれると `PSUBSCRIBE` パターン汚染や別チャンネル混入のリスク。
- **修正内容:** ヘルパー内で `z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).parse(formId)` 相当の検証を行い、不正値で例外を投げる。
- **依存:** なし
- **検証:** 不正な `formId`（`*`・改行含む）でチャンネル名生成が拒否されること。

---

## Phase 3: Frontend High

### R3-H11. SSE のエラー時に無限再接続が発生する
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #64、subagent review 通過、local validation 通過）
- **対象:** `apps/web/src/hooks/use-editor-sse.ts:53-55`、`apps/web/src/hooks/use-validation-sse.ts`
- **問題:** `EventSource` はエラー時にブラウザが自動再接続するが、API が 401/403/404（権限喪失・フォーム削除）を返し続けても止まらず数秒ごとに再接続を試み続ける。`use-validation-sse.ts` には `error` リスナーすら無く、`use-editor-sse.ts` の `error` ハンドラは空。
- **修正内容:** `error` イベントで `readyState === EventSource.CLOSED` を検知し、恒久エラー（認証失敗等）なら明示的に `close()` する。または再接続回数の上限/バックオフを設ける。`use-validation-sse.ts` にも `error` ハンドラを追加。
- **依存:** R3-H12 と同ファイル群のため同時実施を推奨。
- **検証:** 403/404 を返す SSE エンドポイントに対し再接続が停止すること。

### R3-H12. SSE 接続がタブ非アクティブ時も維持されリソースを浪費
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #65、subagent review 通過、local validation 通過）
- **対象:** `apps/web/src/hooks/use-editor-sse.ts:47-110`、`apps/web/src/hooks/use-validation-sse.ts:16-49`
- **問題:** `formId` がある限り `EventSource` を開きっぱなし。回答タブが一度開くと `hidden` で保持されるため、タブを離れても validation SSE 接続が残り、editor SSE と合わせ 2 本が常時開く。`visibilitychange` での一時停止が無い。
- **修正内容:** `document.visibilitychange` で非表示時に `close()`、復帰時に再接続する。非アクティブな回答タブでは `useValidationSSE` を実質無効化する（`formId` を条件付きで渡す）。
- **依存:** R3-H11 と同時。
- **検証:** タブ非アクティブ時に SSE 接続が閉じられること。

### R3-H13. 検証タブが未保存 draft コンテンツを使い、サーバー保存済みルールと不整合
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #66、subagent review 通過、local validation 通過）
- **対象:** `apps/web/src/components/forms/form-editor-page.tsx:345-352`
- **問題:** `FormValidationRulesPage` に `plateContent={draftContent ?? plateContent}` を渡す。検証ルールは `referencedBlockIds` でブロックを参照するが、autosave のデバウンス（2 秒）中にルールを作成・編集すると未保存ブロック ID を参照したルールや、削除済みブロックを参照したルールが生まれる。
- **修正内容:** 検証タブを開く際に編集内容を確実にサーバー保存してから保存済み `contentQuery.data` を渡す。または編集中は検証タブで保存待ちの注意を表示する。
- **依存:** R3-H14 と同ファイル。
- **検証:** autosave 未完了状態で検証ルールを作成しても無効ブロック参照が生まれないこと。

### R3-H14. `restore-edit` スナップショット復元が autosave のローカル編集と競合
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #67、subagent review 通過、local validation 通過）
- **対象:** `apps/web/src/hooks/forms/use-snapshots.ts:104`、`apps/web/src/hooks/forms/use-form-content-autosave.ts:82-106`
- **問題:** `restoreEditFromSnapshotMutation` の `onSuccess` で `["formContent", formId]` を無効化・再取得するが、autosave フックは `hasLocalEdits` が true だとローカル編集を守るため、ユーザーが直前に編集していると復元したサーバー内容が反映されない（リストア操作の意図と矛盾）。
- **修正内容:** `restore-edit` 実行時は autosave のローカル編集状態をリセット（`editorValueRef.current = baseContentRef.current` 相当）してから無効化する。
- **依存:** R3-H13 と同領域。
- **検証:** ローカル編集中にスナップショット復元しても復元内容が確実に反映されること。

### R3-H15. React Query のキーに不安定なオブジェクト参照を使用し refetch ストーム
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #68 merged、subagent review 通過、local validation 通過）
- **対象:** `apps/web/src/hooks/forms/use-share-links.ts:36`、`apps/web/src/hooks/forms/use-form-permissions.ts:48, 64`
- **問題:** `queryKey: ["shareLinks", formId, params]` のように呼び出し側が毎レンダー生成するオブジェクトをキーに入れている。`undefined` プロパティの有無や順序差で別キー扱いとなりキャッシュミス・refetch ストームの原因になる。
- **修正内容:** キーにはプリミティブのみ、または正規化済みの安定値を入れる（例: `[formId, params.page ?? null, params.limit ?? null, params.isActive ?? null]`）。
- **依存:** なし
- **検証:** 同一パラメータで再レンダーしても refetch が発生しないこと。

### R3-H16. `long-text-question` が入力値を `trim()` し空白入力ができない
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `handleChange` は入力値を `trim()` せず `newValue` をそのまま `onChange` に渡す実装になっていることを確認。入力中の空白・改行を保持できる。
- **対象:** `apps/web/src/components/form/long-text-question.tsx:98-120`
- **問題:** `sanitizeInput` が `value.trim()` を毎キーストロークに適用するため、長文回答途中のスペース・改行・段落の空行が入力できず、IME 変換中の挙動も壊れる。`onChange` にトリム済み値が渡るため意図した値を保存できない。
- **修正内容:** 入力中のトリムをやめる。トリムが必要なら送信時/バリデーション時のみに行い、`handleChange` は `newValue` をそのまま `onChange` に渡す。
- **依存:** なし
- **検証:** 長文回答に空行・末尾スペースを含む入力がそのまま保存できること。

### R3-H17. 手書き `memo` 比較関数が壊れている（stale クロージャ）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `long-text-question` / `checkbox-grid-question` はいずれも手書き comparator を廃止し、`memo(Component)` のみで運用されていることを確認。`onChange` の stale クロージャ問題は解消済み。
- **対象:** `apps/web/src/components/form/long-text-question.tsx:216-271`、`apps/web/src/components/form/checkbox-grid-question.tsx:260-337`
- **問題:** `memo` の第2引数の手書き比較関数が `onChange` プロップを比較しておらず、親が毎レンダー新しい `onChange` を渡すと古いクロージャを保持し続ける。`CheckboxGridQuestion` はさらに `block.validation` を `as { ... }` で広くキャスト（規約違反）。
- **修正内容:** 手書き比較関数を削除しデフォルトの浅い比較に任せる。親側で `onChange`・`block` を `useCallback`/`useMemo` で安定化する。
- **依存:** なし
- **検証:** 親の再レンダーで `onChange` が更新されても最新のハンドラが呼ばれること。

### R3-H18. `block-validation-editor` が静的 `id` 属性を多用しページ内 ID 衝突
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `BlockValidationEditor` で `useId()` 由来 `idPrefix` を各 renderer へ渡す構成に分割済み。静的 ID 依存は解消され、複数エディタ同居時の衝突を回避。
- **対象:** `apps/web/src/components/form/block-validation-editor.tsx`（`min-length`/`max-length`/`pattern`/`allow-other`/`scale-min`/`min-date` 等多数）
- **問題:** `<Label htmlFor="min-length">` と `<Input id="min-length">` が固定文字列。同一画面に複数のブロックバリデーションエディタが存在するとき `id` が重複し、ラベル関連付け・スクリーンリーダー・クリックフォーカスが壊れる。
- **修正内容:** `useId()` でプレフィックスを生成するか `question.blockId` を組み込んだ ID にする（他の質問コンポーネントと整合させる）。
- **依存:** R3-M フロント分割（巨大ファイル分割）と同ファイルのため順序調整。
- **検証:** 同一画面に複数エディタがあっても `htmlFor` が正しく対応すること。

---

## Phase 4: Medium

### R3-M1. レスポンス用 zod スキーマが未適用のルートが残存
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #122〜#138 merged、各 PR `gh-review-hook` exit 0。`apps/api/src/routes` の素の `c.json({ error: ... })` 残存なし）
- **対象:** `apps/api/src/routes/forms-content.ts`、`forms-structure.ts`、`forms-integrations.ts`、`forms-permissions.ts`、`forms-validation-rules.ts`、`s3.ts`、`auth.ts`、`sessions.ts`、`csrf.ts`、`forms-invites.ts` ほか
- **問題:** プロジェクト規約「API ルートはペイロードとレスポンス両方に専用 zod スキーマを定義し推論型をエクスポート」に対し、上記ルートが `c.json({...})` で素のオブジェクトを返し `.parse()` を通していない（旧 R2-H6 が主要ルートを対応済みだが網羅されていない）。
- **修正内容:** 各ルートに `*ResponseSchema` を定義し `.parse()` を通す。推論型を `@nexus-form/shared` 経由でエクスポート。
- **依存:** なし（件数が多いため計画的に分割着手）
- **検証:** 対象ルートのレスポンスが zod スキーマを通過すること。

### R3-M2. `as` キャストの多用（プロジェクト規約違反）
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理。対象箇所の通常 `as SomeType` キャスト除去を確認、残存は `as const` の const assertion のみ）
- **対象:** `apps/api/src/lib/integrations/external-service.ts:82`、`integrations-google.ts:85`、`fingerprint.ts:174`、`apps/api/src/routes/tokens.ts:182-189`（`scopes?: unknown`）、`apps/worker/src/handlers/generic-validation.ts:197-209`、`sheets-sync.ts:60,64`、`oauth-token-store.ts:54`、`packages/validation-provider-github/src/client.ts:83-92`、`apps/web` の `useOtherOption.ts:18`、`form-editor-page.tsx:53,54,241`
- **問題:** CLAUDE.md が抑制を求める `as` キャストが各所に残存。型ガード/zod narrowing で代替できる箇所が多い。
- **修正内容:** 型ガード関数・zod `safeParse`・判別共用体での narrowing に置き換える。エラー構造（`code`/`status`/`retryAfter`）には専用 zod スキーマを定義。
- **依存:** なし
- **検証:** 対象箇所の `as` が除去され型チェックが通ること。

### R3-M3. 認証ガードの重複（`_authenticated` と `preview/$id`）
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `_authenticated/route.tsx` と `forms/preview/$id.tsx` は `beforeLoad: requireAuth` を共通利用しており、重複ガードは解消済み。
- **対象:** `apps/web/src/routes/_authenticated/route.tsx:14-24`、`apps/web/src/routes/forms/preview/$id.tsx:6-16`
- **問題:** `preview` ルートが `_authenticated` の認証ガードを独自に複製しており DRY 違反・ドリフトの温床。
- **修正内容:** 認証ガードを共通ヘルパー（`requireAuth`）に切り出し両ルートで共有する。
- **依存:** なし
- **検証:** 両ルートが同一の認証ロジックを共有すること。

### R3-M4. ページ送り時のローディング無しでデータがちらつく
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `form-responses-page.tsx` の `useQuery` に `placeholderData: keepPreviousData` を適用済み。`isFetching` 表示も実装され、ページ遷移時の空白ちらつきを抑制。
- **対象:** `apps/web/src/components/forms/form-responses-page.tsx:131-145`
- **問題:** `placeholderData: keepPreviousData` 未使用のため、ページネーション時に一瞬空表示→新データのちらつきが起きる。
- **修正内容:** `placeholderData: keepPreviousData` を設定し `isFetching` でローディングインジケータを出す。
- **依存:** なし
- **検証:** ページ送り時に空表示のちらつきが無いこと。

### R3-M5. クライアントサイドのキーワード検索がページ内のみで誤解を生む
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `debouncedKeyword` を `/responses` API クエリ（`keyword`）へ渡すサーバーサイド検索に移行済み。
- **対象:** `apps/web/src/components/forms/form-responses-page.tsx:43-53`
- **問題:** `filteredResponses` が現在ページの 20 件だけをフィルタするが、ユーザーは全件検索のつもりになる。`data.total` 表示と相まって UX が誤解を招く。
- **修正内容:** 検索をサーバーサイドのクエリパラメータ（`keyword`）に渡す。即時対応が難しければ「現在ページ内検索」と UI 上明示する。
- **依存:** R3-H5（`forms-responses` ページネーション）と関連。
- **検証:** 検索が全件に対して機能する、または範囲が明示されること。

### R3-M6. `invite`/`shared` ページが手書き `useEffect` フェッチで react-query 規約違反
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `invite-acceptance-page.tsx` / `shared-form-page.tsx` は `useQuery` + `RpcError` 判定へ移行済み。
- **対象:** `apps/web/src/components/forms/invite-acceptance-page.tsx:39-77`、`apps/web/src/components/forms/shared-form-page.tsx:28-67`
- **問題:** データ取得を `useEffect` + `useState` で手書きしており、CLAUDE.md「データ取得は `@tanstack/react-query`」に違反（旧 R2-M12 で `public-form-page` は対応済みだが本 2 ページは未対応）。
- **修正内容:** `useQuery` に移行。404 は `RpcError` 判定でハンドリング。
- **依存:** なし
- **検証:** 取得・エラー・再取得が `useQuery` 経由で動作すること。

### R3-M7. `form-response-settings` の生 `fetch` がエラー契約を分裂させる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `form-response-settings.tsx` は `client.api.forms[\":id\"].settings.responses.$patch` + `rpc()` 経由へ統一済み。
- **対象:** `apps/web/src/components/forms/form-response-settings.tsx:28-43`
- **問題:** `rpc()`/`fetchJson()` と重複するエラー処理を再実装し、エラー契約が 3 系統（`RpcError`/`HttpError`/素の `Error`）に分裂。
- **修正内容:** API 側に `PATCH /:id/settings/responses` ルートを zod スキーマ付きで定義し `client` 経由に統一する。
- **依存:** R3-C3（同ファイルの相対パス修正）と同時実施を推奨。
- **検証:** エラー処理が `rpc()`/`RpcError` に一本化されること。

### R3-M8. SSE スキーマ `safeParse` 失敗が無言で無視される
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `use-editor-sse` / `use-validation-sse` ともに `safeParse` 失敗時に開発環境で `logWarn` を出す実装が入っていることを確認。
- **対象:** `apps/web/src/hooks/use-editor-sse.ts:65-66`、`apps/web/src/hooks/use-validation-sse.ts:30-31`
- **問題:** `safeParse` 失敗時に `return` するだけでログが残らず、サーバー側イベントスキーマがドリフトするとリアルタイム更新が黙って止まる。
- **修正内容:** 開発環境で `logger.warn` を出す。
- **依存:** R3-H11/H12 と同ファイル。
- **検証:** 不正イベント受信時に開発ログに警告が出ること。

### R3-M9. Worker シャットダウン時に Redis publisher / queue 接続がリーク
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `closePublisher()` / `closeMetricsQueues()` 実装済みで、`createGracefulShutdown` から呼び出される構成を確認。
- **対象:** `apps/worker/src/lib/redis-publisher.ts`、`apps/worker/src/lib/queue-metrics.ts:33-42`
- **問題:** `redis-publisher.ts` に `closePublisher` が無く、`gracefulShutdown` は workers と `lockClient` のみ閉じる。`queueCache` の `Queue` インスタンス（各 Redis 接続保持）も `.close()` されない。
- **修正内容:** `closePublisher()` と `closeMetricsQueues()` を実装し `gracefulShutdown` から呼ぶ。
- **依存:** R3-H10 と同領域。
- **検証:** シャットダウン後に Redis 接続が残らないこと。

### R3-M10. Twitter クライアントのシングルトンがトークンローテーション不可
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `getTwitterClient` は都度 `new TwitterApiClient(...)` を返す実装で、グローバルシングルトンは廃止済み。
- **対象:** `packages/validation-provider-twitter/src/client.ts:136-146`
- **問題:** `twitterClient` が初回呼び出し時の `TWITTER_BEARER_TOKEN` を束縛してキャッシュし、トークンをローテーションしても Worker 再起動まで反映されない（GitHub 側は対応済み）。
- **修正内容:** シングルトンを廃止し毎回生成する、または env 変更検知でキャッシュ破棄する。
- **依存:** なし
- **検証:** トークン変更後、Worker 再起動なしで新トークンが使われること。

### R3-M11. Discord の `pLimit(3)` がプロセスローカルでマルチレプリカ時に無効
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `generic-validation` に Redis 分散ロック（`withRedisLock` + `DISCORD_VALIDATION_LOCK_KEY`）を導入済みで、レプリカ横断で Discord API 呼び出しの同時実行を制御する構成へ移行済み（`DISCORD_DISTRIBUTED_LOCK_TIMEOUT` で再試行制御）。
- **対象:** `packages/validation-provider-discord/src/requests.ts:26`
- **問題:** `pLimit(3)` は単一プロセス内の同時実行のみ制限。Worker を複数レプリカで動かすと Discord への実効並列度がレプリカ数倍になり、レート制限保護として誤った安心感を与える。
- **修正内容:** Discord 用キューの `concurrency` を 1 に絞って単一ワーカーに集約する、または Redis ベースの分散レートリミッタで制御する。
- **依存:** R3-M12（concurrency 設定化）と関連。
- **検証:** 複数レプリカ構成でも Discord への並列度が制御されること。

### R3-M12. Worker の concurrency がハードコード
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `getWorkerConcurrency()` が `WORKER_CONCURRENCY` とキュー別 `WORKER_CONCURRENCY_<QUEUE>` オーバーライドを解釈する実装へ更新済み。
- **対象:** `apps/worker/src/lib/worker-factory.ts:11`
- **問題:** `concurrency: 5` 固定で env から設定できず、プロバイダーごとのレート制限に合わせた調整ができない。
- **修正内容:** `parsePositiveIntEnv("WORKER_CONCURRENCY", 5)` を導入し、必要に応じてキュー名ごとにオーバーライド可能にする。
- **依存:** R3-M11 と関連。
- **検証:** env で concurrency を変更でき、キュー別オーバーライドが効くこと。

### R3-M13. `field-encryption` の `scryptSync` がリクエストごとに実行
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（実装反映済み・追跡PR未整理）
- **進捗:** `cachedRawKey` を用いた派生鍵キャッシュ実装により、KDF の都度実行は解消済み。
- **対象:** `apps/worker/src/lib/field-encryption.ts:12-17`
- **問題:** `getRawKey()` が `encrypt`/`decrypt` のたびに重い KDF `scryptSync` を実行し、OAuth トークン取得のホットパスをブロックする。
- **修正内容:** 派生鍵をモジュールスコープで 1 度だけキャッシュする。
- **依存:** なし
- **検証:** 暗号化/復号のたびに `scryptSync` が走らないこと。

### R3-M14. `writeValidationResult` の INSERT→SELECT が非アトミック
- **重要度:** 🟡 Medium
- **対象:** `apps/worker/src/lib/validation-helpers.ts:125-168`
- **問題:** `INSERT ... ON DUPLICATE KEY UPDATE` の後に別クエリで `SELECT id` するため、並行ジョブが同一キーで upsert すると取得 `id` が race し SSE イベントの `validationResultId` がずれうる。
- **修正内容:** upsert 戻り値から行 ID を取得する、または `id` を `(responseId, ruleId, referencedBlockId)` から決定論的に算出（UUIDv5 等）して SELECT を不要にする。
- **依存:** なし
- **検証:** 並行 upsert でも正しい行 ID が返ること。
- **対応状況:** ✅ 完了（PR #98、gh-review-hook exit 0、merged）

### R3-M15. ユーザー参照カラムに FK が無く孤立する・型長不一致
- **重要度:** 🟡 Medium
- **対象:** `packages/database/src/schema.ts`：`formShareLink.createdBy:272`、`formInvitation.invitedBy:326`、`formStructure.createdBy:352`、`formSnapshot.publishedBy:480`、`userInvite.invitedBy:456`、`formIntegration.ownerUserId:292`/`userId:293`、`validationDiscordRole.guildId:719`
- **問題:** `relations()` では `user`/`validationDiscordGuild` を参照しているが、カラム定義に `.references()` が無く DB レベルの FK が存在しない。ユーザー/ギルド削除でこれらの行が孤立する。さらに `user.id` は `varchar(191)` なのにユーザー参照カラムは `varchar(255)` で型長不一致のため FK 後付けが失敗する。
- **修正内容:** ユーザー参照カラムの長さを `191` に揃え `.references(() => user.id, { onDelete: ... })` を付与（`onDelete` は監査要件で決定）。`validationDiscordRole.guildId` に `onDelete: "cascade"` の FK を付与。要マイグレーション。
- **依存:** なし
- **検証:** 参照先削除時に子行が FK 制約どおり処理されること。
- **対応状況:** ✅ 完了（PR #99、gh-review-hook exit 0、merged）

### R3-M16. docker-compose が弱いクレデンシャルで全ポートを公開
- **重要度:** 🟡 Medium
- **対象:** `docker-compose.yml`（MySQL `3306`、MinIO `9000`/`9001`、Redis `6379`）
- **問題:** ハードコードされた弱いパスワード（`nexus_root_password`/`minioadmin123`）がコミットされ、全ポートが `0.0.0.0` にバインドされる。Redis は `requirepass` なしで無認証。同一ネットワークの他端末からアクセス可能。
- **修正内容:** ポートバインドを `127.0.0.1:3306:3306` 等のループバック限定にする。クレデンシャルは `.env` から `${MYSQL_ROOT_PASSWORD}` 形式で注入。Redis に `--requirepass` を付与。
- **依存:** なし
- **検証:** ループバック外からサービスに到達できないこと。
- **対応状況:** ✅ 完了（PR #100、gh-review-hook exit 0、merged）

### R3-M17. 巨大コンポーネントの分割
- **重要度:** 🟡 Medium
- **対象:** `apps/web/src/components/form/block-validation-editor.tsx`（約 1060 行）、`apps/web/src/components/forms/google-sheets-integration.tsx`（約 1030 行）ほか 1000 行超ファイル
- **問題:** CLAUDE.md「肥大化したコンポーネントは焦点を絞ったサブコンポーネントに分割」に反する（旧 R2-M16 で一部対応済みだが残存）。
- **修正内容:** type 別レンダラーごとにファイル分割。`google-sheets-integration` は接続/選択/同期で分離。
- **依存:** R3-H18（同ファイル `block-validation-editor`）の後に着手。
- **検証:** 各ファイルが読みやすい行数に収まり機能が維持されること。
- **対応状況:** ✅ 完了（PR #102 merged、gh-review-hook exit 0）

### R3-M18. `useFormLogic` のメモ化が `responses` 全体依存で実質無効
- **重要度:** 🟡 Medium
- **対象:** `apps/web/src/hooks/forms/use-form-logic.ts:31-154`
- **問題:** `getVisibleQuestions` 等を `useCallback`/`useMemo` で包むが依存配列が `[sections, responses]`。回答が 1 文字変わるたびに全コールバック・全メモが再計算され、巨大フォームで毎キーストロークごとに全ルール走査が走る。
- **修正内容:** メモ化を外す、または `responses` のうちルールが実際に参照するキーのみに依存を絞る。あるいは `evaluateRule` の結果をルール単位でキャッシュする。
- **依存:** なし
- **検証:** 入力ごとの再計算コストが削減されること。
- **対応状況:** ✅ 完了（PR #102 merged、subagent review NO FINDINGS、local validation 通過）

### R3-M19. Google OAuth の `redirect_uri` がリクエスト Origin にフォールバック（再レビュー新規）
- **重要度:** 🟡 Medium
- **対象:** `apps/api/src/routes/integrations-google.ts:197-202, 260-265`
- **問題:** `NEXT_PUBLIC_BASE_URL` 未設定時、`c.req.header("origin")`（攻撃者制御可能）を `redirect_uri` のベースに使う。Google 側ホワイトリストで通常はブロックされるが、設定ミス時にオープンリダイレクト/トークン窃取の温床となる。
- **修正内容:** `redirect_uri` は環境変数の固定値のみを使用し、未設定時はエラーにする。
- **依存:** なし
- **検証:** リクエスト Origin ヘッダーが `redirect_uri` に影響しないこと。
- **対応状況:** ✅ 完了（PR #103 merged、gh-review-hook exit 0）

### R3-M20. 招待取得エンドポイントが未認証で招待者メール（PII）を漏洩（再レビュー新規）
- **重要度:** 🟡 Medium
- **対象:** `apps/api/src/routes/forms-invites.ts:11-38`（GET `/invites/:token`）
- **問題:** 未認証でアクセス可能で `email`（PII）・`role`・`formTitle`・`message` を返す。`:token` の形式/長さ検証が無く、レート制限は IP 単位のみ（トークン単位ではない）。
- **修正内容:** レスポンスからメールアドレスを除外（または受信者本人セッション時のみ返す）。`:token` に zod 形式検証を追加。
- **依存:** なし
- **検証:** 未認証アクセス時にメールアドレスが返らないこと。
- **対応状況:** ✅ 完了（PR #104 merged、gh-review-hook exit 0）

### R3-M21. パスワード保護フォームのフェイルオープン（再レビュー新規）
- **重要度:** 🟡 Medium
- **対象:** `apps/api/src/routes/forms-public.ts:343`
- **問題:** `if (pwProtection?.enabled && pwProtection.password)` は `enabled=true` でも `password` が空/欠落のときゲートをスキップし、検証なしで送信を許可する。`forms-structure.ts:171-183` の PUT 経路にガードはあるが、競合書き込み次第で `enabled:true, password:undefined` が残る余地がある。
- **修正内容:** `enabled` のみで保護必須と判定し、`password` 欠落時は送信を拒否（フォーム設定不備エラー）する。
- **依存:** なし
- **検証:** `enabled:true` かつパスワード未設定のフォームで送信が拒否されること。
- **対応状況:** ✅ 完了（PR #105 merged、gh-review-hook exit 0）

### R3-M22. hCaptcha 検証が `hostname` を確認しない（再レビュー新規）
- **重要度:** 🟡 Medium
- **対象:** `apps/api/src/lib/security/hcaptcha.ts:194-219`（`verifyHCaptchaToken`）
- **問題:** hCaptcha レスポンスの `success`・スコアのみ確認し `hostname` を検証しない。別オリジンで取得されたトークンも通過する。リプレイ対策の `challenge_ts` 鮮度チェックも無い。
- **修正内容:** `validatedData.hostname` を期待ドメインと照合し、`challenge_ts` が一定時間内かを確認する。
- **依存:** なし
- **検証:** 別ホスト名のトークンが拒否されること。
- **対応状況:** ✅ 完了（PR #106 merged、gh-review-hook exit 0）

### R3-M23. Worker の OAuth 暗号鍵が `AUTH_SECRET` にフォールバック（再レビュー新規）
- **重要度:** 🟡 Medium
- **対象:** `apps/worker/src/lib/field-encryption.ts:13-17`
- **問題:** `GOOGLE_OAUTH_ENC_KEY` 未設定時に認証用 `AUTH_SECRET` を流用する。`AUTH_SECRET` のローテーションで保存済み OAuth トークンが全て復号不能になる。
- **修正内容:** 鍵の用途を分離し、専用鍵未設定時はフォールバックせずエラーにする。
- **依存:** R3-M13（同ファイルの鍵キャッシュ）と同領域。
- **検証:** 専用鍵未設定で起動が失敗すること、`AUTH_SECRET` 変更が保存済みトークンに影響しないこと。
- **対応状況:** ✅ 完了（PR #107 merged、gh-review-hook exit 0）

### R3-M24. `objectExists` があらゆる例外で `false` を返す（再レビュー新規）
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #108 merged、gh-review-hook exit 0）
- **対象:** `apps/api/src/lib/s3/utils.ts:70-85`
- **問題:** `catch (_error) { return false }` で、ネットワーク障害・認証エラー・権限エラーも「存在しない」と扱う。「存在する」前提のロジックでこの結果を使うと静かに誤動作する。
- **修正内容:** 404 系のみ `false`、それ以外は throw に分離する。`utils.ts:109` の未使用変数 `_chunks` も削除。
- **依存:** なし
- **検証:** S3 障害時に `objectExists` が誤って `false` を返さないこと。

### R3-M25. `spreadsheetId` の URL エンコード欠落（再レビュー新規）
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #109 merged、gh-review-hook exit 0）
- **対象:** `apps/worker/src/lib/google-sheets-client.ts:112`（`appendRows` ほか `readRange`/`updateRange`）
- **問題:** エンドポイント組み立てで `sheetName` は `encodeURIComponent` 済みだが `spreadsheetId` は未エンコード。現状 ID は英数字のみで悪用不可だが一貫性を欠く。
- **修正内容:** `spreadsheetId` を含む全パスセグメントを `encodeURIComponent` する。
- **依存:** なし
- **検証:** 全 Sheets API 呼び出しのパスセグメントがエンコードされること。

### R3-M26. プロバイダーの `retryAfter` 単位ドリフトとエラーコード網羅の不一致（再レビュー新規）
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #110 merged、gh-review-hook exit 0）
- **対象:** `packages/validation-provider-discord/src/plugin.ts:340-363`、`packages/validation-provider-github/src/plugin.ts:98-125`、`packages/validation-provider-twitter/src/utils.ts:37-55`
- **問題:** (1) `ValidationProviderResult.retryAfter` は秒だが Discord/Twitter は `30`/`60` をハードコードし API 応答の実 `retry_after` を使わない。`discord/src/utils.ts:getRateLimitRetryAfter` はミリ秒を返し単位不整合。(2) Discord は 401（ボットトークン失効）を扱わず `DISCORD_API_ERROR` に丸める。GitHub プラグインの `catch` は rate-limit のみ判定し `client.ts` が付与した `code` を活用しない。Twitter は 429/401/403/404 を網羅しており、3 プロバイダー間でドリフトしている。
- **修正内容:** 429 ハンドリングで実 `retry_after` を秒換算して返す（R3-H6 と連動）。Discord に 401→認証エラーコードを追加。GitHub プラグインの `catch` で `structured.code` を `errorCode` に反映。3 プロバイダーで共通のエラー分類方針に揃える。
- **依存:** R3-H6（`retryAfter` のバックオフ反映）と関連。
- **検証:** 各プロバイダーが API 応答の実待機時間と認証失敗を正しく分類すること。

---

## Phase 5: Low

### R3-L1. `getCorsOrigins()` の重複定義
- **重要度:** 🟢 Low / **対象:** `apps/api/src/index.ts:51-75`、`apps/api/src/routes/telemetry.ts:10-23`
- **対応状況:** ✅ 完了（PR #111 merged、gh-review-hook exit 0）
- **修正内容:** ほぼ同一の CORS オリジン解決ロジックを共通ヘルパーに抽出する。

### R3-L2. `forms-responses` のリトライ処理が素の `console` を使用
- **重要度:** 🟢 Low / **対象:** `apps/api/src/routes/forms-responses.ts:105,147,161` 付近
- **対応状況:** ✅ 完了（PR #112 merged、gh-review-hook exit 0）
- **問題:** `enqueueValidationRetries` が構造化ロガー `logError`/`logWarn` ではなく素の `console` を使い、ログ集約・Sentry から漏れる。
- **修正内容:** 構造化ロガーに統一する。

### R3-L3. デッドコードの除去
- **重要度:** 🟢 Low / **対象:** `apps/api/src/routes/_helpers.ts`（`notImplemented`/`ok` 未使用）、`apps/api/src/lib/forms/schedule-processor.ts:55-59`（空の `if (userId)` ブロック）、`apps/worker/src/handlers/generic-validation.ts:43-52`（`RETRYABLE_CODES` 到達不能）、`packages/validation-provider-twitter/src/config.ts:38-53`（未使用 `retryAttempts`/`retryDelay`）
- **対応状況:** ✅ 完了（PR #113 merged、gh-review-hook exit 0）
- **進捗:** 未使用の `apps/api/src/routes/_helpers.ts` を削除し、`processFormSchedule` の未使用 `userId` 引数と空の権限チェックブロックを削除済み。`RETRYABLE_CODES` は現行 worker のリトライ判定で参照されているため削除対象外、Twitter provider の `retryAttempts`/`retryDelay` は既に存在しないことを確認済み。`pnpm lint:fix` / `pnpm type-check` / `pnpm test --silent`、サブエージェントレビュー、PR #113 の `gh-review-hook` はすべて通過。
- **修正内容:** 各デッドコードを削除する。`schedule-processor` の `userId` 引数も実質未使用なら整理。

### R3-L4. `avatar.ts` のリダイレクト URL が不正
- **重要度:** 🟢 Low / **対象:** `apps/api/src/routes/avatar.ts:13`
- **対応状況:** ✅ 完了（PR #114 merged、gh-review-hook exit 0）
- **進捗:** `/api/avatar` の呼び出し元を検索し、API ルーター登録以外の利用が見当たらないことを確認。未使用ルートとして削除し、`apps/api/src/index.ts` の import/route 登録も削除済み。`pnpm lint:fix` / `pnpm type-check` / `pnpm test --silent`、サブエージェントレビュー、PR #114 の `gh-review-hook` はすべて通過。
- **問題:** `https://cdn.discordapp.com/avatars/${userId}` はアバターハッシュ・拡張子が欠落し有効な CDN URL にならない。`apps/web` 内に呼び出し元が見当たらず未使用の可能性が高い。
- **修正内容:** 未使用なら当エンドポイントを削除。使用する場合は `/avatars/{id}/{hash}.png` 形式の正しい URL を構築する。

### R3-L5. `field-encryption` 以外のシングルトン/設定の非対称・整合性
- **重要度:** 🟢 Low / **対象:** `apps/api/src/lib/auth.ts`（`signin-with-invitation` が `AUTH_SECRET` のみ参照、`auth.ts` 本体は `BETTER_AUTH_SECRET` も許容）、`packages/validation-provider-discord/src/plugin.ts:184`（`inputPattern` が大文字を許容するが現行 Discord ユーザー名は小文字のみ）、`packages/validation-provider-twitter/src/plugin.ts:143`（ヘルスチェックが疑わしいエンドポイント `openapi.json`）
- **対応状況:** ✅ 完了（PR #115 merged、gh-review-hook exit 0）
- **進捗:** `auth.ts` は既に `BETTER_AUTH_SECRET || AUTH_SECRET` を使う実装に統一済みで追加変更不要。Discord username pattern を小文字のみに揃え、ユーザー向け説明文も小文字制約に更新済み。Twitter health check を `openapi.json` ではなく user lookup endpoint に変更し、成功応答・401/403/404/429 を到達性あり、5xx/ネットワークエラーを不健康として扱う形に整理済み。Discord uppercase rejection と Twitter health check の成功・401・403・404・429・500・ネットワークエラーをテストで固定。`pnpm lint:fix` / `pnpm type-check` / `pnpm test --silent`、サブエージェントレビュー、PR #115 の `gh-review-hook` はすべて通過。
- **修正内容:** シークレット参照を統一。Discord パターンを小文字のみに揃える。Twitter ヘルスチェックを安定したエンドポイント/判定に見直す。

### R3-L6. `__root.tsx` にエラーバウンダリ未設定
- **重要度:** 🟢 Low / **対象:** `apps/web/src/routes/__root.tsx:5-13`
- **対応状況:** ✅ 完了（PR #116 merged、gh-review-hook exit 0）
- **進捗:** ルート用の `RootErrorPage` を追加し、`createRootRoute` の `errorComponent` に接続済み。開発環境のみ詳細エラーを表示し、本番では再試行とホーム遷移の復旧導線を出す。`pnpm lint:fix` / `pnpm type-check` / `pnpm test --silent`、サブエージェントレビュー、PR #116 の `gh-review-hook` はすべて通過。
- **問題:** `notFoundComponent` はあるが `errorComponent` が無く、ローダー/レンダリングの未捕捉エラーで本番にユーザーフレンドリーなページが出ない。
- **修正内容:** ルートに `errorComponent` を設定する。

### R3-L7. アクセシビリティの軽微な不足
- **重要度:** 🟢 Low / **対象:** `apps/web/src/components/form/question-sorter.tsx:36-51`（並べ替えボタンに `aria-label` 無し）、`form-editor-page.tsx`（タブが `role="tablist"` 非準拠、ローディング表示に `aria-live` 無し）
- **対応状況:** ✅ 完了（PR #117 merged、gh-review-hook exit 0）
- **進捗:** `question-sorter` の移動ボタンに `aria-label` と境界時の `disabled` を追加し、矢印テキストを lucide アイコンへ変更済み。`form-editor-page` は Radix Tabs ベースの `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` に寄せ、読み込み表示へ `role="status"` / `aria-live="polite"` を追加済み。回答タブは初回表示後の状態保持を維持しつつ、非アクティブ時は `hidden` / `aria-hidden` で隠す。`pnpm lint:fix` / `pnpm type-check` / `pnpm test --silent`、サブエージェントレビュー、PR #117 の `gh-review-hook` はすべて通過。
- **修正内容:** 並べ替えボタンに `aria-label`、タブ群を WAI-ARIA Tabs パターン（Radix `Tabs` 流用可）に、状態表示に `role="status"`/`aria-live="polite"` を付与する。

### R3-L8. 重複/二重定義の整理
- **重要度:** 🟢 Low / **対象:** `packages/shared`（`FormStatus` が schema の `formStatusEnum` と `validation/shared.ts` の `FormStatus` で二重定義、`ValidationSSEEventSchema` の `status` enum が DB `validationStatusEnum` と非同期）、`apps/web/src/hooks/use-debounced-value.ts:16`/`useLongTextValidation.ts:44,103`（bare `clearTimeout` — 規約は `window.clearTimeout`）
- **対応状況:** ✅ 完了（PR #118 merged、gh-review-hook exit 0）
- **進捗:** `packages/shared/src/constants/status.ts` にフォーム/検証ステータス値の共通定数を追加し、`FormStatus` Zod schema、`ValidationSSEEventSchema`、DB enum が同じ定数を参照するよう変更済み。`use-debounced-value` と `useLongTextValidation` の bare `clearTimeout` は `window.clearTimeout` に変更済み。CI 失敗（`@nexus-form/shared/constants/status` の解決失敗）に対して `packages/database/src/schema.ts` の import を `@nexus-form/shared` に調整し、`rtk pnpm lint:fix` / `rtk pnpm type-check` / `rtk pnpm test --silent` を通過。PR #118 は 2026-05-19 に merge 済み。
- **修正内容:** enum 値配列を 1 箇所の定数に集約し schema/zod 双方が参照する。`clearTimeout` を `window.clearTimeout` に統一。

### R3-L9. `editorMessage`/`errorMessage` への内部詳細混入・スキーマ過緩和
- **重要度:** 🟢 Low / **対象:** `packages/shared/src/validation/shared.ts:67-74`（`StoredLogicRuleSchema.condition/action` が `z.record(z.unknown())` で実質ノーバリデーション、TODO 済み）、`packages/shared/src/response-data.ts:51`（`questionValidationSchema` の `.passthrough()` が typo を黙殺）
- **対応状況:** ✅ 完了（PR #120 merged、全CI success）
- **進捗:** `StoredLogicRuleSchema` の `condition/action` を具体 shape（`field`/`operator`/`value`、`type`/`targetBlockId`）へ更新し、必須キー欠落/空文字をテストで網羅。DB既存データ互換性のため `condition/action` の unknown key は reject せず strip で受理する方針に調整（`parseStoredStructure` read path を破壊しない）。`questionValidationSchema` は既存ロジック互換維持のため `.passthrough()` を維持。`rtk pnpm lint:fix` / `rtk pnpm type-check` / `rtk pnpm test --silent` 通過後、PR #120 を merge 済み。
- **修正内容:** ロジックエディタの shape 確定後に `z.discriminatedUnion` 等で具体化。`.passthrough()` は可能なら `.strict()` に、必要なら理由をコメント化する。

---

## Phase 6: テスト

### R3-T1. 認証バイパス回帰テストの追加
- **重要度:** 🟠 High（R3-C1/R3-C2 の回帰防止）/ **対象:** `apps/api/src/__tests__/`
- **対応状況:** ✅ 完了（PR #121 merged、local validation 通過）
- **進捗:** `tokens-validate.test.ts` で「他ユーザー token の詳細非漏洩」「未セッション時 401」「停止オーナー 403」を検証、`dual-auth-suspended.test.ts` で「停止セッション/停止トークンオーナーが dual auth/dual form auth で 403」を検証済み。`rtk pnpm lint:fix` / `rtk pnpm type-check` / `rtk pnpm test --silent` 通過。
- **問題:** `phase6/authz-tests`（`authz-regression.test.ts`）は R2 系をカバーするが、**R3-C1（トークンオラクル）と R3-C2（停止ユーザーバイパス）の回帰テストが存在しない**。
- **修正内容:** (1) 他ユーザーのトークン文字列で `/api/tokens/validate` を叩いても `user_id`/`scopes` が漏れないこと、(2) 停止ユーザーのセッションでフォーム系エンドポイントが 403 になること、の回帰テストを追加する。
- **依存:** R3-C1, R3-C2（各修正後にテスト追加）。
- **検証:** `pnpm --filter @nexus-form/api test` が通過すること。

### R3-T2. 再レビュー Critical の回帰テスト追加（再レビュー新規）
- **重要度:** 🟠 High（R3-C8/C9/C10/C11 の回帰防止）
- **対象:** `apps/api/src/__tests__/`、`apps/web` の該当コンポーネント/フックテスト
- **対応状況:** ✅ 完了（PR #121 merged、local validation 通過）
- **進捗:** API 側は `fingerprint-manage-delete.test.ts`（R3-C8）と `share-link-token.test.ts`（R3-C9）で回帰を担保済み。今回 `apps/web` に Vitest 基盤（`vitest.config.ts`, `test` script）を追加し、`form-structure-query-keys.test.ts` で logic/access-control query key 分離（R3-C10）、`rating-question.test.tsx` で radio の checked 単一性（R3-C11）を追加。`rtk pnpm lint:fix` / `rtk pnpm type-check` / `rtk pnpm test --silent` 通過。
- **問題:** 再レビューで検出した Critical（フィンガープリント全件削除・共有リンクトークン認証不能・query key 衝突・rating ラジオ）に回帰テストが無い。
- **修正内容:**
  1. **R3-C8:** 回答 0 件のフォーム ID で DELETE `/manage` を呼んでも他フォームのフィンガープリント行が削除されないこと。
  2. **R3-C9:** 共有リンクで発行した API トークンが `validateApiToken` で解決され、フォームアクセスが成功すること。
  3. **R3-C10/C11:** フロントは可能なら fixture テストで、ロジック/アクセス制御の相互上書きが起きないこと・rating ラジオの選択が単一であることを検証。
- **依存:** R3-C8〜C11（各修正後にテスト追加）。
- **検証:** `pnpm --filter @nexus-form/api test` および web テストが通過すること。

---

## 保留（人間判断が必要 / ラウンド1〜2 から継続）

- **旧 M-14（`configJson` カラム型・命名統一）:** `formIntegration` は snake_case DB 列（`config_json` 等）+ `text` 型、`formValidationRule.configJson` は camelCase 列 + `json` 型で不統一。「camelCase に揃える」か「snake_case に揃える」かで修正が逆転するため方針を人間が確定してから着手。
- **旧 L-11（`formResponse.respondentUuid` の UNIQUE 制約）:** グローバル `.unique()` が `allowEditResponses` による再提出や同一回答者の複数フォーム回答と矛盾しないか、ビジネス要件（再提出は新規行か上書きか、同一回答者が複数フォーム回答可能か）が未確定。要件決定後に `(formId, respondentUuid)` 複合 unique への変更要否を判断。スワームレビューでも同制約による複数フォーム回答時の INSERT 失敗リスクが再指摘されている。
- **`external-service` の権限委譲（スワーム新規）:** `GET /api/external-service/:provider/:api?formId=...` は `EDITOR` 権限でフォーム作成者の OAuth 認証情報を使って外部 API を呼ぶ。共有リンク経由で `EDITOR` を得た第三者がオーナーの Discord/GitHub 認証情報でリクエストできる。意図的設計か、`auth_type === "session"` の真のメンバー限定にするか、人間判断が必要。
- **マイグレーション 0000→0001 の FK 適用順序:** 初期 `0000` は FK をほぼ持たず `0001` で 20 件後付けする構成。新規環境では問題ないが、`0000` と `0001` の間に運用すると参照整合性が効かず、不整合行があると `0001` が失敗する。本番適用手順の文書化（`0001` 適用前の孤児行チェック）を要検討。

---

## 依存関係・推奨スプリント

```
最優先（並行着手可）
  R3-C1, R3-C2 ──→ R3-T1（認証バイパス回帰テスト）
  R3-C8, R3-C9 ──→ R3-T2（再レビュー Critical 回帰テスト）
  R3-C3, R3-C4, R3-C5, R3-C6, R3-C7, R3-C10, R3-C11（各独立）

順序制約
  R3-C4 ←→ R3-H9     （プラグイン起動経路、同時実施）
  R3-C6 ←→ R3-H26    （zod 契約整備、同方針）
  R3-C10 ←→ R3-H15   （query key 安定化、同領域）
  R3-H1 ←→ R3-H5     （forms-responses.ts、同時実施）
  R3-H6 ←→ R3-M26    （プロバイダー retryAfter / エラー分類）
  R3-H11 ←→ R3-H12 ←→ R3-M8  （SSE フック群、同時実施）
  R3-H13 → R3-H14     （検証タブ・スナップショット復元）
  R3-H18 → R3-M17     （block-validation-editor の分割は ID 修正後）
  R3-H19, R3-H20      （dual-auth.ts 共有リンク認可、同ファイル・同時実施）
  R3-C3 ←→ R3-M7      （form-response-settings の相対パス + エラー契約）
  R3-M13 ←→ R3-M23    （field-encryption の鍵キャッシュ/分離）

独立（いつでも着手可）
  R3-H2〜H4, R3-H7, R3-H8, R3-H10, R3-H16, R3-H17,
  R3-H21〜H25, R3-H27, R3-H28,
  R3-M1〜M6, R3-M9〜M12, R3-M14〜M16, R3-M18〜M25, R3-L1〜L9
```

1. **Sprint 1（緊急・Critical）:** R3-C1〜R3-C11 ＋ R3-T1, R3-T2
   - セキュリティ/データ損失直結: R3-C1, R3-C8, R3-C9, R3-H19, R3-H20, R3-H21, R3-H22 を優先。
2. **Sprint 2（API/Worker High）:** R3-H1〜R3-H10, R3-H19〜R3-H28
3. **Sprint 3（Frontend High）:** R3-H11〜R3-H18
4. **Sprint 4（Medium）:** R3-M1〜R3-M26
5. **Sprint 5（Low）:** R3-L1〜R3-L9

---

# nexus-form コードベースレビュー 対応タスク（ラウンド4）

レビュー日: 2026-05-20 / 対象: 全ワークスペース（apps/api, apps/web, apps/worker, packages/database, packages/shared, integrations, validation providers）
レビュー手法: サブエージェント 4 領域分担レビュー（API/認可・Web/UX・Worker/Integrations・Database/Shared/Tooling）+ ローカル確認。

**注記:** `AGENTS.md` が要求する `$orchestration-harness` skill はこのセッションの skill 一覧に無かったため、最小 best-effort のレビュー手順で実施。ファイル編集はこのタスク更新のみ。

各タスクは `ID / 重要度 / 対象ファイル / 問題 / 修正内容 / 依存 / 検証` で構成。
重要度: 🔴 Critical → 🟠 High → 🟡 Medium → 🟢 Low。

## Phase 0: 緊急 hotfix（Critical）

### R4-C1. 公開フォーム API が `/api/forms` 認証ミドルウェアに先に捕捉される
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR 作成中、subagent review 通過、local validation 通過）
- **対象:** `apps/api/src/index.ts:112-123`, `apps/api/src/routes/forms.ts:24-26`, `apps/api/src/routes/forms-public.ts:181`
- **問題:** `index.ts` は `.route("/api/forms", formsRouter)` を public/shared ルーターより先に登録している。`formsRouter` は `.use("*", withDualAuth())` を持つため、`/api/forms/public/:publicId` や `/api/forms/shared/:token` が公開ルートへ到達する前に 401 になる。ローカルの最小 Hono 再現でも同じルート順で `401 auth` になることを確認済み。
- **修正内容:** `formsPublicRouter` と `formsInvitesRouter` など公開/未認証ルートを、`formsRouter` より前に登録する。より堅牢には、認証必須ルーターの wildcard middleware を `/` と作成系に限定し、公開パスを同じ prefix の後続 route に依存させない。
- **依存:** なし（最優先）
- **検証:** 未認証で `GET /api/forms/public/:publicId`, `POST /api/forms/public/:publicId/submit`, `GET /api/forms/shared/:token` が想定ステータスを返すこと。Hono route order の回帰テストを追加する。

### R4-C2. 一般ユーザーが `admin` スコープ API トークンを自己発行できる
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了
- **対象:** `packages/shared/src/api-tokens.ts:4`, `apps/api/src/routes/tokens.ts:35-46`, `apps/api/src/routes/tokens.ts:99-104`, `apps/api/src/routes/services.ts:112`
- **問題:** `apiTokenScopeSchema` は `admin` を許可し、`POST /api/tokens` / `PATCH /api/tokens/:id` はセッションユーザーのロールを確認せずに指定 scope を保存する。一方、`withDualAuth(["admin"])` は API トークンの `admin` scope を管理者扱いするため、非管理者が管理 API に到達できる。
- **修正内容:** トークン作成/更新時に `admin` scope は管理者セッションのみ許可する。さらに `validateApiTokenWithScopes` または `authenticateDual` の admin scope 要求時に、トークン所有者の現在の `user.role === "admin"` を確認し、降格後の既存 admin token も無効化する。
- **依存:** なし（最優先）
- **検証:** 非管理者セッションで `admin` scope token を作成/更新できないこと。既存 admin scope token の所有者が非管理者の場合、`/api/services/*` が 403 になること。

### R4-C3. `read` scope の API トークンでフォーム書き込み操作が可能
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #169）
- **対象:** `apps/api/src/lib/dual-auth.ts:692-735`, `apps/api/src/routes/forms-detail.ts:100`, `apps/api/src/routes/forms-responses.ts:414`
- **問題:** 多くの mutation ルートが `withDualFormAuth("EDITOR")` / `withDualFormAuth("OWNER")` に `requiredScopes` を渡していない。API トークン経路ではフォーム権限チェックだけで通過するため、`read` scope token でもフォーム更新、回答作成/更新/削除、公開/非公開などが可能になる。
- **修正内容:** `withDualFormAuth` で `requiredRole` が `EDITOR` または `OWNER` の場合、API トークンには `write` または `admin` scope を必須にする。例外が必要な read-only ルートは明示的に `VIEWER` を使う。個別ルートで `withDualFormAuth("EDITOR", ["write"])` を明示してもよいが、デフォルト安全側に倒すこと。
- **依存:** R4-C2 と同じ API token 認可領域。
- **検証:** `read` token で PUT/POST/PATCH/DELETE 系フォームリソースが拒否され、`write` token で許可される回帰テストを追加する。

## Phase 1: API High

### R4-H1. パスワード保護フォームの公開 GET が未検証で設問構造を返す
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #170）
- **対象:** `apps/api/src/routes/forms-public.ts:231-244`, `apps/web/src/components/forms/public-form-page.tsx:206-213`
- **問題:** API は `isPasswordProtected` と hint を返すだけで、未検証でも `structure` と `plateContent` を返す。Web も `formData.form.isPasswordProtected` を見ずに常に `FormBody` を描画する。送信時だけパスワード検証を要求するため、閲覧保護の意図と矛盾し、設問内容・条件ロジックが漏れる。
- **修正内容:** API は `pwProtection.enabled` かつ `cf_session` に対象フォームの検証済み JWT が無い場合、メタ情報と `passwordRequired`/hint のみ返し、`structure` / `plateContent` を返さない。Web は `PasswordProtectionGate` を接続し、検証後にフォーム本体を再取得/表示する。
- **依存:** R4-C1（公開ルート到達性）
- **検証:** 未検証状態で保護フォームの設問本文が API/UI のどちらからも取得できないこと。パスワード検証後は表示・送信できること。

### R4-H2. EDITOR がフォーム所有者の OAuth 連携情報を外部サービス API 経由で利用できる
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #173 merged、gh-review-hook exit 0）
- **対象:** `apps/api/src/routes/external-service.ts:50-65`, `apps/api/src/routes/external-service.ts:116-145`, `packages/validation-provider-discord/src/plugin.ts:406`
- **問題:** `formId` query がある場合、EDITOR 権限を満たすと `effectiveUserId` がフォーム作成者に切り替わり、Discord guild/role 一覧などを所有者の OAuth token で取得できる。共同編集者へ所有者の外部アカウント情報を委任する明示仕様が無い限り情報漏えい。
- **修正内容:** 外部アカウント由来の一覧取得は OWNER 限定、または所有者が明示的に委任した integration のみに限定する。共有リンク/匿名 token 経由の EDITOR では所有者 OAuth を使わせない。
- **依存:** R4-C3（API token/write scope）と同じ認可整理。
- **検証:** EDITOR が `formId` 付き外部サービス API で所有者の Discord guild/role を取得できないこと。OWNER または明示委任済みのケースだけ成功すること。

### R4-H3. 公開・管理回答ペイロードにサイズ/個数上限がなく DoS に弱い
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #174 merged、gh-review-hook exit 0）
- **対象:** `apps/api/src/routes/forms-public.ts:62`, `packages/shared/src/response-data.ts:67`, `apps/api/src/routes/forms-responses.ts:76`
- **問題:** `responses`、`fingerprints`、回答文字列、選択肢配列、responses map などに実質上限が無い。レート制限は回数だけなので、少数の巨大 JSON でメモリ、Zod 検証、DB 保存、後続 Worker 処理に負荷をかけられる。
- **修正内容:** Hono body limit を導入し、Zod 側でも回答数、文字列長、選択肢配列長、fingerprint 数をフォーム仕様に沿って制限する。DB 保存前に JSON サイズも確認する。
- **依存:** なし
- **検証:** 境界値内は成功し、巨大 JSON / 過大配列 / 長大文字列は 413 または 400 で拒否されること。

## Phase 2: Worker / Integrations High

### R4-H4. 一過性の外部 API 障害が BullMQ retry に乗らず即 FAILED になる
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #175 merged、gh-review-hook exit 0）
- **対象:** `apps/worker/src/handlers/generic-validation.ts:311-332`, `packages/validation-provider-twitter/src/plugin.ts:91`, `packages/validation-provider-github/src/plugin.ts:101`, `packages/validation-provider-discord/src/plugin.ts:343`
- **問題:** `handleGenericValidation` は provider が例外を投げた場合のみ retryable code/status を見て再 throw する。一方、各 provider は network error / timeout / 5xx を `ValidationProviderResult` として返すため、result path では `retryAfter` 以外が恒久失敗として保存される。
- **修正内容:** provider result に `retryable` を追加して worker 側で retry/backoff へ流す、または一過性障害は result に変換せず例外として投げる設計に統一する。`NETWORK_ERROR` / `TIMEOUT` / 429 / 5xx 系の retry 方針を provider 間で揃える。
- **依存:** R4-H5（retryAfter 上限）
- **検証:** 各 provider の一過性障害が BullMQ の retry に乗り、恒久エラーだけ FAILED として保存されること。

### R4-H5. `retryAfter` 付き provider result が試行回数上限なしで delayed loop しうる
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: retryAfter 上限・clamp・FAILED 確定テストあり）
- **対象:** `apps/worker/src/handlers/generic-validation.ts:332-334`
- **問題:** `result.retryAfter > 0` の場合、`job.moveToDelayed(...)` 後に `DelayedError` を投げる。この経路は通常の failed/backoff と異なり、API 側の `attempts` 上限を回避する可能性がある。外部 API が rate limit を返し続けると検証結果が `PROCESSING` のまま無期限 delayed loop になる。
- **修正内容:** `job.attemptsMade` または独自 counter を見て上限到達時は FAILED に確定する。`retryAfter` は最大値を clamp する。可能なら BullMQ 標準 retry/backoff に統一する。
- **依存:** R4-H4
- **検証:** `retryAfter` が続くケースで、所定回数後に FAILED として確定するテストを追加する。

### R4-H6. 組み込み validation provider の読み込み失敗が startup failure にならない
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: built-in plugin 読み込み/登録失敗時 fail-fast テストあり）
- **対象:** `packages/integrations/src/startup.ts:269-284`
- **問題:** built-in plugin の `loadPluginFromFile` が `skipped` / `failed` でもログだけで続行する。API/Worker が provider 欠落状態で起動し、ジョブだけ残る、または plugin drift guard が差分を検出できない状態になりうる。
- **修正内容:** built-in plugin の読み込み失敗は fail-fast にする。外部 plugin は best-effort として扱う場合も、`requiredBuiltinPlugins` のように扱いを分ける。
- **依存:** なし
- **検証:** built-in plugin の 1 つが壊れたときに `startupPlugins` が reject し、プロセス起動が失敗すること。

### R4-H7. plugin drift guard が起動順と 5 分 TTL に依存して drift を見逃す
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: TTL 延長・定期 refresh/比較・後発 peer 検知テストあり）
- **対象:** `packages/integrations/src/startup.ts:6`, `packages/integrations/src/startup.ts:163`
- **問題:** manifest は `EX 300` で startup 時に一度だけ publish される。peer 未起動時は警告して正常起動するため、rolling deploy や片系再起動の間隔が 5 分を超えると比較が実行されず drift を見逃す。
- **修正内容:** manifest を定期更新して継続比較する。TTL を deploy window より十分長くする。peer 未検出を一定猶予後に fatal または health degraded として扱う。
- **依存:** R4-H6 と同じ起動経路。
- **検証:** API/Worker の起動順や時間差があっても plugin manifest 差分が検知されること。

## Phase 3: Frontend High / Medium

### R4-H8. 編集画面の `tab` search param と内部 state が同期しない
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: search param が source of truth、タブ変更時 URL 更新あり）
- **対象:** `apps/web/src/routes/_authenticated/forms/$id/responses.tsx:5`, `apps/web/src/components/forms/form-editor-page.tsx:60`, `apps/web/src/components/forms/form-editor-page.tsx:229`
- **問題:** `/forms/:id/responses` は `?tab=responses` へリダイレクトするが、編集画面は search param を初期 state にしか使わず、タブ変更時も URL を更新しない。マウント済み状態で search が変わると表示タブが追従しない。
- **修正内容:** `tab` search param を source of truth にし、`onValueChange` で `router.navigate({ search: { tab: value } })` する。少なくとも search param 変更を `useEffect` で `activeTab` に同期する。
- **依存:** なし
- **検証:** `/forms/:id/responses` 直接遷移、ブラウザ戻る/進む、タブクリックで URL と表示タブが常に一致すること。

### R4-M1. プレビュー画面で `<a>` の中に `<button>` がネストされている
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（既存実装で確認済み: `Button asChild` + `Link` に統一済み）
- **対象:** `apps/web/src/components/forms/form-preview-page.tsx:142`, `apps/web/src/components/forms/form-preview-page.tsx:154`
- **問題:** `Link` の子に `Button` を置いており、native button が anchor 内にネストされる可能性がある。スクリーンリーダーやキーボード操作で不正な挙動になりうる。
- **修正内容:** `<Button asChild><Link ... /></Button>` に統一する。
- **依存:** なし
- **検証:** DOM 上で interactive element のネストが無く、キーボード操作で正常に遷移できること。

### R4-M2. 回答詳細を閉じるアイコンボタンにアクセシブル名がない
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（既存実装で確認済み: 閉じるボタン `aria-label`、切替ボタン `aria-pressed` あり）
- **対象:** `apps/web/src/components/forms/form-responses-page.tsx:253`
- **問題:** `X` アイコンのみのボタンに `aria-label` もテキストも無いため、支援技術で目的が伝わらない。
- **修正内容:** `aria-label="回答詳細を閉じる"` を追加する。リスト/分析切替ボタンにも `aria-pressed` を付けると状態が伝わりやすい。
- **依存:** なし
- **検証:** axe または Testing Library の accessible name 検証で閉じるボタンが識別できること。

## Phase 4: Database / Shared / Tooling

### R4-DB1. database/shared/tooling 領域は今回レビューで新規指摘なし
- **重要度:** 🟢 Low
- **対応状況:** ✅ 確認済み
- **対象:** `packages/database`, `packages/shared`, migrations, monorepo tooling
- **確認内容:** サブエージェントレビューでは新規指摘なし。`pnpm --filter @nexus-form/database type-check`, `pnpm --filter @nexus-form/shared type-check`, `pnpm --filter @nexus-form/shared test -- --run`, `pnpm --filter @nexus-form/database build` は成功。
- **残リスク:** MySQL 実体に対する migration apply は未実行。全体の `pnpm lint:fix` / `pnpm type-check` / `pnpm test --silent` は今回レビューでは未実行。

## Phase 5: ラウンド4 回帰テスト

### R4-T1. 認可・公開ルート回帰テスト
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: 公開ルート順序・admin scope・read/write token 回帰テストあり）
- **対象:** `apps/api/src/__tests__/`
- **修正内容:** R4-C1〜C3 の修正後、以下をテスト化する。
  1. 未認証で公開フォーム取得/送信/共有リンク取得が認証 middleware に捕捉されない。
  2. 非管理者は `admin` scope token を作成/更新できない。
  3. 非管理者所有の既存 `admin` scope token は admin API で拒否される。
  4. `read` token はフォーム mutation を実行できず、`write` token は許可される。
- **依存:** R4-C1, R4-C2, R4-C3
- **検証:** `pnpm --filter @nexus-form/api test` が通過すること。

### R4-T2. 公開フォーム保護・外部サービス・Worker retry 回帰テスト
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: 保護フォーム/外部サービス/Worker retry/built-in plugin 回帰テストあり）
- **対象:** `apps/api/src/__tests__/`, `apps/worker/src/**/__tests__/`, `apps/web/src/**/__tests__/`
- **修正内容:** R4-H1〜H6 の修正後、以下をテスト化する。
  1. パスワード未検証の公開 GET は `structure` / `plateContent` を返さない。
  2. 公開フォーム画面は保護フォームで `PasswordProtectionGate` を表示し、検証後に本体を表示する。
  3. EDITOR が所有者 OAuth を使った外部サービス情報を取得できない。
  4. provider の一過性障害と `retryAfter` が期待通り retry/FAILED 確定される。
  5. built-in plugin 読み込み失敗で startup が reject する。
- **依存:** R4-H1〜R4-H6
- **検証:** 関連 package の vitest が通過すること。

## ラウンド4 推奨スプリント

```
最優先（単独/並行着手可）
  R4-C1, R4-C2, R4-C3 ──→ R4-T1

次点（ユーザー影響・情報漏えい）
  R4-H1, R4-H2, R4-H3 ──→ R4-T2

Worker / plugin 信頼性
  R4-H4, R4-H5, R4-H6, R4-H7 ──→ R4-T2

Frontend UX / a11y
  R4-H8, R4-M1, R4-M2
```

---

# nexus-form コードベースレビュー 対応タスク（ラウンド5）

レビュー日: 2026-05-20 / 対象: 全ワークスペース（apps/api, apps/web, apps/worker, packages/database, packages/shared, packages/integrations, validation providers, k8s manifests）
レビュー手法: サブエージェント 5 領域分担レビュー（API セキュリティ / Web / Worker・Integrations / DB・Infra / 横断品質）。

**注記:** ラウンド4と重複する項目は、ラウンド5側を最新の重要度・修正範囲として扱う。特に `R4-C3`, `R4-H1`, `R4-H3`, `R4-H6`, `R4-H7` は下記 R5 タスクで再評価済み。

各タスクは `ID / 重要度 / 対象ファイル / 問題 / 修正内容 / 依存 / 検証` で構成。
重要度: 🔴 Critical → 🟠 High → 🟡 Medium → 🟢 Low。

## Phase 0: 緊急 hotfix（Critical）

### R5-C1. `read` scope の API トークンでフォーム mutation が実行できる
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（既存実装で確認済み: read token mutation 403 / write token 通過テストあり）
- **対象:** `apps/api/src/lib/dual-auth.ts:506`, `apps/api/src/routes/forms-detail.ts:100`, `apps/api/src/routes/forms-responses.ts`
- **問題:** API トークン経路では `form_ids` とフォーム role は確認しているが、`context.scopes` を mutation の種類に応じて強制していない。`withDualFormAuth("EDITOR")` や `withDualFormAuth("OWNER")` を使う更新系ルートで、`read` token がフォーム更新・回答更新・公開設定変更などを実行できる。
- **修正内容:**
  1. `withDualFormAuth` に role と HTTP method から必要 scope を導出するデフォルトを追加し、`EDITOR` mutation は `write` または `admin`、`OWNER`/管理 mutation は `admin` または明示的な強 scope を必須にする。
  2. read-only ルートは `VIEWER` または `requiredScopes: ["read"]` を明示する。
  3. 既存 `R4-C3` の修正範囲をこのタスクに統合する。
- **依存:** `R4-C2`（admin scope token 自己発行対策）と同じ API token 認可領域。
- **検証:** `read` token で PUT/POST/PATCH/DELETE 系フォームルートが 403 になり、`write` token だけが編集 mutation を通過する回帰テストを追加する。

### R5-C2. パスワード保護フォームの本文が未認証 GET で露出する
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（既存実装で確認済み: 未検証 GET は本文 null、Web gate 表示/検証後描画テストあり）
- **対象:** `apps/api/src/routes/forms-public.ts:231`, `apps/web/src/components/forms/public-form-page.tsx:206`
- **問題:** 公開フォーム GET は `isPasswordProtected` と hint を返す一方で、未検証のまま `structure` / `plateContent` も返す。Web も `PasswordProtectionGate` を挟まず `FormBody` を描画するため、送信時パスワードだけでは設問本文や条件ロジックを保護できない。
- **修正内容:**
  1. パスワード保護が有効で検証済みセッションが無い場合、API はメタ情報・hint・`passwordRequired` のみ返し、本文構造は返さない。
  2. Web は `PasswordProtectionGate` を接続し、検証後に本文を再取得して描画する。
  3. 既存 `R4-H1` は Critical に格上げし、このタスクへ統合する。
- **依存:** `R4-C1`（公開ルート到達性）。
- **検証:** 未検証状態で API レスポンスにも DOM にも設問本文が存在しないこと。検証後は通常通り表示・送信できること。

### R5-C3. k8s の validation worker Deployment が存在しない entrypoint を起動する
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（既存実装で確認済み: worker manifest は `src/index.ts` 起動、entrypoint 存在テストあり）
- **対象:** `k8s/base/bullmq-validation-discord-deployment.yaml:28`, `k8s/base/bullmq-validation-github-deployment.yaml`, `k8s/base/bullmq-validation-twitter-deployment.yaml`, `k8s/base/bullmq-validation-sheets-deployment.yaml`, `apps/worker/src/index.ts`
- **問題:** k8s manifest は `src/worker-*.ts` を args に指定しているが、実際の worker source は `apps/worker/src/index.ts` がエントリーポイント。Deployment 起動時にファイル不在で即終了し、検証・Sheets 同期キューが処理されない。
- **修正内容:** manifest の args を実在する `src/index.ts` 起動に合わせる。プロバイダー別 worker を分ける設計なら、実在する専用 entrypoint を追加し、package scripts と Dockerfile も整合させる。
- **依存:** なし（インフラ hotfix）。
- **検証:** `kubectl apply --dry-run=server` または manifest レンダリングで entrypoint が存在することを確認し、Pod が CrashLoopBackOff にならず worker 起動ログを出すこと。

### R5-C4. k8s Secret に `GOOGLE_OAUTH_ENC_KEY` がなく API/Worker が起動失敗する
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（既存実装で確認済み: Secret 定義と API/Worker secretRef、k8s 回帰テストあり）
- **対象:** `apps/api/src/lib/crypto/field-encryption.ts:15`, `apps/api/src/index.ts:156`, `k8s/base/secret.yaml:8`, `k8s/base/api-deployment.yaml`, `k8s/base/worker-deployment.yaml`
- **問題:** `field-encryption` は `GOOGLE_OAUTH_ENC_KEY` を必須環境変数として扱い、API 起動時にも assert している。一方、k8s Secret には同キーがなく、API/Worker が OAuth token 暗号化設定不足で起動できない、または API と Worker で暗号鍵がずれる。
- **修正内容:** `GOOGLE_OAUTH_ENC_KEY` を Secret に追加し、API/Worker の両 Deployment に同じ値を注入する。鍵長・ローテーション手順も運用ドキュメントに明記する。
- **依存:** なし（インフラ hotfix）。
- **検証:** k8s 環境で API/Worker が起動し、Google OAuth token の暗号化・復号が API と Worker 間で一致すること。

## Phase 1: API / Security High

### R5-H1. S3 mutation エンドポイントが API トークン scope を強制していない
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: S3 scope 別許可/拒否と expiration clamp 回帰テストあり）
- **対象:** `apps/api/src/routes/s3.ts:238`, `apps/api/src/routes/s3.ts:273`, `apps/api/src/routes/s3.ts:371`, `apps/api/src/routes/s3.ts:416`, `apps/api/src/routes/s3.ts:483`, `apps/api/src/routes/s3.ts:524`
- **問題:** `presigned-url` の `type=upload`、upload/process/move/delete 系ルートが `withDualAuth()` のみで保護され、API token scope の read/write/admin 区別が無い。read token でオブジェクト作成・移動・削除が可能になりうる。
- **修正内容:** download/list/proxy は `read`、upload/process/move は `write`、delete は `admin` または専用 delete scope を要求する。`expiresIn` も短い上限に clamp する。
- **依存:** `R5-C1` の scope 方針。
- **検証:** scope 別に S3 mutation が許可/拒否される API 回帰テストを追加する。

### R5-H2. 公開 submit / 回答 JSON のサイズ・個数上限が不足している
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: body limit・shared schema 上限・DB JSON サイズ上限テストあり）
- **対象:** `apps/api/src/routes/forms-public.ts:62`, `apps/api/src/routes/forms-public.ts:75`, `packages/shared/src/response-data.ts:67`
- **問題:** `responses`、`fingerprints`、文字列回答、選択肢配列、map のキー数に `.max()` がなく、少数の巨大 JSON で Zod 検証・DB 保存・Worker 処理のメモリを圧迫できる。
- **修正内容:** Hono body limit と Zod 上限を追加する。上限はフォームの最大設問数、各 question type の最大入力長、fingerprint 数に合わせて shared schema と API schema の双方で定義する。既存 `R4-H3` の修正範囲をこのタスクに統合する。
- **依存:** なし。
- **検証:** 巨大 JSON、過大配列、長大文字列が 400 または 413 で拒否されること。

### R5-H3. 保存済み `formStructure` / `plateContent` の parse 失敗が公開処理で fail-open する
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: 公開 GET/submit/password verify fail-closed 回帰テストあり）
- **対象:** `apps/api/src/routes/forms-public.ts:130`, `apps/api/src/routes/forms-public.ts:538`, `apps/api/src/lib/forms/plate-question-builder.ts:27`, `apps/api/src/lib/forms/response-validator.ts:285`
- **問題:** active snapshot や `plateContent` の JSON parse/schema 検証に失敗すると `null` または空配列になり、パスワード保護・回答制限・fingerprint 設定・質問 ID/type 検証が実質無効化される。`verify-password` も invalid structure 時に成功扱いになる経路がある。
- **修正内容:** 公開中フォームの active structure / plateContent が壊れている場合は fail-closed にし、GET/submit/verify-password を 500 または設定エラーで拒否する。管理者向けには修復可能なエラーを返す。
- **依存:** `R5-C2`（公開フォーム保護）。
- **検証:** 壊れた JSON の active snapshot では公開 submit と password verify が成功しないこと。設問配列が空にフォールバックして任意回答を通さないこと。

## Phase 2: Worker / Integrations High

### R5-H4. validation job の最終失敗・キャンセル状態が `PROCESSING` に戻りうる
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: 最終 attempt FAILED 確定、キャンセル上書き防止、queue discard/remove テストあり）
- **対象:** `apps/worker/src/handlers/generic-validation.ts:132`, `apps/worker/src/index.ts:88`, `apps/api/src/lib/queues.ts:8`, `apps/api/src/routes/forms-responses.ts:1052`, `apps/worker/src/lib/validation-helpers.ts:188`
- **問題:** retryable error は BullMQ retry に任せて throw するが、最終 failed handler はログのみで DB row を FAILED に確定しないため `PROCESSING` が残る。キャンセル API は DB を FAILED/CANCELLED にするだけで BullMQ job を除去せず、worker が後から `PROCESSING` に戻して結果を書き込む可能性がある。
- **修正内容:** 最終 attempt の failed handler で validation row を FAILED に確定する。キャンセル時は BullMQ job を remove/discard し、worker の状態更新は `WHERE status NOT IN ('CANCELLED_BY_USER', 'FAILED')` のように条件付きにする。
- **依存:** `R4-H4`, `R4-H5`（retry 方針）。
- **検証:** retry 上限到達で DB が FAILED になること。キャンセル済み job が後続 worker 実行で `PROCESSING` や成功結果に戻らないこと。

### R5-H5. plugin load 失敗が startup failure にならず provider 欠落状態で起動する
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: built-in/external plugin load failure の startup fail-fast テストあり）
- **対象:** `packages/integrations/src/startup.ts:269`
- **問題:** built-in provider の読み込み失敗や external loader の failed plugin がログだけで継続される。API/Worker が provider 欠落状態で起動し、ジョブが処理不能になる。`loader.hasFailedPlugins()` も startup の fatal 判定に使われていない。
- **修正内容:** built-in plugin は fail-fast にする。外部 plugin も本番では fail-fast をデフォルトにし、明示的な env opt-out がある場合のみ degraded 起動を許可する。既存 `R4-H6`, `R4-H7` の起動経路修正と同時に行う。
- **依存:** plugin drift guard の設計方針。
- **検証:** 壊れた built-in plugin や failed external plugin がある場合、期待設定に応じて startup が reject すること。

### R5-H6. Google Sheets sync が送信時 snapshot ではなく現在の draft `plateContent` を使う
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: Sheets job に snapshotVersion、worker は送信時 snapshot plateContent を使用するテストあり）
- **対象:** `apps/api/src/routes/forms-public.ts:293`, `apps/api/src/routes/forms-public.ts:831`, `packages/shared/src/worker-jobs.ts:16`, `apps/worker/src/handlers/sheets-sync.ts:137`, `apps/api/src/routes/forms-public.ts:488`
- **問題:** 公開 submit は active snapshot で回答検証するが、Sheets job payload は `formId/integrationId/responseId` のみで、worker は処理時点の current draft `form.plateContent` を読む。送信後にフォームを編集すると、列順・設問ラベル・型が送信時点とずれて Sheets に書き込まれる。さらに `queueSheetsSyncIfNeeded(...).catch(() => {})` が enqueue 失敗を握り潰す。
- **修正内容:** job payload に snapshot id/version または送信時の question metadata を含める。worker は matching active snapshot を読む。Sheets enqueue 失敗はログ/監視へ送る。
- **依存:** shared worker job schema 変更。
- **検証:** submit 後にフォーム draft を変更しても Sheets 行が送信時設問で出力されること。enqueue 失敗が観測可能なログ/メトリクスに残ること。

## Phase 3: Web / UX High

### R5-H7. Web の回答データ契約と SSE 復旧ロジックが壊れている
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: grid schema/required row/SSE backoff・visibility 復帰テストあり）
- **対象:** `apps/web/src/components/ui/form-question-nodes/form-choice-grid-node.tsx:62`, `packages/shared/src/response-data.ts:73`, `apps/web/src/lib/forms/find-unanswered-required.ts:55`, `apps/web/src/hooks/forms/use-editor-sse.ts:55`, `apps/web/src/hooks/forms/use-validation-sse.ts:24`
- **問題:** `choice_grid` は `Record<string, string>` を送るが shared schema は `Record<string, string[]>` のみ許可しており、送信時に契約不一致になる。required grid の frontend 判定は `responses` key の存在だけで row-level 必須を見ない。SSE hook は 3 回エラー後 `stoppedAfterErrors` で停止し、手動復旧や backoff reset が無いためリアルタイム更新が永続停止する。
- **修正内容:** question type ごとの discriminated union に回答 schema を分け、grid の単一/複数選択契約を API/Web/shared で揃える。required 判定は `validateQuestion` 相当の row-level validation を使う。SSE は指数 backoff、手動再接続、visibility 復帰時 reset を実装する。
- **依存:** shared response schema 変更。
- **検証:** grid 回答が送信 schema を通過し、未回答 row が frontend/server 双方で拒否されること。SSE は一時障害後に復旧できること。

## Phase 4: Infra / Config High

### R5-H8. k8s Web runtime env が Vite と不整合で、招待コードが ConfigMap に露出している
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了
- **対象:** `Dockerfile.web:27-30`, `apps/web/docker-entrypoint.sh:18-28`, `k8s/base/web-deployment.yaml:21`, `k8s/base/configmap.yaml:18`, `k8s/base/configmap.yaml:34`, `apps/web/src/lib/api.ts:4`, `apps/web/src/components/forms/hcaptcha-widget.tsx:45`, `apps/api/src/routes/auth.ts:110`
- **問題:** Web Deployment には `envFrom` がなく、ConfigMap も `NEXT_PUBLIC_*` を定義しているが、Vite Web は `VITE_API_URL` と `VITE_HCAPTCHA_SITE_KEY` を読む。`Dockerfile.web` は Vite 用の build-time env を渡さず、`docker-entrypoint.sh` も `window.__BRAND_CONFIG__` しか生成しない。k8s 本番で API URL/hCaptcha site key が入らず、ブラウザが `http://localhost:3001` に向かう可能性がある。さらに `SIGNUP_INVITATION_CODE` が ConfigMap にあり、Secret として扱われていない。
- **修正内容:** Web の runtime config 注入方式を決める（build-time env、`env-config.js`、または Vite 用 ConfigMap）。`VITE_*` 名に統一し、Deployment へ注入する。`VITE_API_URL` / `VITE_HCAPTCHA_SITE_KEY` が本番 artifact に確実に反映されるよう `Dockerfile.web` と entrypoint のどちらかを責務として明確化する。`SIGNUP_INVITATION_CODE` は Secret に移し、ローテーション手順を定義する。
- **依存:** デプロイ方式の決定。
- **検証:** k8s 環境で Web が正しい API URL/hCaptcha key を読み、招待コードが ConfigMap に現れないこと。

## Phase 5: ラウンド5 回帰テスト

### R5-T1. 追加レビュー Critical / High の回帰テスト
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存実装で確認済み: R5 Critical/High の API/Web/Worker/k8s 回帰テストあり）
- **対象:** `apps/api/src/__tests__/`, `apps/worker/src/**/__tests__/`, `apps/web/src/**/__tests__/`, `k8s/base`
- **修正内容:** R5-C1〜C4 と R5-H1〜H8 の修正後、API scope、公開フォーム保護、壊れた JSON の fail-closed、validation job 最終状態、Sheets snapshot、grid 回答 schema、SSE 復旧、k8s manifest/env をそれぞれテストまたは dry-run で固定する。
- **依存:** R5-C1〜C4, R5-H1〜H8。
- **検証:** `rtk pnpm type-check`, `rtk pnpm test --silent` に加え、k8s manifest の dry-run またはレンダー検証が通過すること。

## ラウンド5 推奨スプリント

```
最優先（セキュリティ / 起動不能）
  R5-C1, R5-C2, R5-C3, R5-C4 ──→ R5-T1

API hardening
  R5-H1, R5-H2, R5-H3 ──→ R5-T1

Worker / integrations correctness
  R5-H4, R5-H5, R5-H6 ──→ R5-T1

Web / infra consistency
  R5-H7, R5-H8 ──→ R5-T1
```

---

# nexus-form コードベースレビュー 対応タスク（ラウンド6）

レビュー日: 2026-05-20 / 対象: 全ワークスペース（apps/api, apps/web, apps/worker, packages/database, packages/shared, packages/integrations, validation providers）
レビュー手法: サブエージェント 5 領域分担セルフレビュー（セキュリティ / アーキテクチャ・コード品質 / 型安全性 / テスト / パフォーマンス・信頼性）。

**注記:** 今回のレビューでは Critical 級の脆弱性は検出されなかった（R6 に Phase 0 hotfix は無い）。一方で、ラウンド5 まで未指摘の **アプリ間コード重複** と **API 側のライフサイクル/パフォーマンス課題** が複数領域で横断的に検出された。既存タスクと重複する項目は本文に明記している（重複指摘であり退行ではない）。

各タスクは `ID / 重要度 / 対象ファイル / 問題 / 修正内容 / 依存 / 検証` で構成。
重要度: 🔴 Critical → 🟠 High → 🟡 Medium → 🟢 Low。

## Phase 1: 横断的重複・ライフサイクル High

### R6-H1. `form-block.ts` が api/web で完全重複しフォーム中核データ契約が二重管理
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #162 merged、gh-review-hook exit 0）
- **対象:** `apps/api/src/types/domain/form-block.ts`（556 行）, `apps/web/src/types/domain/form-block.ts`（574 行）
- **問題:** `BlockType` enum・各種 `*ValidationConfig`・ブロック判別ユニオンなど 90+ エクスポートを含む zod スキーマ/型ファイルが api/web でほぼ同一に複製されている。意味のある差分は無い（空行・並び順のみ）。片方だけ変更すると API/フロントの型がサイレントに乖離する。CLAUDE.md の「Shared schemas go in `packages/shared`」「API レスポンス型はフロントで `@nexus-form/shared` から再利用」に違反。
- **修正内容:** `packages/shared/src/forms/form-block.ts`（仮）へ統合し、api/web は re-export または直接 import に切り替える。zod スキーマ本体のため shared 配置が規約どおり。
- **依存:** なし。R6-M1 と同じ form-block 領域。
- **検証:** 重複ファイルが解消され、`pnpm type-check` が api/web 双方で通過すること。

### R6-H2. `field-encryption.ts` が api/worker で重複（暗号ロジックの二重管理）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #164 merged、gh-review-hook exit 0）
- **対象:** `apps/api/src/lib/crypto/field-encryption.ts`（73 行）, `apps/worker/src/lib/field-encryption.ts`（64 行）
- **問題:** AES-256-GCM の `encryptToBase64` / `decryptFromBase64` / `getRawKey` / `assertGoogleOAuthEncryptionKeyConfigured` が同一実装で複製（API 版のみ `constantTimeEqual` を追加保持）。暗号化はセキュリティクリティカルで、片方だけ修正すると API↔Worker 間の OAuth トークン復号が壊れる。
- **修正内容:** `packages/shared`（または専用 `packages/crypto`）へ単一実装を抽出し、`constantTimeEqual` も合わせて移設。両アプリは共有実装を import する。
- **依存:** `R5-C4`（k8s の `GOOGLE_OAUTH_ENC_KEY` 注入）と同じ暗号鍵領域。統合後も両プロセスで同一鍵を使うこと。
- **検証:** 重複解消後、API で暗号化したトークンを Worker が復号できる回帰テストを追加すること。

### R6-H3. API サーバーにグレースフルシャットダウンが無い
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #165 merged、gh-review-hook exit 0）
- **対象:** `apps/api/src/index.ts:191-202`, `packages/database/src/index.ts:11`
- **問題:** Worker は `createGracefulShutdown` で in-flight ジョブのドレイン・Redis・Sentry クローズを完備するが、API は SIGTERM 時に `serviceMonitor.stopPeriodicCheck()` を呼ぶのみ。処理中 HTTP リクエストのドレイン、MySQL コネクションプールのクローズ、SSE subscriber 切断、Redis publisher クローズが行われず、デプロイ/スケールイン時にリクエスト強制切断とコネクションリークが発生する。
- **修正内容:** `serve()` の戻り値 `server` を保持し、SIGTERM/SIGINT で `server.close()` → grace 期間待機 → `pool.end()`・Redis クライアントの `quit()` を順に実行するハンドラを追加する。
- **依存:** なし。R3-M9（Worker 側 Redis/queue リーク）と同じライフサイクル領域。
- **検証:** SIGTERM 送信時に in-flight リクエストが完了してから終了し、DB/Redis 接続がクローズされること。

### R6-H4. GitHub Octokit クライアントにタイムアウト未設定でジョブがハングしうる
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #166 merged、gh-review-hook exit 0）
- **対象:** `packages/validation-provider-github/src/client.ts:41-51`
- **問題:** Twitter（axios `timeout`）・Discord・Google Sheets（`AbortSignal.timeout`）はタイムアウト済みだが、GitHub `Octokit` は `request.timeout` 未指定。GitHub API 無応答時にバリデーションジョブが無期限ブロックし、有限の Worker 並行枠（`DEFAULT_WORKER_CONCURRENCY = 5`）を占有して `github-validation` キュー全体が停止しうる。
- **修正内容:** `new Octokit({ request: { timeout: 15_000 }, ... })` を設定する。`GITHUB_API_TIMEOUT_MS` 等の env で他プロバイダーと統一する。
- **依存:** `R3-H8`（Discord fetch タイムアウト）と同じタイムアウト方針。
- **検証:** GitHub API 無応答をモックし、ジョブが上限時間で失敗・リトライに乗ること。

### R6-H5. レスポンスのキーワード検索が非 sargable な全表スキャンになっている
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #167 merged、gh-review-hook exit 0）
- **対象:** `apps/api/src/routes/forms-responses.ts:369-371`
- **問題:** `instr(lower(${formResponse.id}), lower(${keyword})) > 0` を OR で 3 カラムに適用しており、関数適用でインデックスが効かない。`FormResponse` は回答数に比例して肥大化するため、検索のたびにフォーム配下の全行を走査する。
- **修正内容:** 前方一致で足りるなら `like 'keyword%'` でインデックスを活用する。部分一致が必須なら MySQL `FULLTEXT` インデックスの導入を検討する。
- **依存:** なし。
- **検証:** 大量回答フォームで検索クエリが全表スキャンにならないこと（`EXPLAIN` で確認）。

### R6-H6. SSE 接続ごとに新規 Redis subscriber を生成し接続が爆発する
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #168 merged、gh-review-hook exit 0）
- **対象:** `apps/api/src/routes/forms-sse.ts:34-49, 60-66`
- **問題:** `createSSEStream` が接続のたびに `createSubscriber()` で新規 `ioredis` インスタンスを生成。`MAX_SSE_CONNECTIONS=200` 上限まで張られると Redis subscriber 接続が最大 200 本に達し、Redis の `maxclients` を圧迫する。
- **修正内容:** チャンネル別に subscriber を共有し、プロセス内 `EventEmitter` でファンアウトする設計に変更する。最低でも同一チャンネルへの複数接続で subscriber を使い回す。
- **依存:** R6-M10（SSE 接続上限のプロセスローカル問題）と同じ SSE 領域。
- **検証:** 同一フォームへの複数 SSE 接続で Redis subscriber が 1 本に集約されること。

## Phase 2: Medium

### R6-M1. 質問タイプ定義が 3 箇所に分散し手動同期が必要
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（既存実装で確認済み: shared `BLOCK_TYPES` から Plate 型/変換/API-Web 型を派生）
- **対象:** `packages/shared/src/plate-content-utils.ts:8`（`FORM_QUESTION_TYPES`、`form_` プレフィックス）, `apps/api/src/types/domain/form-block.ts:5`（`BlockType`）, `apps/web/src/types/domain/form-block.ts:9`
- **問題:** 12 種類の質問タイプが命名規則の異なる 2 系列（`form_short_text` vs `short_text`）で独立定義され、`block-type-converter.ts` で変換している。新タイプ追加時に 3 箇所＋変換器の更新漏れリスクが高い。
- **修正内容:** shared に単一の正準リスト（例: `BLOCK_TYPES`）を置き、Plate ノード型はそこから機械的に派生（`` `form_${t}` ``）させる。
- **依存:** R6-H1（form-block の shared 統合）。
- **検証:** 質問タイプの定義元が 1 箇所になり、変換器がそこから導出されること。

### R6-M2. `handleApiError` / `handleDatabaseError` がデッドコードでエラー契約が 2 系統並存
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（既存実装で確認済み: `error-handlers.ts` と未使用参照なし）
- **対象:** `apps/api/src/lib/forms/error-handlers.ts`
- **問題:** `ApiErrorResponse`（`{message, code, statusCode, details}`）を返す共通ハンドラが定義されているが、`routes/` のどこからも import されていない。実際のルートは `types/domain/common.ts` の `errorResponse()`（`{error: string}`）を使用。2 系統のエラー契約が並存し、未使用コードが「正しいパターン」と誤認される恐れ。
- **修正内容:** `error-handlers.ts` を削除するか、`onError` ハンドラへ実際に組み込む。公式エラー形は `{ error: string }`（`ErrorResponseSchema`）に統一する。
- **依存:** なし。`R3-L3`（デッドコード除去）と同領域。
- **検証:** 未使用エクスポートが解消され、エラーレスポンス形が単一であること。

### R6-M3. `forms-responses.ts` / `forms-structure.ts` が肥大化し関心が混在
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #171 merged、gh-review-hook exit 0）
- **対象:** `apps/api/src/routes/forms-responses.ts`（1064 行/13+ ルート）, `apps/api/src/routes/forms-structure.ts`（909 行/17 ルート）
- **問題:** `forms-structure.ts` は structure に加え snapshots・schedules を内包（別途 `forms-snapshots.ts` も存在し所在が不明瞭）。`forms-responses.ts` は CRUD・集計・分析・エクスポートが集中。CLAUDE.md の「肥大化したら分割」の精神に反し、可読性・テスト容易性が低い。
- **修正内容:** schedule 系を `forms-schedule.ts` へ、snapshot 系を既存 `forms-snapshots.ts` へ移動。`forms-responses.ts` は集計・分析系を `forms-response-analytics.ts` 等へ分割する。
- **依存:** なし。`R3-M17`（巨大コンポーネント分割）と同方針。
- **検証:** 各ルートファイルが単一の関心に収まり、`AppType` 型伝播が維持されること。

### R6-M4. Google Sheets クライアントのレスポンス検証が一貫していない
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #172 merged、gh-review-hook exit 0）
- **対象:** `apps/api/src/lib/google/google-sheets-client.ts:176`（`updateRange`）, `:223`（`getSpreadsheetMetadata`）, `:293, :361`（`batchUpdate` 系）
- **問題:** `appendRows` / `readRange` は対応スキーマで `safeParse` 検証する一方、`updateRange` / `getSpreadsheetMetadata` / `batchUpdate` 系は `sheets-drive.types.ts` にスキーマがあるにもかかわらず `as unknown as` でキャストするだけ。外部 API が想定外形状でも実行時に検知されず、後続で予期せぬ `undefined` を生む。CLAUDE.md の「全 API レスポンスを zod 検証」に違反。
- **修正内容:** `appendRows` / `readRange` と同じく対応スキーマ（必要なら `BatchUpdateResponseSchema` 等を追加）で `safeParse` し、失敗時は `Result` のエラーを返す。
- **依存:** なし。
- **検証:** 全 Sheets API 呼び出しがレスポンスを zod 検証すること。

### R6-M5. 状態変更エンドポイントに CSRF 多層防御が無い
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #173、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/index.ts:59-67`, `apps/api/src/routes/csrf.ts:15-22`, `apps/api/src/lib/auth.ts:80-84`
- **問題:** `csrf.ts` は `"better-auth-managed"` を返すプレースホルダで、better-auth の CSRF 保護は `/api/auth/*` のみ。`/api/forms/*`・`/api/s3/*`・`/api/integrations/google/*` 等のセッション Cookie 認証 POST/PUT/DELETE は CORS 許可リストと `SameSite=Lax` のみに依存する。`auth.ts` の `advanced` は `defaultCookieAttributes` を明示せず better-auth デフォルト依存。
- **修正内容:** `auth.ts` で `advanced.defaultCookieAttributes` に `sameSite: "strict"` を明示。さらに状態変更系ルートに Origin/Referer 検証ミドルウェア（`TRUSTED_ORIGINS` 照合）を追加し多層防御とする。
- **依存:** なし。
- **検証:** 信頼外 Origin からの状態変更リクエストが拒否されること。

### R6-M6. 公開 GET エンドポイントにレート制限が無い
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #174、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-public.ts:181`（`GET /public/:publicId`）, `:592`（`GET /shared/:token`）
- **問題:** `POST /submit`（10req/min）と `verify-password`（10req/15min）にはレート制限があるが、`GET /public/:publicId` と `GET /shared/:token` には無い。特に `/shared/:token` は共有リンクトークンの総当たり列挙が可能。
- **修正内容:** 両 GET に `createRateLimit`（例: 60req/min/IP）を適用。共有リンクトークンが暗号学的に安全な乱数（128bit 以上）であることを `share-link-token.ts` で別途確認する。
- **依存:** `R3-H21`（信頼できないヘッダーからの IP 採用）と同じレート制限領域。
- **検証:** 公開 GET が過剰アクセス時にレート制限されること。

### R6-M7. ページネーション系エンドポイントが毎回 `count()` の全表集計を実行
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #175、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-responses.ts:401, 494, 529, 564`
- **問題:** 一覧・ID 一覧・aggregate・analytics の各エンドポイントがページ取得のたびに `count()` / `count(distinct ...)` を実行。`FormResponse` が大きいフォームではページ読み込みごとに全表集計が走る。`countDistinct(respondentUuid)` は特に重い。
- **修正内容:** 件数を Redis にキャッシュ（または近似値）する、または無限スクロール UI に切り替えて `count()` を省く。
- **依存:** なし。
- **検証:** ページ送りのたびに全表集計が走らないこと。

### R6-M8. `processFormSchedule` が公開フォームの全 GET/POST で同期実行される
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #176、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-public.ts:191, 279`, `apps/api/src/lib/forms/schedule-processor.ts:36-63`
- **問題:** 公開フォーム表示・送信のたびに `form` 取得 + `FormSchedule` クエリ（2 クエリ）が同期実行される。スケジュール未設定フォームでも毎回コストがかかり、高トラフィック時にレイテンシが上乗せされる。
- **修正内容:** スケジュール処理を専用 cron/worker ジョブへ移しリクエストパスから外す。少なくとも `form` 取得と統合し未処理スケジュール有無を 1 クエリで判定する。
- **依存:** `R3-H4`（schedule エラー握り潰し）と同じ schedule 領域。
- **検証:** 公開フォームリクエストのレイテンシからスケジュールクエリのコストが除かれること。

### R6-M9. バルクリトライが per-row の逐次 DB UPDATE になっている
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #177、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-responses.ts:175-345`（`enqueueValidationRetries`）
- **問題:** 最大 100 件のリトライ対象に対し `db.update(...).where(eq(id, ...))` をループ内で 1 件ずつ実行し、最大 100 往復の DB ラウンドトリップが直列で発生する。
- **修正内容:** enqueue 成功行をまとめ `inArray(id, [...])` で一括 UPDATE する。jobId が行ごとに異なるため `CASE WHEN` 一括更新、またはステータス一括更新 + jobId バッチ化を検討する。
- **依存:** なし。
- **検証:** バルクリトライの DB ラウンドトリップが対象件数に比例しないこと。

### R6-M10. `MAX_SSE_CONNECTIONS` がプロセスローカルでマルチレプリカ時に意図と乖離
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #178、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-sse.ts:22-26, 56`
- **問題:** `activeConnections` はプロセスローカル変数。複数レプリカ構成では「200 接続上限」がレプリカごとに独立し、クラスタ全体では `200 × レプリカ数` まで許容してしまう。また単一ユーザーが 200 接続を占有し他ユーザーの SSE を枯渇させる DoS も可能。
- **修正内容:** グローバル上限が意図なら Redis でカウントを共有する。加えてユーザー単位/フォーム単位の接続上限を追加する。プロセス保護目的なら現状で可だが、その旨をコメント・運用ドキュメントに明記する。
- **依存:** R6-H6（SSE subscriber 共有化）と同領域。
- **検証:** ユーザー単位の SSE 接続上限が機能し、単一ユーザーが全枠を占有できないこと。

### R6-M11. プラグインブートストラップ定数・redis-publisher ボイラープレートの重複
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #179、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/index.ts:47-54` と `apps/worker/src/index.ts:22-29`（`BUILTIN_PLUGIN_SPECIFIERS`・`VALIDATION_PLUGINS_DIR` デフォルト）, `apps/api/src/lib/redis-publisher.ts` と `apps/worker/src/lib/redis-publisher.ts`
- **問題:** プラグイン定数（`/app/plugins/validation` 等）が両プロセスにハードコピーされ、CLAUDE.md の「API/Worker は同じプラグインディレクトリ（ドリフト禁止）」に反する。`getPublisher()` のシングルトン管理・error ハンドラ登録・接続生成という骨格も重複。
- **修正内容:** `packages/integrations` に `BUILTIN_PLUGIN_SPECIFIERS` / `defaultPluginsDir()` をエクスポートし両 `index.ts` から参照。shared に `createRedisPublisher(channelResolver)` ファクトリを置き各アプリは薄いラッパのみ保持する。
- **依存:** `R3-H9`（プラグインドリフトガード）と同領域。
- **検証:** プラグイン定数の定義元が 1 箇所になること。

### R6-M12. 回答バリデーションルールが api/web で別実装され乖離リスクがある
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #180、`gh-review-hook` exit 0）
- **対象:** `apps/web/src/utils/validation/question-validators.ts`（1121 行）, `apps/api/src/lib/forms/response-validator.ts`（516 行）
- **問題:** フロントはタイプ別の詳細バリデータ（min/max length・pattern・required）、API は `validateResponseData` で別実装。クライアント/サーバ二重検証自体は正当だが、ルール（required 判定・文字数制限・pattern）が別コードで重複し乖離する。
- **修正内容:** 純粋なルール評価関数を `packages/shared` に抽出し両側がそれを呼ぶ「単一ルールエンジン」化を検討する。少なくとも検証ルール定数（長さ上限等）は shared 化する。
- **依存:** R6-H1（form-block の shared 統合）。
- **検証:** 検証ルールの定義元が 1 箇所になること。

## Phase 3: Low

### R6-L1. `parseSnapshotBlocks` が zod 検証なしのダブルキャストのデッドコード
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（PR #181、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/types/domain/form-block.ts:553-556`
- **問題:** `JSON.parse` の結果を `as unknown as Block[]` でダブルキャストし zod 検証していない（CLAUDE.md 違反）。現状どこからも呼ばれないデッドコードのため実害は無いが、将来利用されると型と実体が乖離する。
- **修正内容:** 削除する。利用するなら `Block` の zod スキーマで `safeParse` し、`parseStoredStructure` 等と同じパターンに揃える。
- **依存:** なし。
- **検証:** 未使用なら削除済み、利用するなら zod 検証経由であること。

### R6-L2. 安全でない `as` キャストの残存（block-factory / response-analytics / brand-config）
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（PR #182、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/lib/forms/block-factory.ts:174-253, 281-330`, `apps/api/src/lib/forms/response-analytics.ts:636-720`, `apps/web/src/lib/brand-config.ts:9`
- **問題:** `block-factory` の `switch` で `validation as *ValidationConfig` + `as Block` の連鎖キャスト（約 35 箇所）、`response-analytics` の `(data as { options?: unknown })` 型ガード、`brand-config` の `window.__BRAND_CONFIG__` 無検証キャストが残存。CLAUDE.md は `as` の抑制を要求。
- **修正内容:** `block-factory` は case ごとに型を確定するヘルパーで判別ユニオンを安全に組み立てる。`response-analytics` は型述語関数または `z.object(...).safeParse` に置換。`brand-config` は注入設定を zod スキーマで `safeParse` する。
- **依存:** なし。`R3-M2`（`as` 多用）と同方針。
- **検証:** 該当箇所の不要な `as` が型安全パターンに置換されること。

### R6-L3. キューのデフォルトジョブオプションに保持件数指定が無い
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（PR #183、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/lib/queues.ts:8-22`
- **問題:** `VALIDATION_JOB_DEFAULTS` / `SHEETS_JOB_DEFAULTS` に `removeOnComplete` / `removeOnFail` 指定が無い。現状の `queue.add` 呼び出しは個別に `100/100` を指定しているため実害は無いが、将来オプション無しの `queue.add` が追加されると Redis に完了/失敗ジョブが無制限蓄積する。
- **修正内容:** `defaultJobOptions` に `removeOnComplete: 100, removeOnFail: 100` を集約し、呼び出し側の重複指定を削除する。
- **依存:** なし。
- **検証:** デフォルトでジョブ保持件数が制限されること。

### R6-L4. `getValidationContext` の逐次クエリ
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（PR #184、`gh-review-hook` exit 0）
- **対象:** `apps/worker/src/lib/validation-helpers.ts:58-74`
- **問題:** `formResponse` 取得 → `formSnapshot` 取得を直列実行し、ジョブごとに 2 往復発生する。
- **修正内容:** responseId 既知のため `formResponse` と `formSnapshot` を `formId` で join する単一クエリにまとめる。
- **依存:** なし。
- **検証:** バリデーションジョブごとの DB 往復が削減されること。

### R6-L5. レート制限のインメモリフォールバックがプロセスローカル
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（PR #185、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/lib/rate-limit.ts:18, 44-66`
- **問題:** Redis 障害時フォールバックの `rateLimitStore`（Map）はプロセスローカル。複数レプリカ + Redis ダウン時にレート制限が実質レプリカ数倍に緩む（`cleanupTimer` は `unref()` 済みでリーク無し）。
- **修正内容:** fail-safe 設計として許容範囲だが、Redis 障害時に制限が緩むことを運用ドキュメントに明記する。
- **依存:** なし。
- **検証:** Redis 障害時の挙動が文書化されていること。

### R6-L6. `apps/web/src/hooks/forms/` のファイル名命名規則が不統一
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（PR #186、`gh-review-hook` exit 0）
- **対象:** `apps/web/src/hooks/forms/useOtherOption.ts`, `useCheckboxValidation.ts`, `useShortTextValidation.ts`
- **問題:** 大半が kebab-case（`use-form-logic.ts` 等）だが上記 3 ファイルのみ camelCase。Biome はファイル名規則を強制しないため手動修正が必要。
- **修正内容:** kebab-case に統一（`use-other-option.ts` 等）し、import 元を更新する。
- **依存:** なし。
- **検証:** hooks ディレクトリのファイル名が kebab-case に統一されること。

### R6-L7. anon/share-link トークンによる S3 アップロード名前空間の汚染
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（PR #187、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/s3.ts:274, 339`, `apps/api/src/lib/dual-auth.ts:124-125`
- **問題:** S3 ルートは `withDualAuth()`（セッション限定でない）を使うため、`anon:` / `share-link:` プレフィックスの合成 `user_id` を持つ API トークンでもアップロード可能。他ユーザーファイルへはアクセス不可（`isKeyOwnedBy` で防御済み）だが、匿名トークンが S3 ストレージを消費できる。
- **修正内容:** S3 書き込み系エンドポイントをセッション限定、または `write` スコープを持つユーザースコープトークンに限定し、匿名/共有リンクトークンを除外する。
- **依存:** `R5-H1`（S3 mutation の scope 強制）に統合可能。
- **検証:** 匿名/共有リンクトークンで S3 アップロードが拒否されること。

### R6-L8. CLAUDE.md のテスト記述がドリフト（実体のない `src/` / `vitest.config.mts` を参照）
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（PR #188、`gh-review-hook` exit 0）
- **対象:** `CLAUDE.md`（Testing Guidelines セクション）
- **問題:** CLAUDE.md は「ルートの `vitest.config.mts` はレガシーコード向け」「root-level `src/` に新機能を追加しない」と記述するが、実際には `vitest.config.mts` もルート `src/` も存在しない。記述が古い。
- **修正内容:** 該当記述を削除し、per-package `vitest.config.ts` のみという現状に合わせる。
- **依存:** なし。
- **検証:** CLAUDE.md が現行のディレクトリ構成と一致すること。

## Phase 4: ラウンド6 テスト

### R6-T1. テストカバレッジの空白を埋める
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #189、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/__tests__/`, `apps/api/src/routes/forms-sse.ts`, `apps/api/src/lib/forms/permission-service.ts`, `apps/api/src/lib/forms/merge.ts`, `apps/api/src/lib/queues.ts`
- **問題:** (1) SSE ルート（`forms-sse.ts`）はテストゼロ — 同時接続上限・keepalive・`onAbort` クリーンアップ・subscriber ライフサイクルが未検証。(2) `routes.test.ts` は「未認証→401」スモーク中心で、認証済みの正常系/異常系ルートテストがほぼ皆無。(3) `permission-service.ts`・`merge.ts`（巨大かつ権限・データ整合に関わる）に直接テストが無い。(4) `getValidationQueue` のキュー名生成が未テスト。(5) `__tests__/` 配下 6+ ファイルで `vi.mock("@nexus-form/database")` 等のモック定義がコピペされドリフトリスクがある。
- **修正内容:** SSE ルートのテスト追加、認証済みルート統合テストの拡充、`permission-service.ts` / `merge.ts` のユニットテスト追加、`getValidationQueue` のテスト追加、共有テストセットアップヘルパー（`test-setup.ts` 等）へのモック抽出を行う。
- **依存:** R6-H6, R6-M10（SSE）, R6-M3（ルート分割後にテスト追加）。
- **検証:** `rtk pnpm test --silent` が通過し、SSE・認証済みルート・permission-service・merge にテストが存在すること。

## ラウンド6 推奨スプリント

```
横断的重複の解消（型・暗号の乖離リスク）
  R6-H1, R6-H2 ──→ R6-M1, R6-M12

API ライフサイクル / パフォーマンス
  R6-H3, R6-H4, R6-H5, R6-H6 ──→ R6-M7, R6-M8, R6-M9, R6-M10

コード品質 / 規約整合
  R6-M2, R6-M3, R6-M4, R6-M11 ──→ R6-L1〜R6-L8

セキュリティ hardening
  R6-M5, R6-M6, R6-L7

テスト
  R6-T1（各 Phase の修正後に随時）
```

**R5 まで未着手のタスクとの関係:** R6 で再検出された課題の多くは R3〜R5 と領域が重なる（R3-H1 block-analytics メモリ、R3-H8 Discord タイムアウト、R3-H9 プラグインドリフト、R3-M2 `as` 多用、R3-M9 Worker リーク、R5-H1 S3 scope 等）。R6 は **アプリ間コード重複**（R6-H1, R6-H2, R6-M1, R6-M11, R6-M12）と **API 側ライフサイクル/全表スキャン**（R6-H3, R6-H5, R6-H6, R6-M7）を新規の主軸として追加するもの。既存タスク消化と合わせて優先度を判断すること。

---

# nexus-form コードベースレビュー 対応タスク（ラウンド7）

レビュー日: 2026-05-20 JST / 対象: 全ワークスペース（apps/api, apps/web, apps/worker, packages/shared, packages/database, packages/integrations, k8s manifests）
レビュー手法: サブエージェント 4 領域分担セルフレビュー（API / Web / Worker・Integrations / Data・Tooling）+ 親側の横断静的確認。

**注記:** 今回の Critical 再指摘は既存未着手タスクに統合する。`admin` scope token 自己発行は `R4-C2`、パスワード保護フォーム本文露出は `R5-C2`、k8s worker entrypoint 不整合は `R5-C3`、validation job の最終失敗・キャンセル上書きは `R5-H4`、Web runtime env 不整合は更新済み `R5-H8`、`choice_grid` 回答契約は `R5-H7`、Sheets snapshot drift は `R5-H6` をそれぞれ最新の修正先とする。ラウンド7では未反映だった具体的な差分だけを新規タスク化する。

各タスクは `ID / 重要度 / 対象ファイル / 問題 / 修正内容 / 依存 / 検証` で構成。
重要度: 🔴 Critical → 🟠 High → 🟡 Medium → 🟢 Low。

## Phase 1: 追加 High

### R7-H1. Google Sheets sync が保存済み回答配列を object map として処理する
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #190、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-public.ts:62`, `apps/api/src/routes/forms-public.ts:438`, `packages/shared/src/response-data.ts:67-76`, `apps/worker/src/lib/response-data-extractor.ts:164-188`, `apps/worker/src/handlers/sheets-sync.ts:390-401`
- **問題:** 公開 submit は `payload.responses`（`ResponseDataItem[]`）をそのまま `JSON.stringify` して `responseDataJson` に保存する。一方、Sheets worker は `safeParseResponseData` で配列も `Record<string, unknown>` として返し、`Object.entries(responseData)` を列に展開する。結果として Sheets の列名が `"0"`, `"1"` のような配列 index になり、値も回答オブジェクトの JSON 文字列として入る。
- **修正内容:** `responseDataJson` の正準形を決める。短期対策として Worker 側で `ResponseDataItem[]` を zod parse し、`question_id` を key にした map へ変換してから Sheets 行を作る。既存の object map 形式が残っている可能性があるなら、後方互換の分岐と移行方針を用意する。
- **依存:** `R5-H6`（送信時 snapshot metadata）と同じ Sheets 出力経路。snapshot metadata から question title を引けるよう同時修正が望ましい。
- **検証:** 複数設問の公開回答を送信し、Sheets には配列 index ではなく設問タイトル/ID の列と実際の回答値が出力されること。

### R7-H2. 汎用 S3 presigned URL endpoint が専用 upload validation を迂回する
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #191、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/s3.ts:24-29`, `apps/api/src/routes/s3.ts:261-267`, `apps/api/src/routes/s3.ts:272-292`, `apps/api/src/lib/s3/base-service.ts:126-132`
- **問題:** `/presigned-upload` は fileName/fileSize/mimeType 検証と rate limit を持つが、汎用 `presigned-url` は `type=upload` を受けると任意 `key` / `bucket` / `expiresIn` で PUT URL を発行する。prefix assertion はあるものの、専用 upload flow のサイズ・MIME・TTL・一時領域運用を迂回できる。
- **修正内容:** 汎用 `presigned-url` から upload 発行を削除し、download 専用にする。互換性が必要なら `type=upload` は `/presigned-upload` と同じ validation/rate limit/TTL clamp/認可 scope を必ず通す。`bucket` 指定もサーバ側で用途別に固定し、ユーザー入力として受けない。
- **依存:** `R5-H1`（S3 mutation scope 強制）と `R3-H22`（S3 key/bucket 検証）。
- **検証:** 汎用 endpoint で `type=upload` を指定しても拒否されるか、専用 upload と同一の validation を通ること。過大 `expiresIn` や prod bucket 直接 PUT が拒否されること。

### R7-H3. 招待コードサインインに rate limit が無い
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #192、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/index.ts:81`, `apps/api/src/index.ts:111`, `apps/api/src/routes/auth.ts:104-116`
- **問題:** `authRouteRateLimiter` は `/api/auth/*` のみに適用され、招待コードを検証する `/api/auth-ext/signin-with-invitation` は対象外。`constantTimeEqual` で比較時間差は抑えているが、試行回数制限が無いためオンライン総当たりに弱い。
- **修正内容:** `signin-with-invitation` に専用の `createRateLimit` を適用する。ユーザー体験を損なわない範囲で IP + 短時間 window の上限を低めに設定し、失敗ログ/監査イベントも残す。信頼できない `X-Forwarded-For` 問題が残る場合は `R3-H21` の修正と同時に行う。
- **依存:** `R3-H21`（信頼できないヘッダーからの IP 採用）。
- **検証:** 誤った招待コードを短時間に連続送信すると 429 になり、正しいコードの通常利用は通ること。

### R7-H4. validation job が送信時 snapshot を固定せず実行時 snapshot で block 存在確認する
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #193、`gh-review-hook` exit 0）
- **対象:** `packages/shared/src/worker-jobs.ts:3-10`, `apps/api/src/routes/forms-public.ts:636-771`, `apps/worker/src/lib/validation-helpers.ts:67-74`
- **問題:** submit 時の `queueExternalValidations` は active snapshot から validation pair を作るが、job payload には snapshot id/version や送信時 `plateContent` が入らない。Worker の `getValidationContext` は job 実行時点の active/latest snapshot を読み直すため、送信後にフォーム publish/draft 変更が入ると、送信時には存在した block が `MISSING` 扱いになる可能性がある。
- **修正内容:** job payload か `formResponse` に送信時 snapshot id/version を保存し、Worker はその snapshot だけを使って block 存在確認を行う。少なくとも submit 時に抽出した block id set を job data に含め、実行時 snapshot の再解釈に依存しない形にする。
- **依存:** `R5-H6`（Sheets sync の送信時 snapshot 固定）と同じ snapshot 契約変更。
- **検証:** 回答送信後、validation job 実行前にフォームを編集・再公開しても、送信時点の block に対する validation が `MISSING` にならないこと。

## Phase 2: 追加 Medium

### R7-M1. k8s Redis password 設定が API/Worker の `REDIS_URL` 優先ロジックと不整合
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #194、`gh-review-hook` exit 0）
- **対象:** `k8s/base/configmap.yaml:9`, `k8s/base/secret.yaml:41-42`, `apps/api/src/lib/redis.ts:85-90`, `apps/worker/src/lib/redis.ts:42-48`
- **問題:** k8s は `REDIS_URL=redis://redis-service:6379` を ConfigMap に置き、`REDIS_PASSWORD` を Secret に置く。しかし API/Worker の Redis 設定は `REDIS_URL` が存在すると URL 解析経路を優先するため、URL に password が含まれない限り `REDIS_PASSWORD` が接続設定へ反映されない。Redis に認証を有効化した環境では接続失敗し、無認証運用では Secret の存在が安全性を誤認させる。
- **修正内容:** 運用方針を統一する。認証ありなら Secret から password を含む `REDIS_URL` を生成するか、`REDIS_URL` に password が無い場合は `REDIS_PASSWORD` を補完する。認証なしなら Secret の `REDIS_PASSWORD` を削除し、Redis が無認証であることを明記する。
- **依存:** なし。
- **検証:** password 付き Redis に対し、API/Worker の両方が同じ設定で接続できること。password 無し URL + `REDIS_PASSWORD` の組み合わせが無視されないこと。

## Phase 3: ラウンド7 回帰テスト

### R7-T1. 追加レビュー差分の回帰テスト
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #195、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/__tests__/`, `apps/worker/src/**/__tests__/`, `apps/web/src/**/__tests__/`, `k8s/base`
- **修正内容:** R7-H1〜H4 と R7-M1 の修正後、Sheets 回答配列変換、S3 汎用 presigned upload 拒否、招待コード rate limit、validation snapshot 固定、Redis password 設定をそれぞれテストまたは manifest/env dry-run で固定する。
- **依存:** R7-H1〜H4, R7-M1。
- **検証:** `rtk pnpm type-check`, `rtk pnpm lint`, `rtk pnpm test --silent` が通過し、k8s manifest のレンダーまたは dry-run 検証が通過すること。

## ラウンド7 推奨スプリント

```
既存 Critical の消化（重複再指摘）
  R4-C2, R5-C2, R5-C3 ──→ R5-T1

データ契約 / 非同期 job の正準化
  R7-H1, R7-H4 ──→ R5-H6 ──→ R7-T1

公開・外部入力 hardening
  R7-H2, R7-H3 ──→ R5-H1, R3-H21 ──→ R7-T1

インフラ設定整合
  R7-M1 ──→ R7-T1
```

---

# nexus-form React Doctor 対応タスク（ラウンド8）

## ラウンド8（R8-H1〜R8-T1）の完了状況

**全タスク完了済み**（2026-05-22 時点）。主要マージ: #196〜#234（H/M/L）、#278〜#279（M6/M13）、#281〜#283（M7〜M9）、#282（M10）、#285〜#287（M12 3 slices）、#288（T1）。`react-doctor` errors 0、score 75/100（`docs/task-verification/r8-t1.md`）。R8-L1 は React 19 API 移行が一部完了（deprecated API 0 件）。

---

レビュー日: 2026-05-20 JST / 対象: `@nexus-form/web`（Vite + React 19.2.4 / 423 source files）
レビュー手法: `react-doctor v0.0.47` を `apps/web` に対して全ファイルスキャン（branch `refactor/split-form-routes`, changed files only = no）。

**実行結果:** score `70 / 100`（Needs work）。`3 errors` / `416 warnings` / `210 of 423 files`。詳細診断は `/var/folders/8f/j8d91frd0bxg7717sgst7cxw0000gn/T/react-doctor-4671ce75-26ea-4bba-a442-463e4d7477ff` に出力済み。

**再実行結果（2026-05-21 JST）:** `react-doctor v0.0.47` を `apps/web` で `--full --offline --json --fail-on none` 実行。score `75 / 100`（Great）、`0 errors` / `359 warnings` / `203 of 425 files`。前回の correctness error は解消済み。警告の大半は既存 R8-M4〜M12 / R8-L1〜L2 に包含されるが、`prefer-useReducer` 7 件と mount 後 hydration flicker 1 件を R8-M13/R8-M14 として追加。

各タスクは `ID / 重要度 / 対象ファイル / 問題 / 修正内容 / 依存 / 検証` で構成。
重要度: 🔴 Critical → 🟠 High → 🟡 Medium → 🟢 Low。

## Phase 1: React correctness / reconciliation

### R8-H1. チャート tooltip コンポーネントが親コンポーネント内で定義され再レンダーごとに再生成される
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #196、`gh-review-hook` exit 0）
- **対象:** `apps/web/src/components/forms/analytics/date-time-chart.tsx:81`, `apps/web/src/components/forms/analytics/date-time-chart.tsx:175`, `apps/web/src/components/forms/analytics/choice-chart.tsx:68`
- **問題:** `DateDistributionChart` / 関連チャート内で `CustomTooltip` がコンポーネント関数内に定義されている。React Doctor は correctness error として検出しており、親の render ごとに別コンポーネント型として扱われ、子 state の破棄や不要な subtree 再生成につながる。
- **修正内容:** `CustomTooltip` を module scope へ移動する。複数チャートで同一構造なら `analytics` 配下に共有 tooltip コンポーネントを切り出し、props 型を明示する。
- **依存:** なし。
- **検証:** `react-doctor` の `react-doctor/no-nested-component-definition` が 0 件になること。チャート tooltip の表示が既存と同等であること。

### R8-H2. TanStack Query mutation 後に cache invalidation が無く stale data が残る
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #197、`gh-review-hook` exit 0）
- **対象:** `apps/web/src/components/forms/form-editor-page.tsx:143`, `apps/web/src/components/forms/form-editor-page.tsx:157`, `apps/web/src/components/forms/form-response-settings.tsx:28`
- **問題:** `useMutation` に `onSuccess` での `queryClient.invalidateQueries` / `setQueryData` / router refresh が無い。フォーム編集・回答設定変更後に UI が古いキャッシュを表示し続ける可能性がある。
- **修正内容:** mutation ごとに影響する query key を特定し、成功時に最小範囲で `invalidateQueries` または `setQueryData` を実行する。楽観更新が必要な箇所は rollback も含めて整理する。
- **依存:** 既存の query key 安定化タスク（R3-H15 など）と同領域。
- **検証:** 設定更新・フォーム編集後に reload なしで最新状態が表示され、`react-doctor/query-mutation-missing-invalidation` が 0 件になること。

## Phase 2: Hydration / render stability

### R8-M1. JSX render 経路で `new Date()` が評価され hydration mismatch の恐れがある
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了
- **対象:** `apps/web/src/components/forms/form-responses-page.tsx:197`, `apps/web/src/components/forms/form-responses-page.tsx:204`, `apps/web/src/components/forms/form-preview-page.tsx:133`, `apps/web/src/components/forms/snapshot-graph.tsx:282`, `apps/web/src/components/forms/schedule-manager.tsx:435`, `apps/web/src/components/forms/share-link-manager.tsx:120`, `apps/web/src/components/forms/validation-result-display.tsx:89`, `apps/web/src/components/forms/response-list.tsx:41`
- **問題:** render 中に現在時刻を直接参照しており、SSR/プリレンダーや hydration 時に server/client 表示がずれる可能性がある。React Doctor では 29 件検出。
- **修正内容:** 現在時刻依存の表示は client-only state（`useEffect` + `useState`）か、明示的な `now` prop 注入に寄せる。静的な timestamp formatting は入力値だけから計算する helper に分離する。
- **依存:** なし。
- **検証:** `react-doctor/rendering-hydration-mismatch-time` が 0 件になること。

### R8-M2. inline render function が reconciliation を不安定化している
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了
- **対象:** `apps/web/src/components/form/checkbox-grid-question.tsx:223`, `apps/web/src/components/form/choice-grid-question.tsx:180`, `apps/web/src/components/form/long-text-question.tsx:173`, `apps/web/src/components/forms/form-publish-menu.tsx:653`, `apps/web/src/components/fingerprint/fingerprint-collector.tsx:355`, `apps/web/src/components/form/rating-question.tsx:203`, `apps/web/src/components/forms/analytics/block-analytics-display.tsx:431`
- **問題:** `renderGrid()` などの inline render function が親 render のたびに再作成され、差分検出や memoization の効果を落とす。React Doctor では 18 件検出。
- **修正内容:** 繰り返し UI を named child component に切り出し、props を明示する。単なる分岐は JSX 変数ではなく小さな presentational component に寄せる。
- **依存:** R8-M6（巨大コンポーネント分割）と同時実施を推奨。
- **検証:** `react-doctor/no-render-in-render` が 0 件になること。

### R8-M3. default prop の `{}` / `[]` が毎 render 新しい参照を作っている
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了
- **対象:** `apps/web` 全体（React Doctor `rerender-memo-with-default-value`: 6 件）
- **問題:** default prop value に `{}` などを直接置いており、memoized child や dependency array の参照安定性を壊す。
- **修正内容:** `const EMPTY_ITEMS = []` / `const EMPTY_OBJECT = {}` のような module-level constant に移動し、型を `ReadonlyArray<T>` / readonly object として固定する。
- **依存:** なし。
- **検証:** `react-doctor/rerender-memo-with-default-value` が 0 件になること。

### R8-M14. mount 後の `useEffect(setState, [])` で hydration 後 flicker が発生しうる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了
- **対象:** `apps/web/src/components/ui/toolbar.tsx:313`
- **問題:** react-doctor 再実行で `rendering-hydration-no-flicker` が 1 件検出された。mount 後の `useEffect(setState, [])` は初回 paint 後に表示状態を変えるため、SSR/プリレンダーや client-only 初期表示でちらつきが出る。
- **修正内容:** 初期値を render 前に決められる場合は derived value にする。ブラウザ API 依存なら `useSyncExternalStore`、`suppressHydrationWarning`、または明示的な client-only placeholder で初回 paint と hydration 後表示の差を制御する。
- **依存:** R8-M5（effect modernization）と同時実施を推奨。
- **検証:** `react-doctor/rendering-hydration-no-flicker` が 0 件になり、toolbar の初期表示でちらつきがないこと。

## Phase 3: State / effect modernization

### R8-M4. render で読まれない `useState` が再レンダーを発生させている
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #202、`gh-review-hook` exit 0）
- **対象:** `apps/web/src/components/ui/font-size-toolbar-button.tsx:44`, `apps/web/src/components/ui/sidebar.tsx:69`, `apps/web/src/components/ui/media-preview-dialog.tsx:7`, `apps/web/src/components/settings/settings-page.tsx:19`, `apps/web/src/components/forms/public-form-page.tsx:40`, `apps/web/src/components/forms/google-sheets-integration.tsx:138`, `apps/web/src/components/ui/font-color-toolbar-button.tsx:211`, `apps/web/src/components/fingerprint/fingerprint-collector.tsx:41`, `apps/web/src/components/forms/conflict-indicator.tsx:199`, `apps/web/src/contexts/form-response-context.tsx:41`, `apps/web/src/components/forms/password-protection-gate.tsx:21`, `apps/web/src/components/ui/inline-combobox.tsx:97`
- **問題:** `inputValue` など、handler 内で更新されるが JSX で読まれない値に `useState` を使っており、不要な再レンダーを発生させる。React Doctor では 14 件検出。
- **修正内容:** render に影響しない mutable value は `useRef` へ置換する。実際には UI に反映すべき値なら JSX 側で明示的に読む形へ修正する。
- **依存:** なし。
- **検証:** `react-doctor/rerender-state-only-in-handlers` が 0 件になること。

### R8-M5. effect が event handler / state reset / callback sync の代替として使われている
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #203、`gh-review-hook` exit 0）
- **対象:** `apps/web` 全体（`no-effect-event-handler`: 4 件, `no-derived-state-effect`: 1 件, `no-prop-callback-in-effect`: 1 件, `advanced-event-handler-refs`: 1 件, `no-cascading-set-state`: 6 件）
- **問題:** `useEffect` 内でイベント相当の処理、props 由来 state reset、親 callback への state 同期、handler identity 変化による listener 再購読が行われている。flash や stale closure、余分な render の原因になる。
- **修正内容:** イベント由来処理は actual handler へ移動する。props 変更で state をリセットする箇所は `key` による remount または derived value に変更する。listener は handler ref パターンで購読を安定化する。
- **依存:** なし。
- **検証:** 該当 React Doctor rules が 0 件、または意図的な例外としてコメント付きで残っていること。

### R8-M6. 巨大コンポーネントと boolean prop 過多で責務が肥大化している
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #278 merged、gh-review-hook exit 0）
- **対象:** `apps/web/src/components/forms/form-publish-menu.tsx:341`, `apps/web/src/components/forms/google-sheets-integration.tsx:122`, `apps/web/src/components/fingerprint/data-retention-manager.tsx:88`, `apps/web/src/components/fingerprint/fingerprint-collector.tsx:33`, `apps/web/src/components/forms/form-editor-page.tsx:43`, `PublishToggleSection` 周辺
- **問題:** `FormPublishMenu` は 446 行、他にも大きいコンポーネントが検出されている。`PublishToggleSection` は boolean-like props が 4 つあり、状態組み合わせが読みづらく regression を招きやすい。
- **修正内容:** UI section ごとに focused component へ分割する。boolean flag の組み合わせは discriminated union の `variant` / explicit state model に寄せる。
- **依存:** R8-M2 と同時実施を推奨。
- **検証:** `react-doctor/no-giant-component` / `react-doctor/no-many-boolean-props` の件数が解消または明確に減ること。

### R8-M13. 関連 state が多いコンポーネントで `useReducer` 候補が残っている
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #279 merged、gh-review-hook exit 0）
- **対象:** `apps/web/src/components/forms/public-form-page.tsx:34`, `apps/web/src/components/forms/form-publish-menu.tsx:420`, `apps/web/src/components/forms/form-responses-page.tsx:15`, `apps/web/src/components/forms/google-sheets-integration.tsx:125`, `apps/web/src/components/fingerprint/data-retention-manager.tsx:88`, `apps/web/src/components/settings/settings-page.tsx:15`, `apps/web/src/components/images/images-page.tsx:13`
- **問題:** react-doctor 再実行で `prefer-useReducer` が 7 件検出された。5〜12 個の `useState` が同一コンポーネントにあり、関連するロード状態・フォーム状態・選択状態が分散しているため、更新順序や reset 漏れの regression を招きやすい。`google-sheets-integration.tsx` と `settings-page.tsx` は `no-cascading-set-state` とも重なり、effect 内で複数 state を連続更新している。
- **修正内容:** 関連 state を reducer へ集約し、イベントごとの state transition を action として明示する。単に責務が大きい箇所は R8-M6 と合わせて section component / hook に分割する。
- **依存:** R8-M5, R8-M6。
- **検証:** `react-doctor/prefer-useReducer` が 0 件、または reducer 化しない理由が明確な例外として残っていること。

## Phase 4: Accessibility / DOM safety

### R8-M7. 非インタラクティブ要素の click handler と anchor misuse が残っている
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #281、`gh-review-hook` exit 0）
- **対象:** `apps/web` 全体（`jsx-a11y/click-events-have-key-events`: 4 件, `jsx-a11y/no-static-element-interactions`: 2 件, `jsx-a11y/anchor-is-valid`: 1 件, `react-doctor/no-prevent-default`: 1 件）
- **問題:** click 可能な非インタラクティブ要素に keyboard event / role が無い。`href` の無い `<a>` や `preventDefault()` 前提の anchor も検出されており、キーボード操作・支援技術での利用に問題がある。
- **修正内容:** 操作要素は原則 `<button>` または router link に置換する。どうしても non-semantic element が必要な場合のみ role + keyboard handler + focus 管理を明示する。
- **依存:** なし。
- **検証:** 該当 jsx-a11y / React Doctor rules が 0 件になること。

### R8-M8. `dangerouslySetInnerHTML` が残っている
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（コードベースに `dangerouslySetInnerHTML` なし、`main.tsx` の bootstrap チェックのみ）
- **対象:** `apps/web` 全体（React Doctor `react/no-danger`: 1 件）
- **問題:** `dangerouslySetInnerHTML` は XSS リスクを持つ。入力源が完全に信頼できるか、sanitizer を通しているかが診断結果からは判断できない。
- **修正内容:** 可能なら React node として構築する。HTML 埋め込みが必要な場合は sanitize 方針を明示し、許可タグ・属性を限定する helper に集約する。
- **依存:** なし。
- **検証:** `react/no-danger` が 0 件、または sanitizer 経由であることをテストで固定すること。

### R8-M9. DOM style の逐次代入が layout thrashing を起こしうる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #283、`gh-review-hook` exit 0）
- **対象:** `apps/web` 全体（React Doctor `js-batch-dom-css`: 3 件）
- **問題:** `element.style.*` を連続代入しており、読み書きが混ざると reflow が増える。
- **修正内容:** class 切り替え、CSS variables、または `cssText` / `Object.assign(element.style, ...)` で batch 化する。
- **依存:** なし。
- **検証:** `react-doctor/js-batch-dom-css` が 0 件になること。

## Phase 5: Bundle / data iteration / keys

### R8-M10. `recharts` が eager import され bundle を重くしている
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #282、`gh-review-hook` exit 0）
- **対象:** `apps/web` の chart components（React Doctor `prefer-dynamic-import`: 4 件）
- **問題:** `recharts` は重いライブラリとして検出されており、初期 bundle に含めるとフォーム閲覧・編集の初期表示を悪化させる。
- **修正内容:** chart 表示箇所を `React.lazy()` + `Suspense` で遅延読み込みする。ルート単位で分けられる箇所は TanStack Router の code splitting と合わせる。
- **依存:** R8-H1（chart tooltip 切り出し）と同時実施を推奨。
- **検証:** chart なし画面の initial chunk から `recharts` が外れること。

### R8-M11. list key / 条件 render / array iteration の細かい不安定要因が残っている
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #214〜#225 merged、各 PR `gh-review-hook` exit 0。対象 React Doctor rules は 0 件）
- **対象:** `apps/web` 全体（array index key: 6 件, numeric conditional render: 1 件, `.filter().map()`: 5 件, `[...array].sort()`: 4 件, async await in do-while: 2 件）
- **問題:** array index key は並べ替え・削除時に state が別 item へ移る。数値の conditional render は `0` を表示しうる。二重 iteration や spread sort は不要な allocation を増やす。独立処理の loop await は直列化される。
- **修正内容:** stable id key に置換する。条件 render は `value > 0` / `Boolean(value)` を明示する。array 処理は `reduce` / `for...of` / `toSorted()` を使い、独立 async 処理は `Promise.all` にまとめる。
- **依存:** なし。
- **検証:** 対象 React Doctor rules が 0 件になること。

## Phase 6: Dead code / public API cleanup

### R8-M12. 未使用ファイル・未使用 export/type・重複 export が大量に残っている
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #285〜#287、`docs/task-verification/r8-m12-slice1.md`〜`slice3.md`）
- **対象:** `apps/web/src` 全体（unused file: 127 件, unused export: 101 件, unused type: 20 件, duplicate export: `VALIDATION_PATTERN_TEMPLATES` / `ALL_TEMPLATE_OPTIONS`）
- **問題:** dead code が多く、実際に使われている UI と旧実装の境界が不明確になっている。React Doctor / knip は `public/env-config.js`, `src/hooks/use-debounced-value.ts`, `src/hooks/use-mobile.ts`, `src/types/fingerprint.ts`, `src/components/fingerprint/*`, `src/components/form/*`, `src/components/forms/*`, `src/components/ui/*` など広範囲を未使用として検出している。
- **修正内容:** まず route / barrel export / dynamic import の false positive を分類する。実未使用なら削除し、公開 API として必要なら import 経路または knip 設定に明示する。重複 export は単一の export 元へ統一する。
- **依存:** UI 再編タスクと競合しやすいため、feature branch 単位で小分けに実施する。
- **検証:** `react-doctor` / `knip` の dead code 診断が意図した件数まで減り、`rtk pnpm type-check`, `rtk pnpm lint:fix`, `rtk pnpm test --silent` が通過すること。

## Phase 7: Low priority polish

### R8-L1. React 19 推奨 API と軽量な memo/state 整理
- **重要度:** 🟢 Low
- **対応状況:** ✅ 一部完了（React 19 deprecated API: `useContext`/`forwardRef` 0 件、PR #227〜#232、`gh-review-hook` exit 0）
- **対象:** `apps/web` 全体（`useContext` → `use()`: 13 件, trivially cheap `useMemo`: 1 件, `useTransition` 候補: 2 件, `useState` initialized from prop: 5 件）
- **問題:** React 19 では context read に `use()` が推奨される。安価な式に `useMemo` を使う箇所や、transition state に通常の `useState` を使う箇所も検出されている。
- **修正内容:** リスクの低い箇所から `useContext` を `use()` に移行する。安価な `useMemo` は削除し、transition guard は `useTransition` へ置換できるか確認する。prop 由来 state は同期要否を明確化する。
- **依存:** なし。
- **検証:** React Doctor の該当 warnings が減ること。

### R8-L2. handler 名・`autoFocus`・AI 風 UI 指摘などの polish
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（handler 名 / `autoFocus` / AI 風 UI 対象 warning 0 件、PR #233〜#234、`gh-review-hook` exit 0）
- **対象:** `apps/web` 全体（generic handler name: 10 件, `autoFocus`: 1 件, thick `border-l-4`: 1 件）
- **問題:** `handleChange` などの汎用名は意図が読みづらい。`autoFocus` はアクセシビリティ上の問題になりうる。`border-l-4` は UI polish 指摘として検出されている。
- **修正内容:** handler 名を `updateX` / `selectY` / `toggleZ` のように動作ベースへ変更する。`autoFocus` は削除または明示的な focus management へ置換する。太い片側 border は既存デザインに合わせた subtle accent に変更する。
- **依存:** なし。
- **検証:** 該当 warnings が 0 件、またはデザイン上の意図が明確に残っていること。

## Phase 8: ラウンド8 回帰テスト

### R8-T1. React Doctor 対応後の Web 回帰確認
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #288、`docs/task-verification/r8-t1.md`。react-doctor errors 0）
- **対象:** `apps/web`, `@nexus-form/web`
- **修正内容:** R8-H1〜R8-M14 / R8-L1〜L2 の各修正後、対象単位で `react-doctor` を再実行し、少なくとも errors を 0 件にする。通常の repo 検証として `rtk pnpm lint:fix`, `rtk pnpm type-check`, `rtk pnpm test --silent` を通す。UI 変更を含む場合は該当ページをブラウザで確認し、チャート・フォーム編集・公開フォーム・設定画面の主要 flow を確認する。
- **依存:** R8-H1〜R8-M14, R8-L1〜L2。
- **検証:** `react-doctor` score が改善し、`3 errors` が 0 件になること。通常検証コマンドが通過すること。

## ラウンド8 推奨スプリント

```
まず correctness error を潰す
  R8-H1 ──→ R8-T1

ユーザーに見える stale data / hydration / a11y を優先
  R8-H2, R8-M1, R8-M14, R8-M7, R8-M8 ──→ R8-T1

大きな UI 整理と render 安定化
  R8-M2, R8-M4, R8-M5, R8-M6, R8-M13 ──→ R8-T1

bundle / dead code cleanup
  R8-M10, R8-M12 ──→ R8-T1

低リスク polish
  R8-M3, R8-M9, R8-M11, R8-L1, R8-L2
```

---

# nexus-form コードベースレビュー 対応タスク（ラウンド9）

## ラウンド9（R9-C1〜R9-T1）の完了状況

**全タスク完了済み**（`master` 実装済み、2026-05-22 検証）。Critical C1〜C5・High H1〜H7・回帰 T1 は `docs/task-verification/r9-c1-c5.md` / `r9-h1-h7.md` を参照。

---

レビュー日: 2026-05-21 JST / 対象: 全ワークスペース（apps/api, apps/web, apps/worker, packages/*）
レビュー手法: `deep-review` による全コードベース静的監査。サブエージェント 5 領域（型・境界 / セキュリティ / failure・lifecycle / frontend / tests・concurrency）と親側の横断確認で実施。作業ツリーに差分なし。テストは未実行。

各タスクは `ID / 重要度 / 対象ファイル / 問題 / 修正内容 / 依存 / 検証` で構成。
重要度: 🔴 Critical → 🟠 High → 🟡 Medium → 🟢 Low。

## Phase 0: セキュリティ・認可 Critical

### R9-C1. 共有リンク API token が共有リンク管理 API を操作できる
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（`master` 実装済み、`docs/task-verification/r9-c1-c5.md`）
- **対象:** `apps/api/src/routes/forms-permissions.ts:121,365,408,437,452`, `apps/api/src/lib/forms/permission-service.ts:957`
- **問題:** EDITOR 共有リンク由来の Bearer token が `GET /api/forms/:id/share-links` / detail / update / delete を通過できる。`GET` は共有リンクの生 token も返すため、共有リンク利用者が他リンクを列挙・漏えい・無効化できる。`POST /share-links` だけは追加拒否があるが、GET/detail/PUT/DELETE には synthetic principal 拒否がない。
- **修正内容:** 共有リンク管理 API は session user または非 synthetic user token のみに限定する。`share_link_id`、`anon:`、`share-link:` principal を明示的に拒否する共通 guard を追加し、GET/detail/PUT/DELETE/POST に適用する。
- **依存:** なし。
- **検証:** EDITOR 共有リンク token で `GET /share-links`, `GET /share-links/:linkId`, `PUT /share-links/:linkId`, `DELETE /share-links/:linkId` が 403 になり、レスポンスに `token` が含まれないこと。

### R9-C2. `/api/forms` が API token の scope と `form_ids` 制限を無視する
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（`master` 実装済み、`docs/task-verification/r9-c1-c5.md`）
- **対象:** `apps/api/src/routes/forms.ts:25,37,58,65`
- **問題:** ルーター全体が `withDualAuth()` のみで、`POST /api/forms` に `write` scope が要求されない。read-only user API token でフォーム作成できる。また `GET /api/forms` は `creatorId = auth.user_id` の全フォームを返し、`form_ids` 制限付き token でも制限外フォームを列挙できる。
- **修正内容:** `POST /api/forms` は `withDualAuth(["write"])` 相当の scope を要求する。`GET /api/forms` は API token の `form_ids` がある場合、その ID 群に絞るか route 自体を拒否する。session と API token の分岐を明示する。
- **依存:** なし。
- **検証:** read-only token の POST が 403、write token の POST が成功、`form_ids` 制限付き token の GET が制限内のみ返すこと。

### R9-C3. `fingerprint/anonymized` が `formId` と `responseId` の不一致で他フォーム情報を返す
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（`master` 実装済み、`docs/task-verification/r9-c1-c5.md`）
- **対象:** `apps/api/src/routes/fingerprint.ts:193-221`, `apps/api/src/lib/fingerprint/anonymizer.ts:85-108`
- **問題:** `formId` と `responseId` が同時指定された場合、権限確認は `formId` のみで行われるが、匿名化データ取得は `responseId` 優先になる。アクセス可能なフォーム ID と他フォームの responseId を組み合わせると、他フォームの fingerprint duplicate 情報を取得できる。
- **修正内容:** `responseId` と `formId` が同時指定された場合は、対象 response がその form に属することを必ず検証する。もしくは API contract を `responseId` か `formId` のどちらか一方だけに制限する。
- **依存:** なし。
- **検証:** `formId=A&responseId=B` で B が A に属さない場合 403/404 になり、anonymizer が呼ばれないこと。

### R9-C4. 招待承諾 API が承諾前ユーザーに VIEWER 権限を要求する
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（`master` 実装済み、`docs/task-verification/r9-c1-c5.md`）
- **対象:** `apps/api/src/routes/forms-permissions.ts:120,458-467`
- **問題:** `POST /:id/invitations/:token/accept` が `/:id/invitations*` の `withDualFormAuth("VIEWER")` 配下にある。まだ form permission を持たない招待先ユーザーは VIEWER 判定を通れず、招待を承諾できない。
- **修正内容:** 招待承諾 route を `withDualFormAuth("VIEWER")` の対象外に移し、通常 session auth のみで保護する。承諾時は token、email 一致、期限、status を `acceptInvitation` 側で検証する。
- **依存:** なし。
- **検証:** 招待先メールに一致する未権限ユーザーが招待を承諾でき、別ユーザーや期限切れ token は拒否されること。

### R9-C5. Sheets sync job が `formId` / `integrationId` / `responseId` の所属一致を検証しない
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（`master` 実装済み、`docs/task-verification/r9-c1-c5.md`）
- **対象:** `apps/worker/src/handlers/sheets-sync.ts:69-73,126-130`
- **問題:** worker は integration を `integrationId` だけ、response を `responseId` だけで取得し、job の `formId` と照合しない。壊れた enqueue、古い job、queue 混入で、別フォームの回答を別 integration の Google Sheet に同期できる。
- **修正内容:** integration 取得時に `id = integrationId AND formId = job.formId`、response 取得時に `id = responseId AND formId = job.formId` を必須にする。不一致は Sheets API 呼び出し前に fail closed する。
- **依存:** R9-H2 と同ファイル。
- **検証:** job の `formId` と異なる integration/response fixture で Sheets API が呼ばれず job が失敗すること。

## Phase 1: 非同期・外部境界 High

### R9-H1. validation retry が同一 result に複数 job を投入し、古い job が結果を上書きできる
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（`master` 実装済み、`docs/task-verification/r9-h1-h7.md`）
- **対象:** `apps/api/src/routes/forms-responses.ts:343-397,884-949,980-1041`, `apps/worker/src/lib/validation-helpers.ts:277-344`
- **問題:** retry 対象を選択した後、DB を `PENDING` にする前に `queue.add()` するため、同一 validation result への並行 retry で複数 job が投入される。さらに worker 側は現在行の `jobId` と実行中 job の一致を確認せず、古い job が `PROCESSING` や最終結果を後勝ち上書きできる。
- **修正内容:** DB 側で status/jobId の取得・`PENDING` 遷移を原子的に行い、更新成功行だけ enqueue する。worker は `markValidationProcessing` / `writeValidationResult` で現在の `jobId` 所有権を確認し、stale job は更新・SSE publish しない。
- **依存:** なし。
- **検証:** 同一 result に対する concurrent retry で `queue.add()` が 1 回だけ、または片方が 409 になること。`jobId=job-b` の行に `job-a` が更新しようとしても無視されること。

### R9-H2. Sheets sync の Redis lock TTL が critical section 最大時間より短い
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（`master` 実装済み、`docs/task-verification/r9-h1-h7.md`）
- **対象:** `apps/worker/src/handlers/sheets-sync.ts:177-180,289-299,337-339`
- **問題:** critical section 内で `readRange`、必要なら `updateRange`、`appendRows` の最大 3 回の Sheets API 呼び出しがあり、各 timeout は既定 30 秒。一方 lock TTL は 60 秒で、遅い成功レスポンスが続くと lock が途中失効する。`pending` idempotency key は append 直前まで設定されないため、2 つ目の worker が critical section に入り重複 append やヘッダー競合を起こせる。
- **修正内容:** lock TTL を `GOOGLE_SHEETS_API_TIMEOUT_MS` と呼び出し回数から算出して十分長くする、または lock renewal を導入する。`pending` idempotency key は critical section の早い段階で設定し、既存 row 再読込による duplicate guard を維持する。
- **依存:** R9-C5 と同ファイル。
- **検証:** 1 つ目の job が `pending` 設定前に TTL 超過する条件でも、2 つ目の job が同じ integration の critical section に入れないこと。

### R9-H3. Worker の Google Sheets API success response が未検証
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（`master` 実装済み、`docs/task-verification/r9-h1-h7.md`）
- **対象:** `apps/worker/src/lib/google-sheets-client.ts:120-128,156-167,190-196`
- **問題:** Google Sheets の 200 JSON を `as` で成功扱いしており、`values`, `range`, `updatedRows` などの型を検証しない。malformed 200 で idempotency/header 判定がクラッシュまたは誤判定する。
- **修正内容:** `appendRows` / `readRange` / `updateRange` 用の Zod schema を追加し、`safeParse` 失敗時は `ok: false` の `invalidArgument` または `internal` として扱う。API 側の Google client と schema を共有できるなら共通化する。
- **依存:** R9-H2 と同領域。
- **検証:** `values` が配列でない、`updatedRows` が number でない 200 応答が `ok: false` になること。

### R9-H4. SSE Redis subscribe 失敗が HTTP エラーではなく 200 event-stream 後の切断になる
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（`master` 実装済み、`docs/task-verification/r9-h1-h7.md`）
- **対象:** `apps/api/src/routes/forms-sse.ts:302,325`
- **問題:** `streamSSE` を返した後に `sseChannelRegistry.attach()` が Redis `subscribe()` を await する。Redis 不通時でも HTTP 200 / `text/event-stream` が開始され、その後ストリーム内例外または切断になり、クライアントや監視が HTTP 5xx として扱えない。
- **修正内容:** Redis subscribe を SSE 開始前に確立できる API に分離するか、少なくとも subscribe failure を `streamSSE` 返却前に検出して 503/500 を返す。permit は失敗時も必ず release する。
- **依存:** なし。
- **検証:** `subscribe()` rejection を注入し、レスポンスが SSE 200 ではなく HTTP エラーで返り、permit が解放されること。

### R9-H5. Twitter upstream の malformed success が検証成功として保存され得る
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（`master` 実装済み、`docs/task-verification/r9-h1-h7.md`）
- **対象:** `packages/validation-provider-twitter/src/client.ts:69-95`, `packages/validation-provider-twitter/src/plugin.ts:74-89`
- **問題:** Twitter API response を Axios generic だけで信用している。`200 { data: { id: "123" } }` のような欠落レスポンスでも provider は `isValid: true` を返し、metadata schema failure は worker 側で metadata を捨てるだけで `success: true` が保存され得る。
- **修正内容:** Twitter API response と `TwitterUserInfo` に Zod schema を導入し、必須フィールド欠落は upstream contract error として `isValid: false` または retryable failure にする。
- **依存:** なし。
- **検証:** malformed 200 を mock し、`isValid: true` にならないこと。

## Phase 2: Web UX / data loss High

### R9-H6. 回答詳細 UI が実際の回答内容を表示しない
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（`master` 実装済み、`docs/task-verification/r9-h1-h7.md`）
- **対象:** `apps/web/src/components/forms/response-detail-view.tsx:42-56`, `apps/web/src/components/forms/form-responses-page.tsx:262-265`
- **問題:** `ResponseDetailView` は任意 props の `fields` だけを表示元にするが、呼び出し側は `formId` と `responseId` しか渡していない。`GET /:id/responses/:responseId` の `response.responseDataJson` が UI に反映されず、ユーザーは回答を選択しても「回答内容はありません。」しか見られない。
- **修正内容:** `ResponseDetailView` で回答詳細 API を取得し、`responseDataJson` を安全に parse して `ResponseDisplay` へ渡す。質問タイトルとの対応が必要なら form content/snapshot から label を解決する。
- **依存:** なし。
- **検証:** 回答一覧で行を選択すると、detail API の `responseDataJson` に含まれる回答が表示されること。

### R9-H7. 編集ページ離脱時 autosave が HTTP エラーを成功扱いし未保存編集を失う
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（`master` 実装済み、`docs/task-verification/r9-h1-h7.md`）
- **対象:** `apps/web/src/hooks/forms/use-form-content-autosave.ts:383-395`
- **問題:** unmount cleanup の keepalive `fetch` が network exception だけを `catch` し、409/500/401 など non-2xx response を成功扱いする。失敗時に `localStorage` fallback が残らず、保存競合や一時的な API エラーで未保存編集を失う。
- **修正内容:** keepalive fetch の `response.ok` を確認し、non-2xx では `pendingSave:${formId}` に fallback 保存する。可能なら `sendBeacon` 相当の制約と 64KB 制限もテストで固定する。
- **依存:** なし。
- **検証:** pending save がある状態で unmount し、`fetch` が `{ ok: false, status: 500 }` を返した場合に `localStorage` fallback が残ること。

## Phase 3: ラウンド9 回帰テスト

### R9-T1. セキュリティ・境界・非同期回帰テスト
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（R9-C/H 回帰テスト既存、`docs/task-verification/r9-h1-h7.md`）
- **対象:** `apps/api/src/__tests__`, `apps/worker/src/**/__tests__`, `apps/web/src/**/__tests__`, `packages/validation-provider-twitter/src/__tests__`
- **修正内容:** R9-C1〜C5、R9-H1〜H7 の修正後、それぞれの悪用/失敗シナリオを route-level、worker helper、hook/component、provider test で固定する。
- **依存:** R9-C1〜C5, R9-H1〜H7。
- **検証:** `rtk pnpm lint:fix`, `rtk pnpm type-check`, `rtk pnpm test --silent` が通過すること。

## ラウンド9 推奨スプリント

```
即時封鎖すべき認可・情報漏えい
  R9-C1, R9-C2, R9-C3, R9-C4 ──→ R9-T1

外部同期と queue 整合性
  R9-C5, R9-H1, R9-H2, R9-H3, R9-H5 ──→ R9-T1

SSE failure semantics
  R9-H4 ──→ R9-T1

ユーザー可視の Web 不具合・データ損失
  R9-H6, R9-H7 ──→ R9-T1
```

---

# nexus-form コードベースレビュー 対応タスク（ラウンド10）

レビュー日: 2026-05-21 JST / 対象: 全ワークスペース（apps/api, apps/web, apps/worker, packages/*）
レビュー手法: Codex 親エージェント + サブエージェント 5 領域（型・境界 / セキュリティ / failure・lifecycle / frontend / tests・concurrency）によるセルフレビュー。ラウンド9と重複する指摘は既存タスクを参照し、今回の最終所見で未タスク化または範囲不足だったものを追加する。レビュー専用のためテストは未実行。

各タスクは `ID / 重要度 / 対象ファイル / 問題 / 修正内容 / 依存 / 検証` で構成。
重要度: 🔴 Critical → 🟠 High → 🟡 Medium → 🟢 Low。

## Phase 0: セキュリティ・認可 Critical

### R10-C1. `GET /api/fingerprint/get` でも `formId` と `responseId` の不一致で他フォーム fingerprint を返す
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #248、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/fingerprint.ts:133-176`
- **問題:** R9-C3 は `/anonymized` を対象にしているが、通常取得の `/get` にも同じ境界不備がある。`formId` と `responseId` が同時指定された場合、権限確認は `formId` のみで行われ、実取得条件は `eq(fingerprintDetail.responseId, responseId)` になる。アクセス可能なフォーム ID と他フォームの responseId を組み合わせると、他フォームの raw fingerprint hash を取得できる。
- **修正内容:** `responseId` と `formId` が同時指定された場合は、対象 response がその form に属することを必ず検証する。もしくは API contract を `responseId` か `formId` のどちらか一方だけに制限する。`/get` と `/anonymized` で同じ resolver/guard を共有し、片方だけ修正される状態を避ける。
- **依存:** R9-C3 と同時修正推奨。
- **検証:** `formId=A&responseId=B` で B が A に属さない場合 403/404 になり、fingerprint rows が返らないこと。

### R10-C2. OWNER 権限削除 route がサービス層の OWNER 削除禁止を迂回する
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #249、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-permissions.ts:222-241`, `apps/api/src/lib/forms/permission-service.ts:530-572`
- **問題:** `DELETE /:id/permissions/:userId` は `removePermission()` を使わず route 内で `formPermission` を直接 delete している。`removePermission()` には OWNER 削除禁止の不変条件があるが、route はそれを迂回するため、OWNER が別 OWNER 権限行を削除できる。`creatorId` は残っても permission table 上の OWNER 整合性が壊れ、権限 UI/API の表示や後続操作が不整合になる。
- **修正内容:** route から直接 delete を消し、`removePermission(formId, userId)` を呼ぶ。`removePermission` のエラーを 404/409/400 など適切な HTTP response に変換する。必要なら「自分自身の OWNER 削除」「最後の OWNER 削除」を個別に禁止するテストを追加する。
- **依存:** なし。
- **検証:** OWNER 権限行を削除しようとすると拒否され、EDITOR/VIEWER の削除は従来通り成功すること。

### R10-C3. `external-service` が `formId` 未指定時に form-scoped token の境界を検証しない
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #250、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/external-service.ts:54-80,131-160`
- **問題:** `resolveEffectiveUserId` は `formId` が無い場合に `authUserId` をそのまま返す。API token 認証でも `form_ids` や所有フォームとの関係を検証しないため、form-scoped/read-only token が linked account ベースの provider API を呼び出せる。provider handler が Discord/GitHub 等の linked account を使う場合、フォーム境界を越えた外部情報取得になる。
- **修正内容:** `external-service` は `formId` を必須にする、または form に紐づかない provider API を session-only に限定する。API token 経路では `form_ids` と ownership/role を必ず検証し、`share_link_id` / `anon:` / `share-link:` principal は拒否する。
- **依存:** R9-C2 と同じ API token scope 方針に合わせる。
- **検証:** `form_ids` 制限付き token が `formId` 未指定で provider API を呼ぶと 400/403 になり、許可された formId 付きの場合のみ成功すること。

## Phase 1: 非同期・ライフサイクル High

### R10-H1. validation cancel が完了済み結果を `CANCELLED_BY_USER` に上書きできる（CAS チェーン 段階1）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #251、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-responses.ts:1097-1111`
- **問題:** cancel endpoint は `discardQueuedValidationJob()` 後、status 条件なしで validation result を `FAILED/CANCELLED_BY_USER` に更新する。`discardQueuedValidationJob` と DB update の間に worker が完了した場合、または既に `COMPLETED` の結果に対して cancel が来た場合でも、正常完了結果をキャンセル状態へ上書きできる。
- **修正内容:** cancel 対象を `PENDING` / `PROCESSING` / `FAILED` のうちキャンセル可能な状態に限定する。`COMPLETED` は 409 または no-op にする。`UPDATE ... WHERE id=? AND status IN ('PENDING','PROCESSING','FAILED')` に変更し、affectedRows=0 の場合は現在 status を再読込して適切に返す。
- **依存:** R9-H1（validation jobId 所有権）と同時修正推奨。**R11-H1（段階2）・R11-M14（段階3）より先に実施すること。**
- **検証:** worker 完了直後の cancel が `COMPLETED` を上書きしないこと。queued/delayed job の cancel は従来通り `CANCELLED_BY_USER` になること。

### R10-H2. SSE の連続イベント送信が await されず配信順序が前後し得る
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #252、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-sse.ts:221-229`
- **問題:** Redis Pub/Sub の `message` handler が各 client の `sendMessage()` を await せず `.catch()` だけで投げっぱなしにする。連続イベント時に後続 `writeSSE` が先に完了すると、SSE `id` と本文の配信順序が崩れ、クライアントの状態更新が古いイベントで後勝ちする可能性がある。
- **修正内容:** client ごとに送信 queue / promise chain を持ち、同一 client への `writeSSE` を直列化する。失敗時は該当 client を detach/close するか、少なくとも以後の queue を止めて resource leak を避ける。
- **依存:** R9-H4（subscribe failure semantics）と同ファイル。
- **検証:** 連続する Redis message を注入し、各 client で `id=1,2,3` の順に `writeSSE` が完了すること。

### R10-H3. SSE Redis subscribe 失敗が HTTP エラーではなく壊れた 200 stream になる
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #244、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-sse.ts:302-325`
- **問題:** ラウンド9の R9-H4 と同一。今回の failure/lifecycle レビューでも再指摘された。Redis `subscribe()` 失敗が `streamSSE` callback 内で発生するため、HTTP status と監視が実際の失敗を表現できない。
- **修正内容:** R9-H4 を実施する。subscribe failure は SSE 開始前に検出し、503/500 として返す。
- **依存:** R9-H4。
- **検証:** R9-H4 と同じ。

## Phase 2: 外部境界・レスポンス検証 High

### R10-H4. Discord guild sync が upstream response を未検証のまま `BigInt` へ渡す
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #253、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/lib/auth.ts:190-200,218-224`
- **問題:** Discord `/users/@me/guilds` の JSON を `as Array<...>` で信頼し、`guild.permissions` を `BigInt()` に渡している。`permissions` 欠損や非数値文字列、配列でない応答で同期処理全体が例外になり、ギルド同期が失敗する。bot guild response も同様に未検証。
- **修正内容:** Discord guild response 用の Zod schema を追加し、`permissions` は `z.string().regex(/^\d+$/)` などで検証する。parse 失敗時は該当 sync を fail closed し、ログ/Sentry に upstream contract error として残す。
- **依存:** なし。
- **検証:** malformed 200 response（`permissions` 欠損/非数値、配列以外）を mock し、例外で全体が壊れず安全にログされること。

### R10-H5. Worker の Google Sheets success response が未検証
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #243、`gh-review-hook` exit 0）
- **対象:** `apps/worker/src/lib/google-sheets-client.ts:66,120-128,156-167,190-196`
- **問題:** ラウンド9の R9-H3 と同一。今回の境界検証レビューでも再指摘された。Google Sheets の 200 JSON を `as` で成功扱いしており、malformed response で idempotency/header 判定がクラッシュまたは誤判定する。
- **修正内容:** R9-H3 を実施する。`appendRows` / `readRange` / `updateRange` に Zod schema を導入し、parse failure を `ok: false` に変換する。
- **依存:** R9-H3。
- **検証:** R9-H3 と同じ。

## Phase 3: Web UX / 状態整合性 Medium

### R10-M1. 回答一覧ページ切替中に前ページの回答を新ページとして表示・選択できる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #254、`gh-review-hook` exit 0）
- **対象:** `apps/web/src/components/forms/form-responses-page.tsx:111,222`
- **問題:** `placeholderData: keepPreviousData` のまま `data.responses` を描画しているため、ページ番号変更直後の fetch 中に前ページの回答が新しいページ番号の内容として表示される。ユーザーはページ2を見ているつもりでページ1の回答を選択・操作できる。
- **修正内容:** `isPlaceholderData` 中は table selection/action を無効化する、またはページ番号表示を旧データであることが分かる loading state にする。選択状態は `page/sort/filter` 変更時に clear する。
- **依存:** なし。
- **検証:** ページ切替中に旧ページの row action が実行できず、新ページの fetch 完了後だけ選択可能になること。

### R10-M2. 共有リンクコピー失敗が未処理 Promise になり失敗 UI が出ない
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #255、`gh-review-hook` exit 0）
- **対象:** `apps/web/src/components/forms/share-link-manager.tsx:47`, `apps/web/src/hooks/forms/use-share-links.ts:127-128`
- **問題:** `copyShareLinkUrl()` の `navigator.clipboard.writeText` 失敗が呼び出し側で捕捉されず、clipboard 権限拒否や非 secure context で未処理 Promise になる。ユーザーには失敗理由も代替手段も表示されない。
- **修正内容:** copy handler を `try/catch` し、失敗 toast と手動コピー用 UI を出す。hook 側は fallback 成否を返すか、例外型を明確にする。
- **依存:** なし。
- **検証:** clipboard mock が reject した場合に unhandled rejection が出ず、失敗メッセージが表示されること。

### R10-M3. 権限/招待/共有リンク管理 UI が query error を空状態として表示する
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #256、`gh-review-hook` exit 0）
- **対象:** `apps/web/src/components/forms/permission-editor.tsx:30-47`, `apps/web/src/components/forms/invitation-manager.tsx:29-104`, `apps/web/src/components/forms/share-link-manager.tsx:31-98`
- **問題:** `isError` を扱わず、`query.data?.items ?? []` を空配列扱いしている。取得失敗時に「権限が設定されているユーザーはいません」「保留中の招待はありません」「共有リンクはまだありません」と表示され、ユーザーが実データなしと誤認する。
- **修正内容:** 各 query の `isError` を明示的に分岐し、retry button 付き error state を表示する。空状態は成功レスポンスで 0 件の場合だけ表示する。
- **依存:** なし。
- **検証:** query error mock で空状態ではなく error state が表示され、retry で `refetch` が呼ばれること。

## Phase 4: ラウンド10 回帰テスト

### R10-T1. ラウンド10 セキュリティ・非同期・UI 回帰確認
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（既存回帰テストで確認、`rtk pnpm lint:fix`, `rtk pnpm type-check`, `rtk pnpm test --silent` 通過）
- **対象:** `apps/api/src/**/__tests__`, `apps/worker/src/**/__tests__`, `apps/web/src/**/__tests__`
- **修正内容:** R10-C1〜C3、R10-H1〜H5、R10-M1〜M3 の修正後、悪用/失敗/表示シナリオをテストで固定する。R9 と重複する項目は R9-T1 に統合してよいが、`/fingerprint/get`、OWNER 削除、external-service `formId` 未指定、validation cancel、SSE 順序、Discord malformed response、Web error state は必ずカバーする。
- **確認済みカバレッジ:**
  - `/fingerprint/get` form/response 不一致: `apps/api/src/__tests__/fingerprint-anonymized-auth.test.ts`
  - OWNER 削除 route のサービス層委譲: `apps/api/src/__tests__/forms-permissions-share-links-auth.test.ts`
  - external-service `formId` 未指定・synthetic principal 拒否: `apps/api/src/__tests__/external-service-authz.test.ts`
  - validation cancel の完了済み上書き禁止: `apps/api/src/__tests__/unbounded-query-pagination.test.ts`
  - SSE subscribe failure と client 別送信順序: `apps/api/src/__tests__/forms-sse-subscribers.test.ts`
  - Discord malformed guild response: `apps/api/src/lib/__tests__/auth-discord-guilds.test.ts`
  - Google Sheets malformed success response: `apps/worker/src/lib/__tests__/google-sheets-client.test.ts`
  - Web stale placeholder / copy failure / query error state: `apps/web/src/components/forms/form-responses-page.test.tsx`, `apps/web/src/components/forms/share-link-manager.test.tsx`, `apps/web/src/components/forms/form-sharing-error-states.test.tsx`
- **依存:** R10-C1〜C3, R10-H1〜H5, R10-M1〜M3。
- **検証:** `rtk pnpm lint:fix`, `rtk pnpm type-check`, `rtk pnpm test --silent` が通過すること。

## ラウンド10 推奨スプリント

```
即時封鎖すべき情報漏えい・権限破壊
  R10-C1, R10-C2, R10-C3 ──→ R10-T1

validation / SSE の非同期整合性
  R10-H1, R10-H2, R10-H3 ──→ R10-T1

外部境界検証
  R10-H4, R10-H5 ──→ R10-T1

Web の誤表示・失敗状態
  R10-M1, R10-M2, R10-M3 ──→ R10-T1
```

---

# nexus-form コードベースレビュー 対応タスク（ラウンド11）

## ラウンド11（R11-C1〜R11-T1）の完了状況

**全タスク完了**（2026-05-23、`master` @ `1c3a0c1`）。PR #289 で C/H/M/L の主要分をマージ後、follow-up を #295〜#306 で完了（検証台帳: `docs/task-verification/r11-*.md`）。

| 区分 | 状態 | 主な PR / 備考 |
|------|------|----------------|
| R11-C1〜C5 | ✅ | #289 |
| R11-H1〜H17 | ✅ | #289, #292〜#294 |
| R11-M1〜M22 | ✅ | #289, #299〜#301, #303〜#305 |
| R11-L1〜L11 | ✅ | #289, #295, #302 ほか |
| R11-T1 | ✅ | #306（回帰台帳更新） |

**未着手: なし**

---

レビュー日: 2026-05-21 JST / 対象: 全ワークスペース（apps/api, apps/web, apps/worker, packages/*, インフラ・CI）
レビュー手法: サブエージェント 6 領域（API セキュリティ・認可 / API 非同期・SSE / Web ルート・データ層 / Web コンポーネント・フック / Worker・integrations / DB・shared・インフラ・CI）による並列レビュー。R10 と重複する指摘は本ラウンドでは新規 ID を発番せず、再確認のみコメントで残す（例: R10-H1 Cancel 上書き、R10-H2 SSE 直列化、R10-C3 external-service formId 必須化はラウンド11でも再指摘あり）。レビュー専用のためテスト未実行。

各タスクは `ID / 重要度 / 対象ファイル / 問題 / 修正内容 / 依存 / 検証` で構成。重要度: 🔴 Critical → 🟠 High → 🟡 Medium → 🟢 Low。

## Phase 0: Critical（即時対応）

### R11-C1. Google Sheets sync ジョブ ID IDOR でテナント横断のジョブ情報が取得できる
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-c1-c5.md`）
- **対象:** `apps/api/src/routes/forms-integrations.ts:123-148`
- **問題:** `GET /forms/:id/integrations/google-sheets/sync/:jobId` は `withDualFormAuth("OWNER")` で `:id` の所有権だけを確認し、`getSheetsSyncQueue().getJob(jobId)` をフォーム境界に依存せず取得する。`jobId` が `:id` のフォームに属しているかの検証が無いため、別フォームの jobId を渡すと `job.failedReason` / `job.progress` / `job.returnvalue` 経由で他テナントのスプレッドシート ID・シート名・Google API のエラー詳細が漏洩する。
- **修正内容:** ジョブ ID に `formId` を埋め込む形式（`${formId}:${uuid}`）へ変更し、ハンドラ側で prefix を検証する。または `job.data.formId === c.req.param("id")` の突合を強制する。
- **依存:** なし。
- **検証:** 別フォームの jobId に対し 404 を返すユニットテスト追加。

### R11-C2-a. formResponse と同一 tx 内で PENDING validation 行を挿入（孤児レスポンス対応 段階1）
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-c1-c5.md`）
- **対象:** `apps/api/src/routes/forms-public.ts:577-653,920-998`
- **問題:** 公開送信フローは (a) `db.transaction` で `formResponse` を確定 → (b) 201 を返却 → (c) `queueExternalValidations` を **非 await** で発火 → (d) ハンドラ内部の `db.insert(externalServiceValidationResult)` と BullMQ enqueue がトランザクション外で実行される。プロセスクラッシュ / OOM / Pod evict / SIGTERM が 201 と挿入の間に挟まると、`formResponse` は永続化済みなのに validation 行も enqueue も存在しない孤児が発生する。
- **修正内容:** `db.transaction` 内で `formResponse` と同時に `externalServiceValidationResult`（status=`PENDING`, jobId=NULL）を挿入。tx commit 後に enqueue し、失敗時は `ENQUEUE_FAILED` に更新する既存ロジックを再利用。MISSING / FAILED の最終状態行も同一 tx に含める。
- **依存:** なし（R11-C2-b より先に実施）。
- **検証:** tx commit 直後 / enqueue 直前にプロセスを kill する fault injection テストで、`formResponse` 行と `PENDING` validation 行が共に永続化されること。

### R11-C2-b. outbox sweeper の追加（PENDING+jobId=NULL の自動回収、孤児レスポンス対応 段階2）
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-c1-c5.md`）
- **対象:** 新規 `apps/api/src/lib/forms/validation-outbox-sweeper.ts`（または API 起動時リカバリ）
- **問題:** R11-C2-a で PENDING 行が tx 内に書かれても、enqueue 失敗や起動前クラッシュでは jobId=NULL のまま放置される。リカバリトリガが無いため SSE/UI 上で永久に PENDING すら表示されない。
- **修正内容:** 一定時間 `PENDING` かつ `jobId IS NULL` の行を定期的または API 起動フック時に再 enqueue する sweeper を追加。BullMQ repeat job または API 起動フックで実行。
- **依存:** R11-C2-a。
- **検証:** sweeper が `PENDING+jobId=NULL` を拾って再 enqueue し、SSE で PENDING → COMPLETED と遷移すること。

### R11-C2-c. jobId 後追い UPDATE に `AND jobId IS NULL` を追加（孤児レスポンス対応 段階3 / R11-M15 統合）
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-c1-c5.md`）
- **対象:** `apps/api/src/routes/forms-public.ts:960-963`
- **問題:** 初回 enqueue 経路でも enqueue 後に `UPDATE externalServiceValidationResult SET jobId=? WHERE id=?` を発行。worker が既に完了し新 jobId を書いた後にこの古い jobId UPDATE が遅れて到達し last-writer-wins で上書きする。R11-M15 と同根。
- **修正内容:** `UPDATE ... SET jobId=? WHERE id=? AND jobId IS NULL` に変更し、未設定行のみ更新する。
- **依存:** R11-C2-a。R11-M15 と統合。
- **検証:** worker 高速完了と後追い UPDATE の順序入れ替えテストで jobId が上書きされないこと。

### R11-C3. `forms-permissions.ts` の招待承諾ルートが `withDualFormAuth("VIEWER")` 配下にあり、承諾不可かつ重複エンドポイント
- **重要度:** 🔴 Critical（機能破綻 + 認可設計の二重化リスク）
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-c1-c5.md`）
- **対象:** `apps/api/src/routes/forms-permissions.ts:120,458-467`
- **問題:** ルーター先頭で `.use("/:id/invitations*", withDualFormAuth("VIEWER"))` を適用しているため、未参加ユーザーは `POST /:id/invitations/:token/accept` を絶対に通れない（VIEWER 以上を要求）。実質デッドルートだが、`/api/invites/:token/accept`（`forms-invites.ts:80-98`）と意味論が異なる二重エンドポイントが残っており、ガード更新時の認可ミスの温床になる。
- **修正内容:** `forms-permissions.ts` 側の招待承諾エンドポイントを削除し、`/invites/:token/accept` のみを正規ルートにする。少なくとも当該パスをミドルウェアの prefix から除外する。
- **依存:** なし。
- **検証:** 該当エンドポイント削除後に既存招待 UX（`forms-invites.ts` 経由）が通り、TanStack Router 側に dangling URL が無いことを確認。

### R11-C4. リポジトリに `.dockerignore` が存在せず、ビルドコンテキストへ `.env.local` などが流入する
- **重要度:** 🔴 Critical
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-c1-c5.md`）
- **対象:** `/.dockerignore`（不在）, `Dockerfile:26-33`, `Dockerfile.worker:29-35`, `Dockerfile.web:21-25`
- **問題:** `.dockerignore` が無いため、`COPY ./apps/api/ ./apps/api/` などディレクトリ丸ごとのコピーが `.env.local`・`.env*`・`node_modules`・`test-results/`・`playwright-report/`・`z/`・`.claude/`・`config/external-services.json` を Docker context へ送信する。`.env.local` を `.gitignore` していても `.dockerignore` は独立で自動連動しない。意図せず `COPY` で `.env.local` を取り込むと、`docker history` から API キー / MySQL / REDIS パスワードが漏洩する。
- **修正内容:** ルートに `.dockerignore` を作成し、最低限 `node_modules`, `**/node_modules`, `dist`, `**/dist`, `.env*`, `!.env.placeholder`, `.git`, `.github`, `.claude`, `.cursor`, `.turbo`, `**/.turbo`, `test-results`, `playwright-report`, `z`, `config/external-services.json*`, `*.tsbuildinfo`, `coverage` を除外。
- **依存:** なし。
- **検証:** `docker build --no-cache -f Dockerfile .` のコンテキスト転送サイズ縮小と、`docker run --rm <image> ls -la /app` に `.env.local` が無いこと。

### R11-C5. `use-autosave` の下書きキーが ref 初期化前に評価され、復元/削除が空キー側へ向き得る
- **重要度:** 🔴 Critical（影響は loadDraft の呼び出しタイミングに依存し、現状の経路では潜在的）
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-c1-c5.md`）
- **対象:** `apps/web/src/hooks/forms/use-autosave.ts:39-52,95-119`
- **問題:** `respondentUuidRef.current` は `useEffect` で初期化される一方、`loadDraft` / `clearDraft` の `useCallback` は同期的に生成され、`respondentUuidRef.current`（初期値 `""`）を参照する。マウント直後・SSR 環境・カスタムフック上書きで `loadDraft()` を初回レンダー時に呼ばれると、保存時の `cf:autosave:${formId}:${uuid}` と異なる `cf:autosave:${formId}:` キーを参照し、復元/削除が機能しない。
- **修正内容:** UUID 初期化を `useState` の lazy initializer に同期化するか、`generateKey` 内で「`respondentUuidRef.current` が空なら直接 localStorage から読み取る」フォールバックを追加。
- **依存:** なし。
- **検証:** マウント直後 `loadDraft()` を呼ぶフックテストで保存時キーと一致することを確認。

## Phase 1: 認可・スコープ High

### R11-H1. validation retry の jobId 永続化が worker の先行 PROCESSING 遷移で失われる（CAS チェーン 段階2、R10-H1 完了後に実施）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `apps/api/src/routes/forms-responses.ts:343-417,431-465`
- **問題:** retry は (1) preparedJobs に新 jobId 生成 → (2) BullMQ に `queue.add(...,{jobId})` → (3) `markValidationRetriesPending` で行を PENDING に戻し jobId 更新、の順だが、(2) と (3) の間に worker がジョブを掴み `markValidationProcessing` で PROCESSING へ遷移していると、(3) の `UPDATE` は `ne(status,'PROCESSING')` `ne(status,'PENDING')` の WHERE で 0 件となり新 jobId が反映されない。古い jobId を保持したまま BullMQ 上の新ジョブと紐付かず、後続 Cancel が古い jobId で discard できないファントムを生む（R10-H1 と複合で COMPLETED 上書きに直結）。
- **修正内容:** enqueue 前に CAS で PENDING + 新 jobId へ遷移できた行のみを enqueue 対象にする。`markValidationProcessing` 側も `eq(jobId, expectedJobId)` を WHERE に含め、ジョブ入れ替わりを検出可能にする。
- **依存:** R10-H1（段階1）完了後に実施。**R11-M14（段階3）より先に実施すること。**
- **検証:** worker が PROCESSING 直前で待機する fixture を用意し、retry API と競合させて行 jobId と BullMQ ジョブ ID が常に一致することを assert。

### R11-H2. `validateShareLinkRole` がデッドコード、EDITOR セッションが EDITOR 共有リンクトークンを無制限生成可能
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `apps/api/src/routes/forms-permissions.ts:379-407`, `apps/api/src/lib/forms/permission-service.ts:1126-1146`
- **問題:** `validateShareLinkRole` は定義のみでコードベース内に呼び出しが無い。`POST /:id/share-links` は `checkShareLinkPermission` のみ実行し、要求された share-link ロール（EDITOR/VIEWER）と作成者のフォーム上ロールを比較しない。Schema が EDITOR/VIEWER に限定されているため OWNER 化はできないが、EDITOR が `formShareLink` を量産しておけば、後で当該 EDITOR の `formPermission` が剥奪されても `apiToken.shareLinkId` 経由で編集権限を保持し続けられる（権限永続化バックドア）。
- **修正内容:** (1) 作成エンドポイントで `validateShareLinkRole(payload.role, userRole)` を呼ぶ。(2) `removePermission` / `cancelInvitation` 経路に「当該ユーザーが `createdBy` の `formShareLink` を `isActive=false` に倒す」フックを検討。
- **依存:** なし。
- **検証:** EDITOR が EDITOR 共有リンクを作成 → `formPermission` 剥奪 → 旧トークンで `PUT /:id/structure` が 403 になること。

### R11-H3. `external-service` がプラグイン例外メッセージを生レスポンスに含める（情報漏洩）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `apps/api/src/routes/external-service.ts:163-170`
- **問題:** プラグイン（providerRegistry）のハンドラ例外を `error.message` でそのままレスポンスへ返却。Discord/GitHub/Twitter ハンドラが内部 URL・rate-limit ヘッダ・Octokit エラー（非公開リポジトリ情報を含む可能性）・スタック由来文字列を含めた場合、認証済みユーザーへ漏洩する。`externalServiceFailureResponse` も `details` に `error.message` を直挿し。
- **修正内容:** 例外を `logError` した上で、レスポンスは `details: "External service error"` 等の一定文字列に正規化。デバッグ用 correlationId のみ返却し、運用ログで突合する。
- **依存:** なし。
- **検証:** プラグインから `throw new Error("secret-internal-url")` → API レスポンスに当該文字列が出ないこと。

### R11-H4. 統合作成時 `ownerUserId` を auth context から代入しており、譲渡レースで旧 OWNER が固定される
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `apps/api/src/routes/forms-integrations.ts:88-106`, `apps/api/src/lib/forms/form-integration-service.ts`
- **問題:** `upsertFormIntegration` に `ownerUserId: auth.user_id` を渡している。`api_token` の OWNER 判定は `formRecord.creatorId === context.user_id` で行われるため、`transferOwnership` 中で `creatorId` 更新が完了する前に旧 OWNER が `upsertFormIntegration` を叩くと、譲渡後も `ownerUserId` 上で旧 OWNER の Google Drive 連携を保持し続けられる（連携面の権限委譲が不完全）。
- **修正内容:** `ownerUserId` をクライアント由来の `auth.user_id` ではなく、`form.creatorId` を DB から再取得して代入する。または `transferOwnership` の tx 内で同形態の整合性更新を行う。
- **依存:** なし。
- **検証:** `transferOwnership` 直前に `upsertFormIntegration` を発火させる競合統合テストで、`ownerUserId` が新 OWNER になること。

### R11-H5. `cancelInvitation` がサービス層で招待者の現フォーム権限を再確認しない
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `apps/api/src/lib/forms/permission-service.ts:869-913`
- **問題:** `invitation.invitedBy === userId` 一致のみでキャンセル可能。ルート側 `withDualFormAuth("VIEWER")` で守られているが、招待者がすでに剥奪されている場合のサービス層保護が無く、今後ルートの権限要件が緩む or 内部呼び出しが追加されると脆弱化しやすい。
- **修正内容:** `cancelInvitation` 内でも招待者の現フォーム権限を `getUserFormPermission` で再確認する、または「OWNER のみキャンセル可能」に統一。
- **依存:** なし。
- **検証:** EDITOR の `formPermission` を直接 DELETE → 旧 EDITOR が `cancelInvitation` を呼んだら 403 になること。

## Phase 2: Web UX / 状態整合性 High

### R11-H6. 未ログインで保護ルートを開いた利用者がログイン後にトップへ強制送還される（コンテキスト喪失）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `apps/web/src/lib/require-auth.ts:12-22`, `apps/web/src/routes/_authenticated/route.tsx:11-14`, `apps/web/src/components/auth/signin-page.tsx:11-14`, `apps/web/src/hooks/auth/use-auth.ts:9`
- **問題:** `requireAuth` は `redirect({ to: "/login" })` のみで元 URL を `redirect`/`next` 等の search に残さない。better-auth の `callbackURL: "/"` がハードコードされ、`SignInPage` も成功時に `/` 遷移するため、`/forms/$id/edit` のような URL を未ログインで開いた利用者は必ずトップへ落ちる。リンク共有 / 招待 / ディープリンクの UX が成立しない。
- **修正内容:** `requireAuth` で `redirect({ to: "/login", search: { redirect: location.href } })` を投げる。`/login` 側は `validateSearch` で `redirect` を検証（外部 URL / `javascript:` を拒否しオープンリダイレクト防止）し、better-auth の `callbackURL` も同 search から動的に組み立てる。
- **依存:** なし。
- **検証:** 未ログインで `/forms/$id/edit?tab=responses` 開く → ログイン後にそのページへ戻ること。外部 URL は拒否されること。

### R11-H7. `version-history` がクエリエラーを空状態化、かつ `as string | Date` キャストでルール違反
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `apps/web/src/components/forms/version-history.tsx:75-91`
- **問題:** (1) `snapshotsQuery.isError` を扱わずエラー時に「履歴は空」表示にすり替わる。(2) `publishedAt: s.publishedAt as string | Date` の `as` 強制（`as` 最小化ルール違反）。`SnapshotGraph` 側の型と整合させるためだけの妥協。
- **修正内容:** `isError` 分岐で `<ErrorState />` を返す。`SnapshotGraph` の `publishedAt` 型を `string`（API は ISO 文字列）に揃え、`snapshot-save-dialog.tsx` 等の入力も統一する。
- **依存:** なし。
- **検証:** ネットワークエラー mock で「履歴を読み込めません」が出ること。`pnpm type-check` 通過。

### R11-H8. `ShareLinkManager` / `ScheduleManager` / `FormResponsesPage` の query エラーが空状態に化ける
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（R10-M3 等と統合済み、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `apps/web/src/components/forms/share-link-manager.tsx:46-51,98-103`, `apps/web/src/components/forms/schedule-manager.tsx:303`
- **問題:** R10-M3 と同方向の問題が他コンポーネントにも残存。`isError` 未処理で `data ?? []` のフォールバック表示が「データなし」を装う。`share-link-manager.tsx:46-51` の `handleCopy` は失敗時にトースト無しで無音失敗。
- **修正内容:** 各 query で `isError` 分岐 + retry ボタン。`handleCopy` は失敗 toast と手動コピー UI（R10-M2 と統合）。
- **依存:** R10-M2 / R10-M3 の修正と統合可能。
- **検証:** 各エンドポイントを 500 で返した時にエラー UI が表示され、空メッセージが出ないこと。

### R11-H9. `useShareLinks` / `useSnapshots` などで `formId as string` キャストが横行
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `apps/web/src/hooks/forms/use-share-links.ts:44-54`, `apps/web/src/hooks/forms/use-snapshots.ts:34,43,54`, `apps/web/src/components/forms/schedule-manager.tsx:283,304`
- **問題:** `enabled: Boolean(formId)` で実行抑制しているが `queryFn` 内で `formId as string` を強制している。プロジェクトの「`as` 最小化」ルール違反。enabled の取り扱いミスがあれば `"undefined"` を URL に埋め込む。`schedule-manager` 側 `as ScheduleEntry[]` / `as Snapshot[]` も同様で、Hono RPC の型推論を無効化している。
- **修正内容:** TanStack Query v5 の `skipToken` を `queryFn` に使うか、フック引数で `formId: string` を必須化する型ガードを噛ませる。`schedule-manager` のローカル型は `InferResponseType` か `@nexus-form/shared` 由来へ。
- **依存:** なし。
- **検証:** `pnpm type-check` 通過。`as` キャスト件数の削減確認。

### R11-H10. `google-sheets-integration` の sync 監視で completed/failed を二重 dispatch する経路（`useGoogleSheetsSync` 抽出 段階1）
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `apps/web/src/components/forms/google-sheets-integration.tsx:316-376`
- **問題:** `useEffect([syncJobData, activeJobId])` 内で reducer dispatch と `toast.success/error` を実行している。`syncJobData` がキャッシュに残っている状態で `activeJobId` 解除前に他要因の再レンダーが入ると `completed` を二重通知できる。さらに `refetchInterval` で来た同一進捗の `syncJobData` でも常に `update` dispatch が走り、新オブジェクト参照で無駄な再レンダーが発生。timeout タイマーが `syncJobError` パスで `clear` するとき `useQuery({ enabled })` 終了の隙にキャッシュ削除が走らない。
- **修正内容:** reducer + status query + timeout + toast を `useGoogleSheetsSync` フックに抽出しつつ、(1) `useRef<UiSyncStatus | null>` で「最後に通知したステータス」を保持し completed/failed への遷移を差分検出。(2) `update` も進捗差分があるときだけ発火。(3) job 終了時に `queryClient.removeQueries({ queryKey: ["syncJobStatus", formId, activeJobId] })` を明示呼び出し。
- **依存:** なし。**R11-M8（段階2）より先に実施すること。**
- **検証:** DevTools 風のアクションログで completed が 1 回のみ発火することを確認。

## Phase 3: Worker / 外部境界 High

### R11-H11. Twitter axios baseURL が `process.env.TWITTER_BASE_URL` を無検証で受け、内部ホストへ送信し得る
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `packages/validation-provider-twitter/src/client.ts:56-63`, `packages/validation-provider-twitter/src/config.ts:15-33`
- **問題:** `baseURL = ${baseUrl}/${apiVersion}` を URL 妥当性検証・allow-list 無しで受ける。本番で `TWITTER_BASE_URL` を誤設定すると任意ホストへ送信される（SSRF 起点）。さらに `isValidTwitterUsername` 失敗時の `throw new Error()` は `parseTwitterError` で `TWITTER_API_ERROR`（retryable:false）に化け、本来は `INPUT_VALIDATION_ERROR` で扱うべき分類が崩れる。
- **修正内容:** `TWITTER_BASE_URL` を `z.string().url()` + ホスト allow-list（既定 `api.twitter.com`）で起動時検証し、不一致は起動失敗にする。`isValidTwitterUsername` 検査は `inputSchema.parse` 段で一本化し、`plugin.ts` の `validate()` 内で client error をそのまま再 throw する。
- **依存:** なし。
- **検証:** 不正 `TWITTER_BASE_URL` で起動失敗を確認。allow-list 外ホスト経由のリクエストが発生しないこと。

### R11-H12. GitHub `getUserByUsername` の Octokit レスポンスを Zod で検証せず `null` フィールドで metadata 欠落
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `packages/validation-provider-github/src/client.ts:85-101`
- **問題:** Octokit の TS 型に依存し `data.login` / `data.created_at` 等を未検証で読む。組織アカウントで `created_at: null` の場合、`metadataSchema.parse` が失敗 → `validatedMetadata = undefined` → DB に `isValid: true` だが metadata 欠落の行が書かれ、フォーム表示で profile/avatar が抜ける。
- **修正内容:** `getUserByUsername` 内で `GitHubApiUserSchema` で `data` を `parse` してから `GitHubUserInfo` を組む。`createdAt/updatedAt` は `.nullable()` にして `metadataSchema` も追従。
- **依存:** なし。
- **検証:** Octokit mock で `created_at: null` のケースで metadata が欠落しないこと。

### R11-H13. `sheets-sync` の pending 冪等性 TTL とロック TTL が逆転、クラッシュ復帰で重複行
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `apps/worker/src/handlers/sheets-sync.ts:37-38,287-293,339`
- **問題:** `PENDING_IDEMPOTENCY_TTL_SECONDS = 90` だが `withRedisLock(..., { ttlMs: 60_000 })` で 60 s 後にロックが先に失効。appendRows 直前直後にプロセスが落ち、Sheets の eventual consistency 待ち（数秒）と相まって `readSheetForIdempotency` が false negative を返すと、再試行で重複行が書かれる。
- **修正内容:** appendRows 直後に `done` を即座にマーク or `pending` 検出時は throw ではなく `DelayedError` / `moveToDelayed` で十分長い遅延（>120 s）を入れて再試行。さらに `spreadsheetId` + `responseId` のセルマーカーで append 前に再度 readRange による存在確認を行う。
- **依存:** なし。
- **検証:** appendRows 後 / done 前にプロセスを強制終了する統合テスト → 再試行で行が重複しないこと。

### R11-H14. `sheets-sync` の `userId` が `integration.userId ?? integration.ownerUserId` で別ユーザートークン使用リスク
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `apps/worker/src/handlers/sheets-sync.ts:112-120`
- **問題:** `integration.userId` が null の時 `ownerUserId` を使う設計だが、フォーム所有者が譲渡された後に旧所有者の OAuth トークンで新所有者のスプレッドシートに書き込みが行われる構造。連携面の権限委譲が破綻し、情報漏えいや「権限を持たないシートへの書き込み」となる。
- **修正内容:** `userId` を必須化（DB 制約 + schema 強制）、フォールバックを削除。譲渡時は integration を再連携する UX へ。
- **依存:** R11-H4 と関連。
- **検証:** `userId is null` の integration で同期ジョブが明示的に失敗すること。

## Phase 4: インフラ・CI High

### R11-H15. Dockerfile.web が nginx を root のまま起動している
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #292、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `Dockerfile.web:33-53`
- **問題:** `FROM nginx:alpine` は master を root で起動する。コンテナ脱出時の被害が大きい。
- **修正内容:** ベースを `nginxinc/nginx-unprivileged:alpine` に変更し、`/etc/nginx/conf.d/default.conf` の listen ポートを 8080 等の unprivileged port に揃え、k8s / compose 側のポートマップを更新。
- **依存:** なし。
- **検証:** `docker run --rm <image> id` が `uid=101(nginx)` を返すこと。

### R11-H16. Dockerfile (API) の COPY が `--chown=node:node` 不徹底で `node_modules` が root 所有
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #293、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `Dockerfile:51-66`
- **問題:** Worker は全 COPY に `--chown=node:node` を付与しているが、API では `package.json` 群と `node_modules` が root 所有のままで `USER node` に切り替わる。pnpm lifecycle / 一部 SDK のキャッシュ書き出しが失敗しうる。
- **修正内容:** `COPY --from=deps ... --chown=node:node` を全行に付与、もしくは最後に `RUN chown -R node:node /app` を入れる。
- **依存:** なし。
- **検証:** `docker run --rm -u node <image> ls -la /app/node_modules | head` の owner が `node node` であること。

### R11-H17-a. CI test ジョブに MySQL/Redis services を追加
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #294、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `.github/workflows/ci.yml:80-120`
- **問題:** test ジョブに DB/Redis サービスコンテナが無く、drizzle 関連の integration テストが実質スキップ / mock 依存になっており `drizzle/*.sql` の妥当性検証が CI で行われない。
- **修正内容:** `services: { mysql, redis }` を test ジョブに追加し、`DATABASE_URL`/`REDIS_URL` を注入して `pnpm db:migrate` → `pnpm test` の順で実行。
- **依存:** なし。**R11-H17-b・R11-H17-c と同一 PR にまとめてよい。**
- **検証:** CI で `drizzle/*.sql` を壊した PR が落ちること。

### R11-H17-b. CI build ジョブから不要 secret を除去
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #294、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `.github/workflows/ci.yml:121-153`
- **問題:** build ジョブが `AUTH_SECRET` / `DISCORD_CLIENT_*` / `SIGNUP_INVITATION_CODE` を受け取っているが、Vite の `VITE_*` 以外はバンドルに埋め込まれない。fork PR で `secrets` が null になり「動くはずなのに動かない」事故の温床。
- **修正内容:** build ジョブから `VITE_*` 以外の secret を削除する。
- **依存:** なし。R11-H17-a と同一 PR にまとめてよい。
- **検証:** fork PR の build が失敗しないこと。

### R11-H17-c. CI 各 job に最小 `permissions:` を明示
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #294、`docs/task-verification/r11-h1-h17.md`）
- **対象:** `.github/workflows/ci.yml`
- **問題:** 各 job に最小 `permissions:` が無く `read-all` 既定に依存している。
- **修正内容:** 全 job に `permissions: { contents: read }` を追加し `read-all` 既定への依存を排除。
- **依存:** なし。R11-H17-a・R11-H17-b と同一 PR にまとめてよい。
- **検証:** `pnpm lint:fix`, `pnpm type-check`, `pnpm test --silent` が通過し、CI の permissions が最小化されること。

## Phase 5: Medium

### R11-M1. `_authenticated` 配下の `beforeLoad` が `getSession()` を毎ホバーで叩き 5xx をログインリダイレクト扱いする
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（`docs/task-verification/r11-m1-m22.md`）
- **対象:** `apps/web/src/router.tsx:4-8`, `apps/web/src/lib/require-auth.ts:12-22`
- **問題:** `defaultPreload: "intent"` でホバー毎に `_authenticated/*` の `beforeLoad` が走り、その都度 `authClient.getSession()` がネットワーク往復する。`try/catch` で全エラーを `/login` リダイレクト化しているため API 一時障害（5xx）でもログイン画面に飛ぶ。
- **修正内容:** `queryClient.ensureQueryData({ queryKey: ["session"], staleTime: 60_000 })` でキャッシュ、`beforeLoad` でも同キーを参照。`status !== 401` は再スローしルートエラーへ。
- **依存:** R11-H6 と統合可。
- **検証:** 未ログインでサイドバーホバーで `getSession` 1 回に集約。API を 503 にして `/forms/$id/edit` 開く → ログインではなくエラー画面。

### R11-M2. `editor` ルートの `validateSearch` が `tab` を素通しで無効値を許容
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（`docs/task-verification/r11-m1-m22.md`）
- **対象:** `apps/web/src/routes/_authenticated/forms/$id/edit.tsx:6-11`, `apps/web/src/components/forms/form-editor-page.tsx:332-340`
- **問題:** `validateSearch` は `typeof tab === "string"` チェックのみで、`isEditorTab` での絞り込みは component 側 effect 任せ。`?tab=__proto__` 等の不正値が一旦 component に到達してから replace される。
- **修正内容:** `editorTabSchema = z.enum([...]).optional()` を `@nexus-form/shared` に置き、`validateSearch` で `parse` する。
- **依存:** なし。
- **検証:** `?tab=foo` で route 側が `editor` に倒し、component の useEffect リダイレクトが不要になること。

### R11-M3. 招待 / 共有フォーム取得が `staleTime: Infinity` で revoke / 期限切れを反映しない
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（`docs/task-verification/r11-m1-m22.md`）
- **対象:** `apps/web/src/components/forms/shared-form-page.tsx:13`, `apps/web/src/components/forms/invite-acceptance-page.tsx:18`
- **問題:** トークン状態は API 側で revoke / expiry / role 変更がありうる動的データ。タブを開きっぱなしにすると revoke 後も「フォーム編集ページへ」が表示され続ける。
- **修正内容:** `staleTime` を 30s〜2min、`refetchOnWindowFocus: true`、accept mutation 後に `invalidateQueries`。
- **依存:** なし。
- **検証:** 別タブで revoke → フォーカス復帰時に 404 / 失効画面へ切替わること。

### R11-M4. `RpcError` のメッセージをトーストへ直出し、サーバ内部情報の漏洩リスク
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（`docs/task-verification/r11-m1-m22.md`）
- **対象:** `apps/web/src/lib/api.ts:60-69`, `apps/web/src/components/forms/form-editor-page.tsx:272,291,306-321`
- **問題:** `rpc()` は `errorJson?.error ?? errorJson?.message ?? "HTTP ${status}"` を message に詰め、各所で `err.message` をそのままトーストに渡す。API 側に SQL 由来 / スタック由来のメッセージが混入した場合、ユーザに露出する。
- **修正内容:** API のエラースキーマを `{ code: string; userMessage?: string }`（`@nexus-form/shared`）に固定。フロントは `code` で i18n を引き、`userMessage` をフォールバックとして使う。`RpcError` は `code` / `userMessage` を保持する形へ。
- **依存:** R11-H3 と方向性を揃える。
- **検証:** API を 500 にして編集ページのアーカイブ実行 → トーストに stack trace が出ないこと。

### R11-M5. `formContent` クエリキーが draft / preview / snapshot で同一になり cross-scope invalidate のリスク
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（`docs/task-verification/r11-m1-m22.md`）
- **対象:** `apps/web/src/components/forms/form-preview-page.tsx:31-38`, `apps/web/src/components/forms/form-editor-page.tsx:209-220`
- **問題:** `["formContent", id]` が編集ページと公開プレビューで共有されており、preview 側が `latest` 表示時に editor 側 mutation の invalidate を直接受ける。今後 draft / preview スナップショットの取り扱いを差別化したときに data drift を起こす。
- **修正内容:** key を `["formContent", scope, id, version?]` 形式へ統一。invalidate も scope 指定で行う。
- **依存:** なし。
- **検証:** preview を開いたまま editor 保存 → preview の latest 表示が同期、スナップショット側は触られないこと。

### R11-M6. SSE フックの `consecutiveErrors` がリトライ毎に 0 リセットされ、永久リトライになる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-m1-m22.md`）
- **対象:** `apps/web/src/hooks/forms/use-validation-sse.ts:56`, `apps/web/src/hooks/forms/use-editor-sse.ts:87`
- **問題:** `let consecutiveErrors = 0` が `connect()` 内ローカル変数のため `scheduleReconnect()` で再接続するたび 0 から数え直す。`MAX_CONSECUTIVE_SSE_ERRORS` の意味が失われ、サーバ恒久落ちで 30 秒間隔の永久リトライになる。
- **修正内容:** `consecutiveErrors` を `useEffect` スコープ or `useRef` に外し、上限到達で停止 + toast 表示。
- **依存:** なし。
- **検証:** API を停止 → 上限到達後に停止し再読み込み案内が出ること。

### R11-M7. `response-export` の `revokeObjectURL` が `click()` 直後に呼ばれ Safari/iOS で失敗し得る
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-m1-m22.md`）
- **対象:** `apps/web/src/components/forms/response-export.tsx:25-32`
- **問題:** Blob URL を anchor `click()` 直後に同期 revoke。多くのブラウザで動作するが Safari / iOS の一部でダウンロード開始前に URL が無効化される。
- **修正内容:** `setTimeout(() => URL.revokeObjectURL(url), 0)` または `requestAnimationFrame` 経由で revoke。
- **依存:** なし。
- **検証:** Safari / iOS でダウンロード成功確認。

### R11-M8. `google-sheets-integration.tsx` の `useGoogleOAuth` 抽出（段階2、R11-H10 完了後に実施）
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #305、`use-google-oauth.ts` + `use-google-oauth.test.tsx`）
- **対象:** `apps/web/src/components/forms/google-sheets-integration/use-google-sheets-integration-model.ts`, `use-google-oauth.ts`
- **問題:** 983 行・useReducer 2 つ・useQuery 4 つ・useCallback 多数。R11-H10（段階1）で `useGoogleSheetsSync` を抽出した後も OAuth popup 管理ロジックが本体に残りファイルが大きすぎる。
- **修正内容:** OAuth ポップアップ開閉・message イベントリスナー・token refresh 周りを `useGoogleOAuth` フックに抽出し、本体ファイルを 400 行以下に収める。
- **依存:** R11-H10（段階1）完了後に実施。
- **検証:** `use-google-oauth.test.tsx`（popup / blocked / success・error postMessage）。モデルは約 530 行、`google-sheets-integration.tsx` は薄いラッパー構成。

### R11-M9. Discord `BigInt(guild.permissions)` が任意文字列で例外を投げる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（`docs/task-verification/r11-m1-m22.md`）
- **対象:** `packages/validation-provider-discord/src/plugin.ts:462,492-495`
- **問題:** `DiscordUserGuildSchema` は `permissions: z.string()` のみで数値文字列を保証していない。`BigInt("foo")` は `SyntaxError` を投げ `fetchUserGuilds`→`adminGuilds.filter()` から `apiHandlers.guilds` 全体が 500 になる。R10-H4 と同根だが Discord 側経路として未対応分。
- **修正内容:** `permissions` を `z.string().regex(/^\d+$/)` に絞る、または `tryBigInt(value)` ヘルパーで安全変換し parse 失敗 guild は管理権限なし扱い。
- **依存:** R10-H4 と統合。
- **検証:** 不正 `permissions` を含む mock で guilds API が空配列を返すこと。

### R11-M10. Discord `searchGuildMembers` の prefix 検索が limit 25 で false negative を生み得る
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #300、`findGuildMemberByUsername` で search limit=1000 + list members ページネーション）
- **対象:** `packages/validation-provider-discord/src/plugin.ts:314-321`
- **問題:** `searchGuildMembers(token, parsedGuildId, username, 25)` は Discord の prefix 検索。同接頭辞ユーザが 25 人を超えると対象が漏れる。
- **修正内容:** limit を上げる or pagination フォールバックを追加 / `query_type=exact` 利用検討。
- **依存:** なし。
- **検証:** 同接頭辞ユーザを 26+ 持つ guild で正しいユーザが取得できること。

### R11-M11. `withRedisLock` の retry sleep が abort 不能で graceful shutdown を遅延させる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #299、`withRedisLock` が `AbortSignal` を受け取り worker shutdown で中断可能）
- **対象:** `apps/worker/src/lib/redis-lock.ts:122-135`
- **問題:** `new Promise((resolve) => setTimeout(resolve, retryDelayMs))` が abort 不能で `waitTimeoutMs`（Discord で 125 s）まで shutdown が遅延し、`graceful-shutdown.ts:timeoutMs:30_000` を超えると強制 kill → ジョブ再試行。
- **修正内容:** `withRedisLock` に `AbortSignal` を受け取らせ、shutdown 時にロック取得待ちを中断可能にする。
- **依存:** なし。
- **検証:** worker を SIGTERM → 待機中ジョブが即座にエラー化し再試行されること。

### R11-M12. `sheets-sync` のヘッダー名衝突で同タイトル質問の値が上書きされる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-m1-m22.md`）
- **対象:** `apps/worker/src/handlers/sheets-sync.ts:402-414`
- **問題:** 2 つの異なる `blockId` が同一 `title` を持つと `headers.indexOf(title)` で同カラムへ書き込まれ後者が前者を破壊する。
- **修正内容:** タイトル衝突時に `title (blockId 末尾4桁)` のサフィックスを付ける、あるいは `blockId` をヘッダー名に使う運用へ。
- **依存:** なし。
- **検証:** 同タイトル質問を 2 つ持つフォームで両カラムが独立保存されること。

### R11-M13. `oauth-token-store.refreshTokenIfNeeded` で scope フォールバックが `latest.scopes` を捨てる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（`docs/task-verification/r11-m1-m22.md`）
- **対象:** `apps/worker/src/lib/oauth-token-store.ts:174-199`
- **問題:** refresh 応答に `scope` が無い場合 `scopes = token.scopes` で古い引数 `token.scopes` を維持し、`latest.scopes` を捨てる。
- **修正内容:** `performTokenRefresh` の `scope` フォールバックを `currentToken.scopes` 経由に揃え、命名を `currentToken` にして `...currentToken, ...` で構築。
- **依存:** なし。
- **検証:** scope 変更なし refresh で保存 scopes が `latest.scopes` と一致すること。

### R11-M14. `discardQueuedValidationJob` の discard → getState → remove が active 遷移と競合（CAS チェーン 段階3、R10-H1・R11-H1 完了後に実施）
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-m1-m22.md`）
- **対象:** `apps/api/src/routes/forms-responses.ts:467-511`
- **問題:** `job.discard()` 後の `getState()` で `"waiting"|"delayed"` のみ remove するロジックだが、discard と getState の間でジョブが active へ移ると remove されず処理は走り続ける。R10-H1 / R11-H1 の CAS 化と組み合わせて初めて整合する。
- **修正内容:** R10-H1 を入れた上で、active 検出時は呼び出し側で「キャンセル不可・既に処理中」を 409 にする API 変更を検討。
- **依存:** R10-H1（段階1）、R11-H1（段階2）完了後に実施。
- **検証:** ジョブを掴ませた直後の Cancel が 409 を返し、最終結果が破壊されないこと。

### R11-M15. `forms-public.ts` の jobId 後追い UPDATE が状態保護なし
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-m1-m22.md`）
- **対象:** `apps/api/src/routes/forms-public.ts:960-963`
- **問題:** 初回 enqueue 経路でも enqueue 後に `UPDATE externalServiceValidationResult SET jobId=? WHERE id=?` を発行。worker が既に完了し新 jobId を書いた後にこの古い jobId UPDATE が遅れて到達し last-writer-wins で上書きする可能性。
- **修正内容:** `AND jobId IS NULL` を WHERE に付け、未設定行のみ更新。
- **依存:** R11-C2。
- **検証:** worker 高速完了と後追い UPDATE の順序入れ替えテスト。

### R11-M16. `RedisChannelFormIdSchema` の長さ上限と `form.id` 定義が食い違う
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r11-m1-m22.md`）
- **対象:** `packages/shared/src/sse-events.ts:50-58`, `packages/database/src/schema.ts:121`
- **問題:** `^[a-zA-Z0-9_-]{1,64}$` だが `form.id` は `varchar(128)` で最大 128 文字。65〜128 字の id を採用すると SSE チャネル発行で throw する。
- **修正内容:** 共有定数化し `{1,128}` へ揃える。
- **依存:** なし。
- **検証:** 128 字 `formId` で `getValidationChannel` が throw しないユニットテスト。

### R11-M17. `SystemSetting.value` (`json`) に対応する Zod スキーマが無く mass-assignment リスク
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #301、`packages/shared/src/system-settings.ts`、read/write 分離）
- **対象:** `packages/database/src/schema.ts:762-772`
- **問題:** `key/value` で永続化する任意 JSON に対し、`packages/shared` 配下に検証スキーマが無い。`UPDATE` 経路で `value` をそのまま渡すと攻撃者が schema を破壊しうる。型情報も `unknown`。
- **修正内容:** `packages/shared/src/system-settings.ts` を新設し、`key` ごとの discriminated union を Zod で表現。API / Worker は読み書き時にこのスキーマを通す。`apiTokenFormIdsSchema` にも `.max(64)` 程度の上限を追加。
- **依存:** なし。
- **検証:** 未知 `key` への書き込みが 400 になること。

### R11-M18. `FormResponse.respondentUuid` がグローバル `unique()` で複数フォーム回答時に衝突する
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #304、グローバル `unique()` 削除 + migration `0009`、`FormResponse_formId_respondentUuid_idx` 維持）
- **対象:** `packages/database/src/schema.ts:389-391,608-616`
- **問題:** `respondentUuid` が `varchar(255).notNull().unique()` のグローバル一意で、別に複合 unique `FormResponse_formId_respondentUuid_idx` も存在。同一回答者が複数フォームに回答するユースケースで衝突する設計か、意図的に「全フォーム横断で一意」かが不明確で危険。`FormSession.lastSeenAt` も `timestamp()` 秒精度で更新衝突を生みやすい。
- **修正内容:** 真の意図が「フォーム内一意」なら `unique()` を外し複合 unique のみ残す。「外部公開セッション ID」なら明文化する。`lastSeenAt` は `datetime({ fsp: 3 })` 化を検討。
- **依存:** なし。
- **検証:** 複数フォームへの同一 `respondentUuid` 回答テストを通す。

### R11-M19. `turbo.json` の各タスクが `inputs`/`outputs` を持たず、`db:generate` の生成物が cache 対象外
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（`docs/task-verification/r11-m1-m22.md`、`db:generate` の turbo inputs/outputs）
- **対象:** `turbo.json:3-34`
- **問題:** `inputs` 未指定でデフォルト「Git 管理下の全ファイル」をハッシュ化、`db:generate` は `cache: false` で `drizzle/**` を outputs に登録していないため副作用検出ができない。
- **修正内容:** `db:generate` に `outputs: ["drizzle/**"]` を追加し `cache: true` 化。`build` 等は `inputs: ["src/**", "package.json", "tsconfig*.json", "../../tsconfig.json"]` を明示。
- **依存:** なし。
- **検証:** `pnpm db:generate` の 2 回目がキャッシュヒット。

### R11-M20. ルート `tsconfig.json` に paths が無く、各 app/package で alias がドリフト
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #303、ルート `tsconfig.json` の `@nexus-form/*` paths + `tsconfig-paths-invariant.test.ts`）
- **対象:** `tsconfig.json:1-18`
- **問題:** ルートに `paths` 無し。Web のみ独自 alias、API/Worker でも `@nexus-form/*` を解決するが、ルートから見えない。Vitest と tsc でモジュール解決が割れるリスク。
- **修正内容:** ルートに `"baseUrl": "."` と最低限の `paths`（`@nexus-form/*`）を `references` ベースで一元定義、または各 sub-tsconfig 継承を README 化。
- **依存:** なし。
- **検証:** `pnpm -r exec tsc --showConfig | grep paths` の一貫性確認。

### R11-M21. `docker-compose.yml` の MySQL/Redis にヘルスチェック無し、`depends_on` の healthy 待ちが効かない
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（`docs/task-verification/r11-m1-m22.md`、MySQL/Redis `healthcheck` + `service_healthy`）
- **対象:** `docker-compose.yml:2-43`
- **問題:** 現状コメントアウト中の `api`/`worker` を有効化した際、`depends_on: [mysql, redis]` が「container started」までしか待たず初回マイグレーションが空 DB に当たって失敗しうる。
- **修正内容:** 各サービスに `healthcheck`（`mysqladmin ping` / `redis-cli ping`）を追加し、`depends_on` を `condition: service_healthy` 形式に変更。
- **依存:** なし。
- **検証:** `docker compose up` 直後に API がリトライなしでマイグレーション成功すること。

### R11-M22. Lefthook + CI の二段ガードが `db:migrate` 差分を検出できない
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（CI `db:migrate` は PR #294、lefthook `db:schema:check-staged` は `docs/task-verification/r11-m1-m22.md`）
- **対象:** `lefthook.yml:18-26`, `.github/workflows/ci.yml`
- **問題:** CI も lefthook も lint/type-check/test を回すが、DB 不要なテストしか実行されていないので「ローカルでは緑、本番マイグレーションが壊れる」を発覚できない。
- **修正内容:** CI に `db:migrate` ジョブを新設し required 化。lefthook では schema 編集時に `pnpm db:generate --check` 相当（meta スナップショットと SQL の不整合検出）を走らせる。
- **依存:** R11-H17。
- **検証:** schema を編集して `drizzle/meta/_journal.json` 更新を忘れた PR が落ちること。

## Phase 6: Low

### R11-L1. `form-responses-page` がエラー時にも前ページの list を残す
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（`docs/task-verification/r11-l1-l11.md`）
- **対象:** `apps/web/src/components/forms/form-responses-page.tsx:111-219`
- **問題:** `placeholderData: keepPreviousData` 使用時、`isError` 時にエラー文言と並んで前ページ list が残り、stale 行に対する操作が誤発火しうる。
- **修正内容:** `isError` 時は data を表示しない、または page move ボタンを `isError` でも disabled。
- **検証:** エラー後に行アクションが実行できないこと。

### R11-L2. `schedule-manager` の全件取得ループが abort 不能
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（`docs/task-verification/r11-l1-l11.md`、`fetchAllSchedules` が AbortSignal 対応）
- **対象:** `apps/web/src/components/forms/schedule-manager.tsx:269-289`
- **問題:** `fetchAllSchedules` で全ページ順次取得するが `AbortSignal` 未対応のため `formId` を素早く切り替えると古い fetcher が動き続ける。
- **修正内容:** `queryFn` に `signal` を渡してループ内の fetch にも転送、または server に全件取得エンドポイントを用意。
- **検証:** formId 切り替えで旧 fetcher が `signal.aborted` で停止すること。

### R11-L3. Twitter `parseTwitterError` の `retryAfter` が NaN 化する経路
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（`docs/task-verification/r11-l1-l11.md`）
- **対象:** `packages/validation-provider-twitter/src/utils.ts:46-65`, `apps/worker/src/lib/generic-validation.ts`
- **問題:** `retryAfterHeader` が非数値文字列だと `NaN`。`Number.isFinite` で弾く前段で `retryAfterSeconds` 変数自体が `NaN` 化、`generic-validation.ts` 側でも `Math.ceil(NaN) * 1000` が `NaN` になり `moveToDelayed(NaN)` で即時再試行ループになりうる。
- **修正内容:** 最終決定箇所で `Number.isFinite(...) && ... > 0 ? ... : undefined` を強制。worker 側でも `retryAfter` を `Number.isFinite` 防御。
- **検証:** `retry-after: "abc"` mock で ExponentialBackoff のみで再試行されること。

### R11-L4. 各 `_authenticated` ルートに `errorComponent` が無く、全画面が `RootErrorPage` で置き換わる
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（`docs/task-verification/r11-l1-l11.md`、scoped `errorComponent`）
- **対象:** `apps/web/src/routes/_authenticated/route.tsx:11-14`, `apps/web/src/routes/_authenticated/forms/$id/edit.tsx`, `apps/web/src/routes/forms/public/$publicId.tsx`
- **問題:** TanStack Router の `errorComponent` を `__root` のみが持つため、`_authenticated` レイアウト内の例外で Navigation / Footer も消える。
- **修正内容:** `_authenticated/route.tsx` と公開ルートに `errorComponent` を追加し `<Outlet />` 部分のみ差し替え。
- **検証:** 編集ページで一時 throw → Navigation/Footer は残り、コンテンツ領域のみエラー UI。

### R11-L5. `_authenticated/forms/$id/responses.tsx` の `beforeLoad` リダイレクトが他 search を落とす
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（`docs/task-verification/r11-l1-l11.md`、既存 search を spread して保持）
- **対象:** `apps/web/src/routes/_authenticated/forms/$id/responses.tsx:4-10`
- **問題:** `redirect({ ..., search: { tab: "responses" } })` でハードコードしているため、将来のフィルタ URL（`?tab=responses&keyword=foo` 等）が消える。
- **修正内容:** `({ params, search }) => redirect({ ..., search: { ...search, tab: "responses" } })` で既存 search を伝播。
- **検証:** 既存 search が保持されること。

### R11-L6. `biome.json` の UI 除外 glob が 1 階層しかカバーしない
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（`docs/task-verification/r11-l1-l11.md`、`!apps/web/src/components/ui/**`）
- **対象:** `biome.json:18`
- **問題:** `!apps/web/src/components/ui/*` は直下のみで、`ui/data-table/*` 等のサブディレクトリはカバーされない。
- **修正内容:** `"!apps/web/src/components/ui/**"` に変更。
- **検証:** `pnpm lint` で誤検知が出ないこと。

### R11-L7. `withDualFormAuth` の scope フォールバックが OPTIONS/HEAD で抜ける
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（`docs/task-verification/r11-l1-l11.md`、OPTIONS/HEAD の scope 挙動をドキュメント化）
- **対象:** `apps/api/src/lib/dual-auth.ts:97-113,789`
- **問題:** `deriveFormAuthScopes` が `requiredScopes=[]` 時に非 GET メソッドへ `["write"]` を自動付与するが、OPTIONS/HEAD はスコープ未要求のまま。当該メソッドで副作用ハンドラを書かない運用を README 化すべき。
- **修正内容:** `deriveFormAuthScopes` のフォールバックを呼び出し側必須にする型変更、または README に明文化。
- **検証:** OPTIONS/HEAD で副作用ハンドラを実装していないことを grep 監査。

### R11-L8. `/api/external-service` で `formId` 省略時の認可ゲートなし
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（R10-C3 等と統合済み、`docs/task-verification/r11-l1-l11.md`）
- **対象:** `apps/api/src/routes/external-service.ts:131-148`
- **問題:** `formId` が省略されると `resolveEffectiveUserId` が `authUserId` を返し、share-link / anon プリンシパルでも 200 が返り得る。R10-C3 と方向は同じだが「無指定時 400/403 必須化」の観点で未対応。
- **修正内容:** `formId` 必須化、または auth_type が `api_token` で share_link/anon の場合は 400/403。
- **依存:** R10-C3 と統合可。
- **検証:** anon トークン + `formId` なし → 403/400。

### R11-L9. SSE 接続中の権限失効が反映されない
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（PR #302、`sse_access_revoked` Pub/Sub で該当 SSE 接続を切断）
- **対象:** `apps/api/src/routes/forms-sse.ts:291-361`
- **問題:** 接続確立時にのみ `withDualFormAuth("EDITOR")` を実行。接続後に権限剥奪 / トークン revoke されてもストリームが継続する。
- **修正内容:** 認可変更時に `revokeSseChannel(formId, userId)` を Redis Pub/Sub で発行し、SSE 側で該当接続を切断する。
- **検証:** 接続中に `formPermission` を削除 → 数秒以内にストリーム終了。

### R11-L10. `/api/tokens/validate` にレート制限なし
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（PR #295）
- **対象:** `apps/api/src/routes/tokens.ts:345-373`
- **問題:** セッション必須のため悪用は限定的だが、ユーザー所有トークンの推測を阻むためレート制限が望ましい。
- **修正内容:** 既存の `createRateLimit` を `/tokens/validate` に適用。
- **検証:** burst 超過時に 429 が返ること。

### R11-L11. `apiToken.formIds` 上限が定義されていない
- **重要度:** 🟢 Low
- **対応状況:** ✅ 完了（`docs/task-verification/r11-l1-l11.md`、`apiTokenFormIdsSchema.max(64)` + テスト）
- **対象:** `packages/shared/src/api-tokens.ts:10-22`
- **問題:** `apiTokenScopesSchema` は `.min(1)` のみで上限なし。攻撃者が巨大配列でトークンを作成すると DB ペイロード肥大化や JSON parse のメモリ消費を引き起こす可能性。
- **修正内容:** `.max(64)` 程度の上限を追加。
- **検証:** 上限超過配列が 400 で拒否されること。

## Phase 7: 回帰テスト

### R11-T1. ラウンド11 セキュリティ・lifecycle・UI・インフラ回帰確認
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #289 + #306、`docs/task-verification/r11-t1.md` で全トラック完了を記録）
- **対象:** `apps/api/src/**/__tests__`, `apps/worker/src/**/__tests__`, `apps/web/src/**/__tests__`, `.github/workflows/ci.yml`
- **修正内容:** R11-C1〜C5, R11-H1〜H17 の修正後、悪用 / 失敗 / 整合性シナリオをテストで固定する。少なくとも以下をカバーする: (a) Google Sheets sync jobId IDOR、(b) 公開送信プロセスクラッシュ時の孤児レスポンス sweeper、(c) share-link role validation、(d) external-service エラーメッセージのサニタイズ、(e) ownerUserId スプーフィングレース、(f) ログイン後 redirect-back、(g) Twitter base URL allow-list、(h) sheets-sync 冪等性 TTL、(i) sheets-sync userId フォールバック削除、(j) `.dockerignore` の存在を repo invariant として check。
- **依存:** 各 R11-C / R11-H タスク。
- **検証:** `rtk pnpm lint:fix`, `rtk pnpm type-check`, `rtk pnpm test --silent` が通過。CI に DB/Redis services と `db:migrate` ジョブを追加した上で fork PR でも通ること。

## ラウンド11 推奨スプリント

```
即時封鎖すべき情報漏洩・孤児・コンテキスト破壊
  R11-C1, R11-C2, R11-C3, R11-C4, R11-C5 ──→ R11-T1

認可・スコープ持続性
  R11-H2, R11-H3, R11-H4, R11-H5 ──→ R11-T1

validation lifecycle 整合性（R10-H1 と統合修正）
  R11-H1, R11-M14, R11-M15 ──→ R11-T1

Web UX / クエリエラー UX 改善
  R11-H6, R11-H7, R11-H8, R11-H9, R11-H10 ──→ R11-T1

外部境界（Twitter / GitHub / Discord / Sheets）
  R11-H11, R11-H12, R11-H13, R11-H14, R11-M9, R11-M10 ──→ R11-T1

インフラ・CI 健全化
  R11-H15, R11-H16, R11-H17, R11-M21, R11-M22 ──→ R11-T1
```

---

# nexus-form セキュリティレビュー反映タスク（ラウンド12）

## ラウンド12（R12-M1〜R12-T2）の完了状況

**プロダクト系は完了、セキュリティ Medium 2 件が follow-up**（2026-05-22、`docs/task-verification/r12-t1-t2.md`）。

| 区分 | 状態 | PR / 備考 |
|------|------|-----------|
| R12-M1, M2, M3, M5 | ✅ 完了 | #289 |
| R12-M4, M6 | ✅ 完了 | PR #291（OAuth CSRF + listing regression tests） |
| R12-P1 | ✅ 完了 | #280 |
| R12-P2〜P6 | ✅ 完了 | #289（P2/P3/P5）、#290（P4/P6） |
| R12-T1 | ✅ 完了 | M1〜M6 回帰テスト済み（`docs/task-verification/r12-t1-t2.md`） |
| R12-T2 | ✅ 完了 | #290 |

---

レビュー日: 2026-05-21 JST / 対象: `z/security-reviews.md`
レビュー手法: Codex Cloud Security findings の内容確認。`Final: medium` の検証済み 6 件を対応タスク化し、`Final: ignore` の 8 件はセキュリティ対応タスクとしては除外した（プロダクト不具合として扱う場合は別途整理）。

各タスクは `ID / 重要度 / 対象ファイル / 問題 / 修正内容 / 依存 / 検証` で構成。重要度: 🔴 Critical → 🟠 High → 🟡 Medium → 🟢 Low。

## Phase 1: セキュリティ Medium

### R12-M1. 招待承諾 route が read-only API token で状態変更できる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r12-t1-t2.md`）
- **対象:** `apps/api/src/routes/forms-permissions.ts:496-501`, `apps/api/src/lib/dual-auth.ts:168-181,756-764`
- **問題:** `POST /:id/invitations/:token/accept` が `withDualAuth()` を scope 指定なしで使っており、Bearer 経路では `validateApiToken()` が呼ばれる。read-only token でも `acceptInvitation()` に到達し、`formPermission` 作成と invitation `ACCEPTED` 更新ができる。
- **修正内容:** この承諾 endpoint は session-only にする、または API token 経路では `write` scope と `form_ids` 制限・invitation の `formId` 一致を明示検証する。R11-C3 の「正規 invite route へ一本化」方針と衝突しない形で、旧 route を削除するなら削除側で本件を解消する。
- **依存:** R11-C3。
- **検証:** read-only API token + 有効 invitation token で 403 になること。session user での正規承諾は成功すること。

### R12-M2. duplicate `question_id` 回答が Sheets sync と API/export で不一致になる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r12-t1-t2.md`）
- **対象:** `apps/api/src/routes/forms-public.ts`, `apps/api/src/routes/forms-responses.ts`, `apps/api/src/lib/forms/response-validator.ts`, `apps/worker/src/lib/response-data-extractor.ts`, `apps/api/src/lib/forms/response-export.ts`
- **問題:** 公開/認証済み回答 schema と `validateResponseData` が duplicate `question_id` を拒否せず、保存 JSON に重複配列が残る。API/export は `Array.find()` で先勝ち、Sheets worker は `safeParseResponseData()` の object 正規化で後勝ちになり、同一回答の値がエクスポート先で食い違う。
- **修正内容:** 回答受信時に `question_id` の一意性を zod refinement または `validateResponseData` の seen-set で強制し、duplicate は 400 にする。既存データ向けには read/export 側で duplicate 検出時に fail closed するか、移行/修復方針を明示する。
- **依存:** R7-H1（responseDataJson 正準化）と統合推奨。
- **検証:** duplicate `question_id` を含む public submit / authenticated response create/update が 400 になること。Sheets extractor の duplicate last-wins 期待テストを拒否期待へ更新すること。

### R12-M3. public GET rate limit が `unknown` IP のグローバル DoS bucket になる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r12-t1-t2.md`）
- **対象:** `apps/api/src/routes/forms-public.ts:79-87,238-246,711-722`, `apps/api/src/lib/rate-limit.ts:20-25`, `apps/api/src/lib/ip-address/strategies.ts:65-83`
- **問題:** `GET /public/:publicId` と `GET /shared/:token` の rate limit が lookup 前に走り、key が `getClientIp(c)` のみ。`TRUSTED_PROXY_COUNT` 未設定/不正などで IP が `"unknown"` になると全利用者が同一 bucket を共有し、攻撃者が無効 publicId/share token への 60 req/min で正規利用者を 429 にできる。
- **修正内容:** `"unknown"` を通常 key として使わない。信頼できる IP が無い場合は remote address fallback を実装するか、route key に publicId/share token hash を加えて blast radius を限定する。さらに存在確認後に per-resource rate limit を適用する構成を検討する。
- **依存:** R3-H21。
- **検証:** `TRUSTED_PROXY_COUNT` 未設定かつ header なしで、無効 ID 連打が別 publicId/share token の正規 GET を 429 にしないこと。

### R12-M4. Google OAuth account-linking CSRF で victim の連携 token を置換できる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（server-only state + `google_oauth_user_id` binding + PKCE S256、`integrations-google-oauth.test.ts`）
- **対象:** `apps/api/src/lib/auth.ts:80-97`, `apps/api/src/lib/csrf-origin-guard.ts:4-47`, `apps/api/src/routes/integrations-google.ts:19-24,375-558`
- **問題:** session cookie が `SameSite=Lax` になったことで cross-site top-level GET に session が送信される。一方、Google OAuth `/authorize` / `/callback` は GET で CSRF origin guard 対象外、かつ `/authorize` が caller-controlled `state` を cookie に保存し、`/callback` は cookie state 一致と現在 session user だけで Google token を保存する。攻撃者の Google authorization code を victim session に紐づけ、victim の Google integration token を攻撃者 token に置換できる。
- **修正内容:** OAuth state はサーバ生成のみとし、caller-provided state を受け付けない。state に user/session nonce と PKCE/code verifier を紐づけ、callback で照合する。必要なら `/authorize` に GET 用 CSRF/intent token を導入し、`app_origin` も state に閉じ込めて callback で再検証する。
- **依存:** R4-M3（CSRF / SameSite 方針）と統合推奨。
- **検証:** cross-site GET で attacker-chosen state/code を使っても `saveStoredToken` が victim user に対して呼ばれないこと。通常 OAuth popup flow は維持されること。

### R12-M5. Discord 429 final path が response body consume 後の `cancel()` で retryAfter を失う
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r12-t1-t2.md`）
- **対象:** `packages/validation-provider-discord/src/requests.ts:70-79`, `packages/validation-provider-discord/src/plugin.ts:343-383`, `apps/worker/src/handlers/generic-validation.ts:332-374`
- **問題:** `discordFetchWithRetry` の final 429 path が `await finalResponse.json()` 後に `finalResponse.body?.cancel()` を呼び、Node/undici の実 Response では locked stream の `TypeError` が先に投げられる。そのため `DiscordHttpError(429, retry_after)` が構築されず、provider は `DISCORD_API_ERROR` retryAfter なしを返し、worker が delayed retry せず失敗結果として保存する。
- **修正内容:** body を読んだ後の `body.cancel()` を削除するか、読む前に不要 body のみ cancel する。429 JSON parse は `safeParse` し、parse 失敗時も既定 retryAfter を持つ `DiscordHttpError` を投げる。テストは mock body ではなく実 `Response` で固定する。
- **依存:** R3-H6 / R3-M25。
- **検証:** 実 `Response` の 429 が `DISCORD_API_RATE_LIMIT` + 正の `retryAfter` になり、worker が `moveToDelayed` 経路へ入ること。

### R12-M6. token listing が全 active token を読み込み pageSize と無関係に OOM し得る
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（`getUserApiTokens` SQL `COUNT` + `LIMIT/OFFSET`、`get-user-api-tokens.test.ts`）
- **対象:** `apps/api/src/routes/tokens.ts:79-117`, `apps/api/src/lib/tokens/generate.ts:104-132`
- **問題:** `GET /api/tokens` と `getUserApiTokens` が current user の active token index rows を全件 SELECT し、全行を JSON parse してから `slice(offset, offset + pageSize)` している。response `pageSize` は最大 100 でも、API/DB/heap の負荷は active token 総数に比例する。token 作成 quota/rate limit も見当たらず、通常ユーザーが大量 token を作った後に listing 連打で共有 API/DB 可用性を落とせる。
- **修正内容:** SQL 側で `LIMIT/OFFSET` と `COUNT(*)` に戻す。malformed JSON を除外する必要があるなら、作成/読み出し時の schema 検証で不正行を発生させない方針へ寄せ、一覧で全件 scan しない。必要に応じて per-user active token quota と `/api/tokens` route-level rate limit を追加する。
- **依存:** R11-L10（`/api/tokens/validate` rate limit）とは別件だが同スプリント推奨。
- **検証:** 5000 active token + `pageSize=1` で SELECT/parse 件数が pageSize 近傍に収まり、`total` は DB count で返ること。

## Phase 2: セキュリティ対象外として見送り

以下は `z/security-reviews.md` では `Final: ignore` のため、セキュリティ対応タスクには追加しない。プロダクト不具合として直す場合は既存該当タスクへ統合する。

- Redis URL escapes can disable shared rate limiting（検証で否定）
- Google Sheets sync job IDs use invalid colons（検証で否定）

## Phase 3: プロダクト不具合（非セキュリティ）

### R12-P1. validation retry の BullMQ jobId が `:` を含み retry enqueue に失敗する
- **重要度:** 🟡 Medium（プロダクト不具合）
- **対応状況:** ✅ 完了（PR #280、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-responses.ts:276-345`, `packages/shared/src/validation-results.ts:46-50`
- **問題:** retry job ID が ``validation-retry:${result.id}:${randomUUID()}`` で生成されるが、実 `result.id` は `validation-result:<hash>` 形式のため `:` を複数含む。BullMQ 5.69.2 は custom jobId の `:` 区切り数によって `Custom Id cannot contain :` を投げ、retry が enqueue されず `FAILED/ENQUEUE_FAILED` になる。
- **修正内容:** custom jobId から `:` を排除する（例: `validation-retry-${hash}-${uuid}`）か、そもそも custom jobId を使わず DB の `jobId` を Queue.add の戻り値から保存する。既存 `validation-result:<hash>` ID を jobId に埋め込む場合は URL-safe/base64url などでエンコードする。
- **依存:** R9-H1, R11-H1（validation retry / jobId 所有権）。
- **検証:** 実 `validation-result:<hash>` ID で retry endpoint を叩いて Queue.add が成功し、結果が `PENDING` + jobId 保存になること。

### R12-P2. `StoredLogicRuleSchema` 厳格化で旧 empty logic rule を持つフォームが読めなくなる
- **重要度:** 🟡 Medium（プロダクト不具合）
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r12-t1-t2.md`）
- **対象:** `packages/shared/src/validation/shared.ts:57-75`, `apps/api/src/lib/forms/parse-stored-structure.ts:21-25`, `apps/api/src/lib/forms/form-structure-service.ts:114-130`
- **問題:** 旧 schema は `condition: {}` / `action: {}` を許容していたが、新 schema は `condition.field` / `condition.operator` / `action.type` を必須にした。既存 DB に旧形式の active `FormStructure.structureJson` が残っていると、管理画面の structure read が `parseStoredStructure` で例外になり 500 になる。
- **修正内容:** read path で旧形式を互換変換する migration parser を追加し、空 condition/action は無効 rule として除去または既定値付きに正規化する。加えて DB migration / one-shot repair script で既存 active structure を新 schema に更新する。
- **依存:** R3-L8。
- **検証:** 旧形式 `condition: {}` / `action: {}` を含む structure fixture が 500 にならず、正規化後の編集/保存が成功すること。

### R12-P3. share-link API token の synthetic user id が User FK に違反して編集/公開に失敗する
- **重要度:** 🟡 Medium（プロダクト不具合）
- **対応状況:** ✅ 完了（PR #289、`docs/task-verification/r12-t1-t2.md`）
- **対象:** `apps/api/src/lib/dual-auth.ts:114-136,521-530`, `apps/api/src/lib/forms/form-structure-service.ts:65-70`, `apps/api/src/lib/forms/snapshot-repository.ts:161-166`, `packages/database/src/schema.ts:360-362,495-500`
- **問題:** share-link API token は `share-link:<id>` の synthetic `user_id` で認可される。一方、`FormStructure.createdBy` / `FormSnapshot.publishedBy` が `User.id` FK になったため、EDITOR share-link token による structure save / snapshot publish が FK violation で 500 になる。
- **修正内容:** audit column には実 User.id のみ保存し、synthetic principal の場合は `null` + 別 `actorType` / `actorId` を保存する、または share-link API token で該当操作を禁止して UI/API contract を明確化する。DB schema と監査表示の意図を揃える。
- **依存:** R9-C1, R10-C3（synthetic principal の権限方針）。
- **検証:** EDITOR share-link token の許可対象操作が 500 にならないこと。禁止方針なら 403 として明示されること。

### R12-P4. autosave 後に validation tab が stale `plateContent` を使い新規 block を選べない
- **重要度:** 🟡 Medium（プロダクト不具合）
- **対応状況:** ✅ 完了（PR #290、`docs/task-verification/r12-t1-t2.md`）
- **対象:** `apps/web/src/components/forms/form-editor-page.tsx`, `apps/web/src/hooks/forms/use-form-content-autosave.ts`, `apps/api/src/routes/forms-content.ts`, `apps/web/src/components/forms/form-validation-rules-page.tsx`
- **問題:** autosave 成功時に refs は最新保存内容を反映するが、React Query の `["formContent", formId]` が更新/invalidated されない。validation tab は live draft ではなく query 由来 `plateContent` を parse するため、新しく追加・保存済みの block が stale cache により候補に出ない。
- **修正内容:** autosave 成功時に `queryClient.setQueryData(["formContent", formId], ...)` で保存済み content/version を同期するか、API の PUT response に `plateContent` を返して cache 更新する。validation tab は editor の live draft/saved refs と同じ source-of-truth を使う。
- **依存:** R8-H2, R11-M5。
- **検証:** block 追加 → autosave 成功 → validation tab へ移動した直後に新 block が選択候補へ表示されること。

### R12-P6. autosave ref 更新が optimistic-lock invariant を壊し collaborator 変更を silent overwrite する（共同編集修正 段階1、R12-P5 より先に実施）
- **重要度:** 🟡 Medium（プロダクト不具合）
- **対応状況:** ✅ 完了（PR #290、`docs/task-verification/r12-t1-t2.md`）
- **対象:** `apps/web/src/hooks/forms/use-form-content-autosave.ts:82-106,258-272`, `apps/api/src/routes/forms-content.ts:62-71`
- **問題:** `contentData` refetch 時に local unsaved edit があっても `versionRef` と `baseContentRef` を常に最新 server content へ進める。一方 editor value は古い local edit のまま保持されるため、debounce save が「v1 ベースの local content」を `expectedVersion = v2` として送信し、server optimistic lock が通って collaborator の v2 変更を上書きする。
- **修正内容:** local edit がある間は `versionRef` / `baseContentRef` を進めず、incoming server content を pending remote として別 ref に保持して conflict/merge UI に渡す。save 時は mutation 変数を mutable `versionRef` ではなく snapshot した base version で固定する。
- **依存:** なし。**R12-P5（段階2）より先に実施すること。**
- **検証:** v1 local edit pending 中に v2 remote refetch が来ても、local save は 409/merge path になり v2 を silent overwrite しないこと。

### R12-P5. hidden-tab SSE pause 後の復帰で merge handling を bypass し共同編集を上書きする（共同編集修正 段階2、R12-P6 完了後に実施）
- **重要度:** 🟡 Medium（プロダクト不具合）
- **対応状況:** ✅ 完了（PR #289 + #290、`docs/task-verification/r12-t1-t2.md`）
- **対象:** `apps/web/src/hooks/forms/use-editor-sse.ts`, `apps/web/src/hooks/forms/use-form-content-autosave.ts`, `apps/api/src/routes/forms-content.ts`
- **問題:** 通常の SSE `document_changed` は local pending edit がある場合に merge path を呼ぶが、hidden tab で EventSource を閉じた後の visible 復帰処理は `formContent` / `formDiff` を無条件 invalidate するだけで `pendingValueRef` を確認しない。refetch により `versionRef` が進み、pending local save が最新 version として受理され、collaborator の変更を merge prompt なしで上書きし得る。
- **修正内容:** visibility restore 時も live SSE と同じく pending edit を検出し、`onMergeNeeded` を呼んで invalidate/refetch を遅延する。少なくとも pending がある間は `versionRef` を進めない。
- **依存:** R12-P6（段階1）完了後に実施。
- **検証:** hidden tab 中に collaborator が保存 → visible 復帰 → local pending edit がある場合、即 autosave ではなく conflict/merge UI が表示されること。

## Phase 4: ラウンド12 回帰テスト

### R12-T1. Codex security findings 回帰確認
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（M1〜M6、`docs/task-verification/r12-t1-t2.md`）
- **対象:** `apps/api/src/__tests__`, `apps/worker/src/**/__tests__`, `packages/validation-provider-discord/src/**/__tests__`
- **修正内容:** R12-M1〜M6 の修正後、各 PoC 条件を regression test として固定する。
- **依存:** R12-M1〜M6。
- **検証:** `rtk pnpm lint:fix`, `rtk pnpm type-check`, `rtk pnpm test --silent` が通過すること。

### R12-T2. Codex product findings 回帰確認
- **重要度:** 🟠 High
- **対応状況:** ✅ 完了（PR #290、`docs/task-verification/r12-t1-t2.md`）
- **対象:** `apps/api/src/__tests__`, `apps/web/src/**/__tests__`, `packages/shared/src/**/__tests__`
- **修正内容:** R12-P1〜P6 の修正後、queue jobId、legacy structure 互換、share-link synthetic principal、validation tab stale content、hidden-tab SSE、autosave optimistic-lock invariant を regression test として固定する。
- **依存:** R12-P1〜P6。
- **検証:** `rtk pnpm lint:fix`, `rtk pnpm type-check`, `rtk pnpm test --silent` が通過すること。UI 共同編集系は hook-level test に加え、可能なら Playwright で 2 editor session の再現を確認すること。

## ラウンド12 推奨スプリント

```
認可・CSRF 境界
  R12-M1, R12-M4 ──→ R12-T1

公開入口の可用性・データ整合性
  R12-M2, R12-M3 ──→ R12-T1

外部 provider / token 管理の可用性
  R12-M5, R12-M6 ──→ R12-T1

プロダクト互換性・共同編集データ損失
  R12-P1, R12-P2, R12-P3, R12-P4, R12-P5, R12-P6 ──→ R12-T2
```

---

## メンテナンス: 後方互換性 dead code 除去（2026-05-21）

### MAINT-1. `FingerprintAnonymizer` の no-op 互換メソッドを除去
- **重要度:** 🟢 Low（技術的負債）
- **対応状況:** ✅ 完了（ブランチ `task/r9-h6-response-detail-data`）
- **対象:** `apps/api/src/lib/fingerprint/anonymizer.ts:278-290`, `apps/api/src/lib/fingerprint/__tests__/anonymizer.test.ts:109-199`
- **経緯:** 匿名化マップをグローバルシングルトン状態からリクエストスコープのローカル変数（`getAnonymizedFingerprints` 内の `anonymizedIdMap`）へ移行した際、テスト互換性のために `resetAnonymizationMap()` と `getAnonymizationMapSize()` を残存させていた。前者は空実装、後者は常に `0` を返すだけで、テスト以外からの呼び出しは存在しなかった。
- **修正内容:**
  1. `anonymizer.ts` から `resetAnonymizationMap()` / `getAnonymizationMapSize()` の 2 メソッドを削除。
  2. `anonymizer.test.ts` の `beforeEach` 内 `resetAnonymizationMap()` 呼び出しを削除。
  3. 各テストケース末尾の `getAnonymizationMapSize() === 0` アサーションを削除（常に真であり何も検証していなかった）。
- **検証:** `pnpm --filter @nexus-form/api exec vitest run` 3 テスト全通過。`pnpm lint:fix`, `pnpm type-check`, `pnpm test --silent` 全通過。
- **備考:** `worker/src/lib/response-data-extractor.ts` の object-map 形式対応（`safeParseResponseData`）は DB に旧形式レコードが残存するため除去対象外。新規書き込みは常に array 形式（`stringifyResponseDataJson`）。

---

# 推奨実施順（ラウンド10〜12、2026-05-22 更新）

ラウンド10〜12 の P0〜P7 は **2026-05-23 時点で完了**（`master` @ `1c3a0c1`、PR #248〜#306）。以下は **残タスクのみ** を優先度順に列挙。完了済み ID の詳細は各ラウンド見出し直下の「完了状況」と `docs/task-verification/` を参照。

```
【ラウンド11】
  全件完了（R11-C1〜R11-T1 ✅、#289 + #295〜#306）

【ラウンド12 follow-up（任意）】
  R12-M4, M6 などセキュリティ Medium — ラウンド12見出しを参照

【完了済み（参照のみ）】
  ラウンド8 全件、ラウンド9 全件
  ラウンド10 全件（R10-T1 ✅）
  ラウンド11 全件（R11-T1 ✅）
  ラウンド12 プロダクト系 + T2（#280, #289, #290 ✅）

---

# nexus-form Codex セキュリティファインディング対応タスク（ラウンド13）

レビュー日: 2026-05-23 JST / 対象: `codex-security-findings-2026-05-23T10-32-23.808Z.csv`
レビュー手法: Codex Cloud 検出のうち、R12 既存タスク（R12-M1〜M6, R12-P1〜P6）でカバーされていない新規 findings を抽出。以下の findings は既存完了タスクにより対応済みのため除外:
- **Token listing unbounded scan（b95d25a6 / 8ec079c9 / a3a55f98）** → R12-M6 ✅
- **Google OAuth account-link CSRF（60326622）** → R12-M4 ✅
- **OAuth popup retry 閉塞（22dc779b）** → R11-H10 / R11-M8 ✅
- **Redis URL escapes（cb85ec3a）** → R12 Phase 2 で ignore 確定済み

各タスクは `ID / 重要度 / 対象ファイル / 問題 / 修正内容 / 依存 / 検証` で構成。重要度: 🔴 Critical → 🟠 High → 🟡 Medium → 🟢 Low。

## Phase 0: Critical（公開フォーム可用性）

### R13-C1. Validation outbox の `ruleId` FK が削除済み validation rule を参照し公開送信が 500 になる
- **重要度:** 🔴 Critical
- **対応状況:** 完了（2026-05-24）
- **対象:** `apps/api/src/routes/forms-public.ts`（outbox insert）、`packages/database/src/schema.ts`（`ExternalServiceValidationResult.ruleId` FK）、`apps/api/src/lib/forms/validation-rule-repository.ts`
- **問題:** 公開スナップショットは独自の `validationRulesJson` を持つが、`ExternalServiceValidationResult.ruleId` は mutable な `FormValidationRule` テーブルへの FK を持つ。エディタが出版後フォームの validation rule を削除/置換すると、public submit 時の outbox insert が同一 tx 内で FK 違反により失敗し、レスポンスごとロールバックされて 500 が返る。R11-C2 で outbox を tx 内に移動したことにより顕在化した退行（以前は非同期挿入でエラーが握り潰されていた）。
- **修正内容:**
  1. `ExternalServiceValidationResult.ruleId` の FK を nullable にするか、`ruleId` を論理参照（snapshot 内の `validationRulesJson` からの ID）に変更し DB FK 制約を外す。
  2. または outbox insert 前に参照先 `FormValidationRule` の存在を確認し、欠落時は `ruleId` を NULL にして insert する（検証結果は紐付かなくなるが送信は成功する）。
  3. 短期対策として、outbox insert クエリに `ON CONFLICT DO NOTHING` を付与し FK 違反行をスキップする。
- **依存:** R11-C2-a（同一 tx 内 outbox insert）
- **検証:** 公開フォーム送信後、エディタが validation rule を全削除 → 別の回答者から再度送信 → 200 が返り response が保存されること。

## Phase 1: High（可用性・リソース枯渇）

### R13-H1. Discord バリデーションのフォールバックページネーションが検証ジョブあたり最大 11 回の API 呼び出しを発生させる
- **重要度:** 🟠 High
- **対応状況:** 完了（2026-05-24）
- **対象:** `packages/validation-provider-discord/src/requests.ts`、`packages/validation-provider-discord/src/plugin.ts`
- **問題:** Discord provider は `searchGuildMembers` を `limit=1000` で呼び、Discord が exact match なしで full page を返した場合、`listGuildMembers` で最大 10 ページ（各 1000 件）までフォールバックする。ユーザー入力由来の short/common username がこのフォールバックを誘発すると、1 検証ジョブあたり最大 11 回の Discord API 呼び出しが発生する。Discord バリデーションジョブは単一 Redis ロックで直列化されているため、増幅されたジョブがレーンを占有し、共有 Bot トークンのレート制限を枯渇させる。
- **修正内容:**
  1. フォールバックページネーションの最大ページ数を 2〜3 ページに削減するか、`searchGuildMembers` で exact match を判定できる別のクエリ手法に切り替える。
  2. フォールバックが発生した場合、ジョブごとの Discord API 呼び出し回数を制限する（例: 合計 3 ページまで）。
  3. フォールバック経路にレート制限アダプテーションを追加し、Discord 429 検出時に即座にバックオフする。
- **依存:** R11-M10（searchGuildMembers limit=1000 化）
- **検証:** short prefix で exact match なしのユーザー名を検証 → Discord API 呼び出しが 3 回以下に制限されること。

### R13-H2. SSE プリフライト中にクライアント切断が発生すると abort ハンドラ未登録のままコネクションリークする
- **重要度:** 🟠 High
- **対応状況:** 完了（2026-05-24）
- **対象:** `apps/api/src/routes/forms-sse.ts`
- **問題:** `channelRegistry.ensureSubscribed()`（Redis subscribe の確立）を await した後で `streamSSE()` 内部で `stream.onAbort(closeStream)` が登録される。クライアントが Redis subscribe 待機中（ensureSubscribed の await 中）に切断すると、abort イベントは既に発火済みだが `onAbort` ハンドラが未登録のため cleanup が実行されない。その結果、コネクション許可（connection permit）が解放されず、Redis subscriber/client がプロセス終了までリークする。認証済みエディタがこの race を意図的に誘発し、SSE 接続上限（`MAX_SSE_CONNECTIONS=200`）を枯渇させられる。
- **修正内容:**
  1. `ensureSubscribed()` の await より先に `stream.onAbort(closeStream)` を登録する。
  2. または、`ensureSubscribed()` 自体に AbortSignal を渡し、クライアント切断時に subscribe 処理を中断させる。
  3. closeStream 内で connection permit の解放と Redis subscriber の cleanup を必ず実行する。
- **依存:** R9-H4（SSE subscribe failure）、R6-H6（SSE subscriber 共有化）
- **検証:** SSE プリフライト中にクライアント切断 → connection permit が解放され、Redis subscriber がリークしないこと。

### R13-H3. Sheets sync の idempotency 確認が全シート読み取りで Google API クオータを消費する
- **重要度:** 🟠 High
- **対応状況:** 完了（2026-05-24）
- **対象:** `apps/worker/src/handlers/sheets-sync.ts`（`readSheetForIdempotency`）
- **問題:** `readSheetForIdempotency` は `readRange` を `rangeA1` にシート名のみ指定して呼び出す。Google Sheets Values API は bare sheet name でそのシートの全使用範囲を返すため、ヘッダー行のみの読み取り（`${sheetName}!1:1`）ではなく全行を毎回転送する。public form submit が Sheets sync ジョブを enqueue するたびにこの全シート読み取りが走るため、大規模シートでは Google API 読み取りクオータを消費し、Worker のメモリ/CPU を圧迫する。未認証の回答者が繰り返し submit することでクオータ枯渇 DoS が可能。
- **修正内容:**
  1. `readSheetForIdempotency` の range を `${sheetName}!1:1` に限定し、ヘッダー行のみ読み取る。
  2. レスポンス ID の確認にヘッダー行だけでは不十分な場合、別の lightweight な存在確認手法（例: シート末の限定行のみ読む）を導入する。
  3. idempotency 確認自体を Redis の冪等性キー + 該当行番号のキャッシュに移行し、Sheets 読み取りを削減する。
- **依存:** R11-H13（Sheets idempotency TTL/ロック設計）
- **検証:** `readSheetForIdempotency` が API リクエストでヘッダー行のみを取得すること。大規模シート（1000+ 行）でも転送量が一定であること。

## Phase 2: Medium

### R13-M1. 不正な form JSON により editor がクラッシュする（`collectText` の trim 呼び出し）
- **重要度:** 🟡 Medium
- **対応状況:** 完了（2026-05-24）
- **対象:** `apps/web/src/components/ui/form-question-nodes/form-question-base.tsx`、`packages/shared/src/plate-content-utils.ts`、`apps/api/src/routes/forms-content.ts`
- **問題:** `isElementEmpty` は `collectText(element as TreeNode)` の結果に `.trim()` を呼ぶ。`collectText` は `text` プロパティが文字列以外（例: 数値）のノードに遭遇するとその値をそのまま返すため、`trim()` がランタイムエラーを投げ editor ビューがクラッシュする。API は plate JSON の shallow validation のみ行っており、editor で悪意ある編集者が text プロパティを非文字列に変更した JSON を保存可能。
- **修正内容:**
  1. `collectText` の戻り値を常に `string` に強制する（`String(value)` または `String(value ?? "")`）。
  2. API 側の plate content 保存時に `collectText` で全ノードを再帰検査し、文字列型テキストプロパティを強制する zod refinement を追加する。
  3. `isElementEmpty` で `typeof text !== "string"` のガードを追加する。
- **依存:** R5-H3（壊れた plateContent の fail-closed）
- **検証:** `text: 123` を含む plate JSON を API 経由で保存 → editor がクラッシュせずに開けること。

### R13-M2. ルート `pnpm db:migrate` が Turbo 経由で `DATABASE_URL` を継承できない
- **重要度:** 🟡 Medium
- **対応状況:** 完了（2026-05-24）
- **対象:** `turbo.json`、`package.json`、`packages/database/drizzle.config.ts`
- **問題:** CI ワークフローは Turbo をバイパスして `drizzle-kit migrate` を直接呼ぶため `DATABASE_URL` を正しく継承するが、ルートの `pnpm db:migrate` は `turbo db:migrate` を実行する。当該コミットで `DATABASE_URL` が Turbo の task env 設定から削除されたため、Turbo strict mode 下で migration コマンドが `DATABASE_URL` を読み取れず失敗する。k8s README のデプロイ手順（`pnpm db:migrate`）が機能しなくなる。
- **修正内容:**
  1. `turbo.json` の `db:migrate` タスクに `DATABASE_URL` を `env` または `persistent` タスクの `outputs` とは別に明示的に追加する。
  2. または `package.json` の `db:migrate` スクリプトを `turbo run db:migrate` から `pnpm --filter @nexus-form/database exec drizzle-kit migrate` に変更し Turbo をバイパスする。
- **依存:** R11-M19（turbo.json inputs/outputs 整備）
- **検証:** `pnpm db:migrate` がルートから実行可能であり、`DATABASE_URL` の不足で失敗しないこと。

### R13-M3. Worker shutdown abort が Discord validation を permanent failure に変換する（R11-M11 follow-up）
- **重要度:** 🟡 Medium
- **対応状況:** 完了（2026-05-24）
- **対象:** `apps/worker/src/lib/redis-lock.ts`、`apps/worker/src/handlers/generic-validation.ts`
- **問題:** R11-M11 で `withRedisLock` に AbortSignal 対応を追加したが、abort 時に投げられる `DOMException` は `handleGenericValidation` で特殊ケースされていない。`withRedisLock` 内で `workerShutdownSignal` が abort されると `DOMException` が throw され、`handleGenericValidation` は `RedisLockAcquireTimeoutError` のみ retryable として扱うため、この abort 例外は permanent failure として `externalServiceValidationResult` に FAILED を書き込みジョブが成功扱いで終了する。正常な graceful shutdown が transient な条件を永久失敗に変換する。
- **修正内容:**
  1. `handleGenericValidation` 内で abort 由来のエラー（`DOMException` または `AbortError`）を catch し、`moveToDelayed` か `throw`（BullMQ retry に任せる）で扱う。
  2. または `withRedisLock` 内で abort 時に `RedisLockAcquireTimeoutError` と同様の retryable エラーを throw する。
- **依存:** R11-M11（withRedisLock AbortSignal 対応）
- **検証:** Worker に SIGTERM を送信 → Discord validation ジョブがロック待機中 → ジョブが FAILED にならず BullMQ retry キューに戻ること。

## Phase 4: 既存完了タスクで対応済みの findings（再レビュー不要）

| Finding | Codex ID | 対応タスク | 対応状況 |
|---------|----------|-----------|----------|
| API token list unbounded scan | b95d25a6 | R12-M6 | ✅ 完了（ソース確認: index 列のみ全件 SELECT だが full row はページ限定。R12-M6 の修正範囲内） |
| Token listing scans all active tokens | 8ec079c9 | R12-M6 | ✅ 完了（同上） |
| Unbounded API token listing DoS | a3a55f98 | R12-M6 | ✅ 完了（同上） |
| Google OAuth account-link CSRF | 60326622 | R12-M4 | ✅ 完了（ソース確認: server-only state + PKCE S256 + user_id cookie binding + callback 内 multi-factor verification 実装済み） |
| OAuth popup retry closes window | 22dc779b | R11-H10 / R11-M8 で抽出済みだが close 順序未修正 | ⚠️ R13-L3 に移動 |
| Redis URL escapes disable rate limiting | cb85ec3a | R12 Phase 2 ignore | ✅ 確認済み |

## 推奨スプリント

```
即時（公開フォーム可用性）
  R13-C1 ──→ TBD

リソース保護（High）
  R13-H1, R13-H2, R13-H3 ──→ TBD

品質・安定性
  R13-M1, R13-M2, R13-M3 ──→ TBD

低優先度
  R13-L1, R13-L2, R13-L3
```

---

## ラウンド13: Codex Security Findings 2026-05-24 反映

入力: `/Users/xpadev/Downloads/codex-security-findings-2026-05-24T04-44-02.909Z.csv`
確認日: 2026-05-24 JST
確認方針: CSV の指摘を現行実装に照合し、未修正または追加修正が必要なもののみ起票。重複する API token listing 指摘は 1 件に統合。

起票対象外（現行実装で対策済みと判断）: SSE preflight abort、Google OAuth account-link CSRF、OAuth popup retry、Sheets sync 全範囲読み取り、worker shutdown 中の Discord validation 永続失敗、Plate JSON editor crash、root `pnpm db:migrate` の `DATABASE_URL` 喪失、pre-commit の空白 filename split。

### R13-M1. 公開フォーム送信の response limit が pre-lock read-view race を起こしうる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #316、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/routes/forms-public.ts`
- **問題:** `db.transaction` 内で `buildExternalValidationOutbox()` が `form` 行の `FOR UPDATE` ロック取得より前に実行され、`FormValidationRule` への通常 SELECT が走る。MySQL の既定 `REPEATABLE READ` ではこの最初の non-locking read が transaction read view を確立し、その後ロック待ちから復帰した transaction が stale snapshot で `FormResponse` 件数を数える可能性がある。結果として `max_responses` を超過する racing submission を許す余地がある。
- **修正内容:** response limit が有効な場合は transaction 開始直後に `form` 行を `FOR UPDATE` でロックし、その後に validation outbox 構築・件数 count・response insert を行う。あるいは response limit 用の locked counter/atomic update へ寄せ、通常 SELECT に依存しない。
- **依存:** なし
- **検証:** `max_responses=1` の公開フォームに active validation snapshot がある状態で並列 POST しても、保存済み response が 1 件を超えないこと。

### R13-M2. Discord username validation が respondent 入力で大きな外部 API 負荷を発生させる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #317、`gh-review-hook` exit 0）
- **対象:** `packages/validation-provider-discord/src/requests.ts`, `packages/validation-provider-discord/src/plugin.ts`, `apps/worker/src/handlers/generic-validation.ts`
- **問題:** `findGuildMemberByUsername()` は respondent-controlled username で Search Guild Members `limit=1000` を実行し、full page かつ exact match なしなら List Guild Members を最大 3 ページ追加で読む。10 ページから 3 ページへ緩和済みだが、1 job あたり最大 4 回の大型 Discord API request が残り、Redis lock で直列化された Discord validation lane と共有 bot token rate limit を攻撃者入力で消費できる。
- **修正内容:** username 検証の探索上限をさらに小さくする、短すぎる/common な username を拒否または追加 challenge に回す、guild member ID / OAuth identity / cached member index など exact lookup 可能な方式へ移行する。少なくとも fallback scan は provider 設定で明示 opt-in にし、既定は single search のみにする。
- **依存:** なし
- **検証:** full search page で exact match がない username を連続投入しても、Discord API 呼び出し回数・job runtime・lock 占有時間が設定上限内に収まること。

### R13-M3. API token list が全 active token を scan/parsing して authenticated DoS になりうる
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（PR #318、`gh-review-hook` exit 0）
- **対象:** `apps/api/src/lib/tokens/generate.ts`, `apps/api/src/routes/tokens.ts`, `apps/api/src/lib/constants/pagination.ts`
- **問題:** `getUserApiTokens()` は page/pageSize を受け取るが、まず当該 user の active token 全件から `id/scopes/formIds` を読み、全 row の JSON を parse して `validTokenIds` を作った後に `Array.slice()` している。`pageSize` は DB 転送量・JSON parse CPU・memory allocation の上限になっていない。token 作成数に上限がない場合、低権限 authenticated user が大量 token を作って `/api/tokens` を繰り返すだけで API/DB 負荷を線形増加させられる。
- **修正内容:** 通常 path は SQL `COUNT` + `LIMIT/OFFSET` に戻し、page 対象 row のみ JSON parse する。malformed JSON を一覧から除外したい場合は、修復用 background job / admin health check / generated normalized columns で扱い、list endpoint の per-request 全件 scan にしない。あわせて per-user token quota または create-token rate limit を導入する。
- **依存:** なし
- **検証:** 1 user に大量 token がある状態で任意 page を取得しても、DB 取得件数と JSON parse 件数が `pageSize` 近傍に収まること。

### R13-M4. Published validation snapshot が mutable rule table / FK に依存して submission を壊す
- **重要度:** 🟡 Medium
- **対応状況:** ✅ 完了（この PR）
- **対象:** `apps/api/src/routes/forms-public.ts`, `packages/database/src/schema.ts`, `packages/database/drizzle/0001_watery_gateway.sql`, `apps/api/src/lib/forms/validation-rule-repository.ts`, `apps/api/src/lib/forms/snapshot-repository.ts`
- **問題:** active snapshot は `validationRulesJson` に publish 時点の rule を保持しているが、public submission の outbox は snapshot rule id で `ExternalServiceValidationResult.ruleId` を insert する。migration 0001 では `ExternalServiceValidationResult_ruleId_FormValidationRule_id_fk` が存在するため、editor が publish 後に draft 側 rule を削除すると、snapshot 内の古い rule id を参照する outbox insert が FK 違反で response transaction ごと rollback しうる。現行コードは削除済み rule を `RULE_DELETED` として FAILED row 化しようとしているが、FK が残る DB ではその insert 自体が失敗する。
- **修正内容:** validation result は snapshot rule identity を保存できるようにし、mutable `FormValidationRule` への FK 依存を外す。例: `snapshotRuleId` と nullable/current `ruleId` を分離する、または FK を drop して snapshot rule id を非 FK 文字列として扱う。public submission は active snapshot の内容だけで validation job を構築し、draft rule table の削除・置換で既公開 snapshot の検証可否が変わらないようにする。
- **依存:** migration 修正が必要なため R13-M6 と同時確認推奨
- **検証:** publish 後に validation rule を削除/置換しても、既公開 snapshot への public submission が 500 にならず、snapshot に含まれる validation が意図通り PENDING/FAILED として記録されること。

### R13-L1. Lefthook pre-commit lint が staged file list を受け取れない
- **重要度:** 🟢 Low
- **対象:** `lefthook.yml`
- **問題:** `pre-commit.commands.lint.run` は Bash 配列 `${staged_files[@]}` を参照しているが、Lefthook の `{staged_files}` placeholder が command 内に存在しないため、Lefthook 側の staged file 展開が行われない。実行 shell によっては配列が空で Biome が skip されるか、Bash 配列構文で失敗する。空白 filename split は quoted array で改善済みだが、file list 注入経路が未解決。
- **修正内容:** Lefthook の documented placeholder を使って staged files を安全に shell 引数として渡す形に直す。例: `bash -c '...' -- {staged_files}` で `"$@"` を filter し、`pnpm biome check "${filtered[@]}" --write --unsafe` を実行する。shell を Bash 前提にする場合は明示する。
- **依存:** なし
- **検証:** staged TS/TSX ファイルありの commit で Biome が対象ファイルを受け取り、除外対象のみ staged の場合は skip されること。空白を含むファイル名でも引数が分割されないこと。

### R13-L2. Migration 0002 が FK constrained column を drop/recreate なしで MODIFY している
- **重要度:** 🟢 Low
- **対象:** `packages/database/drizzle/0001_watery_gateway.sql`, `packages/database/drizzle/0002_broad_mentallo.sql`
- **問題:** migration 0001 で `ApiToken.userId`, `Form.creatorId`, `FormPermission.userId`, `GoogleOAuthToken.userId` に `User.id` への FK を追加しているが、migration 0002 はそれらの column を FK drop なしで直接 `MODIFY COLUMN` している。MySQL では FK 参加 column の変更が拒否される構成があり、fresh DB / 未適用環境の migration が失敗しうる。
- **修正内容:** 0002 で対象 FK を一度 `DROP FOREIGN KEY` し、`MODIFY COLUMN` 後に同じ制約を `ADD CONSTRAINT` で再作成する。既存 DB への適用済み migration を変更できない運用なら、forward-only の補正 migration で未適用環境を含めた手順を定義する。
- **依存:** R13-M4 の validation result FK 見直しと migration 方針を揃える
- **検証:** 空の MySQL schema に 0001→0002 を順番適用して失敗しないこと。

### R13-L3. Redis URL の percent-encoded credentials をそのまま ioredis option に渡している
- **重要度:** 🟢 Low
- **対象:** `apps/api/src/lib/cache/redis-client.ts`, `apps/api/src/lib/rate-limit.ts`
- **問題:** `REDIS_URL` path で `new URL(redisUrl)` の `url.password` / `url.username` を `new Redis(redisUrl, { password, username })` に明示指定している。WHATWG `URL` の username/password は percent-encoded のままなので、`redis://:p%40ss@...` のような reserved character を含む credential が `p%40ss` として渡され、ioredis の URL parser が得る正しい credential を override しうる。rate limiter は Redis 失敗時に in-memory fallback へ落ちるため、multi-instance で shared rate limiting が無効化される。
- **修正内容:** URL に credential が含まれる場合は ioredis の URL parsing に任せ、option 側で username/password を上書きしない。明示指定が必要なら `decodeURIComponent(url.username/password)` を使う。`process.env.REDIS_PASSWORD` は URL に password がない場合のみ fallback として適用する。
- **依存:** API/worker/BullMQ 側の Redis option builder に同種実装がないか横断確認推奨
- **検証:** `REDIS_URL=redis://:p%40ss@host:6379` 相当で Redis 認証が成功し、rate limiter が Redis backend を使い続けること。
