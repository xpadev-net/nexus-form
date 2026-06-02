// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPublicFormUrl,
  FormPublicUrlSettings,
} from "./form-public-url-settings";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const apiMocks = vi.hoisted(() => ({
  regeneratePost: vi.fn(),
  rpc: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        ":id": {
          "regenerate-public-url": {
            $post: apiMocks.regeneratePost,
          },
        },
      },
    },
  },
  rpc: apiMocks.rpc,
}));

vi.mock("sonner", () => ({
  toast: {
    error: apiMocks.toastError,
    success: apiMocks.toastSuccess,
  },
}));

function renderSettings(container: HTMLElement): {
  queryClient: QueryClient;
  root: Root;
} {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const root = createRoot(container);
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <FormPublicUrlSettings formId="form-1" />
      </QueryClientProvider>,
    );
  });
  return { queryClient, root };
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function getButton(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(name),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${name}`);
  }
  return button;
}

describe("FormPublicUrlSettings", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    apiMocks.regeneratePost.mockReset();
    apiMocks.rpc.mockReset();
    apiMocks.toastError.mockReset();
    apiMocks.toastSuccess.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("builds a public form URL from the current origin", () => {
    expect(buildPublicFormUrl("new-public-id")).toBe(
      `${window.location.origin}/forms/public/new-public-id`,
    );
  });

  it("confirms impact, regenerates the public URL, and exposes a copy action", async () => {
    apiMocks.regeneratePost.mockReturnValue("regenerate-response");
    apiMocks.rpc.mockResolvedValue({ publicId: "new-public-id" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { root } = renderSettings(container);

    await click(getButton("公開 URL を再生成"));

    expect(document.body.textContent).toContain(
      "現在の公開 URL は無効になり、旧 URL からは回答できなくなります。",
    );
    expect(document.body.textContent).toContain(
      "既存の回答は保持されますが、新しい URL を共有先へ再配布する必要があります。",
    );

    await click(getButton("再生成する"));

    expect(apiMocks.regeneratePost).toHaveBeenCalledWith({
      param: { id: "form-1" },
    });
    expect(apiMocks.rpc).toHaveBeenCalledWith("regenerate-response");
    const expectedUrl = `${window.location.origin}/forms/public/new-public-id`;
    const urlInput = document.querySelector("#regenerated-public-url");
    expect(urlInput).toBeInstanceOf(HTMLInputElement);
    expect((urlInput as HTMLInputElement).value).toBe(expectedUrl);
    expect(apiMocks.toastSuccess).toHaveBeenCalledWith(
      "公開 URL を再生成しました",
    );

    const copyButton = document.querySelector(
      'button[aria-label="新しい公開 URL をコピー"]',
    );
    if (!(copyButton instanceof HTMLButtonElement)) {
      throw new Error("Copy button not found");
    }
    await click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedUrl);
    expect(apiMocks.toastSuccess).toHaveBeenCalledWith(
      "新しい公開 URL をコピーしました",
    );

    act(() => root.unmount());
  });
});
