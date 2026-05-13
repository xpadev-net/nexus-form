# E2Eテスト

このディレクトリには、以下のE2Eテストが含まれています：

## テストファイル

### リアルタイム同時編集
- `realtime-collaboration.spec.ts`: リアルタイムフォーム編集機能のテスト

### SystemExternalService機能
- `system-external-service.spec.ts`: 基本的な外部サービス検証フロー
- `multiple-service-validation.spec.ts`: 複数サービスの同時検証
- `system-validation-errors.spec.ts`: エラーケースの処理

### アクセシビリティ
- `accessibility.spec.ts`: アクセシビリティ機能のテスト

## テストシナリオ

### 1. 基本的な同時編集（自動マージ）
- ユーザーA: block-1 の title を編集
- ユーザーB: block-2 の options を編集
- 結果: 両方の変更が自動的にマージされ保持される

### 2. 衝突発生と解決
- ユーザーA: block-1 の title を "Question A" に変更
- ユーザーB: block-1 の title を "Question B" に変更
- 結果: 衝突 UI が表示され、どちらかを選択（または手動マージ）

### 3. 異なるフィールドの同時編集（自動マージ）
- ユーザーA: block-1 の title を編集
- ユーザーB: block-1 の description を編集
- 結果: 両方の変更が自動的にマージされる

### 4. 削除との衝突
- ユーザーA: block-1 を削除
- ユーザーB: block-1 を編集
- 結果: 410 Gone エラー → 削除通知を表示

### 5. 配列要素のマージ（自動マージ）
- ユーザーA: options に "Option D" を追加
- ユーザーB: options に "Option E" を B-C 間に挿入
- 結果: [A, B, E, C, D] に自動マージ

### 6. ブロック順序の同時変更（自動マージ）
- ユーザーA: block-3 を block-1 の後に移動
- ユーザーB: block-4 を block-2 の後に移動
- 結果: サーバー側の順序を優先し、ローカルの移動も反映

### 7. ネットワーク断からの復帰
- ユーザーA: オフライン中に編集
- ネットワーク復帰後: 自動的にサーバーと同期（自動マージまたは衝突UI表示）

## テスト実行方法

### 前提条件

1. Playwrightのブラウザがインストールされていること（初回のみ）:
```bash
pnpm playwright install chromium
```

2. テスト用のデータベースがセットアップされていること
3. 開発サーバーが起動していること（または自動起動）

### テストの実行

#### すべてのE2Eテストを実行
```bash
pnpm test:e2e
```

#### UIモードでテストを実行（デバッグに便利）
```bash
pnpm test:e2e:ui
```

#### ブラウザを表示してテストを実行
```bash
pnpm test:e2e:headed
```

#### 特定のテストファイルのみ実行
```bash
pnpm playwright test e2e/realtime-collaboration.spec.ts
```

#### 特定のテストケースのみ実行
```bash
pnpm playwright test --grep "シナリオ1"
```

## テストヘルパー

### 認証ヘルパー (`helpers/auth.ts`)
- `getBaseURL()`: baseURLを取得する（環境変数または`http://localhost:3000`）
- `loginUser(page, user)`: ユーザーをログインさせる
- `createAuthenticatedContext(context, user)`: 認証済みのコンテキストを作成

### フォームヘルパー (`helpers/form.ts`)
- `createTestForm(page)`: テスト用のフォームを作成
- `goToFormEditor(page, formId)`: フォーム編集ページに移動
- `editBlockTitle(page, blockId, newTitle)`: ブロックのタイトルを編集
- `editBlockDescription(page, blockId, newDescription)`: ブロックの説明を編集
- `editBlockOptions(page, blockId, options)`: ブロックの選択肢を編集
- `getBlockOptions(page, blockId)`: ブロックの選択肢の値を取得
- `deleteBlock(page, blockId)`: ブロックを削除
- `getBlockTitle(page, blockId)`: ブロックのタイトルを取得
- `hasConflictUI(page, blockId)`: 衝突UIが表示されているか確認
- `resolveConflictWithLocal(page, blockId)`: 衝突解決で「自分の変更を採用」
- `resolveConflictWithServer(page, blockId)`: 衝突解決で「サーバー版を採用」
- `waitForSync(page)`: 変更が同期されるまで待つ
- `goOffline(page)`: ネットワークをオフラインにする
- `goOnline(page)`: ネットワークをオンラインに戻す

### SystemValidationヘルパー (`helpers/system-validation.ts`)
- `addSystemValidationBlock(page, config)`: System External Serviceブロックを追加
- `addShortTextBlock(page, title)`: Short Textブロックを追加
- `setFormTitle(page, title)`: フォームタイトルを設定
- `saveForm(page)`: フォームを保存/公開
- `switchToPreviewMode(page)`: プレビューモードに切り替え
- `fillFormResponse(page, values)`: フォームに回答を入力
- `submitForm(page)`: フォームを送信
- `goToResponsesTab(page)`: 回答タブに移動
- `waitForValidation(page, timeoutMs)`: 検証結果を待機
- `getValidationStatus(page, service)`: 検証結果のステータスを取得
- `getValidationError(page)`: 検証エラーメッセージを取得
- `verifyMultipleValidations(page, services)`: 複数サービスの検証結果を確認

## テスト環境変数

### BASE_URL
テスト対象のアプリケーションのベースURL（デフォルト: `http://localhost:3000`）

```bash
BASE_URL=http://localhost:3001 pnpm test:e2e
```

## トラブルシューティング

### テストが失敗する場合

1. **開発サーバーが起動していない**
   - `pnpm dev` で開発サーバーを起動してください

2. **データベースがセットアップされていない**
   - `pnpm db:push` または `pnpm db:migrate` を実行してください

3. **テストユーザーが存在しない**
   - テスト前に必要なユーザーをデータベースに作成してください

4. **ポート3000が使用中**
   - 環境変数 `BASE_URL` で別のポートを指定してください

### デバッグ

1. **UIモードを使用**
```bash
pnpm test:e2e:ui
```

2. **ブラウザを表示して実行**
```bash
pnpm test:e2e:headed
```

3. **特定のテストのみ実行**
```bash
pnpm playwright test --grep "シナリオ1" --headed
```

4. **スクリーンショットを確認**
失敗したテストのスクリーンショットは `test-results/` ディレクトリに保存されます。

## 注意事項

- E2Eテストは実際のブラウザを使用するため、実行に時間がかかります
- 複数のブラウザコンテキストを同時に使用するため、リソース消費が大きくなります
- テスト実行前にデータベースをクリーンな状態にすることを推奨します
- CI環境では `CI=true` 環境変数を設定すると、リトライ機能が有効になります

## 参考資料

- [Playwright公式ドキュメント](https://playwright.dev/)
- [ブロックエディタープラン](../z/block_editor_plan.md)
- [ブロックエディタートード](../z/block_editor_todo.md)
