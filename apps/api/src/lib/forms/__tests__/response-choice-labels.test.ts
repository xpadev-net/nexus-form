import type { ValidatorQuestion } from "@nexus-form/shared";
import { describe, expect, it } from "vitest";
import {
  addDisplayLabelsToResponseDataJson,
  buildResponseLabelLookupFromQuestions,
} from "../response-choice-labels";

describe("response choice display labels", () => {
  it("adds display labels while preserving stored internal IDs", () => {
    const questions: ValidatorQuestion[] = [
      {
        id: "company-type",
        type: "radio",
        validation: {
          options: [
            { id: "corp", label: "法人" },
            { id: "blank", label: "" },
          ],
        },
      },
      {
        id: "company-grid",
        type: "choice_grid",
        validation: {
          rows: [{ id: "contract", label: "契約種別" }],
          columns: [{ id: "corp", label: "法人" }],
        },
      },
    ];

    const responseDataJson = JSON.stringify([
      {
        question_id: "company-type",
        question_type: "radio",
        value: "corp",
      },
      {
        question_id: "company-type",
        question_type: "radio",
        value: "blank",
      },
      {
        question_id: "unknown-choice",
        question_type: "radio",
        value: "legacy-id",
      },
      {
        question_id: "company-grid",
        question_type: "choice_grid",
        responses: { contract: "corp" },
      },
    ]);

    const enriched = addDisplayLabelsToResponseDataJson(
      responseDataJson,
      buildResponseLabelLookupFromQuestions(questions),
    );

    expect(JSON.parse(enriched ?? "[]")).toEqual([
      {
        question_id: "company-type",
        question_type: "radio",
        value: "corp",
        display_value: "法人",
      },
      {
        question_id: "company-type",
        question_type: "radio",
        value: "blank",
        display_value: "（空の選択肢）",
      },
      {
        question_id: "unknown-choice",
        question_type: "radio",
        value: "legacy-id",
      },
      {
        question_id: "company-grid",
        question_type: "choice_grid",
        responses: { contract: "corp" },
        display_value: "契約種別: 法人",
      },
    ]);
  });
});
