import { describe, expect, it } from "vitest";

import {
  buildResponseAnswerRecord,
  validateReachableResponseData,
} from "../lib/forms/response-validator";

function makeResponse(
  questionId: string,
  questionType: string,
  data: Record<string, unknown> = {},
) {
  return { question_id: questionId, question_type: questionType, ...data };
}

describe("public submit reachability validation helpers", () => {
  it("builds condition-evaluator response records without presentation fields", () => {
    expect(
      buildResponseAnswerRecord([
        makeResponse("q-text", "short_text", {
          question_title: "Secret title",
          value: "text answer",
        }),
        makeResponse("q-check", "checkbox", {
          value: "ignored",
          values: ["a", "b"],
          other_values: ["private"],
        }),
        makeResponse("q-grid", "choice_grid", {
          responses: { row1: "col1" },
        }),
      ]),
    ).toEqual({
      "q-text": "text answer",
      "q-check": ["a", "b"],
      "q-grid": { row1: "col1" },
    });
  });

  it("rejects responses outside the server-computed reachable set without logging values", () => {
    const result = validateReachableResponseData(
      [
        makeResponse("q-entry", "radio", { value: "individual" }),
        makeResponse("q-hidden", "short_text", { value: "sensitive" }),
      ],
      new Set(["q-entry"]),
    );

    expect(result).toEqual({
      isValid: false,
      errors: ["Response 2: Question q-hidden is not reachable"],
    });
    expect(result.errors.join(" ")).not.toContain("sensitive");
  });
});
