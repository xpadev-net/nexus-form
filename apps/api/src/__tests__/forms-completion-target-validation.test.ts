import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLatestSnapshot: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("../load-env", () => ({}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(() => ({
      set: mocks.updateSet.mockReturnValue({ where: mocks.updateWhere }),
    })),
  },
  form: {
    id: "form.id",
    plateContent: "form.plateContent",
    plateContentVersion: "form.plateContentVersion",
    publishedAt: "form.publishedAt",
    status: "form.status",
  },
  user: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: {},
  externalServiceValidationResult: {},
  fingerprintDetail: {},
  formIntegration: {},
  formInvitation: {},
  formPermission: {},
  formResponse: {},
  formSchedule: {},
  formShareLink: {},
  formSnapshot: {},
  formStructure: {},
  formValidationRule: {},
  formValidationRuleBlock: {},
}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth: () => {
    return async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", {
        auth_type: "session",
        user_id: "user-1",
      });
      await next();
    };
  },
}));

vi.mock("../lib/rate-limit", () => ({
  createRateLimit: () => async (_c: unknown, next: () => Promise<void>) =>
    next(),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("../lib/forms/form-structure-service", () => ({
  getFormStructure: vi.fn(),
}));

vi.mock("../lib/forms/schedule-error-logging", () => ({
  logFormScheduleError: vi.fn(),
}));

vi.mock("../lib/forms/schedule-processor", () => ({
  processFormSchedule: vi.fn(),
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshot: mocks.getLatestSnapshot,
}));

vi.mock("../lib/forms/structure-mutation-lock", () => ({
  withFormStructureMutationLock: vi.fn(
    async (_formId: string, mutation: () => Promise<unknown>) => mutation(),
  ),
}));

vi.mock("../lib/forms/validation-rule-repository", () => ({
  parseValidationRuleSnapshot: vi.fn(),
}));

vi.mock("../lib/redis-publisher", () => ({
  publishEditorEvent: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ op: "and", conditions })),
  desc: vi.fn((field) => ({ op: "desc", field })),
  eq: vi.fn((left, right) => ({ op: "eq", left, right })),
  inArray: vi.fn((left, values) => ({ op: "inArray", left, values })),
}));

function paragraph(text: string) {
  return { type: "p", children: [{ text }] };
}

function questionNode(blockId: string, title: string) {
  return {
    type: "form_short_text",
    blockId,
    validation: { type: "short_text" },
    children: [paragraph(title)],
  };
}

function sectionNode(
  blockId: string,
  title: string,
  validation?: Record<string, unknown>,
) {
  return {
    type: "form_section_separator",
    blockId,
    validation: { type: "section_separator", ...validation },
    children: [paragraph(title)],
  };
}

function plateContentWithCompletionTarget(targetId = "section-complete") {
  return [
    sectionNode("section-form", "入力"),
    questionNode("question-1", "氏名"),
    sectionNode("section-complete", "完了", {
      default_action: { type: "submit", target_id: targetId },
    }),
    paragraph("送信ありがとうございました。"),
  ];
}

function plateContentWithAnswerableCompletionTarget() {
  return [
    sectionNode("section-form", "入力"),
    questionNode("question-1", "氏名"),
    sectionNode("section-complete", "完了", {
      default_action: { type: "submit", target_id: "section-complete" },
    }),
    questionNode("question-2", "完了画面に混ざった質問"),
  ];
}

function snapshot(plateContent: unknown[]) {
  return {
    id: "snapshot-1",
    formId: "form-1",
    version: 1,
    plateContent: JSON.stringify(plateContent),
    validationRulesJson: "[]",
    structureJson: "{}",
    isActive: true,
    publishedBy: "user-1",
    publishedAt: new Date("2026-06-24T00:00:00.000Z"),
    title: "Completion target form",
  };
}

async function saveContent(plateContent: unknown[]) {
  const { formsContentRouter } = await import("../routes/forms-content");
  return formsContentRouter.request("/form-1/content", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      plateContent: JSON.stringify(plateContent),
      expectedVersion: 1,
    }),
  });
}

async function publishSnapshotContent(plateContent: unknown[]) {
  mocks.getLatestSnapshot.mockResolvedValue(snapshot(plateContent));
  const { formsDetailRouter } = await import("../routes/forms-detail");
  return formsDetailRouter.request("/form-1/publish", {
    method: "POST",
  });
}

describe("completion target validation on API save and publish", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it("saves and publishes a valid completion target", async () => {
    const plateContent = plateContentWithCompletionTarget();

    const saveResponse = await saveContent(plateContent);
    expect(saveResponse.status).toBe(200);
    await expect(saveResponse.json()).resolves.toEqual({
      plateContentVersion: 2,
    });

    const publishResponse = await publishSnapshotContent(plateContent);
    expect(publishResponse.status).toBe(200);
    await expect(publishResponse.json()).resolves.toEqual({ ok: true });
  });

  it("rejects a missing completion target before saving or publishing", async () => {
    const plateContent = plateContentWithCompletionTarget("missing-section");

    const saveResponse = await saveContent(plateContent);
    expect(saveResponse.status).toBe(400);
    await expect(saveResponse.json()).resolves.toEqual({
      error: "送信後画面の遷移先を確認してください",
      details: { blockIds: ["missing-section"] },
    });

    vi.clearAllMocks();
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
    const publishResponse = await publishSnapshotContent(plateContent);
    expect(publishResponse.status).toBe(400);
    await expect(publishResponse.json()).resolves.toEqual({
      error: "送信後画面の遷移先を確認してください",
      details: { blockIds: ["missing-section"] },
    });
    expect(mocks.updateSet).not.toHaveBeenCalledWith({
      status: "PUBLISHED",
      publishedAt: expect.any(Date),
    });
  });

  it("rejects answerable questions inside the completion target before saving or publishing", async () => {
    const plateContent = plateContentWithAnswerableCompletionTarget();

    const saveResponse = await saveContent(plateContent);
    expect(saveResponse.status).toBe(400);
    await expect(saveResponse.json()).resolves.toEqual({
      error: "送信後画面の遷移先を確認してください",
      details: { blockIds: ["question-2"] },
    });

    vi.clearAllMocks();
    mocks.updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
    const publishResponse = await publishSnapshotContent(plateContent);
    expect(publishResponse.status).toBe(400);
    await expect(publishResponse.json()).resolves.toEqual({
      error: "送信後画面の遷移先を確認してください",
      details: { blockIds: ["question-2"] },
    });
    expect(mocks.updateSet).not.toHaveBeenCalledWith({
      status: "PUBLISHED",
      publishedAt: expect.any(Date),
    });
  });

  it("keeps submit actions without target_id valid for the legacy confirmation flow", async () => {
    const plateContent = [
      sectionNode("section-form", "入力"),
      questionNode("question-1", "氏名"),
      sectionNode("section-confirm", "確認", {
        default_action: { type: "submit" },
      }),
      paragraph("ありがとうございました。"),
    ];

    const saveResponse = await saveContent(plateContent);
    expect(saveResponse.status).toBe(200);

    const publishResponse = await publishSnapshotContent(plateContent);
    expect(publishResponse.status).toBe(200);
  });
});
