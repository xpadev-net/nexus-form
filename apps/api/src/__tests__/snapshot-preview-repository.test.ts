import { db } from "@nexus-form/database";
import type { formSnapshot } from "@nexus-form/database/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSnapshotPreviewByVersion } from "../lib/forms/snapshot-repository";

vi.mock("@nexus-form/database", () => ({
  db: {
    transaction: vi.fn(),
    query: {
      form: { findFirst: vi.fn() },
      formSnapshot: { findFirst: vi.fn() },
    },
    select: vi.fn(),
  },
}));

vi.mock("../lib/forms/validation-rule-repository", () => ({
  serializeFormValidationRules: vi.fn().mockResolvedValue("[]"),
  parseValidationRuleSnapshot: vi.fn().mockReturnValue([]),
  replaceValidationRulesFromSnapshot: vi.fn().mockResolvedValue(undefined),
}));

const mockSnapshotFind = vi.mocked(db.query.formSnapshot.findFirst);

function makeSnapshot(structureJson: string): typeof formSnapshot.$inferSelect {
  return {
    id: "snapshot-2",
    formId: "form-1",
    version: 2,
    plateContent: '[{"type":"p","children":[{"text":"履歴版"}]}]',
    validationRulesJson: "[]",
    structureJson,
    isActive: false,
    publishedBy: "user-1",
    publishedAt: new Date("2025-02-02T03:04:05.000Z"),
    changeLog: null,
    title: "履歴版フォーム",
    description: null,
    parentVersion: 1,
  };
}

describe("snapshot preview repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only validated preview fields from the requested snapshot", async () => {
    const appearance = {
      theme: {
        primary_color: "#be123c",
        accent_color: "#0f766e",
        background_color: "#fff7ed",
        font_family: "Noto Sans JP",
      },
      layout: {
        width: "full" as const,
        alignment: "left" as const,
        spacing: "compact" as const,
        show_progress_bar: false,
        progress_position: "bottom" as const,
        show_question_numbers: false,
      },
    };
    const confirmation = {
      title: "履歴版の送信完了",
      message: "履歴版の確認メッセージです。",
      show_response_summary: true,
      show_response_id: true,
      allow_edit_link: false,
    };
    mockSnapshotFind.mockResolvedValue(
      makeSnapshot(
        JSON.stringify({
          version: 2,
          settings: { allow_edit_responses: false },
          appearance,
          confirmation,
          notifications: { channels: [] },
        }),
      ),
    );

    await expect(getSnapshotPreviewByVersion("form-1", 2)).resolves.toEqual({
      plateContent: '[{"type":"p","children":[{"text":"履歴版"}]}]',
      version: 2,
      publishedAt: new Date("2025-02-02T03:04:05.000Z"),
      appearance,
      confirmation,
    });
  });

  it("keeps content previewable when stored structure JSON is invalid", async () => {
    mockSnapshotFind.mockResolvedValue(makeSnapshot("not-json"));

    await expect(getSnapshotPreviewByVersion("form-1", 2)).resolves.toEqual({
      plateContent: '[{"type":"p","children":[{"text":"履歴版"}]}]',
      version: 2,
      publishedAt: new Date("2025-02-02T03:04:05.000Z"),
    });
  });

  it("recovers only valid preview fields from an otherwise invalid structure", async () => {
    mockSnapshotFind.mockResolvedValue(
      makeSnapshot(
        JSON.stringify({
          version: 2,
          settings: "legacy-invalid-settings",
          appearance: {
            theme: { primary_color: "invalid-color" },
          },
          confirmation: {
            title: "履歴版の送信完了",
            message: "履歴版の確認メッセージです。",
            show_response_summary: false,
            show_response_id: true,
            allow_edit_link: false,
          },
        }),
      ),
    );

    await expect(getSnapshotPreviewByVersion("form-1", 2)).resolves.toEqual({
      plateContent: '[{"type":"p","children":[{"text":"履歴版"}]}]',
      version: 2,
      publishedAt: new Date("2025-02-02T03:04:05.000Z"),
      confirmation: {
        title: "履歴版の送信完了",
        message: "履歴版の確認メッセージです。",
        show_response_summary: false,
        show_response_id: true,
        allow_edit_link: false,
      },
    });
  });
});
