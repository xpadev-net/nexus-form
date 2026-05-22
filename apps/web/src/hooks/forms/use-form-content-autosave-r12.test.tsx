// @vitest-environment jsdom

import { act, useEffect, useRef, useState } from "react";
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
const { MockRpcError, putContentMock } = vi.hoisted(() => {
  class MockRpcError extends Error {
    status: number;

    constructor(status: number) {
      super("rpc error");
      this.status = status;
    }
  }

  return { MockRpcError, putContentMock: vi.fn() };
});

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
    return { mutate: mutateMock };
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
  rpc: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => store.delete(key),
    setItem: (key: string, value: string) => store.set(key, value),
  };
}

function renderAutosave(onReady: (hook: UseFormContentAutosaveReturn) => void) {
  const container = document.createElement("div");
  const root = createRoot(container);

  function Harness() {
    const hook = useFormContentAutosave({
      contentData: { plateContent: "[]", plateContentVersion: 7 },
      contentRefetch: refetchMock,
      formId: "form-1",
      getActiveTab: () => "editor",
    });
    const hookRef = useRef(hook);
    hookRef.current = hook;
    const didNotifyReadyRef = useRef(false);

    useEffect(() => {
      if (didNotifyReadyRef.current) return;
      didNotifyReadyRef.current = true;
      onReady(hookRef.current);
    }, []);

    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return root;
}

interface ContentQueryData {
  plateContent: string | null;
  plateContentVersion: number;
}

function renderUpdatableAutosave(
  initialContent: ContentQueryData,
  onReady: (api: {
    hook: UseFormContentAutosaveReturn;
    updateContent: (data: ContentQueryData) => void;
  }) => void,
) {
  const container = document.createElement("div");
  const root = createRoot(container);

  function Harness() {
    const [contentData, setContentData] = useState(initialContent);
    const hook = useFormContentAutosave({
      contentData,
      contentRefetch: refetchMock,
      formId: "form-1",
      getActiveTab: () => "editor",
    });
    const hookRef = useRef(hook);
    hookRef.current = hook;
    const didNotifyReadyRef = useRef(false);

    useEffect(() => {
      if (didNotifyReadyRef.current) return;
      didNotifyReadyRef.current = true;
      onReady({
        get hook() {
          return hookRef.current;
        },
        updateContent: setContentData,
      });
    }, []);

    return null;
  }

  act(() => {
    root.render(<Harness />);
  });

  return root;
}

describe("R12-P6 autosave optimistic-lock invariant", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    invalidateQueriesMock.mockClear();
    setQueryDataMock.mockClear();
    mutateMock.mockClear();
    attemptMergeMock.mockClear();
    latestMutationOptions = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not advance expectedVersion when a collaborator refetch arrives during local edits", () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const v1Content = '[{"type":"p","children":[{"text":"v1"}]}]';
    const v2Content = '[{"type":"p","children":[{"text":"v2"}]}]';
    const localEdit = '[{"type":"p","children":[{"text":"local"}]}]';
    let api:
      | {
          hook: UseFormContentAutosaveReturn;
          updateContent: (data: ContentQueryData) => void;
        }
      | undefined;
    const root = renderUpdatableAutosave(
      { plateContent: v1Content, plateContentVersion: 7 },
      (current) => {
        api = current;
      },
    );

    act(() => {
      api?.hook.handleContentChange(localEdit);
    });
    act(() => {
      api?.updateContent({
        plateContent: v2Content,
        plateContentVersion: 8,
      });
    });

    const debouncedSave = setTimeoutSpy.mock.calls.find(
      (call) => call[1] === 2000,
    );
    expect(debouncedSave).toBeDefined();
    act(() => {
      (debouncedSave?.[0] as () => void)();
    });

    expect(mutateMock).toHaveBeenCalledWith({
      expectedVersion: 7,
      plateContent: localEdit,
      restoreGeneration: 0,
    });

    setTimeoutSpy.mockRestore();
    act(() => {
      root.unmount();
    });
  });

  it("routes a version conflict to merge instead of silently overwriting remote changes", () => {
    const root = renderAutosave(() => {});

    act(() => {
      latestMutationOptions?.onError?.(new MockRpcError(409), {
        expectedVersion: 7,
        plateContent: "local draft",
        restoreGeneration: 0,
      });
    });

    expect(attemptMergeMock).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
  });
});

describe("R12-T2 product regression (P4)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    setQueryDataMock.mockClear();
    latestMutationOptions = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates formContent query cache after autosave succeeds (R12-P4)", () => {
    const root = renderAutosave(() => {});

    act(() => {
      latestMutationOptions?.onSuccess?.(
        { plateContentVersion: 8 },
        {
          expectedVersion: 7,
          plateContent: "saved content",
          restoreGeneration: 0,
        },
      );
    });

    expect(setQueryDataMock).toHaveBeenCalledWith(["formContent", "form-1"], {
      plateContent: "saved content",
      plateContentVersion: 8,
    });

    act(() => {
      root.unmount();
    });
  });
});
