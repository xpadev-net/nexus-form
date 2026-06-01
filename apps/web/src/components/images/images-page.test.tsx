// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImagesPage } from "./images-page";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const apiMocks = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  listMock: vi.fn(),
  moveMock: vi.fn(),
  presignedUploadMock: vi.fn(),
  uploadCompleteMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  client: {
    api: {
      s3: {
        delete: { $delete: apiMocks.deleteMock },
        list: { $get: apiMocks.listMock },
        move: { $post: apiMocks.moveMock },
        "presigned-upload": { $post: apiMocks.presignedUploadMock },
        "upload-complete": { $post: apiMocks.uploadCompleteMock },
      },
    },
  },
}));

type JsonResponseBody = Record<string, unknown>;

function okJson(body: JsonResponseBody) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(body),
  };
}

function errorJson(body: JsonResponseBody) {
  return {
    ok: false,
    json: vi.fn().mockResolvedValue(body),
  };
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await Promise.resolve();
      });
    }
  }
  throw lastError;
}

function findButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === label,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`);
  }
  return button;
}

function findFileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("File input not found");
  }
  return input;
}

function requireCallOrder(order: number | undefined): number {
  if (order === undefined) {
    throw new Error("Expected mock invocation order to exist");
  }
  return order;
}

async function renderImagesPage(root: Root, container: HTMLElement) {
  act(() => {
    root.render(<ImagesPage />);
  });
  await waitForAssertion(() => {
    expect(apiMocks.listMock).toHaveBeenCalled();
  });
  await waitForAssertion(() => {
    expect(container.textContent).not.toContain("読み込み中...");
  });
}

describe("ImagesPage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("moves an uploaded tmp object to prod before refreshing the prod image list", async () => {
    const image = {
      key: "prod/users/user-a/upload.jpg",
      name: "upload.jpg",
      size: 5,
      lastModified: null,
      url: "prod/users/user-a/upload.jpg",
    };
    apiMocks.listMock
      .mockResolvedValueOnce(okJson({ success: true, data: { images: [] } }))
      .mockResolvedValueOnce(
        okJson({ success: true, data: { images: [image] } }),
      );
    apiMocks.presignedUploadMock.mockResolvedValue(
      okJson({
        success: true,
        data: {
          presignedUrl: "https://s3.example.com/tmp-upload",
          key: "tmp/users/user-a/upload.jpg",
        },
      }),
    );
    apiMocks.uploadCompleteMock.mockResolvedValue(
      okJson({ success: true, data: { key: "tmp/users/user-a/upload.jpg" } }),
    );
    apiMocks.moveMock.mockResolvedValue(
      okJson({
        success: true,
        data: {
          key: "prod/users/user-a/upload.jpg",
          bucket: "prod-bucket",
          url: "",
          size: 5,
          contentType: "image/jpeg",
        },
      }),
    );

    await renderImagesPage(root, container);

    const file = new File(["image"], "upload.jpg", { type: "image/jpeg" });
    Object.defineProperty(findFileInput(container), "files", {
      value: [file],
      configurable: true,
    });
    act(() => {
      findFileInput(container).dispatchEvent(
        new Event("change", { bubbles: true }),
      );
    });

    await act(async () => {
      findButton(container, "アップロード").click();
    });

    await waitForAssertion(() => {
      expect(apiMocks.moveMock).toHaveBeenCalledOnce();
      expect(apiMocks.listMock).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain("upload.jpg");
    });

    expect(apiMocks.listMock).toHaveBeenNthCalledWith(1, {
      query: { bucket: "prod" },
    });
    expect(apiMocks.listMock).toHaveBeenNthCalledWith(2, {
      query: { bucket: "prod" },
    });
    expect(apiMocks.presignedUploadMock).toHaveBeenCalledWith({
      json: {
        fileName: "upload.jpg",
        fileSize: file.size,
        mimeType: "image/jpeg",
      },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://s3.example.com/tmp-upload",
      {
        method: "PUT",
        body: file,
        headers: { "content-type": "image/jpeg" },
      },
    );
    expect(apiMocks.uploadCompleteMock).toHaveBeenCalledWith({
      json: {
        key: "tmp/users/user-a/upload.jpg",
        bucket: "tmp",
        size: file.size,
        contentType: "image/jpeg",
      },
    });
    expect(apiMocks.moveMock).toHaveBeenCalledWith({
      json: { tmpKey: "tmp/users/user-a/upload.jpg" },
    });

    const uploadCompleteOrder = requireCallOrder(
      apiMocks.uploadCompleteMock.mock.invocationCallOrder[0],
    );
    const moveOrder = requireCallOrder(
      apiMocks.moveMock.mock.invocationCallOrder[0],
    );
    const secondListOrder = requireCallOrder(
      apiMocks.listMock.mock.invocationCallOrder[1],
    );
    expect(uploadCompleteOrder).toBeLessThan(moveOrder);
    expect(moveOrder).toBeLessThan(secondListOrder);
  });

  it("does not refresh the prod image list when prod promotion fails", async () => {
    apiMocks.listMock.mockResolvedValue(
      okJson({ success: true, data: { images: [] } }),
    );
    apiMocks.presignedUploadMock.mockResolvedValue(
      okJson({
        success: true,
        data: {
          presignedUrl: "https://s3.example.com/tmp-upload",
          key: "tmp/users/user-a/upload.jpg",
        },
      }),
    );
    apiMocks.uploadCompleteMock.mockResolvedValue(
      okJson({ success: true, data: { key: "tmp/users/user-a/upload.jpg" } }),
    );
    apiMocks.moveMock.mockResolvedValue(errorJson({ error: "move failed" }));

    await renderImagesPage(root, container);
    const file = new File(["image"], "upload.jpg", { type: "image/jpeg" });
    Object.defineProperty(findFileInput(container), "files", {
      value: [file],
      configurable: true,
    });
    act(() => {
      findFileInput(container).dispatchEvent(
        new Event("change", { bubbles: true }),
      );
    });

    await act(async () => {
      findButton(container, "アップロード").click();
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("画像の移動に失敗しました");
    });
    expect(apiMocks.listMock).toHaveBeenCalledOnce();
  });

  it("does not refresh the prod image list when move returns a non-prod key", async () => {
    apiMocks.listMock.mockResolvedValue(
      okJson({ success: true, data: { images: [] } }),
    );
    apiMocks.presignedUploadMock.mockResolvedValue(
      okJson({
        success: true,
        data: {
          presignedUrl: "https://s3.example.com/tmp-upload",
          key: "tmp/users/user-a/upload.jpg",
        },
      }),
    );
    apiMocks.uploadCompleteMock.mockResolvedValue(
      okJson({ success: true, data: { key: "tmp/users/user-a/upload.jpg" } }),
    );
    apiMocks.moveMock.mockResolvedValue(
      okJson({
        success: true,
        data: {
          key: "tmp/users/user-a/upload.jpg",
          bucket: "tmp-bucket",
          url: "",
          size: 5,
          contentType: "image/jpeg",
        },
      }),
    );

    await renderImagesPage(root, container);
    const file = new File(["image"], "upload.jpg", { type: "image/jpeg" });
    Object.defineProperty(findFileInput(container), "files", {
      value: [file],
      configurable: true,
    });
    act(() => {
      findFileInput(container).dispatchEvent(
        new Event("change", { bubbles: true }),
      );
    });

    await act(async () => {
      findButton(container, "アップロード").click();
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("画像の本番反映に失敗しました");
    });
    expect(apiMocks.listMock).toHaveBeenCalledOnce();
  });

  it("shows the prod reflection error when move omits the prod key", async () => {
    apiMocks.listMock.mockResolvedValue(
      okJson({ success: true, data: { images: [] } }),
    );
    apiMocks.presignedUploadMock.mockResolvedValue(
      okJson({
        success: true,
        data: {
          presignedUrl: "https://s3.example.com/tmp-upload",
          key: "tmp/users/user-a/upload.jpg",
        },
      }),
    );
    apiMocks.uploadCompleteMock.mockResolvedValue(
      okJson({ success: true, data: { key: "tmp/users/user-a/upload.jpg" } }),
    );
    apiMocks.moveMock.mockResolvedValue(
      okJson({
        success: true,
        data: null,
      }),
    );

    await renderImagesPage(root, container);
    const file = new File(["image"], "upload.jpg", { type: "image/jpeg" });
    Object.defineProperty(findFileInput(container), "files", {
      value: [file],
      configurable: true,
    });
    act(() => {
      findFileInput(container).dispatchEvent(
        new Event("change", { bubbles: true }),
      );
    });

    await act(async () => {
      findButton(container, "アップロード").click();
    });

    await waitForAssertion(() => {
      expect(container.textContent).toContain("画像の本番反映に失敗しました");
    });
    expect(apiMocks.listMock).toHaveBeenCalledOnce();
  });

  it("deletes prod-listed images from the prod bucket and refreshes the list", async () => {
    const image = {
      key: "prod/users/user-a/upload.jpg",
      name: "upload.jpg",
      size: 5,
      lastModified: null,
      url: "prod/users/user-a/upload.jpg",
    };
    apiMocks.listMock
      .mockResolvedValueOnce(
        okJson({ success: true, data: { images: [image] } }),
      )
      .mockResolvedValueOnce(okJson({ success: true, data: { images: [] } }));
    apiMocks.deleteMock.mockResolvedValue(
      okJson({ success: true, message: "Object deleted successfully" }),
    );

    await renderImagesPage(root, container);
    expect(container.textContent).toContain("upload.jpg");

    await act(async () => {
      findButton(container, "削除").click();
    });

    await waitForAssertion(() => {
      expect(apiMocks.deleteMock).toHaveBeenCalledOnce();
      expect(apiMocks.listMock).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain("画像はまだありません。");
    });

    expect(apiMocks.deleteMock).toHaveBeenCalledWith({
      json: {
        key: "prod/users/user-a/upload.jpg",
        bucket: "prod",
      },
    });
  });
});
