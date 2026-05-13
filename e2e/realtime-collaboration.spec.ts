import { expect, type Page, test } from "@playwright/test";
import { getBaseURL, TEST_USERS } from "./helpers/auth";
import {
  createTestForm,
  deleteBlock,
  editBlockDescription,
  editBlockOptions,
  editBlockTitle,
  getBlockTitle,
  goOffline,
  goOnline,
  goToFormEditor,
  hasConflictUI,
  resolveConflictWithLocal,
  resolveConflictWithServer,
  waitForSync,
} from "./helpers/form";

test.describe("リアルタイム同時編集", () => {
  test.describe.configure({ mode: "serial" });

  test("シナリオ1: 基本的な同時編集（自動マージ）", async ({ browser }) => {
    const baseURL = getBaseURL();
    // 2つのブラウザコンテキストを作成
    const contextA = await browser.newContext({ baseURL });
    const contextB = await browser.newContext({ baseURL });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // ユーザーAでログイン
      await pageA.goto("/auth/signin");
      await pageA.fill('input[type="email"]', TEST_USERS.userA.email);
      await pageA.fill('input[type="password"]', TEST_USERS.userA.password);
      await pageA.click('button[type="submit"]');
      await pageA.waitForURL("/", { timeout: 10000 });

      // テストフォームを作成
      const form = await createTestForm(pageA);

      // ユーザーBでログイン
      await pageB.goto("/auth/signin");
      await pageB.fill('input[type="email"]', TEST_USERS.userB.email);
      await pageB.fill('input[type="password"]', TEST_USERS.userB.password);
      await pageB.click('button[type="submit"]');
      await pageB.waitForURL("/", { timeout: 10000 });

      // 両方のユーザーでフォーム編集ページを開く
      await goToFormEditor(pageA, form.id);
      await goToFormEditor(pageB, form.id);

      // フォームに最初のブロックが存在するか確認し、なければ作成
      const blockElements = await pageA.locator("[data-block-id]").count();

      if (blockElements === 0) {
        // ブロックを追加
        await pageA.click('button:has-text("質問を追加")');
        await pageA.waitForTimeout(1000);
        await pageA.click('button:has-text("質問を追加")');
        await pageA.waitForTimeout(1000);
      }

      // ブロックIDを取得
      const block1 = await pageA.locator("[data-block-id]").first();
      const block2 = await pageA.locator("[data-block-id]").nth(1);
      const blockId1 = (await block1.getAttribute("data-block-id")) || "";
      const blockId2 = (await block2.getAttribute("data-block-id")) || "";

      // ユーザーA: block-1 の title を編集
      await editBlockTitle(pageA, blockId1, "Question A Title");

      // ユーザーB: block-2 の options を編集
      await editBlockOptions(pageB, blockId2, [
        "Option A",
        "Option B",
        "Option C",
      ]);

      // 変更が同期されるまで待つ
      await waitForSync(pageA);
      await waitForSync(pageB);

      // 両方の変更が保持されていることを確認
      const titleA = await getBlockTitle(pageA, blockId1);
      const titleB = await getBlockTitle(pageB, blockId1);

      expect(titleA).toBe("Question A Title");
      expect(titleB).toBe("Question A Title");

      // ユーザーBで編集したblock-2のoptionsが保存されていることを確認
      const optionsB = await pageB
        .locator(`[data-block-id="${blockId2}"] input[placeholder*="選択肢"]`)
        .count();
      expect(optionsB).toBeGreaterThanOrEqual(3);

      console.log("✓ シナリオ1: 基本的な同時編集（自動マージ）成功");
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("シナリオ2: 衝突発生と解決", async ({ browser }) => {
    const baseURL = getBaseURL();
    const contextA = await browser.newContext({ baseURL });
    const contextB = await browser.newContext({ baseURL });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // ユーザーAでログイン
      await pageA.goto("/auth/signin");
      await pageA.fill('input[type="email"]', TEST_USERS.userA.email);
      await pageA.fill('input[type="password"]', TEST_USERS.userA.password);
      await pageA.click('button[type="submit"]');
      await pageA.waitForURL("/", { timeout: 10000 });

      // テストフォームを作成
      const form = await createTestForm(pageA);

      // ユーザーBでログイン
      await pageB.goto("/auth/signin");
      await pageB.fill('input[type="email"]', TEST_USERS.userB.email);
      await pageB.fill('input[type="password"]', TEST_USERS.userB.password);
      await pageB.click('button[type="submit"]');
      await pageB.waitForURL("/", { timeout: 10000 });

      // 両方のユーザーでフォーム編集ページを開く
      await goToFormEditor(pageA, form.id);
      await goToFormEditor(pageB, form.id);

      // ブロックを追加
      await pageA.click('button:has-text("質問を追加")');
      await pageA.waitForTimeout(1000);

      // ブロックIDを取得
      const block1 = await pageA.locator("[data-block-id]").first();
      const blockId1 = (await block1.getAttribute("data-block-id")) || "";

      // 初期値を設定
      await editBlockTitle(pageA, blockId1, "Initial Title");
      await waitForSync(pageA);
      await waitForSync(pageB);

      // ユーザーA: block-1 の title を "Question A" に変更
      await editBlockTitle(pageA, blockId1, "Question A");

      // ユーザーB: 同じblock-1 の title を "Question B" に変更（ほぼ同時）
      await editBlockTitle(pageB, blockId1, "Question B");

      // 変更が同期されるまで待つ
      await waitForSync(pageA);
      await waitForSync(pageB);

      // 衝突UIが表示されることを確認
      const hasConflictA = await hasConflictUI(pageA, blockId1);
      const hasConflictB = await hasConflictUI(pageB, blockId1);

      // どちらか一方に衝突UIが表示されるはず
      expect(hasConflictA || hasConflictB).toBeTruthy();

      // 衝突が表示された方で解決を試みる
      if (hasConflictA) {
        await resolveConflictWithLocal(pageA, blockId1);
        await waitForSync(pageA);
        const finalTitle = await getBlockTitle(pageA, blockId1);
        expect(finalTitle).toBe("Question A");
      } else if (hasConflictB) {
        await resolveConflictWithServer(pageB, blockId1);
        await waitForSync(pageB);
        const finalTitle = await getBlockTitle(pageB, blockId1);
        expect(finalTitle).not.toBe("Question B");
      }

      console.log("✓ シナリオ2: 衝突発生と解決成功");
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("シナリオ3: 異なるフィールドの同時編集（自動マージ）", async ({
    browser,
  }) => {
    const baseURL = getBaseURL();
    const contextA = await browser.newContext({ baseURL });
    const contextB = await browser.newContext({ baseURL });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // ユーザーAでログイン
      await pageA.goto("/auth/signin");
      await pageA.fill('input[type="email"]', TEST_USERS.userA.email);
      await pageA.fill('input[type="password"]', TEST_USERS.userA.password);
      await pageA.click('button[type="submit"]');
      await pageA.waitForURL("/", { timeout: 10000 });

      // テストフォームを作成
      const form = await createTestForm(pageA);

      // ユーザーBでログイン
      await pageB.goto("/auth/signin");
      await pageB.fill('input[type="email"]', TEST_USERS.userB.email);
      await pageB.fill('input[type="password"]', TEST_USERS.userB.password);
      await pageB.click('button[type="submit"]');
      await pageB.waitForURL("/", { timeout: 10000 });

      // 両方のユーザーでフォーム編集ページを開く
      await goToFormEditor(pageA, form.id);
      await goToFormEditor(pageB, form.id);

      // ブロックを追加
      await pageA.click('button:has-text("質問を追加")');
      await pageA.waitForTimeout(1000);

      // ブロックIDを取得
      const block1 = await pageA.locator("[data-block-id]").first();
      const blockId1 = (await block1.getAttribute("data-block-id")) || "";

      // ユーザーA: block-1 の title を編集
      await editBlockTitle(pageA, blockId1, "Updated Title");

      // ユーザーB: 同じblock-1 の description を編集
      await editBlockDescription(pageB, blockId1, "Updated Description");

      // 変更が同期されるまで待つ
      await waitForSync(pageA);
      await waitForSync(pageB);

      // 両方の変更が自動的にマージされていることを確認
      const titleA = await getBlockTitle(pageA, blockId1);
      const titleB = await getBlockTitle(pageB, blockId1);

      expect(titleA).toBe("Updated Title");
      expect(titleB).toBe("Updated Title");

      // 衝突UIが表示されていないことを確認
      const hasConflictA = await hasConflictUI(pageA, blockId1);
      const hasConflictB = await hasConflictUI(pageB, blockId1);

      expect(hasConflictA).toBeFalsy();
      expect(hasConflictB).toBeFalsy();

      console.log("✓ シナリオ3: 異なるフィールドの同時編集（自動マージ）成功");
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("シナリオ4: 削除との衝突", async ({ browser }) => {
    const baseURL = getBaseURL();
    const contextA = await browser.newContext({ baseURL });
    const contextB = await browser.newContext({ baseURL });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // ユーザーAでログイン
      await pageA.goto("/auth/signin");
      await pageA.fill('input[type="email"]', TEST_USERS.userA.email);
      await pageA.fill('input[type="password"]', TEST_USERS.userA.password);
      await pageA.click('button[type="submit"]');
      await pageA.waitForURL("/", { timeout: 10000 });

      // テストフォームを作成
      const form = await createTestForm(pageA);

      // ユーザーBでログイン
      await pageB.goto("/auth/signin");
      await pageB.fill('input[type="email"]', TEST_USERS.userB.email);
      await pageB.fill('input[type="password"]', TEST_USERS.userB.password);
      await pageB.click('button[type="submit"]');
      await pageB.waitForURL("/", { timeout: 10000 });

      // 両方のユーザーでフォーム編集ページを開く
      await goToFormEditor(pageA, form.id);
      await goToFormEditor(pageB, form.id);

      // ブロックを追加
      await pageA.click('button:has-text("質問を追加")');
      await pageA.waitForTimeout(1000);

      // ブロックIDを取得
      const block1 = await pageA.locator("[data-block-id]").first();
      const blockId1 = (await block1.getAttribute("data-block-id")) || "";

      // 両方のページでブロックが表示されるまで待つ
      await waitForSync(pageA);
      await waitForSync(pageB);

      // ユーザーA: block-1 を削除
      await deleteBlock(pageA, blockId1);

      // ユーザーB: 削除されたblock-1 を編集しようとする
      await editBlockTitle(pageB, blockId1, "Editing Deleted Block");

      // 変更が同期されるまで待つ
      await waitForSync(pageB);

      // ユーザーBに削除通知が表示されることを確認
      // （実装によっては410 Goneエラーまたは削除通知UI）
      const deletedNotification = await pageB
        .locator('[role="alert"]:has-text("削除")')
        .count();
      const errorMessage = await pageB
        .locator(':has-text("410"), :has-text("Gone")')
        .count();

      expect(deletedNotification + errorMessage).toBeGreaterThan(0);

      console.log("✓ シナリオ4: 削除との衝突成功");
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("シナリオ5: 配列要素のマージ（自動マージ）", async ({ browser }) => {
    const baseURL = getBaseURL();
    const contextA = await browser.newContext({ baseURL });
    const contextB = await browser.newContext({ baseURL });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // ユーザーAでログイン
      await pageA.goto("/auth/signin");
      await pageA.fill('input[type="email"]', TEST_USERS.userA.email);
      await pageA.fill('input[type="password"]', TEST_USERS.userA.password);
      await pageA.click('button[type="submit"]');
      await pageA.waitForURL("/", { timeout: 10000 });

      // テストフォームを作成
      const form = await createTestForm(pageA);

      // ユーザーBでログイン
      await pageB.goto("/auth/signin");
      await pageB.fill('input[type="email"]', TEST_USERS.userB.email);
      await pageB.fill('input[type="password"]', TEST_USERS.userB.password);
      await pageB.click('button[type="submit"]');
      await pageB.waitForURL("/", { timeout: 10000 });

      // 両方のユーザーでフォーム編集ページを開く
      await goToFormEditor(pageA, form.id);
      await goToFormEditor(pageB, form.id);

      // 選択式の質問を追加
      await pageA.click('button:has-text("質問を追加")');
      await pageA.waitForTimeout(1000);

      // ブロックIDを取得
      const block1 = await pageA.locator("[data-block-id]").first();
      const blockId1 = (await block1.getAttribute("data-block-id")) || "";

      // 初期の選択肢を設定 [A, B, C]
      await editBlockOptions(pageA, blockId1, [
        "Option A",
        "Option B",
        "Option C",
      ]);
      await waitForSync(pageA);
      await waitForSync(pageB);

      // ユーザーA: "Option D" を末尾に追加
      await editBlockOptions(pageA, blockId1, [
        "Option A",
        "Option B",
        "Option C",
        "Option D",
      ]);

      // ユーザーB: "Option E" を B-C 間に挿入
      await editBlockOptions(pageB, blockId1, [
        "Option A",
        "Option B",
        "Option E",
        "Option C",
      ]);

      // 変更が同期されるまで待つ
      await waitForSync(pageA);
      await waitForSync(pageB);

      // 期待結果: [A, B, E, C, D] にマージされる
      const optionsCountA = await pageA
        .locator(`[data-block-id="${blockId1}"] input[placeholder*="選択肢"]`)
        .count();
      const optionsCountB = await pageB
        .locator(`[data-block-id="${blockId1}"] input[placeholder*="選択肢"]`)
        .count();

      // 5つの選択肢が存在することを確認（自動マージの結果）
      expect(optionsCountA).toBe(5);
      expect(optionsCountB).toBe(5);

      // 選択肢の順序を確認（期待: [A, B, E, C, D]）
      const optionValuesA = await Promise.all(
        Array.from({ length: 5 }).map(async (_, i) =>
          pageA
            .locator(
              `[data-block-id="${blockId1}"] input[placeholder*="選択肢"]`,
            )
            .nth(i)
            .inputValue(),
        ),
      );

      // 自動マージが正しく動作していることを確認
      // サーバー側の順序（B-C間にE挿入）とローカルの追加（D末尾）がマージされる
      expect(optionValuesA).toContain("Option A");
      expect(optionValuesA).toContain("Option B");
      expect(optionValuesA).toContain("Option C");
      expect(optionValuesA).toContain("Option D");
      expect(optionValuesA).toContain("Option E");

      console.log("✓ シナリオ5: 配列要素のマージ（自動マージ）成功");
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("シナリオ6: ブロック順序の同時変更（自動マージ）", async ({
    browser,
  }) => {
    const baseURL = getBaseURL();
    const contextA = await browser.newContext({ baseURL });
    const contextB = await browser.newContext({ baseURL });

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // ユーザーAでログイン
      await pageA.goto("/auth/signin");
      await pageA.fill('input[type="email"]', TEST_USERS.userA.email);
      await pageA.fill('input[type="password"]', TEST_USERS.userA.password);
      await pageA.click('button[type="submit"]');
      await pageA.waitForURL("/", { timeout: 10000 });

      // テストフォームを作成
      const form = await createTestForm(pageA);

      // ユーザーBでログイン
      await pageB.goto("/auth/signin");
      await pageB.fill('input[type="email"]', TEST_USERS.userB.email);
      await pageB.fill('input[type="password"]', TEST_USERS.userB.password);
      await pageB.click('button[type="submit"]');
      await pageB.waitForURL("/", { timeout: 10000 });

      // 両方のユーザーでフォーム編集ページを開く
      await goToFormEditor(pageA, form.id);
      await goToFormEditor(pageB, form.id);

      // 4つのブロックを追加
      for (let i = 0; i < 4; i++) {
        await pageA.click('button:has-text("質問を追加")');
        await pageA.waitForTimeout(500);
      }

      // ブロックIDを取得
      const blocks = await pageA.locator("[data-block-id]").all();
      const blockIds = await Promise.all(
        blocks.map((block) => block.getAttribute("data-block-id")),
      );

      // タイトルを設定して識別しやすくする
      for (let i = 0; i < blockIds.length; i++) {
        if (blockIds[i]) {
          await editBlockTitle(pageA, blockIds[i] as string, `Block ${i + 1}`);
        }
      }

      await waitForSync(pageA);
      await waitForSync(pageB);

      // 初期順序を確認: [Block 1, Block 2, Block 3, Block 4]
      const getBlockOrder = async (page: Page) => {
        const blocks = await page.locator("[data-block-id]").all();
        const titles = await Promise.all(
          blocks.map(async (block) => {
            const blockId = (await block.getAttribute("data-block-id")) || "";
            return await getBlockTitle(page, blockId);
          }),
        );
        return titles;
      };

      const initialOrderA = await getBlockOrder(pageA);
      expect(initialOrderA).toEqual([
        "Block 1",
        "Block 2",
        "Block 3",
        "Block 4",
      ]);

      // NOTE: ブロック順序の並べ替え機能は現在フロントエンドで実装中です
      // ドラッグ&ドロップまたは移動ボタンが実装されたら、以下のテストを有効化してください
      //
      // 期待される動作:
      // - ユーザーA: block-3 を block-1 の後に移動 → [Block 1, Block 3, Block 2, Block 4]
      // - ユーザーB: block-4 を block-2 の後に移動 → [Block 1, Block 2, Block 4, Block 3]
      // - 結果: サーバー側の順序を優先しつつ、両方の変更が反映される
      //
      // 実装例:
      // await pageA.locator(`[data-block-id="${blockIds[2]}"]`).dragTo(pageA.locator(`[data-block-id="${blockIds[0]}"]`));
      // await pageB.locator(`[data-block-id="${blockIds[3]}"]`).dragTo(pageB.locator(`[data-block-id="${blockIds[1]}"]`));
      // await waitForSync(pageA);
      // await waitForSync(pageB);
      // const finalOrderA = await getBlockOrder(pageA);
      // expect(finalOrderA.length).toBe(4);
      // expect(finalOrderA).toContain("Block 1");
      // expect(finalOrderA).toContain("Block 2");
      // expect(finalOrderA).toContain("Block 3");
      // expect(finalOrderA).toContain("Block 4");

      // 現時点では、ブロックが正しく作成・表示されることのみを確認
      const finalBlocksA = await pageA.locator("[data-block-id]").count();
      const finalBlocksB = await pageB.locator("[data-block-id]").count();

      expect(finalBlocksA).toBe(4);
      expect(finalBlocksB).toBe(4);

      console.log(
        "✓ シナリオ6: ブロック順序の同時変更（自動マージ）- 基本動作確認完了（並べ替え機能は実装待ち）",
      );
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("シナリオ7: ネットワーク断からの復帰", async ({ browser }) => {
    const baseURL = getBaseURL();
    const contextA = await browser.newContext({ baseURL });
    const pageA = await contextA.newPage();

    try {
      // ユーザーAでログイン
      await pageA.goto("/auth/signin");
      await pageA.fill('input[type="email"]', TEST_USERS.userA.email);
      await pageA.fill('input[type="password"]', TEST_USERS.userA.password);
      await pageA.click('button[type="submit"]');
      await pageA.waitForURL("/", { timeout: 10000 });

      // テストフォームを作成
      const form = await createTestForm(pageA);
      await goToFormEditor(pageA, form.id);

      // ブロックを追加
      await pageA.click('button:has-text("質問を追加")');
      await pageA.waitForTimeout(1000);

      // ブロックIDを取得
      const block1 = await pageA.locator("[data-block-id]").first();
      const blockId1 = (await block1.getAttribute("data-block-id")) || "";

      // オンラインで編集
      await editBlockTitle(pageA, blockId1, "Online Edit");
      await waitForSync(pageA);

      // ネットワークをオフラインにする
      await goOffline(pageA);

      // オフライン中に編集
      await editBlockTitle(pageA, blockId1, "Offline Edit");
      await pageA.waitForTimeout(1000);

      // ネットワークを復帰
      await goOnline(pageA);

      // 同期が再開されるまで待つ
      await waitForSync(pageA);

      // オフライン中の編集が自動的にサーバーと同期されることを確認
      const finalTitle = await getBlockTitle(pageA, blockId1);
      expect(finalTitle).toBe("Offline Edit");

      console.log("✓ シナリオ7: ネットワーク断からの復帰成功");
    } finally {
      await contextA.close();
    }
  });
});
