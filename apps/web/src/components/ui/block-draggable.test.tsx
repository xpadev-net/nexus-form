// @vitest-environment jsdom

import { DndPlugin, onDropNode, type ElementDragItemNode } from "@platejs/dnd";
import { BlockSelectionPlugin } from "@platejs/selection/react";
import { ElementApi, type TElement } from "platejs";
import {
  ParagraphPlugin,
  createPlateEditor,
  type PlateEditor,
  type PlateElementProps,
} from "platejs/react";
import { type ComponentProps, type ReactNode, act, forwardRef } from "react";
import { createRoot } from "react-dom/client";
import type { DropTargetMonitor } from "react-dnd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockDragElement, isBlockDragEnabled } from "./block-draggable";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const dndMocks = vi.hoisted(() => ({
  useDraggable: vi.fn(),
  useDropLine: vi.fn(() => ({ dropLine: undefined })),
}));

const plateReactMockState = vi.hoisted(() => ({
  editor: undefined as unknown,
  element: undefined as unknown,
}));

vi.mock("@platejs/dnd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@platejs/dnd")>();
  return {
    ...actual,
    useDraggable: dndMocks.useDraggable,
    useDropLine: dndMocks.useDropLine,
  };
});

vi.mock("platejs/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("platejs/react")>();
  return {
    ...actual,
    MemoizedChildren: ({ children }: { children: ReactNode }) => <>{children}</>,
    useEditorRef: () => plateReactMockState.editor,
    useElement: () => plateReactMockState.element,
    usePluginOption: () => false,
    useSelected: () => false,
  };
});

vi.mock("@/components/ui/button", () => ({
  Button: forwardRef<
    HTMLButtonElement,
    ComponentProps<"button"> & { variant?: string }
  >(({ children, type = "button", variant: _variant, ...props }, ref) => (
    <button ref={ref} type={type} {...props}>
      {children}
    </button>
  )),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

type UseDraggableOptions = {
  onDropHandler?: (
    editor: PlateEditor,
    props: { dragItem: { id: string[] | string } },
  ) => void;
};

function paragraph(id: string, text: string): TElement {
  return {
    children: [{ text }],
    id,
    type: "p",
  };
}

function shortTextQuestion(id: string, title: string): TElement {
  return {
    blockId: id,
    children: [paragraph(`${id}-title`, title)],
    id,
    type: "form_short_text",
    validation: {},
  };
}

function createEditor(value: TElement[]): PlateEditor {
  return createPlateEditor({
    plugins: [ParagraphPlugin, BlockSelectionPlugin, DndPlugin],
    value,
  });
}

function getElementAt(editor: PlateEditor, index: number): TElement {
  const node = editor.children[index];
  if (!ElementApi.isElement(node)) {
    throw new Error(`Expected element at index ${index}`);
  }
  return node;
}

function elementIds(editor: PlateEditor): unknown[] {
  return editor.children.map((node) =>
    ElementApi.isElement(node) ? node.id : undefined,
  );
}

function createDropMonitor(y: number): DropTargetMonitor {
  return {
    canDrop: () => true,
    getClientOffset: () => ({ x: 10, y }),
  } as DropTargetMonitor;
}

function renderDragElement({
  editor,
  element,
  path = [0],
}: {
  editor: PlateEditor;
  element: TElement;
  path?: number[];
}): { cleanup: () => void; container: HTMLElement; preview: HTMLDivElement } {
  plateReactMockState.editor = editor;
  plateReactMockState.element = element;

  const blockDom = document.createElement("div");
  blockDom.textContent = "Block body";
  document.body.append(blockDom);

  vi.spyOn(editor.api, "toDOMNode").mockImplementation((node) => {
    if (node === editor) {
      return document.body;
    }
    if (ElementApi.isElement(node) && node.id === element.id) {
      return blockDom;
    }
    return undefined;
  });
  vi.spyOn(editor.tf, "blur").mockImplementation(() => {});
  vi.spyOn(editor.tf, "collapse").mockImplementation(() => {});

  const previewRef = { current: null as HTMLDivElement | null };
  dndMocks.useDraggable.mockReturnValue({
    handleRef: vi.fn(),
    isAboutToDrag: false,
    isDragging: false,
    nodeRef: { current: null },
    previewRef,
  });

  const container = document.createElement("div");
  const root = createRoot(container);

  act(() => {
    const props = {
      children: <p>Body</p>,
      editor,
      element,
      path,
    } as PlateElementProps;

    root.render(<BlockDragElement {...props} />);
  });

  if (!previewRef.current) {
    throw new Error("Preview ref was not attached");
  }

  return {
    cleanup: () => {
      act(() => root.unmount());
      blockDom.remove();
    },
    container,
    preview: previewRef.current,
  };
}

describe("BlockDraggable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    plateReactMockState.editor = undefined;
    plateReactMockState.element = undefined;
  });

  it("keeps form question children out of the draggable target set", () => {
    const question = shortTextQuestion("question-1", "Question title");
    const child = question.children[0];
    const editor = createEditor([paragraph("intro", "Intro"), question]);

    if (!ElementApi.isElement(child)) {
      throw new Error("Expected question child element");
    }

    expect(isBlockDragEnabled(editor, question, [1])).toBe(true);
    expect(isBlockDragEnabled(editor, child, [1, 0])).toBe(false);
  });

  it("prepares handle dragging without cancelling the native left-button drag start", () => {
    const element = paragraph("block-1", "First block");
    const editor = createEditor([element, paragraph("block-2", "Second block")]);
    const blockSelectionApi = editor.getApi(BlockSelectionPlugin).blockSelection;
    const setSelection = vi.spyOn(blockSelectionApi, "set");
    const { cleanup, container, preview } = renderDragElement({ editor, element });
    const handle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="ブロックを移動"]',
    );

    if (!handle) {
      throw new Error("Drag handle button was not rendered");
    }

    const event = new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });

    act(() => {
      handle.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(setSelection).toHaveBeenCalledWith(["block-1"]);
    expect(preview.childElementCount).toBe(1);

    cleanup();
  });

  it("restores the dragged block selection after the drop handler lets Plate move nodes", async () => {
    const element = paragraph("block-1", "First block");
    const editor = createEditor([element, paragraph("block-2", "Second block")]);
    const blockSelectionApi = editor.getApi(BlockSelectionPlugin).blockSelection;
    const setSelection = vi.spyOn(blockSelectionApi, "set");
    const focusSelection = vi.spyOn(blockSelectionApi, "focus");
    const { cleanup, preview } = renderDragElement({ editor, element });
    const options = dndMocks.useDraggable.mock.calls[0]?.[0] as
      | UseDraggableOptions
      | undefined;

    preview.append(document.createElement("span"));
    options?.onDropHandler?.(editor, {
      dragItem: { id: ["block-1", "block-2"] },
    });
    await Promise.resolve();

    expect(preview.childElementCount).toBe(0);
    expect(preview.classList.contains("hidden")).toBe(true);
    expect(preview.classList.contains("opacity-0")).toBe(false);
    expect(setSelection).toHaveBeenLastCalledWith(["block-1", "block-2"]);
    expect(focusSelection).toHaveBeenCalled();

    cleanup();
  });

  it("moves a whole form question block from the left handle drag state", async () => {
    const editor = createEditor([
      paragraph("intro", "Intro"),
      shortTextQuestion("question-1", "First question"),
      shortTextQuestion("question-2", "Second question"),
    ]);
    const dragged = getElementAt(editor, 1);
    const target = getElementAt(editor, 2);
    const blockSelectionApi = editor.getApi(BlockSelectionPlugin).blockSelection;
    const setSelection = vi.spyOn(blockSelectionApi, "set");
    const { cleanup, container, preview } = renderDragElement({
      editor,
      element: dragged,
      path: [1],
    });
    const handle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="ブロックを移動"]',
    );

    if (!handle) {
      throw new Error("Drag handle button was not rendered");
    }

    const startEvent = new MouseEvent("mousedown", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });

    act(() => {
      handle.dispatchEvent(startEvent);
    });

    expect(startEvent.defaultPrevented).toBe(false);
    expect(editor.getOption(DndPlugin, "draggingId")).toEqual(["question-1"]);
    expect(preview.childElementCount).toBe(1);

    const dropTarget = document.createElement("div");
    vi.spyOn(dropTarget, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 100),
    );
    const dragItem: ElementDragItemNode = {
      editor,
      editorId: editor.id,
      element: dragged,
      id: "question-1",
    };
    const options = dndMocks.useDraggable.mock.calls[0]?.[0] as
      | UseDraggableOptions
      | undefined;

    onDropNode(editor, {
      dragItem,
      element: target,
      monitor: createDropMonitor(90),
      nodeRef: { current: dropTarget },
    });
    options?.onDropHandler?.(editor, { dragItem });
    await Promise.resolve();

    expect(elementIds(editor)).toEqual(["intro", "question-2", "question-1"]);
    expect(setSelection).toHaveBeenLastCalledWith("question-1");
    expect(preview.childElementCount).toBe(0);

    cleanup();
  });
});
