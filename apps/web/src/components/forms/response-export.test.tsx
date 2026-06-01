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

function renderExport(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<ResponseExport formId="form-1" />);
  });
  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exportGet.mockResolvedValue({
    ok: true,
    status: 200,
    blob: vi.fn().mockResolvedValue(new Blob(["csv"], { type: "text/csv" })),
  });
  URL.createObjectURL = vi.fn(() => "blob:nexus-form-csv");
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

describe("ResponseExport", () => {
  it("downloads CSV from the responses export endpoint", async () => {
    const container = document.createElement("div");
    const root = renderExport(container);
    const button = container.querySelector("button");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.exportGet).toHaveBeenCalledWith({
      param: { id: "form-1" },
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "エクスポートが完了しました",
    );
    expect(mocks.toastError).not.toHaveBeenCalled();

    act(() => root.unmount());
  });
});
