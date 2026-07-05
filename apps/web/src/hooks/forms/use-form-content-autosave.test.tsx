// @vitest-environment jsdom

import { act, type ReactNode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTORE_EDIT_EVENT } from "@/hooks/forms/events";
import {
  type PendingSave,
  type PendingSaveAuthScope,
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
  authScope: PendingSaveAuthScope;
  contentQueryKey: readonly unknown[];
  formId: string;
  expectedVersion: number;
  plateContent: string;
  restoreGeneration: number;
}

type TestMutationVariablesInput =
  | TestMutationVariables
  | Omit<TestMutationVariables, "authScope" | "contentQueryKey" | "formId">;

interface TestMutationOptions {
  onSuccess?: (data: unknown, variables: TestMutationVariablesInput) => void;
  onError?: (error: unknown, variables: TestMutationVariablesInput) => void;
}

let latestMutationOptions: TestMutationOptions | undefined;
const attemptMergeMock = vi.fn();
const defaultAuthScope = {
  principalKey: "current-session",
  role: "EDITOR",
  type: "session",
} as const;
type TestPendingSaveOverrides = Omit<PendingSave, "authScope" | "formId"> &
  Partial<Pick<PendingSave, "authScope" | "formId">>;

function makePendingSave(overrides: TestPendingSaveOverrides): PendingSave {
  return {
    authScope: defaultAuthScope,
    formId: "form-1",
    ...overrides,
  };
}

function stringifyPendingSave(overrides: TestPendingSaveOverrides): string {
  return JSON.stringify(makePendingSave(overrides));
}

function withDefaultMutationScope(
  variables: TestMutationVariablesInput,
): TestMutationVariables {
  return {
    authScope: defaultAuthScope,
    contentQueryKey: ["formContent", "form-1"],
    formId: "form-1",
    ...variables,
  };
}

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: TestMutationOptions) => {
    latestMutationOptions = {
      onError: (error, variables) =>
        options.onError?.(error, withDefaultMutationScope(variables)),
      onSuccess: (data, variables) =>
        options.onSuccess?.(data, withDefaultMutationScope(variables)),
    };
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
  getShareTokenAuthorizationHeader: () => ({}),
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

function renderAutosave(
  onReady: (hook: UseFormContentAutosaveReturn) => void,
  options: { enabled?: boolean } = {},
) {
  const container = document.createElement("div");
  const root = createRoot(container);

  function Harness({ children }: { children?: ReactNode }) {
    const didNotifyReadyRef = useRef(false);
    const hook = useFormContentAutosave({
      contentData: { plateContent: "[]", plateContentVersion: 7 },
      contentRefetch: refetchMock,
      enabled: options.enabled,
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

function renderAutosaveWithEnabledToggle(
  onReady: (hook: UseFormContentAutosaveReturn) => void,
  initialEnabled = false,
) {
  const container = document.createElement("div");
  const root = createRoot(container);
  let enabled = initialEnabled;

  function Harness({ enabled: currentEnabled }: { enabled: boolean }) {
    const didNotifyReadyRef = useRef(false);
    const hook = useFormContentAutosave({
      contentData: { plateContent: "[]", plateContentVersion: 7 },
      contentRefetch: refetchMock,
      enabled: currentEnabled,
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

    return null;
  }

  const render = () => {
    act(() => {
      root.render(<Harness enabled={enabled} />);
    });
  };

  render();

  return {
    disable: () => {
      enabled = false;
      render();
    },
    enable: () => {
      enabled = true;
      render();
    },
    root,
  };
}

function renderAutosaveWithFormId(
  onReady: (hook: UseFormContentAutosaveReturn) => void,
): {
  root: ReturnType<typeof createRoot>;
  switchForm: (nextFormId: string, nextPlateContent?: string) => void;
} {
  const container = document.createElement("div");
  const root = createRoot(container);
  let formId = "form-1";
  let plateContent = "[]";

  function Harness({ currentFormId }: { currentFormId: string }): null {
    const hook = useFormContentAutosave({
      contentData: { plateContent, plateContentVersion: 7 },
      contentRefetch: refetchMock,
      formId: currentFormId,
      getActiveTab: () => "editor",
    });
    onReady(hook);

    return null;
  }

  const render = () => {
    act(() => {
      root.render(<Harness currentFormId={formId} />);
    });
  };

  render();

  return {
    root,
    switchForm: (nextFormId: string, nextPlateContent = "[]") => {
      formId = nextFormId;
      plateContent = nextPlateContent;
      render();
    },
  };
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
      authScope: defaultAuthScope,
      expectedVersion: 7,
      formId: "form-1",
      plateContent: draftContent,
    });
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual(
      makePendingSave({
        expectedVersion: 7,
        failureStatus: 500,
        failureType: "http",
        plateContent: draftContent,
      }),
    );
  });

  it("does not overwrite a different auth scope pending save when keepalive fetch fails", async () => {
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    const differentScopeSave = stringifyPendingSave({
      authScope: {
        principalKey: "fnv1a:viewer",
        role: "VIEWER",
        type: "share-token",
      },
      expectedVersion: 6,
      plateContent: '[{"type":"p","children":[{"text":"viewer draft"}]}]',
    });
    let resolveResponse:
      | ((value: { ok: false; status: number }) => void)
      | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: false; status: number }>((resolve) => {
          resolveResponse = resolve;
        }),
    );
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
    localStorage.setItem("pendingSave:form-1", differentScopeSave);
    resolveResponse?.({ ok: false, status: 500 });
    await flushPromises();

    expect(localStorage.getItem("pendingSave:form-1")).toBe(differentScopeSave);
  });

  it("does not retry or keepalive save when autosave is disabled", async () => {
    const pendingSave = stringifyPendingSave({
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"stale"}]}]',
    });
    localStorage.setItem("pendingSave:form-1", pendingSave);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave(
      (currentHook) => {
        hook = currentHook;
      },
      { enabled: false },
    );
    await flushPromises();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(hook?.hasUnsavedLocalEdits()).toBe(false);

    act(() => {
      hook?.handleContentChange('[{"type":"p","children":[{"text":"draft"}]}]');
    });
    expect(hook?.hasUnsavedLocalEdits()).toBe(false);

    act(() => {
      root.unmount();
    });
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("pendingSave:form-1")).toBe(pendingSave);
  });

  it("clears a viewer share-link pending save instead of replaying it as a session editor", async () => {
    localStorage.setItem(
      "pendingSave:form-1",
      stringifyPendingSave({
        authScope: {
          principalKey: "fnv1a:viewer",
          role: "VIEWER",
          type: "share-token",
        },
        expectedVersion: 7,
        plateContent: '[{"type":"p","children":[{"text":"viewer draft"}]}]',
      }),
    );

    const root = renderAutosave(() => {});
    await flushPromises();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("clears legacy pending saves that do not carry an auth scope", async () => {
    localStorage.setItem(
      "pendingSave:form-1",
      JSON.stringify({
        expectedVersion: 7,
        plateContent: '[{"type":"p","children":[{"text":"legacy"}]}]',
      }),
    );

    const root = renderAutosave(() => {});
    await flushPromises();

    expect(rpcMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("clears a pending save when retrying it on mount is unauthorized", async () => {
    localStorage.setItem(
      "pendingSave:form-1",
      stringifyPendingSave({
        expectedVersion: 7,
        plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      }),
    );
    rpcMock.mockRejectedValue(new MockRpcError(403));

    const root = renderAutosave(() => {});
    await flushPromises();

    expect(rpcMock).toHaveBeenCalled();
    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("does not delete a different auth scope pending save when mount retry authorization fails", async () => {
    localStorage.setItem(
      "pendingSave:form-1",
      stringifyPendingSave({
        expectedVersion: 7,
        plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      }),
    );
    const differentScopeSave = stringifyPendingSave({
      authScope: {
        principalKey: "fnv1a:viewer",
        role: "VIEWER",
        type: "share-token",
      },
      expectedVersion: 6,
      plateContent: '[{"type":"p","children":[{"text":"viewer draft"}]}]',
    });
    let rejectRetry: ((error: Error) => void) | undefined;
    rpcMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRetry = reject;
      }),
    );

    const root = renderAutosave(() => {});
    await flushPromises();

    localStorage.setItem("pendingSave:form-1", differentScopeSave);
    rejectRetry?.(new MockRpcError(403));
    await flushPromises();

    expect(localStorage.getItem("pendingSave:form-1")).toBe(differentScopeSave);

    act(() => {
      root.unmount();
    });
  });

  it("does not overwrite a different auth scope pending save when mount retry conflicts", async () => {
    localStorage.setItem(
      "pendingSave:form-1",
      stringifyPendingSave({
        expectedVersion: 7,
        plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      }),
    );
    const differentScopeSave = stringifyPendingSave({
      authScope: {
        principalKey: "fnv1a:viewer",
        role: "VIEWER",
        type: "share-token",
      },
      expectedVersion: 6,
      plateContent: '[{"type":"p","children":[{"text":"viewer draft"}]}]',
    });
    let rejectRetry: ((error: Error) => void) | undefined;
    rpcMock.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRetry = reject;
      }),
    );

    const root = renderAutosave(() => {});
    await flushPromises();

    localStorage.setItem("pendingSave:form-1", differentScopeSave);
    rejectRetry?.(new MockRpcError(409));
    await flushPromises();

    expect(localStorage.getItem("pendingSave:form-1")).toBe(differentScopeSave);

    act(() => {
      root.unmount();
    });
  });

  it("does not delete a different auth scope pending save before storing mount retry in-flight fallback", async () => {
    const pendingSave = stringifyPendingSave({
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
    });
    const differentScopeSave = stringifyPendingSave({
      authScope: {
        principalKey: "fnv1a:viewer",
        role: "VIEWER",
        type: "share-token",
      },
      expectedVersion: 6,
      plateContent: '[{"type":"p","children":[{"text":"viewer draft"}]}]',
    });
    const removeItemMock = vi.fn();
    const setItemMock = vi.fn();
    const getItemMock = vi.fn(() => {
      const stack = new Error().stack ?? "";
      if (
        stack.includes("clearPendingSaveForAuthScope") ||
        stack.includes("storeInFlightPendingSave")
      ) {
        return differentScopeSave;
      }
      return pendingSave;
    });
    vi.stubGlobal("localStorage", {
      ...createMemoryStorage(),
      getItem: getItemMock,
      removeItem: removeItemMock,
      setItem: setItemMock,
    });
    rpcMock.mockReturnValue(new Promise(() => {}));

    const root = renderAutosave(() => {});
    await flushPromises();

    expect(rpcMock).toHaveBeenCalled();
    expect(removeItemMock).not.toHaveBeenCalled();
    expect(setItemMock).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("does not persist a keepalive fallback when the server rejects authorization", async () => {
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
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

    expect(fetchMock).toHaveBeenCalledOnce();
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      authScope: defaultAuthScope,
      expectedVersion: 7,
      formId: "form-1",
      plateContent: draftContent,
    });
    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();
  });

  it("does not delete a different auth scope pending save when keepalive authorization fails", async () => {
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    const differentScopeSave = stringifyPendingSave({
      authScope: {
        principalKey: "fnv1a:viewer",
        role: "VIEWER",
        type: "share-token",
      },
      expectedVersion: 6,
      plateContent: '[{"type":"p","children":[{"text":"viewer draft"}]}]',
    });
    let resolveResponse:
      | ((value: { ok: false; status: number }) => void)
      | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<{ ok: false; status: number }>((resolve) => {
          resolveResponse = resolve;
        }),
    );
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
    localStorage.setItem("pendingSave:form-1", differentScopeSave);
    resolveResponse?.({ ok: false, status: 403 });
    await flushPromises();

    expect(localStorage.getItem("pendingSave:form-1")).toBe(differentScopeSave);
  });

  it("resumes autosave when enabled changes from false to true", () => {
    vi.useFakeTimers();
    let hook: UseFormContentAutosaveReturn | undefined;
    const { enable, root } = renderAutosaveWithEnabledToggle((currentHook) => {
      hook = currentHook;
    });

    act(() => {
      hook?.handleContentChange(
        '[{"type":"p","children":[{"text":"blocked"}]}]',
      );
      vi.advanceTimersByTime(2000);
    });
    expect(mutateMock).not.toHaveBeenCalled();

    enable();

    act(() => {
      hook?.handleContentChange('[{"type":"p","children":[{"text":"saved"}]}]');
      vi.advanceTimersByTime(2000);
    });

    expect(mutateMock).toHaveBeenCalledWith({
      authScope: defaultAuthScope,
      contentQueryKey: ["formContent", "form-1"],
      expectedVersion: 7,
      formId: "form-1",
      plateContent: '[{"type":"p","children":[{"text":"saved"}]}]',
      restoreGeneration: expect.any(Number),
    });

    act(() => {
      root.unmount();
    });
  });

  it("keeps a pending save when enabled changes from true to false", async () => {
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const { disable, root } = renderAutosaveWithEnabledToggle((currentHook) => {
      hook = currentHook;
    }, true);

    act(() => {
      hook?.handleContentChange(draftContent);
    });

    disable();
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
      authScope: defaultAuthScope,
      expectedVersion: 7,
      formId: "form-1",
      plateContent: draftContent,
    });
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual(
      makePendingSave({
        expectedVersion: 7,
        failureStatus: 500,
        failureType: "http",
        plateContent: draftContent,
      }),
    );

    act(() => {
      root.unmount();
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("flushes pending edits to the previous form when formId changes", async () => {
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const { root, switchForm } = renderAutosaveWithFormId((currentHook) => {
      hook = currentHook;
    });

    act(() => {
      hook?.handleContentChange(draftContent);
    });

    switchForm("form-2");
    await flushPromises();

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:3001/api/forms/form-1/content",
    );
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      authScope: defaultAuthScope,
      expectedVersion: 7,
      formId: "form-1",
      plateContent: draftContent,
    });
    expect(hook?.hasUnsavedLocalEdits()).toBe(false);

    act(() => {
      root.unmount();
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
    ).toEqual(
      makePendingSave({
        expectedVersion: 7,
        failureType: "network",
        plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      }),
    );
  });

  it("does not keep a pending save when keepalive fetch succeeds", async () => {
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    localStorage.setItem(
      "pendingSave:form-1",
      stringifyPendingSave({
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
    const pendingSave = stringifyPendingSave({
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
    ).toEqual(
      makePendingSave({
        expectedVersion: 7,
        plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
        retryBlocked: "conflict",
      }),
    );
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
    ).toEqual(
      makePendingSave({
        expectedVersion: 7,
        plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
        retryBlocked: "conflict",
      }),
    );

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
    const pendingSave = stringifyPendingSave({
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
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual(
      makePendingSave({
        expectedVersion: 7,
        failureType: "unknown",
        plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      }),
    );
    expect(toastWarningMock).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });
  });

  it("invalidates content and diff queries when retrying a pending save succeeds on mount", async () => {
    localStorage.setItem(
      "pendingSave:form-1",
      stringifyPendingSave({
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
    ).toEqual(
      makePendingSave({
        expectedVersion: 7,
        plateContent: draftContent,
        source: "in-flight",
      }),
    );

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

  it("clears the previous form in-flight fallback when its autosave succeeds after formId changes", () => {
    vi.useFakeTimers();
    const draftContent = '[{"type":"p","children":[{"text":"draft"}]}]';
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const { root, switchForm } = renderAutosaveWithFormId((currentHook) => {
      hook = currentHook;
    });

    act(() => {
      hook?.handleContentChange(draftContent);
      vi.advanceTimersByTime(2000);
    });
    const saveVariables = mutateMock.mock.calls[0]?.[0] as
      | TestMutationVariables
      | undefined;
    expect(saveVariables).toEqual(
      expect.objectContaining({
        contentQueryKey: ["formContent", "form-1"],
        formId: "form-1",
        plateContent: draftContent,
      }),
    );

    switchForm("form-2");

    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual(
      makePendingSave({
        expectedVersion: 7,
        plateContent: draftContent,
        source: "in-flight",
      }),
    );

    act(() => {
      if (!saveVariables) throw new Error("save variables missing");
      latestMutationOptions?.onSuccess?.(
        { plateContentVersion: 8 },
        saveVariables,
      );
    });

    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();
    expect(setQueryDataMock).toHaveBeenCalledWith(["formContent", "form-1"], {
      plateContent: draftContent,
      plateContentVersion: 8,
    });
    expect(setQueryDataMock).not.toHaveBeenCalledWith(
      ["formContent", "form-2"],
      expect.anything(),
    );

    act(() => {
      root.unmount();
    });
  });

  it("does not overwrite a conflict-blocked pending save with in-flight fallback", () => {
    vi.useFakeTimers();
    const conflictBlockedSave = stringifyPendingSave({
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

  it("does not overwrite a different auth scope pending save with in-flight fallback", () => {
    vi.useFakeTimers();
    const differentScopeSave = stringifyPendingSave({
      authScope: {
        principalKey: "fnv1a:viewer",
        role: "VIEWER",
        type: "share-token",
      },
      expectedVersion: 6,
      plateContent: '[{"type":"p","children":[{"text":"viewer draft"}]}]',
    });
    const draftContent = '[{"type":"p","children":[{"text":"editor draft"}]}]';
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
    localStorage.setItem("pendingSave:form-1", differentScopeSave);
    act(() => {
      root.unmount();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("pendingSave:form-1")).toBe(differentScopeSave);
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
    ).toEqual(
      makePendingSave({
        expectedVersion: 7,
        plateContent: draftContent,
        source: "in-flight",
      }),
    );

    act(() => {
      latestMutationOptions?.onError?.(new Error("network error"), {
        expectedVersion: 7,
        plateContent: draftContent,
        restoreGeneration: 0,
      });
    });

    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual(
      makePendingSave({
        expectedVersion: 7,
        plateContent: draftContent,
        source: "in-flight",
      }),
    );
  });

  it("does not delete a different auth scope pending save when regular autosave authorization fails", () => {
    vi.useFakeTimers();
    const draftContent = '[{"type":"p","children":[{"text":"editor draft"}]}]';
    const differentScopeSave = stringifyPendingSave({
      authScope: {
        principalKey: "fnv1a:viewer",
        role: "VIEWER",
        type: "share-token",
      },
      expectedVersion: 6,
      plateContent: '[{"type":"p","children":[{"text":"viewer draft"}]}]',
    });
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
    localStorage.setItem("pendingSave:form-1", differentScopeSave);
    act(() => {
      latestMutationOptions?.onError?.(new MockRpcError(403), {
        authScope: defaultAuthScope,
        contentQueryKey: ["formContent", "form-1"],
        expectedVersion: 7,
        formId: "form-1",
        plateContent: draftContent,
        restoreGeneration: 0,
      });
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("pendingSave:form-1")).toBe(differentScopeSave);
  });

  it("delays retrying in-flight fallback so the original request can clear it first", async () => {
    vi.useFakeTimers();
    const pendingSave = stringifyPendingSave({
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
    const pendingSave = stringifyPendingSave({
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

  it("keeps in-flight fallback while delayed retry is in-flight and clears it on success", async () => {
    vi.useFakeTimers();
    const retryPayload = {
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
    };
    const pendingSave = stringifyPendingSave({
      ...retryPayload,
      source: "in-flight",
    });
    let resolveRetry: (value: unknown) => void = () => {};
    localStorage.setItem("pendingSave:form-1", pendingSave);
    rpcMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve;
        }),
    );

    const root = renderAutosave(() => {});
    await flushPromises();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await flushPromises();

    expect(rpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        json: retryPayload,
      }),
    );
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual(
      makePendingSave({
        ...retryPayload,
        source: "in-flight",
      }),
    );

    act(() => {
      root.unmount();
    });
    expect(
      JSON.parse(localStorage.getItem("pendingSave:form-1") ?? "{}"),
    ).toEqual(
      makePendingSave({
        ...retryPayload,
        source: "in-flight",
      }),
    );

    await act(async () => {
      resolveRetry({ plateContentVersion: 8 });
    });
    await flushPromises();

    expect(localStorage.getItem("pendingSave:form-1")).toBeNull();
  });

  it("stores a failed in-flight retry as a normal pending save for future mounts", async () => {
    vi.useFakeTimers();
    const pendingSave = stringifyPendingSave({
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
    ).toEqual(
      makePendingSave({
        expectedVersion: 7,
        failureType: "unknown",
        plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      }),
    );

    act(() => {
      root.unmount();
    });
  });

  it("does not overwrite a newer pending save when an older retry fails", async () => {
    vi.useFakeTimers();
    let rejectRetry: (reason?: unknown) => void = () => {};
    const pendingSave = stringifyPendingSave({
      expectedVersion: 7,
      plateContent: '[{"type":"p","children":[{"text":"draft"}]}]',
      source: "in-flight",
    });
    const newerPendingSave = stringifyPendingSave({
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
      authScope: defaultAuthScope,
      contentQueryKey: ["formContent", "form-1"],
      expectedVersion: 7,
      formId: "form-1",
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

  it("keeps authored empty and slash-only text blocks unchanged through autosave success", () => {
    vi.useFakeTimers();
    const draftContent = JSON.stringify([
      { type: "p", children: [{ text: "Before" }] },
      { type: "p", children: [{ text: "" }] },
      { type: "p", children: [] },
      { type: "p", children: [{ text: "/" }] },
      {
        type: "p",
        children: [{ type: "a", url: "/", children: [{ text: "/" }] }],
      },
      { type: "p", children: [{ text: "After" }] },
    ]);
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
      authScope: defaultAuthScope,
      contentQueryKey: ["formContent", "form-1"],
      expectedVersion: 7,
      formId: "form-1",
      plateContent: draftContent,
      restoreGeneration: 0,
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

    expect(setQueryDataMock).toHaveBeenCalledWith(["formContent", "form-1"], {
      plateContent: draftContent,
      plateContentVersion: 8,
    });

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
      authScope: defaultAuthScope,
      contentQueryKey: ["formContent", "form-1"],
      expectedVersion: 7,
      formId: "form-1",
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
    ).toEqual(
      makePendingSave({
        expectedVersion: 7,
        plateContent: largeContent,
      }),
    );
  });

  it("does not overwrite a different auth scope pending save when the keepalive body is too large", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let hook: UseFormContentAutosaveReturn | undefined;
    const root = renderAutosave((currentHook) => {
      hook = currentHook;
    });
    const differentScopeSave = stringifyPendingSave({
      authScope: {
        principalKey: "fnv1a:viewer",
        role: "VIEWER",
        type: "share-token",
      },
      expectedVersion: 6,
      plateContent: '[{"type":"p","children":[{"text":"viewer draft"}]}]',
    });

    act(() => {
      hook?.handleContentChange("x".repeat(70 * 1024));
    });
    localStorage.setItem("pendingSave:form-1", differentScopeSave);
    act(() => {
      root.unmount();
    });
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("pendingSave:form-1")).toBe(differentScopeSave);
  });

  it("clears a blocked pending save after a normal autosave succeeds", () => {
    localStorage.setItem(
      "pendingSave:form-1",
      stringifyPendingSave({
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
          authScope: defaultAuthScope,
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
      stringifyPendingSave({
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
          authScope: defaultAuthScope,
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
    const newerPendingSave = stringifyPendingSave({
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
          authScope: defaultAuthScope,
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
