// @vitest-environment jsdom

import { act, type ReactNode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type UseFormContentAutosaveReturn,
  useFormContentAutosave,
} from "./use-form-content-autosave";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const invalidateQueriesMock = vi.fn();
const setQueryDataMock = vi.fn();
const mutateMock = vi.fn();
const refetchMock = vi.fn().mockResolvedValue(undefined);
const { MockRpcError, putContentMock, rpcMock, toastWarningMock } = vi.hoisted(
  () => {
    class MockRpcError extends Error {
      status: number;

      constructor(status: number) {
        super("rpc error");
        this.status = status;
      }
    }

    return {
      MockRpcError,
      putContentMock: vi.fn((input: unknown) => input),
      rpcMock: vi.fn(),
      toastWarningMock: vi.fn(),
    };
  },
);

interface TestMutationVariables {
  expectedVersion: number;
  plateContent: string;
  restoreGeneration: number;
}

interface TestMutationOptions {
  onSuccess?: (data: unknown, variables: TestMutationVariables) => void;
}

let latestMutationOptions: TestMutationOptions | undefined;

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: TestMutationOptions) => {
    latestMutationOptions = options;
    return {
      mutate: mutateMock,
    };
  },
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
    setQueryData: setQueryDataMock,
  }),
}));

vi.mock("@/hooks/forms/use-editor-sse", () => ({
  useEditorSSE: vi.fn(),
}));

vi.mock("@/hooks/forms/use-plate-merge", () => ({
  usePlateMerge: () => ({
    attemptMerge: vi.fn(),
    conflictState: null,
    dismissConflict: vi.fn(),
    isMerging: false,
    isMergingRef: { current: false },
    resetMergeState: vi.fn(),
    resolveConflicts: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  baseUrl: "http://localhost:3001",
  client: {
    api: {
      forms: {
        ":id": {
          content: {
            $put: putContentMock,
          },
        },
      },
    },
  },
  RpcError: MockRpcError,
  rpc: rpcMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: toastWarningMock,
  },
}));

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

function renderAutosave(onReady: (hook: UseFormContentAutosaveReturn) => void) {
  const container = document.createElement("div");
  const root = createRoot(container);

  function Harness({ children }: { children?: ReactNode }) {
    const didNotifyReadyRef = useRef(false);
    const hook = useFormContentAutosave({
      contentData: { plateContent: "[]", plateContentVersion: 7 },
      contentRefetch: refetchMock,
      formId: "form-1",
      getActiveTab: () => "editor",
    });

    useEffect(() => {
      if (didNotifyReadyRef.current) return;
      didNotifyReadyRef.current = true;
      onReady(hook);
    }, [hook]);

    return <>{children}</>;
  }

  act(() => {
    root.render(<Harness />);
  });

  return root;
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("useFormContentAutosave unmount keepalive fallback", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    invalidateQueriesMock.mockClear();
    setQueryDataMock.mockClear();
    mutateMock.mockClear();
    putContentMock.mockClear();
    refetchMock.mockClear();
    rpcMock.mockReset();
    toastWarningMock.mockClear();
    latestMutationOptions = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps a pending save when keepalive fetch returns a non-2xx response", async () => {
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });

    act(() => {
      hook?.handleContentChange(draftContent);
    });
    act(() => {
      root.unmount();
    });
    await flushPromises();

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:3001/api/forms/form-1/content",
    );
    expect(requestInit).toEqual(
      expect.objectContaining({
        keepalive: true,
        method: "PUT",
      }),
    );
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      expectedVersion: 7,
      plateContent: draftContent,
    });
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: draftContent,
    });
  });

  it("keeps a pending save when keepalive fetch rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });

    act(() => {
      hook?.handleContentChange('[{"type":"p","children":[{"text":"draft"}]}]');
    });
    act(() => {
      root.unmount();
    });
    await flushPromises();

    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
    });
  });

  it("does not keep a pending save when keepalive fetch succeeds", async () => {
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    localStorage.setItem(
      "pendingSave:form-1",
      JSON.stringify({
        expectedVersion: 7,
        plateContent: draftContent,
        retryBlocked: "conflict",
      }),
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });

    expect(rpcMock).not.toHaveBeenCalled();
    expect(toastWarningMock).not.toHaveBeenCalled();

    act(() => {
      hook?.handleContentChange(draftContent);
    });
    act(() => {
      root.unmount();
    });
    await flushPromises();

    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();
  });

  it("keeps a pending save without retry loops when retrying it on mount fails with a conflict", async () => {
    const pendingSave = JSON.stringify({
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
    });
    localStorage.setItem("pendingSave:form-1", pendingSave);
    rpcMock.mockRejectedValue(new MockRpcError(409));

    const root = renderAutosave(() => {});
    await flushPromises();

    expect(rpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        json: {
          expectedVersion: 7,
          plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
        },
      }),
    );
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      retryBlocked: "conflict",
    });
    expect(toastWarningMock).toHaveBeenCalledWith(
      expect.stringContaining("競合"),
    );
    expect(toastWarningMock).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });

    rpcMock.mockClear();
    toastWarningMock.mockClear();

    const retryBlockedRoot = renderAutosave(() => {});
    await flushPromises();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(toastWarningMock).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      retryBlocked: "conflict",
    });

    act(() => {
      retryBlockedRoot.unmount();
    });
  });

  it("does not throw when pending save storage cannot be read on mount", async () => {
    const removeItemMock = vi.fn();
    vi.stubGlobal("localStorage", {
      ...createMemoryStorage(),
      getItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      removeItem: removeItemMock,
    });

    const root = renderAutosave(() => {});
    await flushPromises();

    expect(removeItemMock).toHaveBeenCalledWith("pendingSave:form-1");
    expect(rpcMock).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("keeps the pending save when retrying it on mount fails transiently", async () => {
    const pendingSave = JSON.stringify({
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
    });
    localStorage.setItem("pendingSave:form-1", pendingSave);
    rpcMock.mockRejectedValue(new Error("network error"));

    const root = renderAutosave(() => {});
    await flushPromises();

    expect(rpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        json: {
          expectedVersion: 7,
          plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
        },
      }),
    );
    expect(localStorage.getItem("pendingSave:form-1")).toBe(pendingSave);
    expect(toastWarningMock).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("does not keep a pending save when an in-flight mutation already saved the keepalive body", async () => {
    vi.useFakeTimers();
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    const keepaliveResult = createDeferred<{ ok: boolean; status: number }>();
    const fetchMock = vi.fn().mockReturnValue(keepaliveResult.promise);
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });

    act(() => {
      hook?.handleContentChange(draftContent);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      root.unmount();
    });
    act(() => {
      latestMutationOptions?.onSuccess?.(
        { plateContentVersion: 8 },
        {
          expectedVersion: 7,
          plateContent: draftContent,
          restoreGeneration: 0,
        },
      );
    });
    await act(async () => {
      keepaliveResult.resolve({ ok: false, status: 409 });
      await keepaliveResult.promise;
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/forms/form-1/content",
      expect.objectContaining({
        body: JSON.stringify({
          plateContent: draftContent,
          expectedVersion: 7,
        }),
        keepalive: true,
        method: "PUT",
      }),
    );
    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();
  });

  it("falls back to localStorage without fetch when the body exceeds the keepalive limit", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });
    const largeContent = "x".repeat(70 * 1024);

    act(() => {
      hook?.handleContentChange(largeContent);
    });
    act(() => {
      root.unmount();
    });
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: largeContent,
    });
  });

  it("clears a blocked pending save after a normal autosave succeeds", () => {
    localStorage.setItem(
      "pendingSave:form-1",
      JSON.stringify({
        expectedVersion: 7,
        plateContent: "stale draft",
        retryBlocked: "conflict",
      }),
    );
    const root = renderAutosave(() => {});

    act(() => {
      latestMutationOptions?.onSuccess?.(
        { plateContentVersion: 8 },
        {
          expectedVersion: 7,
          plateContent: "stale draft",
          restoreGeneration: 0,
        },
      );
    });

    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("keeps a different pending save when an older normal autosave succeeds", () => {
    const newerPendingSave = JSON.stringify({
      expectedVersion: 7,
      plateContent: "newer draft",
    });
    const root = renderAutosave(() => {});
    // Set after mount to simulate a keepalive/async write that happens after the initial restore pass.
    localStorage.setItem("pendingSave:form-1", newerPendingSave);

    act(() => {
      latestMutationOptions?.onSuccess?.(
        { plateContentVersion: 8 },
        {
          expectedVersion: 7,
          plateContent: "older draft",
          restoreGeneration: 0,
        },
      );
    });

    expect(localStorage.getItem("pendingSave:form-1")).toBe(newerPendingSave);

    act(() => {
      root.unmount();
    });
  });
});
