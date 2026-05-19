# Kubernetes Kustomize マニフェスト

このディレクトリには、Kubernetes上でHono APIサーバー、Vite SPAフロントエンド、BullMQワーカーをデプロイするためのkustomizeマニフェストが含まれています。

## ディレクトリ構造

```
k8s/
├── base/                    # 基本マニフェスト
│   ├── kustomization.yaml
│   ├── configmap.yaml       # 環境変数（非機密）
│   ├── secret.yaml          # 機密情報
│   ├── api-deployment.yaml
│   ├── api-service.yaml
│   ├── bullmq-validation-deployment.yaml
│   └── bullmq-sheets-deployment.yaml
└── overlays/                # 環境別のオーバーレイ
    └── production/
        ├── kustomization.yaml
        └── configmap-patch.yaml
```

## 前提条件

1. Kubernetesクラスターが利用可能であること
2. `kubectl`と`kustomize`がインストールされていること
3. Dockerイメージがビルドされ、レジストリにプッシュされていること
4. データベース（MySQL）とRedisが利用可能であること

## セットアップ手順

### 1. イメージのビルドとプッシュ

#### APIサーバー用イメージ

```bash
# APIサーバー用イメージをビルド
docker build -t your-registry/nexus-form:latest .

# レジストリにプッシュ
docker push your-registry/nexus-form:latest
```

#### Webフロントエンド用イメージ

```bash
# Webフロントエンド用イメージをビルド
docker build -f Dockerfile.web -t your-registry/nexus-form-web:latest .

# レジストリにプッシュ
docker push your-registry/nexus-form-web:latest
```

#### BullMQワーカー用イメージ

BullMQワーカーは`pnpm`と`tsx`が必要なため、専用のDockerfile（`Dockerfile.worker`）を使用して別のイメージをビルドする必要があります。

```bash
# ワーカー用イメージをビルド
docker build -f Dockerfile.worker -t your-registry/nexus-form-worker:latest .

# レジストリにプッシュ
docker push your-registry/nexus-form-worker:latest
```

**重要**: ワーカー用イメージには以下が含まれています：
- `corepack enable pnpm`でpnpmバイナリが有効化されている
- `tsx`がインストールされている（`--prod=false`フラグでdevDependenciesも含めてインストール）
- ワーカー実行に必要なファイル（`src/workers/`、`src/lib/`など）がコピーされている

**注意**: `Dockerfile.worker`では`NODE_ENV=production`を設定していますが、`pnpm install --prod=false`を使用することでdevDependencies（tsx）もインストールされます。

### 2. 環境変数の設定

#### ConfigMapの編集

`k8s/base/configmap.yaml`を編集して、以下の**非機密**環境変数を設定してください：

- `REDIS_URL`: Redis接続文字列（例: `redis://redis-service:6379`）
- `NODE_ENV`: 実行環境（production/staging/development）
- `SIGNUP_INVITATION_CODE`: 新規ユーザー登録時に必要な招待コード（必須）
- `LOG_LEVEL`: ログレベル（info/debug/error）
- `VITE_*`: フロントエンドで使用される公開環境変数
- その他の非機密設定値

**重要**: ConfigMapは暗号化もアクセス制御も弱く、`kubectl get configmap nexus-form-config -o yaml`で平文参照されます。機密情報（APIキー、トークン、パスワード、**DATABASE_URLを含む接続文字列**など）はConfigMapに含めないでください。これらはSecretに含める必要があります。

##### VITE_*環境変数について

`VITE_*`で始まる環境変数は、Viteビルド時にフロントエンドのJavaScriptに埋め込まれます。

**主なVITE_*環境変数**:
- `VITE_HCAPTCHA_SITE_KEY`: hCaptchaのサイトキー（公開キー）。hCaptchaウィジェットを使用する場合は必須です。
- `VITE_BASE_URL`: アプリケーションのベースURL（例: `https://example.com`）
- `VITE_API_URL`: APIサーバーのURL（例: `http://api:3001`）
- `VITE_TELEMETRY_V4_HOST`: IPv4テレメトリーホスト（例: `ipv4.example.com`）
- `VITE_TELEMETRY_V6_HOST`: IPv6テレメトリーホスト（例: `ipv6.example.com`）

**注意**: `VITE_HCAPTCHA_SITE_KEY`が設定されていない場合、hCaptchaウィジェットが正常に動作せず、フォーム送信がブロックされる可能性があります。

#### Secretの編集

`k8s/base/secret.yaml`を編集して、以下の**機密情報**を設定してください：

```bash
# AUTH_SECRETを生成
openssl rand -base64 32

# Secretファイルを編集
# stringDataセクションに実際の値を設定
```

**機密情報として管理すべき項目**:
- データベース: `DATABASE_URL` - MySQL接続文字列（パスワードを含む）
- 認証関連: `AUTH_SECRET`, `CSRF_SECRET`, `SESSION_ALIAS_SALT`, `SESSION_IP_SALT`, `GOOGLE_OAUTH_ENC_KEY`
- hCaptcha: `HCAPTCHA_SECRET_KEY` - hCaptcha検証用のシークレットキー（必須、hCaptchaを使用する場合）
- Discord: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`
- GitHub: `GITHUB_PRIVATE_KEY`, `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`
- S3: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- Twitter: `TWITTER_BEARER_TOKEN`, `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET`
- Redis: `REDIS_PASSWORD`（使用する場合）

##### Google OAuth 暗号鍵

`GOOGLE_OAUTH_ENC_KEY` は Google OAuth token を AES-256-GCM 用の 32 byte 鍵へ派生するための必須 Secret です。API が token を暗号化し、Worker が Sheets 同期時に復号するため、API Deployment とすべての Worker Deployment は同じ `nexus-form-secrets` から同一値を読み込む必要があります。

新規環境では 32 byte 以上のランダム値を生成して設定してください。

```bash
openssl rand -base64 32
```

この値を変更すると、変更前の値で暗号化済みの OAuth token は復号できなくなります。ローテーションする場合は、既存 token の再暗号化または再認可を先に完了し、API と Worker を同じ Secret revision で同時にロールアウトしてください。Kubernetes の環境変数は Secret 更新だけでは既存 Pod に反映されないため、Secret 更新後は API とすべての Worker Deployment を `rollout restart` します。片方だけ先に更新すると暗号化・復号の鍵がずれ、Sheets 同期が失敗します。

**重要**: 
- `secret.yaml`には機密情報が含まれるため、Gitにコミットしないでください
- 実際の運用では、Sealed SecretsやExternal Secrets Operatorなどのツールを使用することを推奨します
- ConfigMapとSecretは`envFrom`で自動的に環境変数として読み込まれます

### 3. イメージ参照の設定

このマニフェストでは、Kustomizeの`images`フィールドを使用してイメージ参照を管理しています。baseマニフェストではプレースホルダーとして定義され、各overlayで実際のレジストリ名とタグに上書きされます。

#### baseマニフェスト

`k8s/base/kustomization.yaml`では、以下のようにイメージ名を定義しています：

```yaml
images:
  - name: nexus-form
    newName: nexus-form
    newTag: latest
  - name: nexus-form-web
    newName: nexus-form-web
    newTag: latest
  - name: nexus-form-worker
    newName: nexus-form-worker
    newTag: latest
```

これらの定義により、KustomizeがDeploymentマニフェスト内の`image: nexus-form:latest`、`image: nexus-form-web:latest`、`image: nexus-form-worker:latest`を検出し、overlayで上書き可能になります。

#### production overlayでの設定

`k8s/overlays/production/kustomization.yaml`では、レジストリの完全なイメージ名を指定しています：

```yaml
images:
  - name: nexus-form
    newName: ghcr.io/xpadev-net/nexus-form
    newTag: latest
  - name: nexus-form-web
    newName: ghcr.io/xpadev-net/nexus-form-web
    newTag: latest
  - name: nexus-form-worker
    newName: ghcr.io/xpadev-net/nexus-form-worker
    newTag: latest
```

**重要**:
- フォークして利用する場合は、`xpadev-net` をご自身のGitHub組織名またはユーザー名に置き換えてください
- 別のレジストリを使用する場合は、`newName`を適切なレジストリパスに変更してください
- 特定のタグを使用する場合は、`newTag`を変更してください（例: `sha-abc1234`）

#### 特定のコミットSHAタグを使用する場合

GitHub Actionsのビルドワークフローでは、`sha-<short-sha>`形式のタグもプッシュされます。特定のコミットのイメージを使用する場合：

```yaml
images:
  - name: nexus-form
    newName: ghcr.io/xpadev-net/nexus-form
    newTag: sha-abc1234  # 実際のコミットSHAに置き換え
  - name: nexus-form-web
    newName: ghcr.io/xpadev-net/nexus-form-web
    newTag: sha-abc1234
  - name: nexus-form-worker
    newName: ghcr.io/xpadev-net/nexus-form-worker
    newTag: sha-abc1234
```

### 4. デプロイ

#### 基本マニフェストの適用

```bash
kubectl apply -k k8s/base
```

#### 本番環境へのデプロイ

```bash
kubectl apply -k k8s/overlays/production
```

## 環境変数の設定

### SIGNUP_INVITATION_CODE（必須）

新規ユーザー登録時に必要な招待コードを設定します。この値が設定されていない場合、ユーザー登録ができません。

```
SIGNUP_INVITATION_CODE=your-invitation-code-here
```

**重要**: この値はConfigMapに設定します。機密情報ではありませんが、サインアップ制御に使用されるため、適切な値を設定してください。

### DATABASE_URL

MySQLデータベースへの接続文字列を設定します：

```
DATABASE_URL=mysql://username:password@host:port/database
```

**重要**: この値はSecretに設定します。パスワードを含むため、機密情報として扱います。

### REDIS_URL

Redisへの接続文字列を設定します：

```
REDIS_URL=redis://host:port
```

### VITE_*環境変数

フロントエンドで使用される公開環境変数です。Viteビルド時にバンドルに埋め込まれます。

#### VITE_HCAPTCHA_SITE_KEY（必須）

hCaptchaのサイトキー（公開キー）を設定します。hCaptchaウィジェットを使用する場合は必須です。

```
VITE_HCAPTCHA_SITE_KEY=your-hcaptcha-site-key
```

**注意**: この値が設定されていない場合、hCaptchaウィジェットが正常に動作せず、フォーム送信がブロックされる可能性があります。

**関連**: hCaptchaを使用する場合は、Secretに`HCAPTCHA_SECRET_KEY`も設定する必要があります。`HCAPTCHA_SECRET_KEY`が未設定の場合、hCaptcha検証時に500エラーが発生します。

#### VITE_BASE_URL（オプション）

アプリケーションのベースURLを設定します。公開フォームのURL生成などに使用されます。

```
VITE_BASE_URL=https://example.com
```

#### VITE_TELEMETRY_V4_HOST / VITE_TELEMETRY_V6_HOST（オプション）

テレメトリーホストを設定します。

```
VITE_TELEMETRY_V4_HOST=ipv4.example.com
VITE_TELEMETRY_V6_HOST=ipv6.example.com
```

#### GOOGLE_SHEETS_*（オプション）

Google Sheets統合の機能フラグを設定します。

```
GOOGLE_SHEETS_INTEGRATION_ENABLED=true
GOOGLE_SHEETS_OAUTH_ENABLED=true
```

または、個別に設定する場合：

```
REDIS_HOST=redis-service
REDIS_PORT=6379
REDIS_PASSWORD=your-password  # Secretに設定
```

## 注意事項

### BullMQワーカーの実行

BullMQワーカーは`pnpm exec tsx`コマンドを使用してTypeScriptファイルを直接実行します。ワーカー用の専用イメージ（`Dockerfile.worker`）を使用することで、以下の要件を満たしています：

- `corepack enable pnpm`でpnpmバイナリが有効化されている
- `tsx`がインストールされている（devDependenciesも含めてインストール）
- ワーカー実行に必要なファイルがコピーされている

**重要**: APIサーバー用のイメージ（`Dockerfile`）、Webフロントエンド用のイメージ（`Dockerfile.web`）、ワーカー用のイメージ（`Dockerfile.worker`）は別々にビルドする必要があります。ワーカーのDeploymentでは`nexus-form-worker:latest`イメージを使用してください。

### リソース制限

各Deploymentにはリソース制限が設定されています。実際の負荷に応じて調整してください：

- API: requests (100m CPU, 256Mi memory), limits (1000m CPU, 1Gi memory)
- BullMQ Validation Worker: requests (100m CPU, 256Mi memory), limits (500m CPU, 512Mi memory)
- BullMQ Sheets Worker: requests (100m CPU, 256Mi memory), limits (500m CPU, 512Mi memory)

### ヘルスチェック

APIサーバーにはliveness probe（`/api/health`）とreadiness probe（`/api/healthz`）が設定されています。liveness probeはプロセスの生存確認、readiness probeはDB等の依存サービスを含む準備状態の確認を行います。BullMQワーカーにはHTTPエンドポイントがないため、ヘルスチェックは設定されていません。

### データベースマイグレーション

データベースマイグレーションはDrizzle ORMで管理されています。デプロイ前に`pnpm db:migrate`を実行してください。

## トラブルシューティング

### Podが起動しない

1. イメージが正しくビルドされ、プッシュされているか確認
2. ConfigMapとSecretが正しく設定されているか確認
3. データベースとRedisへの接続が可能か確認
4. Podのログを確認: `kubectl logs -f deployment/api`

### 環境変数が読み込まれない

1. ConfigMapとSecretが正しく作成されているか確認: `kubectl get configmap nexus-form-config -o yaml`
2. Deploymentの`envFrom`セクションが正しく設定されているか確認
3. Podを再起動: `kubectl rollout restart deployment/api`

### ワーカーが起動しない

1. ワーカー用イメージが正しくビルドされ、プッシュされているか確認
   ```bash
   # イメージを確認
   docker images | grep nexus-form-worker
   
   # イメージ内でpnpmとtsxが利用可能か確認
   docker run --rm your-registry/nexus-form-worker:latest pnpm --version
   docker run --rm your-registry/nexus-form-worker:latest pnpm exec tsx --version
   ```
2. Deploymentで正しいイメージ名が指定されているか確認: `kubectl describe deployment bullmq-validation`
3. ワーカーのログを確認: `kubectl logs -f deployment/bullmq-validation`
4. Redisへの接続が可能か確認

## カスタマイズ

### レプリカ数の変更

各Deploymentの`spec.replicas`を編集してください。

### リソース制限の変更

各Deploymentの`spec.template.spec.containers[0].resources`を編集してください。

### 環境別の設定

`overlays/`ディレクトリに新しい環境用のオーバーレイを作成し、環境固有の設定を追加できます。
