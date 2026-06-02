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
  it("treats a required date with an ISO value as answered", () => {
    const question = makeQuestion("date", {
      required: true,
      minDate: "2026-01-01",
      maxDate: "2026-12-31",
    });

    const unanswered = findUnansweredRequired(
      [question],
      new Map([["q1", { value: "2026-06-15" }]]),
    );

    expect(unanswered).toEqual([]);
  });

  it("treats an empty required date as unanswered", () => {
    const question = makeQuestion("date", { required: true });

    const unanswered = findUnansweredRequired(
      [question],
      new Map([["q1", { value: "" }]]),
    );

    expect(unanswered).toEqual([question]);
  });

  it("treats a required date outside the configured range as unanswered", () => {
    const question = makeQuestion("date", {
      required: true,
      minDate: "2026-01-01",
      maxDate: "2026-12-31",
    });

    const unanswered = findUnansweredRequired(
      [question],
      new Map([["q1", { value: "2027-01-01" }]]),
    );

    expect(unanswered).toEqual([question]);
  });

  it("treats an impossible required date as unanswered", () => {
    const question = makeQuestion("date", { required: true });

    const unanswered = findUnansweredRequired(
      [question],
      new Map([["q1", { value: "2026-02-31" }]]),
    );

    expect(unanswered).toEqual([question]);
  });

  it("treats a date with surrounding whitespace as unanswered", () => {
    const question = makeQuestion("date", { required: true });

    const unanswered = findUnansweredRequired(
      [question],
      new Map([["q1", { value: " 2026-06-15 " }]]),
    );

    expect(unanswered).toEqual([question]);
  });

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
