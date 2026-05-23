// @vitest-environment jsdom

import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { useGoogleOAuth } from "./use-google-oauth";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/lib/logger", () => ({
  logError: mocks.logError,
}));

vi.mock("@/lib/api", () => ({
  apiUrl: (path: string) => `http://api.test${path}`,
  baseUrl: "http://api.test",
}));

function renderWithClient(children: ReactNode): {
  client: QueryClient;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(container);

  act(() => {
    root.render(
      <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    );
  });

  return { client, root };
}

function HookHarness({
  onReady,
}: {
  onReady: (value: ReturnType<typeof useGoogleOAuth>) => void;
}): null {
  const queryClient = useQueryClient();
  const value = useGoogleOAuth({ queryClient });
  onReady(value);
  return null;
}

describe("useGoogleOAuth", () => {
  let openSpy: MockInstance<typeof window.open>;
  let authWindow: {
    closed: boolean;
    close: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authWindow = {
      closed: false,
      close: vi.fn(() => {
        authWindow.closed = true;
      }),
    };
    openSpy = vi
      .spyOn(window, "open")
      .mockReturnValue(authWindow as unknown as Window);
  });

  afterEach(() => {
    openSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("opens the authorize popup with app_origin", async () => {
    let handleConnect: (() => Promise<void>) | undefined;

    const { root } = renderWithClient(
      <HookHarness
        onReady={(value) => {
          handleConnect = value.handleConnect;
        }}
      />,
    );

    await act(async () => {
      await handleConnect?.();
    });

    expect(openSpy).toHaveBeenCalledWith(
      "http://api.test/api/integrations/google/authorize?app_origin=http%3A%2F%2Flocalhost%3A3000",
      expect.stringMatching(/^GoogleAuth_\d+$/),
      expect.stringContaining("width=600"),
    );

    act(() => {
      root.unmount();
    });
  });

  it("shows an error when the popup is blocked", async () => {
    openSpy.mockReturnValue(null);
    let handleConnect: (() => Promise<void>) | undefined;

    const { root } = renderWithClient(
      <HookHarness
        onReady={(value) => {
          handleConnect = value.handleConnect;
        }}
      />,
    );

    await act(async () => {
      await handleConnect?.();
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "ポップアップを開けませんでした。ブラウザ設定を確認してください。",
    );

    act(() => {
      root.unmount();
    });
  });

  it("invalidates google queries after a success postMessage", async () => {
    let handleConnect: (() => Promise<void>) | undefined;
    const { client, root } = renderWithClient(
      <HookHarness
        onReady={(value) => {
          handleConnect = value.handleConnect;
        }}
      />,
    );
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    await act(async () => {
      await handleConnect?.();
    });

    await act(async () => {
      const event = new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          source: "google-oauth",
          status: "success",
        },
      });
      Object.defineProperty(event, "source", {
        configurable: true,
        value: authWindow,
      });
      window.dispatchEvent(event);
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Googleアカウントに接続しました",
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["google-connection"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["spreadsheets"],
    });
    expect(authWindow.close).toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("shows the default error toast when OAuth postMessage reports failure", async () => {
    let handleConnect: (() => Promise<void>) | undefined;

    const { root } = renderWithClient(
      <HookHarness
        onReady={(value) => {
          handleConnect = value.handleConnect;
        }}
      />,
    );

    await act(async () => {
      await handleConnect?.();
    });

    await act(async () => {
      const event = new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          source: "google-oauth",
          status: "error",
        },
      });
      Object.defineProperty(event, "source", {
        configurable: true,
        value: authWindow,
      });
      window.dispatchEvent(event);
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "Google連携に失敗しました。再度お試しください。",
    );

    act(() => {
      root.unmount();
    });
  });

  it("shows a custom error message from OAuth postMessage", async () => {
    let handleConnect: (() => Promise<void>) | undefined;

    const { root } = renderWithClient(
      <HookHarness
        onReady={(value) => {
          handleConnect = value.handleConnect;
        }}
      />,
    );

    await act(async () => {
      await handleConnect?.();
    });

    await act(async () => {
      const event = new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          source: "google-oauth",
          status: "error",
          message: "アクセスが拒否されました",
        },
      });
      Object.defineProperty(event, "source", {
        configurable: true,
        value: authWindow,
      });
      window.dispatchEvent(event);
    });

    expect(mocks.toastError).toHaveBeenCalledWith("アクセスが拒否されました");

    act(() => {
      root.unmount();
    });
  });
});
