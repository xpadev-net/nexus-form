// @vitest-environment jsdom

import { getByRole } from "@testing-library/dom";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
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
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("SpreadsheetSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes the refresh button with an accessible name", () => {
    const onRefreshSpreadsheets = vi.fn();
    const container = document.createElement("div");
    const root: Root = createRoot(container);

    act(() => {
      root.render(
        <SpreadsheetSelector
          searchQuery=""
          selectedSpreadsheetId=""
          filteredSpreadsheets={[]}
          isFetchingSpreadsheets={false}
          spreadsheetsErrorMessage="スプレッドシート一覧の取得に失敗しました"
          isSpreadsheetDialogOpen={false}
          newSpreadsheetTitle=""
          isCreatingSpreadsheet={false}
          onSearchQueryChange={vi.fn()}
          onRefreshSpreadsheets={onRefreshSpreadsheets}
          onSelectSpreadsheet={vi.fn()}
          onSpreadsheetDialogOpenChange={vi.fn()}
          onNewSpreadsheetTitleChange={vi.fn()}
          onCreateSpreadsheet={vi.fn()}
        />,
      );
    });

    const refreshButton = getByRole(container, "button", {
      name: "スプレッドシート一覧を再取得",
    });

    act(() => {
      refreshButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRefreshSpreadsheets).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
  });
});
