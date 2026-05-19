export const EDITOR_TABS = [
  "editor",
  "settings",
  "validation",
  "sharing",
  "responses",
] as const;

export type EditorTab = (typeof EDITOR_TABS)[number];

const EDITOR_TAB_VALUES: ReadonlySet<string> = new Set(EDITOR_TABS);

export function isEditorTab(value: unknown): value is EditorTab {
  return typeof value === "string" && EDITOR_TAB_VALUES.has(value);
}

export function getEditorTabFromSearch(tab: string | undefined): EditorTab {
  return isEditorTab(tab) ? tab : "editor";
}
