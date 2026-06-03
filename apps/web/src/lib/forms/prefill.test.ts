import { BLOCK_TYPES } from "@nexus-form/shared";
import { describe, expect, it } from "vitest";
import {
  PREFILL_SUPPORTED_QUESTION_TYPES,
  PREFILL_UNSUPPORTED_QUESTION_TYPES,
} from "./prefill";

describe("prefill question type coverage", () => {
  it("classifies every answerable question type as supported or unsupported", () => {
    const answerableQuestionTypes = BLOCK_TYPES.filter(
      (type) => type !== "section_separator",
    );
    const classifiedQuestionTypes = [
      ...PREFILL_SUPPORTED_QUESTION_TYPES,
      ...PREFILL_UNSUPPORTED_QUESTION_TYPES,
    ];

    expect([...classifiedQuestionTypes].sort()).toEqual(
      [...answerableQuestionTypes].sort(),
    );
  });
});
