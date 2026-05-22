// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StructureHistoryViewer } from "./structure-history-viewer";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const snapshotsRefetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/forms/use-snapshots", () => ({
  useSnapshots: () => ({
    snapshotsQuery: {
      data: undefined,
      isError: true,
      isLoading: false,
      refetch: snapshotsRefetchMock,
    },
    activateSnapshotMutation: {
      isPending: false,
      mutate: vi.fn(),
    },
    restoreEditFromSnapshotMutation: {
      isPending: false,
      mutate: vi.fn(),
    },
  }),
}));

describe("StructureHistoryViewer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders an error state instead of an empty history on query errors", () => {
    act(() => {
      root.render(<StructureHistoryViewer formId="form-1" />);
    });

    expect(container.textContent).toContain("履歴を読み込めませんでした。");
    expect(container.textContent).not.toContain("履歴はまだありません。");

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "再試行",
    );
    expect(retryButton).toBeDefined();
    act(() => {
      retryButton?.click();
    });

    expect(snapshotsRefetchMock).toHaveBeenCalledOnce();
  });
});
