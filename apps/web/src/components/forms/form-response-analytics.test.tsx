// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormResponseAnalytics } from "./form-response-analytics";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type AnalyticsQueryState = {
  data: { timeline: Array<{ date: string; count: number }> } | undefined;
  error: Error | null;
  isLoading: boolean;
};

type BlockAnalyticsQueryState = {
  data: { blocks: unknown[] } | undefined;
  error: Error | null;
  isLoading: boolean;
};

const analyticsMock = vi.hoisted(
  (): {
    analyticsQuery: AnalyticsQueryState;
    blockAnalyticsQuery: BlockAnalyticsQueryState;
  } => ({
    analyticsQuery: {
      data: { timeline: [] },
      error: null,
      isLoading: false,
    },
    blockAnalyticsQuery: {
      data: { blocks: [] },
      error: null,
      isLoading: false,
    },
  }),
);

vi.mock("@/hooks/forms/use-response-analytics", () => ({
  useResponseAnalytics: () => analyticsMock,
}));

vi.mock("@/components/forms/analytics/block-analytics-display", () => ({
  BlockAnalyticsDisplay: () => <section data-testid="block-analytics" />,
}));

function renderAnalytics(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<FormResponseAnalytics formId="form-1" />);
  });
  return root;
}

beforeEach(() => {
  analyticsMock.analyticsQuery = {
    data: { timeline: [] },
    error: null,
    isLoading: false,
  };
  analyticsMock.blockAnalyticsQuery = {
    data: { blocks: [] },
    error: null,
    isLoading: false,
  };
});

describe("FormResponseAnalytics", () => {
  it("renders an empty analytics state instead of an error for successful empty data", () => {
    const container = document.createElement("div");
    const root = renderAnalytics(container);

    expect(container.textContent).toContain("分析対象の回答はまだありません。");
    expect(container.textContent).toContain("総レスポンス数");
    expect(container.textContent).toContain("0");
    expect(container.textContent).not.toContain(
      "分析データの読み込みに失敗しました",
    );

    act(() => root.unmount());
  });

  it("keeps block analytics load failures distinct from the empty state", () => {
    analyticsMock.blockAnalyticsQuery = {
      data: undefined,
      error: new Error("block server failure"),
      isLoading: false,
    };

    const container = document.createElement("div");
    const root = renderAnalytics(container);

    expect(container.textContent).toContain(
      "ブロック別分析の読み込みに失敗しました",
    );
    expect(container.textContent).not.toContain(
      "分析対象の回答はまだありません。",
    );

    act(() => root.unmount());
  });

  it("keeps rendering the load failure state for analytics query errors", () => {
    analyticsMock.analyticsQuery = {
      data: undefined,
      error: new Error("server failure"),
      isLoading: false,
    };

    const container = document.createElement("div");
    const root = renderAnalytics(container);

    expect(container.textContent).toContain(
      "分析データの読み込みに失敗しました",
    );
    expect(container.textContent).not.toContain(
      "分析対象の回答はまだありません。",
    );

    act(() => root.unmount());
  });
});
