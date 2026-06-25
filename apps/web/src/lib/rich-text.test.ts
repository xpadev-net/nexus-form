import { describe, expect, it } from "vitest";
import {
  cleanupFormPlateContentForDisplay,
  sanitizeFormPlateContent,
  sanitizeFormPlateContentForSave,
} from "./rich-text";

describe("sanitizeFormPlateContent", () => {
  it("removes slash menu residue and empty text blocks for display cleanup", () => {
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

describe("cleanupFormPlateContentForDisplay", () => {
  it("removes empty text residue for display-only cleanup", () => {
    const sanitized = cleanupFormPlateContentForDisplay([
      { type: "p", children: [{ text: "" }] },
      { type: "p", children: [{ text: "Visible text" }] },
    ]);

    expect(sanitized).toEqual([
      { type: "p", children: [{ text: "Visible text" }] },
    ]);
  });
});

describe("sanitizeFormPlateContentForSave", () => {
  it("preserves authored empty and slash-only text blocks", () => {
    const sanitized = sanitizeFormPlateContentForSave([
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
      { type: "p", children: [{ text: "/" }] },
      { type: "p", children: [{ text: "" }] },
      {
        type: "p",
        children: [{ type: "a", url: "/", children: [{ text: "/" }] }],
      },
      { type: "p", children: [{ text: "/" }] },
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text", required: false },
        children: [{ type: "p", children: [{ text: "氏名" }] }],
      },
    ]);
  });

  it("unwraps nested questions while preserving visible description text", () => {
    const sanitized = sanitizeFormPlateContentForSave([
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

  it("wraps slash input as a paragraph when it is directly inside a question", () => {
    const sanitized = sanitizeFormPlateContentForSave([
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text", required: false },
        children: [{ type: "slash_input", children: [{ text: "" }] }],
      },
    ]);

    expect(sanitized).toEqual([
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text", required: false },
        children: [{ type: "p", children: [{ text: "/" }] }],
      },
    ]);
  });
});
