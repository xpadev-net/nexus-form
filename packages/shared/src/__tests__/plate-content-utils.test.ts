import { describe, expect, it } from "vitest";
import {
  extractAnswerableQuestionsFromPlateContent,
  extractQuestionsFromPlateContent,
  extractTitleFromChildren,
  getCompletionTargetReferences,
  removeNestedQuestionsFromPlateContent,
  splitPlateContentIntoPages,
  validateCompletionTargetPages,
  validateCompletionTargetsInPlateContent,
  validatePlateContent,
} from "../plate-content-utils";

function wrapNode(node: Record<string, unknown>, wrapperCount: number) {
  let current = node;

  for (let index = 0; index < wrapperCount; index += 1) {
    current = {
      type: "container",
      children: [current],
    };
  }

  return current;
}

function paragraph(text: string) {
  return { type: "p", children: [{ text }] };
}

function questionNode(type: string, blockId: string, title: string) {
  return {
    type: `form_${type}`,
    blockId,
    validation: { type },
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

describe("extractTitleFromChildren", () => {
  it("uses heading text before paragraph fallback", () => {
    expect(
      extractTitleFromChildren([
        { type: "p", children: [{ text: "Description" }] },
        { type: "h2", children: [{ text: "Question title" }] },
      ]),
    ).toBe("Question title");
  });

  it("falls back to paragraph text when no heading exists", () => {
    expect(
      extractTitleFromChildren([
        { type: "p", children: [{ text: "Paragraph title" }] },
      ]),
    ).toBe("Paragraph title");
  });
});

describe("extractQuestionsFromPlateContent", () => {
  it("extracts paragraph-only question titles", () => {
    const questions = extractQuestionsFromPlateContent([
      {
        type: "form_short_text",
        blockId: "question-1",
        children: [{ type: "p", children: [{ text: "氏名" }] }],
      },
    ]);

    expect(questions[0]?.title).toBe("氏名");
  });

  it("stops walking unsupported depth without extracting hidden questions", () => {
    const questions = extractQuestionsFromPlateContent([
      wrapNode(
        {
          type: "form_short_text",
          blockId: "question-1",
          children: [{ type: "p", children: [{ text: "氏名" }] }],
        },
        101,
      ),
    ]);

    expect(questions).toEqual([]);
  });
});

describe("extractAnswerableQuestionsFromPlateContent", () => {
  it("excludes section separators from answerable question extraction", () => {
    const questions = extractAnswerableQuestionsFromPlateContent([
      questionNode("short_text", "question-1", "氏名"),
      sectionNode("section-1", "完了画面"),
    ]);

    expect(questions).toEqual([
      expect.objectContaining({ blockId: "question-1", type: "short_text" }),
    ]);
  });
});

describe("completion target validation", () => {
  it("allows submit actions without target_id for legacy confirmation screens", () => {
    const pages = splitPlateContentIntoPages([
      questionNode("short_text", "question-1", "氏名"),
      sectionNode("section-complete", "完了", {
        default_action: { type: "submit" },
      }),
      paragraph("Thanks"),
    ]);

    expect(getCompletionTargetReferences(pages)).toEqual([]);
    expect(validateCompletionTargetPages(pages)).toEqual([]);
  });

  it("allows submit target pages that contain no answerable questions", () => {
    const issues = validateCompletionTargetsInPlateContent([
      sectionNode("section-form", "入力"),
      questionNode("short_text", "question-1", "氏名"),
      sectionNode("section-complete", "完了", {
        default_action: { type: "submit", target_id: "section-complete" },
      }),
      paragraph("送信ありがとうございました。"),
    ]);

    expect(issues).toEqual([]);
  });

  it("reports submit target pages that still contain answerable questions", () => {
    const issues = validateCompletionTargetsInPlateContent([
      sectionNode("section-form", "入力"),
      questionNode("short_text", "question-1", "氏名"),
      sectionNode("section-complete", "完了", {
        default_action: { type: "submit", target_id: "section-complete" },
      }),
      questionNode("radio", "question-after-submit", "満足度"),
    ]);

    expect(issues).toEqual([
      {
        code: "completion_target_has_answerable_questions",
        sourcePageId: "section-form",
        actionSource: "default_action",
        targetPageId: "section-complete",
        answerableQuestionIds: ["question-after-submit"],
      },
    ]);
  });

  it("reports submit targets that reference missing pages", () => {
    const issues = validateCompletionTargetsInPlateContent([
      sectionNode("section-form", "入力"),
      questionNode("short_text", "question-1", "氏名"),
      sectionNode("section-next", "次", {
        default_action: { type: "submit", target_id: "missing-section" },
      }),
    ]);

    expect(issues).toEqual([
      {
        code: "completion_target_not_found",
        sourcePageId: "section-form",
        actionSource: "default_action",
        targetPageId: "missing-section",
      },
    ]);
  });

  it("reports navigation rule submit targets with rule context", () => {
    const issues = validateCompletionTargetsInPlateContent([
      sectionNode("section-form", "入力"),
      questionNode("short_text", "question-1", "区分"),
      sectionNode("section-complete", "完了", {
        navigation_rules: [
          {
            id: "rule-submit-vip",
            name: "VIP 完了",
            conditions: [
              {
                question_id: "question-1",
                operator: "equals",
                value: "vip",
              },
            ],
            condition_match: "all",
            action: { type: "submit", target_id: "section-complete" },
          },
        ],
      }),
      questionNode("long_text", "question-after-submit", "追加入力"),
    ]);

    expect(issues).toEqual([
      {
        code: "completion_target_has_answerable_questions",
        sourcePageId: "section-form",
        actionSource: "navigation_rule",
        ruleId: "rule-submit-vip",
        ruleName: "VIP 完了",
        targetPageId: "section-complete",
        answerableQuestionIds: ["question-after-submit"],
      },
    ]);
  });

  it("ignores malformed navigation rules instead of throwing", () => {
    const issues = validateCompletionTargetsInPlateContent([
      sectionNode("section-form", "入力"),
      questionNode("short_text", "question-1", "氏名"),
      sectionNode("section-complete", "完了", {
        navigation_rules: [
          {},
          { action: null },
          { action: { type: "submit" } },
          { action: { type: "submit", target_id: 42 } },
        ],
      }),
      paragraph("送信ありがとうございました。"),
    ]);

    expect(issues).toEqual([]);
  });
});

describe("validatePlateContent", () => {
  it("rejects a form question nested inside another form question", () => {
    expect(
      validatePlateContent([
        {
          type: "form_short_text",
          blockId: "question-1",
          children: [
            { type: "p", children: [{ text: "説明文" }] },
            {
              type: "form_long_text",
              blockId: "question-2",
              children: [{ type: "p", children: [{ text: "混入質問" }] }],
            },
          ],
        },
      ]),
    ).toBe(false);
  });

  it("rejects a form question nested through a non-question container inside another form question", () => {
    expect(
      validatePlateContent([
        {
          type: "form_short_text",
          blockId: "question-1",
          children: [
            {
              type: "column",
              children: [
                {
                  type: "form_long_text",
                  blockId: "question-2",
                  children: [{ type: "p", children: [{ text: "混入質問" }] }],
                },
              ],
            },
          ],
        },
      ]),
    ).toBe(false);
  });

  it("allows form questions inside non-question container nodes", () => {
    expect(
      validatePlateContent([
        {
          type: "column_group",
          children: [
            {
              type: "column",
              children: [
                {
                  type: "form_short_text",
                  blockId: "question-1",
                  children: [{ type: "p", children: [{ text: "氏名" }] }],
                },
              ],
            },
          ],
        },
      ]),
    ).toBe(true);
  });

  it("rejects a nested form question hidden past the max validation depth", () => {
    expect(
      validatePlateContent([
        {
          type: "form_short_text",
          blockId: "question-1",
          children: [
            wrapNode(
              {
                type: "form_long_text",
                blockId: "question-2",
                children: [{ type: "p", children: [{ text: "混入質問" }] }],
              },
              101,
            ),
          ],
        },
      ]),
    ).toBe(false);
  });

  it("allows content up to the supported validation depth", () => {
    expect(
      validatePlateContent([
        wrapNode(
          {
            type: "form_short_text",
            blockId: "question-1",
            children: [{ type: "p", children: [{ text: "氏名" }] }],
          },
          98,
        ),
      ]),
    ).toBe(true);
  });

  it("keeps existing malformed child handling inside valid top-level nodes", () => {
    expect(
      validatePlateContent([
        {
          type: "p",
          children: [
            "plain text child",
            null,
            { type: "span-without-children" },
          ],
        },
      ]),
    ).toBe(true);
  });
});

describe("removeNestedQuestionsFromPlateContent", () => {
  it("unwraps a question inserted into another question description", () => {
    const sanitized = removeNestedQuestionsFromPlateContent([
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text" },
        children: [
          { type: "p", children: [{ text: "説明文" }] },
          {
            type: "form_long_text",
            blockId: "question-2",
            validation: { type: "long_text" },
            children: [{ type: "p", children: [{ text: "混入質問" }] }],
          },
        ],
      },
    ]);

    expect(sanitized).toEqual([
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text" },
        children: [
          { type: "p", children: [{ text: "説明文" }] },
          { type: "p", children: [{ text: "混入質問" }] },
        ],
      },
    ]);
    expect(validatePlateContent(sanitized)).toBe(true);
    expect(extractQuestionsFromPlateContent(sanitized)).toHaveLength(1);
  });

  it("keeps form questions inside non-question containers", () => {
    const sanitized = removeNestedQuestionsFromPlateContent([
      {
        type: "column_group",
        children: [
          {
            type: "column",
            children: [
              {
                type: "form_short_text",
                blockId: "question-1",
                children: [{ type: "p", children: [{ text: "氏名" }] }],
              },
            ],
          },
        ],
      },
    ]);

    expect(sanitized).toEqual([
      {
        type: "column_group",
        children: [
          {
            type: "column",
            children: [
              {
                type: "form_short_text",
                blockId: "question-1",
                children: [{ type: "p", children: [{ text: "氏名" }] }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("unwraps a question nested through containers inside another question", () => {
    const sanitized = removeNestedQuestionsFromPlateContent([
      {
        type: "form_short_text",
        blockId: "question-1",
        children: [
          {
            type: "column_group",
            children: [
              {
                type: "column",
                children: [
                  {
                    type: "form_long_text",
                    blockId: "question-2",
                    validation: { type: "long_text" },
                    children: [{ type: "p", children: [{ text: "混入質問" }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    expect(sanitized).toEqual([
      {
        type: "form_short_text",
        blockId: "question-1",
        children: [
          {
            type: "column_group",
            children: [
              {
                type: "column",
                children: [{ type: "p", children: [{ text: "混入質問" }] }],
              },
            ],
          },
        ],
      },
    ]);
    expect(validatePlateContent(sanitized)).toBe(true);
    expect(extractQuestionsFromPlateContent(sanitized)).toHaveLength(1);
  });
});
