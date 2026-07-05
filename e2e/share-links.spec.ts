import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import mysql from "mysql2/promise";

const seededOwnerIdPrefix = "e2e-share-owner-";
const seededIdPrefix = "e2e-share-";
const seededShareLinkIdPrefix = "e2e-share-link-";
const seededStructureIdPrefix = "e2e-structure-";

type SeededShareLinkForm = {
  formId: string;
  viewerToken: string;
  editorToken: string;
};

type CapturedApiResponse = {
  method: string;
  status: number;
  url: string;
};

function requireDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for share-links E2E seed");
  }
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
  const allowNonTestDatabase = process.env.E2E_ALLOW_NON_TEST_DATABASE === "1";
  if (!allowNonTestDatabase && !/(^|_)(ci|e2e|test)(_|$)/i.test(databaseName)) {
    throw new Error(
      "share-links E2E seed requires a ci/e2e/test database name or E2E_ALLOW_NON_TEST_DATABASE=1",
    );
  }
  return databaseUrl;
}

async function cleanupSeededShareLinkForms(): Promise<void> {
  const connection = await mysql.createConnection(requireDatabaseUrl());
  try {
    await connection.beginTransaction();
    await connection.execute("DELETE FROM `FormShareLink` WHERE id LIKE ?", [
      `${seededShareLinkIdPrefix}%`,
    ]);
    await connection.execute("DELETE FROM `FormStructure` WHERE id LIKE ?", [
      `${seededStructureIdPrefix}%`,
    ]);
    await connection.execute("DELETE FROM `Form` WHERE id LIKE ?", [
      `${seededIdPrefix}%`,
    ]);
    await connection.execute("DELETE FROM `User` WHERE id LIKE ?", [
      `${seededOwnerIdPrefix}%`,
    ]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

async function seedShareLinkForm(): Promise<SeededShareLinkForm> {
  const formId = `${seededIdPrefix}${Date.now()}-${randomUUID()}`;
  const ownerId = `${seededOwnerIdPrefix}${randomUUID()}`;
  const viewerToken = `e2e-viewer-${randomUUID()}`;
  const editorToken = `e2e-editor-${randomUUID()}`;
  const structureJson = JSON.stringify({
    version: 1,
    settings: { allow_edit_responses: false },
  });
  const plateContent = JSON.stringify([
    {
      id: "block-short-text-1",
      type: "p",
      children: [{ text: "E2E share link question" }],
    },
  ]);

  const connection = await mysql.createConnection(requireDatabaseUrl());
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO \`User\`
        (id, email, name, emailVerified, role, isSuspended)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name)`,
      [
        ownerId,
        `${ownerId}@example.test`,
        "E2E Share Owner",
        true,
        "user",
        false,
      ],
    );
    await connection.execute(
      `INSERT INTO \`Form\`
        (id, publicId, title, description, creatorId, form_status,
         allowEditResponses, plateContent, plateContentVersion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        formId,
        `public-${formId}`,
        "E2E Share Link Form",
        "Shared editor test form",
        ownerId,
        "DRAFT",
        false,
        plateContent,
        0,
      ],
    );
    await connection.execute(
      `INSERT INTO \`FormStructure\`
        (id, formId, activeFormId, structureJson, version, createdBy,
         isActive, changeLog)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `${seededStructureIdPrefix}${randomUUID()}`,
        formId,
        formId,
        structureJson,
        1,
        ownerId,
        true,
        "E2E seed",
      ],
    );
    await connection.execute(
      `INSERT INTO \`FormShareLink\`
        (id, formId, token, form_share_role, isActive, createdBy)
       VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
      [
        `${seededShareLinkIdPrefix}${randomUUID()}`,
        formId,
        viewerToken,
        "VIEWER",
        true,
        ownerId,
        `${seededShareLinkIdPrefix}${randomUUID()}`,
        formId,
        editorToken,
        "EDITOR",
        true,
        ownerId,
      ],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }

  return { formId, viewerToken, editorToken };
}

async function updateFormTitleWithShareToken(
  page: Page,
  formId: string,
  token: string,
  title: string,
): Promise<number> {
  return page.evaluate(
    async ({ formId, title, token }) => {
      const response = await fetch(`/api/forms/${formId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      });
      return response.status;
    },
    { formId, title, token },
  );
}

async function expectViewerEditorIsReadOnly(
  page: Page,
  formId: string,
  token: string,
): Promise<void> {
  await expect(page.getByRole("textbox", { name: "フォーム名" })).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /Editing mode|Editing|Viewing|Suggestion/,
    }),
  ).toHaveCount(0);
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /設定/ })).toBeDisabled();
  await expect(page.getByRole("tab", { name: /検証/ })).toBeDisabled();
  await expect(page.getByRole("tab", { name: /共有/ })).toBeDisabled();
  await expect(page.getByRole("tab", { name: /回答/ })).toBeDisabled();

  await page.goto(
    `/forms/${formId}/edit?shareToken=${encodeURIComponent(
      token,
    )}&tab=settings`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page).toHaveURL(/tab=editor/);
  await expect(page.getByText("フォーム管理")).toHaveCount(0);
}

test.describe("共有リンク編集画面", () => {
  test.afterAll(async () => {
    await cleanupSeededShareLinkForms();
  });

  test("viewer/editor の共有リンクで未ログインのままフォームを読み込める", async ({
    browser,
  }) => {
    const seeded = await seedShareLinkForm();

    for (const [role, token] of [
      ["viewer", seeded.viewerToken],
      ["editor", seeded.editorToken],
    ] as const) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const apiResponses: CapturedApiResponse[] = [];

      page.on("response", (response) => {
        const url = response.url();
        if (!url.includes(`/api/forms/${seeded.formId}`)) return;
        const parsedUrl = new URL(url);
        apiResponses.push({
          method: response.request().method(),
          status: response.status(),
          url: parsedUrl.search
            ? `${parsedUrl.pathname}?query`
            : parsedUrl.pathname,
        });
      });

      await page.goto(
        `/forms/${seeded.formId}/edit?shareToken=${encodeURIComponent(token)}`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(page.getByText("E2E Share Link Form")).toBeVisible();
      await expect(page.getByText("E2E share link question")).toBeVisible();

      if (role === "viewer") {
        await expectViewerEditorIsReadOnly(page, seeded.formId, token);
      }

      const failedResponses = apiResponses.filter(
        (response) => response.status >= 400,
      );
      expect(failedResponses, `${role} share link API failures`).toEqual([]);

      await context.close();
    }
  });

  test("editor 共有リンクだけがフォーム更新 API を実行できる", async ({
    page,
  }) => {
    const seeded = await seedShareLinkForm();

    await page.goto(
      `/forms/${seeded.formId}/edit?shareToken=${encodeURIComponent(
        seeded.editorToken,
      )}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByText("E2E Share Link Form")).toBeVisible();

    const editorUpdateStatus = await updateFormTitleWithShareToken(
      page,
      seeded.formId,
      seeded.editorToken,
      "E2E Share Link Form Edited",
    );
    expect(editorUpdateStatus).toBe(200);

    const viewerUpdateStatus = await updateFormTitleWithShareToken(
      page,
      seeded.formId,
      seeded.viewerToken,
      "Viewer must not edit",
    );
    expect(viewerUpdateStatus).toBe(403);
  });
});
