import type { FC } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
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
import type { GridAnalytics, GridRowChoiceCount } from "@/types/api/analytics";

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

const transformDataForChoiceGrid = (
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

const transformDataForCheckboxGrid = (
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

  const chartData = isChoiceGrid
    ? transformDataForChoiceGrid(data.row_analytics, data.columns)
    : transformDataForCheckboxGrid(data.row_analytics, data.columns);

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

      <ChartContainer config={chartConfig} className="h-96 w-full">
        <ResponsiveContainer width="100%" height="100%">
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
        </ResponsiveContainer>
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
