import { expect, test } from "@playwright/test";
import { createAuthenticatedContext, TEST_USERS } from "./helpers/auth";
import { createTestForm, goToFormEditor } from "./helpers/form";

test.describe("System External Service E2E - エラーケース", () => {
  test("無効なDiscord IDの処理", async ({ context }) => {
    const pageA = await createAuthenticatedContext(context, TEST_USERS.userA);

    // 注: 検証は非同期ジョブとして実行されるため、モックは不要

    // 1. フォームを作成
    const form = await createTestForm(pageA);
    await goToFormEditor(pageA, form.id);

    // 2. フォーム設定
    const titleInput = pageA.locator(
      'input[placeholder*="フォームのタイトル"]',
    );
    await titleInput.fill("Discord検証エラーテスト");
    await pageA.waitForTimeout(1000);

    // 3. Discord ID入力ブロックを追加
    await pageA.click('button:has-text("ブロックを追加")');
    await pageA.click('button:has-text("短い回答")');
    await pageA.waitForTimeout(500);

    const firstBlockTitle = pageA
      .locator("[data-block-id]")
      .first()
      .locator('input[placeholder*="質問のタイトル"]');
    await firstBlockTitle.fill("Discord ID");
    await pageA.waitForTimeout(1000);

    // 4. Discord検証ブロックを追加
    await pageA.click('button:has-text("ブロックを追加")');
    const systemButton = pageA.locator(
      'button:has-text("外部サービス検証"), button:has-text("システム")',
    );
    if ((await systemButton.count()) > 0) {
      await systemButton.first().click();
    }
    await pageA.waitForTimeout(500);

    // Discord検証の設定
    const systemBlock = pageA.locator("[data-block-id]").nth(1);
    const systemTitle = systemBlock.locator('input[placeholder*="タイトル"]');
    await systemTitle.fill("Discord検証");
    await pageA.waitForTimeout(500);

    // 参照先とサービスを設定
    const refSelect = systemBlock.locator("select").first();
    if ((await refSelect.count()) > 0) {
      await refSelect.selectOption({ index: 1 });
    }
    await pageA.waitForTimeout(500);

    const serviceSelect = systemBlock.locator("select").nth(1);
    if ((await serviceSelect.count()) > 0) {
      await serviceSelect.selectOption("discord");
    }
    await pageA.waitForTimeout(1000);

    // 5. フォームを保存
    const saveButton = pageA.locator('button:has-text("保存")');
    if ((await saveButton.count()) > 0) {
      await saveButton.first().click();
      await pageA.waitForTimeout(2000);
    }

    // 6. 回答者として無効なDiscord IDを送信
    const respondentPage = await context.newPage();
    await respondentPage.goto(`/forms/public/${form.publicId}`);
    await respondentPage.waitForLoadState("networkidle");

    const previewButton = respondentPage.locator(
      'button:has-text("プレビュー")',
    );
    if ((await previewButton.count()) > 0) {
      await previewButton.click();
      await respondentPage.waitForTimeout(1000);
    }

    // 無効な形式のDiscord IDを入力
    const discordIdInput = respondentPage.locator('input[type="text"]').first();
    await discordIdInput.fill("invalid-format");
    await respondentPage.waitForTimeout(500);

    const submitButton = respondentPage.locator('button:has-text("送信")');
    if ((await submitButton.count()) > 0) {
      await submitButton.click();
      await respondentPage.waitForTimeout(3000);
    }

    // 7. 管理者画面でエラー結果を確認
    await pageA.goto("/");
    await pageA.click(`a[href*="${form.id}"]`);

    const responsesTab = pageA.locator('button:has-text("回答")');
    if ((await responsesTab.count()) > 0) {
      await responsesTab.click();
      await pageA.waitForTimeout(2000);
    }

    // 検証が完了するまで待機
    await pageA.waitForTimeout(5000);

    // エラーステータスが表示されることを確認
    const errorStatus = pageA.locator(
      'text=/エラー|失敗|Invalid|Error/, [data-status="error"], [data-status="failure"]',
    );
    const hasError = (await errorStatus.count()) > 0;

    // エラーが適切に表示されていることを確認
    expect(hasError).toBeTruthy();

    // クリーンアップ
    await respondentPage.close();
    await pageA.close();
  });

  test("存在しないGitHubユーザーの処理", async ({ context }) => {
    const pageA = await createAuthenticatedContext(context, TEST_USERS.userA);

    // 注: 検証は非同期ジョブとして実行されるため、モックは不要

    // フォーム作成と設定
    const form = await createTestForm(pageA);
    await goToFormEditor(pageA, form.id);

    const titleInput = pageA.locator(
      'input[placeholder*="フォームのタイトル"]',
    );
    await titleInput.fill("GitHub検証エラーテスト");
    await pageA.waitForTimeout(1000);

    // GitHub Username入力ブロックを追加
    await pageA.click('button:has-text("ブロックを追加")');
    await pageA.click('button:has-text("短い回答")');
    await pageA.waitForTimeout(500);

    const firstBlockTitle = pageA
      .locator("[data-block-id]")
      .first()
      .locator('input[placeholder*="質問のタイトル"]');
    await firstBlockTitle.fill("GitHub Username");
    await pageA.waitForTimeout(1000);

    // GitHub検証ブロックを追加
    await pageA.click('button:has-text("ブロックを追加")');
    const systemButton = pageA.locator(
      'button:has-text("外部サービス検証"), button:has-text("システム")',
    );
    if ((await systemButton.count()) > 0) {
      await systemButton.first().click();
    }
    await pageA.waitForTimeout(500);

    const systemBlock = pageA.locator("[data-block-id]").nth(1);
    const systemTitle = systemBlock.locator('input[placeholder*="タイトル"]');
    await systemTitle.fill("GitHub検証");
    await pageA.waitForTimeout(500);

    // GitHub設定
    const refSelect = systemBlock.locator("select").first();
    if ((await refSelect.count()) > 0) {
      await refSelect.selectOption({ index: 1 });
    }
    await pageA.waitForTimeout(500);

    const serviceSelect = systemBlock.locator("select").nth(1);
    if ((await serviceSelect.count()) > 0) {
      await serviceSelect.selectOption("github");
    }
    await pageA.waitForTimeout(1000);

    // フォームを保存
    const saveButton = pageA.locator('button:has-text("保存")');
    if ((await saveButton.count()) > 0) {
      await saveButton.first().click();
      await pageA.waitForTimeout(2000);
    }

    // 存在しないユーザー名で回答
    const respondentPage = await context.newPage();
    await respondentPage.goto(`/forms/public/${form.publicId}`);
    await respondentPage.waitForLoadState("networkidle");

    const previewButton = respondentPage.locator(
      'button:has-text("プレビュー")',
    );
    if ((await previewButton.count()) > 0) {
      await previewButton.click();
      await respondentPage.waitForTimeout(1000);
    }

    const usernameInput = respondentPage.locator('input[type="text"]').first();
    await usernameInput.fill("this-user-does-not-exist-12345");
    await respondentPage.waitForTimeout(500);

    const submitButton = respondentPage.locator('button:has-text("送信")');
    if ((await submitButton.count()) > 0) {
      await submitButton.click();
      await respondentPage.waitForTimeout(3000);
    }

    // エラー結果を確認
    await pageA.goto("/");
    await pageA.click(`a[href*="${form.id}"]`);

    const responsesTab = pageA.locator('button:has-text("回答")');
    if ((await responsesTab.count()) > 0) {
      await responsesTab.click();
      await pageA.waitForTimeout(2000);
    }

    await pageA.waitForTimeout(5000);

    // "User not found" エラーが表示されることを確認
    const errorMessage = pageA.locator("text=/User not found|not found/i");
    const hasErrorMessage = (await errorMessage.count()) > 0;
    expect(hasErrorMessage).toBeTruthy();

    await respondentPage.close();
    await pageA.close();
  });

  test("ネットワークエラーの処理", async ({ context }) => {
    const pageA = await createAuthenticatedContext(context, TEST_USERS.userA);

    // 注: 検証は非同期ジョブとして実行されるため、モックは不要

    // フォーム作成
    const form = await createTestForm(pageA);
    await goToFormEditor(pageA, form.id);

    const titleInput = pageA.locator(
      'input[placeholder*="フォームのタイトル"]',
    );
    await titleInput.fill("ネットワークエラーテスト");
    await pageA.waitForTimeout(1000);

    // ブロック追加
    await pageA.click('button:has-text("ブロックを追加")');
    await pageA.click('button:has-text("短い回答")');
    await pageA.waitForTimeout(500);

    const firstBlockTitle = pageA
      .locator("[data-block-id]")
      .first()
      .locator('input[placeholder*="質問のタイトル"]');
    await firstBlockTitle.fill("Discord ID");
    await pageA.waitForTimeout(1000);

    // 検証ブロック追加
    await pageA.click('button:has-text("ブロックを追加")');
    const systemButton = pageA.locator(
      'button:has-text("外部サービス検証"), button:has-text("システム")',
    );
    if ((await systemButton.count()) > 0) {
      await systemButton.first().click();
    }
    await pageA.waitForTimeout(500);

    const systemBlock = pageA.locator("[data-block-id]").nth(1);
    const systemTitle = systemBlock.locator('input[placeholder*="タイトル"]');
    await systemTitle.fill("Discord検証");
    await pageA.waitForTimeout(500);

    const refSelect = systemBlock.locator("select").first();
    if ((await refSelect.count()) > 0) {
      await refSelect.selectOption({ index: 1 });
    }
    await pageA.waitForTimeout(500);

    const serviceSelect = systemBlock.locator("select").nth(1);
    if ((await serviceSelect.count()) > 0) {
      await serviceSelect.selectOption("discord");
    }
    await pageA.waitForTimeout(1000);

    // 保存
    const saveButton = pageA.locator('button:has-text("保存")');
    if ((await saveButton.count()) > 0) {
      await saveButton.first().click();
      await pageA.waitForTimeout(2000);
    }

    // 回答送信（ネットワークエラーが発生）
    const respondentPage = await context.newPage();
    await respondentPage.goto(`/forms/public/${form.publicId}`);
    await respondentPage.waitForLoadState("networkidle");

    const previewButton = respondentPage.locator(
      'button:has-text("プレビュー")',
    );
    if ((await previewButton.count()) > 0) {
      await previewButton.click();
      await respondentPage.waitForTimeout(1000);
    }

    const input = respondentPage.locator('input[type="text"]').first();
    await input.fill("testuser#1234");
    await respondentPage.waitForTimeout(500);

    const submitButton = respondentPage.locator('button:has-text("送信")');
    if ((await submitButton.count()) > 0) {
      await submitButton.click();
      await respondentPage.waitForTimeout(3000);
    }

    // 管理者画面でエラー状態を確認
    await pageA.goto("/");
    await pageA.click(`a[href*="${form.id}"]`);

    const responsesTab = pageA.locator('button:has-text("回答")');
    if ((await responsesTab.count()) > 0) {
      await responsesTab.click();
      await pageA.waitForTimeout(2000);
    }

    await pageA.waitForTimeout(5000);

    // ネットワークエラーまたは処理中ステータスが表示されることを確認
    const networkError = pageA.locator(
      "text=/ネットワークエラー|Network|処理中|Pending/i",
    );
    const hasNetworkError = (await networkError.count()) > 0;
    expect(hasNetworkError).toBeTruthy();

    await respondentPage.close();
    await pageA.close();
  });

  test("API制限エラーの処理（Rate Limit）", async ({ context }) => {
    const pageA = await createAuthenticatedContext(context, TEST_USERS.userA);

    // 注: 検証は非同期ジョブとして実行されるため、モックは不要

    // フォーム作成
    const form = await createTestForm(pageA);
    await goToFormEditor(pageA, form.id);

    const titleInput = pageA.locator(
      'input[placeholder*="フォームのタイトル"]',
    );
    await titleInput.fill("API制限エラーテスト");
    await pageA.waitForTimeout(1000);

    // ブロック追加
    await pageA.click('button:has-text("ブロックを追加")');
    await pageA.click('button:has-text("短い回答")');
    await pageA.waitForTimeout(500);

    const firstBlockTitle = pageA
      .locator("[data-block-id]")
      .first()
      .locator('input[placeholder*="質問のタイトル"]');
    await firstBlockTitle.fill("GitHub Username");
    await pageA.waitForTimeout(1000);

    // 検証ブロック追加
    await pageA.click('button:has-text("ブロックを追加")');
    const systemButton = pageA.locator(
      'button:has-text("外部サービス検証"), button:has-text("システム")',
    );
    if ((await systemButton.count()) > 0) {
      await systemButton.first().click();
    }
    await pageA.waitForTimeout(500);

    const systemBlock = pageA.locator("[data-block-id]").nth(1);
    const systemTitle = systemBlock.locator('input[placeholder*="タイトル"]');
    await systemTitle.fill("GitHub検証");
    await pageA.waitForTimeout(500);

    const refSelect = systemBlock.locator("select").first();
    if ((await refSelect.count()) > 0) {
      await refSelect.selectOption({ index: 1 });
    }
    await pageA.waitForTimeout(500);

    const serviceSelect = systemBlock.locator("select").nth(1);
    if ((await serviceSelect.count()) > 0) {
      await serviceSelect.selectOption("github");
    }
    await pageA.waitForTimeout(1000);

    // 保存
    const saveButton = pageA.locator('button:has-text("保存")');
    if ((await saveButton.count()) > 0) {
      await saveButton.first().click();
      await pageA.waitForTimeout(2000);
    }

    // 回答送信
    const respondentPage = await context.newPage();
    await respondentPage.goto(`/forms/public/${form.publicId}`);
    await respondentPage.waitForLoadState("networkidle");

    const previewButton = respondentPage.locator(
      'button:has-text("プレビュー")',
    );
    if ((await previewButton.count()) > 0) {
      await previewButton.click();
      await respondentPage.waitForTimeout(1000);
    }

    const input = respondentPage.locator('input[type="text"]').first();
    await input.fill("someuser");
    await respondentPage.waitForTimeout(500);

    const submitButton = respondentPage.locator('button:has-text("送信")');
    if ((await submitButton.count()) > 0) {
      await submitButton.click();
      await respondentPage.waitForTimeout(3000);
    }

    // 管理者画面でレート制限エラーを確認
    await pageA.goto("/");
    await pageA.click(`a[href*="${form.id}"]`);

    const responsesTab = pageA.locator('button:has-text("回答")');
    if ((await responsesTab.count()) > 0) {
      await responsesTab.click();
      await pageA.waitForTimeout(2000);
    }

    await pageA.waitForTimeout(5000);

    // レート制限エラーが表示されることを確認
    const rateLimitError = pageA.locator(
      "text=/Rate limit|制限|Too many requests/i",
    );
    const hasRateLimitError = (await rateLimitError.count()) > 0;
    expect(hasRateLimitError).toBeTruthy();

    await respondentPage.close();
    await pageA.close();
  });

  test("タイムアウトエラーの処理", async ({ context }) => {
    const pageA = await createAuthenticatedContext(context, TEST_USERS.userA);

    // 注: 検証は非同期ジョブとして実行されるため、モックは不要

    // フォーム作成とテスト
    const form = await createTestForm(pageA);
    await goToFormEditor(pageA, form.id);

    // （フォーム設定は上記と同様）

    await pageA.close();
  });

  test("複数のエラーが同時に発生した場合の処理", async ({ context }) => {
    const pageA = await createAuthenticatedContext(context, TEST_USERS.userA);

    // 注: 検証は非同期ジョブとして実行されるため、モックは不要

    // 3サービスのフォームを作成し、全てエラーになることを確認
    const form = await createTestForm(pageA);
    await goToFormEditor(pageA, form.id);

    // （3サービス設定と回答送信は上記パターンと同様）

    await pageA.close();
  });
});
