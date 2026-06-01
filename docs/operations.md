# 運用メモ

## R23-L3 安全 QA 環境

R23-L3 の手動 QA は、共有リンク、招待、Sheets 同期、短時間スケジュール保存を安全に確認するための docs-only 手順です。本番データや実サービス接続を使わず、ローカルまたは隔離された QA 環境だけで実施してください。

### 前提

- QA 用の専用環境を使い、本番環境の URL、DB、Redis、ストレージ、外部連携設定を参照しない。
- QA 用の専用テストアカウントだけを使う。例: `qa-owner@example.test`, `qa-invitee@example.test`。
- テストメール受信先は sink/mailbox を使う。例: `qa-mailbox@example.test`。
- Google Sheets は QA 用のテスト Sheet だけを使う。Sheet ID は実値を文書に残さず、`<QA_GOOGLE_SHEET_ID>` のような placeholder で扱う。
- 短時間スケジュール確認用に、QA 環境内で専用フォームを作成する。例: `R23-L3 QA Schedule Form`。
- hCaptcha 関連は R23-L3 の対象外です。hCaptcha、hCaptcha 用 env、または関連の dev bypass 設定は変更しないでください。

### 禁止事項

- 本番アカウント、本番フォーム、本番回答、本番 Google Sheet、本番メール受信先を使わない。
- 実秘密情報、実認証情報、実メールアドレス、実 Google Sheet ID を docs、Issue、PR、スクリーンショット、ログに残さない。
- Discord、GitHub、Twitter、Google などの外部サービス本番接続を有効化しない。必要な場合も QA 専用の stub、sandbox、または手動確認用 placeholder に限定する。
- `.env.example` や runtime code、schema、package、CI 設定をこの手順のために変更しない。
- hCaptcha、`HCAPTCHA`、`VITE_DISABLE_HCAPTCHA`、`FORM_SECURITY_DEV_BYPASS` 周辺を変更しない。

### 非秘密 env の扱い

QA 手順で必要な値は、実値を共有せずローカルの `.env.local` など git-ignored な場所にだけ置きます。文書やチケットには placeholder のみ記録してください。

```text
QA_OWNER_EMAIL=qa-owner@example.test
QA_INVITEE_EMAIL=qa-invitee@example.test
QA_MAILBOX=qa-mailbox@example.test
QA_GOOGLE_SHEET_ID=<QA_GOOGLE_SHEET_ID>
QA_SHORT_SCHEDULE_FORM_ID=<QA_SHORT_SCHEDULE_FORM_ID>
```

これらは hCaptcha 関連 env ではありません。R23-L3 では hCaptcha 設定を追加、削除、更新しません。

### 対象リソース準備

1. QA 環境で `qa-owner@example.test` と `qa-invitee@example.test` 相当の専用テストアカウントを作成する。
2. テストメール受信先を sink/mailbox に向け、招待メールや通知メールが本番利用者へ送信されないことを確認する。
3. QA 専用のテスト Google Sheet を作成し、名称に `R23-L3 QA` を含める。Sheet ID はローカルメモだけに保持し、共有文書には `<QA_GOOGLE_SHEET_ID>` と書く。
4. `R23-L3 QA Schedule Form` を作成し、短時間スケジュール確認用に開始/終了時刻を現在時刻から数分以内へ設定できる状態にする。
5. 外部連携が必要な UI では、QA 専用 stub または sandbox 表示であることを確認する。実 OAuth、実 webhook、実 API token は使わない。

### 機能別の安全確認手順

#### 共有リンク

1. QA owner でログインし、QA 専用フォームの共有リンクを作成または表示する。
2. 別ブラウザコンテキストまたはシークレット相当で共有リンクを開く。
3. QA フォームだけが表示され、本番フォームや他ユーザーの回答が見えないことを確認する。
4. 共有リンク URL を記録する場合は host/path の形だけにし、token 相当の値は `<SHARE_TOKEN>` に置き換える。
5. 共有リンクまたはメンバー権限を viewer/editor など QA で許可された範囲だけで変更し、QA invitee の表示/編集可否だけが変わることを確認する。
6. 共有リンクまたは QA invitee の権限を削除し、削除後のリンクやアカウントで対象フォームへアクセスできないことを確認する。

#### 招待

1. QA owner から `qa-invitee@example.test` へ招待を送る。
2. メール sink/mailbox に招待が届き、本番メールアドレスへ送信されていないことを確認する。
3. 招待リンクを QA invitee で開き、対象フォームへの権限だけが付与されることを確認する。
4. QA invitee の権限を変更し、変更後の UI/API 上の許可操作が QA フォームだけで変わることを確認する。
5. 招待または付与済み権限を削除し、QA invitee が対象フォームへアクセスできなくなることを確認する。
6. 招待 token や session cookie はログやスクリーンショットに残さない。

#### Sheets 同期

1. QA 専用フォームの回答同期先に `<QA_GOOGLE_SHEET_ID>` を指定する。
2. テスト回答を 1 件送信し、QA Sheet にその回答だけが同期されることを確認する。
3. 本番 Sheet、個人 Sheet、実顧客データが同期先に含まれていないことを確認する。
4. 同期確認の記録では Sheet ID とセル値のうち個人情報に見える値を placeholder に置き換える。

#### スケジュール保存

1. `R23-L3 QA Schedule Form` で公開開始/終了などの短時間スケジュールを設定する。
2. 保存後に再読み込みし、設定した時刻が QA フォームに保持されることを確認する。
3. 公開、非公開、予約公開の状態を QA フォームだけで切り替え、一覧、編集画面、回答画面の表示状態が期待どおり変わることを確認する。
4. スナップショット切替がある場合は、QA 用に作成した下書き/公開スナップショットだけを使い、切替後に QA 回答画面が選択したスナップショットを参照することを確認する。
5. 短時間の開始/終了境界で表示状態が QA フォームだけに反映されることを確認する。
6. 時刻確認に使う値はテスト用フォームに限定し、本番公開状態を変更しない。

### 終了後 cleanup

- QA フォーム、QA 回答、QA 招待、QA Sheet のテスト行を削除またはアーカイブする。
- 共有リンクと招待リンクを失効させる。
- ローカル `.env.local` などから不要になった QA placeholder 値を削除する。
- スクリーンショット、ログ、検証メモに実秘密情報、実認証情報、実メールアドレス、実 Google Sheet ID が残っていないことを確認する。
- hCaptcha 関連設定に差分がないことを確認する。

## Redis 障害時のレート制限フォールバック

API のレート制限は、通常 Redis 上の固定ウィンドウカウンタで共有されます。Redis が未設定、または一時的に利用できない場合、`apps/api/src/lib/rate-limit.ts` はプロセス内の `Map` にフォールバックしてリクエスト数を数えます。

このフォールバックは API プロセスを落とさないための fail-safe です。カウンタはプロセスローカルであり、複数レプリカ間では共有されません。そのため Redis 障害中に API を N レプリカで稼働している場合、IP など同じレート制限キーに対する実効上限は最大で約 N 倍まで緩みます。

運用上の注意:

- 認証、公開フォーム送信、共有リンク取得などの abuse 対策は Redis 復旧まで通常より弱くなります。
- Redis 障害アラートは API の稼働継続だけで解消扱いにせず、レート制限劣化として扱ってください。
- 高リスクな攻撃を受けている最中に Redis が利用できない場合は、API レプリカ数の一時縮小、上流 WAF/CDN の制限強化、または該当エンドポイントの追加制限を検討してください。
- Redis 復旧後は自動的に共有カウンタへ戻ります。プロセス内カウンタは復旧後の判定には使われません。ただし Redis カウンタは障害中のインメモリカウントを引き継がないため、復旧直後は同一キーのカウントが実質リセットされる点に注意してください。
