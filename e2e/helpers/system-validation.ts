import type { Page } from "@playwright/test";

export interface SystemValidationBlock {
  title: string;
  referencedBlockIndex: number;
  service: "discord" | "github" | "twitter";
  discordGuildId?: string;
}

/**
 * System External Serviceブロックを追加する
 */
export async function addSystemValidationBlock(
  page: Page,
  config: SystemValidationBlock,
): Promise<void> {
  // ブロック追加ボタンをクリック
  await page.click('button:has-text("ブロックを追加")');

  // システムブロックを選択
  const systemButton = page.locator(
    'button:has-text("外部サービス検証"), button:has-text("システム")',
  );
  if ((await systemButton.count()) > 0) {
    await systemButton.first().click();
  } else {
    // フォールバック：メニューから選択
    await page.click('button[role="menuitem"]:has-text("システム")');
    await page.click('button:has-text("外部サービス検証")');
  }
  await page.waitForTimeout(500);

  // 最後に追加されたブロックを取得
  const systemBlock = page.locator("[data-block-id]").last();

  // タイトルを設定
  const titleInput = systemBlock.locator('input[placeholder*="タイトル"]');
  await titleInput.fill(config.title);
  await page.waitForTimeout(500);

  // 参照先ブロックを選択
  const refSelect = systemBlock.locator("select").first();
  if ((await refSelect.count()) > 0) {
    await refSelect.selectOption({ index: config.referencedBlockIndex });
  }
  await page.waitForTimeout(500);

  // サービスを選択
  const serviceSelect = systemBlock.locator("select").nth(1);
  if ((await serviceSelect.count()) > 0) {
    await serviceSelect.selectOption(config.service);
  }
  await page.waitForTimeout(500);

  // Discord Guild IDを設定（Discordの場合）
  if (config.service === "discord" && config.discordGuildId) {
    const guildIdInput = systemBlock.locator(
      'input[placeholder*="Guild ID"], input[name*="guild"]',
    );
    if ((await guildIdInput.count()) > 0) {
      await guildIdInput.fill(config.discordGuildId);
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Short Textブロックを追加する
 */
export async function addShortTextBlock(
  page: Page,
  title: string,
): Promise<void> {
  await page.click('button:has-text("ブロックを追加")');
  await page.click('button:has-text("短い回答")');
  await page.waitForTimeout(500);

  // 最後に追加されたブロックのタイトルを設定
  const lastBlock = page.locator("[data-block-id]").last();
  const titleInput = lastBlock.locator('input[placeholder*="質問のタイトル"]');
  await titleInput.fill(title);
  await page.waitForTimeout(1000);
}

/**
 * フォームタイトルを設定する
 */
export async function setFormTitle(page: Page, title: string): Promise<void> {
  const titleInput = page.locator('input[placeholder*="フォームのタイトル"]');
  await titleInput.fill(title);
  await page.waitForTimeout(1000);
}

/**
 * フォームを保存/公開する
 */
export async function saveForm(page: Page): Promise<void> {
  const saveButton = page.locator(
    'button:has-text("保存"), button:has-text("公開")',
  );
  if ((await saveButton.count()) > 0) {
    await saveButton.first().click();
    await page.waitForTimeout(2000);
  }
}

/**
 * プレビューモードに切り替える
 */
export async function switchToPreviewMode(page: Page): Promise<void> {
  const previewButton = page.locator('button:has-text("プレビュー")');
  if ((await previewButton.count()) > 0) {
    await previewButton.click();
    await page.waitForTimeout(1000);
  }
}

/**
 * フォームに回答を入力する
 */
export async function fillFormResponse(
  page: Page,
  values: string[],
): Promise<void> {
  const inputs = page.locator('input[type="text"]');
  for (const [i, value] of values.entries()) {
    await inputs.nth(i).fill(value);
    await page.waitForTimeout(300);
  }
}

/**
 * フォームを送信する
 */
export async function submitForm(page: Page): Promise<void> {
  const submitButton = page.locator(
    'button:has-text("送信"), button[type="submit"]',
  );
  if ((await submitButton.count()) > 0) {
    await submitButton.click();
    await page.waitForTimeout(2000);
  }
}

/**
 * 回答タブに移動する
 */
export async function goToResponsesTab(page: Page): Promise<void> {
  const responsesTab = page.locator('button:has-text("回答")');
  if ((await responsesTab.count()) > 0) {
    await responsesTab.click();
    await page.waitForTimeout(1000);
  }
}

/**
 * 検証結果を待機する
 */
export async function waitForValidation(
  page: Page,
  timeoutMs = 10000,
): Promise<void> {
  await page.waitForTimeout(timeoutMs);
}

/**
 * 検証結果のステータスを取得する
 */
export async function getValidationStatus(
  page: Page,
  service: string,
): Promise<string | null> {
  const statusElement = page.locator(
    `[data-service="${service}"] [data-testid="validation-status"], text=/${service}.*検証/i`,
  );

  if ((await statusElement.count()) > 0) {
    return await statusElement.first().textContent();
  }

  return null;
}

/**
 * 検証エラーメッセージを取得する
 */
export async function getValidationError(page: Page): Promise<string | null> {
  const errorElement = page.locator(
    '[data-testid="validation-error"], text=/エラー|Error/i',
  );

  if ((await errorElement.count()) > 0) {
    return await errorElement.first().textContent();
  }

  return null;
}

/**
 * 複数サービスの検証結果を確認する
 */
export async function verifyMultipleValidations(
  page: Page,
  services: string[],
): Promise<boolean> {
  for (const service of services) {
    const status = await getValidationStatus(page, service);
    if (!status) {
      return false;
    }
  }
  return true;
}
