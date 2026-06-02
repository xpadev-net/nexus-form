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

vi.mock("@/components/forms/analytics/grid-chart", () => ({
  GridChartDisplay: () => <section data-testid="grid-chart" />,
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

  it("renders block analytics when grid analytics payloads are returned", () => {
    analyticsMock.analyticsQuery = {
      data: { timeline: [{ date: "2026-05-17", count: 2 }] },
      error: null,
      isLoading: false,
    };
    analyticsMock.blockAnalyticsQuery = {
      data: {
        blocks: [
          {
            block_id: "choice-grid",
            block_type: "choice_grid",
            block_title: "参加可能日",
            total_responses: 2,
            response_rate: 1,
            analytics_data: {
              grid_type: "choice_grid",
              rows: [{ id: "monday", label: "月曜" }],
              columns: [{ id: "morning", label: "午前" }],
              row_analytics: [
                {
                  row_label: "月曜",
                  column_counts: [{ column_id: "morning", count: 2 }],
                },
              ],
              column_analytics: [
                {
                  column_id: "morning",
                  column_label: "午前",
                  row_counts: [{ row_label: "月曜", count: 2 }],
                },
              ],
              total_responses: 2,
              response_rate: 1,
              invalid_responses: [],
            },
          },
        ],
      },
      error: null,
      isLoading: false,
    };

    const container = document.createElement("div");
    const root = renderAnalytics(container);

    expect(container.textContent).toContain("ブロック別分析");
    expect(container.textContent).toContain("参加可能日");
    expect(container.textContent).not.toContain(
      "グリッドデータの形式が正しくありません",
    );
    expect(
      container.querySelectorAll("[data-testid='grid-chart']"),
    ).toHaveLength(1);
    expect(container.textContent).not.toContain(
      "ブロック別分析の読み込みに失敗しました",
    );

    act(() => root.unmount());
  });
});
