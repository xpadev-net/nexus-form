// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormArchiveManager } from "./form-archive-manager";
import { FormDuplicateModal } from "./form-duplicate-modal";

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogCancel: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
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
  AlertDialogTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: ComponentProps<"button"> & {
    size?: string;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function render(node: ReactNode): Root {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return root;
}

function clickButton(label: string): void {
  const button = Array.from(document.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(label),
  );
  expect(button).toBeInstanceOf(HTMLButtonElement);
  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("duplicate and archive form actions", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the duplicate destination name and copy policy before confirming", () => {
    const onConfirm = vi.fn();
    const root = render(
      <FormDuplicateModal
        open
        sourceTitle="応募フォーム"
        onConfirm={onConfirm}
      />,
    );

    expect(document.body.textContent).toContain("応募フォーム のコピー");
    expect(document.body.textContent).toContain("コピーせず下書きで作成");
    expect(document.body.textContent).toContain("回答");
    expect(document.body.textContent).toContain("コピーしない");
    expect(document.body.textContent).toContain("共有設定");
    expect(document.body.textContent).toContain("質問とバリデーションをコピー");

    clickButton("複製する");
    expect(onConfirm).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it("keeps the duplicate confirmation button disabled while duplicating", () => {
    const root = render(<FormDuplicateModal open isDuplicating />);

    const button = Array.from(document.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("複製する"),
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Duplicate confirmation button not found");
    }
    expect(button.disabled).toBe(true);

    act(() => root.unmount());
  });

  it("requires archive confirmation before calling the archive handler", () => {
    const onArchive = vi.fn();
    const root = render(
      <FormArchiveManager isArchived={false} onArchive={onArchive} />,
    );

    expect(document.body.textContent).toContain("フォームをアーカイブ");
    expect(document.body.textContent).toContain(
      "アーカイブするとフォーム一覧に表示されなくなります。",
    );

    clickButton("アーカイブする");
    expect(onArchive).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it("shows archived state and a restore action when the form is archived", () => {
    const onUnarchive = vi.fn();
    const root = render(
      <FormArchiveManager isArchived onUnarchive={onUnarchive} />,
    );

    expect(document.body.textContent).toContain("アーカイブ済み");
    expect(document.body.textContent).toContain(
      "一覧のアーカイブフィルターから確認できます。",
    );

    clickButton("復元");
    expect(onUnarchive).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });
});
