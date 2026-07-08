import {
  BLOCK_TYPES,
  extractQuestionsFromPlateContent,
  splitPlateContentIntoPages,
} from "@nexus-form/shared";
import { describe, expect, it } from "vitest";
import type { PrefillData } from "./prefill";
import {
  filterPrefillDataForReachableQuestions,
  getReachableQuestionIdsFromPrefillValues,
  PREFILL_SUPPORTED_QUESTION_TYPES,
  PREFILL_UNSUPPORTED_QUESTION_TYPES,
} from "./prefill";

function questionNode(
  type: string,
  blockId: string,
  title: string,
  validation?: Record<string, unknown>,
) {
  return {
    type: `form_${type}`,
    blockId,
    ...(validation ? { validation } : {}),
    children: [{ type: "p", children: [{ text: title }] }],
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
    ...(validation ? { validation } : {}),
    children: [{ type: "p", children: [{ text: title }] }],
  };
}

function branchingPlateFixture() {
  return [
    questionNode("short_text", "question-branch", "種別", {
      type: "short_text",
    }),
    sectionNode("section-regular", "通常ルート", {
      type: "section_separator",
      navigation_rules: [
        {
          id: "to-vip",
          name: "VIP へ移動",
          conditions: [
            {
              question_id: "question-branch",
              operator: "equals",
              value: "vip",
            },
          ],
          condition_match: "all",
          action: { type: "jump_to_section", target_id: "section-vip" },
        },
      ],
      default_action: { type: "submit" },
    }),
    questionNode("short_text", "question-regular", "通常質問", {
      type: "short_text",
    }),
    sectionNode("section-vip", "VIP ルート", {
      type: "section_separator",
      default_action: { type: "submit" },
    }),
    questionNode("short_text", "question-vip", "VIP質問", {
      type: "short_text",
    }),
    questionNode("choice_grid", "question-grid", "参加枠", {
      type: "choice_grid",
      rows: [],
      columns: [],
    }),
  ];
}

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

  it("excludes unreachable values from reachable-supported prefill generation", () => {
    const plateContent = branchingPlateFixture();
    const questions = extractQuestionsFromPlateContent(plateContent);
    const pages = splitPlateContentIntoPages(plateContent);
    const prefillValues: PrefillData = {
      "question-branch": { value: "vip" },
      "question-regular": { value: "regular" },
      "question-vip": { value: "vip-user" },
      "question-grid": { values: ["A"] },
    };

    expect(
      filterPrefillDataForReachableQuestions(questions, pages, prefillValues),
    ).toEqual({
      "question-branch": { value: "vip" },
      "question-vip": { value: "vip-user" },
    });
  });

  it("computes reachable question ids from prefill values", () => {
    const pages = splitPlateContentIntoPages(branchingPlateFixture());

    expect(
      getReachableQuestionIdsFromPrefillValues(pages, {
        "question-branch": { value: "vip" },
      }),
    ).toEqual(["question-branch", "question-vip", "question-grid"]);

    expect(
      getReachableQuestionIdsFromPrefillValues(pages, {
        "question-branch": { value: "regular" },
      }),
    ).toEqual(["question-branch"]);
  });
});
