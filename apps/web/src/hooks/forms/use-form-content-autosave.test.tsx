// @vitest-environment jsdom

import { act, type ReactNode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTORE_EDIT_EVENT } from "@/hooks/forms/events";
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
  onError?: (error: unknown, variables: TestMutationVariables) => void;
}

let latestMutationOptions: TestMutationOptions | undefined;
const attemptMergeMock = vi.fn();

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

  it("stores in-flight content as fallback without firing keepalive fetch on unmount", async () => {
    vi.useFakeTimers();
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    const fetchMock = vi.fn();
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
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: draftContent,
      source: "in-flight",
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

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();
  });

  it("does not overwrite a conflict-blocked pending save with in-flight fallback", () => {
    vi.useFakeTimers();
    const conflictBlockedSave = JSON.stringify({
      expectedVersion: 6,
      plateContent: '[{"type":"p","children":[{"text":"conflict"}]}]',
      retryBlocked: "conflict",
    });
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem("pendingSave:form-1", conflictBlockedSave);
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

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("pendingSave:form-1")).toBe(
      conflictBlockedSave,
    );
  });

  it("keeps in-flight fallback when regular autosave fails after unmount", async () => {
    vi.useFakeTimers();
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    const fetchMock = vi.fn();
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

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: draftContent,
      source: "in-flight",
    });

    act(() => {
      latestMutationOptions?.onError?.(new Error("network error"), {
        expectedVersion: 7,
        plateContent: draftContent,
        restoreGeneration: 0,
      });
    });

    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: draftContent,
      source: "in-flight",
    });
  });

  it("delays retrying in-flight fallback so the original request can clear it first", async () => {
    vi.useFakeTimers();
    const pendingSave = JSON.stringify({
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      source: "in-flight",
    });
    localStorage.setItem("pendingSave:form-1", pendingSave);
    rpcMock.mockResolvedValue({ plateContentVersion: 8 });

    const root = renderAutosave(() => {});
    await flushPromises();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("pendingSave:form-1")).toBe(pendingSave);

    localStorage.removeItem("pendingSave:form-1");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();

    expect(rpcMock).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("retries in-flight fallback after the original request has not cleared it", async () => {
    vi.useFakeTimers();
    const pendingSave = JSON.stringify({
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      source: "in-flight",
    });
    localStorage.setItem("pendingSave:form-1", pendingSave);
    rpcMock.mockResolvedValue({ plateContentVersion: 8 });

    const root = renderAutosave(() => {});
    await flushPromises();

    expect(rpcMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();

    expect(rpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        json: {
          expectedVersion: 7,
          plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
        },
      }),
    );
    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("stores a failed in-flight retry as a normal pending save for future mounts", async () => {
    vi.useFakeTimers();
    const pendingSave = JSON.stringify({
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      source: "in-flight",
    });
    localStorage.setItem("pendingSave:form-1", pendingSave);
    rpcMock.mockRejectedValue(new Error("network error"));

    const root = renderAutosave(() => {});
    await flushPromises();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();

    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual({
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
    });

    act(() => {
      root.unmount();
    });
  });

  it("does not overwrite a newer pending save when an older retry fails", async () => {
    vi.useFakeTimers();
    let rejectRetry: (reason?: unknown) => void = () => {};
    const pendingSave = JSON.stringify({
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      source: "in-flight",
    });
    const newerPendingSave = JSON.stringify({
      expectedVersion: 8,
      plateContent: '[{"type":"p","children":[{"text":"newer"}]}]',
      source: "in-flight",
    });
    localStorage.setItem("pendingSave:form-1", pendingSave);
    rpcMock.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectRetry = reject;
        }),
    );

    const root = renderAutosave(() => {});
    await flushPromises();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();

    localStorage.setItem("pendingSave:form-1", newerPendingSave);

    await act(async () => {
      rejectRetry(new Error("network error"));
    });
    await flushPromises();

    expect(localStorage.getItem("pendingSave:form-1")).toBe(newerPendingSave);

    act(() => {
      root.unmount();
    });
  });

  it("reports unsaved local edits until the debounced autosave succeeds", () => {
    vi.useFakeTimers();
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });

    expect(hook?.hasUnsavedLocalEdits()).toBe(false);

    act(() => {
      hook?.handleContentChange(draftContent);
    });

    expect(hook?.hasUnsavedLocalEdits()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(mutateMock).toHaveBeenCalledWith({
      expectedVersion: 7,
      plateContent: draftContent,
      restoreGeneration: 0,
    });
    expect(hook?.hasUnsavedLocalEdits()).toBe(true);

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

    expect(hook?.hasUnsavedLocalEdits()).toBe(false);

    act(() => {
      root.unmount();
    });
  });

  it("reports unsaved local edits while an autosave is in-flight even if the editor matches the saved base", () => {
    vi.useFakeTimers();
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
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

    expect(mutateMock).toHaveBeenCalledWith({
      expectedVersion: 7,
      plateContent: draftContent,
      restoreGeneration: 0,
    });

    act(() => {
      hook?.handleContentChange("[]");
    });

    expect(hook?.hasUnsavedLocalEdits()).toBe(true);

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
