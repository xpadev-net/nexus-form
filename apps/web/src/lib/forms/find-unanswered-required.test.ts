import type { ExtractedQuestion } from "@nexus-form/shared";
import { describe, expect, it } from "vitest";
import { findUnansweredRequired } from "./find-unanswered-required";

function makeQuestion(
  type: string,
  validation: ExtractedQuestion["validation"],
): ExtractedQuestion {
  return {
    blockId: "q1",
    type,
    title: "Question",
    validation,
  };
}

describe("findUnansweredRequired", () => {
  it("treats missing choice grid rows as unanswered", () => {
    const question = makeQuestion("choice_grid", {
      required: true,
      rows: [
        { id: "r1", label: "Row 1" },
        { id: "r2", label: "Row 2" },
      ],
    });

    const unanswered = findUnansweredRequired(
      [question],
      new Map([["q1", { responses: { r1: "c1" } }]]),
    );

    expect(unanswered).toEqual([question]);
  });

  it("treats missing checkbox grid rows as unanswered", () => {
    const question = makeQuestion("checkbox_grid", {
      required: true,
      rows: [
        { id: "r1", label: "Row 1" },
        { id: "r2", label: "Row 2" },
      ],
    });

    const unanswered = findUnansweredRequired(
      [question],
      new Map([["q1", { responses: { r1: ["c1"], r2: [] } }]]),
    );

    expect(unanswered).toEqual([question]);
  });
});
