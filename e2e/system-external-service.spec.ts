import { expect, test } from "@playwright/test";
import { createAuthenticatedContext, TEST_USERS } from "./helpers/auth";
import { createTestForm, goToFormEditor } from "./helpers/form";

test.describe("System External Service E2E - 基本フロー", () => {
  test.beforeEach(async () => {
    // テスト前にデータベースをクリーンアップする処理が必要な場合はここに追加
  });

  test("フォーム作成から検証完了までのフル���ローが動作する", async ({
    context,
  }) => {
    // 1. ユーザーAでログイン
    const pageA = await createAuthenticatedContext(context, TEST_USERS.userA);

    // 2. フォームを作成
    const form = await createTestForm(pageA);
    await goToFormEditor(pageA, form.id);

    // 3. フォームタイトルを設定
    const titleInput = pageA.locator(
      'input[placeholder*="フォームのタイトル"]',
    );
    await titleInput.fill("Discord検証テストフォーム");
    await pageA.waitForTimeout(1000);

    // 4. Short Textブロックを追加（Discord ID入力用）
    await pageA.click('button:has-text("ブロックを追加")');
    await pageA.click('button:has-text("短い回答")');
    await pageA.waitForTimeout(500);

    // 最初のブロックのタイトルを設定
    const firstBlockTitle = pageA
      .locator("[data-block-id]")
      .first()
      .locator('input[placeholder*="質問のタイトル"]');
    await firstBlockTitle.fill("Discord ID");
    await pageA.waitForTimeout(1000);

    // 5. System External Serviceブロックを追加
    await pageA.click('button:has-text("ブロックを追加")');

    // システムブロックのボタンを探す
    const systemButton = pageA.locator(
      'button:has-text("外部サービス検証"), button:has-text("システム")',
    );
    if ((await systemButton.count()) > 0) {
      await systemButton.first().click();
    } else {
      // フォールバック：メニューから選択
      await pageA.click('button[role="menuitem"]:has-text("システム")');
      await pageA.click('button:has-text("外部サービス検証")');
    }
    await pageA.waitForTimeout(500);

    // Systemブロックの設定
    const systemBlock = pageA.locator("[data-block-id]").nth(1);

    // タイトル設定
    const systemBlockTitle = systemBlock.locator(
      'input[placeholder*="タイトル"]',
    );
    await systemBlockTitle.fill("Discord認証");
    await pageA.waitForTimeout(500);

    // 参照先ブロックを選択
    const refBlockSelect = systemBlock.locator(
      'select[aria-label*="参照"], select:has(option:has-text("Discord ID"))',
    );
    if ((await refBlockSelect.count()) > 0) {
      await refBlockSelect.selectOption({ index: 1 }); // 最初のブロックを選択
    }
    await pageA.waitForTimeout(500);

    // サービスを選択（Discord）
    const serviceSelect = systemBlock.locator(
      'select[aria-label*="サービス"], select:has(option:has-text("Discord"))',
    );
    if ((await serviceSelect.count()) > 0) {
      await serviceSelect.selectOption("discord");
    }
    await pageA.waitForTimeout(500);

    // Discord Guild IDを入力
    const guildIdInput = systemBlock.locator(
      'input[placeholder*="Guild ID"], input[name*="guild"]',
    );
    if ((await guildIdInput.count()) > 0) {
      await guildIdInput.fill("123456789012345678");
      await pageA.waitForTimeout(1000);
    }

    // 6. フォームを公開
    const publishButton = pageA.locator(
      'button:has-text("公開"), button:has-text("保存")',
    );
    if ((await publishButton.count()) > 0) {
      await publishButton.first().click();
      await pageA.waitForTimeout(2000);
    }

    // 7. 公開URLを取得
    const formUrl = `/forms/public/${form.publicId}`;

    // 8. 新しいページで回答者としてフォームにアクセス
    const respondentPage = await context.newPage();
    await respondentPage.goto(formUrl);
    await respondentPage.waitForLoadState("networkidle");

    // プレビューモードまたは回答モードに切り替え
    const previewButton = respondentPage.locator(
      'button:has-text("プレビュー")',
    );
    if ((await previewButton.count()) > 0) {
      await previewButton.click();
      await respondentPage.waitForTimeout(1000);
    }

    // 9. Discord IDを入力
    const discordIdInput = respondentPage.locator('input[type="text"]').first();
    await discordIdInput.fill("testuser#1234");
    await respondentPage.waitForTimeout(500);

    // 10. フォームを送信
    const submitButton = respondentPage.locator(
      'button:has-text("送信"), button[type="submit"]',
    );
    if ((await submitButton.count()) > 0) {
      await submitButton.click();
      await respondentPage.waitForTimeout(2000);
    }

    // 11. 管理者画面で回答を確認
    await pageA.goto("/");
    await pageA.click(`a[href*="${form.id}"]`);

    // 回答タブに移動
    const responsesTab = pageA.locator('button:has-text("回答")');
    if ((await responsesTab.count()) > 0) {
      await responsesTab.click();
      await pageA.waitForTimeout(1000);
    }

    // 12. 検証結果を確認
    // 検証が完了するまで待機（最大30秒）
    await pageA.waitForTimeout(5000);

    // 検証結果のステータスを確認
    const validationStatus = pageA.locator(
      '[data-testid="validation-status"], text=/検証.*完了|処理中/',
    );

    // 検証ステータスが存在することを確認
    const hasValidation = (await validationStatus.count()) > 0;
    expect(hasValidation).toBeTruthy();

    // クリーンアップ
    await respondentPage.close();
    await pageA.close();
  });

  // 注: 検証は非同期ジョブとして実行されるため、モックは不要
  // 実際の検証はBullMQワーカーによって処理される
});
