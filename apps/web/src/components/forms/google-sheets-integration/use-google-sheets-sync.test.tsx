// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncJobStatusResponse } from "@/types/integrations/google-sheets";
import type { UiSyncState } from "./types";
import {
  buildUiSyncState,
  getSyncStatusTransition,
  useGoogleSheetsSync,
} from "./use-google-sheets-sync";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  fetchJson: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/fetch-json", () => {
  class HttpError extends Error {
    status: number;
    body?: unknown;

    constructor(status: number, message: string, body?: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }

  return {
    fetchJson: mocks.fetchJson,
    HttpError,
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

function jobStatus(
  state: SyncJobStatusResponse["job"]["state"],
  progress: SyncJobStatusResponse["job"]["progress"] = null,
  failedReason = "failed reason",
): SyncJobStatusResponse {
  return {
    job: {
      attemptsMade: 0,
      failedReason: state === "failed" ? failedReason : undefined,
      name: "google-sheets-sync",
      progress,
      result: state === "completed" ? { updatedRows: 3 } : null,
      state,
    },
  };
}

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
  onState,
}: {
  onState: (state: ReturnType<typeof useGoogleSheetsSync>) => void;
}): null {
  const state = useGoogleSheetsSync({
    configQueryKey: ["google-sheets-config", "form-1"],
    formId: "form-1",
  });

  useEffect(() => {
    onState(state);
  }, [onState, state]);

  return null;
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useGoogleSheetsSync transitions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.fetchJson.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  it("emits a completed finish transition only once for the same job", () => {
    const completed = buildUiSyncState(jobStatus("completed"), "job-1");
    const first = getSyncStatusTransition(null, completed, null);

    expect(first.action).toEqual({ type: "finish", status: completed });
    expect(first.notifyStatus).toBe("completed");

    const second = getSyncStatusTransition(completed, completed, {
      jobId: "job-1",
      status: "completed",
    });

    expect(second.action).toBeNull();
    expect(second.notifyStatus).toBeNull();
  });

  it("normalizes stale completed progress to 100 percent", () => {
    const completed = buildUiSyncState(
      jobStatus("completed", { processed: 4, total: 10, percentage: 40 }),
      "job-1",
    );

    expect(completed).toEqual(
      expect.objectContaining({
        progress: {
          processed: 4,
          total: 10,
          percentage: 100,
        },
        status: "completed",
      }),
    );
  });

  it("skips update transitions when queued progress has not changed", () => {
    const previous: UiSyncState = {
      jobId: "job-1",
      progress: { processed: 1, total: 5, percentage: 20 },
      status: "processing",
    };
    const unchanged = buildUiSyncState(
      jobStatus("active", { processed: 1, total: 5, percentage: 20 }),
      "job-1",
    );

    const transition = getSyncStatusTransition(previous, unchanged, null);

    expect(transition.action).toBeNull();
    expect(transition.notifyStatus).toBeNull();
  });

  it("emits update transitions when progress changes", () => {
    const previous: UiSyncState = {
      jobId: "job-1",
      progress: { processed: 1, total: 5, percentage: 20 },
      status: "processing",
    };
    const changed = buildUiSyncState(
      jobStatus("active", { processed: 2, total: 5, percentage: 40 }),
      "job-1",
    );

    const transition = getSyncStatusTransition(previous, changed, null);

    expect(transition.action).toEqual({ type: "update", status: changed });
    expect(transition.notifyStatus).toBeNull();
  });

  it("notifies completion once and removes the finished job query", async () => {
    mocks.fetchJson.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({ jobId: "job-1", status: "queued" });
      }
      return new Promise(() => {});
    });
    const states: ReturnType<typeof useGoogleSheetsSync>[] = [];
    const { client, root } = renderWithClient(
      <HookHarness onState={(state) => states.push(state)} />,
    );
    const removeQueries = vi.spyOn(client, "removeQueries");

    await act(async () => {
      await states.at(-1)?.startSync("incremental");
    });
    await flushPromises();

    act(() => {
      client.setQueryData(
        ["syncJobStatus", "form-1", "job-1"],
        jobStatus("completed"),
      );
      vi.advanceTimersByTime(0);
    });
    await flushPromises();

    expect(mocks.toastSuccess).toHaveBeenCalledWith("同期を開始しました");
    expect(mocks.toastSuccess).toHaveBeenCalledWith("同期が完了しました");
    expect(
      mocks.toastSuccess.mock.calls.filter(
        ([message]) => message === "同期が完了しました",
      ),
    ).toHaveLength(1);
    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: ["syncJobStatus", "form-1", "job-1"],
    });

    act(() => {
      client.setQueryData(
        ["syncJobStatus", "form-1", "job-1"],
        jobStatus("completed"),
      );
      vi.advanceTimersByTime(0);
    });
    await flushPromises();

    expect(
      mocks.toastSuccess.mock.calls.filter(
        ([message]) => message === "同期が完了しました",
      ),
    ).toHaveLength(1);

    act(() => root.unmount());
  });

  it("notifies failure once and removes the failed job query", async () => {
    mocks.fetchJson.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({ jobId: "job-1", status: "queued" });
      }
      return new Promise(() => {});
    });
    const states: ReturnType<typeof useGoogleSheetsSync>[] = [];
    const { client, root } = renderWithClient(
      <HookHarness onState={(state) => states.push(state)} />,
    );
    const removeQueries = vi.spyOn(client, "removeQueries");

    await act(async () => {
      await states.at(-1)?.startSync("incremental");
    });
    await flushPromises();

    act(() => {
      client.setQueryData(
        ["syncJobStatus", "form-1", "job-1"],
        jobStatus("failed"),
      );
      vi.advanceTimersByTime(0);
    });
    await flushPromises();

    expect(mocks.toastError).toHaveBeenCalledWith("同期に失敗しました");
    expect(
      mocks.toastError.mock.calls.filter(
        ([message]) => message === "同期に失敗しました",
      ),
    ).toHaveLength(1);
    expect(removeQueries).toHaveBeenCalledWith({
      queryKey: ["syncJobStatus", "form-1", "job-1"],
    });

    act(() => {
      client.setQueryData(
        ["syncJobStatus", "form-1", "job-1"],
        jobStatus("failed"),
      );
      vi.advanceTimersByTime(0);
    });
    await flushPromises();

    expect(
      mocks.toastError.mock.calls.filter(
        ([message]) => message === "同期に失敗しました",
      ),
    ).toHaveLength(1);

    act(() => root.unmount());
  });

  it("parses AUTH_REQUIRED sync error into structured status", () => {
    const state = buildUiSyncState(
      jobStatus("failed", null, "AUTH_REQUIRED: OAuth token not found"),
      "job-1",
    );

    expect(state).toEqual(
      expect.objectContaining({
        errorCode: "AUTH_REQUIRED",
        error: "OAuth token not found",
        status: "failed",
      }),
    );
  });

  it("clears syncing state when the monitor times out", async () => {
    mocks.fetchJson.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({ jobId: "job-1", status: "queued" });
      }
      return new Promise(() => {});
    });
    const states: ReturnType<typeof useGoogleSheetsSync>[] = [];
    const { root } = renderWithClient(
      <HookHarness onState={(state) => states.push(state)} />,
    );

    await act(async () => {
      await states.at(-1)?.startSync("incremental");
    });

    expect(states.at(-1)?.isSyncing).toBe(true);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(mocks.toastError).toHaveBeenCalledWith(
      "同期状態の監視がタイムアウトしました",
    );
    expect(states.at(-1)?.isSyncing).toBe(false);
    expect(states.at(-1)?.syncStatus).toBeNull();

    act(() => root.unmount());
  });

  it("starts incremental sync with the explicit mode contract", async () => {
    mocks.fetchJson.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({ jobId: "incremental-job", status: "queued" });
      }
      return new Promise(() => {});
    });
    const states: ReturnType<typeof useGoogleSheetsSync>[] = [];
    const { root } = renderWithClient(
      <HookHarness onState={(state) => states.push(state)} />,
    );

    await act(async () => {
      await states.at(-1)?.startSync("incremental");
    });
    await flushPromises();

    const startRequests = mocks.fetchJson.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    expect(startRequests).toHaveLength(1);
    expect(JSON.parse(String(startRequests[0]?.[1]?.body))).toEqual({
      mode: "incremental",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("同期を開始しました");
    expect(states.at(-1)?.activeJobId).toBe("incremental-job");

    act(() => root.unmount());
  });

  it("starts full sync with the explicit mode contract", async () => {
    mocks.fetchJson.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve({ jobId: "full-job", status: "queued" });
      }
      return new Promise(() => {});
    });
    const states: ReturnType<typeof useGoogleSheetsSync>[] = [];
    const { root } = renderWithClient(
      <HookHarness onState={(state) => states.push(state)} />,
    );

    await act(async () => {
      await states.at(-1)?.startSync("full");
    });
    await flushPromises();

    const startRequests = mocks.fetchJson.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    expect(startRequests).toHaveLength(1);
    expect(JSON.parse(String(startRequests[0]?.[1]?.body))).toEqual({
      mode: "full",
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("同期を開始しました");
    expect(states.at(-1)?.activeJobId).toBe("full-job");

    act(() => root.unmount());
  });
});
