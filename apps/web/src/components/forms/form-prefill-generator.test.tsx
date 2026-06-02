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

  it("previews and copies only supported questions when unsupported questions remain in the form", async () => {
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
    expect(preview?.textContent).toContain("以下の設問だけに初期値が入ります");
    expect(preview?.textContent).toContain("氏名 (短文)");
    expect(preview?.textContent).not.toContain("参加枠");
    expect(preview?.textContent).not.toContain("必要な備品");
    expect(preview?.textContent).toContain(
      "未対応設問はURLに含まれず、回答者がフォーム上で入力します。",
    );

    const generatedUrl =
      container.querySelector<HTMLInputElement>("input[readonly]")?.value;
    expect(generatedUrl).toBeDefined();
    const encodedPrefill = new URL(generatedUrl ?? "").searchParams.get("p");
    expect(encodedPrefill).not.toBeNull();
    expect(decodePrefillData(encodedPrefill ?? "")).toEqual({
      "q-name": { value: "Alice" },
    });

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

    act(() => root.unmount());
  });
});
