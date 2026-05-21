// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShareLinkManager } from "./share-link-manager";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  copyShareLinkUrl: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

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
      `https://example.test/forms/shared/${token}`,
    copyShareLinkUrl: mocks.copyShareLinkUrl,
    createShareLinkMutation: {
      isPending: false,
      mutate: vi.fn(),
    },
    deleteShareLinkMutation: {
      isPending: false,
      mutate: vi.fn(),
    },
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
      isLoading: false,
    },
    toggleShareLinkStatusMutation: {
      mutate: vi.fn(),
    },
  }),
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
  SelectValue: () => <span>閲覧者</span>,
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
  });

  it("shows a failure toast and manual copy URL when clipboard copy returns false", async () => {
    mocks.copyShareLinkUrl.mockResolvedValueOnce({
      copied: false,
      url: "https://example.test/forms/shared/share-token",
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
    ).toBe("https://example.test/forms/shared/share-token");

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
    ).toBe("https://example.test/forms/shared/share-token");

    act(() => root.unmount());
  });
});
