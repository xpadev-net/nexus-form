import type { ShortTextFormBlock } from "@nexus-form/shared/forms/form-block";
import { describe, expect, it } from "vitest";
import {
  canAutoMerge,
  detectConflicts,
  mergeArrayById,
  mergeBlock,
  mergeObject,
  mergePrimitive,
  sortConflictsBySeverity,
} from "../merge";

function shortTextBlock(
  overrides: Partial<ShortTextFormBlock> = {},
): ShortTextFormBlock {
  return {
    id: "row-1",
    formId: "form-1",
    blockId: "block-1",
    type: "short_text",
    category: "question",
    title: "Question",
    description: "Description",
    order: 0,
    version: 1,
    isDeleted: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdBy: "user-1",
    updatedBy: "user-1",
    validation: {
      type: "short_text",
      required: false,
      allowPatternMismatch: false,
    },
    ...overrides,
  };
}

describe("mergePrimitive", () => {
  it("takes the remote value when only remote changed", () => {
    expect(mergePrimitive("base", "base", "remote", "title")).toBe("remote");
  });

  it("takes the local value when only local changed", () => {
    expect(mergePrimitive("base", "local", "base", "title")).toBe("local");
  });

  it("returns a conflict when both sides changed differently", () => {
    expect(mergePrimitive("base", "local", "remote", "title")).toEqual({
      type: "conflict",
      conflicts: [
        {
          path: "title",
          base: "base",
          local: "local",
          remote: "remote",
        },
      ],
    });
  });
});

describe("mergeArrayById", () => {
  it("combines independent additions from local and remote", () => {
    const result = mergeArrayById(
      [{ id: "base", label: "Base" }],
      [
        { id: "base", label: "Base" },
        { id: "local", label: "Local" },
      ],
      [
        { id: "base", label: "Base" },
        { id: "remote", label: "Remote" },
      ],
      "options",
    );

    expect(result).toEqual(
      expect.arrayContaining([
        { id: "base", label: "Base" },
        { id: "remote", label: "Remote" },
        { id: "local", label: "Local" },
      ]),
    );
    expect(result).toHaveLength(3);
  });

  it("reports a conflict when both sides edit the same item differently", () => {
    const result = mergeArrayById(
      [{ id: "option-1", label: "Base" }],
      [{ id: "option-1", label: "Local" }],
      [{ id: "option-1", label: "Remote" }],
      "options",
    );

    expect(result).toMatchObject({
      type: "conflict",
      conflicts: [{ path: "options[option-1]" }],
    });
  });
});

describe("mergeObject", () => {
  it("merges non-overlapping object changes", () => {
    expect(
      mergeObject(
        { title: "Base", required: false },
        { title: "Local", required: false },
        { title: "Base", required: true },
      ),
    ).toEqual({ title: "Local", required: true });
  });

  it("detects conflicting nested keys", () => {
    expect(
      mergeObject(
        { validation: { required: false } },
        { validation: { required: true } },
        { validation: { required: false, minLength: 2 } },
      ),
    ).toMatchObject({
      type: "conflict",
      conflicts: [{ path: "validation" }],
    });
  });
});

describe("mergeBlock", () => {
  it("merges independent content and order changes into a new block version", () => {
    const base = shortTextBlock();
    const local = shortTextBlock({ title: "Local title" });
    const remote = shortTextBlock({ order: 2, version: 3 });

    const result = mergeBlock({ base, local, remote });

    expect(result.hasConflict).toBe(false);
    expect(result.merged).toMatchObject({
      title: "Local title",
      order: 2,
      version: 3,
    });
  });

  it("keeps local content and reports conflicts for overlapping edits", () => {
    const base = shortTextBlock();
    const local = shortTextBlock({ title: "Local title" });
    const remote = shortTextBlock({ title: "Remote title", version: 2 });

    const result = mergeBlock({ base, local, remote });

    expect(result.hasConflict).toBe(true);
    expect(result.merged.title).toBe("Local title");
    expect(result.merged.version).toBe(2);
    expect(result.conflicts).toEqual([
      {
        path: "content.title",
        base: "Question",
        local: "Local title",
        remote: "Remote title",
      },
    ]);
  });
});

describe("conflict helpers", () => {
  it("detects whether a block can be auto-merged", () => {
    const base = shortTextBlock();

    expect(
      canAutoMerge({
        base,
        local: shortTextBlock({ title: "Local" }),
        remote: shortTextBlock({ description: "Remote" }),
      }),
    ).toBe(true);
  });

  it("detects conflicts for overlapping block changes", () => {
    const base = shortTextBlock();

    expect(
      detectConflicts({
        base,
        local: shortTextBlock({ title: "Local" }),
        remote: shortTextBlock({ title: "Remote" }),
      }),
    ).toHaveLength(1);
  });

  it("sorts conflicts by user-visible severity", () => {
    const sorted = sortConflictsBySeverity([
      { path: "content.description", base: "", local: "a", remote: "b" },
      { path: "content.title", base: "", local: "a", remote: "b" },
      {
        path: "content.validation.required",
        base: false,
        local: true,
        remote: false,
      },
    ]);

    expect(sorted.map((conflict) => conflict.path)).toEqual([
      "content.title",
      "content.validation.required",
      "content.description",
    ]);
  });
});
