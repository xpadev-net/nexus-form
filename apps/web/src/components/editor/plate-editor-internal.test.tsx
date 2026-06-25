// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { PlateEditorInternal } from "./plate-editor-internal";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const plateChangeHandler = vi.hoisted(
  () =>
    ({
      current: undefined as ((event: { value: unknown[] }) => void) | undefined,
    }) satisfies {
      current: ((event: { value: unknown[] }) => void) | undefined;
    },
);

vi.mock("platejs/react", () => ({
  Plate: ({
    children,
    onChange,
  }: {
    children: ReactNode;
    onChange: (event: { value: unknown[] }) => void;
  }) => {
    plateChangeHandler.current = onChange;
    return <div data-testid="plate-root">{children}</div>;
  },
  usePlateEditor: () => ({
    tf: {
      setValue: vi.fn(),
    },
  }),
}));

vi.mock("@/components/editor/editor-kit", () => ({
  EditorKit: [],
}));

vi.mock("@/components/ui/editor", () => ({
  Editor: () => <div data-testid="editor" />,
  EditorContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="editor-container">{children}</div>
  ),
}));

describe("PlateEditorInternal", () => {
  it("serializes editor changes with the save sanitizer before autosave", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(<PlateEditorInternal value="[]" onChange={onChange} />);
    });

    act(() => {
      plateChangeHandler.current?.({
        value: [
          { type: "p", children: [{ text: "Before" }] },
          { type: "p", children: [{ text: "" }] },
          { type: "p", children: [{ text: "/" }] },
          {
            type: "p",
            children: [{ type: "a", url: "/", children: [{ text: "/" }] }],
          },
          {
            type: "p",
            children: [{ type: "slash_input", children: [{ text: "" }] }],
          },
          { type: "p", children: [{ text: "After" }] },
        ],
      });
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onChange.mock.calls[0]?.[0] ?? "[]")).toEqual([
      { type: "p", children: [{ text: "Before" }] },
      { type: "p", children: [{ text: "" }] },
      { type: "p", children: [{ text: "/" }] },
      {
        type: "p",
        children: [{ type: "a", url: "/", children: [{ text: "/" }] }],
      },
      { type: "p", children: [{ text: "/" }] },
      { type: "p", children: [{ text: "After" }] },
    ]);

    act(() => {
      root.unmount();
    });
  });
});
