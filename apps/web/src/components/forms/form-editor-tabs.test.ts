import { getEditorTabFromSearch, isEditorTab } from "./form-editor-tabs";

describe("form editor tabs", () => {
  it("accepts supported tab search params", () => {
    expect(getEditorTabFromSearch("responses")).toBe("responses");
    expect(getEditorTabFromSearch("validation")).toBe("validation");
  });

  it("falls back to editor for missing or unsupported tab search params", () => {
    expect(getEditorTabFromSearch(undefined)).toBe("editor");
    expect(getEditorTabFromSearch("unknown")).toBe("editor");
  });

  it("narrows only supported editor tab values", () => {
    expect(isEditorTab("sharing")).toBe(true);
    expect(isEditorTab("public")).toBe(false);
    expect(isEditorTab(null)).toBe(false);
  });
});
