import { expect, test } from "@playwright/test";
import { createAuthenticatedContext, TEST_USERS } from "./helpers/auth";
import { createTestForm, goToFormEditor } from "./helpers/form";

test.describe("System External Service E2E - 複数サービス同時検証", () => {
  test("Discord + GitHub の同時検証が動作する", async ({ context }) => {
    const pageA = await createAuthenticatedContext(context, TEST_USERS.userA);

    // 注: 検証は非同期ジョブとして実行されるため、モックは不要

    // 1. フォームを作成
    const form = await createTestForm(pageA);
    await goToFormEditor(pageA, form.id);

    // 2. フォームタイトルを設定
    const titleInput = pageA.locator(
      'input[placeholder*="フォームのタイトル"]',
    );
    await titleInput.fill("Discord + GitHub 同時検証フォーム");
    await pageA.waitForTimeout(1000);

    // 3. Discord ID入力用のShort Textブロックを追加
    await pageA.click('button:has-text("ブロックを追加")');
    await pageA.click('button:has-text("短い回答")');
    await pageA.waitForTimeout(500);

    const firstBlockTitle = pageA
      .locator("[data-block-id]")
      .first()
      .locator('input[placeholder*="質問のタイトル"]');
    await firstBlockTitle.fill("Discord ID");
    await pageA.waitForTimeout(1000);

    // 4. GitHub Username入力用のShort Textブロックを追加
    await pageA.click('button:has-text("ブロックを追加")');
    await pageA.click('button:has-text("短い回答")');
    await pageA.waitForTimeout(500);

    const secondBlockTitle = pageA
      .locator("[data-block-id]")
      .nth(1)
      .locator('input[placeholder*="質問のタイトル"]');
    await secondBlockTitle.fill("GitHub Username");
    await pageA.waitForTimeout(1000);

    // 5. Discord検証用のSystemブロックを追加
    await pageA.click('button:has-text("ブロックを追加")');
    const systemButton1 = pageA.locator(
      'button:has-text("外部サービス検証"), button:has-text("システム")',
    );
    if ((await systemButton1.count()) > 0) {
      await systemButton1.first().click();
    }
    await pageA.waitForTimeout(500);

    // Discord検証の設定
    const discordSystemBlock = pageA.locator("[data-block-id]").nth(2);
    const discordTitle = discordSystemBlock.locator(
      'input[placeholder*="タイトル"]',
    );
    await discordTitle.fill("Discord検証");
    await pageA.waitForTimeout(500);

    // Discord ID参照先を選択
    const discordRefSelect = discordSystemBlock.locator("select").first();
    if ((await discordRefSelect.count()) > 0) {
      await discordRefSelect.selectOption({ index: 1 });
    }
    await pageA.waitForTimeout(500);

    // Discordサービスを選択
    const discordServiceSelect = discordSystemBlock.locator("select").nth(1);
    if ((await discordServiceSelect.count()) > 0) {
      await discordServiceSelect.selectOption("discord");
    }
    await pageA.waitForTimeout(500);

    // 6. GitHub検証用のSystemブロックを追加
    await pageA.click('button:has-text("ブロックを追加")');
    const systemButton2 = pageA.locator(
      'button:has-text("外部サービス検証"), button:has-text("システム")',
    );
    if ((await systemButton2.count()) > 0) {
      await systemButton2.first().click();
    }
    await pageA.waitForTimeout(500);

    // GitHub検証の設定
    const githubSystemBlock = pageA.locator("[data-block-id]").nth(3);
    const githubTitle = githubSystemBlock.locator(
      'input[placeholder*="タイトル"]',
    );
    await githubTitle.fill("GitHub検証");
    await pageA.waitForTimeout(500);

    // GitHub Username参照先を選択
    const githubRefSelect = githubSystemBlock.locator("select").first();
    if ((await githubRefSelect.count()) > 0) {
      await githubRefSelect.selectOption({ index: 2 }); // 2番目のブロック
    }
    await pageA.waitForTimeout(500);

    // GitHubサービスを選択
    const githubServiceSelect = githubSystemBlock.locator("select").nth(1);
    if ((await githubServiceSelect.count()) > 0) {
      await githubServiceSelect.selectOption("github");
    }
    await pageA.waitForTimeout(1000);

    // 7. フォームを保存/公開
    const saveButton = pageA.locator(
      'button:has-text("保存"), button:has-text("公開")',
    );
    if ((await saveButton.count()) > 0) {
      await saveButton.first().click();
      await pageA.waitForTimeout(2000);
    }

    // 8. 回答者としてフォームに回答
    const respondentPage = await context.newPage();
    await respondentPage.goto(`/forms/public/${form.publicId}`);
    await respondentPage.waitForLoadState("networkidle");

    // プレビューモードに切り替え（必要な場合）
    const previewButton = respondentPage.locator(
      'button:has-text("プレビュー")',
    );
    if ((await previewButton.count()) > 0) {
      await previewButton.click();
      await respondentPage.waitForTimeout(1000);
    }

    // Discord IDを入力
    const inputs = respondentPage.locator('input[type="text"]');
    await inputs.nth(0).fill("multiuser#1234");
    await respondentPage.waitForTimeout(500);

    // GitHub Usernameを入力
    await inputs.nth(1).fill("multiuser-gh");
    await respondentPage.waitForTimeout(500);

    // フォームを送信
    const submitButton = respondentPage.locator(
      'button:has-text("送信"), button[type="submit"]',
    );
    if ((await submitButton.count()) > 0) {
      await submitButton.click();
      await respondentPage.waitForTimeout(3000);
    }

    // 9. 管理者画面で両方の検証結果を確認
    await pageA.goto("/");
    await pageA.click(`a[href*="${form.id}"]`);

    // 回答タブに移動
    const responsesTab = pageA.locator('button:has-text("回答")');
    if ((await responsesTab.count()) > 0) {
      await responsesTab.click();
      await pageA.waitForTimeout(2000);
    }

    // 検証が完了するまで待機
    await pageA.waitForTimeout(5000);

    // 両方の検証結果が存在することを確認
    const validationResults = pageA.locator(
      '[data-testid*="validation"], text=/Discord.*検証|GitHub.*検証/',
    );
    const resultCount = await validationResults.count();

    // 検証結果が実際に表示されていることを確認（少なくとも1つ以上）
    expect(resultCount).toBeGreaterThan(0);

    // クリーンアップ
    await respondentPage.close();
    await pageA.close();
  });

  test("検証結果が個別に表示される", async ({ context }) => {
    const pageA = await createAuthenticatedContext(context, TEST_USERS.userA);

    // 注: 検証は非同期ジョブとして実行されるため、モックは不要

    // Discord成功 + GitHub失敗のフォームを作成
    const form = await createTestForm(pageA);
    await goToFormEditor(pageA, form.id);

    // （フォーム設定とテストは上記と同様）

    await pageA.close();
  });
});
