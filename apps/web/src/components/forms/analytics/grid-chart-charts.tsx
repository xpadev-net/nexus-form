import type { FC } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartLegendContent,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  ChartContainer,
  ChartLegend,
  ChartTooltip,
} from "@/components/ui/chart-recharts";
import { labelToCssColor } from "@/lib/utils/color";
import type {
  GridAnalytics,
  GridRowChoiceCount,
  InvalidGridResponse,
} from "@/types/api/analytics";

const MAX_INVALID_GRID_RESPONSES_DISPLAYED = 10;

interface InvalidGridResponseListEntry extends InvalidGridResponse {
  key: string;
}

const createChartConfig = (columns: GridAnalytics["columns"]): ChartConfig => {
  const config: ChartConfig = {};

  columns.forEach((column) => {
    config[column.id] = {
      label: column.label,
    };
    config[column.label] = {
      label: column.label,
    };
  });

  return config;
};

const transformGridData = (
  rowAnalytics: GridRowChoiceCount[],
  columns: GridAnalytics["columns"],
) => {
  return rowAnalytics.map((row) => {
    const dataPoint: Record<string, number | string> = {
      row_label: row.row_label,
    };

    columns.forEach((column) => {
      const columnCount = row.column_counts.find(
        (cc) => cc.column_id === column.id,
      );
      dataPoint[column.id] = columnCount?.count || 0;
    });

    return dataPoint;
  });
};

function createInvalidResponseListEntries(
  responses: InvalidGridResponse[],
): InvalidGridResponseListEntry[] {
  const keyCounts = new Map<string, number>();

  return responses.map((response) => {
    const baseKey = `${response.response_id}:${response.reason}`;
    const occurrence = keyCounts.get(baseKey) ?? 0;
    keyCounts.set(baseKey, occurrence + 1);
    return {
      ...response,
      key: `${baseKey}:${occurrence}`,
    };
  });
}

export interface GridChartDisplayChartsProps {
  data: GridAnalytics;
  blockTitle?: string;
  totalResponses: number;
}

export const GridChartDisplayCharts: FC<GridChartDisplayChartsProps> = ({
  data,
  blockTitle,
  totalResponses,
}) => {
  const chartConfig = createChartConfig(data.columns);
  const isChoiceGrid = data.grid_type === "choice_grid";
  const invalidResponses = data.invalid_responses ?? [];
  const visibleInvalidResponses = invalidResponses.slice(
    0,
    MAX_INVALID_GRID_RESPONSES_DISPLAYED,
  );
  const visibleInvalidResponseEntries = createInvalidResponseListEntries(
    visibleInvalidResponses,
  );
  const hiddenInvalidResponseCount =
    invalidResponses.length - visibleInvalidResponseEntries.length;

  const chartData = transformGridData(data.row_analytics, data.columns);

  return (
    <div className="space-y-4">
      {blockTitle && (
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{blockTitle}</h3>
          <p className="text-sm text-muted-foreground">
            総回答数: {totalResponses.toLocaleString()}件
          </p>
        </div>
      )}

      {visibleInvalidResponseEntries.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">
            一部の回答をグリッド集計から除外しました
          </p>
          <ul className="mt-2 space-y-1">
            {visibleInvalidResponseEntries.map((response) => (
              <li key={response.key} className="break-words">
                <span className="font-mono">{response.response_id}</span>:{" "}
                {response.reason}
              </li>
            ))}
          </ul>
          {hiddenInvalidResponseCount > 0 && (
            <p className="mt-2 text-xs">
              ほか {hiddenInvalidResponseCount.toLocaleString()} 件
            </p>
          )}
        </div>
      )}

      <ChartContainer config={chartConfig} className="h-96 w-full">
        <BarChart
          data={chartData}
          layout="horizontal"
          margin={{
            top: 20,
            right: 30,
            left: 20,
            bottom: 5,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" />
          <YAxis
            type="category"
            dataKey="row_label"
            width={120}
            tick={{ fontSize: 12 }}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />

          {isChoiceGrid
            ? data.columns.map((column) => (
                <Bar
                  key={column.id}
                  dataKey={column.id}
                  stackId="a"
                  fill={labelToCssColor(column.label)}
                  name={column.label}
                />
              ))
            : data.columns.map((column) => (
                <Bar
                  key={column.id}
                  dataKey={column.id}
                  fill={labelToCssColor(column.label)}
                  name={column.label}
                />
              ))}
        </BarChart>
      </ChartContainer>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border p-3">
          <p className="text-sm font-medium">総回答数</p>
          <p className="text-2xl font-bold">
            {totalResponses.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-sm font-medium">回答率</p>
          <p className="text-2xl font-bold">
            {(data.response_rate * 100).toFixed(1)}%
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-sm font-medium">グリッドタイプ</p>
          <p className="text-sm capitalize">
            {data.grid_type === "choice_grid"
              ? "選択式グリッド"
              : "チェックボックスグリッド"}
          </p>
        </div>
      </div>
    </div>
  );
};
