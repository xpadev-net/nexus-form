import type { Page } from "@playwright/test";

export interface TestForm {
  id: string;
  title: string;
  publicId: string;
}

export interface TestBlock {
  id: string;
  type: "question" | "section_separator";
  title?: string;
  description?: string;
  options?: string[];
}

/**
 * テスト用のフォームを作成する
 */
export async function createTestForm(page: Page): Promise<TestForm> {
  // トップページに移動（フォーム一覧が表示される）
  await page.goto("/");

  // 新規フォーム作成ボタンをクリック
  await page.click('button:has-text("新しいフォーム")');

  // フォーム作成完了を待つ
  await page.waitForURL(/\/forms\/.+/, { timeout: 10000 });

  // フォームIDを取得
  const url = page.url();
  const formId = url.split("/forms/")[1]?.split("/")[0] || "";

  // フォーム情報をAPIから取得してpublicIdを取得
  const response = await page.request.get(`/api/forms/${formId}`);
  const data = await response.json();
  const publicId = data.metadata?.public_id || "";

  return {
    id: formId,
    title: "Test Form",
    publicId,
  };
}

/**
 * フォーム編集ページに移動する
 */
export async function goToFormEditor(
  page: Page,
  formId: string,
): Promise<void> {
  await page.goto(`/forms/${formId}/edit`);
  await page.waitForLoadState("networkidle");
}

/**
 * ブロックのタイトルを編集する
 */
export async function editBlockTitle(
  page: Page,
  blockId: string,
  newTitle: string,
): Promise<void> {
  // ブロックのタイトル入力フィールドを見つける
  const titleInput = page.locator(
    `[data-block-id="${blockId}"] input[placeholder*="タイトル"], [data-block-id="${blockId}"] input[placeholder*="質問"]`,
  );
  await titleInput.fill(newTitle);

  // デバウンス処理を待つ（800ms）
  await page.waitForTimeout(1000);
}

/**
 * ブロックの説明を編集する
 */
export async function editBlockDescription(
  page: Page,
  blockId: string,
  newDescription: string,
): Promise<void> {
  const descriptionInput = page.locator(
    `[data-block-id="${blockId}"] textarea[placeholder*="説明"]`,
  );
  await descriptionInput.fill(newDescription);

  // デバウンス処理を待つ
  await page.waitForTimeout(1000);
}

/**
 * ブロックの選択肢を編集する
 */
export async function editBlockOptions(
  page: Page,
  blockId: string,
  options: string[],
): Promise<void> {
  // 既存の選択肢をクリアして新しい選択肢を設定
  for (let i = 0; i < options.length; i++) {
    const optionInput = page
      .locator(`[data-block-id="${blockId}"]`)
      .locator(`input[placeholder*="選択肢"]`)
      .nth(i);

    if (await optionInput.count()) {
      await optionInput.fill(options[i]);
    } else {
      // 新しい選択肢を追加
      const addButton = page
        .locator(`[data-block-id="${blockId}"]`)
        .locator('button:has-text("選択肢を追加")');
      await addButton.click();
      await page
        .locator(`[data-block-id="${blockId}"]`)
        .locator(`input[placeholder*="選択肢"]`)
        .nth(i)
        .fill(options[i]);
    }
  }

  // デバウンス処理を待つ
  await page.waitForTimeout(1000);
}

/**
 * ブロックの選択肢の値を取得する
 */
export async function getBlockOptions(
  page: Page,
  blockId: string,
): Promise<string[]> {
  const optionInputs = page
    .locator(`[data-block-id="${blockId}"]`)
    .locator(`input[placeholder*="選択肢"]`);

  const count = await optionInputs.count();
  const options: string[] = [];

  for (let i = 0; i < count; i++) {
    const value = await optionInputs.nth(i).inputValue();
    options.push(value);
  }

  return options;
}

/**
 * ブロックを削除する
 */
export async function deleteBlock(page: Page, blockId: string): Promise<void> {
  // ブロックの削除ボタンをクリック
  const deleteButton = page
    .locator(`[data-block-id="${blockId}"]`)
    .locator('button[aria-label*="削除"]');
  await deleteButton.click();

  // 確認ダイアログで削除を確認
  const confirmButton = page.locator('button:has-text("削除")').last();
  await confirmButton.click();

  // 削除処理が完了するのを待つ
  await page.waitForTimeout(1000);
}

/**
 * ブロックの値を取得する
 */
export async function getBlockTitle(
  page: Page,
  blockId: string,
): Promise<string> {
  const titleInput = page.locator(
    `[data-block-id="${blockId}"] input[placeholder*="タイトル"], [data-block-id="${blockId}"] input[placeholder*="質問"]`,
  );
  return (await titleInput.inputValue()) || "";
}

/**
 * 衝突UIが表示されているかを確認する
 */
export async function hasConflictUI(
  page: Page,
  blockId: string,
): Promise<boolean> {
  const conflictIndicator = page.locator(
    `[data-block-id="${blockId}"] [data-testid="conflict-indicator"]`,
  );
  return (await conflictIndicator.count()) > 0;
}

/**
 * 衝突解決で「自分の変更を採用」を選択する
 */
export async function resolveConflictWithLocal(
  page: Page,
  blockId: string,
): Promise<void> {
  await page
    .locator(`[data-block-id="${blockId}"]`)
    .locator('button:has-text("自分の変更")')
    .click();

  await page.waitForTimeout(500);
}

/**
 * 衝突解決で「サーバー版を採用」を選択する
 */
export async function resolveConflictWithServer(
  page: Page,
  blockId: string,
): Promise<void> {
  await page
    .locator(`[data-block-id="${blockId}"]`)
    .locator('button:has-text("サーバー版")')
    .click();

  await page.waitForTimeout(500);
}

/**
 * 変更が同期されるまで待つ
 */
export async function waitForSync(page: Page): Promise<void> {
  // 2秒のポーリング間隔 + 余裕を見て3秒待つ
  await page.waitForTimeout(3000);
}

/**
 * ネットワークをオフラインにする
 */
export async function goOffline(page: Page): Promise<void> {
  await page.context().setOffline(true);
}

/**
 * ネットワークをオンラインに戻す
 */
export async function goOnline(page: Page): Promise<void> {
  await page.context().setOffline(false);
}
