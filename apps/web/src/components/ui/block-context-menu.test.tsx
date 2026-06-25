// @vitest-environment jsdom

import type { ComponentProps, ReactElement, ReactNode } from "react";
import { act, cloneElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockContextMenu } from "./block-context-menu";
import {
  resolveBlockContextMenuTargetId,
  shouldKeepBlockContextMenuSelection,
} from "./block-context-menu-target";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const blockMenuShowMock = vi.hoisted(() => vi.fn());
const blockMenuHideMock = vi.hoisted(() => vi.fn());
const blockSelectionSetMock = vi.hoisted(() => vi.fn());
const blockSelectionGetNodesMock = vi.hoisted(() => vi.fn());

vi.mock("@platejs/selection/react", () => ({
  BLOCK_CONTEXT_MENU_ID: "context",
  BlockMenuPlugin: { key: "blockMenu" },
  BlockSelectionPlugin: { key: "blockSelection" },
}));

vi.mock("platejs", () => ({
  KEYS: { codeBlock: "code_block" },
}));

vi.mock("platejs/react", () => ({
  useEditorPlugin: () => ({
    api: {
      blockMenu: {
        hide: blockMenuHideMock,
        show: blockMenuShowMock,
      },
    },
    editor: {
      getApi: () => ({
        blockSelection: {
          focus: vi.fn(),
          getNodes: blockSelectionGetNodesMock,
          set: blockSelectionSetMock,
        },
      }),
      getTransforms: () => ({
        blockSelection: {
          duplicate: vi.fn(),
          removeNodes: vi.fn(),
          setIndent: vi.fn(),
          setNodes: vi.fn(),
        },
      }),
      tf: { focus: vi.fn() },
    },
  }),
  usePlateState: () => [false],
  usePluginOption: () => null,
}));

vi.mock("@/components/editor/transforms", () => ({
  setBlockType: vi.fn(),
}));

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuGroup: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuItem: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  ContextMenuSeparator: () => <hr />,
  ContextMenuSub: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuSubContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuSubTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  ContextMenuTrigger: ({
    asChild: _asChild,
    children,
    ...props
  }: ComponentProps<"div"> & { asChild?: boolean }) =>
    cloneElement(children as ReactElement<ComponentProps<"div">>, props),
}));

vi.mock("@/components/ui/form-question-menu-items", () => ({
  FORM_QUESTION_MENU_ITEMS: [],
}));

vi.mock("@/components/ui/turn-into-toolbar-button", () => ({
  turnIntoItems: [],
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: () => false,
}));

vi.mock("lucide-react", () => ({
  ClipboardListIcon: () => <span />,
}));

function appendBlock(root: HTMLElement, id: string): HTMLElement {
  const block = document.createElement("div");
  block.className = "slate-blockWrapper";
  block.dataset.blockContextMenuTarget = id;

  const body = document.createElement("div");
  body.className = "question-card-body";
  body.append(document.createTextNode(`Body for ${id}`));
  block.append(body);
  root.append(block);

  return body;
}

function stubElementFromPoint(element: Element | null) {
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => element),
  });
}

describe("resolveBlockContextMenuTargetId", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("resolves the block under the right-click coordinates from nested card body content", () => {
    const root = document.createElement("div");
    const firstBody = appendBlock(root, "block-1");
    const secondBody = appendBlock(root, "block-2");
    document.body.append(root);
    stubElementFromPoint(secondBody);

    expect(
      resolveBlockContextMenuTargetId({
        clientX: 180,
        clientY: 120,
        root,
        target: firstBody,
      }),
    ).toBe("block-2");
  });

  it("falls back to the event target when coordinate lookup is unavailable", () => {
    const root = document.createElement("div");
    const body = appendBlock(root, "block-1");
    const text = body.firstChild;
    document.body.append(root);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: undefined,
    });

    expect(
      resolveBlockContextMenuTargetId({
        clientX: 80,
        clientY: 40,
        root,
        target: text,
      }),
    ).toBe("block-1");
  });

  it("ignores blocks outside the current context menu root", () => {
    const root = document.createElement("div");
    const outsideRoot = document.createElement("div");
    const outsideBody = appendBlock(outsideRoot, "outside-block");
    document.body.append(root, outsideRoot);
    stubElementFromPoint(outsideBody);

    expect(
      resolveBlockContextMenuTargetId({
        clientX: 160,
        clientY: 90,
        root,
        target: root,
      }),
    ).toBeNull();
  });
});

describe("BlockContextMenu", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    blockMenuShowMock.mockClear();
    blockMenuHideMock.mockClear();
    blockSelectionSetMock.mockClear();
    blockSelectionGetNodesMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  function renderContextMenu() {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <BlockContextMenu>
          <div>
            <div data-block-context-menu-target="block-1">
              <div data-testid="first-body">First</div>
            </div>
            <div data-block-context-menu-target="block-2">
              <div data-testid="second-body">Second</div>
            </div>
          </div>
        </BlockContextMenu>,
      );
    });

    return { container, root };
  }

  it("selects the block resolved from the right-click coordinates before opening the menu", () => {
    blockSelectionGetNodesMock.mockReturnValue([
      [{ id: "block-1" }, [0]],
    ]);
    const { container, root } = renderContextMenu();
    const firstBody = container.querySelector<HTMLElement>(
      '[data-testid="first-body"]',
    );
    const secondBody = container.querySelector<HTMLElement>(
      '[data-testid="second-body"]',
    );

    if (!firstBody || !secondBody) {
      throw new Error("Expected context menu test blocks to render");
    }

    stubElementFromPoint(secondBody);

    act(() => {
      firstBody.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: 180,
          clientY: 120,
        }),
      );
      vi.runOnlyPendingTimers();
    });

    expect(blockSelectionSetMock).toHaveBeenCalledWith("block-2");
    expect(blockMenuShowMock).toHaveBeenCalledWith("context", {
      x: 180,
      y: 120,
    });

    act(() => root.unmount());
  });

  it("keeps a multi-block selection when the coordinate target is already selected", () => {
    blockSelectionGetNodesMock.mockReturnValue([
      [{ id: "block-1" }, [0]],
      [{ id: "block-2" }, [1]],
    ]);
    const { container, root } = renderContextMenu();
    const secondBody = container.querySelector<HTMLElement>(
      '[data-testid="second-body"]',
    );

    if (!secondBody) {
      throw new Error("Expected context menu test block to render");
    }

    stubElementFromPoint(secondBody);

    act(() => {
      secondBody.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          clientX: 180,
          clientY: 120,
        }),
      );
      vi.runOnlyPendingTimers();
    });

    expect(blockSelectionSetMock).not.toHaveBeenCalled();
    expect(blockMenuShowMock).toHaveBeenCalledWith("context", {
      x: 180,
      y: 120,
    });

    act(() => root.unmount());
  });
});

describe("shouldKeepBlockContextMenuSelection", () => {
  it("keeps a multi-block selection when the context-menu target is already selected", () => {
    expect(
      shouldKeepBlockContextMenuSelection(["block-1", "block-2"], "block-2"),
    ).toBe(true);
  });

  it("allows the context-menu target to replace selection when it is not selected", () => {
    expect(
      shouldKeepBlockContextMenuSelection(["block-1", "block-2"], "block-3"),
    ).toBe(false);
  });
});
