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
- `TRUSTED_ORIGINS`: APIへのアクセスを許可する、ブラウザから見えるHTTP(S) origin（本番必須）
- `SIGNUP_INVITATION_CODE`: 新規ユーザー登録時に必要な招待コード（必須）
- `LOG_LEVEL`: ログレベル（info/debug/error）
- `VITE_*`: フロントエンドで使用される公開環境変数
- その他の非機密設定値

**重要**: ConfigMapは暗号化もアクセス制御も弱く、`kubectl get configmap nexus-form-config -o yaml`で平文参照されます。機密情報（APIキー、トークン、パスワード、**DATABASE_URLを含む接続文字列**など）はConfigMapに含めないでください。これらはSecretに含める必要があります。

##### VITE_*環境変数について

`VITE_*`で始まる環境変数は、Web コンテナ起動時に `/env-config.js`
へ書き出され、フロントエンドが runtime config として読み込みます。

**主なVITE_*環境変数**:
- `VITE_API_URL`: ブラウザから到達可能な公開API URL（例: `https://api.example.com`、同一オリジンでリバースプロキシする場合は `https://example.com`）
- `VITE_BASE_URL`: ブラウザから到達可能な公開Web URL（例: `https://example.com`）
- `VITE_HCAPTCHA_SITE_KEY`: hCaptchaのサイトキー（公開キー）。hCaptchaウィジェットを使用する場合は必須です。
- `VITE_TELEMETRY_HOST`: 共通テレメトリーhost。v4専用host未設定時のv4 endpointとして使用されます。
- `VITE_TELEMETRY_V4_HOST`: IPv4テレメトリーhost
- `VITE_TELEMETRY_V6_HOST`: IPv6テレメトリーhost

**注意**: `VITE_HCAPTCHA_SITE_KEY`が設定されていない場合、hCaptchaウィジェットが正常に動作せず、フォーム送信がブロックされる可能性があります。
`VITE_API_URL`には `http://api:3001` のような Kubernetes ClusterIP Service の内部DNS名を設定しないでください。Web コンテナ内ではなく、エンドユーザーのブラウザで使用されます。

ConfigMapを変更しただけでは、既存のWeb Pod内に生成済みの `/env-config.js` は更新されません。ConfigMap適用後はWeb Podを再起動し、生成内容を確認してください。

```bash
kubectl apply -k k8s/overlays/production
kubectl -n production rollout restart deployment/web
kubectl -n production rollout status deployment/web
kubectl -n production exec deployment/web -- sed -n '1,120p' /usr/share/nginx/html/env-config.js

# ブラウザから参照される内容を確認する場合
kubectl -n production port-forward service/web 8080:80
curl http://127.0.0.1:8080/env-config.js
```

##### TRUSTED_ORIGINS（本番必須）

`TRUSTED_ORIGINS` は、ブラウザの `Origin` ヘッダーと照合するAPIの許可リストです。`k8s/base/configmap.yaml` と production overlay には、置換しない限り有効な origin にならないプレースホルダーを意図的に設定しています。実際のデプロイ前に、公開Webサイトの origin へ必ず置き換えてください。未設定、空、または不正な値のまま本番APIを起動すると、APIはリクエストを受け付ける前に起動失敗します。

複数のWebサイトから同じAPIを利用する場合は、originをカンマ区切りで指定します。ワイルドカード、パス、クエリ、フラグメントは指定せず、各originを個別に列挙してください。

```yaml
# 置換前の値（意図的に不正。デプロイ前に必ず変更）
TRUSTED_ORIGINS: "REPLACE_BEFORE_DEPLOY_WITH_PRODUCTION_WEB_ORIGIN"

# 例: 複数の公開Web originを許可する場合（.invalid は説明用の予約ドメイン）
TRUSTED_ORIGINS: "https://forms.example.invalid,https://admin.example.invalid"
```

同一オリジン構成（リバースプロキシ等でWebとAPIを同じ公開originから配信）では、その公開Web originを指定します。WebとAPIが別オリジンの構成では、`TRUSTED_ORIGINS` に指定するのはAPIのoriginではなく、ブラウザでWebページを開くoriginです。例えば `https://forms.example.invalid` のWebから `https://api.example.invalid` のAPIを呼ぶ場合は、`TRUSTED_ORIGINS` に前者を設定し、`VITE_API_URL` には後者を設定します。

production APIは `TRUSTED_ORIGINS` をfail-fastで検証するため、プレースホルダーを実在ドメインへ置き換え、Webの公開originと一致させてからデプロイしてください。

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
- 認証関連: `AUTH_SECRET`, `CSRF_SECRET`, `SESSION_ALIAS_SALT`, `SESSION_IP_SALT`, `GOOGLE_OAUTH_ENC_KEY`, `SIGNUP_INVITATION_CODE`
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
- API のマイグレーション Job と API Deployment は同じ `nexus-form` イメージ参照を使います。Argo CD の `Sync` hook と sync wave で新しい API Pod の起動前にマイグレーションを実行するため、本番環境では `latest` ではなく `sha-<short-sha>` などの immutable tag を指定してください。

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

このコマンドはマニフェストのレンダリング確認や簡易適用には使えますが、Argo CD hook の wave 順序や Job 完了待ちは `kubectl apply` では保証されません。API 起動前 migration の順序保証が必要な環境では Argo CD で同期してください。`kubectl` で運用する場合は ConfigMap/Secret を適用後、API Deployment を更新する前に同じ immutable tag または digest の `nexus-form` イメージで `/nodejs/bin/node /migration/run-migrations.mjs` を実行し、完了を確認してから Deployment を適用します。`api-migration` Job を含む overlay を直接再適用する場合は、Job の `spec.template` が immutable なため、イメージタグ変更前に `kubectl delete job api-migration --ignore-not-found` で完了済み Job を削除してください。

#### 本番環境へのデプロイ

```bash
kubectl apply -k k8s/overlays/production
```

### データベースマイグレーション

Argo CD でデプロイする場合、`api-migration` Job が `Sync` hook として実行されます。API コンテナの起動処理ではマイグレーションを実行せず、同じ `nexus-form` イメージに同梱された `/migration/run-migrations.mjs` を hook Job から実行します。

ConfigMap と Secret は sync wave `-2`、migration Job は sync wave `-1`、API Deployment は通常 wave `0` で同期されます。これにより、更新後の環境変数を先に反映し、マイグレーション完了後に新しい API Pod を起動できます。

`PreSync` は ConfigMap/Secret などの通常リソースより前に実行されるため、初回デプロイや環境変数変更を含む同期で参照先が存在しない、または古い値で migration される可能性があります。`PostSync` では新しい API Pod が先に起動するため、新しいコードが未適用のスキーマへアクセスする時間が発生します。そのため、このマニフェストでは `Sync` hook と sync wave を組み合わせます。

`Sync` hook も同期対象の desired manifest から作成されますが、`latest` のような mutable tag ではレジストリの更新タイミングに依存します。マイグレーションと API を同じビルドに固定するため、production overlay の `nexus-form` は immutable tag に更新してから同期してください。

Argo CD を使わずに同じ API イメージを直接起動する場合は、API 起動前に `/nodejs/bin/node /migration/run-migrations.mjs` を別 Job や手動ステップで実行してください。このとき migration 実行時と API Deployment 更新時の `nexus-form` イメージは、同じ `sha-<short-sha>` tag または digest に固定してください。

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

フロントエンドで使用される公開環境変数です。Web コンテナ起動時に `/env-config.js` へ書き出され、ブラウザで読み込まれます。

#### VITE_HCAPTCHA_SITE_KEY（必須）

hCaptchaのサイトキー（公開キー）を設定します。hCaptchaウィジェットを使用する場合は必須です。

```
VITE_HCAPTCHA_SITE_KEY=your-hcaptcha-site-key
```

**注意**: この値が設定されていない場合、hCaptchaウィジェットが正常に動作せず、フォーム送信がブロックされる可能性があります。

**関連**: hCaptchaを使用する場合は、Secretに`HCAPTCHA_SECRET_KEY`も設定する必要があります。`HCAPTCHA_SECRET_KEY`が未設定の場合、hCaptcha検証時に500エラーが発生します。

#### VITE_FORM_SECURITY_DEV_BYPASS（開発環境のみ）

開発環境でフォーム送信を疎通確認するためのフラグです。`true` にすると hCaptcha、テレメトリIP/トークン、フィンガープリント必須チェックをまとめてバイパスします。
本番向けの `k8s/base` には含めず、開発用の Web runtime config と API 環境変数にだけ設定してください。
`k8s/base/configmap.yaml` にはこのキーの値を置かず、必要な開発用 overlay でだけ追加してください。

```
VITE_FORM_SECURITY_DEV_BYPASS=false
```

#### VITE_BASE_URL（オプション）

アプリケーションのベースURLを設定します。公開フォームのURL生成などに使用されます。

```
VITE_BASE_URL=https://example.com
```

#### VITE_TELEMETRY_HOST / VITE_TELEMETRY_V4_HOST / VITE_TELEMETRY_V6_HOST（オプション）

テレメトリーホストを設定します。bare host と URL の両方を指定でき、bare host は `https://` として扱われ、URL path は endpoint の base path として保持されます。公開フォーム送信時の token 取得は単一 token を使用し、`VITE_TELEMETRY_V4_HOST`、`VITE_TELEMETRY_V6_HOST`、共通の `VITE_TELEMETRY_HOST`（v4 endpoint）、既存 API client fallback（v4 endpoint）の順に使用します。専用 host が設定されている場合、その host での token 取得失敗時は fallback せず送信を停止します。

```
VITE_TELEMETRY_HOST=telemetry.example.com
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

データベースマイグレーションはDrizzle ORMで管理されています。Argo CD では `api-migration` Sync hook が API Deployment の前に実行します。Argo CD 以外で運用する場合は、API と同じ immutable tag または digest の `nexus-form` イメージで `/nodejs/bin/node /migration/run-migrations.mjs` を実行し、完了後に API Deployment を更新してください。

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
