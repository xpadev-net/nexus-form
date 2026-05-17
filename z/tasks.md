# nexus-form コードベースレビュー 対応タスク（ラウンド3）

レビュー日: 2026-05-17 / 対象: 全ワークスペース（apps 3 + packages 6、TS/TSX 約 85,000 行）
レビュー手法: agent swarm による 6 領域分担レビュー（apps/api ルート / apps/api 認可・セキュリティ / apps/web ルート・データ層 / apps/web コンポーネント・フック / apps/worker・integrations / packages/database・shared・設定）。

**再レビュー更新（2026-05-17）:** 6 エージェントによる全コードベース再スキャンを実施。既存 R3 タスクの大半が未着手のまま再指摘され（退行ではなく未対応）、加えて新規 Critical 4 件・新規 High 10 件・新規 Medium/Low 多数を検出した。新規分は各フェーズ末尾に `R3-C8` 以降の連番で追記している（既存 ID は PR 参照との整合のため不変）。新規 Critical 4 件（R3-C8〜C11）は実ファイルで再現を確認済み。

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
- **対象:** `apps/web/src/components/forms/google-sheets-integration.tsx:526` ほか、`apps/web/src/components/forms/form-response-settings.tsx:29`、`apps/web/src/lib/validation/validation-providers.ts:16`
- **問題:** これらは `fetch("/api/...")` / `fetchJson(`/api/...`)` のように相対パスでリクエストする。`vite.config.ts` の `server.proxy` は**開発サーバー専用**で本番ビルドでは効かない。本番では Web SPA は API（ポート 3001 / `VITE_API_URL`）と別オリジン配信のため、相対 `/api` は SPA 自身のオリジンに飛び 404/HTML を返す。Google Sheets 連携・回答設定・検証プロバイダ取得が本番で全滅する。
- **修正内容:** 全リクエストを `baseUrl`（`@/lib/api`）起点にする。可能なら hono-rpc `client` 経由に統一（`PATCH /:id/settings/responses` のように API 側ルートが未定義なら、API にルートを追加して型安全化）。最低限 `fetchJson(`${baseUrl}/api/...`)` に統一し `credentials: "include"` を付ける。
- **依存:** なし
- **検証:** 本番相当ビルド（別オリジン構成）で Google Sheets 連携・回答設定・検証プロバイダ取得が動作すること。

### R3-C4. バリデーションプラグインの任意コード実行（RCE）— ハッシュ検証欠如
- **重要度:** 🔴 Critical
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
- **対象:** `apps/worker/src/handlers/sheets-sync.ts:218-245`
- **問題:** `setIdempotencyKey(key, 90, "pending")` → `appendRows` → `setIdempotencyKey(key, 86400, "done")` の順で、`appendRows` 成功後・`"done"` 書込み前のクラッシュ/Redis 障害時、行は書かれたまま冪等性キーは `"pending"`（TTL 90 秒）のまま残る。`attempts: 3` + 指数バックオフ 30 秒（`apps/api/src/lib/queues.ts:16-22`）下でリトライが `"pending"` を見て `throw` し dead-letter 化、90 秒経過後の手動リトライでは**重複行**が発生する。
- **修正内容:** `"done"` キーの TTL を手動リトライ想定窓（例 7 日）より長くする。または `appendRows` の `updatedRange` を `"done"` の値に保存し、`"pending"` 検出時に Sheets を再読込して当該 `responseId` 行の有無を確認してから判断する。
- **依存:** なし
- **検証:** `appendRows` 後のクラッシュをシミュレートしても行欠落・重複が発生しないこと。

### R3-C6. `apiToken.scopes` / `apiToken.formIds` が型なし `json` で zod 検証なし
- **重要度:** 🔴 Critical
- **対象:** `packages/database/src/schema.ts:199-200`、`packages/shared`
- **問題:** `scopes` / `formIds` は API トークン認可（dual-auth）の中核データだが `json` 型のままで、`packages/shared` に検証スキーマが無い。プロジェクト規約「すべての共有データ契約を zod で検証」「`json` カラムは読み出し時に再パース」に違反。不正形状が DB に入ると認可ロジックが予期せぬ挙動になる（権限昇格リスク）。`googleOAuthToken.scopes`、`formValidationRule.configJson`、`systemSetting.value`、`formSnapshot.validationRulesJson`/`plateContent` も同様に未検証。
- **修正内容:** `packages/shared` に `apiTokenScopesSchema` / `apiTokenFormIdsSchema`（`z.array(z.string())` 等）を定義し、書き込み・読み出し双方で `parse` する。上記の他 `json` カラムにも専用スキーマを定義する。
- **依存:** なし
- **検証:** 不正形状の `scopes`/`formIds` が書き込み・読み出し時に弾かれること。

### R3-C7. バリデーションフックのレース未対策・`useCharacterCount` の stale 化
- **重要度:** 🔴 Critical
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
- **対象:** `apps/api/src/routes/fingerprint.ts:243-284`（DELETE `/manage`）
- **問題:** ガード（L250）は `!responseId && !formId && !before` のみを弾くため `formId` 指定があれば通過する。だが `formId` 指定フォームの回答が 0 件のとき `responseIds` が空配列になり、`formId && responseIds.length > 0` 分岐が `undefined` を返す。`responseId`・`before` も未指定なら `and(undefined, undefined, undefined)` で WHERE 句が消滅し、`db.delete(fingerprintDetail)` が **`fingerprintDetail` テーブル全行を削除**する。admin 専用だが回復不能なデータ損失。実ファイルで再現確認済み。
- **修正内容:** `formId` 指定かつ `responseIds.length === 0` の場合は削除を実行せず `{ deleted: 0 }` を返す。または絞り込み句が常に 1 つ以上残ることを保証する（例: `inArray(..., responseIds.length ? responseIds : ["__none__"])`）。最低限、生成された `where` が `undefined` でないことを実行前にアサートする。
- **依存:** なし（最優先・単独着手可）
- **検証:** 回答 0 件のフォーム ID を渡しても他フォームのフィンガープリント行が削除されないこと。

### R3-C9. 共有リンク用 API トークンが `lookupHash` を保存せず認証不能（再レビュー新規）
- **重要度:** 🔴 Critical
- **対象:** `apps/api/src/lib/tokens/share-link-token.ts:111-123`
- **問題:** `createApiTokenForShareLink` の `db.insert(apiToken).values({...})` は `lookupHash` を設定しない（`scopes`/`formIds`/`tokenHash` 等は設定済み）。一方 `validateApiToken`（`apps/api/src/lib/tokens/validate.ts:38-42`）は `eq(apiToken.lookupHash, computeLookupHash(token))` で完全一致検索する。`lookupHash` カラムは nullable（`schema.ts`）のため、共有リンク経由で発行したトークンは **すべての検証で行が見つからず 401 になり、共有リンク機能が機能停止**している。通常トークン発行（`generate.ts`）は `lookupHash` を正しく設定しているため共有リンクのみ壊れている。実ファイルで再現確認済み。
- **修正内容:** `share-link-token.ts` の insert 値に `lookupHash: computeLookupHash(plainToken)` を追加する（`./hash` から `computeLookupHash` を import）。
- **依存:** なし
- **検証:** 共有リンクで発行したトークンが `validateApiToken` で正しく解決されアクセスできること（→ R3-T2 で回帰テスト化）。

### R3-C10. `formStructure` query key 衝突で autosave とアクセス制御更新が相互上書き（再レビュー新規）
- **重要度:** 🔴 Critical
- **対象:** `apps/web/src/hooks/forms/use-form-logic-management.ts:39,48,70,97,113`、`apps/web/src/hooks/forms/use-form-access-control.ts:21,57`
- **問題:** 2 つのフックが同一の query key `["formStructure", formId]` を共有する。`useFormLogicManagement` はロジック編集のたびに `structure` 全体を再取得し `saveStructure` でそのまま PUT し、同キーを invalidate する。`useFormAccessControl` も同キーを読み・invalidate する。両フックが同一画面でマウントされていると、ロジック保存とアクセス制御（パスワード保護等）更新が交差したとき、**古いキャッシュ済み構造で PUT してもう片方の変更を上書き**しうる。フック内 mutex はフック間競合を防げない。実ファイルでキー共有を確認済み。
- **修正内容:** サーバ側 `structure` 更新を version 付き楽観ロックにするのが本筋。短期対策として、(1) ロジックとアクセス制御の更新を別 query key・別 API ルート（差分パッチ）に分離する、(2) 保存前の再取得を `gcTime: 0` で確実にネットワークから取得する。
- **依存:** R3-H15（query key 安定化）と同領域。
- **検証:** ロジック編集とアクセス制御変更を交互に行っても双方の変更が失われないこと。

### R3-C11. 評価質問のラジオグループで複数の `checked` が同時に true（再レビュー新規）
- **重要度:** 🔴 Critical
- **対象:** `apps/web/src/components/form/rating-question.tsx:176,192`
- **問題:** 評価アイコンを同一 `name` の `<input type="radio">` で実装しているが、`checked={isActive}` の `isActive` が `ratingValue <= currentValue`（L176）。「3」を選ぶと 1・2・3 すべての radio が `checked` になる。同一グループ内で複数 radio を制御 `checked` にするのは React の制約違反で、コンソール警告が出るうえ DOM 実選択状態と乖離する。実ファイルで確認済み。
- **修正内容:** input の選択状態は `checked={ratingValue === currentValue}` とする。塗りつぶし表現（`ratingValue <= currentValue`）はアイコンの見た目 prop（`renderIcon` の `isActive`）にのみ用い、選択状態と視覚状態を分離する。
- **依存:** なし
- **検証:** 任意の評価値を選択したとき選択中の radio が 1 つだけになり、コンソール警告が出ないこと。

---

## Phase 1: API High

### R3-H1. `block-analytics` が全回答行をメモリにロードし OOM リスク
- **重要度:** 🟠 High
- **対象:** `apps/api/src/routes/forms-responses.ts:438-475`（`GET /:id/responses/block-analytics`）
- **問題:** 全回答行を `responseDataJson` 付きでメモリにロードし `aggregateAllBlocks` で集計する。回答数が多いフォームで OOM。
- **修正内容:** 集計を SQL 側（`GROUP BY`）へ寄せる、または回答件数の上限/サンプリングを設ける。
- **依存:** なし
- **検証:** 大量回答フォームでメモリ使用量が一定に収まること。

### R3-H2. `POST /services/cache/clear` が `redis.flushdb()` で Redis DB 全体を破壊
- **重要度:** 🟠 High
- **対象:** `apps/api/src/routes/services.ts:301`
- **問題:** `force=true` 分岐で `redis.flushdb()` を呼び、BullMQ ジョブ・SSE Pub/Sub・レートリミットキー・テレメトリトークン等を含む Redis DB 全体を消去する。admin + `force` でガードされていても破壊範囲が過大。
- **修正内容:** `service:cache:*` 等のプレフィックスに限定した `SCAN`+`DEL` に変更し、`flushdb` を廃止する。
- **依存:** なし
- **検証:** キャッシュクリアで BullMQ ジョブ・SSE チャネル等が消えないこと。

### R3-H3. 公開フォーム送信の検証順序（captcha 前に回答バリデーション・DB 操作）
- **重要度:** 🟠 High
- **対象:** `apps/api/src/routes/forms-public.ts:288, 302`
- **問題:** 回答バリデーション（`validateResponseData`, L288）が hCaptcha 検証（L302）より先に実行される。未認証の攻撃者が captcha コストを払わず「フィールド構造が妥当か」のフィードバックを得られ、`processFormSchedule` を含む DB 操作も captcha 前に走る。
- **修正内容:** hCaptcha 検証を最優先に実行し、その後に回答バリデーション・スケジュール処理を行う。
- **依存:** なし
- **検証:** 不正な captcha トークンでは回答バリデーション結果も DB 操作も発生しないこと。

### R3-H4. `processFormSchedule` のエラーが握り潰される
- **重要度:** 🟠 High
- **対象:** `apps/api/src/routes/forms-detail.ts:48`、`apps/api/src/routes/forms-public.ts:183, 257`
- **問題:** `processFormSchedule(...).catch(() => {})` / `.catch(() => null)` で、publish/unpublish/snapshot 切替という状態変更操作の失敗が `logError`/Sentry に届かず完全に消える。
- **修正内容:** 少なくとも `logError` + `captureError` でログ出力する。
- **依存:** なし
- **検証:** スケジュール処理失敗時にログ/Sentry にイベントが残ること。

### R3-H5. ページネーション無しの無制限クエリ
- **重要度:** 🟠 High
- **対象:** `apps/api/src/routes/forms-responses.ts:375-387`（`/responses/ids`）, `:425-436`（`/responses/analytics`）、`forms-structure.ts:318-336`（`/snapshots`）, `:467-474`（`/schedule`）、`forms-validation-rules.ts:29-33`（`/validation-rules`）
- **問題:** いずれも `limit` 無しで全件返却。レコード増加に伴いメモリ・帯域・レイテンシが線形悪化。
- **修正内容:** `limit`/`offset`（またはカーソル）ベースのページネーションを導入する。
- **依存:** R3-H1 と同ファイル（`forms-responses.ts`）のため同時実施を推奨。
- **検証:** 各エンドポイントが上限件数で頭打ちになること。

### R3-H19. `getShareLinkRole` が共有リンクの有効期限を検証しない（再レビュー新規）
- **重要度:** 🟠 High
- **対象:** `apps/api/src/lib/dual-auth.ts:373-391`
- **問題:** `getShareLinkRole`（`withDualFormAuth` / `checkFormAccess` から共有リンク API トークン経由で呼ばれる）は `isActive` と `formId` 一致のみ確認し `expiresAt` を検証しない。一方 `permission-service.ts` の `validateShareLink` および `share-link-token.ts:57` の `validateShareLinkInternal` は `expiresAt` を判定している。結果、**期限切れの共有リンクに紐づく API トークンでフォームへアクセスし続けられる**（ロジック不整合）。
- **修正内容:** `getShareLinkRole` の SELECT に `expiresAt` を加え、`if (link.expiresAt && link.expiresAt <= new Date()) return null;` を追加する。
- **依存:** なし
- **検証:** 期限切れ共有リンク由来のトークンでフォームアクセスが拒否されること。

### R3-H20. VIEWER 共有リンク保持者が全回答・分析データを閲覧できる（再レビュー新規）
- **重要度:** 🟠 High
- **対象:** `apps/api/src/lib/dual-auth.ts:476` 付近、`apps/api/src/routes/forms-responses.ts:262` ほか VIEWER ゲートのルート群
- **問題:** `dual-auth.ts` の共有リンク分岐は `requiredRole === "VIEWER"` のとき role 不問で許可 (`return`) する。`/:id/responses*` 系は `withDualFormAuth("VIEWER")` で保護されているため、**VIEWER 共有リンクの保持者がそのフォームの全回答・回答詳細・ID 一覧・分析データを閲覧可能**になる。同じ懸念が `forms-snapshots.ts`/`forms-structure.ts`/`forms-validation-rules.ts`/`forms-detail.ts` の VIEWER ゲートにも及ぶ。
- **修正内容:** 回答閲覧系エンドポイントは最低でも `EDITOR` を要求するか、共有リンク分岐に「回答閲覧は OWNER/EDITOR の DB 権限を要する」専用判定を追加する。VIEWER 共有リンクの製品仕様（フォーム閲覧・回答のみを意図しているか）をチームで確認のうえ決定する。
- **依存:** なし。保留セクションの「external-service 権限委譲」と同根の論点。
- **検証:** VIEWER 共有リンク由来のトークンで回答一覧・分析エンドポイントが拒否されること。

### R3-H21. 信頼できないヘッダーからの無検証 IP 採用でレート制限・CAPTCHA を回避可能（再レビュー新規）
- **重要度:** 🟠 High
- **対象:** `apps/api/src/lib/rate-limit.ts:19-23`（`getClientIp`）、`apps/api/src/lib/ip-address/strategies.ts:30-56`
- **問題:** `x-forwarded-for` / `x-real-ip` / `cf-connecting-ip` を無条件・無検証で先頭値採用する。リバースプロキシがこれらを上書きしない構成では、攻撃者が任意の `X-Forwarded-For` を送るだけでレート制限キーを変え放題になり、`auth_action`（15 分 10 回）のブルートフォース制限を完全に回避できる。hCaptcha の `remoteip`、テレメトリ IP ハッシュにも波及する。
- **修正内容:** 信頼するプロキシ段数を env（`TRUSTED_PROXY_COUNT`）で持ち、`x-forwarded-for` を分割して末尾から N 番目を採用する。`net.isIP()` で検証し不正値は `unknown` 扱い。プロキシ無し構成ではソケットの remote address を使う。
- **依存:** なし
- **検証:** 偽装 `X-Forwarded-For` を変えてもレート制限キーが固定され、ブルートフォース制限が機能すること。

### R3-H22. S3 プリサインド URL 生成にキー/バケット検証が無くパストラバーサルの恐れ（再レビュー新規）
- **重要度:** 🟠 High
- **対象:** `apps/api/src/lib/s3/client.ts:64-98`（`generatePresignedUrl`/`generatePresignedUploadUrl`）、`apps/api/src/lib/s3/base-service.ts`（`generateDownloadUrl`/`generatePresignedPutUrl`）
- **問題:** 引数 `key` を一切検証せず `GetObjectCommand`/`PutObjectCommand` に渡す。`key` がユーザー入力由来の経路では `prod/../other-tenant/...` のようなキーや他フォームのキーを指定して **任意オブジェクトの署名付き URL を取得**しうる。`moveToProd` の `tmpKey.replace("tmp/", "prod/")` も `tmp/` を含まないキーで無変換のまま本番バケットへ書き込む。
- **修正内容:** プリサインド URL 系関数の入口で `key` を検証する（許可プレフィックス `tmp/` または `prod/` で始まる、`..` を含まない、想定 form/user スコープに一致）。`base-service` 側でキー所有権をルートのコンテキストと突き合わせる。
- **依存:** なし
- **検証:** 不正な `key`（`..` 含む・他ユーザー名前空間）でプリサインド URL 生成が拒否されること。

### R3-H23. テレメトリ IP ソルトの開発デフォルトが固定値で IP を逆引き可能（再レビュー新規）
- **重要度:** 🟠 High
- **対象:** `apps/api/src/lib/telemetry/tokens.ts:6-18`（`hashIPAddress`）
- **問題:** 本番では `TELEMETRY_IP_SALT` 必須だが、非本番では `"default-salt-change-in-production"` の固定値を使う。SHA-256(ip + 既知ソルト) は全 IPv4 空間の総当たりで即座に逆引き可能で、ステージング等で IP（個人情報）が事実上平文同等になる。`sessions/jwt.ts:hashIp` は `AUTH_SECRET` 由来ソルトにフォールバックしており、こちらの方が安全。
- **修正内容:** テレメトリも `AUTH_SECRET` 派生ソルトにフォールバックするか、全環境でランダムソルトを必須にする。
- **依存:** なし
- **検証:** 固定ソルトが使われず、環境ごとに異なるソルトでハッシュされること。

### R3-H24. `FingerprintAnonymizer` のシングルトン Map が無制限蓄積し相関リーク（再レビュー新規）
- **重要度:** 🟠 High
- **対象:** `apps/api/src/lib/fingerprint/anonymizer.ts:44` 付近
- **問題:** プロセス常駐シングルトンが `anonymizedIdMap: Map<string,string>` にフィンガープリントハッシュごとのエントリを永続蓄積する。削除も上限も無く長時間稼働で OOM。さらにリクエスト/フォーム横断でマップが共有されるため、同一フィンガープリントに同じ匿名 UUID が一貫して付与され、**異なるフォーム間で同一回答者の相関が取れてしまう**情報リーク。
- **修正内容:** マップをメソッド呼び出しスコープのローカル変数にする（`getAnonymizedFingerprints` 内で `new Map()`）。シングルトンに横断状態を持たせない。
- **依存:** なし
- **検証:** 長時間稼働でメモリが一定に収まり、別フォームの匿名 ID が相関しないこと。

---

## Phase 2: Worker High

### R3-H6. プロバイダーの `retryAfter` がバックオフに反映されない
- **重要度:** 🟠 High
- **対象:** `apps/worker/src/handlers/generic-validation.ts:263-265`
- **問題:** レート制限時にプロバイダーが返す `result.retryAfter`（秒）を、ハンドラは `throw new Error("Rate limited, retry after Ns")` するだけ。BullMQ は `defaultJobOptions.backoff`（指数 30 秒）で再試行するため、プロバイダー指定の待機時間が完全に破棄される（Discord/GitHub の意図したバックオフが無視される）。
- **修正内容:** `job.moveToDelayed(Date.now() + retryAfter * 1000, token)` を使う、または `retryAfter` をエラーに乗せて BullMQ のカスタムバックオフ関数で読み取る。
- **依存:** なし
- **検証:** プロバイダーが `retryAfter` を返した場合、その時間だけ遅延して再試行されること。

### R3-H7. `ConcurrentDeleteError` が無限リトライ対象になる
- **重要度:** 🟠 High
- **対象:** `apps/worker/src/handlers/generic-validation.ts:97-103`、`apps/worker/src/lib/validation-helpers.ts:225-238`
- **問題:** `markValidationProcessing` は対象行が並行削除されると `ConcurrentDeleteError` を throw するが、`handleGenericValidation` はこれを catch しない。行削除済み（恒久状態）にもかかわらず `attempts: 3` で 3 回再試行される。
- **修正内容:** `markValidationProcessing` 呼び出しを try/catch で囲み、`ConcurrentDeleteError` の場合は `writeValidationResult` を行わず `return { ok: false, error: "Result row deleted" }` で正常終了する。
- **依存:** なし
- **検証:** 検証中に回答が削除されてもジョブが即座にターミナル化し再試行されないこと。

### R3-H8. Discord の fetch にタイムアウトが無い
- **重要度:** 🟠 High
- **対象:** `packages/validation-provider-discord/src/requests.ts:32-56`、`plugin.ts:142-156`（`fetchUserGuilds`）
- **問題:** `discordFetchWithRetry` / `fetchUserGuilds` の `fetch` が `AbortSignal` を設定しておらず、Discord 接続がハングすると Worker の concurrency スロット（5）を無期限に占有する。Google Sheets クライアントや `pingDiscordApi` が timeout を設定しているのと非対称。
- **修正内容:** `signal: AbortSignal.timeout(DISCORD_API_TIMEOUT_MS)` を全 `fetch` に追加。タイムアウト値は env から読む（`parsePositiveIntEnv` を共有化）。
- **依存:** なし
- **検証:** Discord 応答がハングしてもジョブが一定時間で失敗し、スロットが解放されること。

### R3-H9. API/Worker のプラグインドリフトに実行時ガードが無い（旧 R2-M7 継続）
- **重要度:** 🟠 High
- **対象:** `apps/worker/src/index.ts`、`packages/integrations/src/startup.ts:49-83`
- **問題:** CLAUDE.md は API と Worker が同一プラグインを読むことを必須とするが、`startupPlugins` はマニフェスト比較・ハッシュ交換・起動時アサーションを一切行わない。片側のみにプラグインを追加/再起動すると、API が `${provider}-validation` キューに enqueue しても Worker が該当 Worker を生成せずジョブが無言で滞留する。
- **修正内容:** 起動時に登録プロバイダー名 + 各 `.mjs` の SHA-256 のセットを Redis に記録し、API/Worker 間で照合。不一致なら起動失敗または警告/メトリクス化する。
- **依存:** R3-C4 と同じ起動経路のため同時実施を推奨。
- **検証:** 片側のみにプラグインを追加した状態で不一致が検出されること。

### R3-H10. グローバル例外ハンドラが graceful shutdown を経由しない
- **重要度:** 🟠 High
- **対象:** `apps/worker/src/index.ts:78-88`
- **問題:** `unhandledRejection` / `uncaughtException` ハンドラが `gracefulShutdown` を呼ばず `process.exit(1)` する。実行中の BullMQ ジョブが `worker.close()` でドレインされず、Redis 上で stalled job として `lockDuration` 経過まで残る。
- **修正内容:** ハンドラ内で `gracefulShutdown` を呼ぶ（`uncaughtException` 後はプロセス状態不定のため短いタイムアウトで強制終了するのは現状維持で可）。最低限 `unhandledRejection` は graceful path を試みる。
- **依存:** なし
- **検証:** 例外発生時に実行中ジョブがドレインされてから終了すること。

### R3-H25. `isTokenExpired` が破損 `expiryDate` でリフレッシュを無効化する（再レビュー新規）
- **重要度:** 🟠 High
- **対象:** `apps/worker/src/lib/oauth-token-store.ts:98-102`
- **問題:** `isTokenExpired` は `Date.parse` が `NaN` のとき `false`（＝期限内）を返す。`expiryDate` が破損していると **OAuth トークンが永久にリフレッシュされず**、Google Sheets API 呼び出しが 401 で失敗し続ける。
- **修正内容:** 解釈不能な `expiryDate` は期限切れ扱い（`true`）にするか、明示的にエラーを投げる。
- **依存:** なし
- **検証:** 破損した `expiryDate` でトークンリフレッシュが発火すること。

### R3-H26. BullMQ ジョブペイロードが zod 検証されていない（再レビュー新規）
- **重要度:** 🟠 High
- **対象:** `apps/worker/src/handlers/generic-validation.ts:54-66`、`apps/worker/src/handlers/sheets-sync.ts:26-40`
- **問題:** `GenericValidationJob` / `SheetsSyncJob` は TypeScript の型注釈のみで、ハンドラ境界で `job.data` を zod 検証していない。ジョブペイロードは Worker にとってのリクエスト境界であり、CLAUDE.md「全リクエスト/レスポンスを zod スキーマで検証」に違反する。enqueue 側のバグや旧形式のジョブが残ると `undefined` が下流へ流れる。R3-C6（DB の `json` カラム検証）とは別問題。
- **修正内容:** 各ジョブの zod スキーマを定義し、ハンドラ冒頭で `schema.parse(job.data)` する。`@nexus-form/shared` に置けば enqueue 側（API）と共有できる。
- **依存:** R3-C6 と同じ「zod 契約整備」方針。
- **検証:** 不正形状のジョブペイロードがハンドラ冒頭で弾かれること。

### R3-H27. バリデーションプロバイダーの `inputSchema` が文字種を検証しない（再レビュー新規）
- **重要度:** 🟠 High
- **対象:** `packages/validation-provider-discord/src/plugin.ts:23`、`packages/validation-provider-github/src/plugin.ts:11`、`packages/validation-provider-twitter/src/plugin.ts:11`
- **問題:** `DiscordInputSchema` 等は `z.string().min().max()` で**長さのみ**検証する。Worker は `inputSchema.parse` → `normalizeInput` → 再 `inputSchema.parse` の順で処理する（`generic-validation.ts`）ため、`patternTemplate.pattern`（`^[a-zA-Z0-9_.]{2,32}$` 等）はサーバーサイドで一切適用されない。結果、`searchGuildMembers` のクエリや GitHub の URL パスへ任意文字種の回答者入力が到達する（Twitter は `validate()` 冒頭の `isValidTwitterUsername` で救済されるが Discord/GitHub は無防備）。
- **修正内容:** 各 `inputSchema` を `z.string().regex(...)` で `patternTemplate.pattern` と同一の文字種制約にする。Twitter のインライン検証も `inputSchema` に統合し一貫させる。
- **依存:** なし
- **検証:** パターン外の文字を含む入力が `inputSchema.parse` で弾かれ外部 API に到達しないこと。

### R3-H28. Redis チャンネル名ヘルパーが `formId` を無検証で連結（再レビュー新規）
- **重要度:** 🟠 High
- **対象:** `packages/shared/src/sse-events.ts:48-54`（`getValidationChannel`/`getEditorChannel`）
- **問題:** 任意文字列を受け取り長さ・文字種の制約なしに `form:validation:${formId}` を生成する。共有ユーティリティとして export される以上、呼び出し側がサーバー生成 ID を渡す前提に依存すべきでない。`formId` に `*` や改行が含まれると `PSUBSCRIBE` パターン汚染や別チャンネル混入のリスク。
- **修正内容:** ヘルパー内で `z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).parse(formId)` 相当の検証を行い、不正値で例外を投げる。
- **依存:** なし
- **検証:** 不正な `formId`（`*`・改行含む）でチャンネル名生成が拒否されること。

---

## Phase 3: Frontend High

### R3-H11. SSE のエラー時に無限再接続が発生する
- **重要度:** 🟠 High
- **対象:** `apps/web/src/hooks/use-editor-sse.ts:53-55`、`apps/web/src/hooks/use-validation-sse.ts`
- **問題:** `EventSource` はエラー時にブラウザが自動再接続するが、API が 401/403/404（権限喪失・フォーム削除）を返し続けても止まらず数秒ごとに再接続を試み続ける。`use-validation-sse.ts` には `error` リスナーすら無く、`use-editor-sse.ts` の `error` ハンドラは空。
- **修正内容:** `error` イベントで `readyState === EventSource.CLOSED` を検知し、恒久エラー（認証失敗等）なら明示的に `close()` する。または再接続回数の上限/バックオフを設ける。`use-validation-sse.ts` にも `error` ハンドラを追加。
- **依存:** R3-H12 と同ファイル群のため同時実施を推奨。
- **検証:** 403/404 を返す SSE エンドポイントに対し再接続が停止すること。

### R3-H12. SSE 接続がタブ非アクティブ時も維持されリソースを浪費
- **重要度:** 🟠 High
- **対象:** `apps/web/src/hooks/use-editor-sse.ts:47-110`、`apps/web/src/hooks/use-validation-sse.ts:16-49`
- **問題:** `formId` がある限り `EventSource` を開きっぱなし。回答タブが一度開くと `hidden` で保持されるため、タブを離れても validation SSE 接続が残り、editor SSE と合わせ 2 本が常時開く。`visibilitychange` での一時停止が無い。
- **修正内容:** `document.visibilitychange` で非表示時に `close()`、復帰時に再接続する。非アクティブな回答タブでは `useValidationSSE` を実質無効化する（`formId` を条件付きで渡す）。
- **依存:** R3-H11 と同時。
- **検証:** タブ非アクティブ時に SSE 接続が閉じられること。

### R3-H13. 検証タブが未保存 draft コンテンツを使い、サーバー保存済みルールと不整合
- **重要度:** 🟠 High
- **対象:** `apps/web/src/components/forms/form-editor-page.tsx:345-352`
- **問題:** `FormValidationRulesPage` に `plateContent={draftContent ?? plateContent}` を渡す。検証ルールは `referencedBlockIds` でブロックを参照するが、autosave のデバウンス（2 秒）中にルールを作成・編集すると未保存ブロック ID を参照したルールや、削除済みブロックを参照したルールが生まれる。
- **修正内容:** 検証タブを開く際に編集内容を確実にサーバー保存してから保存済み `contentQuery.data` を渡す。または編集中は検証タブで保存待ちの注意を表示する。
- **依存:** R3-H14 と同ファイル。
- **検証:** autosave 未完了状態で検証ルールを作成しても無効ブロック参照が生まれないこと。

### R3-H14. `restore-edit` スナップショット復元が autosave のローカル編集と競合
- **重要度:** 🟠 High
- **対象:** `apps/web/src/hooks/forms/use-snapshots.ts:104`、`apps/web/src/hooks/forms/use-form-content-autosave.ts:82-106`
- **問題:** `restoreEditFromSnapshotMutation` の `onSuccess` で `["formContent", formId]` を無効化・再取得するが、autosave フックは `hasLocalEdits` が true だとローカル編集を守るため、ユーザーが直前に編集していると復元したサーバー内容が反映されない（リストア操作の意図と矛盾）。
- **修正内容:** `restore-edit` 実行時は autosave のローカル編集状態をリセット（`editorValueRef.current = baseContentRef.current` 相当）してから無効化する。
- **依存:** R3-H13 と同領域。
- **検証:** ローカル編集中にスナップショット復元しても復元内容が確実に反映されること。

### R3-H15. React Query のキーに不安定なオブジェクト参照を使用し refetch ストーム
- **重要度:** 🟠 High
- **対象:** `apps/web/src/hooks/forms/use-share-links.ts:36`、`apps/web/src/hooks/forms/use-form-permissions.ts:48, 64`
- **問題:** `queryKey: ["shareLinks", formId, params]` のように呼び出し側が毎レンダー生成するオブジェクトをキーに入れている。`undefined` プロパティの有無や順序差で別キー扱いとなりキャッシュミス・refetch ストームの原因になる。
- **修正内容:** キーにはプリミティブのみ、または正規化済みの安定値を入れる（例: `[formId, params.page ?? null, params.limit ?? null, params.isActive ?? null]`）。
- **依存:** なし
- **検証:** 同一パラメータで再レンダーしても refetch が発生しないこと。

### R3-H16. `long-text-question` が入力値を `trim()` し空白入力ができない
- **重要度:** 🟠 High
- **対象:** `apps/web/src/components/form/long-text-question.tsx:98-120`
- **問題:** `sanitizeInput` が `value.trim()` を毎キーストロークに適用するため、長文回答途中のスペース・改行・段落の空行が入力できず、IME 変換中の挙動も壊れる。`onChange` にトリム済み値が渡るため意図した値を保存できない。
- **修正内容:** 入力中のトリムをやめる。トリムが必要なら送信時/バリデーション時のみに行い、`handleChange` は `newValue` をそのまま `onChange` に渡す。
- **依存:** なし
- **検証:** 長文回答に空行・末尾スペースを含む入力がそのまま保存できること。

### R3-H17. 手書き `memo` 比較関数が壊れている（stale クロージャ）
- **重要度:** 🟠 High
- **対象:** `apps/web/src/components/form/long-text-question.tsx:216-271`、`apps/web/src/components/form/checkbox-grid-question.tsx:260-337`
- **問題:** `memo` の第2引数の手書き比較関数が `onChange` プロップを比較しておらず、親が毎レンダー新しい `onChange` を渡すと古いクロージャを保持し続ける。`CheckboxGridQuestion` はさらに `block.validation` を `as { ... }` で広くキャスト（規約違反）。
- **修正内容:** 手書き比較関数を削除しデフォルトの浅い比較に任せる。親側で `onChange`・`block` を `useCallback`/`useMemo` で安定化する。
- **依存:** なし
- **検証:** 親の再レンダーで `onChange` が更新されても最新のハンドラが呼ばれること。

### R3-H18. `block-validation-editor` が静的 `id` 属性を多用しページ内 ID 衝突
- **重要度:** 🟠 High
- **対象:** `apps/web/src/components/form/block-validation-editor.tsx`（`min-length`/`max-length`/`pattern`/`allow-other`/`scale-min`/`min-date` 等多数）
- **問題:** `<Label htmlFor="min-length">` と `<Input id="min-length">` が固定文字列。同一画面に複数のブロックバリデーションエディタが存在するとき `id` が重複し、ラベル関連付け・スクリーンリーダー・クリックフォーカスが壊れる。
- **修正内容:** `useId()` でプレフィックスを生成するか `question.blockId` を組み込んだ ID にする（他の質問コンポーネントと整合させる）。
- **依存:** R3-M フロント分割（巨大ファイル分割）と同ファイルのため順序調整。
- **検証:** 同一画面に複数エディタがあっても `htmlFor` が正しく対応すること。

---

## Phase 4: Medium

### R3-M1. レスポンス用 zod スキーマが未適用のルートが残存
- **重要度:** 🟡 Medium
- **対象:** `apps/api/src/routes/forms-content.ts`、`forms-structure.ts`、`forms-integrations.ts`、`forms-permissions.ts`、`forms-validation-rules.ts`、`s3.ts`、`auth.ts`、`sessions.ts`、`csrf.ts`、`forms-invites.ts` ほか
- **問題:** プロジェクト規約「API ルートはペイロードとレスポンス両方に専用 zod スキーマを定義し推論型をエクスポート」に対し、上記ルートが `c.json({...})` で素のオブジェクトを返し `.parse()` を通していない（旧 R2-H6 が主要ルートを対応済みだが網羅されていない）。
- **修正内容:** 各ルートに `*ResponseSchema` を定義し `.parse()` を通す。推論型を `@nexus-form/shared` 経由でエクスポート。
- **依存:** なし（件数が多いため計画的に分割着手）
- **検証:** 対象ルートのレスポンスが zod スキーマを通過すること。

### R3-M2. `as` キャストの多用（プロジェクト規約違反）
- **重要度:** 🟡 Medium
- **対象:** `apps/api/src/lib/integrations/external-service.ts:82`、`integrations-google.ts:85`、`fingerprint.ts:174`、`apps/api/src/routes/tokens.ts:182-189`（`scopes?: unknown`）、`apps/worker/src/handlers/generic-validation.ts:197-209`、`sheets-sync.ts:60,64`、`oauth-token-store.ts:54`、`packages/validation-provider-github/src/client.ts:83-92`、`apps/web` の `useOtherOption.ts:18`、`form-editor-page.tsx:53,54,241`
- **問題:** CLAUDE.md が抑制を求める `as` キャストが各所に残存。型ガード/zod narrowing で代替できる箇所が多い。
- **修正内容:** 型ガード関数・zod `safeParse`・判別共用体での narrowing に置き換える。エラー構造（`code`/`status`/`retryAfter`）には専用 zod スキーマを定義。
- **依存:** なし
- **検証:** 対象箇所の `as` が除去され型チェックが通ること。

### R3-M3. 認証ガードの重複（`_authenticated` と `preview/$id`）
- **重要度:** 🟡 Medium
- **対象:** `apps/web/src/routes/_authenticated/route.tsx:14-24`、`apps/web/src/routes/forms/preview/$id.tsx:6-16`
- **問題:** `preview` ルートが `_authenticated` の認証ガードを独自に複製しており DRY 違反・ドリフトの温床。
- **修正内容:** 認証ガードを共通ヘルパー（`requireAuth`）に切り出し両ルートで共有する。
- **依存:** なし
- **検証:** 両ルートが同一の認証ロジックを共有すること。

### R3-M4. ページ送り時のローディング無しでデータがちらつく
- **重要度:** 🟡 Medium
- **対象:** `apps/web/src/components/forms/form-responses-page.tsx:131-145`
- **問題:** `placeholderData: keepPreviousData` 未使用のため、ページネーション時に一瞬空表示→新データのちらつきが起きる。
- **修正内容:** `placeholderData: keepPreviousData` を設定し `isFetching` でローディングインジケータを出す。
- **依存:** なし
- **検証:** ページ送り時に空表示のちらつきが無いこと。

### R3-M5. クライアントサイドのキーワード検索がページ内のみで誤解を生む
- **重要度:** 🟡 Medium
- **対象:** `apps/web/src/components/forms/form-responses-page.tsx:43-53`
- **問題:** `filteredResponses` が現在ページの 20 件だけをフィルタするが、ユーザーは全件検索のつもりになる。`data.total` 表示と相まって UX が誤解を招く。
- **修正内容:** 検索をサーバーサイドのクエリパラメータ（`keyword`）に渡す。即時対応が難しければ「現在ページ内検索」と UI 上明示する。
- **依存:** R3-H5（`forms-responses` ページネーション）と関連。
- **検証:** 検索が全件に対して機能する、または範囲が明示されること。

### R3-M6. `invite`/`shared` ページが手書き `useEffect` フェッチで react-query 規約違反
- **重要度:** 🟡 Medium
- **対象:** `apps/web/src/components/forms/invite-acceptance-page.tsx:39-77`、`apps/web/src/components/forms/shared-form-page.tsx:28-67`
- **問題:** データ取得を `useEffect` + `useState` で手書きしており、CLAUDE.md「データ取得は `@tanstack/react-query`」に違反（旧 R2-M12 で `public-form-page` は対応済みだが本 2 ページは未対応）。
- **修正内容:** `useQuery` に移行。404 は `RpcError` 判定でハンドリング。
- **依存:** なし
- **検証:** 取得・エラー・再取得が `useQuery` 経由で動作すること。

### R3-M7. `form-response-settings` の生 `fetch` がエラー契約を分裂させる
- **重要度:** 🟡 Medium
- **対象:** `apps/web/src/components/forms/form-response-settings.tsx:28-43`
- **問題:** `rpc()`/`fetchJson()` と重複するエラー処理を再実装し、エラー契約が 3 系統（`RpcError`/`HttpError`/素の `Error`）に分裂。
- **修正内容:** API 側に `PATCH /:id/settings/responses` ルートを zod スキーマ付きで定義し `client` 経由に統一する。
- **依存:** R3-C3（同ファイルの相対パス修正）と同時実施を推奨。
- **検証:** エラー処理が `rpc()`/`RpcError` に一本化されること。

### R3-M8. SSE スキーマ `safeParse` 失敗が無言で無視される
- **重要度:** 🟡 Medium
- **対象:** `apps/web/src/hooks/use-editor-sse.ts:65-66`、`apps/web/src/hooks/use-validation-sse.ts:30-31`
- **問題:** `safeParse` 失敗時に `return` するだけでログが残らず、サーバー側イベントスキーマがドリフトするとリアルタイム更新が黙って止まる。
- **修正内容:** 開発環境で `logger.warn` を出す。
- **依存:** R3-H11/H12 と同ファイル。
- **検証:** 不正イベント受信時に開発ログに警告が出ること。

### R3-M9. Worker シャットダウン時に Redis publisher / queue 接続がリーク
- **重要度:** 🟡 Medium
- **対象:** `apps/worker/src/lib/redis-publisher.ts`、`apps/worker/src/lib/queue-metrics.ts:33-42`
- **問題:** `redis-publisher.ts` に `closePublisher` が無く、`gracefulShutdown` は workers と `lockClient` のみ閉じる。`queueCache` の `Queue` インスタンス（各 Redis 接続保持）も `.close()` されない。
- **修正内容:** `closePublisher()` と `closeMetricsQueues()` を実装し `gracefulShutdown` から呼ぶ。
- **依存:** R3-H10 と同領域。
- **検証:** シャットダウン後に Redis 接続が残らないこと。

### R3-M10. Twitter クライアントのシングルトンがトークンローテーション不可
- **重要度:** 🟡 Medium
- **対象:** `packages/validation-provider-twitter/src/client.ts:136-146`
- **問題:** `twitterClient` が初回呼び出し時の `TWITTER_BEARER_TOKEN` を束縛してキャッシュし、トークンをローテーションしても Worker 再起動まで反映されない（GitHub 側は対応済み）。
- **修正内容:** シングルトンを廃止し毎回生成する、または env 変更検知でキャッシュ破棄する。
- **依存:** なし
- **検証:** トークン変更後、Worker 再起動なしで新トークンが使われること。

### R3-M11. Discord の `pLimit(3)` がプロセスローカルでマルチレプリカ時に無効
- **重要度:** 🟡 Medium
- **対象:** `packages/validation-provider-discord/src/requests.ts:26`
- **問題:** `pLimit(3)` は単一プロセス内の同時実行のみ制限。Worker を複数レプリカで動かすと Discord への実効並列度がレプリカ数倍になり、レート制限保護として誤った安心感を与える。
- **修正内容:** Discord 用キューの `concurrency` を 1 に絞って単一ワーカーに集約する、または Redis ベースの分散レートリミッタで制御する。
- **依存:** R3-M12（concurrency 設定化）と関連。
- **検証:** 複数レプリカ構成でも Discord への並列度が制御されること。

### R3-M12. Worker の concurrency がハードコード
- **重要度:** 🟡 Medium
- **対象:** `apps/worker/src/lib/worker-factory.ts:11`
- **問題:** `concurrency: 5` 固定で env から設定できず、プロバイダーごとのレート制限に合わせた調整ができない。
- **修正内容:** `parsePositiveIntEnv("WORKER_CONCURRENCY", 5)` を導入し、必要に応じてキュー名ごとにオーバーライド可能にする。
- **依存:** R3-M11 と関連。
- **検証:** env で concurrency を変更でき、キュー別オーバーライドが効くこと。

### R3-M13. `field-encryption` の `scryptSync` がリクエストごとに実行
- **重要度:** 🟡 Medium
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

### R3-M15. ユーザー参照カラムに FK が無く孤立する・型長不一致
- **重要度:** 🟡 Medium
- **対象:** `packages/database/src/schema.ts`：`formShareLink.createdBy:272`、`formInvitation.invitedBy:326`、`formStructure.createdBy:352`、`formSnapshot.publishedBy:480`、`userInvite.invitedBy:456`、`formIntegration.ownerUserId:292`/`userId:293`、`validationDiscordRole.guildId:719`
- **問題:** `relations()` では `user`/`validationDiscordGuild` を参照しているが、カラム定義に `.references()` が無く DB レベルの FK が存在しない。ユーザー/ギルド削除でこれらの行が孤立する。さらに `user.id` は `varchar(191)` なのにユーザー参照カラムは `varchar(255)` で型長不一致のため FK 後付けが失敗する。
- **修正内容:** ユーザー参照カラムの長さを `191` に揃え `.references(() => user.id, { onDelete: ... })` を付与（`onDelete` は監査要件で決定）。`validationDiscordRole.guildId` に `onDelete: "cascade"` の FK を付与。要マイグレーション。
- **依存:** なし
- **検証:** 参照先削除時に子行が FK 制約どおり処理されること。

### R3-M16. docker-compose が弱いクレデンシャルで全ポートを公開
- **重要度:** 🟡 Medium
- **対象:** `docker-compose.yml`（MySQL `3306`、MinIO `9000`/`9001`、Redis `6379`）
- **問題:** ハードコードされた弱いパスワード（`nexus_root_password`/`minioadmin123`）がコミットされ、全ポートが `0.0.0.0` にバインドされる。Redis は `requirepass` なしで無認証。同一ネットワークの他端末からアクセス可能。
- **修正内容:** ポートバインドを `127.0.0.1:3306:3306` 等のループバック限定にする。クレデンシャルは `.env` から `${MYSQL_ROOT_PASSWORD}` 形式で注入。Redis に `--requirepass` を付与。
- **依存:** なし
- **検証:** ループバック外からサービスに到達できないこと。

### R3-M17. 巨大コンポーネントの分割
- **重要度:** 🟡 Medium
- **対象:** `apps/web/src/components/form/block-validation-editor.tsx`（約 1060 行）、`apps/web/src/components/forms/google-sheets-integration.tsx`（約 1030 行）ほか 1000 行超ファイル
- **問題:** CLAUDE.md「肥大化したコンポーネントは焦点を絞ったサブコンポーネントに分割」に反する（旧 R2-M16 で一部対応済みだが残存）。
- **修正内容:** type 別レンダラーごとにファイル分割。`google-sheets-integration` は接続/選択/同期で分離。
- **依存:** R3-H18（同ファイル `block-validation-editor`）の後に着手。
- **検証:** 各ファイルが読みやすい行数に収まり機能が維持されること。

### R3-M18. `useFormLogic` のメモ化が `responses` 全体依存で実質無効
- **重要度:** 🟡 Medium
- **対象:** `apps/web/src/hooks/forms/use-form-logic.ts:31-154`
- **問題:** `getVisibleQuestions` 等を `useCallback`/`useMemo` で包むが依存配列が `[sections, responses]`。回答が 1 文字変わるたびに全コールバック・全メモが再計算され、巨大フォームで毎キーストロークごとに全ルール走査が走る。
- **修正内容:** メモ化を外す、または `responses` のうちルールが実際に参照するキーのみに依存を絞る。あるいは `evaluateRule` の結果をルール単位でキャッシュする。
- **依存:** なし
- **検証:** 入力ごとの再計算コストが削減されること。

### R3-M19. Google OAuth の `redirect_uri` がリクエスト Origin にフォールバック（再レビュー新規）
- **重要度:** 🟡 Medium
- **対象:** `apps/api/src/routes/integrations-google.ts:197-202, 260-265`
- **問題:** `NEXT_PUBLIC_BASE_URL` 未設定時、`c.req.header("origin")`（攻撃者制御可能）を `redirect_uri` のベースに使う。Google 側ホワイトリストで通常はブロックされるが、設定ミス時にオープンリダイレクト/トークン窃取の温床となる。
- **修正内容:** `redirect_uri` は環境変数の固定値のみを使用し、未設定時はエラーにする。
- **依存:** なし
- **検証:** リクエスト Origin ヘッダーが `redirect_uri` に影響しないこと。

### R3-M20. 招待取得エンドポイントが未認証で招待者メール（PII）を漏洩（再レビュー新規）
- **重要度:** 🟡 Medium
- **対象:** `apps/api/src/routes/forms-invites.ts:11-38`（GET `/invites/:token`）
- **問題:** 未認証でアクセス可能で `email`（PII）・`role`・`formTitle`・`message` を返す。`:token` の形式/長さ検証が無く、レート制限は IP 単位のみ（トークン単位ではない）。
- **修正内容:** レスポンスからメールアドレスを除外（または受信者本人セッション時のみ返す）。`:token` に zod 形式検証を追加。
- **依存:** なし
- **検証:** 未認証アクセス時にメールアドレスが返らないこと。

### R3-M21. パスワード保護フォームのフェイルオープン（再レビュー新規）
- **重要度:** 🟡 Medium
- **対象:** `apps/api/src/routes/forms-public.ts:343`
- **問題:** `if (pwProtection?.enabled && pwProtection.password)` は `enabled=true` でも `password` が空/欠落のときゲートをスキップし、検証なしで送信を許可する。`forms-structure.ts:171-183` の PUT 経路にガードはあるが、競合書き込み次第で `enabled:true, password:undefined` が残る余地がある。
- **修正内容:** `enabled` のみで保護必須と判定し、`password` 欠落時は送信を拒否（フォーム設定不備エラー）する。
- **依存:** なし
- **検証:** `enabled:true` かつパスワード未設定のフォームで送信が拒否されること。

### R3-M22. hCaptcha 検証が `hostname` を確認しない（再レビュー新規）
- **重要度:** 🟡 Medium
- **対象:** `apps/api/src/lib/security/hcaptcha.ts:194-219`（`verifyHCaptchaToken`）
- **問題:** hCaptcha レスポンスの `success`・スコアのみ確認し `hostname` を検証しない。別オリジンで取得されたトークンも通過する。リプレイ対策の `challenge_ts` 鮮度チェックも無い。
- **修正内容:** `validatedData.hostname` を期待ドメインと照合し、`challenge_ts` が一定時間内かを確認する。
- **依存:** なし
- **検証:** 別ホスト名のトークンが拒否されること。

### R3-M23. Worker の OAuth 暗号鍵が `AUTH_SECRET` にフォールバック（再レビュー新規）
- **重要度:** 🟡 Medium
- **対象:** `apps/worker/src/lib/field-encryption.ts:13-17`
- **問題:** `GOOGLE_OAUTH_ENC_KEY` 未設定時に認証用 `AUTH_SECRET` を流用する。`AUTH_SECRET` のローテーションで保存済み OAuth トークンが全て復号不能になる。
- **修正内容:** 鍵の用途を分離し、専用鍵未設定時はフォールバックせずエラーにする。
- **依存:** R3-M13（同ファイルの鍵キャッシュ）と同領域。
- **検証:** 専用鍵未設定で起動が失敗すること、`AUTH_SECRET` 変更が保存済みトークンに影響しないこと。

### R3-M24. `objectExists` があらゆる例外で `false` を返す（再レビュー新規）
- **重要度:** 🟡 Medium
- **対象:** `apps/api/src/lib/s3/utils.ts:70-85`
- **問題:** `catch (_error) { return false }` で、ネットワーク障害・認証エラー・権限エラーも「存在しない」と扱う。「存在する」前提のロジックでこの結果を使うと静かに誤動作する。
- **修正内容:** 404 系のみ `false`、それ以外は throw に分離する。`utils.ts:109` の未使用変数 `_chunks` も削除。
- **依存:** なし
- **検証:** S3 障害時に `objectExists` が誤って `false` を返さないこと。

### R3-M25. `spreadsheetId` の URL エンコード欠落（再レビュー新規）
- **重要度:** 🟡 Medium
- **対象:** `apps/worker/src/lib/google-sheets-client.ts:112`（`appendRows` ほか `readRange`/`updateRange`）
- **問題:** エンドポイント組み立てで `sheetName` は `encodeURIComponent` 済みだが `spreadsheetId` は未エンコード。現状 ID は英数字のみで悪用不可だが一貫性を欠く。
- **修正内容:** `spreadsheetId` を含む全パスセグメントを `encodeURIComponent` する。
- **依存:** なし
- **検証:** 全 Sheets API 呼び出しのパスセグメントがエンコードされること。

### R3-M26. プロバイダーの `retryAfter` 単位ドリフトとエラーコード網羅の不一致（再レビュー新規）
- **重要度:** 🟡 Medium
- **対象:** `packages/validation-provider-discord/src/plugin.ts:340-363`、`packages/validation-provider-github/src/plugin.ts:98-125`、`packages/validation-provider-twitter/src/utils.ts:37-55`
- **問題:** (1) `ValidationProviderResult.retryAfter` は秒だが Discord/Twitter は `30`/`60` をハードコードし API 応答の実 `retry_after` を使わない。`discord/src/utils.ts:getRateLimitRetryAfter` はミリ秒を返し単位不整合。(2) Discord は 401（ボットトークン失効）を扱わず `DISCORD_API_ERROR` に丸める。GitHub プラグインの `catch` は rate-limit のみ判定し `client.ts` が付与した `code` を活用しない。Twitter は 429/401/403/404 を網羅しており、3 プロバイダー間でドリフトしている。
- **修正内容:** 429 ハンドリングで実 `retry_after` を秒換算して返す（R3-H6 と連動）。Discord に 401→認証エラーコードを追加。GitHub プラグインの `catch` で `structured.code` を `errorCode` に反映。3 プロバイダーで共通のエラー分類方針に揃える。
- **依存:** R3-H6（`retryAfter` のバックオフ反映）と関連。
- **検証:** 各プロバイダーが API 応答の実待機時間と認証失敗を正しく分類すること。

---

## Phase 5: Low

### R3-L1. `getCorsOrigins()` の重複定義
- **重要度:** 🟢 Low / **対象:** `apps/api/src/index.ts:51-75`、`apps/api/src/routes/telemetry.ts:10-23`
- **修正内容:** ほぼ同一の CORS オリジン解決ロジックを共通ヘルパーに抽出する。

### R3-L2. `forms-responses` のリトライ処理が素の `console` を使用
- **重要度:** 🟢 Low / **対象:** `apps/api/src/routes/forms-responses.ts:105,147,161` 付近
- **問題:** `enqueueValidationRetries` が構造化ロガー `logError`/`logWarn` ではなく素の `console` を使い、ログ集約・Sentry から漏れる。
- **修正内容:** 構造化ロガーに統一する。

### R3-L3. デッドコードの除去
- **重要度:** 🟢 Low / **対象:** `apps/api/src/routes/_helpers.ts`（`notImplemented`/`ok` 未使用）、`apps/api/src/lib/forms/schedule-processor.ts:55-59`（空の `if (userId)` ブロック）、`apps/worker/src/handlers/generic-validation.ts:43-52`（`RETRYABLE_CODES` 到達不能）、`packages/validation-provider-twitter/src/config.ts:38-53`（未使用 `retryAttempts`/`retryDelay`）
- **修正内容:** 各デッドコードを削除する。`schedule-processor` の `userId` 引数も実質未使用なら整理。

### R3-L4. `avatar.ts` のリダイレクト URL が不正
- **重要度:** 🟢 Low / **対象:** `apps/api/src/routes/avatar.ts:13`
- **問題:** `https://cdn.discordapp.com/avatars/${userId}` はアバターハッシュ・拡張子が欠落し有効な CDN URL にならない。`apps/web` 内に呼び出し元が見当たらず未使用の可能性が高い。
- **修正内容:** 未使用なら当エンドポイントを削除。使用する場合は `/avatars/{id}/{hash}.png` 形式の正しい URL を構築する。

### R3-L5. `field-encryption` 以外のシングルトン/設定の非対称・整合性
- **重要度:** 🟢 Low / **対象:** `apps/api/src/lib/auth.ts`（`signin-with-invitation` が `AUTH_SECRET` のみ参照、`auth.ts` 本体は `BETTER_AUTH_SECRET` も許容）、`packages/validation-provider-discord/src/plugin.ts:184`（`inputPattern` が大文字を許容するが現行 Discord ユーザー名は小文字のみ）、`packages/validation-provider-twitter/src/plugin.ts:143`（ヘルスチェックが疑わしいエンドポイント `openapi.json`）
- **修正内容:** シークレット参照を統一。Discord パターンを小文字のみに揃える。Twitter ヘルスチェックを安定したエンドポイント/判定に見直す。

### R3-L6. `__root.tsx` にエラーバウンダリ未設定
- **重要度:** 🟢 Low / **対象:** `apps/web/src/routes/__root.tsx:5-13`
- **問題:** `notFoundComponent` はあるが `errorComponent` が無く、ローダー/レンダリングの未捕捉エラーで本番にユーザーフレンドリーなページが出ない。
- **修正内容:** ルートに `errorComponent` を設定する。

### R3-L7. アクセシビリティの軽微な不足
- **重要度:** 🟢 Low / **対象:** `apps/web/src/components/form/question-sorter.tsx:36-51`（並べ替えボタンに `aria-label` 無し）、`form-editor-page.tsx`（タブが `role="tablist"` 非準拠、ローディング表示に `aria-live` 無し）
- **修正内容:** 並べ替えボタンに `aria-label`、タブ群を WAI-ARIA Tabs パターン（Radix `Tabs` 流用可）に、状態表示に `role="status"`/`aria-live="polite"` を付与する。

### R3-L8. 重複/二重定義の整理
- **重要度:** 🟢 Low / **対象:** `packages/shared`（`FormStatus` が schema の `formStatusEnum` と `validation/shared.ts` の `FormStatus` で二重定義、`ValidationSSEEventSchema` の `status` enum が DB `validationStatusEnum` と非同期）、`apps/web/src/hooks/use-debounced-value.ts:16`/`useLongTextValidation.ts:44,103`（bare `clearTimeout` — 規約は `window.clearTimeout`）
- **修正内容:** enum 値配列を 1 箇所の定数に集約し schema/zod 双方が参照する。`clearTimeout` を `window.clearTimeout` に統一。

### R3-L9. `editorMessage`/`errorMessage` への内部詳細混入・スキーマ過緩和
- **重要度:** 🟢 Low / **対象:** `packages/shared/src/validation/shared.ts:67-74`（`StoredLogicRuleSchema.condition/action` が `z.record(z.unknown())` で実質ノーバリデーション、TODO 済み）、`packages/shared/src/response-data.ts:51`（`questionValidationSchema` の `.passthrough()` が typo を黙殺）
- **修正内容:** ロジックエディタの shape 確定後に `z.discriminatedUnion` 等で具体化。`.passthrough()` は可能なら `.strict()` に、必要なら理由をコメント化する。

---

## Phase 6: テスト

### R3-T1. 認証バイパス回帰テストの追加
- **重要度:** 🟠 High（R3-C1/R3-C2 の回帰防止）/ **対象:** `apps/api/src/__tests__/`
- **問題:** `phase6/authz-tests`（`authz-regression.test.ts`）は R2 系をカバーするが、**R3-C1（トークンオラクル）と R3-C2（停止ユーザーバイパス）の回帰テストが存在しない**。
- **修正内容:** (1) 他ユーザーのトークン文字列で `/api/tokens/validate` を叩いても `user_id`/`scopes` が漏れないこと、(2) 停止ユーザーのセッションでフォーム系エンドポイントが 403 になること、の回帰テストを追加する。
- **依存:** R3-C1, R3-C2（各修正後にテスト追加）。
- **検証:** `pnpm --filter @nexus-form/api test` が通過すること。

### R3-T2. 再レビュー Critical の回帰テスト追加（再レビュー新規）
- **重要度:** 🟠 High（R3-C8/C9/C10/C11 の回帰防止）
- **対象:** `apps/api/src/__tests__/`、`apps/web` の該当コンポーネント/フックテスト
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
