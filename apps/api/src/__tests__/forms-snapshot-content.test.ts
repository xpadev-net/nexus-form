import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSnapshotPreviewByVersion: vi.fn(),
}));

vi.mock("../load-env", () => ({}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  formSnapshot: {
    id: "formSnapshot.id",
    formId: "formSnapshot.formId",
    version: "formSnapshot.version",
    isActive: "formSnapshot.isActive",
    publishedBy: "formSnapshot.publishedBy",
    publishedAt: "formSnapshot.publishedAt",
    changeLog: "formSnapshot.changeLog",
    title: "formSnapshot.title",
    description: "formSnapshot.description",
    parentVersion: "formSnapshot.parentVersion",
    plateContent: "formSnapshot.plateContent",
    validationRulesJson: "formSnapshot.validationRulesJson",
    structureJson: "formSnapshot.structureJson",
  },
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
  createRateLimit: () => {
    return async (_c: unknown, next: () => Promise<void>) => next();
  },
  getClientIp: () => "127.0.0.1",
}));

vi.mock("../lib/forms/snapshot-repository", () => ({
  activateSnapshot: vi.fn(),
  calculateFormDiff: vi.fn(),
  checkUnpublishedChanges: vi.fn(),
  getLatestSnapshot: vi.fn(),
  getLatestSnapshotByVersion: vi.fn(),
  getSnapshotPreviewByVersion: mocks.getSnapshotPreviewByVersion,
  publishSnapshot: vi.fn(),
  restoreFromSnapshot: vi.fn(),
  restoreFromSnapshotVersion: vi.fn(),
}));

vi.mock("../lib/forms/validation-rule-repository", () => ({
  ValidationRuleConfigError: class ValidationRuleConfigError extends Error {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  count: vi.fn(() => ({ type: "count" })),
  desc: vi.fn((column: unknown) => ({ type: "desc", column })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
}));

describe("snapshot preview content route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only validated preview fields from the requested version", async () => {
    mocks.getSnapshotPreviewByVersion.mockResolvedValue({
      plateContent: '[{"type":"p","children":[{"text":"履歴版"}]}]',
      version: 2,
      publishedAt: new Date("2026-07-01T01:02:03.000Z"),
      appearance: {
        theme: {
          primary_color: "#be123c",
          accent_color: "#0f766e",
          background_color: "#fff7ed",
          font_family: "Noto Sans JP",
        },
        layout: {
          width: "full",
          alignment: "left",
          spacing: "compact",
          show_progress_bar: false,
          progress_position: "bottom",
          show_question_numbers: false,
        },
      },
      confirmation: {
        title: "履歴版の送信完了",
        message: "履歴版の確認メッセージです。",
        show_response_summary: true,
        show_response_id: true,
        allow_edit_link: false,
      },
      structureJson: "must-not-leak",
      settings: { allow_edit_responses: true },
    });
    const { formsSnapshotsRouter } = await import("../routes/forms-snapshots");

    const response = await formsSnapshotsRouter.request(
      "/form-1/snapshots/2/content",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      plateContent: '[{"type":"p","children":[{"text":"履歴版"}]}]',
      version: 2,
      publishedAt: "2026-07-01T01:02:03.000Z",
      appearance: {
        theme: {
          primary_color: "#be123c",
          accent_color: "#0f766e",
          background_color: "#fff7ed",
          font_family: "Noto Sans JP",
        },
        layout: {
          width: "full",
          alignment: "left",
          spacing: "compact",
          show_progress_bar: false,
          progress_position: "bottom",
          show_question_numbers: false,
        },
      },
      confirmation: {
        title: "履歴版の送信完了",
        message: "履歴版の確認メッセージです。",
        show_response_summary: true,
        show_response_id: true,
        allow_edit_link: false,
      },
    });
    expect(mocks.getSnapshotPreviewByVersion).toHaveBeenCalledWith("form-1", 2);
  });

  it("returns 404 when the requested snapshot does not exist", async () => {
    mocks.getSnapshotPreviewByVersion.mockResolvedValue(null);
    const { formsSnapshotsRouter } = await import("../routes/forms-snapshots");

    const response = await formsSnapshotsRouter.request(
      "/form-1/snapshots/9/content",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Snapshot not found",
    });
  });

  it("rejects an invalid version before reading the repository", async () => {
    const { formsSnapshotsRouter } = await import("../routes/forms-snapshots");

    const response = await formsSnapshotsRouter.request(
      "/form-1/snapshots/invalid/content",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid version",
    });
    expect(mocks.getSnapshotPreviewByVersion).not.toHaveBeenCalled();
  });
});
