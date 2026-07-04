// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShareLinkManager } from "./share-link-manager";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ShareLinksQueryMock = {
  data:
    | {
        share_links: {
          expires_at: string | null;
          id: string;
          is_active: boolean;
          role: "EDITOR" | "VIEWER";
          token: string;
        }[];
      }
    | undefined;
  error: Error | null;
  isError: boolean;
  isLoading: boolean;
  refetch: () => void;
};

const mocks = vi.hoisted(
  (): {
    alertDialogOnOpenChange: ((open: boolean) => void) | null;
    copyShareLinkUrl: ReturnType<typeof vi.fn>;
    createShareLinkMutate: ReturnType<typeof vi.fn>;
    deleteShareLinkMutate: ReturnType<typeof vi.fn>;
    shareLinksRefetch: ReturnType<typeof vi.fn<ShareLinksQueryMock["refetch"]>>;
    shareLinksQuery: ShareLinksQueryMock;
    toastError: ReturnType<typeof vi.fn>;
    toastSuccess: ReturnType<typeof vi.fn>;
  } => ({
    alertDialogOnOpenChange: null,
    copyShareLinkUrl: vi.fn(),
    createShareLinkMutate: vi.fn(),
    deleteShareLinkMutate: vi.fn(),
    shareLinksRefetch: vi.fn<ShareLinksQueryMock["refetch"]>(),
    shareLinksQuery: {
      data: {
        share_links: [
          {
            expires_at: null,
            id: "link-1",
            is_active: true,
            role: "VIEWER",
            token: "share-token",
          },
        ],
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: vi.fn<ShareLinksQueryMock["refetch"]>(),
    },
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
  }),
);

function renderManager(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<ShareLinkManager formId="form-1" />);
  });
  return root;
}

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/hooks/forms/use-share-links", () => ({
  useShareLinks: () => ({
    buildShareLinkUrl: (token: string) =>
      `https://example.test/forms/form-1/edit?shareToken=${token}`,
    copyShareLinkUrl: mocks.copyShareLinkUrl,
    createShareLinkMutation: {
      isPending: false,
      mutate: mocks.createShareLinkMutate,
    },
    deleteShareLinkMutation: {
      isPending: false,
      mutate: mocks.deleteShareLinkMutate,
    },
    shareLinksQuery: mocks.shareLinksQuery,
    toggleShareLinkStatusMutation: {
      mutate: vi.fn(),
    },
  }),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    children,
    onOpenChange,
    open,
  }: {
    children: ReactNode;
    onOpenChange?: (open: boolean) => void;
    open?: boolean;
  }) => {
    mocks.alertDialogOnOpenChange = onOpenChange ?? null;
    return open ? <div>{children}</div> : null;
  },
  AlertDialogAction: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  }) => (
    <button
      {...props}
      onClick={(event) => {
        onClick?.(event);
        mocks.alertDialogOnOpenChange?.(false);
      }}
    >
      {children}
    </button>
  ),
  AlertDialogCancel: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  }) => <button {...props}>{children}</button>,
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div role="alertdialog">{children}</div>
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
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children: ReactNode;
    onValueChange?: (value: string) => void;
    value?: string;
  }) => (
    <select
      aria-label="権限"
      value={value}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked: _checked,
    onCheckedChange: _onCheckedChange,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => <button type="button" {...props} />,
}));

describe("ShareLinkManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.alertDialogOnOpenChange = null;
    mocks.shareLinksQuery = {
      data: {
        share_links: [
          {
            expires_at: null,
            id: "link-1",
            is_active: true,
            role: "VIEWER",
            token: "share-token",
          },
        ],
      },
      error: null,
      isError: false,
      isLoading: false,
      refetch: mocks.shareLinksRefetch,
    };
    mocks.deleteShareLinkMutate.mockImplementation(
      (_linkId: string, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.();
      },
    );
    mocks.createShareLinkMutate.mockImplementation(
      (
        _payload: { role: "EDITOR" | "VIEWER" },
        options?: { onSuccess?: () => void },
      ) => {
        options?.onSuccess?.();
      },
    );
  });

  it("shows role differences and the no-expiration warning near link creation", () => {
    const container = document.createElement("div");
    const root = renderManager(container);

    expect(container.textContent).toContain(
      "フォーム内容の閲覧のみ。フォーム編集と回答閲覧はできません。",
    );
    expect(container.textContent).toContain(
      "フォーム構成や公開設定を編集でき、送信済み回答も閲覧できます。",
    );
    expect(container.textContent).toContain(
      "新規リンクは期限なしで作成されます",
    );

    act(() => root.unmount());
  });

  it("creates a viewer link without the editor confirmation dialog", () => {
    const container = document.createElement("div");
    const root = renderManager(container);

    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("作成"),
    );
    expect(createButton).toBeDefined();

    act(() => {
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(mocks.createShareLinkMutate).toHaveBeenCalledWith(
      { role: "VIEWER" },
      expect.objectContaining({
        onError: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("共有リンクを作成しました");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();

    act(() => root.unmount());
  });

  it("requires confirmation before creating an editor link", () => {
    const container = document.createElement("div");
    const root = renderManager(container);

    const roleSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="権限"]',
    );
    expect(roleSelect).not.toBeNull();

    act(() => {
      if (roleSelect) roleSelect.value = "EDITOR";
      roleSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("作成"),
    );
    expect(createButton).toBeDefined();

    act(() => {
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.createShareLinkMutate).not.toHaveBeenCalled();
    expect(container.textContent).toContain("編集者リンクを作成しますか?");
    expect(container.textContent).toContain("送信済み回答も閲覧できます");
    expect(container.textContent).toContain("期限なし");

    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "編集者リンクを作成",
    );
    expect(confirmButton).toBeDefined();

    act(() => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.createShareLinkMutate).toHaveBeenCalledWith(
      { role: "EDITOR" },
      expect.objectContaining({
        onError: expect.any(Function),
        onSuccess: expect.any(Function),
      }),
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("共有リンクを作成しました");

    act(() => root.unmount());
  });

  it("shows a failure toast and manual copy URL when clipboard copy returns false", async () => {
    mocks.copyShareLinkUrl.mockResolvedValueOnce({
      copied: false,
      url: "https://example.test/forms/form-1/edit?shareToken=share-token",
    });
    const container = document.createElement("div");
    const root = renderManager(container);

    const copyButton = container.querySelector(
      'button[aria-label="リンクをコピー"]',
    );
    expect(copyButton).not.toBeNull();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "リンクをコピーできませんでした。手動でコピーしてください。",
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="手動コピー用共有リンク"]',
      )?.value,
    ).toBe("https://example.test/forms/form-1/edit?shareToken=share-token");

    act(() => root.unmount());
  });

  it("shows a retryable query error instead of the empty state", () => {
    mocks.shareLinksQuery = {
      ...mocks.shareLinksQuery,
      data: undefined,
      error: new Error("共有リンクの取得に失敗しました。"),
      isError: true,
    };
    const container = document.createElement("div");
    const root = renderManager(container);

    expect(container.textContent).toContain("共有リンクの取得に失敗しました。");
    expect(container.textContent).not.toContain("共有リンクはまだありません。");

    const retryButton = container.querySelector(
      'button[data-testid="share-link-query-retry"]',
    );
    expect(retryButton).not.toBeNull();

    act(() => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.shareLinksRefetch).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });

  it.each([
    [
      "INSUFFICIENT_PERMISSIONS structured error",
      Object.assign(new Error("[object Object]"), {
        details: {
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Insufficient permissions",
          },
        },
      }),
      "権限不足: 共有リンクを管理する権限がありません。",
    ],
    [
      "expired share link",
      "Share link has expired",
      "期限切れ: この共有リンクは有効期限が切れています。",
    ],
    [
      "not-found share link",
      "Share link not found",
      "削除済み: この共有リンクは削除済み、または無効化されています。",
    ],
  ])("shows a distinct failure copy for %s", (_label, apiError, expectedCopy) => {
    mocks.shareLinksQuery = {
      ...mocks.shareLinksQuery,
      data: undefined,
      error: apiError instanceof Error ? apiError : new Error(apiError),
      isError: true,
    };
    const container = document.createElement("div");
    const root = renderManager(container);

    expect(container.textContent).toContain(expectedCopy);
    expect(container.textContent).not.toContain("共有リンクはまだありません。");

    act(() => root.unmount());
  });

  it("lets users dismiss the manual copy URL panel", async () => {
    mocks.copyShareLinkUrl.mockResolvedValueOnce({
      copied: false,
      url: "https://example.test/forms/form-1/edit?shareToken=share-token",
    });
    const container = document.createElement("div");
    const root = renderManager(container);

    const copyButton = container.querySelector(
      'button[aria-label="リンクをコピー"]',
    );
    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('input[aria-label="手動コピー用共有リンク"]'),
    ).not.toBeNull();

    const closeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "閉じる",
    );
    expect(closeButton).toBeDefined();

    act(() => {
      closeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('input[aria-label="手動コピー用共有リンク"]'),
    ).toBeNull();

    act(() => root.unmount());
  });

  it("clears the manual copy URL panel after deleting a share link", async () => {
    mocks.copyShareLinkUrl.mockResolvedValueOnce({
      copied: false,
      url: "https://example.test/forms/form-1/edit?shareToken=share-token",
    });
    const container = document.createElement("div");
    const root = renderManager(container);

    const copyButton = container.querySelector(
      'button[aria-label="リンクをコピー"]',
    );
    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('input[aria-label="手動コピー用共有リンク"]'),
    ).not.toBeNull();

    const deleteButton = container.querySelector(
      'button[aria-label="リンクを削除"]',
    );
    act(() => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.deleteShareLinkMutate).toHaveBeenCalledWith(
      "link-1",
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(
      container.querySelector('input[aria-label="手動コピー用共有リンク"]'),
    ).toBeNull();

    act(() => root.unmount());
  });

  it("shows a failure toast and manual copy URL when clipboard copy rejects", async () => {
    mocks.copyShareLinkUrl.mockRejectedValueOnce(new Error("denied"));
    const container = document.createElement("div");
    const root = renderManager(container);

    const copyButton = container.querySelector(
      'button[aria-label="リンクをコピー"]',
    );
    expect(copyButton).not.toBeNull();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "リンクをコピーできませんでした。手動でコピーしてください。",
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="手動コピー用共有リンク"]',
      )?.value,
    ).toBe("https://example.test/forms/form-1/edit?shareToken=share-token");

    act(() => root.unmount());
  });
});
