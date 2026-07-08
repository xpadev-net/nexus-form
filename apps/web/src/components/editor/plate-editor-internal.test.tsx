// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { PlateSectionContext } from "@/hooks/forms/use-plate-section-context";
import { SectionTransitionEditor } from "../ui/form-question-nodes/editor-controls";
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

const editorHarness = vi.hoisted(
  () =>
    ({
      current: undefined as
        | {
            children: unknown[];
            api: { findPath: ReturnType<typeof vi.fn> };
            tf: { setNodes: ReturnType<typeof vi.fn> };
          }
        | undefined,
    }) satisfies {
      current:
        | {
            children: unknown[];
            api: { findPath: ReturnType<typeof vi.fn> };
            tf: { setNodes: ReturnType<typeof vi.fn> };
          }
        | undefined;
    },
);

const elementHarness = vi.hoisted(
  () =>
    ({
      current: undefined as
        | {
            blockId: string;
            validation?: {
              default_action?: {
                type: "next" | "jump_to_section" | "submit";
                target_id?: string;
              };
            };
          }
        | undefined,
    }) satisfies {
      current:
        | {
            blockId: string;
            validation?: {
              default_action?: {
                type: "next" | "jump_to_section" | "submit";
                target_id?: string;
              };
            };
          }
        | undefined;
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
  useEditorRef: () => editorHarness.current,
  useElement: () => elementHarness.current,
}));

vi.mock("@nexus-form/shared", () => ({
  extractTitleFromChildren: (children: Array<{ text?: string }>) =>
    children.map((child) => child.text ?? "").join(""),
  fromPlateQuestionType: (type: string) => type,
  isCompletionTargetPage: (page: { questionIds: string[] }) =>
    page.questionIds.length === 0,
  isPlateQuestionType: (type: unknown) =>
    typeof type === "string" &&
    type.startsWith("form_") &&
    type !== "form_section_separator",
  splitPlateContentIntoPages: (nodes: unknown[]) => {
    const pages: Array<{
      pageId: string;
      title?: string;
      nodes: unknown[];
      questionIds: string[];
    }> = [];
    let currentPageId = "default";
    let currentTitle: string | undefined;
    let currentNodes: unknown[] = [];

    for (const node of nodes) {
      if (
        node != null &&
        typeof node === "object" &&
        "type" in node &&
        node.type === "form_section_separator"
      ) {
        pages.push({
          pageId: currentPageId,
          title: currentTitle,
          nodes: currentNodes,
          questionIds: [],
        });
        currentPageId =
          "blockId" in node && typeof node.blockId === "string"
            ? node.blockId
            : `page-${pages.length}`;
        currentTitle = "完了セクション";
        currentNodes = [];
      } else {
        currentNodes.push(node);
      }
    }

    pages.push({
      pageId: currentPageId,
      title: currentTitle,
      nodes: currentNodes,
      questionIds: [],
    });

    return pages;
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: {
    children: ReactNode;
    [key: string]: unknown;
  }) => <button {...props}>{children}</button>,
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

vi.mock("@/components/ui/composition-aware-input", () => ({
  CompositionAwareInput: (props: Record<string, unknown>) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({
    children,
    disabled,
    value,
  }: {
    children: ReactNode;
    disabled?: boolean;
    value: string;
  }) => (
    <option disabled={disabled} value={value}>
      {children}
    </option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    placeholder ? <option value="">{placeholder}</option> : null,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: (props: Record<string, unknown>) => (
    <input type="checkbox" {...props} />
  ),
}));

const sectionCtx = {
  sectionIndex: 2,
  totalSections: 2,
  precedingSectionTitle: "セクション 1",
  precedingSectionIndex: 1,
  sections: [
    { id: "default", title: "セクション 1", index: 1 },
    { id: "section-complete", title: "完了セクション", index: 2 },
  ],
} satisfies PlateSectionContext;

function createEditorChildren(defaultAction?: {
  type: "next" | "jump_to_section" | "submit";
  target_id?: string;
}) {
  return [
    { type: "p", children: [{ text: "質問ページ" }] },
    {
      type: "form_section_separator",
      blockId: "section-complete",
      validation: defaultAction ? { default_action: defaultAction } : {},
      children: [{ text: "完了セクション" }],
    },
    { type: "p", children: [{ text: "ありがとうございました" }] },
  ];
}

function renderSectionTransitionEditor(defaultAction?: {
  type: "next" | "jump_to_section" | "submit";
  target_id?: string;
}) {
  const setNodes = vi.fn();
  const element = {
    blockId: "section-complete",
    validation: defaultAction ? { default_action: defaultAction } : {},
  };
  editorHarness.current = {
    children: createEditorChildren(defaultAction),
    api: { findPath: vi.fn(() => [1]) },
    tf: { setNodes },
  };
  elementHarness.current = element;

  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(<SectionTransitionEditor sectionCtx={sectionCtx} />);
  });

  return { container, root, setNodes };
}

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

describe("SectionTransitionEditor", () => {
  it("shows submit transitions as post-submit section moves without renaming the saved action type", () => {
    const { container, root, setNodes } = renderSectionTransitionEditor();
    const actionTypeSelect = container.querySelector("select");

    expect(actionTypeSelect?.textContent).toContain("送信後セクションへ移動");
    expect(actionTypeSelect?.textContent).not.toContain("フォームを送信");

    act(() => {
      if (actionTypeSelect instanceof HTMLSelectElement) {
        actionTypeSelect.value = "submit";
        actionTypeSelect.dispatchEvent(
          new Event("change", { bubbles: true, cancelable: true }),
        );
      }
    });

    expect(setNodes).toHaveBeenLastCalledWith(
      {
        validation: {
          default_action: {
            type: "submit",
            target_id: "section-complete",
          },
        },
      },
      { at: [1] },
    );

    act(() => {
      root.unmount();
    });
  });

  it("keeps deleted submit targets understandable in section transition controls", () => {
    const { container, root } = renderSectionTransitionEditor({
      type: "submit",
      target_id: "deleted-section",
    });

    expect(container.textContent).toContain("送信後セクションへ移動");
    expect(container.textContent).toContain("不明な完了セクション");
    expect(container.textContent).toContain(
      "選択中の完了セクションが見つかりません",
    );

    act(() => {
      root.unmount();
    });
  });
});
