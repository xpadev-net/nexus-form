import { describe, expect, it } from "vitest";
import {
  extractQuestionsFromPlateContent,
  extractTitleFromChildren,
  removeNestedQuestionsFromPlateContent,
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
