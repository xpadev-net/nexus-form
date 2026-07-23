# コードベース全体レビュー (2026-07-19)

対象: モノレポ全体 (apps/api, apps/web, apps/worker, packages/*)
検証状況: `pnpm type-check` ✅ / `pnpm test` (15 タスク・248 テストファイル) ✅

## 総評

全体的な品質は非常に高い。認証・レート制限・暗号化・入力検証は多層防御で丁寧に設計されており、
型規律 (`as any` は 1 箇所のみ、zod による契約検証の徹底) も良好。クリティカルな脆弱性は未検出。
優先対応すべきは **(1) 依存関係の脆弱性 16 件**、**(2) 共有リンクトークンの平文保存**、
**(3) SSE 用 shareToken のクエリパラメータ露出** の 3 点。

---

## 1. セキュリティ

### 【高】本番依存関係に既知の脆弱性 16 件 (high 5 / moderate 6 / low 5)

`pnpm audit --prod` の結果:

| パッケージ | 脆弱バージョン | 修正バージョン | 経路 |
|---|---|---|---|
| `undici` | <6.27.0, >=7.0.0 <7.28.0 | >=6.27.0 / >=7.28.0 | discord.js 経由ほか 7 経路 |
| `form-data` | >=4.0.0 <4.0.6 | >=4.0.6 | (推移的依存) |
| `esbuild` | >=0.27.3 <0.28.1 | >=0.28.1 | ビルドツール |
| `@opentelemetry/core` | <2.8.0 | >=2.8.0 | 計測系 |
| `js-video-url-parser` | <=0.5.1 | 修正なしの可能性 | フロントエンド |

**対応**: `pnpm update` + `pnpm.overrides` による推移的依存の固定。`js-video-url-parser` は
修正版がない場合は置き換えを検討。

### 【中】共有リンクトークンが DB に平文保存

`packages/database/src/schema.ts:264` — `FormShareLink.token` が平文の unique varchar。
一方 API トークンには `apps/api/src/lib/tokens/hash.ts` のハッシュ機構が既にある。
DB ダンプ漏洩時に有効な全共有リンク (EDITOR ロール含む) が即座に使用可能になる。

**対応**: API トークンと同様にハッシュ + lookupHash 方式へ移行。

### 【中】SSE 用 `shareToken` がクエリパラメータで送信される

`apps/api/src/lib/dual-auth.ts:89-94`, `apps/web/src/lib/api.ts` (`withShareTokenSearchParam`)。
EventSource のヘッダ制約による妥協で、GET の SSE エンドポイント 2 つに限定されている点は適切。
ただし URL 中のトークンはアクセスログ・プロキシログ・Referer に残る。

**対応**: SSE 接続用に短命ワンタイムチケットを事前発行して交換する方式を検討。

### 【低〜中】「GET はスコープ検証なし」規約が実装で強制されていない

`apps/api/src/lib/dual-auth.ts:122-138` (`deriveFormAuthScopes`) — GET/HEAD/OPTIONS は
スコープ不要だが、「GET ハンドラは副作用を持たない」というコメント上の規約に依存。
誰かが GET ハンドラに状態変更を足した瞬間、スコープなしトークンで書き込み可能になる。

**対応**: GET にも `read` スコープを要求するか、規約を検証するテストを追加。

### 【低】プリンシパルの文字列エンコード

`dual-auth.ts:176-178, 691` — `user_id` に `anon:<tokenId>` / `share-link:<id>` を埋め込む
方式は脆い (コメント自身が「構築ロジックに依存」と自認)。
`{ kind: "user" | "anon" | "share-link"; id: string }` の判別可能ユニオンへの移行を推奨。

### 良かった点

- **dual-auth**: セッション / API トークン / 共有リンクの 3 系統を統一コンテキストに正規化。
  suspended ユーザー遮断、スコープ検証、anon・共有リンクの権限昇格経路の封鎖が一貫。
- **CSRF ガード** (`csrf-origin-guard.ts`): Cookie を伴う状態変更リクエストのみ Origin/Referer
  検証。better-auth パスは自前保護に委譲。
- **IP 抽出** (`lib/ip-address/`): `TRUSTED_PROXY_COUNT` 未設定時はスプーフィング可能な
  XFF を信用せず unknown に倒す設計。
- **公開フォーム送信** (`forms-public.ts`): hCaptcha → パスワードゲート (構造リーク防止の順序)
  → スキーマ + 到達可能性検証 → テレメトリトークン消費 → アトミックな回答数上限
  トランザクション、という模範的な多層防御。
- **暗号化** (`packages/shared/src/crypto/field-encryption.ts`): AES-256-GCM + ランダム IV +
  scrypt KDF + `timingSafeEqual`。

## 2. データベース

- 26 テーブルに対し 97 のインデックス定義。ホットパス (FormPermission の formId+userId
  unique、ApiToken の lookupHash、Form の publicId 等) は適切にカバーされている。指摘なし。
- マイグレーション適用検証 (`assertRequiredSecurityMigrationsApplied` を公開ルートの
  ゲートにする仕組み) は堅実。

## 3. 並行処理・信頼性

- **BullMQ**: `attempts: 3` + backoff + `removeOnComplete/Fail: 100` が設定済み。
- **Redis 分散ロック** (`apps/worker/src/lib/redis-lock.ts`): トークン照合付き Lua 解放
  スクリプトで他者ロックの誤解放を防止。TTL・タイムアウト・AbortSignal 対応あり。
- **SSE** (`forms-sse.ts`): subscriber エラー時に全クライアントを close して EventSource の
  再接続に委ねる設計。リスナー解除・quit のクリーンアップも丁寧。指摘なし。
- **レート制限** (`rate-limit.ts`): Lua で INCR+PEXPIRE をアトミック化。
  - 【低】インメモリフォールバックは複数インスタンス構成では実質フェイルオープン
    (インスタンスごとに独立カウント)。設計判断としては妥当だが運用ドキュメントに明記推奨。

## 4. フロントエンド (apps/web)

- `useEffect` は全体で 37 箇所と非常に少なく、TanStack Query 中心のデータフローが徹底
  されている。`localStorage` の使用は autosave / theme に限定され妥当。
- 【低】`editor-controls.tsx` (1,463 行)、`form-body.tsx` (996 行) は分割候補。
- 【低】`suggestion-kit.tsx:81` に唯一の `as any` (Plate プラグインの型制約)。

## 5. コード構成・保守性

- 【低】巨大ルートファイル: `forms-responses.ts` (2,391 行)、`forms-public.ts` (1,315 行)、
  `forms-structure.ts` (1,094 行)。エンドポイント単位での分割を推奨。
- 【低】`console.log`/`console.error` が api/worker に 12 箇所
  (例: `apps/worker/src/lib/redis-lock.ts:19`)。構造化ロガーへ統一を。
- 【低】`speakeasy` (`apps/worker/src/lib/totp.ts`) はメンテナンス停止。`otpauth` 等へ置換検討。
- 【低】Rollup ビルドで空チャンク警告 4 件 (`types/domain/shared` ほか)。型のみファイルを
  entry から除外可能。

## 6. インフラ・設定

- `docker-compose.yml`: 必須 env の `:?` 強制、ポートの 127.0.0.1 バインド、healthcheck、
  API/Worker のプラグインドリフト警告コメントまで整備されており良好。指摘なし。

## 7. テスト

- 248 テストファイル / 全 15 タスクがグリーン。フロントエンドの主要コンポーネントに
  2,000〜3,000 行級の充実したテストあり。指摘なし。

---

## 8. 第 3 回レビュー: 追加観点の検証結果

以下の観点を追加で検証した。**ほぼすべてクリア**。

| 観点 | 結果 | 根拠 |
|---|---|---|
| パスワードハッシュ | ✅ | bcrypt cost 12 (`lib/security/password.ts`) |
| オープンリダイレクト | ✅ | `auth-redirect.ts`: `//` 拒否・ダミー origin 検証・`/login` ループ防止 |
| CORS | ✅ | 本番で `TRUSTED_ORIGINS` 未設定/不正なら起動失敗 (fail-closed)。ワイルドカード・認証情報付き URL・パス付き origin を拒否 |
| Google OAuth | ✅ | state Cookie (600 秒) + PKCE code_verifier の両方を検証 |
| S3 アップロード | ✅ | オブジェクトキーのパスセグメント検証・prefix 強制・ファイル名検証・SVG コンテンツ検証・タイプ別サイズ制限 |
| 公開フォームのパスワードセッション | ✅ | HS256 署名 JWT (`AUTH_SECRET` 必須) の `verifiedForms` クレーム。HttpOnly / SameSite=Lax / 本番 Secure |
| Sheets フォーミュラインジェクション | ✅ | 全書き込みが `valueInputOption=RAW` (数式非評価) |
| CSV エクスポートインジェクション | ✅ | `packages/shared/src/response-export.ts:105` で `=+-@` と制御文字をエスケープ |
| XSS | ✅ | `dangerouslySetInnerHTML` 不使用。リンク URL サニタイズ (`link-node.tsx`)、plateContent サニタイズ |
| 外部プラグインローダー | ✅ | `realpath` 解決・拡張子許可リスト (.js/.mjs)・ロックファイル検証 |
| リクエストログの PII | ✅ | ヘッダ・Cookie・Authorization をログに含めない |
| ハードコードされたシークレット | ✅ | 検出なし |

### 新規指摘

- 【低】**パスワード検証 JWT の有効期間が 14 日固定** (`forms-public.ts:339` `Max-Age=1209600`,
  `lib/sessions/jwt.ts` `expiresIn: "14d"`) — `verifiedForms` クレームはフォームのパスワード変更と
  紐付いていないため、オーナーがパスワードを変更しても、検証済みの回答者は最長 14 日間
  アクセスを維持する。パスワードハッシュのバージョン (または更新時刻) をクレームに含め、
  検証時に突合することを推奨。

---

## 9. 第 4 回レビュー: セキュリティ特化観点の検証結果

攻撃ベクトル別に検証した。**すべてクリア**。

| 攻撃ベクトル | 結果 | 根拠 |
|---|---|---|
| SQL インジェクション | ✅ | Drizzle のパラメータ化クエリのみ。`sql` タグはすべて識別子・数値演算に限定 |
| SSRF (Webhook) | ✅ | `SecureWebhookUrlSchema`: HTTPS 強制 + ドメイン許可リスト (discord/slack/zapier/pipedream)。Discord URL は `/api/webhooks/{id}/{token}` パス形式まで検証。送信側も `redirect: "manual"` + AbortController タイムアウトでリダイレクト SSRF を遮断 (`form-submit-notifications.ts:221`) |
| ReDoS | ✅ | ユーザー入力からの動的 `new RegExp` 構築なし |
| タイミング攻撃 (API トークン) | ✅ | SHA-256 lookupHash で O(1) 検索 → bcrypt.compare で検証の 2 段構え (`lib/tokens/validate.ts:163`) |
| S3 読み取り認可 (IDOR) | ✅ | `isKeyOwnedBy` でユーザー名前空間 (`tmp|prod/users/{userId}/`) を強制、`..`・`//` 拒否、フォームスコープトークンはダウンロード不可、presign 有効期限クランプ (`routes/s3.ts:285`) |
| better-auth 設定 | ✅ | サインアップ無効 (`signup disabled`)、OAuth の `disableImplicitSignUp: true` |
| Redis キー/チャンネルインジェクション | ✅ | チャンネル名はサーバー生成 UUID ベース。Lua スクリプトは KEYS/ARGV 経由でユーザー入力を式に混入させない |
| 通知テンプレートインジェクション | ✅ | `renderDiscordMessage` はプレースホルダ置換のみ + 2000 文字切り詰め |

### 参考情報 (対応不要)

- API トークンの bcrypt 検証は入力 72 バイトで切り詰められる (bcrypt の仕様)。現行のトークン長
  では実害なし。トークン形式を変更する場合のみ留意。
- 汎用 Webhook 許可リストの zapier.com / pipedream.com はユーザーが任意のエンドポイントを
  作成できる SaaS だが、送信されるのは設定者自身のフォーム通知であり内部ネットワークへの
  SSRF にはならないため問題なし。

---

## 優先対応リスト

1. 【高】依存関係の脆弱性解消 (`undici`, `form-data`, `esbuild`, `@opentelemetry/core`, `js-video-url-parser`)
2. 【中】`FormShareLink.token` のハッシュ保存化
3. 【中】SSE 用 shareToken の短命チケット化
4. 【低〜中】GET スコープ規約のテストによる強制
5. 【低】巨大ファイル分割、console.log の logger 統一、speakeasy 置換
