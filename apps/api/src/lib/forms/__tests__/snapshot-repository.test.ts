import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nexus-form/database", () => ({
  db: {
    query: {
      form: { findFirst: vi.fn() },
      formSnapshot: { findFirst: vi.fn() },
    },
  },
  form: {},
  formSnapshot: {},
}));

vi.mock("../validation-rule-repository", () => ({
  serializeFormValidationRules: vi.fn().mockResolvedValue("[]"),
  parseValidationRuleSnapshot: vi.fn().mockReturnValue([]),
  replaceValidationRulesFromSnapshot: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@nexus-form/database";
import {
  calculateFormDiff,
  checkUnpublishedChanges,
} from "../snapshot-repository";
import { serializeFormValidationRules } from "../validation-rule-repository";

const mockFormFind = vi.mocked(db.query.form.findFirst);
const mockSnapshotFind = vi.mocked(db.query.formSnapshot.findFirst);
const mockSerializeRules = vi.mocked(serializeFormValidationRules);

type FormFindResult = Awaited<ReturnType<typeof mockFormFind>>;
type SnapshotFindResult = Awaited<ReturnType<typeof mockSnapshotFind>>;

function formData(data: {
  plateContent: string | null;
  updatedAt?: Date;
  baseSnapshotVersion: number | null;
}): FormFindResult {
  return data as unknown as FormFindResult;
}

function snap(s: ReturnType<typeof makeSnapshot>): SnapshotFindResult {
  return s as unknown as SnapshotFindResult;
}

function makeSnapshot(
  overrides: Partial<{
    id: string;
    formId: string;
    version: number;
    plateContent: string;
    validationRulesJson: string;
    isActive: boolean;
    publishedBy: string;
    publishedAt: Date;
    changeLog: string | null;
    title: string;
    description: string | null;
    parentVersion: number | null;
  }> = {},
) {
  return {
    id: "snap-1",
    formId: "form-1",
    version: 1,
    plateContent: "[]",
    validationRulesJson: "[]",
    isActive: true,
    publishedBy: "user-1",
    publishedAt: new Date("2025-01-01"),
    changeLog: null,
    title: "Test Form",
    description: null,
    parentVersion: null,
    ...overrides,
  };
}

function makePlateNodes(
  nodes: Array<{ id: string; type: string; [key: string]: unknown }>,
): string {
  return JSON.stringify(nodes);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSerializeRules.mockResolvedValue("[]");
});

describe("checkUnpublishedChanges", () => {
  it("スナップショットがない場合、コンテンツがあれば hasChanges:true を返す", async () => {
    mockFormFind.mockResolvedValue(
      formData({
        plateContent: '[{"id":"node-1","type":"short_text"}]',
        updatedAt: new Date(),
        baseSnapshotVersion: null,
      }),
    );
    mockSnapshotFind.mockResolvedValue(undefined);

    const result = await checkUnpublishedChanges("form-1");

    expect(result.hasChanges).toBe(true);
    expect(result.lastPublishedAt).toBeNull();
  });

  it("スナップショットがなく plateContent も空の場合は hasChanges:false を返す", async () => {
    mockFormFind.mockResolvedValue(
      formData({
        plateContent: "[]",
        updatedAt: new Date(),
        baseSnapshotVersion: null,
      }),
    );
    mockSnapshotFind.mockResolvedValue(undefined);

    const result = await checkUnpublishedChanges("form-1");

    expect(result.hasChanges).toBe(false);
  });

  it("コンテンツがスナップショットと同一の場合は hasChanges:false を返す", async () => {
    const plateContent = '[{"id":"node-1","type":"short_text"}]';
    const publishedAt = new Date("2025-01-01");
    const snapshot = makeSnapshot({ plateContent, publishedAt });

    mockFormFind.mockResolvedValue(
      formData({ plateContent, updatedAt: new Date(), baseSnapshotVersion: 1 }),
    );
    mockSnapshotFind.mockResolvedValue(snap(snapshot));
    mockSerializeRules.mockResolvedValue("[]");

    const result = await checkUnpublishedChanges("form-1");

    expect(result.hasChanges).toBe(false);
    expect(result.lastPublishedAt).toEqual(publishedAt);
  });

  it("plateContent が変更されている場合は hasChanges:true を返す", async () => {
    const snapshotContent = '[{"id":"node-1","type":"short_text"}]';
    const currentContent =
      '[{"id":"node-1","type":"short_text"},{"id":"node-2","type":"short_text"}]';
    const snapshot = makeSnapshot({ plateContent: snapshotContent });

    mockFormFind.mockResolvedValue(
      formData({
        plateContent: currentContent,
        updatedAt: new Date(),
        baseSnapshotVersion: 1,
      }),
    );
    mockSnapshotFind.mockResolvedValue(snap(snapshot));

    const result = await checkUnpublishedChanges("form-1");

    expect(result.hasChanges).toBe(true);
  });

  it("バリデーションルールのみが変更されている場合は hasValidationRuleChanges:true を返す", async () => {
    const plateContent = '[{"id":"node-1","type":"short_text"}]';
    const snapshot = makeSnapshot({
      plateContent,
      validationRulesJson: '[{"id":"rule-old"}]',
    });

    mockFormFind.mockResolvedValue(
      formData({ plateContent, updatedAt: new Date(), baseSnapshotVersion: 1 }),
    );
    mockSnapshotFind.mockResolvedValue(snap(snapshot));
    mockSerializeRules.mockResolvedValue('[{"id":"rule-new"}]');

    const result = await checkUnpublishedChanges("form-1");

    expect(result.hasChanges).toBe(true);
    expect(result.hasValidationRuleChanges).toBe(true);
  });
});

describe("calculateFormDiff", () => {
  it("スナップショットがない場合に hasUnpublishedChanges:true を返す", async () => {
    mockFormFind.mockResolvedValue(
      formData({
        plateContent: makePlateNodes([{ id: "a", type: "short_text" }]),
        baseSnapshotVersion: null,
      }),
    );
    mockSnapshotFind.mockResolvedValue(undefined);

    const result = await calculateFormDiff("form-1");

    expect(result.hasUnpublishedChanges).toBe(true);
    expect(result.totalChanges).toBeGreaterThan(0);
  });

  it("コンテンツが一致する場合に hasUnpublishedChanges:false を返す", async () => {
    const plateContent = makePlateNodes([
      { id: "a", type: "short_text", children: [{ text: "Hello" }] },
    ]);
    const snapshot = makeSnapshot({ plateContent, validationRulesJson: "[]" });

    mockFormFind.mockResolvedValue(
      formData({ plateContent, baseSnapshotVersion: 1 }),
    );
    // getSnapshotByVersion(baseVersion) → for base, getLatestSnapshot() → for active
    mockSnapshotFind
      .mockResolvedValueOnce(snap(snapshot))
      .mockResolvedValueOnce(snap(snapshot));

    const result = await calculateFormDiff("form-1");

    expect(result.hasUnpublishedChanges).toBe(false);
    expect(result.totalChanges).toBe(0);
    expect(result.nodes).toHaveLength(0);
  });

  it("ノードが追加されると diffType:added を含む", async () => {
    const baseContent = makePlateNodes([{ id: "a", type: "short_text" }]);
    const currentContent = makePlateNodes([
      { id: "a", type: "short_text" },
      { id: "b", type: "short_text" },
    ]);
    const snapshot = makeSnapshot({
      plateContent: baseContent,
      validationRulesJson: "[]",
    });

    mockFormFind.mockResolvedValue(
      formData({ plateContent: currentContent, baseSnapshotVersion: 1 }),
    );
    mockSnapshotFind
      .mockResolvedValueOnce(snap(snapshot))
      .mockResolvedValueOnce(snap(snapshot));

    const result = await calculateFormDiff("form-1");

    expect(result.hasUnpublishedChanges).toBe(true);
    expect(
      result.nodes.some((n) => n.nodeId === "b" && n.diffType === "added"),
    ).toBe(true);
  });

  it("ノードが削除されると diffType:removed を含む", async () => {
    const baseContent = makePlateNodes([
      { id: "a", type: "short_text" },
      { id: "b", type: "short_text" },
    ]);
    const currentContent = makePlateNodes([{ id: "a", type: "short_text" }]);
    const snapshot = makeSnapshot({
      plateContent: baseContent,
      validationRulesJson: "[]",
    });

    mockFormFind.mockResolvedValue(
      formData({ plateContent: currentContent, baseSnapshotVersion: 1 }),
    );
    mockSnapshotFind
      .mockResolvedValueOnce(snap(snapshot))
      .mockResolvedValueOnce(snap(snapshot));

    const result = await calculateFormDiff("form-1");

    expect(
      result.nodes.some((n) => n.nodeId === "b" && n.diffType === "removed"),
    ).toBe(true);
  });

  it("ノードが変更されると diffType:modified を含む", async () => {
    const baseContent = makePlateNodes([
      { id: "a", type: "short_text", children: [{ text: "Original" }] },
    ]);
    const currentContent = makePlateNodes([
      { id: "a", type: "short_text", children: [{ text: "Updated" }] },
    ]);
    const snapshot = makeSnapshot({
      plateContent: baseContent,
      validationRulesJson: "[]",
    });

    mockFormFind.mockResolvedValue(
      formData({ plateContent: currentContent, baseSnapshotVersion: 1 }),
    );
    mockSnapshotFind
      .mockResolvedValueOnce(snap(snapshot))
      .mockResolvedValueOnce(snap(snapshot));

    const result = await calculateFormDiff("form-1");

    expect(
      result.nodes.some((n) => n.nodeId === "a" && n.diffType === "modified"),
    ).toBe(true);
  });

  it("id を持たないノードは差分に含まれない", async () => {
    const baseContent = JSON.stringify([{ type: "paragraph" }]);
    const currentContent = JSON.stringify([
      { type: "paragraph" },
      { type: "divider" },
    ]);
    const snapshot = makeSnapshot({
      plateContent: baseContent,
      validationRulesJson: "[]",
    });

    mockFormFind.mockResolvedValue(
      formData({ plateContent: currentContent, baseSnapshotVersion: 1 }),
    );
    mockSnapshotFind
      .mockResolvedValueOnce(snap(snapshot))
      .mockResolvedValueOnce(snap(snapshot));

    const result = await calculateFormDiff("form-1");

    expect(result.nodes).toHaveLength(0);
  });
});
