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

const editorOptions = vi.hoisted(
  () =>
    ({
      current: undefined as { plugins?: unknown[] } | undefined,
    }) satisfies {
      current: { plugins?: unknown[] } | undefined;
    },
);

vi.mock("platejs/react", () => ({
  Plate: ({
    children,
    onChange,
    readOnly,
  }: {
    children: ReactNode;
    onChange: (event: { value: unknown[] }) => void;
    readOnly?: boolean;
  }) => {
    plateChangeHandler.current = onChange;
    return (
      <div
        data-read-only={readOnly ? "true" : "false"}
        data-testid="plate-root"
      >
        {children}
      </div>
    );
  },
  usePlateEditor: (options: { plugins?: unknown[] }) => {
    editorOptions.current = options;
    return {
      tf: {
        setValue: vi.fn(),
      },
    };
  },
}));

vi.mock("@/components/editor/editor-kit", () => ({
  EditorKit: ["editor-plugin"],
}));

vi.mock("@/components/editor/viewer-kit", () => ({
  ViewerKit: ["viewer-plugin"],
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

  it("does not emit autosave changes when read-only", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onChange = vi.fn();

    act(() => {
      root.render(
        <PlateEditorInternal value="[]" onChange={onChange} readOnly />,
      );
    });

    expect(
      container
        .querySelector("[data-testid='plate-root']")
        ?.getAttribute("data-read-only"),
    ).toBe("true");
    expect(editorOptions.current?.plugins).toEqual(["viewer-plugin"]);

    act(() => {
      plateChangeHandler.current?.({
        value: [{ type: "p", children: [{ text: "Blocked" }] }],
      });
    });

    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });
});
