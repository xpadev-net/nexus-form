// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StructureHistoryViewer } from "./structure-history-viewer";

vi.mock("@/hooks/forms/use-snapshots", () => ({
  useSnapshots: () => ({
    snapshotsQuery: {
      data: undefined,
      isError: true,
      isLoading: false,
      refetch: vi.fn(),
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
  it("renders an error state instead of an empty history on query errors", () => {
    const html = renderToStaticMarkup(
      <StructureHistoryViewer formId="form-1" />,
    );

    expect(html).toContain("履歴を読み込めませんでした。");
    expect(html).toContain("再試行");
    expect(html).not.toContain("履歴はまだありません。");
  });
});
