// @vitest-environment jsdom

import { fireEvent } from "@testing-library/dom";
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TokensPage } from "./tokens-page";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  clipboardWriteText: vi.fn<Clipboard["writeText"]>(),
  createTokenMutateAsync: vi.fn(),
  revokeTokenMutateAsync: vi.fn(),
  toastError: vi.fn(),
}));

function renderTokensPage(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<TokensPage />);
  });
  return root;
}

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
  },
}));

vi.mock("@/hooks/use-page-title", () => ({
  usePageTitle: vi.fn(),
}));

vi.mock("@/hooks/tokens/use-api-tokens", () => ({
  useApiTokens: () => ({
    createTokenMutation: {
      isPending: false,
      mutateAsync: mocks.createTokenMutateAsync,
    },
    revokeTokenMutation: {
      isPending: false,
      mutateAsync: mocks.revokeTokenMutateAsync,
    },
    tokensQuery: {
      data: { tokens: [] },
      error: null,
      isPending: false,
    },
  }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open?: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

describe("TokensPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.clipboardWriteText.mockResolvedValue(undefined);
    mocks.createTokenMutateAsync.mockResolvedValue({
      message: "created",
      token: {
        created_at: "2026-06-01T00:00:00.000Z",
        id: "token-1",
        is_active: true,
        name: "Deploy token",
        scopes: ["read"],
        token: "nxf_live_token_secret",
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: mocks.clipboardWriteText,
      } satisfies Pick<Clipboard, "writeText">,
    });
  });

  it("shows copied feedback on the token reveal copy button and resets it", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const root = renderTokensPage(container);

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="トークン名"]',
    );
    expect(nameInput).not.toBeNull();

    act(() => {
      if (nameInput) {
        fireEvent.input(nameInput, { target: { value: "Deploy token" } });
      }
    });

    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "作成",
    );

    await act(async () => {
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const copyButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("クリップボードにコピー"));
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.clipboardWriteText).toHaveBeenCalledWith(
      "nxf_live_token_secret",
    );
    expect(copyButton?.getAttribute("data-copy-status")).toBe("copied");
    expect(copyButton?.textContent).toContain("コピー済み");

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(copyButton?.getAttribute("data-copy-status")).toBe("idle");
    expect(copyButton?.textContent).toContain("クリップボードにコピー");

    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("shows failed feedback and keeps the failure toast when token copy rejects", async () => {
    vi.useFakeTimers();
    mocks.clipboardWriteText.mockRejectedValueOnce(new Error("denied"));
    const container = document.createElement("div");
    const root = renderTokensPage(container);

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="トークン名"]',
    );
    act(() => {
      if (nameInput) {
        fireEvent.input(nameInput, { target: { value: "Deploy token" } });
      }
    });

    const createButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "作成",
    );
    await act(async () => {
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const copyButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("クリップボードにコピー"));
    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "クリップボードへのコピーに失敗しました",
    );
    expect(copyButton?.getAttribute("data-copy-status")).toBe("failed");
    expect(copyButton?.textContent).toContain("コピーに失敗しました");

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(copyButton?.getAttribute("data-copy-status")).toBe("idle");
    expect(copyButton?.textContent).toContain("クリップボードにコピー");

    act(() => root.unmount());
    vi.useRealTimers();
  });
});
