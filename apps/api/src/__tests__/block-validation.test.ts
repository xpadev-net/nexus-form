import { describe, expect, it } from "vitest";
import {
  hasInvalidPatternMismatchMode,
  validateBlocks,
} from "../lib/forms/block-validation";
import type { Block } from "../types/domain/form-block";

const baseBlock = {
  id: "id-1",
  formId: "form-1",
  blockId: "block-1",
  category: "question" as const,
  order: 0,
  version: 1,
  isDeleted: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: "user-1",
  updatedBy: "user-1",
};

function makeShortTextBlock(patternMismatchMode: unknown): Block {
  return {
    ...baseBlock,
    type: "short_text",
    title: "質問タイトル",
    validation: {
      type: "short_text",
      required: false,
      pattern: "^NF-\\d{4}$",
      patternMismatchMode,
    },
  } as Block;
}

function makeRadioBlock(otherPatternMismatchMode: unknown): Block {
  return {
    ...baseBlock,
    type: "radio",
    title: "質問タイトル",
    validation: {
      type: "radio",
      required: false,
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      allowOther: true,
      otherTextValidation: {
        pattern: "^NF-\\d{4}$",
        patternMismatchMode: otherPatternMismatchMode,
      },
    },
  } as Block;
}

describe("pattern mismatch mode validation", () => {
  it.each([
    "block",
    "warn",
    "hidden",
  ] as const)("accepts %s mode on short text and other text validation", (patternMismatchMode) => {
    expect(
      hasInvalidPatternMismatchMode(makeShortTextBlock(patternMismatchMode)),
    ).toBe(false);
    expect(
      hasInvalidPatternMismatchMode(makeRadioBlock(patternMismatchMode)),
    ).toBe(false);
  });

  it("rejects invalid short text pattern mismatch mode", () => {
    const result = validateBlocks([makeShortTextBlock("permit")]);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "入力パターンの不一致時の動作が不正なブロックがあります。",
    );
  });

  it("rejects invalid other text pattern mismatch mode", () => {
    const result = validateBlocks([makeRadioBlock("permit")]);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain(
      "入力パターンの不一致時の動作が不正なブロックがあります。",
    );
  });
});
