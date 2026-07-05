// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPublicFormUrl } from "@/lib/forms/public-url";
import { FormPublicUrlSettings } from "./form-public-url-settings";

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

function renderSettings(
  container: HTMLElement,
  publicId: string | null = null,
): {
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
  queryClient.setQueryData(["formDetail", "form-1"], {
    form: { id: "form-1", publicId },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <FormPublicUrlSettings formId="form-1" publicId={publicId} />
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
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: undefined,
    });
  });

  it("builds a public form URL from the current origin", () => {
    expect(buildPublicFormUrl("new-public-id")).toBe(
      `${window.location.origin}/forms/public/new-public-id`,
    );
  });

  it("keeps the current public URL visible and copyable before regeneration", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { root } = renderSettings(container, "current-public-id");

    const expectedUrl = buildPublicFormUrl("current-public-id");
    const urlInput = document.querySelector("#current-public-url");
    expect(urlInput).toBeInstanceOf(HTMLInputElement);
    expect((urlInput as HTMLInputElement).value).toBe(expectedUrl);
    expect(document.body.textContent).toContain(
      "回答者へ共有する公開フォームの URL です。",
    );

    const copyButton = document.querySelector(
      'button[aria-label="現在の公開 URL をコピー"]',
    );
    if (!(copyButton instanceof HTMLButtonElement)) {
      throw new Error("Current URL copy button not found");
    }
    await click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedUrl);
    expect(copyButton.getAttribute("aria-label")).toBe(
      "現在の公開 URL をコピーしました",
    );
    expect(copyButton.title).toBe("現在の公開 URL をコピーしました");
    expect(apiMocks.toastSuccess).toHaveBeenCalledWith(
      "公開 URL をコピーしました",
    );

    act(() => root.unmount());
  });

  it("confirms impact, regenerates the public URL, and exposes a copy action", async () => {
    apiMocks.regeneratePost.mockReturnValue("regenerate-response");
    apiMocks.rpc.mockResolvedValue({ publicId: "new-public-id" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { queryClient, root } = renderSettings(container, "old-public-id");

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
      "公開 URL を再生成しました。旧 URL は無効になり、既存の回答は保持されています。",
    );
    expect(
      queryClient.getQueryData<{ form: { publicId: string } }>([
        "formDetail",
        "form-1",
      ])?.form.publicId,
    ).toBe("new-public-id");
    expect(
      (document.querySelector("#current-public-url") as HTMLInputElement).value,
    ).toBe(expectedUrl);
    expect(document.body.textContent).toContain("旧 URL は無効です。");
    expect(document.body.textContent).toContain(
      "既存の回答は保持されています。",
    );

    const copyButton = document.querySelector(
      'button[aria-label="新しい公開 URL をコピー"]',
    );
    if (!(copyButton instanceof HTMLButtonElement)) {
      throw new Error("Copy button not found");
    }
    await click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedUrl);
    expect(copyButton.getAttribute("aria-label")).toBe(
      "新しい公開 URL をコピーしました",
    );
    expect(copyButton.title).toBe("新しい公開 URL をコピーしました");
    expect(apiMocks.toastSuccess).toHaveBeenCalledWith(
      "新しい公開 URL をコピーしました",
    );

    act(() => root.unmount());
  });

  it("keeps the textarea copy fallback when clipboard write rejects", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("clipboard denied")),
      },
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const { root } = renderSettings(container, "fallback-public-id");

    const copyButton = document.querySelector(
      'button[aria-label="現在の公開 URL をコピー"]',
    );
    if (!(copyButton instanceof HTMLButtonElement)) {
      throw new Error("Current URL copy button not found");
    }
    await click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      buildPublicFormUrl("fallback-public-id"),
    );
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copyButton.getAttribute("aria-label")).toBe(
      "現在の公開 URL をコピーしました",
    );
    expect(apiMocks.toastSuccess).toHaveBeenCalledWith(
      "公開 URL をコピーしました",
    );

    act(() => root.unmount());
  });

  it("does not carry a regenerated URL into another form when the editor route changes", async () => {
    apiMocks.regeneratePost.mockReturnValue("regenerate-response");
    apiMocks.rpc.mockResolvedValue({ publicId: "form-a-new-public-id" });
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <FormPublicUrlSettings formId="form-a" publicId="form-a-old" />
        </QueryClientProvider>,
      );
    });

    await click(getButton("公開 URL を再生成"));
    await click(getButton("再生成する"));
    expect(
      (document.querySelector("#current-public-url") as HTMLInputElement).value,
    ).toBe(buildPublicFormUrl("form-a-new-public-id"));

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <FormPublicUrlSettings formId="form-b" publicId="form-b-public-id" />
        </QueryClientProvider>,
      );
    });

    expect(
      (document.querySelector("#current-public-url") as HTMLInputElement).value,
    ).toBe(buildPublicFormUrl("form-b-public-id"));
    expect(document.querySelector("#regenerated-public-url")).toBeNull();

    act(() => root.unmount());
  });
});
