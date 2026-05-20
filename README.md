# nexus-form

外部サービスのメンバーシップ・フォロワー等を条件にした **バリデーション付きフォーム** を作成・管理できる Web アプリケーションです。Discord サーバー在籍確認、GitHub・Twitter アカウント検証などを組み込みで提供し、プラグイン機構により独自バリデーターを追加できます。

## 機能概要

- フォームの作成・編集・公開管理
- 外部サービスバリデーション（Discord / GitHub / Twitter）
- バリデーション結果のリアルタイム通知（SSE）
- Google Sheets への回答自動書き込み
- S3 互換ストレージへのファイルアップロード（MinIO 対応）
- hCaptcha によるスパム対策
- 招待コード制の新規登録
- 外部バリデーションプロバイダープラグイン機構（再ビルド不要で追加可能）
- Kubernetes / Docker Compose によるデプロイ対応

## アーキテクチャ

```
pnpm monorepo (Turborepo)
├── apps/
│   ├── web     – Vite + React 19 + TanStack Router  (port 3000)
│   ├── api     – Hono + Node.js REST API             (port 3001)
│   └── worker  – BullMQ 非同期ジョブワーカー
└── packages/
    ├── database                    – Drizzle ORM スキーマ・マイグレーション (MySQL)
    ├── integrations                – 外部サービス連携・プラグインレジストリ
    ├── shared                      – 共有 Zod スキーマ・型定義
    ├── validation-provider-discord – 組み込み Discord バリデーター
    ├── validation-provider-github  – 組み込み GitHub バリデーター
    └── validation-provider-twitter – 組み込み Twitter バリデーター
```

インフラ依存: **MySQL 8.0 / Redis 7 / MinIO**（開発環境は Docker Compose で一括起動）

## 必要要件

| ツール | バージョン |
|---|---|
| Node.js | 24 以上 |
| pnpm | 9.x |
| Docker & Docker Compose | 最新安定版 |

## セットアップ

### 1. リポジトリのクローン

```bash
git clone https://github.com/xpadev-net/nexus-form.git
cd nexus-form
```

### 2. 依存関係のインストール

```bash
pnpm install
```

### 3. 環境変数の設定

```bash
cp .env.example .env.local
cp .env.example .env
```

`.env.local` と Docker Compose が読み込む `.env` を開き、各値を埋めてください。最低限必要な項目:

| 変数 | 説明 |
|---|---|
| `AUTH_SECRET` | Better Auth のシークレットキー（ランダムな長い文字列） |
| `DATABASE_URL` | MySQL 接続 URL |
| `REDIS_URL` | Redis 接続 URL |
| `MYSQL_ROOT_PASSWORD` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | Docker Compose の MySQL 設定 |
| `REDIS_PASSWORD` | Docker Compose の Redis パスワード |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Docker Compose と API の MinIO 認証情報（ローカルでは MinIO root と S3 access/secret を同じ値に揃える） |
| `S3_ENDPOINT` / `S3_BUCKET_TMP` / `S3_BUCKET_PROD` | API の S3 互換ストレージ接続設定 |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Discord OAuth アプリの認証情報 |
| `SIGNUP_INVITATION_CODE` | 新規登録時に要求する招待コード |
| `CSRF_SECRET` | CSRF 保護用シークレット |
| `SESSION_ALIAS_SALT` | セッションエイリアス用ソルト |

外部サービスバリデーションを使用する場合は追加で設定が必要です（`DISCORD_BOT_TOKEN`、`GITHUB_APP_ID` / `GITHUB_PRIVATE_KEY`、`TWITTER_BEARER_TOKEN`）。

### 4. インフラの起動（ローカル開発）

```bash
docker compose up -d
```

MySQL（3306）・Redis（6379）・MinIO（9000/9001）が `127.0.0.1` 限定で起動します。

### 5. データベースマイグレーション

```bash
pnpm db:generate
pnpm db:migrate
```

### 6. 開発サーバーの起動

```bash
pnpm dev
```

- フロントエンド: http://localhost:3000
- API: http://localhost:3001
- MinIO コンソール: http://localhost:9001

## 主要コマンド

| コマンド | 説明 |
|---|---|
| `pnpm dev` | 全 apps を並列で開発サーバー起動 |
| `pnpm build` | 全パッケージ・アプリをビルド |
| `pnpm lint:fix` | Biome による lint と自動修正 |
| `pnpm type-check` | TypeScript 型チェック |
| `pnpm test` | vitest テスト実行 |
| `pnpm db:generate` | Drizzle Kit マイグレーション生成 |
| `pnpm db:migrate` | Drizzle Kit マイグレーション適用 |

特定パッケージのみ実行する場合:

```bash
pnpm --filter @nexus-form/api test
pnpm --filter @nexus-form/web dev
```

## 運用メモ

Redis 障害時のレート制限フォールバックなど、稼働時の注意点は [docs/operations.md](docs/operations.md) を参照してください。

## 外部バリデーションプラグイン

組み込みプロバイダー（Discord / GitHub / Twitter）に加え、`ValidationProvider` インタフェースを実装した独自プラグインを再ビルドなしで追加できます。

```ts
export interface ValidationProvider {
  readonly name: string;
  readonly label: string;
  validate(input: string, config: Record<string, unknown>): Promise<ValidationProviderResult>;
  // ...
}
```

プラグインは `VALIDATION_PLUGINS_DIR`（デフォルト `/app/plugins/validation`）に配置し、API と Worker の両方から同じディレクトリを参照させてください。詳細は [`docs/external-plugins.md`](docs/external-plugins.md) を参照。

## デプロイ

### Docker Compose（本番スタイル）

`docker-compose.yml` にコメントアウトされた `api` / `worker` サービス定義を参考に、環境変数とイメージを設定してください。

```bash
docker build -t nexus-form:latest .
docker build -f Dockerfile.web -t nexus-form-web:latest .
docker build -f Dockerfile.worker -t nexus-form-worker:latest .
```

### Kubernetes

`k8s/` ディレクトリに Kustomize マニフェストが用意されています。詳細は [`k8s/README.md`](k8s/README.md) を参照。

```bash
kubectl apply -k k8s/overlays/production
```

## ライセンス

[MIT](LICENSE)
