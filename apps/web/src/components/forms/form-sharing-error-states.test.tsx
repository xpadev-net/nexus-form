// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvitationManager } from "./invitation-manager";
import { PermissionEditor } from "./permission-editor";
import { ShareLinkManager } from "./share-link-manager";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  invitationsRefetch: vi.fn(),
  permissionsRefetch: vi.fn(),
  shareLinksRefetch: vi.fn(),
}));

function renderNode(container: HTMLElement, node: ReactNode): Root {
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return root;
}

vi.mock("@/hooks/forms/use-form-permissions", () => ({
  useFormPermissions: () => ({
    createInvitationMutation: {
      isPending: false,
      mutate: vi.fn(),
    },
    deleteInvitationMutation: {
      isPending: false,
      mutate: vi.fn(),
    },
    invitationsQuery: {
      data: undefined,
      error: new Error("招待の取得に失敗しました"),
      isError: true,
      isLoading: false,
      refetch: mocks.invitationsRefetch,
    },
    permissionsQuery: {
      data: undefined,
      error: new Error("権限の取得に失敗しました"),
      isError: true,
      isLoading: false,
      refetch: mocks.permissionsRefetch,
    },
    removePermissionMutation: {
      isPending: false,
      mutate: vi.fn(),
    },
    updatePermissionMutation: {
      mutate: vi.fn(),
    },
  }),
}));

vi.mock("@/hooks/forms/use-share-links", () => ({
  useShareLinks: () => ({
    buildShareLinkUrl: (token: string) =>
      `https://example.test/forms/shared/${token}`,
    copyShareLinkUrl: vi.fn(),
    createShareLinkMutation: {
      isPending: false,
      mutate: vi.fn(),
    },
    deleteShareLinkMutation: {
      isPending: false,
      mutate: vi.fn(),
    },
    shareLinksQuery: {
      data: undefined,
      error: new Error("共有リンクの取得に失敗しました"),
      isError: true,
      isLoading: false,
      refetch: mocks.shareLinksRefetch,
    },
    toggleShareLinkStatusMutation: {
      mutate: vi.fn(),
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
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

vi.mock("@/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  }) => <button {...props}>{children}</button>,
  SelectValue: () => <span />,
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

describe("form sharing query error states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows a retryable error instead of the empty permission state", () => {
    const container = document.createElement("div");
    const root = renderNode(container, <PermissionEditor formId="form-1" />);

    expect(container.textContent).toContain("権限の取得に失敗しました");
    expect(container.textContent).not.toContain(
      "権限が設定されているユーザーはいません。",
    );

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "再読み込み",
    );
    expect(retryButton).toBeDefined();

    act(() => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.permissionsRefetch).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it("shows a retryable error instead of the empty invitation state", () => {
    const container = document.createElement("div");
    const root = renderNode(container, <InvitationManager formId="form-1" />);

    expect(container.textContent).toContain("招待の取得に失敗しました");
    expect(container.textContent).not.toContain("保留中の招待はありません。");

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "再読み込み",
    );
    expect(retryButton).toBeDefined();

    act(() => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.invitationsRefetch).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it("shows a retryable error instead of the empty share-link state", () => {
    const container = document.createElement("div");
    const root = renderNode(container, <ShareLinkManager formId="form-1" />);

    expect(container.textContent).toContain("共有リンクの取得に失敗しました");
    expect(container.textContent).not.toContain("共有リンクはまだありません。");

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "再読み込み",
    );
    expect(retryButton).toBeDefined();

    act(() => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.shareLinksRefetch).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });
});
