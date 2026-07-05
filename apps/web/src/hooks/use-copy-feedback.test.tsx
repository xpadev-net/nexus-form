// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopyFeedback } from "./use-copy-feedback";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function TestCopyFeedback() {
  const copyFeedback = useCopyFeedback({ resetAfterMs: 50 });

  return (
    <div>
      <span data-testid="status">{copyFeedback.status}</span>
      <button type="button" onClick={copyFeedback.markCopied}>
        copied
      </button>
      <button type="button" onClick={copyFeedback.markFailed}>
        failed
      </button>
      <button type="button" onClick={copyFeedback.reset}>
        reset
      </button>
    </div>
  );
}

function renderHookHarness(): Root {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  act(() => {
    root.render(<TestCopyFeedback />);
  });
  return root;
}

function getStatus(): string | null {
  return document.querySelector('[data-testid="status"]')?.textContent ?? null;
}

function clickButton(name: string) {
  const button = Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent === name,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${name}`);
  }
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("useCopyFeedback", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("represents copied and failed states before resetting to idle", () => {
    const root = renderHookHarness();

    expect(getStatus()).toBe("idle");
    clickButton("copied");
    expect(getStatus()).toBe("copied");

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(getStatus()).toBe("idle");

    clickButton("failed");
    expect(getStatus()).toBe("failed");

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(getStatus()).toBe("idle");

    act(() => root.unmount());
  });

  it("cleans up the reset timer on unmount", () => {
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const root = renderHookHarness();

    clickButton("copied");
    act(() => root.unmount());

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it("resets copied and failed states immediately", () => {
    const root = renderHookHarness();

    clickButton("copied");
    expect(getStatus()).toBe("copied");
    clickButton("reset");
    expect(getStatus()).toBe("idle");

    clickButton("failed");
    expect(getStatus()).toBe("failed");
    clickButton("reset");
    expect(getStatus()).toBe("idle");

    act(() => root.unmount());
  });
});
