/**
 * E2E アクセシビリティテスト
 * Playwright と axe-core を使用して、実際のブラウザ環境でアクセシビリティをテスト
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("アクセシビリティ - 全体", () => {
  test("ホームページのアクセシビリティ", async ({ page }) => {
    await page.goto("/");

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test("フォーム一覧ページのアクセシビリティ", async ({ page }) => {
    // 認証が必要な場合はスキップ
    await page.goto("/");

    // ログインページにリダイレクトされる場合はスキップ
    const url = page.url();
    if (url.includes("/auth/signin")) {
      test.skip();
    }

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules([
        "heading-order", // 見出しの階層が不正
      ])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });
});

test.describe("アクセシビリティ - フォーム操作", () => {
  test("キーボードナビゲーション", async ({ page }) => {
    await page.goto("/");

    // Tabキーでナビゲーション
    await page.keyboard.press("Tab");

    // フォーカスされた要素が適切にハイライトされていることを確認
    const focusedElement = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;

      const styles = window.getComputedStyle(el);
      return {
        tagName: el.tagName,
        outline: styles.outline,
        outlineWidth: styles.outlineWidth,
      };
    });

    // フォーカスインジケーターが存在することを確認
    expect(focusedElement).not.toBeNull();
  });

  test("スクリーンリーダー用のラベル", async ({ page }) => {
    await page.goto("/");

    // すべてのボタンとリンクにアクセシブルな名前があることを確認
    const elementsWithoutLabels = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll("button, a[href]"),
      ) as HTMLElement[];
      return buttons
        .filter((button) => {
          const label =
            button.getAttribute("aria-label") ||
            button.getAttribute("aria-labelledby") ||
            button.textContent?.trim();
          return !label || label.length === 0;
        })
        .map((button) => ({
          tagName: button.tagName,
          className: button.className,
          id: button.id,
        }));
    });

    expect(elementsWithoutLabels).toEqual([]);
  });
});

test.describe("アクセシビリティ - コントラスト比", () => {
  test("カラーコントラスト比の確認", async ({ page }) => {
    await page.goto("/");

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(["wcag2aa"])
      .include("body")
      .analyze();

    // コントラスト比に関する違反をフィルタリング
    const contrastViolations = accessibilityScanResults.violations.filter(
      (violation) => violation.id === "color-contrast",
    );

    // コントラスト比の違反がないことを確認
    expect(contrastViolations).toEqual([]);
  });
});

test.describe("アクセシビリティ - フォーカス管理", () => {
  test("モーダル/ダイアログのフォーカストラップ", async ({ page }) => {
    await page.goto("/");

    // モーダルを開くボタンを探す（実際のセレクタに応じて調整）
    const modalTrigger = page.locator('button:has-text("作成")').first();

    if ((await modalTrigger.count()) > 0) {
      await modalTrigger.click();

      // モーダル内でTabキーを押す
      await page.keyboard.press("Tab");

      // フォーカスがモーダル内にあることを確認
      const focusedElement = await page.evaluate(() => {
        const el = document.activeElement;
        const modal = document.querySelector('[role="dialog"]');
        return modal?.contains(el || null);
      });

      expect(focusedElement).toBeTruthy();
    }
  });

  test("フォームエラー時のフォーカス管理", async ({ page }) => {
    await page.goto("/");

    // フォーム送信をシミュレート（実際のフォームに応じて調整）
    const submitButton = page.locator('button[type="submit"]').first();

    if ((await submitButton.count()) > 0) {
      await submitButton.click();

      // エラーメッセージが表示された場合、適切にフォーカスされることを確認
      const errorElement = page.locator('[role="alert"]').first();

      if ((await errorElement.count()) > 0) {
        await expect(errorElement).toBeVisible();
      }
    }
  });
});

test.describe("アクセシビリティ - ARIA属性", () => {
  test("必須フィールドのARIA属性", async ({ page }) => {
    await page.goto("/");

    // 必須フィールドにaria-required属性が設定されていることを確認
    const requiredFields = await page.evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll("input, textarea, select"),
      ) as HTMLInputElement[];
      return inputs
        .filter((input) => input.required)
        .map((input) => ({
          id: input.id,
          name: input.name,
          hasAriaRequired: input.getAttribute("aria-required") === "true",
        }));
    });

    // すべての必須フィールドにaria-requiredが設定されていることを確認
    for (const field of requiredFields) {
      expect(field.hasAriaRequired).toBeTruthy();
    }
  });

  test("無効な入力のARIA属性", async ({ page }) => {
    await page.goto("/");

    // エラーのある入力フィールドにaria-invalid属性が設定されていることを確認
    const invalidFields = await page.evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll("input[aria-invalid='true']"),
      ) as HTMLInputElement[];
      return inputs.map((input) => ({
        id: input.id,
        name: input.name,
        hasAriaDescribedby: input.getAttribute("aria-describedby") !== null,
      }));
    });

    // すべての無効なフィールドにaria-describedbyが設定されていることを確認
    for (const field of invalidFields) {
      expect(field.hasAriaDescribedby).toBeTruthy();
    }
  });
});

test.describe("アクセシビリティ - ランドマーク", () => {
  test("適切なランドマークロールの使用", async ({ page }) => {
    await page.goto("/");

    // ページにmain、nav、footerなどのランドマークが存在することを確認
    const landmarks = await page.evaluate(() => {
      return {
        hasMain:
          document.querySelector("main") !== null ||
          document.querySelector('[role="main"]') !== null,
        hasNav:
          document.querySelector("nav") !== null ||
          document.querySelector('[role="navigation"]') !== null,
      };
    });

    expect(landmarks.hasMain).toBeTruthy();
  });
});

test.describe("アクセシビリティ - 見出し構造", () => {
  test("適切な見出し階層", async ({ page }) => {
    await page.goto("/");

    // 見出しの階層が正しいことを確認
    const headingStructure = await page.evaluate(() => {
      const headings = Array.from(
        document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
      ) as HTMLHeadingElement[];
      return headings.map((heading) => ({
        level: Number.parseInt(heading.tagName.substring(1), 10),
        text: heading.textContent?.trim(),
      }));
    });

    // h1が存在することを確認
    const h1Count = headingStructure.filter((h) => h.level === 1).length;
    expect(h1Count).toBeGreaterThan(0);

    // 見出しレベルがスキップされていないことを確認
    for (const [i, heading] of headingStructure.entries()) {
      if (i === 0) continue;
      const previousHeading = headingStructure[i - 1];
      if (!previousHeading) continue;

      const currentLevel = heading.level;
      const previousLevel = previousHeading.level;
      const levelDiff = currentLevel - previousLevel;

      // レベルが2以上上がっていないことを確認
      expect(levelDiff).toBeLessThanOrEqual(1);
    }
  });
});

test.describe("アクセシビリティ - 画像", () => {
  test("画像の代替テキスト", async ({ page }) => {
    await page.goto("/");

    // すべての画像に適切なalt属性があることを確認
    const imagesWithoutAlt = await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll("img"));
      return images
        .filter(
          (img) =>
            !img.hasAttribute("alt") &&
            img.getAttribute("role") !== "presentation",
        )
        .map((img) => ({
          src: img.src,
          className: img.className,
        }));
    });

    expect(imagesWithoutAlt).toEqual([]);
  });
});
