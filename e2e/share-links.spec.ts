import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import mysql from "mysql2/promise";

const seededOwnerIdPrefix = "e2e-share-owner-";
const seededIdPrefix = "e2e-share-";
const seededShareLinkIdPrefix = "e2e-share-link-";
const seededStructureIdPrefix = "e2e-structure-";
const seededSnapshotIdPrefix = "e2e-snapshot-";
const seededValidationRuleIdPrefix = "e2e-validation-rule-";
const validationProviderName = "e2e_validation";
const validationRuleType = "matches_fixture";
const validationExpectedValue = "ci-validation-value";
const documentHiddenStateKey = "nexus-form-e2e-document-hidden";

type SeededShareLinkForm = {
  formId: string;
  viewerToken: string;
  editorToken: string;
  questionBlockId: string;
};

type SeedShareLinkFormOptions = {
  withExternalValidation?: boolean;
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

function getBaseURL(): string {
  return process.env.BASE_URL || "http://localhost:3000";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function seedShareLinkForm(
  options: SeedShareLinkFormOptions = {},
): Promise<SeededShareLinkForm> {
  const formId = `${seededIdPrefix}${Date.now()}-${randomUUID()}`;
  const ownerId = `${seededOwnerIdPrefix}${randomUUID()}`;
  const viewerToken = `e2e-viewer-${randomUUID()}`;
  const editorToken = `e2e-editor-${randomUUID()}`;
  const questionBlockId = `e2e-question-${randomUUID()}`;
  const structureJson = JSON.stringify({
    version: 1,
    settings: { allow_edit_responses: false },
  });
  const plateContent = JSON.stringify([
    {
      type: "form_short_text",
      blockId: questionBlockId,
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
    if (options.withExternalValidation) {
      const validationRuleId = `${seededValidationRuleIdPrefix}${randomUUID()}`;
      await connection.execute(
        `INSERT INTO \`FormValidationRule\`
          (id, formId, name, providerName, ruleType, configJson, orderIndex)
         VALUES (?, ?, ?, ?, ?, JSON_OBJECT('expectedValue', ?), ?)`,
        [
          validationRuleId,
          formId,
          "CI deterministic external validation",
          validationProviderName,
          validationRuleType,
          validationExpectedValue,
          0,
        ],
      );
      await connection.execute(
        `INSERT INTO \`FormValidationRuleBlock\`
          (id, ruleId, referencedBlockId, orderIndex)
         VALUES (?, ?, ?, ?)`,
        [randomUUID(), validationRuleId, questionBlockId, 0],
      );
      await connection.execute(
        `INSERT INTO \`FormSnapshot\`
          (id, formId, version, isActive, publishedBy, changeLog, title,
           description, plateContent, validationRulesJson, structureJson)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `${seededSnapshotIdPrefix}${randomUUID()}`,
          formId,
          1,
          true,
          ownerId,
          "E2E external validation snapshot",
          "E2E Share Link Form",
          "Shared editor test form",
          plateContent,
          "[]",
          structureJson,
        ],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }

  return { formId, viewerToken, editorToken, questionBlockId };
}

async function waitForEditorEventConnection(
  page: Page,
  formId: string,
): Promise<void> {
  await page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.status() === 200 &&
        url.pathname === `/api/forms/${formId}/editor/events`
      );
    },
    { timeout: 15_000 },
  );
}

async function installDocumentVisibilityControl(page: Page): Promise<void> {
  await page.addInitScript((stateKey) => {
    Reflect.set(globalThis, stateKey, false);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => Reflect.get(globalThis, stateKey) === true,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () =>
        Reflect.get(globalThis, stateKey) === true ? "hidden" : "visible",
    });
  }, documentHiddenStateKey);
}

async function setDocumentVisibility(
  page: Page,
  hidden: boolean,
): Promise<void> {
  await page.evaluate(
    ({ hidden, stateKey }) => {
      Reflect.set(globalThis, stateKey, hidden);
      document.dispatchEvent(new Event("visibilitychange"));
    },
    { hidden, stateKey: documentHiddenStateKey },
  );
}

async function getValidationState(
  page: Page,
  formId: string,
  responseId: string,
  token: string,
): Promise<Record<string, unknown> | null> {
  const response = await page.request.get(
    `/api/forms/${formId}/responses/${responseId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok()) return null;

  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.externalValidations)) return null;
  const validation = body.externalValidations.find(
    (entry) => isRecord(entry) && entry.service === validationProviderName,
  );
  return isRecord(validation) ? validation : null;
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
  await expect(page.getByRole("textbox", { name: "フォーム名" })).toHaveCount(
    0,
  );
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

  test("viewer/editor の共有リンクで未ログインのままフォームを読み込める", {
    tag: ["@ci-critical", "@ci-shared-link"],
  }, async ({ browser }) => {
    const seeded = await seedShareLinkForm();

    for (const [role, token] of [
      ["viewer", seeded.viewerToken],
      ["editor", seeded.editorToken],
    ] as const) {
      const context = await browser.newContext({ baseURL: getBaseURL() });
      const page = await context.newPage();
      const apiResponses: CapturedApiResponse[] = [];

      try {
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
        await expect(
          page.locator('[data-slate-string="true"]', {
            hasText: "E2E share link question",
          }),
        ).toBeVisible();

        if (role === "viewer") {
          await expectViewerEditorIsReadOnly(page, seeded.formId, token);
        }

        const failedResponses = apiResponses.filter(
          (response) => response.status >= 400,
        );
        expect(failedResponses, `${role} share link API failures`).toEqual([]);
      } finally {
        await context.close();
      }
    }
  });

  test("editor 共有リンクだけがフォーム更新 API を実行できる", {
    tag: ["@ci-critical", "@ci-shared-link"],
  }, async ({ page }) => {
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

  test("editor SSE が共同編集イベントを再接続後も受信する", {
    tag: ["@ci-critical", "@ci-realtime"],
  }, async ({ browser }) => {
    test.setTimeout(60_000);
    const seeded = await seedShareLinkForm();
    const listenerContext = await browser.newContext({
      baseURL: getBaseURL(),
    });
    const writerContext = await browser.newContext({ baseURL: getBaseURL() });
    const listenerPage = await listenerContext.newPage();
    const writerPage = await writerContext.newPage();
    await installDocumentVisibilityControl(listenerPage);

    try {
      const initialConnection = waitForEditorEventConnection(
        listenerPage,
        seeded.formId,
      );
      await listenerPage.goto(
        `/forms/${seeded.formId}/edit?shareToken=${encodeURIComponent(
          seeded.editorToken,
        )}`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(listenerPage.getByText("E2E Share Link Form")).toBeVisible();
      await initialConnection;

      await setDocumentVisibility(listenerPage, true);

      const contentBeforeRecovery = await writerPage.request.get(
        `/api/forms/${seeded.formId}/content`,
        { headers: { Authorization: `Bearer ${seeded.editorToken}` } },
      );
      expect(contentBeforeRecovery.status()).toBe(200);
      const contentBeforeRecoveryBody: unknown =
        await contentBeforeRecovery.json();
      if (
        !isRecord(contentBeforeRecoveryBody) ||
        typeof contentBeforeRecoveryBody.plateContentVersion !== "number"
      ) {
        throw new Error("Content lookup returned an invalid version");
      }

      const recoveredContent = JSON.stringify([
        {
          type: "p",
          children: [{ text: "recovered update" }],
        },
      ]);
      const recoveredSave = await writerPage.request.put(
        `/api/forms/${seeded.formId}/content`,
        {
          data: {
            expectedVersion: contentBeforeRecoveryBody.plateContentVersion,
            plateContent: recoveredContent,
          },
          headers: { Authorization: `Bearer ${seeded.editorToken}` },
        },
      );
      expect(recoveredSave.status()).toBe(200);

      const recoveredConnection = waitForEditorEventConnection(
        listenerPage,
        seeded.formId,
      );
      await setDocumentVisibility(listenerPage, false);
      await recoveredConnection;
      await expect(
        listenerPage.locator('[data-slate-string="true"]', {
          hasText: "recovered update",
        }),
      ).toBeVisible();

      const currentContent = await writerPage.request.get(
        `/api/forms/${seeded.formId}/content`,
        { headers: { Authorization: `Bearer ${seeded.editorToken}` } },
      );
      expect(currentContent.status()).toBe(200);
      const currentBody: unknown = await currentContent.json();
      if (
        !isRecord(currentBody) ||
        typeof currentBody.plateContentVersion !== "number"
      ) {
        throw new Error("Final content lookup returned an invalid payload");
      }
      expect(currentBody.plateContent).toBe(recoveredContent);
      expect(currentBody.plateContentVersion).toBeGreaterThanOrEqual(
        contentBeforeRecoveryBody.plateContentVersion + 1,
      );
    } finally {
      await setDocumentVisibility(listenerPage, false).catch(() => {});
      await listenerContext.close();
      await writerContext.close();
    }
  });

  test("CI 外部検証 provider が Worker 経由で完了する", {
    tag: ["@ci-critical", "@ci-external-validation"],
  }, async ({ page }) => {
    test.setTimeout(60_000);
    const seeded = await seedShareLinkForm({
      withExternalValidation: true,
    });
    await page.goto(
      `/forms/${seeded.formId}/edit?shareToken=${encodeURIComponent(
        seeded.editorToken,
      )}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByText("E2E Share Link Form")).toBeVisible();

    const createResponse = await page.request.post(
      `/api/forms/${seeded.formId}/responses`,
      {
        data: {
          responses: [
            {
              question_id: seeded.questionBlockId,
              question_type: "short_text",
              value: validationExpectedValue,
            },
          ],
        },
        headers: { Authorization: `Bearer ${seeded.editorToken}` },
      },
    );
    const createBody: unknown = await createResponse.json();
    expect(
      createResponse.status(),
      `response creation payload: ${JSON.stringify(createBody)}`,
    ).toBe(201);
    if (!isRecord(createBody) || !isRecord(createBody.response)) {
      throw new Error("Response creation returned an invalid payload");
    }
    const responseId = createBody.response.id;
    if (typeof responseId !== "string") {
      throw new Error("Response creation did not return an id");
    }

    const revalidate = await page.request.post(
      `/api/forms/${seeded.formId}/responses/${responseId}/validation/revalidate`,
      { headers: { Authorization: `Bearer ${seeded.editorToken}` } },
    );
    expect(revalidate.status()).toBe(200);
    const revalidateBody: unknown = await revalidate.json();
    if (!isRecord(revalidateBody)) {
      throw new Error("Validation enqueue returned an invalid payload");
    }
    expect(revalidateBody.enqueued).toBe(1);
    expect(revalidateBody.skipped).toBe(0);

    await expect
      .poll(
        async () => {
          const validation = await getValidationState(
            page,
            seeded.formId,
            responseId,
            seeded.editorToken,
          );
          if (!validation) return null;
          return {
            fixture: isRecord(validation.metadata)
              ? validation.metadata.fixture
              : validation.metadata,
            status: validation.status,
            success: validation.success,
          };
        },
        { intervals: [250, 500, 1_000], timeout: 30_000 },
      )
      .toEqual({ fixture: "ci", status: "COMPLETED", success: true });
  });
});
