// @vitest-environment jsdom

import type { ButtonHTMLAttributes } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResponseExport } from "./response-export";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  exportGet: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        ":id": {
          responses: {
            export: {
              $get: mocks.exportGet,
            },
          },
        },
      },
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));

function renderExport(container: HTMLElement, formId = "form-1"): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<ResponseExport formId={formId} />);
  });
  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exportGet.mockResolvedValue(
    new Response("csv", {
      status: 200,
      headers: {
        "Content-Disposition": 'attachment; filename="responses-form-1.csv"',
        "Content-Type": "text/csv; charset=utf-8",
      },
    }),
  );
  URL.createObjectURL = vi.fn(() => "blob:nexus-form-csv");
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

describe("ResponseExport", () => {
  it("downloads CSV from the responses export endpoint", async () => {
    const container = document.createElement("div");
    const root = renderExport(container, "form id");
    const button = container.querySelector("button");
    const appendedAnchors: HTMLAnchorElement[] = [];
    const appendChild = vi
      .spyOn(document.body, "appendChild")
      .mockImplementation((node) => {
        if (node instanceof HTMLAnchorElement) {
          appendedAnchors.push(node);
        }
        return node;
      });

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.exportGet).toHaveBeenCalledWith({
      param: { id: "form id" },
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(appendedAnchors[0]?.download).toBe("responses-form-1.csv");
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "すべての回答CSVを生成しました。ダウンロードを開始します。",
    );
    expect(mocks.toastError).not.toHaveBeenCalled();

    appendChild.mockRestore();
    act(() => root.unmount());
  });

  it("shows loading state until the CSV blob is ready", async () => {
    const container = document.createElement("div");
    let resolveResponse: (response: Response) => void = () => {};
    mocks.exportGet.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    );
    const root = renderExport(container);
    const button = container.querySelector("button");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain("CSV生成中...");

    await act(async () => {
      resolveResponse(
        new Response("csv", {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
          },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(button?.disabled).toBe(false);
    expect(button?.textContent).toContain("CSVエクスポート");

    act(() => root.unmount());
  });

  it("shows the API error body when CSV export fails", async () => {
    const container = document.createElement("div");
    mocks.exportGet.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Response export is limited to 5000 responses",
        }),
        {
          status: 413,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    const root = renderExport(container);
    const button = container.querySelector("button");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Response export is limited to 5000 responses",
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();

    act(() => root.unmount());
  });
});
