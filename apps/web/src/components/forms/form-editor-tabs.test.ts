import {
  EDIT_ONLY_TAB_KEYS,
  EDITOR_TABS,
  getEditorTabFromSearch,
  isEditOnlyEditorTab,
  isEditorTab,
} from "./form-editor-tabs";

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

  it("identifies only edit-only tab values", () => {
    for (const tab of EDIT_ONLY_TAB_KEYS) {
      expect(isEditOnlyEditorTab(tab)).toBe(true);
    }
    for (const tab of EDITOR_TABS.filter(
      (tab) => !EDIT_ONLY_TAB_KEYS.some((editOnlyTab) => editOnlyTab === tab),
    )) {
      expect(isEditOnlyEditorTab(tab)).toBe(false);
    }
    expect(isEditOnlyEditorTab("public")).toBe(false);
    expect(isEditOnlyEditorTab(null)).toBe(false);
    expect(isEditOnlyEditorTab(undefined)).toBe(false);
  });
});
