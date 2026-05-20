// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorSSE } from "./use-editor-sse";
import { useValidationSSE } from "./use-validation-sse";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type EventSourceListener = (event: MessageEvent<string> | Event) => void;

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, EventSourceListener[]>();
  readonly url: string | URL;
  readonly withCredentials: boolean;
  readyState = MockEventSource.OPEN;
  closed = false;

  constructor(url: string | URL, init?: EventSourceInit) {
    this.url = url;
    this.withCredentials = init?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventSourceListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
    this.closed = true;
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new Event(type));
    }
  }
}

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
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

function ValidationHarness(): null {
  useValidationSSE("form-1");
  return null;
}

function EditorHarness(): null {
  useEditorSSE("form-1");
  return null;
}

function eventSourceAt(index: number): MockEventSource {
  const source = MockEventSource.instances[index];
  expect(source).toBeDefined();
  if (!source) {
    throw new Error(`Expected EventSource instance ${index}`);
  }
  return source;
}

describe("SSE recovery hooks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setDocumentHidden(false);
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("reconnects validation SSE after repeated errors with exponential backoff", () => {
    const { root } = renderWithClient(<ValidationHarness />);
    const firstSource = eventSourceAt(0);

    act(() => {
      firstSource.emit("error");
      firstSource.emit("error");
    });

    expect(firstSource.closed).toBe(false);
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      firstSource.emit("error");
    });

    expect(firstSource.closed).toBe(true);

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    const secondSource = eventSourceAt(1);
    act(() => {
      secondSource.emit("error");
      secondSource.emit("error");
      secondSource.emit("error");
      vi.advanceTimersByTime(1_999);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(MockEventSource.instances).toHaveLength(3);

    act(() => root.unmount());
  });

  it("stops editor SSE reconnect timers while hidden and reconnects on visibility restore", () => {
    const { client, root } = renderWithClient(<EditorHarness />);
    const invalidateQueriesSpy = vi.spyOn(client, "invalidateQueries");
    const source = eventSourceAt(0);

    act(() => {
      source.emit("error");
      source.emit("error");
      source.emit("error");
    });

    expect(source.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(1);

    setDocumentHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(MockEventSource.instances).toHaveLength(1);

    setDocumentHidden(false);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(MockEventSource.instances).toHaveLength(2);
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: ["formContent", "form-1"],
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: ["formDiff", "form-1"],
    });

    act(() => root.unmount());
  });
});
