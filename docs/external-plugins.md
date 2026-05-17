# 外部バリデーションプラグイン仕様

`@nexus-form/integrations` には、Docker 利用者が再ビルドなしで外部サービス検証
プロバイダーを追加できる動的プラグイン機構が組み込まれています。本書では
プラグイン作者および運用者向けに、契約・配置方法・運用上の前提を整理します。

## 1. アーキテクチャ概要

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ apps/api (Hono)              │        │ apps/worker (BullMQ)         │
│   ↓ startupPlugins(...)      │        │   ↓ startupPlugins(...)      │
│   providerRegistry           │  ←→    │   providerRegistry           │
│   /api/validation-providers  │ Redis  │   handleGenericValidation    │
│   getValidationQueue(name)   │──jobs──▶  for "<name>-validation"     │
└──────────────────────────────┘        └──────────────────────────────┘
        ↑               ↑                      ↑               ↑
        │               └── VALIDATION_PLUGINS_DIR ──┘         │
        │                  (外部プラグイン / 両プロセスで同一)  │
        └── 組み込みプラグイン (import.meta.resolve で         ┘
            @nexus-form/validation-provider-* から直接ロード)
```

組み込みプロバイダ (`discord` / `github` / `twitter`) は
`packages/validation-provider-*` 配下の独立したワークスペースパッケージとして
実装されており、`apps/api` / `apps/worker` の `dependencies` として静的に
リンクされます。起動時に `import.meta.resolve` で各パッケージの `./plugin`
サブパス（`dist/plugin.mjs`）を解決し、外部プラグインと同じ
`loadPluginFromSpecifier` でロードしてレジストリへ登録します。Worker では
`handleGenericValidation` が全プロバイダのジョブを共通で処理します。

## 2. ValidationProvider インタフェース

```ts
import { z } from "zod";

export interface ValidationProvider {
  readonly name: string;          // /^[a-z][a-z0-9_]*$/、最大 64 文字
  readonly label: string;         // UI 表示名
  readonly description: string;   // UI 用説明
  readonly inputHint: string;     // 入力欄プレースホルダ
  readonly inputSchema: z.ZodType<string>;
  readonly configSchema: z.ZodType<Record<string, unknown>>;
  readonly metadataSchema: z.ZodSchema; // safeParse が呼ばれる

  validate(
    input: string,
    config: Record<string, unknown>,
  ): Promise<ValidationProviderResult>;

  sanitizeConfig?(config: Record<string, unknown>): Record<string, unknown>;
  normalizeInput?(input: string): string;
}

export interface ValidationProviderResult {
  isValid: boolean;
  metadata?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  retryAfter?: number; // 秒。設定するとジョブが throw されリトライ
}
```

### 各フィールドの責務

| フィールド | 役割 |
|---|---|
| `name` | レジストリのキー。組み込みと同じ name を指定すると override 動作になります |
| `label` / `description` / `inputHint` | フロントエンドの設定 UI が `/api/validation-providers` 経由で取得 |
| `inputSchema` | 回答値（参照先ブロックの文字列値）の `.parse` |
| `configSchema` | フォーム作成者が指定する設定 JSON の `.parse`。`getProviderConfig` の返り値が渡る |
| `metadataSchema` | `validate` が返す metadata の `safeParse`。失敗した場合は DB に metadata を書き込まずに警告ログを出す |
| `validate` | 実際の検証ロジック。`isValid` と任意の metadata / errorCode / errorMessage / retryAfter を返す |
| `sanitizeConfig` (任意) | DB から取得した raw config を `configSchema` に渡す前に変換 |
| `normalizeInput` (任意) | `inputSchema.parse` 後にもう一度正規化し、再度 `inputSchema.parse` される |

### configSchema の strict モード

ハンドラ側は `configSchema.parse(sanitizedConfig)` を呼びますが、デフォルトの
`z.object({})` は未知キーを **黙って捨てる** 仕様です。プラグインで余分な
キーを許容したくない場合は `.strict()` を付与してください。

```ts
const ConfigSchema = z.object({
  guildId: z.string(),
  roleIds: z.array(z.string()).optional(),
}).strict();
```

## 3. プラグインファイルの実装

プラグインは ESM 形式の `.js` または `.mjs` で、`default` または `provider`
名でプロバイダを export します。

### 依存解決の注意（重要）

プラグインは `await import(modulePath)` で読み込まれるため、`import "zod"`
のような **bare specifier** はそのプラグイン `.mjs` の置かれた場所を起点に
Node の `node_modules` 探索が走ります。pnpm のワークスペースは依存を
リポジトリルートには hoist しないため、`plugins/validation/foo.mjs` から
`zod` を bare specifier で参照すると **ローカル開発では解決できず
ローダーが当該プラグインを skip します**（Docker の `/app` 配下に
node_modules がある本番運用では解決します）。

そのため外部プラグインは **rollup / esbuild / tsdown などで依存込みに
bundle した自己完結 `.mjs`** を配置してください。外部プラグインは
SHA-256 検証済みのソースを data URL として import するため、相対 import や
bare specifier に依存する未バンドル構成はサポート対象外です。組み込みプロバイダ
(`packages/validation-provider-*`) も同じ方針で全依存を inline した
`dist/plugin.mjs` を生成しています（`tsdown` の `alwaysBundle` 設定）。

ローダー (`packages/integrations/src/plugin-loader.ts`) は以下を検証し、
通らないファイルはスキップしてログに残します。

- 拡張子は `.js` または `.mjs` のみ
- ドット始まりのファイルは無視
- シンボリックリンクは拒否
- プラグインディレクトリが group/other writable でないこと
- `plugins.lock` に、パス区切りを含まない bare filename（`.js` または `.mjs` で終わる、下記 JSON 例と同じ形式）と SHA-256 が登録されていること
- 実ファイルの SHA-256 が `plugins.lock` の期待値と一致すること
- export オブジェクトが上記インタフェースを満たすこと
- `name` が `/^[a-z][a-z0-9_]*$/` かつ 64 文字以下

ローダー失敗は致命的エラーにはならず、`PluginLoader.getFailedPlugins()` に
記録されるだけです。プロセスは残りのプラグインで起動します。

### `plugins.lock` の形式

外部プラグインをロードするには、`VALIDATION_PLUGINS_DIR` 直下に
`plugins.lock` を配置してください。ローダーはこの JSON マニフェストに
登録された SHA-256 と実ファイルの内容が一致する場合だけ import します。
マニフェストが無い、ファイル名が未登録、またはハッシュ不一致のプラグインは
実行前に拒否されます。

```json
{
  "plugins": {
    "acme-discord.mjs": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}
```

ハッシュは配置する `.mjs` / `.js` の最終成果物に対して計算してください。

```bash
sha256sum plugins/validation/acme-discord.mjs
```

## 4. レジストリと override 動作

`startupPlugins` は次の順で登録します。

1. `builtinPlugins`: 個別ファイルパス（apps/api・apps/worker は
   `import.meta.resolve("@nexus-form/validation-provider-*/plugin")` の結果
   をここに渡します）
2. `pluginsDirs`: ディレクトリリスト（先頭から順にスキャン。`VALIDATION_PLUGINS_DIR`
   が含まれます）

同じ `name` のプロバイダが後から登録された場合は **後勝ち** で上書きされます
（内部的には `registry.unregister(name)` → `register(plugin)`）。つまり外部
プラグインディレクトリに同名のプラグインを置けば組み込みを置き換えられます。
Worker は override されたプロバイダについても `handleGenericValidation` を
そのまま使い、組み込み実装には戻りません。

### 組み込みプロバイダの実体

`discord` / `github` / `twitter` はそれぞれ
`packages/validation-provider-<name>` ワークスペースパッケージとして実装され、
`tsdown` で `dist/plugin.mjs` にバンドルされます。`apps/api` と `apps/worker`
は `package.json` の `dependencies` でそれぞれを workspace 参照しており、
`pnpm install` 時に `node_modules/@nexus-form/validation-provider-*` として
リンクされます。起動時は各パッケージの `./plugin` サブパスエクスポート
（`./dist/plugin.mjs`）を `import.meta.resolve` で解決して直接ロードします。

組み込みプロバイダを追加する場合は、新しい
`packages/validation-provider-foo/` パッケージを作成し、`apps/api` /
`apps/worker` の `dependencies` と `BUILTIN_PLUGIN_SPECIFIERS` 配列にそれぞれ
追記してください。

## 5. ジョブ配線

Worker (`apps/worker/src/index.ts`) はレジストリ内の各プロバイダ `name` に対し
`${name}-validation` という BullMQ キューを `handleGenericValidation` で購読
します。API (`apps/api/src/lib/queues.ts`) は `getValidationQueue(name)` で
同名キューに対する `Queue` を遅延生成して enqueue します。両者でキュー名規約
（小文字英数字＋アンダースコア、先頭は英字、最大 64 文字）が一致している
ことが整合性の前提です。

API は enqueue 前に `providerRegistry.has(serviceType)` をチェックし、未登録
プロバイダのジョブは即時 `FAILED` (errorCode `PROVIDER_NOT_REGISTERED`) として
書き込みます。

## 6. デプロイ運用

### プラグインソース

| 種別 | 配信方法 | 設定 |
|---|---|---|
| 組み込み (`discord` / `github` / `twitter`) | API / Worker イメージに同梱（workspace 依存として `dist/plugin.mjs` がイメージ内に存在） | コード側で固定。追加する場合はパッケージ作成 + `BUILTIN_PLUGIN_SPECIFIERS` 追記 |
| 外部 | 運用者が任意の `.mjs` を `VALIDATION_PLUGINS_DIR` に配置 | env `VALIDATION_PLUGINS_DIR`（既定: `/app/plugins/validation`） |

`docker-compose.yml` には production-style の例がコメントで含まれています。

```yaml
api:
  build:
    context: .
    dockerfile: Dockerfile
  environment:
    VALIDATION_PLUGINS_DIR: /app/plugins/validation
  volumes:
    - ./plugins/validation:/app/plugins/validation:ro

worker:
  build:
    context: .
    dockerfile: Dockerfile.worker
  environment:
    VALIDATION_PLUGINS_DIR: /app/plugins/validation
  volumes:
    - ./plugins/validation:/app/plugins/validation:ro
  command: ["pnpm", "--filter", "@nexus-form/worker", "exec", "tsx", "src/index.ts"]
```

`plugins/validation/` は `plugins.lock` を含め、API と Worker **両方** に同一内容で提供してください。
両者が drift すると API が enqueue したジョブを Worker 側で捌けない／API が
即時 FAILED にする、といった事故が起きます。

### ホットリロード非対応

プラグインの読み込みはプロセス起動時のみです。新しい `.mjs` を追加・更新した
場合は **API と Worker 両方** を再起動してください。再起動なしでファイルだけ
差し替えると、レジストリは古い状態のままジョブが捌かれ続けます。

### セキュリティモデル（必読）

プラグインは Node.js の `await import(modulePath)` で読み込まれ、API/Worker
プロセスと **同一権限・同一プロセス** で実行されます。シンボリックリンクは
弾いていますが、それ以外のサンドボックスは行いません。

**リスク:** `VALIDATION_PLUGINS_DIR` に書き込めるユーザーは以下が可能です。
- `DISCORD_BOT_TOKEN`・`GOOGLE_OAUTH_*`・`AUTH_SECRET`・DB 接続情報など、
  API/Worker プロセスが保持する **全環境変数の読み取りと外部送信**
- ファイルシステム・ネットワーク・`child_process` への完全アクセス
- 組み込みプロバイダ (`discord`/`github`/`twitter`) のオーバーライド

**必須の運用要件:**

1. **プラグインディレクトリへの書き込みは運用者（インフラ管理者）のみに限定**
   してください。アプリ実行ユーザーはプラグインディレクトリへの書き込み権限を
   持ってはなりません。

   ```bash
   # 例: root 所有・アプリユーザーからは読み取り専用
   chown root:root /app/plugins/validation
   chmod 755 /app/plugins/validation
   # Docker では :ro マウント推奨（上記の docker-compose.yml 例を参照）
   ```

2. **プラグインディレクトリは読み取り専用マウントにしてください。**
   本番では `:ro` マウントを必須とし、アプリ実行ユーザーが起動後に
   `.mjs` や `plugins.lock` を差し替えられないようにしてください。

3. **信頼できるソースから取得したプラグインのみを配置** してください。
   配置前にコードを必ずレビューし、レビュー済み成果物の SHA-256 を
   `plugins.lock` に登録してください。

4. **起動ログのプラグイン一覧とハッシュを確認** してください。プロセス起動時に
   `[PluginLoader] Loaded plugin "<name>" path=... sha256=...` 形式でログが出力
   されます。予期しないプラグインが表示された場合は直ちに調査してください。

将来的なロードマップ: `worker_threads` や VM ベースの権限分離による実行
サンドボックス化を検討中ですが、現時点では上記の運用的制御が唯一の防護策です。

## 7. テスト

- ローダー: `packages/integrations/src/__tests__/plugin-loader.test.ts`
- 共通ハンドラ: `apps/worker/src/handlers/__tests__/generic-validation.test.ts`

新しいプラグインを追加する場合は、`describe("<name> provider", ...)` で
`validate()` の代表シナリオ（成功、ユーザー未存在、レート制限、設定エラー）
をユニットテストするのが推奨です。
