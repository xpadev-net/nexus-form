# Kubernetes Kustomize マニフェスト

このディレクトリには、Kubernetes上でHono APIサーバー、Vite SPAフロントエンド、BullMQワーカーをデプロイするためのkustomizeマニフェストが含まれています。

## ディレクトリ構造

```
k8s/
├── base/                    # 基本マニフェスト
│   ├── kustomization.yaml
│   ├── configmap.yaml       # 環境変数（非機密）
│   ├── secret.yaml          # 外部Secret管理用のキー契約テンプレート（apply対象外）
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
5. 外部Secret管理経路がruntimeの`nexus-form-secrets`を作成・更新できること

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

`TRUSTED_ORIGINS` は、ブラウザの `Origin` ヘッダーと照合するAPIの許可リストです。`k8s/base/configmap.yaml` と production overlay には、置換しない限り有効な origin にならないプレースホルダーを意図的に設定しています。productionでは `k8s/overlays/production/configmap-patch.yaml` の値がbaseの同じキーを上書きするため、デプロイ前にこのproduction用patchの値を実際の公開Webサイトの origin へ置き換えてください。baseだけを編集すると、productionにはpatch側のプレースホルダーが残り、APIはfail-fastで起動失敗します。未設定、空、または不正な値のまま本番APIを起動すると、APIはリクエストを受け付ける前に起動失敗します。

複数のWebサイトから同じAPIを利用する場合は、originをカンマ区切りで指定します。ワイルドカード、パス、クエリ、フラグメントは指定せず、各originを個別に列挙してください。

```yaml
# 置換前の値（意図的に不正。デプロイ前に必ず変更）
TRUSTED_ORIGINS: "REPLACE_BEFORE_DEPLOY_WITH_PRODUCTION_WEB_ORIGIN"

# 例: 複数の公開Web originを許可する場合（.invalid は説明用の予約ドメイン）
TRUSTED_ORIGINS: "https://forms.example.invalid,https://admin.example.invalid"
```

同一オリジン構成（リバースプロキシ等でWebとAPIを同じ公開originから配信）では、その公開Web originを指定します。WebとAPIが別オリジンの構成では、`TRUSTED_ORIGINS` に指定するのはAPIのoriginではなく、ブラウザでWebページを開くoriginです。例えば `https://forms.example.invalid` のWebから `https://api.example.invalid` のAPIを呼ぶ場合は、`TRUSTED_ORIGINS` に前者を設定し、`VITE_API_URL` には後者を設定します。

production APIは `TRUSTED_ORIGINS` をfail-fastで検証するため、プレースホルダーを実在ドメインへ置き換え、Webの公開originと一致させてからデプロイしてください。ConfigMapは `envFrom` でAPI Podへ読み込まれますが、Pod template checksumやreloaderは設定されていないため、ConfigMapをapplyするだけでは既存のAPI Podへ新しい値は反映されません。値を変更する場合も、以前の値へ戻す場合も、production namespaceでConfigMapを再applyした後にAPI Deploymentを再起動し、rollout完了を確認してください。

```bash
kubectl apply -k k8s/overlays/production
kubectl -n production rollout restart deployment/api
kubectl -n production rollout status deployment/api
```

#### Secret契約と外部管理

`k8s/base/secret.yaml`はキー名と無効なプレースホルダーだけを示す契約テンプレートです。`k8s/base/kustomization.yaml`のresourceには含まれず、base/productionのrenderやapplyでruntime Secretを作成・更新しません。実値で置換したファイル、render済みSecret、復号可能なSecretをGitへコミットしないでください。

runtimeの`nexus-form-secrets`を書き込むauthoritative writerは、External Secrets Operator、Sealed Secretsなど、クラスターごとに選定した**単一の外部Secret管理経路だけ**です。migration Job、API、Workerは名前でこのSecretを参照するため、Kustomizeをapplyする前に同じnamespaceへ作成してください。過去にArgo CDがchecked-in Secretを管理していた環境では、外部Secret管理へ所有権を移し、旧resourceをorphan/prune対象外にしてからこの変更をsyncします。先にresourceを削除するpruneを実行すると、参照先が消えてJob/Podが起動できません。

```bash
# AUTH_SECRETを生成
openssl rand -base64 32
```

生成結果はSecret managerへ直接登録し、shell履歴、ログ、PR、issueへ貼り付けないでください。`nexus-form.xpadev.net/auth-secret-revision` annotationは秘密値ではないローテーション識別子です。外部管理されるSecret metadataと`api-deployment.yaml`のPod templateで同じ識別子（例: change ticket番号やSecret manager version）を設定すると、`envFrom`を使うAPI Podが再作成され、どのSecret revisionを採用する想定かを値を開示せず確認できます。checked-in `secret.yaml`のannotationは外部管理resourceへ設定するキーの例であり、そのファイル自体はapplyしません。annotationには`AUTH_SECRET`本体、そのhash、Secret managerのアクセストークンを入れないでください。

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
- リポジトリ内の`secret.yaml`はプレースホルダーのまま保ち、実値を含む派生ファイルはGitにコミットしないでください
- base/productionのKustomize出力にSecretを追加しないでください。runtime Secretのwriterを複数にしないことが安全要件です
- API、migration Job、Workerは外部管理された`nexus-form-secrets`を`envFrom.secretRef`で読み込みます

### 公開フォームパスワード認可のrollout cutoff

公開フォームのパスワードgrantをgenerationへ結び付けるリリースでは、通常のrolling updateだけでは旧Podやrollback先がlegacy grantを受理できる時間を閉じられません。次のphase 0〜2を順番どおり完了し、cutoff記録を残してからfinal consumer contractを有効化してください。phaseを飛ばしたり、`AUTH_SECRET`の更新とbridge rolloutを同時に開始したりしないでください。

この手順での用語は次のとおりです。

- **pre-fix binary**: 保護フォームをlegacy `verifiedForms` claimで認可できる、またはlegacy grantを発行できるすべてのbinary。version番号が新しくても、この挙動が残ればpre-fixとして扱います。
- **bridge release**: additive schemaとrolling deployに互換で、保護フォームではlegacy claimをfail-closedにし、generation-bound grantだけを発行・検証することが確認された最初のimmutable image digest。これがphase 2後の最低rollback floorです。
- **final release**: bridge contractを維持する同一または後続のimmutable image digest。bridge release自身をfinalとして使う場合も同じgateを適用します。
- **security cutoff**: pre-fix Podが0件であることを確認した後、`AUTH_SECRET`をローテーションし、bridge以上の全Podが新revisionでreadyになった時点。phase 1はcutoff未達です。

開始前にnamespace、pre-fix/bridge/finalのimage digest、現在と次の非機密Secret revision識別子をchange ticketへ記録します。tagは後から別imageを指せるため、判定にはregistry digestとPodの`imageID`を使ってください。Secretの実値やhashは記録しません。

#### Phase 0: additive migration

1. 既存binaryが読み続けられるadditive migrationだけを、bridgeと同じimmutable API imageから実行します。既存API Deploymentはまだ更新しません。
2. `api-migration` Jobが成功したことと、既存API Podのreadinessおよび代表的な非保護フォームのGET/submitが維持されていることを確認します。
3. destructive migration、旧readerが解釈できないdefault、generation consumerの有効化が含まれていた場合は停止します。phase 1へ進めません。

```bash
kubectl -n production get job api-migration
kubectl -n production logs job/api-migration
kubectl -n production get deployment api
```

Argo CDの通常Syncはmigration Jobに続いてAPI Deploymentも更新します。phase 0を独立gateにする場合は、既存API Deploymentを保持したままmigration Jobだけを実行・完了確認できる運用経路を使い、phase 1のimage変更を同じ未確認操作へ混ぜないでください。

#### Phase 1: bridge rolloutと旧Pod drain

1. `AUTH_SECRET`と両方の`nexus-form.xpadev.net/auth-secret-revision`を変更せず、API imageだけをbridge digestへ更新します。
2. API Deploymentのrollout完了を待ちます。base manifestは`maxUnavailable: 0`と`maxSurge: 1`を明示しているため、新Podがreadyになるまで旧Podを残します。
3. Pod一覧の`imageID`を記録し、実行中・Terminatingを含むAPI Podがすべてbridge digestであることを確認します。
4. ReplicaSet一覧を確認し、すべてのpre-fix ReplicaSetが`DESIRED=0`、`CURRENT=0`、`READY=0`であることを確認します。1件でも旧Podまたは不明なdigestがあれば停止し、`AUTH_SECRET`をローテーションしません。
5. rollout専用の公開済み保護フォーム（必須の短文質問1件、fingerprint必須設定なし、十分な回答上限）でパスワードを検証し、rotation前cookieを権限`0700`の一時ディレクトリへ保存します。通常利用のフォームや利用者cookieは使いません。
6. そのcookieでGETが`200`かつ`structure != null`になることをassertし、同じフォーム用のGET URLとsubmit request templateを保存します。submit templateには実passwordやsecurity tokenを保存せず、phase 2で新鮮なhCaptcha/telemetry tokenを注入します。

```bash
kubectl -n production rollout status deployment/api
kubectl -n production get pods -l app=nexus-form,component=api \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.deletionTimestamp}{"\t"}{.status.containerStatuses[?(@.name=="api")].ready}{"\t"}{.status.containerStatuses[?(@.name=="api")].imageID}{"\n"}{end}'
kubectl -n production get replicasets -l app=nexus-form,component=api \
  -o custom-columns=NAME:.metadata.name,DESIRED:.spec.replicas,CURRENT:.status.replicas,READY:.status.readyReplicas
```

次のprobeは`curl`と`jq`を必要とします。`API_BASE_URL`は末尾slashなし、`PUBLIC_ID`は専用フォームのpublic IDへ置換します。`RESPONSES_FILE`は専用フォームの質問ID・型・タイトル・回答を含むJSON array（公開Webの正常なrequestから`responses`だけを取り出したもの）です。passwordやtokenをリポジトリ配下へ保存しないでください。

```bash
set -euo pipefail
export API_BASE_URL="https://api.example.invalid"
export PUBLIC_ID="CHANGE_ME_WITH_ROLLOUT_FORM_PUBLIC_ID"
export RESPONSES_FILE="/secure/operator-input/rollout-responses.json"
if [ "${ROLLOUT_CLEANUP_OWNER_DIR+x}" = x ] || [ "${ROLLOUT_CLEANUP_PREFIX+x}" = x ]; then
  printf '%s\n' 'rollout probe cleanup owner already exists; start in a fresh shell' >&2
  exit 64
fi
cleanup_rollout_probe() {
  local original_status=$?
  local cleanup_status=0
  local cleanup_dir="${ROLLOUT_CLEANUP_OWNER_DIR-}"

  trap - EXIT HUP INT TERM
  unset FORM_PASSWORD HCAPTCHA_TOKEN TELEMETRY_V4_TOKEN
  unset ROLLOUT_EVIDENCE_DIR

  case "$cleanup_dir" in
    "$ROLLOUT_CLEANUP_PREFIX"[[:alnum:]][[:alnum:]][[:alnum:]][[:alnum:]][[:alnum:]][[:alnum:]])
      if [ -e "$cleanup_dir" ] || [ -L "$cleanup_dir" ]; then
        if ! rm -rf -- "$cleanup_dir"; then
          cleanup_status=70
        elif [ -e "$cleanup_dir" ] || [ -L "$cleanup_dir" ]; then
          cleanup_status=70
        fi
      fi
      ;;
    *)
      cleanup_status=70
      ;;
  esac

  if [ "$cleanup_status" -ne 0 ]; then
    printf '%s\n' \
      'rollout probe cleanup failed; protected temporary artifacts may remain; stop the rollout and remove the fixed evidence directory manually' >&2
  fi
  if [ "$original_status" -ne 0 ]; then
    return "$original_status"
  fi
  return "$cleanup_status"
}

trap '' HUP INT TERM
readonly ROLLOUT_CLEANUP_PREFIX="${TMPDIR:-/tmp}/nexus-form-rollout."
ROLLOUT_CLEANUP_OWNER_DIR="$(mktemp -d "${ROLLOUT_CLEANUP_PREFIX}XXXXXX")"
readonly ROLLOUT_CLEANUP_OWNER_DIR
trap cleanup_rollout_probe EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
export ROLLOUT_EVIDENCE_DIR="$ROLLOUT_CLEANUP_OWNER_DIR"
chmod 700 "$ROLLOUT_EVIDENCE_DIR"
umask 077

export PUBLIC_FORM_URL="$API_BASE_URL/api/forms/public/$PUBLIC_ID"
printf '%s\n' "$PUBLIC_FORM_URL" > "$ROLLOUT_EVIDENCE_DIR/get-url.txt"
printf '%s\n' "$PUBLIC_FORM_URL/submit" > "$ROLLOUT_EVIDENCE_DIR/submit-url.txt"
jq -e 'type == "array" and length > 0' "$RESPONSES_FILE" >/dev/null
jq -n --slurpfile responses "$RESPONSES_FILE" '{
  responses: $responses[0],
  captchaToken: "__FRESH_HCAPTCHA_TOKEN__",
  telemetry: {v4Token: "__FRESH_TELEMETRY_TOKEN__"},
  fingerprints: []
}' > "$ROLLOUT_EVIDENCE_DIR/submit-template.json"

printf '%s' 'Protected form password: ' >&2
read -r -s FORM_PASSWORD
printf '\n'
printf '%s' "$FORM_PASSWORD" > "$ROLLOUT_EVIDENCE_DIR/password-value"
unset FORM_PASSWORD
test -s "$ROLLOUT_EVIDENCE_DIR/password-value"
jq -n --rawfile password "$ROLLOUT_EVIDENCE_DIR/password-value" \
  '{password: $password}' > "$ROLLOUT_EVIDENCE_DIR/password-request.json"
rm "$ROLLOUT_EVIDENCE_DIR/password-value"
VERIFY_STATUS="$(curl --silent --show-error \
  --output "$ROLLOUT_EVIDENCE_DIR/verify-old.json" \
  --write-out '%{http_code}' \
  --cookie-jar "$ROLLOUT_EVIDENCE_DIR/old-cookie.jar" \
  --header 'Content-Type: application/json' \
  --data-binary @"$ROLLOUT_EVIDENCE_DIR/password-request.json" \
  "$PUBLIC_FORM_URL/verify-password")"
rm "$ROLLOUT_EVIDENCE_DIR/password-request.json"
test "$VERIFY_STATUS" = 200
jq -e '.valid == true' "$ROLLOUT_EVIDENCE_DIR/verify-old.json" >/dev/null
test "$(awk '$6 == "cf_session" { count++ } END { print count + 0 }' \
  "$ROLLOUT_EVIDENCE_DIR/old-cookie.jar")" = 1

GET_STATUS="$(curl --silent --show-error \
  --output "$ROLLOUT_EVIDENCE_DIR/get-before-rotation.json" \
  --write-out '%{http_code}' \
  --cookie "$ROLLOUT_EVIDENCE_DIR/old-cookie.jar" \
  "$PUBLIC_FORM_URL")"
test "$GET_STATUS" = 200
jq -e '.form.publicId == env.PUBLIC_ID and .form.isPasswordProtected == true and .structure != null and .plateContent != null' \
  "$ROLLOUT_EVIDENCE_DIR/get-before-rotation.json" >/dev/null
```

このprobeはrolloutごとにfreshな専用shellで開始し、`ROLLOUT_EVIDENCE_DIR`と同じshellをphase 2まで保持して、完了後にshellを終了します。cleanup専用のreadonly ownerは`mktemp`が専用prefixで作成したpathへ固定されるため、運用中にmutableな`ROLLOUT_EVIDENCE_DIR`がunset、空、または上書きされても削除対象は変わりません。`set -euo pipefail`により、status/body/cookie assertionのどれか1つでも失敗すればprobeはその場で停止し、cutoff成立として扱いません。

cleanupはentryでEXIT/HUP/INT/TERM trapを解除して再入を防ぎ、削除より先にpassword/token変数をunsetします。正常終了、command/assertion失敗、HUP/INT/TERMのすべてで同じcleanupを1回だけ実行し、signalや既存commandの非0 statusは保持します。固定ownerのpath検証または削除に失敗した場合はsecret値やpathを出力せずfail-safe diagnosticを表示します。元statusが0ならcleanup failure statusは`70`、元statusが非0なら元statusを保持します。どちらの場合もcutoff成立として扱わず、保護された一時artifactを手動削除してからfresh shellで再試行します。cookie jar、password/token入りrequest、response bodyはchange ticketへ添付しません。

**Phase 1の残存リスク**: 同じ`AUTH_SECRET`をpre-fix Podも知っているため、この時点はsecurity cutoffではありません。旧Podが残っていればlegacy tokenを受理でき、pre-fixへrollbackすればlegacy grantを再発行できます。緊急時にphase 2前のpre-fixへ戻すことは技術的には可能ですが、セキュリティ要件未達へ戻る操作であり、phase 2の開始条件にはできません。

#### Phase 2: AUTH_SECRET rotationとrollback floor確定

1. zero-old-podの証跡を確認してから、Secret managerで新しいランダムな`AUTH_SECRET`を作成します。旧値を再利用せず、base manifestやGit管理overlayへ実値を書きません。
2. 外部Secret管理resourceの実値更新と同じ変更で、runtime Secret metadataとAPI Pod templateの`nexus-form.xpadev.net/auth-secret-revision`を同じ新しい非機密識別子へ更新します。Pod templateのannotation変更が新しいReplicaSetを作り、`envFrom`の値を全Podへ反映します。checked-in `secret.yaml`はapplyしません。
3. rollout完了後、全API Podがbridge以上の許可digest、ready、同一の新revision markerであり、pre-fix ReplicaSet/Podが0件であることを再確認します。
4. phase 1で取得したローテーション前のsession cookieを、同じ保護フォームのGETとsubmitへ再送します。どちらも再パスワード検証を要求してfail-closedになることを確認します。その後にパスワードを再検証して新しいcookieを取得し、同じGETとsubmitが成功することを確認します。
5. bridge digest、finalとして許可するdigest、新revision marker、zero-old-pod確認時刻、旧cookie拒否と新cookie成功の結果をchange ticketへ記録します。この記録をもってcutoff成立とし、その後にだけfinal consumer contractを有効化します。

```bash
kubectl -n production rollout status deployment/api
kubectl -n production get secret nexus-form-secrets \
  -o 'custom-columns=NAME:.metadata.name,AUTH_SECRET_REVISION:.metadata.annotations.nexus-form\.xpadev\.net/auth-secret-revision'
kubectl -n production get pods -l app=nexus-form,component=api \
  -o 'custom-columns=NAME:.metadata.name,READY:.status.containerStatuses[0].ready,IMAGE_ID:.status.containerStatuses[0].imageID,AUTH_SECRET_REVISION:.metadata.annotations.nexus-form\.xpadev\.net/auth-secret-revision'
kubectl -n production get replicasets -l app=nexus-form,component=api \
  -o custom-columns=NAME:.metadata.name,DESIRED:.spec.replicas,CURRENT:.status.replicas,READY:.status.readyReplicas
```

Kubernetes側の確認後、phase 1と同じshellで次を実行します。失効cookieのGETはHTTP errorではなく、`200`かつ`structure:null`/`plateContent:null`が現在のlocked contractです。submitはhCaptcha検証がpassword grant判定より先なので、旧cookie用と新cookie用にそれぞれ別の新鮮なhCaptcha/telemetry tokenを、承認済みの通常Web security flowから取得してください。tokenは再利用せず、入力後すぐにprobeを実行します。

```bash
GET_STATUS="$(curl --silent --show-error \
  --output "$ROLLOUT_EVIDENCE_DIR/get-with-old-cookie.json" \
  --write-out '%{http_code}' \
  --cookie "$ROLLOUT_EVIDENCE_DIR/old-cookie.jar" \
  "$PUBLIC_FORM_URL")"
test "$GET_STATUS" = 200
jq -e '.form.publicId == env.PUBLIC_ID and .form.isPasswordProtected == true and .structure == null and .plateContent == null' \
  "$ROLLOUT_EVIDENCE_DIR/get-with-old-cookie.json" >/dev/null

printf '%s' 'Fresh hCaptcha token for old-cookie submit: ' >&2
read -r -s HCAPTCHA_TOKEN
printf '\n'
printf '%s' 'Fresh telemetry v4 token for old-cookie submit: ' >&2
read -r -s TELEMETRY_V4_TOKEN
printf '\n'
printf '%s' "$HCAPTCHA_TOKEN" > "$ROLLOUT_EVIDENCE_DIR/hcaptcha-token"
printf '%s' "$TELEMETRY_V4_TOKEN" > "$ROLLOUT_EVIDENCE_DIR/telemetry-token"
unset HCAPTCHA_TOKEN TELEMETRY_V4_TOKEN
test -s "$ROLLOUT_EVIDENCE_DIR/hcaptcha-token"
test -s "$ROLLOUT_EVIDENCE_DIR/telemetry-token"
jq --rawfile captcha "$ROLLOUT_EVIDENCE_DIR/hcaptcha-token" \
  --rawfile telemetry "$ROLLOUT_EVIDENCE_DIR/telemetry-token" \
  '.captchaToken = $captcha | .telemetry = {v4Token: $telemetry}' \
  "$ROLLOUT_EVIDENCE_DIR/submit-template.json" \
  > "$ROLLOUT_EVIDENCE_DIR/old-submit-request.json"
rm "$ROLLOUT_EVIDENCE_DIR/hcaptcha-token" "$ROLLOUT_EVIDENCE_DIR/telemetry-token"
OLD_SUBMIT_STATUS="$(curl --silent --show-error \
  --output "$ROLLOUT_EVIDENCE_DIR/old-submit-response.json" \
  --write-out '%{http_code}' \
  --cookie "$ROLLOUT_EVIDENCE_DIR/old-cookie.jar" \
  --header 'Content-Type: application/json' \
  --data-binary @"$ROLLOUT_EVIDENCE_DIR/old-submit-request.json" \
  "$PUBLIC_FORM_URL/submit")"
rm "$ROLLOUT_EVIDENCE_DIR/old-submit-request.json"
test "$OLD_SUBMIT_STATUS" = 403
jq -e '.passwordRequired == true and .error == "Password verification required"' \
  "$ROLLOUT_EVIDENCE_DIR/old-submit-response.json" >/dev/null

printf '%s' 'Protected form password: ' >&2
read -r -s FORM_PASSWORD
printf '\n'
printf '%s' "$FORM_PASSWORD" > "$ROLLOUT_EVIDENCE_DIR/password-value"
unset FORM_PASSWORD
test -s "$ROLLOUT_EVIDENCE_DIR/password-value"
jq -n --rawfile password "$ROLLOUT_EVIDENCE_DIR/password-value" \
  '{password: $password}' > "$ROLLOUT_EVIDENCE_DIR/password-request.json"
rm "$ROLLOUT_EVIDENCE_DIR/password-value"
VERIFY_STATUS="$(curl --silent --show-error \
  --output "$ROLLOUT_EVIDENCE_DIR/verify-new.json" \
  --write-out '%{http_code}' \
  --cookie-jar "$ROLLOUT_EVIDENCE_DIR/new-cookie.jar" \
  --header 'Content-Type: application/json' \
  --data-binary @"$ROLLOUT_EVIDENCE_DIR/password-request.json" \
  "$PUBLIC_FORM_URL/verify-password")"
rm "$ROLLOUT_EVIDENCE_DIR/password-request.json"
test "$VERIFY_STATUS" = 200
jq -e '.valid == true' "$ROLLOUT_EVIDENCE_DIR/verify-new.json" >/dev/null
test "$(awk '$6 == "cf_session" { count++ } END { print count + 0 }' \
  "$ROLLOUT_EVIDENCE_DIR/new-cookie.jar")" = 1

GET_STATUS="$(curl --silent --show-error \
  --output "$ROLLOUT_EVIDENCE_DIR/get-with-new-cookie.json" \
  --write-out '%{http_code}' \
  --cookie "$ROLLOUT_EVIDENCE_DIR/new-cookie.jar" \
  "$PUBLIC_FORM_URL")"
test "$GET_STATUS" = 200
jq -e '.form.publicId == env.PUBLIC_ID and .form.isPasswordProtected == true and .structure != null and .plateContent != null' \
  "$ROLLOUT_EVIDENCE_DIR/get-with-new-cookie.json" >/dev/null

printf '%s' 'Fresh hCaptcha token for new-cookie submit: ' >&2
read -r -s HCAPTCHA_TOKEN
printf '\n'
printf '%s' 'Fresh telemetry v4 token for new-cookie submit: ' >&2
read -r -s TELEMETRY_V4_TOKEN
printf '\n'
printf '%s' "$HCAPTCHA_TOKEN" > "$ROLLOUT_EVIDENCE_DIR/hcaptcha-token"
printf '%s' "$TELEMETRY_V4_TOKEN" > "$ROLLOUT_EVIDENCE_DIR/telemetry-token"
unset HCAPTCHA_TOKEN TELEMETRY_V4_TOKEN
test -s "$ROLLOUT_EVIDENCE_DIR/hcaptcha-token"
test -s "$ROLLOUT_EVIDENCE_DIR/telemetry-token"
jq --rawfile captcha "$ROLLOUT_EVIDENCE_DIR/hcaptcha-token" \
  --rawfile telemetry "$ROLLOUT_EVIDENCE_DIR/telemetry-token" \
  '.captchaToken = $captcha | .telemetry = {v4Token: $telemetry}' \
  "$ROLLOUT_EVIDENCE_DIR/submit-template.json" \
  > "$ROLLOUT_EVIDENCE_DIR/new-submit-request.json"
rm "$ROLLOUT_EVIDENCE_DIR/hcaptcha-token" "$ROLLOUT_EVIDENCE_DIR/telemetry-token"
NEW_SUBMIT_STATUS="$(curl --silent --show-error \
  --output "$ROLLOUT_EVIDENCE_DIR/new-submit-response.json" \
  --write-out '%{http_code}' \
  --cookie "$ROLLOUT_EVIDENCE_DIR/new-cookie.jar" \
  --header 'Content-Type: application/json' \
  --data-binary @"$ROLLOUT_EVIDENCE_DIR/new-submit-request.json" \
  "$PUBLIC_FORM_URL/submit")"
rm "$ROLLOUT_EVIDENCE_DIR/new-submit-request.json"
test "$NEW_SUBMIT_STATUS" = 201
jq -e '(.responseId | type) == "string" and (.responseId | length) > 0' \
  "$ROLLOUT_EVIDENCE_DIR/new-submit-response.json" >/dev/null

printf '%s\n' \
  'old GET: 200 locked structure=null' \
  'old submit: 403 passwordRequired=true' \
  'new GET: 200 unlocked structure!=null' \
  'new submit: 201 responseId present' \
  | tee "$ROLLOUT_EVIDENCE_DIR/cutoff-smoke-result.txt"
cleanup_rollout_probe
unset PUBLIC_FORM_URL PUBLIC_ID API_BASE_URL RESPONSES_FILE
```

base manifestの`revisionHistoryLimit: 1`により、phase 2のbridge再ロールアウトが完了すると、通常のDeployment履歴には直前のbridge ReplicaSetだけが残り、pre-fix ReplicaSetはrollback候補から外れます。ただし、これは古いdigestを明示的に再指定する操作や古いGit revisionの再同期を防ぐadmission policyではありません。cutoff記録後はデプロイ承認側でも許可digestをbridge/finalに限定し、無確認の`kubectl rollout undo`を使わないでください。admission policyによる強制が必要な環境では、別タスクでGitOps/cluster policyを所有させます。

#### Compatibility / rollback matrix

| Phase / 組み合わせ | 保護フォームでの結果 | 判断 |
|---|---|---|
| phase 1: old legacy token → bridge/final binary（旧Secret） | legacy claimを認可に使わず再検証を要求する | この経路単体はfail-closed。ただし旧Podが同じtokenを受理できるためcutoff未達 |
| phase 1: new generation token → pre-fix binary（同一Secret） | legacy `verifiedForms`を持たないtokenは保護アクセスを通せない | 初回はfail-closedでも、pre-fixで再検証するとlegacy grantを発行できるため安全要件未達 |
| phase 1: bridge → pre-fixへsame-secret rollback | pre-fixがlegacy tokenを受理・再発行できる | phase 2前に限り緊急rollbackは可能だが、セキュリティ状態は未達へ戻る |
| phase 2後: rotation前token → bridge/final binary（新Secret） | signature検証に失敗し、再検証を要求する | 期待どおりfail-closed |
| phase 2後: bridge ↔ final rollback（新Secret） | generation-bound contractを維持する | schema互換性と許可digest確認を条件に可能 |
| phase 2後: pre-fix binaryへrollback（新Secretを再利用） | 旧tokenは一度失効しても、pre-fixが新Secretでlegacy grantを再発行し、その後のrevocationを保証できない | **禁止**。同じ`AUTH_SECRET`であることは安全性の根拠にならず、bridge releaseが絶対rollback floor |

phase 2後にbridge/finalのどちらも起動できない場合は、pre-fixへ戻さずサービスをfail-closedに保ち、fixed imageの復旧または新しいfixed releaseを行います。pre-fixを起動するにはcutoff契約の破棄と新たなincident判断が必要であり、通常のrollbackとして扱いません。

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

このコマンドは`nexus-form-secrets`を作成・更新しません。外部Secret管理経路でruntime Secretと必要なキーを先に用意してください。このコマンドはマニフェストのレンダリング確認や簡易適用には使えますが、Argo CD hook の wave 順序や Job 完了待ちは `kubectl apply` では保証されません。API 起動前 migration の順序保証が必要な環境では Argo CD で同期してください。`kubectl` で運用する場合は外部管理SecretとConfigMapを用意した後、API Deploymentを更新する前に同じ immutable tag または digest の `nexus-form` イメージで `/nodejs/bin/node /migration/run-migrations.mjs` を実行し、完了を確認してから Deployment を適用します。`api-migration` Job を含む overlay を直接再適用する場合は、Job の`spec.template`が immutable なため、イメージタグ変更前に`kubectl delete job api-migration --ignore-not-found`で完了済みJobを削除してください。

#### 本番環境へのデプロイ

```bash
kubectl apply -k k8s/overlays/production
```

production overlayもSecretをrenderしません。external writerが`production` namespaceの`nexus-form-secrets`を作成済みであることを、値を表示しないmetadata確認で確かめてからapplyします。

```bash
kubectl -n production get secret nexus-form-secrets \
  -o 'custom-columns=NAME:.metadata.name,REVISION:.metadata.annotations.nexus-form\.xpadev\.net/auth-secret-revision'
```

### データベースマイグレーション

Argo CD でデプロイする場合、`api-migration` Job が `Sync` hook として実行されます。API コンテナの起動処理ではマイグレーションを実行せず、同じ `nexus-form` イメージに同梱された `/migration/run-migrations.mjs` を hook Job から実行します。

ConfigMapはsync wave`-2`、migration Jobはsync wave`-1`、API Deploymentは通常wave`0`で同期されます。runtime SecretはこのKustomize applicationの同期対象ではなく、外部Secret管理経路が先に作成・更新します。これにより、外部管理Secretと更新後のConfigMapを先に用意し、マイグレーション完了後に新しいAPI Podを起動できます。

`PreSync`はConfigMapなどの通常resourceや外部Secret準備より前に実行される可能性があるため、初回デプロイや環境変数変更を含む同期で参照先が存在しない、または古い値でmigrationされるおそれがあります。`PostSync`では新しいAPI Podが先に起動するため、新しいコードが未適用のスキーマへアクセスする時間が発生します。そのため、このmanifestでは`Sync` hookとsync waveを組み合わせ、外部Secretを同期開始前の前提条件にします。

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
