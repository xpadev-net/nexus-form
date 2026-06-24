import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nexus-form/database", () => ({
  db: {
    transaction: vi.fn(),
    query: {
      form: { findFirst: vi.fn() },
      formSnapshot: { findFirst: vi.fn() },
    },
    select: vi.fn(),
  },
  form: {},
  formSnapshot: {},
  formStructure: {},
}));

vi.mock("../validation-rule-repository", () => ({
  serializeFormValidationRules: vi.fn().mockResolvedValue("[]"),
  parseValidationRuleSnapshot: vi.fn().mockReturnValue([]),
  replaceValidationRulesFromSnapshot: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@nexus-form/database";
import { FormValidationError } from "../../errors/form-errors";
import {
  activateSnapshot,
  calculateFormDiff,
  checkUnpublishedChanges,
  publishSnapshot,
} from "../snapshot-repository";
import {
  replaceValidationRulesFromSnapshot,
  serializeFormValidationRules,
} from "../validation-rule-repository";

const mockTransaction = vi.mocked(db.transaction);
const mockFormFind = vi.mocked(db.query.form.findFirst);
const mockSnapshotFind = vi.mocked(db.query.formSnapshot.findFirst);
const mockSerializeRules = vi.mocked(serializeFormValidationRules);
const mockReplaceRules = vi.mocked(replaceValidationRulesFromSnapshot);
const mockDbSelect = vi.mocked(db.select);
const DEFAULT_STRUCTURE_JSON = JSON.stringify({
  version: 1,
  settings: { allow_edit_responses: false },
});

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
    structureJson: string;
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
    structureJson: DEFAULT_STRUCTURE_JSON,
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

type SelectBuilder = {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  for: ReturnType<typeof vi.fn>;
};

function makeSelectBuilder<T>(result: T): SelectBuilder {
  const builder: SelectBuilder = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    for: vi.fn(),
  };
  builder.from.mockReturnValue(builder);
  builder.where.mockReturnValue(builder);
  builder.orderBy.mockReturnValue(builder);
  builder.limit.mockResolvedValue(result);
  builder.for.mockResolvedValue(result);
  return builder;
}

function makeMutationBuilder(): {
  values: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
} {
  const builder = {
    values: vi.fn(),
    set: vi.fn(),
    where: vi.fn(),
  };
  builder.values.mockResolvedValue(undefined);
  builder.set.mockReturnValue(builder);
  builder.where.mockResolvedValue(undefined);
  return builder;
}

function makeSnapshotPublishTransaction(plateContent: string): void {
  const insertBuilder = makeMutationBuilder();
  const updateBuilder = makeMutationBuilder();
  const tx = {
    select: vi
      .fn()
      .mockReturnValueOnce(makeSelectBuilder([{ id: "form-1" }]))
      .mockReturnValueOnce(makeSelectBuilder([]))
      .mockReturnValueOnce(
        makeSelectBuilder([{ structureJson: DEFAULT_STRUCTURE_JSON }]),
      ),
    query: {
      form: {
        findFirst: vi.fn().mockResolvedValue({
          title: "Test Form",
          description: null,
          plateContent,
          baseSnapshotVersion: null,
        }),
      },
      formSnapshot: { findFirst: vi.fn().mockResolvedValue(makeSnapshot()) },
    },
    insert: vi.fn().mockReturnValue(insertBuilder),
    update: vi.fn().mockReturnValue(updateBuilder),
  };

  mockTransaction.mockImplementationOnce(
    async (callback: Parameters<typeof db.transaction>[0]): Promise<unknown> =>
      callback(
        tx as unknown as Parameters<Parameters<typeof db.transaction>[0]>[0],
      ),
  );
}

function mockCurrentStructureJson(structureJson: string): void {
  mockDbSelect.mockReturnValue({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{ structureJson }]),
        })),
      })),
    })),
  } as unknown as ReturnType<typeof db.select>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSerializeRules.mockResolvedValue("[]");
  mockReplaceRules.mockResolvedValue(undefined);
  mockTransaction.mockImplementation(async (fn) => fn({} as never));
  mockCurrentStructureJson(DEFAULT_STRUCTURE_JSON);
});

describe("publishSnapshot", () => {
  it("質問タイトルが p ノードの非空テキストでもスナップショット保存できる", async () => {
    makeSnapshotPublishTransaction(
      JSON.stringify([
        {
          type: "form_short_text",
          blockId: "question-1",
          children: [{ type: "p", children: [{ text: "氏名" }] }],
        },
      ]),
    );

    await expect(publishSnapshot("form-1", "user-1")).resolves.toEqual({
      version: 1,
      publishedAt: new Date("2025-01-01"),
    });
    expect(mockSerializeRules).toHaveBeenCalledWith("form-1");
  });

  it("質問タイトルが空の質問を含む場合はスナップショット保存を拒否する", async () => {
    makeSnapshotPublishTransaction(
      JSON.stringify([
        {
          type: "form_short_text",
          blockId: "question-1",
          children: [{ type: "p", children: [{ text: "   " }] }],
        },
      ]),
    );

    const result = publishSnapshot("form-1", "user-1");

    await expect(result).rejects.toThrow(FormValidationError);
    await expect(result).rejects.toThrow(
      "質問タイトルは1文字以上入力してください",
    );
    expect(mockSerializeRules).not.toHaveBeenCalled();
  });

  it("section_separator は質問タイトルが空でもスナップショット保存できる", async () => {
    makeSnapshotPublishTransaction(
      JSON.stringify([
        {
          type: "form_section_separator",
          blockId: "section-1",
          children: [{ type: "p", children: [{ text: "   " }] }],
        },
      ]),
    );

    await expect(publishSnapshot("form-1", "user-1")).resolves.toEqual({
      version: 1,
      publishedAt: new Date("2025-01-01"),
    });
    expect(mockSerializeRules).toHaveBeenCalledWith("form-1");
  });

  it("completion target が存在しない場合はスナップショット保存を拒否する", async () => {
    makeSnapshotPublishTransaction(
      JSON.stringify([
        sectionNode("section-form", "入力"),
        questionNode("question-1", "氏名"),
        sectionNode("section-complete", "完了", {
          default_action: { type: "submit", target_id: "missing-section" },
        }),
        paragraph("送信ありがとうございました。"),
      ]),
    );

    const result = publishSnapshot("form-1", "user-1");

    await expect(result).rejects.toThrow(FormValidationError);
    await expect(result).rejects.toMatchObject({
      message: "送信後画面の遷移先を確認してください",
      details: { blockIds: ["missing-section"] },
    });
    expect(mockSerializeRules).not.toHaveBeenCalled();
  });

  it("completion target に回答可能な質問がある場合はスナップショット保存を拒否する", async () => {
    makeSnapshotPublishTransaction(
      JSON.stringify([
        sectionNode("section-form", "入力"),
        questionNode("question-1", "氏名"),
        sectionNode("section-complete", "完了", {
          default_action: { type: "submit", target_id: "section-complete" },
        }),
        questionNode("question-2", "完了画面に混ざった質問"),
      ]),
    );

    const result = publishSnapshot("form-1", "user-1");

    await expect(result).rejects.toThrow(FormValidationError);
    await expect(result).rejects.toMatchObject({
      message: "送信後画面の遷移先を確認してください",
      details: { blockIds: ["question-2"] },
    });
    expect(mockSerializeRules).not.toHaveBeenCalled();
  });

  it("編集中の Plate content 構造バリデーションでは空の質問タイトルを許容する", async () => {
    const { validatePlateContent } = await import("@nexus-form/shared");

    const content = [
      {
        type: "form_short_text",
        blockId: "question-1",
        children: [{ type: "h2", children: [{ text: "" }] }],
      },
    ];

    expect(validatePlateContent(content)).toBe(true);
  });
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

  it("formStructure のみが変更されている場合は hasChanges:true を返す", async () => {
    const plateContent = '[{"id":"node-1","type":"short_text"}]';
    const snapshot = makeSnapshot({ plateContent });
    mockFormFind.mockResolvedValue(
      formData({ plateContent, updatedAt: new Date(), baseSnapshotVersion: 1 }),
    );
    mockSnapshotFind.mockResolvedValue(snap(snapshot));
    mockCurrentStructureJson(
      JSON.stringify({
        version: 2,
        settings: { allow_edit_responses: false, require_fingerprint: true },
      }),
    );

    const result = await checkUnpublishedChanges("form-1");

    expect(result.hasChanges).toBe(true);
    expect(result.hasValidationRuleChanges).toBe(false);
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

  it("formStructure が変更されている場合に hasUnpublishedChanges:true を返す", async () => {
    const plateContent = makePlateNodes([{ id: "a", type: "short_text" }]);
    const snapshot = makeSnapshot({ plateContent, validationRulesJson: "[]" });
    mockFormFind.mockResolvedValue(
      formData({ plateContent, baseSnapshotVersion: 1 }),
    );
    mockSnapshotFind
      .mockResolvedValueOnce(snap(snapshot))
      .mockResolvedValueOnce(snap(snapshot));
    mockCurrentStructureJson(
      JSON.stringify({
        version: 2,
        settings: { allow_edit_responses: true },
      }),
    );

    const result = await calculateFormDiff("form-1");

    expect(result.hasUnpublishedChanges).toBe(true);
    expect(result.hasChangesFromActive).toBe(true);
    expect(result.totalChanges).toBe(0);
  });
});

describe("activateSnapshot", () => {
  it("古い snapshot を activate すると snapshot の structureJson を active formStructure として復元する", async () => {
    const snapshotStructureJson = JSON.stringify({
      version: 3,
      settings: {
        allow_edit_responses: true,
        require_fingerprint: true,
      },
    });
    const snapshot = makeSnapshot({
      id: "snapshot-old",
      version: 3,
      structureJson: snapshotStructureJson,
    });
    mockSnapshotFind
      .mockResolvedValueOnce(snap(snapshot))
      .mockResolvedValueOnce(snap(snapshot));

    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn().mockResolvedValue([{ id: "form-1" }]),
            orderBy: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([{ version: 8 }]),
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn().mockResolvedValue(undefined),
      })),
    };
    mockTransaction.mockImplementationOnce(async (fn) => fn(tx as never));

    const updated = await activateSnapshot("form-1", 3);

    expect(updated.version).toBe(3);
    expect(tx.insert).toHaveBeenCalled();
    const insertCall = tx.insert.mock.results[0]?.value as {
      values: ReturnType<typeof vi.fn>;
    };
    expect(insertCall.values).toHaveBeenCalledWith(
      expect.objectContaining({
        formId: "form-1",
        structureJson: snapshotStructureJson,
        version: 9,
        isActive: true,
        changeLog: "Activate snapshot v3",
      }),
    );
    expect(mockReplaceRules).toHaveBeenCalledWith({
      formId: "form-1",
      rules: [],
      tx,
    });
  });
});
