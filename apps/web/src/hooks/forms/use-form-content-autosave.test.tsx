// @vitest-environment jsdom

import { act, type ReactNode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTORE_EDIT_EVENT } from "@/hooks/forms/events";
import { useEditorSSE } from "@/hooks/forms/use-editor-sse";
import {
  type UseFormContentAutosaveReturn,
  useFormContentAutosave,
} from "./use-form-content-autosave";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const invalidateQueriesMock = vi.fn();
const setQueryDataMock = vi.fn();
const queryClientMock = {
  invalidateQueries: invalidateQueriesMock,
  setQueryData: setQueryDataMock,
};
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
  onError?: (error: unknown, variables: TestMutationVariables) => void;
}

let latestMutationOptions: TestMutationOptions | undefined;
const attemptMergeMock = vi.fn();
const useEditorSSEMock = vi.mocked(useEditorSSE);

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: TestMutationOptions) => {
    latestMutationOptions = options;
    return {
      mutate: mutateMock,
    };
  },
  useQueryClient: () => queryClientMock,
}));

vi.mock("@/hooks/forms/use-editor-sse", () => ({
  useEditorSSE: vi.fn(),
}));

vi.mock("@/hooks/forms/use-plate-merge", () => ({
  usePlateMerge: () => ({
    attemptMerge: attemptMergeMock,
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
    const hookRef = useRef(hook);
    hookRef.current = hook;

    useEffect(() => {
      if (didNotifyReadyRef.current) return;
      didNotifyReadyRef.current = true;
      onReady(hookRef.current);
    }, []);

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
    attemptMergeMock.mockClear();
    useEditorSSEMock.mockClear();
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

  it("does not keep a pending save when keepalive rejects after regular autosave succeeds", async () => {
    vi.useFakeTimers();
    let rejectKeepalive: (error: Error) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectKeepalive = reject;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';

    act(() => {
      hook?.handleContentChange(draftContent);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(mutateMock).toHaveBeenCalledWith({
      expectedVersion: 7,
      plateContent: draftContent,
      restoreGeneration: 0,
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
    rejectKeepalive(new Error("network error"));
    await flushPromises();

    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();
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

  it("invalidates content and diff queries when retrying a pending save succeeds on mount", async () => {
    localStorage.setItem(
      "pendingSave:form-1",
      JSON.stringify({
        expectedVersion: 7,
        plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      }),
    );
    rpcMock.mockResolvedValue({ plateContentVersion: 8 });

    const root = renderAutosave(() => {});
    await flushPromises();

    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["formContent", "form-1"],
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ["formDiff", "form-1"],
    });

    act(() => {
      root.unmount();
    });
  });

  it("does not fire keepalive fetch when regular autosave already completed before unmount", async () => {
    vi.useFakeTimers();
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
      vi.advanceTimersByTime(2000);
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
    act(() => {
      root.unmount();
    });

    // Keepalive should NOT fire - onSuccess already completed and cleared
    // inFlightRequestRef before unmount, so persistPendingOrInFlightSave
    // finds nothing to persist and returns early.
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://localhost:3001/api/forms/form-1/content",
      expect.objectContaining({
        keepalive: true,
        method: "PUT",
      }),
    );
    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();
  });

  it("stores in-flight value on unmount when regular autosave has not completed", async () => {
    vi.useFakeTimers();
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
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
    await flushPromises();

    // The value was in-flight when unmounting, so keepalive fallback should persist it.
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/forms/form-1/content",
      expect.objectContaining({
        keepalive: true,
        method: "PUT",
        body: JSON.stringify({
          plateContent: draftContent,
          expectedVersion: 7,
        }),
      }),
    );
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: draftContent,
    });
  });

  it("stores a newer pending value with the latest version when in-flight autosave wins before keepalive", async () => {
    vi.useFakeTimers();
    let resolveKeepalive: (response: { ok: boolean; status: number }) => void =
      () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean; status: number }>((resolve) => {
          resolveKeepalive = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });
    const inFlightContent =
      '[{"type":"p","children":[{"text":"first draft"}]}]';
    const pendingContent =
      '[{"type":"p","children":[{"text":"second draft"}]}]';

    act(() => {
      hook?.handleContentChange(inFlightContent);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      hook?.handleContentChange(pendingContent);
    });
    act(() => {
      root.unmount();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/forms/form-1/content",
      expect.objectContaining({
        keepalive: true,
        method: "PUT",
        body: JSON.stringify({
          plateContent: pendingContent,
          expectedVersion: 7,
        }),
      }),
    );

    act(() => {
      latestMutationOptions?.onSuccess?.(
        { plateContentVersion: 8 },
        {
          expectedVersion: 7,
          plateContent: inFlightContent,
          restoreGeneration: 0,
        },
      );
    });
    resolveKeepalive({ ok: false, status: 409 });
    await flushPromises();

    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 8,
      plateContent: pendingContent,
    });
  });

  it("does not start a false merge when keepalive saves pending value before in-flight autosave fails", async () => {
    vi.useFakeTimers();
    let resolveKeepalive: (response: { ok: boolean; status: number }) => void =
      () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean; status: number }>((resolve) => {
          resolveKeepalive = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });
    const inFlightContent =
      '[{"type":"p","children":[{"text":"first draft"}]}]';
    const pendingContent =
      '[{"type":"p","children":[{"text":"second draft"}]}]';

    act(() => {
      hook?.handleContentChange(inFlightContent);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      hook?.handleContentChange(pendingContent);
    });
    act(() => {
      root.unmount();
    });

    resolveKeepalive({ ok: true, status: 200 });
    await flushPromises();
    act(() => {
      latestMutationOptions?.onError?.(new MockRpcError(409), {
        expectedVersion: 7,
        plateContent: inFlightContent,
        restoreGeneration: 0,
      });
    });

    expect(attemptMergeMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();
  });

  it("does not start a false merge when in-flight autosave fails before keepalive resolves", async () => {
    vi.useFakeTimers();
    let resolveKeepalive: (response: { ok: boolean; status: number }) => void =
      () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean; status: number }>((resolve) => {
          resolveKeepalive = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });
    const inFlightContent =
      '[{"type":"p","children":[{"text":"first draft"}]}]';
    const pendingContent =
      '[{"type":"p","children":[{"text":"second draft"}]}]';

    act(() => {
      hook?.handleContentChange(inFlightContent);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      hook?.handleContentChange(pendingContent);
    });
    act(() => {
      root.unmount();
    });

    act(() => {
      latestMutationOptions?.onError?.(new MockRpcError(409), {
        expectedVersion: 7,
        plateContent: inFlightContent,
        restoreGeneration: 0,
      });
    });

    expect(attemptMergeMock).not.toHaveBeenCalled();

    resolveKeepalive({ ok: true, status: 200 });
    await flushPromises();

    expect(attemptMergeMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();
  });

  it("retries newer edits when a pending-only keepalive wins before autosave", async () => {
    vi.useFakeTimers();
    let resolveKeepalive: (response: { ok: boolean; status: number }) => void =
      () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean; status: number }>((resolve) => {
          resolveKeepalive = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });
    const keepaliveContent =
      '[{"type":"p","children":[{"text":"hidden draft"}]}]';
    const newerContent = '[{"type":"p","children":[{"text":"visible draft"}]}]';

    act(() => {
      hook?.handleContentChange(keepaliveContent);
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/forms/form-1/content",
      expect.objectContaining({
        keepalive: true,
        method: "PUT",
        body: JSON.stringify({
          plateContent: keepaliveContent,
          expectedVersion: 7,
        }),
      }),
    );

    act(() => {
      hook?.handleContentChange(newerContent);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(mutateMock).toHaveBeenLastCalledWith({
      expectedVersion: 7,
      plateContent: newerContent,
      restoreGeneration: 0,
    });

    resolveKeepalive({ ok: true, status: 200 });
    await flushPromises();
    act(() => {
      latestMutationOptions?.onError?.(new MockRpcError(409), {
        expectedVersion: 7,
        plateContent: newerContent,
        restoreGeneration: 0,
      });
    });

    expect(attemptMergeMock).not.toHaveBeenCalled();
    expect(mutateMock).toHaveBeenLastCalledWith({
      expectedVersion: 8,
      plateContent: newerContent,
      restoreGeneration: 0,
    });
    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("starts merge when pending-only keepalive and newer autosave both conflict", async () => {
    vi.useFakeTimers();
    let resolveKeepalive: (response: { ok: boolean; status: number }) => void =
      () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean; status: number }>((resolve) => {
          resolveKeepalive = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });
    const keepaliveContent =
      '[{"type":"p","children":[{"text":"hidden draft"}]}]';
    const newerContent = '[{"type":"p","children":[{"text":"visible draft"}]}]';

    act(() => {
      hook?.handleContentChange(keepaliveContent);
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    act(() => {
      hook?.handleContentChange(newerContent);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      latestMutationOptions?.onError?.(new MockRpcError(409), {
        expectedVersion: 7,
        plateContent: newerContent,
        restoreGeneration: 0,
      });
    });

    expect(attemptMergeMock).not.toHaveBeenCalled();

    resolveKeepalive({ ok: false, status: 409 });
    await flushPromises();

    expect(attemptMergeMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: newerContent,
    });
    expect(
      useEditorSSEMock.mock.calls.at(-1)?.[1].lastSavedVersionRef.current,
    ).toBeNull();

    localStorage.removeItem("pendingSave:form-1");
    act(() => {
      root.unmount();
    });
  });

  it("does not start merge when newer autosave fails without conflict", async () => {
    vi.useFakeTimers();
    let resolveKeepalive: (response: { ok: boolean; status: number }) => void =
      () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean; status: number }>((resolve) => {
          resolveKeepalive = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });
    const keepaliveContent =
      '[{"type":"p","children":[{"text":"hidden draft"}]}]';
    const newerContent = '[{"type":"p","children":[{"text":"visible draft"}]}]';

    act(() => {
      hook?.handleContentChange(keepaliveContent);
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    act(() => {
      hook?.handleContentChange(newerContent);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      latestMutationOptions?.onError?.(new MockRpcError(500), {
        expectedVersion: 7,
        plateContent: newerContent,
        restoreGeneration: 0,
      });
    });

    resolveKeepalive({ ok: false, status: 500 });
    await flushPromises();

    expect(attemptMergeMock).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: newerContent,
    });
    expect(
      useEditorSSEMock.mock.calls.at(-1)?.[1].lastSavedVersionRef.current,
    ).toBeNull();

    localStorage.removeItem("pendingSave:form-1");
    act(() => {
      root.unmount();
    });
  });

  it("starts merge when pending-only keepalive rejects after newer autosave conflict", async () => {
    vi.useFakeTimers();
    let rejectKeepalive: (error: Error) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<never>((_, reject) => {
          rejectKeepalive = reject;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });
    const keepaliveContent =
      '[{"type":"p","children":[{"text":"hidden draft"}]}]';
    const newerContent = '[{"type":"p","children":[{"text":"visible draft"}]}]';

    act(() => {
      hook?.handleContentChange(keepaliveContent);
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    act(() => {
      hook?.handleContentChange(newerContent);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      latestMutationOptions?.onError?.(new MockRpcError(409), {
        expectedVersion: 7,
        plateContent: newerContent,
        restoreGeneration: 0,
      });
    });

    expect(attemptMergeMock).not.toHaveBeenCalled();

    rejectKeepalive(new Error("network unavailable"));
    await flushPromises();

    expect(attemptMergeMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: newerContent,
    });
    expect(
      useEditorSSEMock.mock.calls.at(-1)?.[1].lastSavedVersionRef.current,
    ).toBeNull();

    localStorage.removeItem("pendingSave:form-1");
    act(() => {
      root.unmount();
    });
  });

  it("keeps newer edits when pending-only keepalive conflicts before newer autosave", async () => {
    vi.useFakeTimers();
    rpcMock.mockRejectedValue(new Error("retry unavailable"));
    let resolveKeepalive: (response: { ok: boolean; status: number }) => void =
      () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean; status: number }>((resolve) => {
          resolveKeepalive = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });
    const keepaliveContent =
      '[{"type":"p","children":[{"text":"hidden draft"}]}]';
    const newerContent = '[{"type":"p","children":[{"text":"visible draft"}]}]';

    act(() => {
      hook?.handleContentChange(keepaliveContent);
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    act(() => {
      hook?.handleContentChange(newerContent);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    resolveKeepalive({ ok: false, status: 409 });
    await flushPromises();
    await flushPromises();
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: keepaliveContent,
    });

    act(() => {
      latestMutationOptions?.onError?.(new MockRpcError(409), {
        expectedVersion: 7,
        plateContent: newerContent,
        restoreGeneration: 0,
      });
    });

    expect(attemptMergeMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: newerContent,
    });
    expect(
      useEditorSSEMock.mock.calls.at(-1)?.[1].lastSavedVersionRef.current,
    ).toBeNull();

    localStorage.removeItem("pendingSave:form-1");
    act(() => {
      root.unmount();
    });
  });

  it("starts merge when pending-only keepalive and matching autosave both conflict", async () => {
    vi.useFakeTimers();
    let resolveKeepalive: (response: { ok: boolean; status: number }) => void =
      () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: boolean; status: number }>((resolve) => {
          resolveKeepalive = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });
    const draftContent =
      '[{"type":"p","children":[{"text":"conflicting draft"}]}]';

    act(() => {
      hook?.handleContentChange(draftContent);
    });
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    act(() => {
      hook?.handleContentChange(draftContent);
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      latestMutationOptions?.onError?.(new MockRpcError(409), {
        expectedVersion: 7,
        plateContent: draftContent,
        restoreGeneration: 0,
      });
    });

    expect(attemptMergeMock).not.toHaveBeenCalled();

    resolveKeepalive({ ok: false, status: 409 });
    await flushPromises();

    expect(attemptMergeMock).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: draftContent,
    });

    localStorage.removeItem("pendingSave:form-1");
    act(() => {
      root.unmount();
    });
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

  it("clears a matching pending save when a stale autosave succeeds after restore", () => {
    localStorage.setItem(
      "pendingSave:form-1",
      JSON.stringify({
        expectedVersion: 7,
        plateContent: "stale-but-saved draft",
        retryBlocked: "conflict",
      }),
    );
    const root = renderAutosave(() => {});

    act(() => {
      window.dispatchEvent(
        new CustomEvent(RESTORE_EDIT_EVENT, {
          detail: {
            formId: "form-1",
            plateContent: "restored draft",
          },
        }),
      );
    });
    act(() => {
      latestMutationOptions?.onSuccess?.(
        { plateContentVersion: 8 },
        {
          expectedVersion: 7,
          plateContent: "stale-but-saved draft",
          restoreGeneration: 0,
        },
      );
    });

    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();
    expect(invalidateQueriesMock).not.toHaveBeenCalledWith({
      queryKey: ["formDiff", "form-1"],
    });

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
