import { describe, expect, it } from "vitest";
import { createBlock, duplicateBlock } from "../block-factory";

describe("duplicateBlock", () => {
  it("keeps copied titles within the Block schema limit", () => {
    const block = createBlock(
      "short_text",
      "form-1",
      "user-1",
      0,
      "あ".repeat(200),
    );

    const duplicated = duplicateBlock(block, "form-1", "user-1", 1);

    expect(duplicated.title).toHaveLength(200);
    expect(duplicated.title.endsWith(" (コピー)")).toBe(true);
  });
});
