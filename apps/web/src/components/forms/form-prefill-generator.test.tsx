// @vitest-environment jsdom

import { fireEvent } from "@testing-library/dom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodePrefillData } from "@/lib/forms/prefill";
import { FormPrefillGenerator } from "./form-prefill-generator";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
  },
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function renderGenerator(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <FormPrefillGenerator
        plateContent={prefillFixturePlateContent()}
        publicId="public-form-1"
      />,
    );
  });
  return root;
}

function questionNode(
  type: string,
  blockId: string,
  title: string,
  validation?: Record<string, unknown>,
) {
  return {
    type: `form_${type}`,
    blockId,
    ...(validation ? { validation } : {}),
    children: [{ type: "p", children: [{ text: title }] }],
  };
}

function prefillFixturePlateContent(): string {
  const rows = [
    { id: "row-1", label: "Row 1" },
    { id: "row-2", label: "Row 2" },
  ];
  const columns = [
    { id: "morning", label: "Morning" },
    { id: "night", label: "Night" },
  ];

  return JSON.stringify([
    questionNode("short_text", "q-name", "氏名"),
    questionNode("choice_grid", "q-slot", "参加枠", { rows, columns }),
    questionNode("checkbox_grid", "q-needs", "必要な備品", {
      rows,
      columns,
    }),
  ]);
}

describe("FormPrefillGenerator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
  });

  it("shows supported and unsupported type guidance before URL distribution", () => {
    const container = document.createElement("div");
    const root = renderGenerator(container);

    const legend = container.querySelector(
      '[data-testid="prefill-support-legend"]',
    );
    expect(legend?.textContent).toContain("対応");
    expect(legend?.textContent).toContain("短文");
    expect(legend?.textContent).toContain("未対応");
    expect(legend?.textContent).toContain("選択グリッド");
    expect(legend?.textContent).toContain("チェックボックスグリッド");
    expect(container.textContent).toContain(
      "行と列の組み合わせを1つの短いURLで安全に表現しづらいためです。",
    );
    expect(container.textContent).toContain(
      "単一選択の設問に分割するか、回答者向けの説明文で事前入力内容を伝えてください。",
    );
    expect(container.textContent).toContain(
      "この設問は生成URLに含まれません。",
    );

    act(() => root.unmount());
  });

  it("previews reflected and unreflected questions, then gives local copy feedback", async () => {
    vi.useFakeTimers();
    mocks.writeText.mockResolvedValueOnce(undefined);
    const container = document.createElement("div");
    const root = renderGenerator(container);

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="値を入力"]',
    );
    expect(nameInput).not.toBeNull();

    act(() => {
      if (nameInput) {
        fireEvent.input(nameInput, { target: { value: "Alice" } });
      }
    });

    const preview = container.querySelector(
      '[data-testid="prefill-preview-filled-questions"]',
    );
    expect(preview?.textContent).toContain("反映される設問");
    expect(preview?.textContent).toContain("氏名 (短文)");
    expect(preview?.textContent).toContain("反映されない設問");
    expect(preview?.textContent).toContain("参加枠 (選択グリッド)");
    expect(preview?.textContent).toContain(
      "必要な備品 (チェックボックスグリッド)",
    );
    expect(preview?.textContent).toContain("未対応のためURLに含まれません。");

    const generatedUrlInput =
      container.querySelector<HTMLInputElement>("input[readonly]");
    const generatedUrl = generatedUrlInput?.value;
    expect(generatedUrl).toBeDefined();
    expect(generatedUrl).toContain(
      `${window.location.origin}/forms/public/public-form-1?p=`,
    );
    const encodedPrefill = new URL(generatedUrl ?? "").searchParams.get("p");
    expect(encodedPrefill).not.toBeNull();
    expect(decodePrefillData(encodedPrefill ?? "")).toEqual({
      "q-name": { value: "Alice" },
    });

    const previewLink =
      container.querySelector<HTMLAnchorElement>('a[target="_blank"]');
    expect(previewLink?.textContent).toContain("別タブで確認");
    expect(previewLink?.href).toBe(generatedUrl);
    expect(previewLink?.rel).toContain("noreferrer");
    expect(previewLink?.rel).toContain("noopener");

    const copyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("URLをコピー"),
    );
    expect(copyButton).toBeDefined();
    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.writeText).toHaveBeenCalledWith(generatedUrl);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "プリフィルURLをコピーしました",
    );
    expect(copyButton?.textContent).toContain("コピー済み");
    const copyFeedbackButtons = container.querySelectorAll(
      "button[data-copy-status]",
    );
    expect(copyFeedbackButtons[0]?.getAttribute("data-copy-status")).toBe(
      "copied",
    );
    expect(copyFeedbackButtons[1]?.getAttribute("data-copy-status")).toBe(
      "idle",
    );

    act(() => {
      vi.advanceTimersByTime(1900);
    });
    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(copyButton?.textContent).toContain("コピー済み");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(copyButton?.textContent).toContain("URLをコピー");

    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("shows failed feedback on the clicked generated URL copy control", async () => {
    vi.useFakeTimers();
    mocks.writeText.mockRejectedValueOnce(new Error("denied"));
    const container = document.createElement("div");
    const root = renderGenerator(container);

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="値を入力"]',
    );
    act(() => {
      if (nameInput) {
        fireEvent.input(nameInput, { target: { value: "Alice" } });
      }
    });

    const previewCopyButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "コピー");
    expect(previewCopyButton).toBeDefined();

    await act(async () => {
      previewCopyButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "URLをコピーできませんでした",
    );
    expect(previewCopyButton?.textContent).toContain("コピー失敗");
    expect(previewCopyButton?.getAttribute("data-copy-status")).toBe("failed");
    expect(
      container
        .querySelector<HTMLButtonElement>("button[data-copy-status]")
        ?.getAttribute("data-copy-status"),
    ).toBe("idle");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(previewCopyButton?.textContent).toContain("コピー");
    expect(previewCopyButton?.getAttribute("data-copy-status")).toBe("idle");

    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("ignores stale copy completion after the generated URL changes", async () => {
    let resolveWriteText: (() => void) | null = null;
    mocks.writeText.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveWriteText = resolve;
      }),
    );
    const container = document.createElement("div");
    const root = renderGenerator(container);

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="値を入力"]',
    );
    act(() => {
      if (nameInput) {
        fireEvent.input(nameInput, { target: { value: "Alice" } });
      }
    });

    const generatedUrlInput =
      container.querySelector<HTMLInputElement>("input[readonly]");
    const copiedUrl = generatedUrlInput?.value;
    const copyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("URLをコピー"),
    );
    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      if (nameInput) {
        fireEvent.input(nameInput, { target: { value: "Bob" } });
      }
    });

    await act(async () => {
      resolveWriteText?.();
    });

    expect(mocks.writeText).toHaveBeenCalledWith(copiedUrl);
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(
      container
        .querySelector<HTMLButtonElement>("button[data-copy-status]")
        ?.getAttribute("data-copy-status"),
    ).toBe("idle");

    act(() => root.unmount());
  });

  it("clears copy feedback when the generated URL is removed and recreated", async () => {
    vi.useFakeTimers();
    mocks.writeText.mockResolvedValueOnce(undefined);
    const container = document.createElement("div");
    const root = renderGenerator(container);

    const nameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="値を入力"]',
    );
    expect(nameInput).not.toBeNull();

    act(() => {
      if (nameInput) {
        fireEvent.input(nameInput, { target: { value: "Alice" } });
      }
    });

    const copyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("URLをコピー"),
    );
    expect(copyButton).toBeDefined();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(copyButton?.textContent).toContain("コピー済み");
    expect(copyButton?.getAttribute("data-copy-status")).toBe("copied");

    const clearButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("クリア"),
    );
    act(() => {
      clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(
      container.querySelector('[data-testid="prefill-url-preview"]'),
    ).toBeNull();

    const recreatedNameInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="値を入力"]',
    );
    act(() => {
      if (recreatedNameInput) {
        fireEvent.input(recreatedNameInput, { target: { value: "Alice" } });
      }
    });

    const recreatedCopyButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("URLをコピー"));
    expect(recreatedCopyButton?.textContent).toContain("URLをコピー");
    expect(recreatedCopyButton?.getAttribute("data-copy-status")).toBe("idle");

    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("copies concrete guidance for unsupported grid alternatives", async () => {
    mocks.writeText.mockResolvedValueOnce(undefined);
    const container = document.createElement("div");
    const root = renderGenerator(container);

    const alternativeButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("代替案をコピー"));
    expect(alternativeButton).toBeDefined();

    await act(async () => {
      alternativeButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(mocks.writeText).toHaveBeenCalledWith(
      "行と列の組み合わせを1つの短いURLで安全に表現しづらいためです。 代替案: 単一選択の設問に分割するか、回答者向けの説明文で事前入力内容を伝えてください。",
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("代替案をコピーしました");

    act(() => root.unmount());
  });
});
