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
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { labelToCssColor } from "@/lib/utils/color";
import type { GridAnalytics, GridRowChoiceCount } from "@/types/api/analytics";

interface GridChartDisplayProps {
  data: GridAnalytics;
  blockTitle?: string;
  totalResponses: number;
}

// チャート設定
const createChartConfig = (columns: GridAnalytics["columns"]): ChartConfig => {
  const config: ChartConfig = {};

  columns.forEach((column) => {
    // ラベルをそのまま凡例表示に使う
    config[column.id] = {
      label: column.label,
    };
    // name を使う場合にも対応できるよう、ラベルキーでも定義
    config[column.label] = {
      label: column.label,
    };
  });

  return config;
};

// データ変換関数（Choice Grid用 - 積み上げ棒グラフ）
const transformDataForChoiceGrid = (
  rowAnalytics: GridRowChoiceCount[],
  columns: GridAnalytics["columns"],
) => {
  return rowAnalytics.map((row) => {
    const dataPoint: Record<string, number | string> = {
      row_label: row.row_label,
    };

    // 各列のカウントを追加
    columns.forEach((column) => {
      const columnCount = row.column_counts.find(
        (cc) => cc.column_id === column.id,
      );
      dataPoint[column.id] = columnCount?.count || 0;
    });

    return dataPoint;
  });
};

// データ変換関数（Checkbox Grid用 - グループ化棒グラフ）
const transformDataForCheckboxGrid = (
  rowAnalytics: GridRowChoiceCount[],
  columns: GridAnalytics["columns"],
) => {
  // Checkbox GridもChoice Gridと同じ構造にする
  // 各行を1つのデータポイントとして、各列の値を別々のキーに格納
  return rowAnalytics.map((row) => {
    const dataPoint: Record<string, number | string> = {
      row_label: row.row_label,
    };

    // 各列のカウントを追加
    columns.forEach((column) => {
      const columnCount = row.column_counts.find(
        (cc) => cc.column_id === column.id,
      );
      dataPoint[column.id] = columnCount?.count || 0;
    });

    return dataPoint;
  });
};

export const GridChartDisplay: FC<GridChartDisplayProps> = ({
  data,
  blockTitle,
  totalResponses,
}) => {
  // 回答がない場合のエンプティステート
  if (totalResponses === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-muted-foreground/25">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">まだ回答がありません</p>
          {blockTitle && (
            <p className="text-xs text-muted-foreground mt-1">{blockTitle}</p>
          )}
        </div>
      </div>
    );
  }

  const chartConfig = createChartConfig(data.columns);
  const isChoiceGrid = data.grid_type === "choice_grid";

  // データ変換
  const chartData = isChoiceGrid
    ? transformDataForChoiceGrid(data.row_analytics, data.columns)
    : transformDataForCheckboxGrid(data.row_analytics, data.columns);

  return (
    <div className="space-y-4">
      {/* ブロックタイトル */}
      {blockTitle && (
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{blockTitle}</h3>
          <p className="text-sm text-muted-foreground">
            総回答数: {totalResponses.toLocaleString()}件
          </p>
        </div>
      )}

      {/* チャート */}
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
              ? // Choice Grid: 積み上げ棒グラフ
                data.columns.map((column) => (
                  <Bar
                    key={column.id}
                    dataKey={column.id}
                    stackId="a"
                    fill={labelToCssColor(column.label)}
                    name={column.label}
                  />
                ))
              : // Checkbox Grid: グループ化棒グラフ
                data.columns.map((column) => (
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

      {/* 統計情報 */}
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
