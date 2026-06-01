// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnpublishedChangesSection } from "./form-publish-menu/unpublished-changes-section";
import { SnapshotGraph } from "./snapshot-graph";
import { SnapshotSaveDialog } from "./snapshot-save-dialog";

vi.mock("lucide-react", () => ({
  AlertCircle: () => <span data-icon="alert-circle" />,
  GitCompare: () => <span data-icon="git-compare" />,
  Globe: () => <span data-icon="globe" />,
  RotateCcw: () => <span data-icon="rotate-ccw" />,
  Save: () => <span data-icon="save" />,
  Upload: () => <span data-icon="upload" />,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    variant: _variant,
    ...props
  }: ComponentProps<"span"> & { variant?: string }) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & {
    size?: string;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: ReactNode;
    onOpenChange?: (open: boolean) => void;
    open: boolean;
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
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
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({
    children,
    htmlFor: _htmlFor,
    ...props
  }: ComponentProps<"label">) => <span {...props}>{children}</span>,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("./nodes-diff-list", () => ({
  NodesDiffList: () => <div data-testid="nodes-diff-list" />,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function render(element: ReactNode): { container: HTMLElement; root: Root } {
  const container = document.createElement("div");
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return { container, root };
}

function click(element: Element | null) {
  expect(element).not.toBeNull();
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("publish snapshot target copy", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("shows v1 as the public target before the first publish", () => {
    const { container, root } = render(
      <UnpublishedChangesSection
        state={{
          actionState: "idle",
          activeSnapshotVersion: null,
          hasChangesFromActive: false,
          nextSnapshotVersion: 1,
          publishState: "unpublished",
          totalChanges: 2,
        }}
        onPublishChanges={vi.fn()}
        onReset={vi.fn()}
        onSaveOnly={vi.fn()}
      />,
    );

    expect(container.textContent).toContain("未公開の変更2件");
    expect(container.textContent).toContain(
      "現在の編集内容を v1 として公開します。",
    );
    expect(container.textContent).toContain("現在の公開版はありません");

    act(() => {
      root.unmount();
    });
  });

  it("shows the next public version when unpublished changes are saved and published", () => {
    const { container, root } = render(
      <SnapshotSaveDialog
        formId="form-1"
        open={true}
        onOpenChange={vi.fn()}
        isProcessing={false}
        hasUnpublishedChanges={true}
        lastPublishedVersion={2}
        totalChanges={3}
        confirmLabel="保存して公開版を更新"
        willPublish={true}
        onConfirm={vi.fn()}
        error={null}
      />,
    );

    expect(container.textContent).toContain("最新スナップショット: v2");
    expect(container.textContent).toContain(
      "現在の編集内容を v3 として公開します。",
    );

    act(() => {
      root.unmount();
    });
  });

  it("shows which existing snapshot will become public when switching versions", () => {
    const { container, root } = render(
      <SnapshotGraph
        snapshots={[
          {
            id: "snapshot-1",
            version: 1,
            isActive: false,
            publishedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "snapshot-2",
            version: 2,
            isActive: true,
            publishedAt: "2026-01-02T00:00:00.000Z",
          },
        ]}
        isNotPublished={true}
        onActivate={vi.fn()}
        onPublishFromHistory={vi.fn()}
      />,
    );

    click(
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("v1"),
      ) ?? null,
    );

    expect(container.textContent).toContain(
      "公開版にする: v1 を公開版に切り替えます。",
    );
    expect(container.textContent).toContain(
      "公開する: v1 を公開版にしてフォームを公開します。",
    );

    act(() => {
      root.unmount();
    });
  });
});
