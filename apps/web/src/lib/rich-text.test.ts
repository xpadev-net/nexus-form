import { describe, expect, it } from "vitest";
import { sanitizeFormPlateContent } from "./rich-text";

describe("sanitizeFormPlateContent", () => {
  it("removes slash menu residue and empty text blocks", () => {
    const sanitized = sanitizeFormPlateContent([
      { type: "p", children: [{ text: "/" }] },
      { type: "p", children: [{ text: "" }] },
      {
        type: "p",
        children: [{ type: "a", url: "/", children: [{ text: "/" }] }],
      },
      {
        type: "p",
        children: [{ type: "slash_input", children: [{ text: "" }] }],
      },
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text", required: false },
        children: [{ type: "p", children: [{ text: "氏名" }] }],
      },
    ]);

    expect(sanitized).toEqual([
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text", required: false },
        children: [{ type: "p", children: [{ text: "氏名" }] }],
      },
    ]);
  });

  it("preserves authored text and question titles that contain slash", () => {
    const sanitized = sanitizeFormPlateContent([
      { type: "p", children: [{ text: "Use /help for commands" }] },
      {
        type: "p",
        children: [
          { text: "Path " },
          { text: "/", bold: true },
          { text: " segment" },
        ],
      },
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text", required: false },
        children: [{ type: "p", children: [{ text: "/" }] }],
      },
    ]);

    expect(sanitized).toEqual([
      { type: "p", children: [{ text: "Use /help for commands" }] },
      {
        type: "p",
        children: [
          { text: "Path " },
          { text: "/", bold: true },
          { text: " segment" },
        ],
      },
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text", required: false },
        children: [{ type: "p", children: [{ text: "/" }] }],
      },
    ]);
  });

  it("unwraps nested questions while preserving visible description text", () => {
    const sanitized = sanitizeFormPlateContent([
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text", required: false },
        children: [
          { type: "p", children: [{ text: "説明文" }] },
          {
            type: "form_long_text",
            blockId: "question-2",
            validation: { type: "long_text", required: false },
            children: [{ type: "p", children: [{ text: "混入質問" }] }],
          },
        ],
      },
    ]);

    expect(sanitized).toEqual([
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text", required: false },
        children: [
          { type: "p", children: [{ text: "説明文" }] },
          { type: "p", children: [{ text: "混入質問" }] },
        ],
      },
    ]);
  });
});
