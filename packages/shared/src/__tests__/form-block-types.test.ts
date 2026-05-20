import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  BlockType,
  FORM_QUESTION_TYPES,
  fromPlateQuestionType,
  isBlockType,
  isPlateQuestionType,
  toPlateQuestionType,
} from "../forms/form-block";
import { ANSWERABLE_QUESTION_TYPES } from "../response-data";

describe("form block type constants", () => {
  it("derives Plate question types from the canonical block type list", () => {
    expect(FORM_QUESTION_TYPES).toEqual(
      BLOCK_TYPES.map((type) => `form_${type}`),
    );
  });

  it("keeps the Zod enum in sync with the canonical block type list", () => {
    expect(BlockType.options).toEqual(BLOCK_TYPES);
  });

  it("converts between block types and Plate question types", () => {
    for (const blockType of BLOCK_TYPES) {
      const plateType = toPlateQuestionType(blockType);

      expect(isBlockType(blockType)).toBe(true);
      expect(isPlateQuestionType(plateType)).toBe(true);
      expect(fromPlateQuestionType(plateType)).toBe(blockType);
    }
  });

  it("derives answerable question types from block types", () => {
    expect(ANSWERABLE_QUESTION_TYPES).toEqual(
      BLOCK_TYPES.filter((type) => type !== "section_separator"),
    );
  });
});
