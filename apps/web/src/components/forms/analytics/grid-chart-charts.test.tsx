// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GridAnalytics } from "@/types/api/analytics";
import { GridChartDisplayCharts } from "./grid-chart-charts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("recharts", () => ({
  Bar: ({ dataKey, name }: { dataKey: string; name: string }) => (
    <div data-testid="bar" data-key={dataKey}>
      {name}
    </div>
  ),
  BarChart: ({
    children,
    data,
  }: {
    children: ReactNode;
    data: Array<Record<string, number | string>>;
  }) => (
    <div data-testid="bar-chart" data-chart-data={JSON.stringify(data)}>
      {children}
    </div>
  ),
  CartesianGrid: () => <div data-testid="cartesian-grid" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
}));

vi.mock("@/components/ui/chart", () => ({
  ChartLegendContent: () => <div data-testid="legend-content" />,
  ChartTooltipContent: () => <div data-testid="tooltip-content" />,
}));

vi.mock("@/components/ui/chart-recharts", () => ({
  ChartContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="chart-container">{children}</div>
  ),
  ChartLegend: () => <div data-testid="chart-legend" />,
  ChartTooltip: () => <div data-testid="chart-tooltip" />,
}));

function renderChart(data: GridAnalytics): {
  container: HTMLElement;
  root: Root;
} {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(
      <GridChartDisplayCharts
        data={data}
        blockTitle="グリッド分析"
        totalResponses={data.total_responses}
      />,
    );
  });
  return { container, root };
}

function oneByOneGrid(): GridAnalytics {
  return {
    grid_type: "choice_grid",
    rows: [{ id: "row-single", label: "単一行" }],
    columns: [{ id: "col-single", label: "単一列" }],
    row_analytics: [
      {
        row_label: "単一行",
        column_counts: [{ column_id: "col-single", count: 1 }],
      },
    ],
    column_analytics: [
      {
        column_id: "col-single",
        column_label: "単一列",
        row_counts: [{ row_label: "単一行", count: 1 }],
      },
    ],
    total_responses: 1,
    response_rate: 1,
    invalid_responses: [],
  };
}

function multiRowCheckboxGrid(): GridAnalytics {
  return {
    grid_type: "checkbox_grid",
    rows: [
      { id: "row-a", label: "月曜" },
      { id: "row-b", label: "火曜" },
    ],
    columns: [
      { id: "col-morning", label: "午前" },
      { id: "col-evening", label: "夜" },
    ],
    row_analytics: [
      {
        row_label: "月曜",
        column_counts: [
          { column_id: "col-morning", count: 1 },
          { column_id: "col-evening", count: 0 },
        ],
      },
      {
        row_label: "火曜",
        column_counts: [
          { column_id: "col-morning", count: 2 },
          { column_id: "col-evening", count: 2 },
        ],
      },
    ],
    column_analytics: [
      {
        column_id: "col-morning",
        column_label: "午前",
        row_counts: [
          { row_label: "月曜", count: 1 },
          { row_label: "火曜", count: 2 },
        ],
      },
      {
        column_id: "col-evening",
        column_label: "夜",
        row_counts: [
          { row_label: "月曜", count: 0 },
          { row_label: "火曜", count: 2 },
        ],
      },
    ],
    total_responses: 3,
    response_rate: 0.75,
    invalid_responses: [
      {
        response_id: "invalid-grid-response",
        reason: 'Unknown grid column "unknown-column" for row "火曜"',
      },
    ],
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("GridChartDisplayCharts", () => {
  it("renders one-row one-column grid analytics without a format error", () => {
    const { container, root } = renderChart(oneByOneGrid());

    expect(container.textContent).toContain("グリッド分析");
    expect(container.textContent).toContain("単一列");
    expect(container.textContent).toContain("総回答数");
    expect(container.textContent).toContain("1");
    expect(container.textContent).not.toContain(
      "グリッドデータの形式が正しくありません",
    );

    act(() => root.unmount());
  });

  it("renders multi-row checkbox grid counts, unanswered rows, and invalid payload notices", () => {
    const { container, root } = renderChart(multiRowCheckboxGrid());
    const chart = container.querySelector("[data-testid='bar-chart']");
    const chartData = JSON.parse(
      chart?.getAttribute("data-chart-data") ?? "[]",
    ) as Array<Record<string, number | string>>;

    expect(chartData).toEqual([
      { row_label: "月曜", "col-morning": 1, "col-evening": 0 },
      { row_label: "火曜", "col-morning": 2, "col-evening": 2 },
    ]);
    expect(container.textContent).toContain("チェックボックスグリッド");
    expect(container.textContent).toContain("invalid-grid-response");
    expect(container.textContent).toContain(
      'Unknown grid column "unknown-column" for row "火曜"',
    );

    act(() => root.unmount());
  });

  it("limits invalid payload notices to ten entries", () => {
    const data = {
      ...multiRowCheckboxGrid(),
      invalid_responses: Array.from({ length: 12 }, (_, index) => ({
        response_id: `invalid-response-${index + 1}`,
        reason: `invalid reason ${index + 1}`,
      })),
    };
    const { container, root } = renderChart(data);

    expect(container.textContent).toContain("invalid-response-1");
    expect(container.textContent).toContain("invalid-response-10");
    expect(container.textContent).not.toContain("invalid-response-11");
    expect(container.textContent).not.toContain("invalid-response-12");
    expect(container.textContent).toContain("ほか 2 件");

    act(() => root.unmount());
  });
});
