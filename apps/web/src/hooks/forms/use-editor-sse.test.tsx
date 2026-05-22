// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorSSE } from "./use-editor-sse";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners = new Map<string, (event: MessageEvent<string>) => void>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => {
      this.listeners.get("open")?.({} as MessageEvent<string>);
    });
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ) {
    this.listeners.set(type, listener);
  }

  close() {}
}

function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
}

function renderEditorSSE(onMergeNeeded: ReturnType<typeof vi.fn>) {
  const queryClient = new QueryClient();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
  const container = document.createElement("div");
  const root = createRoot(container);

  function Harness() {
    const pendingRef = useRef<string | null>("local draft");
    useEditorSSE("form-1", {
      pendingValueRef: pendingRef,
      onMergeNeeded,
    });
    return null;
  }

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
  });

  return { root, invalidateSpy };
}

describe("R12-P5 editor SSE visibility restore", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    setDocumentHidden(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setDocumentHidden(false);
  });

  it("calls merge instead of invalidating caches when pending edits exist on tab restore", () => {
    const onMergeNeeded = vi.fn();
    const { invalidateSpy } = renderEditorSSE(onMergeNeeded);

    invalidateSpy.mockClear();

    act(() => {
      setDocumentHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      setDocumentHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(onMergeNeeded).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
