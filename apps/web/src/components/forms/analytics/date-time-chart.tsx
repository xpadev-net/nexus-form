import { format, parseISO } from "date-fns";
import { ja } from "date-fns/locale/ja";
import type { FC } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import type {
  DateAnalytics,
  DateDistributionPoint,
  TimeAnalytics,
  TimeDistributionPoint,
} from "@/types/api/analytics";

// チャート設定
const chartConfig = {
  count: {
    label: "回答数",
    color: "hsl(var(--chart-1))",
  },
};

// 日付分布チャートのプロパティ
interface DateDistributionChartProps {
  data: DateAnalytics;
  blockTitle?: string;
}

// 時間分布チャートのプロパティ
interface TimeDistributionChartProps {
  data: TimeAnalytics;
  blockTitle?: string;
}

// ツールチップのデータ型
interface TooltipData {
  formattedDate?: string;
  formattedTime?: string;
  count: number;
  percentage: number;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: TooltipData }>;
}

const DateDistributionTooltip: FC<TooltipProps> = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0]?.payload;
    if (!data) return null;
    return (
      <div className="rounded-lg border bg-background p-3 shadow-md">
        <p className="font-medium">{data.formattedDate}</p>
        <p className="text-sm text-muted-foreground">
          回答数: {data.count}件 ({data.percentage.toFixed(1)}%)
        </p>
      </div>
    );
  }
  return null;
};

const TimeDistributionTooltip: FC<TooltipProps> = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0]?.payload;
    if (!data) return null;
    return (
      <div className="rounded-lg border bg-background p-3 shadow-md">
        <p className="font-medium">{data.formattedTime}</p>
        <p className="text-sm text-muted-foreground">
          回答数: {data.count}件 ({data.percentage.toFixed(1)}%)
        </p>
      </div>
    );
  }
  return null;
};

// 日付分布チャートコンポーネント
export const DateDistributionChart: FC<DateDistributionChartProps> = ({
  data,
  blockTitle,
}) => {
  // データが空の場合はエンプティステートを表示
  if (!data.distribution || data.distribution.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-muted-foreground/25">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            {blockTitle ? `${blockTitle}の` : ""}日付分布データがありません
          </p>
        </div>
      </div>
    );
  }

  // 日付データをチャート用に変換
  const chartData = data.distribution
    .map((point: DateDistributionPoint) => ({
      date: point.date,
      formattedDate: format(parseISO(point.date), "M月d日", { locale: ja }),
      count: point.count,
      percentage: point.percentage,
    }))
    .sort(
      (a: { date: string }, b: { date: string }) =>
        new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

  return (
    <div className="space-y-4">
      {blockTitle && <h3 className="text-lg font-semibold">{blockTitle}</h3>}
      <ChartContainer config={chartConfig} className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{
              top: 20,
              right: 30,
              left: 20,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="formattedDate"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis tick={{ fontSize: 12 }} />
            <ChartTooltip content={<DateDistributionTooltip />} />
            <Bar
              dataKey="count"
              fill="var(--color-count)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
};

// 時間分布チャートコンポーネント
export const TimeDistributionChart: FC<TimeDistributionChartProps> = ({
  data,
  blockTitle,
}) => {
  // データが空の場合はエンプティステートを表示
  if (!data.distribution || data.distribution.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-muted-foreground/25">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            {blockTitle ? `${blockTitle}の` : ""}時間分布データがありません
          </p>
        </div>
      </div>
    );
  }

  // 時間データをチャート用に変換
  const chartData = data.distribution
    .map((point: TimeDistributionPoint) => ({
      time: point.time,
      formattedTime: point.time,
      count: point.count,
      percentage: point.percentage,
    }))
    .sort((a: { time: string }, b: { time: string }) => {
      // 時間でソート（HH:MM形式）
      const [aHour, aMin] = a.time.split(":").map(Number);
      const [bHour, bMin] = b.time.split(":").map(Number);
      return (
        (aHour ?? 0) * 60 + (aMin ?? 0) - ((bHour ?? 0) * 60 + (bMin ?? 0))
      );
    });

  return (
    <div className="space-y-4">
      {blockTitle && <h3 className="text-lg font-semibold">{blockTitle}</h3>}
      <ChartContainer config={chartConfig} className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{
              top: 20,
              right: 30,
              left: 20,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="formattedTime"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis tick={{ fontSize: 12 }} />
            <ChartTooltip content={<TimeDistributionTooltip />} />
            <Bar
              dataKey="count"
              fill="var(--color-count)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
};
