// @vitest-environment jsdom

import {
  getByRole,
  getByTestId,
  queryAllByText,
  queryByText,
} from "@testing-library/dom";
import type { ComponentProps, ReactNode } from "react";
import {
  act,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SpreadsheetSelector } from "./spreadsheet-selector";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & {
    children: ReactNode;
    size?: string;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) => (
    <div data-open={open}>{children}</div>
  ),
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/alert-dialog", () => {
  const AlertDialogContext = createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }>({ open: false, onOpenChange: () => undefined });

  return {
    AlertDialog: ({
      children,
      open = false,
      onOpenChange = () => undefined,
    }: {
      children: ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => (
      <AlertDialogContext.Provider value={{ open, onOpenChange }}>
        <div>{children}</div>
      </AlertDialogContext.Provider>
    ),
    AlertDialogAction: ({
      children,
      onClick,
    }: ComponentProps<"button"> & { children: ReactNode }) => (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children }: { children: ReactNode }) => {
      const { onOpenChange } = useContext(AlertDialogContext);
      return (
        <button type="button" onClick={() => onOpenChange(false)}>
          {children}
        </button>
      );
    },
    AlertDialogContent: ({ children }: { children: ReactNode }) => {
      const { open } = useContext(AlertDialogContext);
      return open ? <div>{children}</div> : null;
    },
    AlertDialogDescription: ({ children }: { children: ReactNode }) => (
      <p>{children}</p>
    ),
    AlertDialogFooter: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogHeader: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogTitle: ({ children }: { children: ReactNode }) => (
      <h2>{children}</h2>
    ),
  };
});

vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <div data-testid="spreadsheet-scroll-area" className={className}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/ui/popover", () => {
  const PopoverContext = createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }>({ open: false, onOpenChange: () => undefined });

  return {
    Popover: ({
      children,
      open = false,
      onOpenChange = () => undefined,
    }: {
      children: ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => {
      useEffect(() => {
        if (!open) return;

        const closeOnOutsidePointerDown = () => onOpenChange(false);
        document.addEventListener("mousedown", closeOnOutsidePointerDown);
        return () =>
          document.removeEventListener("mousedown", closeOnOutsidePointerDown);
      }, [open, onOpenChange]);

      return (
        <PopoverContext.Provider value={{ open, onOpenChange }}>
          <div>{children}</div>
        </PopoverContext.Provider>
      );
    },
    PopoverContent: ({
      children,
      className,
    }: {
      children: ReactNode;
      className?: string;
    }) => {
      const { open } = useContext(PopoverContext);
      return open ? (
        <div data-testid="spreadsheet-popover-content" className={className}>
          {children}
        </div>
      ) : null;
    },
    PopoverTrigger: ({ children }: { children: ReactNode }) => {
      const { open, onOpenChange } = useContext(PopoverContext);
      if (
        !isValidElement<{
          onClick?: ComponentProps<"button">["onClick"];
        }>(children)
      ) {
        return <>{children}</>;
      }

      return cloneElement(children, {
        onClick: (event) => {
          children.props.onClick?.(event);
          onOpenChange(!open);
        },
      });
    },
  };
});

type SpreadsheetSelectorTestProps = ComponentProps<typeof SpreadsheetSelector>;

function renderSelector(
  overrideProps: Partial<SpreadsheetSelectorTestProps> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const props: SpreadsheetSelectorTestProps = {
    searchQuery: "",
    selectedSpreadsheetId: "",
    selectedSpreadsheetName: undefined,
    currentLinkedSpreadsheetId: "",
    currentLinkedSpreadsheetName: undefined,
    filteredSpreadsheets: [],
    isFetchingSpreadsheets: false,
    spreadsheetsErrorMessage: null,
    isSpreadsheetDialogOpen: false,
    newSpreadsheetTitle: "",
    isCreatingSpreadsheet: false,
    onSearchQueryChange: vi.fn(),
    onRefreshSpreadsheets: vi.fn(),
    onSelectSpreadsheet: vi.fn(),
    onSpreadsheetDialogOpenChange: vi.fn(),
    onNewSpreadsheetTitleChange: vi.fn(),
    onCreateSpreadsheet: vi.fn(),
    ...overrideProps,
  };

  act(() => {
    root.render(<SpreadsheetSelector {...props} />);
  });

  return { container, props, root };
}

function cleanupSelector(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount();
  });

  container.remove();
}

describe("SpreadsheetSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes the refresh button with an accessible name", () => {
    const onRefreshSpreadsheets = vi.fn();
    const { container, root } = renderSelector({
      spreadsheetsErrorMessage: "スプレッドシート一覧の取得に失敗しました",
      onRefreshSpreadsheets,
    });

    try {
      const refreshButton = getByRole(container, "button", {
        name: "スプレッドシート一覧を再取得",
      });

      act(() => {
        refreshButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(onRefreshSpreadsheets).toHaveBeenCalledTimes(1);
    } finally {
      cleanupSelector(root, container);
    }
  }, 15_000);

  it("shows only the selected spreadsheet while the selector is closed", () => {
    const { container, root } = renderSelector({
      selectedSpreadsheetId: "current-spreadsheet-id",
      selectedSpreadsheetName: "現在の連携先",
      currentLinkedSpreadsheetId: "current-spreadsheet-id",
      currentLinkedSpreadsheetName: "現在の連携先",
      filteredSpreadsheets: [
        { id: "current-spreadsheet-id", name: "現在の連携先" },
        { id: "personal-drive-id", name: "個人 Drive の候補" },
      ],
    });

    try {
      expect(queryByText(container, "現在の連携先")).not.toBeNull();
      expect(queryByText(container, "個人 Drive の候補")).toBeNull();
    } finally {
      cleanupSelector(root, container);
    }
  }, 15_000);

  it("uses the selected spreadsheet id when its name is unavailable", () => {
    const { container, root } = renderSelector({
      selectedSpreadsheetId: "current-spreadsheet-id",
      currentLinkedSpreadsheetId: "current-spreadsheet-id",
      filteredSpreadsheets: [],
    });

    try {
      expect(queryByText(container, "ID: current-...t-id")).not.toBeNull();
      expect(queryByText(container, "現在連携中")).not.toBeNull();
    } finally {
      cleanupSelector(root, container);
    }
  }, 15_000);

  it("separates current, folder browser, and create actions inside a limited popover", () => {
    const spreadsheets = Array.from({ length: 25 }, (_, index) => ({
      id: `spreadsheet-${index}`,
      name: `Spreadsheet ${index}`,
    }));
    const { container, root } = renderSelector({
      selectedSpreadsheetId: "spreadsheet-0",
      selectedSpreadsheetName: "Spreadsheet 0",
      currentLinkedSpreadsheetId: "spreadsheet-0",
      currentLinkedSpreadsheetName: "Spreadsheet 0",
      filteredSpreadsheets: spreadsheets,
    });

    try {
      const selector = getByRole(container, "combobox", {
        name: /Spreadsheet 0/,
      });

      act(() => {
        selector.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(queryAllByText(container, "現在連携中").length).toBeGreaterThan(0);
      expect(
        queryByText(container, "フォルダから選択（最大20件）"),
      ).not.toBeNull();
      expect(queryAllByText(container, "マイドライブ").length).toBeGreaterThan(
        0,
      );
      expect(
        queryByText(container, "新しいスプレッドシートを作成"),
      ).not.toBeNull();
      expect(
        getByTestId(container, "spreadsheet-popover-content").className,
      ).toContain("z-[60]");
      expect(
        getByTestId(container, "spreadsheet-scroll-area").className,
      ).toContain("h-72");
      expect(
        getByTestId(container, "spreadsheet-scroll-area").className,
      ).toContain("max-h-[45vh]");
      expect(queryByText(container, "Spreadsheet 20")).not.toBeNull();
      expect(queryByText(container, "Spreadsheet 21")).toBeNull();

      act(() => {
        document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      });

      expect(queryByText(container, "新しいスプレッドシートを作成")).toBeNull();
    } finally {
      cleanupSelector(root, container);
    }
  }, 15_000);

  it("adds spreadsheet ids when duplicate names would be ambiguous", () => {
    const { container, root } = renderSelector({
      selectedSpreadsheetId: "duplicate-spreadsheet-a",
      selectedSpreadsheetName: "同名シート",
      currentLinkedSpreadsheetId: "duplicate-spreadsheet-a",
      currentLinkedSpreadsheetName: "同名シート",
      filteredSpreadsheets: [
        { id: "duplicate-spreadsheet-a", name: "同名シート" },
        { id: "duplicate-spreadsheet-b", name: "同名シート" },
      ],
    });

    try {
      const selector = getByRole(container, "combobox", {
        name: /同名シート/,
      });

      act(() => {
        selector.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(queryByText(container, /ID: duplicat\.\.\.et-a/)).not.toBeNull();
      expect(queryByText(container, /ID: duplicat\.\.\.et-b/)).not.toBeNull();
    } finally {
      cleanupSelector(root, container);
    }
  }, 15_000);

  it("groups spreadsheets by Drive folder paths and distinguishes duplicate names", () => {
    const { container, root } = renderSelector({
      selectedSpreadsheetId: "",
      filteredSpreadsheets: [
        {
          id: "shared-sales-report-a",
          name: "月次レポート",
          itemType: "spreadsheet",
          parents: ["folder-sales"],
          folderPaths: [
            {
              folderIds: ["folder-company", "folder-sales"],
              pathSegments: [
                { id: "folder-company", name: "Company" },
                { id: "folder-sales", name: "Sales" },
              ],
            },
          ],
        },
        {
          id: "shared-sales-report-b",
          name: "月次レポート",
          itemType: "spreadsheet",
          parents: ["folder-support"],
          folderPaths: [
            {
              folderIds: ["folder-company", "folder-support"],
              pathSegments: [
                { id: "folder-company", name: "Company" },
                { id: "folder-support", name: "Support" },
              ],
            },
          ],
        },
        {
          id: "root-sheet",
          name: "Root sheet",
          itemType: "spreadsheet",
          parents: [],
          folderPaths: [],
        },
        {
          id: "missing-folder-metadata",
          name: "Missing metadata",
          itemType: "spreadsheet",
          parents: ["folder-hidden"],
          folderPaths: [],
        },
        {
          id: "multi-parent-sheet",
          name: "Multi parent",
          itemType: "spreadsheet",
          parents: ["folder-alpha", "folder-beta"],
          folderPaths: [
            {
              folderIds: ["folder-alpha"],
              pathSegments: [{ id: "folder-alpha", name: "Alpha" }],
            },
            {
              folderIds: ["folder-beta"],
              pathSegments: [{ id: "folder-beta", name: "Beta" }],
            },
          ],
        },
      ],
    });

    try {
      const selector = getByRole(container, "combobox", {
        name: /未選択/,
      });

      act(() => {
        selector.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(queryByText(container, "Company")).not.toBeNull();
      expect(queryByText(container, "Sales")).not.toBeNull();
      expect(queryByText(container, "Support")).not.toBeNull();
      expect(queryAllByText(container, "マイドライブ").length).toBeGreaterThan(
        0,
      );
      expect(
        queryAllByText(container, "フォルダ情報なし").length,
      ).toBeGreaterThan(0);
      expect(queryByText(container, /Company \/ Sales/)).not.toBeNull();
      expect(queryByText(container, /Company \/ Support/)).not.toBeNull();
      expect(queryAllByText(container, /Alpha/).length).toBeGreaterThan(0);
      expect(queryAllByText(container, /Beta/).length).toBeGreaterThan(0);
      expect(queryByText(container, /ID: shared-s\.\.\.rt-a/)).not.toBeNull();
      expect(queryByText(container, /ID: shared-s\.\.\.rt-b/)).not.toBeNull();
    } finally {
      cleanupSelector(root, container);
    }
  }, 15_000);

  it("does not infer root folder metadata for a current spreadsheet outside the visible page", () => {
    const { container, root } = renderSelector({
      selectedSpreadsheetId: "current-spreadsheet-id",
      selectedSpreadsheetName: "現在の連携先",
      currentLinkedSpreadsheetId: "current-spreadsheet-id",
      currentLinkedSpreadsheetName: "現在の連携先",
      filteredSpreadsheets: [],
    });

    try {
      const selector = getByRole(container, "combobox", {
        name: /現在の連携先/,
      });

      act(() => {
        selector.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(container.textContent).toContain("現在連携中");
      expect(container.textContent).not.toContain("現在連携中 / マイドライブ");
    } finally {
      cleanupSelector(root, container);
    }
  }, 15_000);

  it("confirms before replacing an existing spreadsheet selection", () => {
    const onSelectSpreadsheet = vi.fn();
    const { container, root } = renderSelector({
      selectedSpreadsheetId: "spreadsheet-a",
      selectedSpreadsheetName: "Spreadsheet A",
      currentLinkedSpreadsheetId: "spreadsheet-a",
      currentLinkedSpreadsheetName: "Spreadsheet A",
      filteredSpreadsheets: [
        { id: "spreadsheet-a", name: "Spreadsheet A" },
        { id: "spreadsheet-b", name: "Spreadsheet B" },
      ],
      onSelectSpreadsheet,
    });

    try {
      const selector = getByRole(container, "combobox", {
        name: /Spreadsheet A/,
      });

      act(() => {
        selector.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const nextSpreadsheet = getByRole(container, "option", {
        name: /Spreadsheet B/,
      });

      act(() => {
        nextSpreadsheet.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });

      expect(onSelectSpreadsheet).not.toHaveBeenCalled();
      expect(queryByText(container, "連携先を変更しますか？")).not.toBeNull();
      expect(container.textContent).toContain("ID: spreadsheet-b");

      const confirmButton = getByRole(container, "button", {
        name: "変更する",
      });

      act(() => {
        confirmButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(onSelectSpreadsheet).toHaveBeenCalledWith("spreadsheet-b");
    } finally {
      cleanupSelector(root, container);
    }
  }, 15_000);

  it("does not confirm when changing an unsaved first-time selection", () => {
    const onSelectSpreadsheet = vi.fn();
    const { container, root } = renderSelector({
      selectedSpreadsheetId: "spreadsheet-a",
      selectedSpreadsheetName: "Spreadsheet A",
      currentLinkedSpreadsheetId: "",
      filteredSpreadsheets: [
        { id: "spreadsheet-a", name: "Spreadsheet A" },
        { id: "spreadsheet-b", name: "Spreadsheet B" },
      ],
      onSelectSpreadsheet,
    });

    try {
      const selector = getByRole(container, "combobox", {
        name: /Spreadsheet A/,
      });

      act(() => {
        selector.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const nextSpreadsheet = getByRole(container, "option", {
        name: /Spreadsheet B/,
      });

      act(() => {
        nextSpreadsheet.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });

      expect(onSelectSpreadsheet).toHaveBeenCalledWith("spreadsheet-b");
      expect(queryByText(container, "連携先を変更しますか？")).toBeNull();
    } finally {
      cleanupSelector(root, container);
    }
  }, 15_000);
});
