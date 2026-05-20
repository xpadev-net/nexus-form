import type { FC } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { labelToCssColor } from "@/lib/utils/color";
import type { ChoiceOptionAnalytics } from "@/types/api/analytics";

interface PieChartDisplayProps {
  data: ChoiceOptionAnalytics[];
  blockTitle?: string;
  totalResponses: number;
}

// ChartConfig の定義
const chartConfig = {
  count: {
    label: "回答数",
  },
  percentage: {
    label: "パーセンテージ",
  },
} as const;

interface PieTooltipPayload {
  name: string;
  value: number;
  percentage: number;
}

interface PieTooltipContentProps {
  active?: boolean;
  payload?: Array<{
    payload: PieTooltipPayload;
  }>;
}

const PieTooltipContent: FC<PieTooltipContentProps> = (props) => {
  const { active, payload } = props;

  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const firstPayload = payload[0];
  if (!firstPayload) return null;
  const data = firstPayload.payload;

  return (
    <ChartTooltipContent
      {...props}
      formatter={(value: unknown, name: unknown) => {
        const numValue = typeof value === "number" ? value : 0;
        const nameStr = typeof name === "string" ? name : "value";
        return [
          <div key="tooltip-content" className="space-y-1">
            <div className="font-medium">{data.name}</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">回答数:</span>
              <span className="font-mono font-medium">
                {numValue.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">割合:</span>
              <span className="font-mono font-medium">
                {data.percentage.toFixed(1)}%
              </span>
            </div>
          </div>,
          nameStr,
        ];
      }}
    />
  );
};

export const PieChartDisplay: FC<PieChartDisplayProps> = ({
  data,
  blockTitle,
  totalResponses,
}) => {
  // データが空の場合のエンプティステート
  if (!data || data.length === 0 || totalResponses === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-muted-foreground/25">
        <div className="text-center">
          <div className="text-sm text-muted-foreground">
            回答データがありません
          </div>
          {blockTitle && (
            <div className="mt-1 text-xs text-muted-foreground">
              {blockTitle}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Recharts用のデータ形式に変換
  const chartData = data.map((option) => ({
    name: option.label,
    value: option.count,
    percentage: option.percentage,
    fill: labelToCssColor(option.label),
  }));

  return (
    <div className="space-y-4">
      {blockTitle && (
        <div className="text-center">
          <h3 className="text-lg font-semibold">{blockTitle}</h3>
          <p className="text-sm text-muted-foreground">
            総回答数: {totalResponses.toLocaleString()}件
          </p>
        </div>
      )}

      <ChartContainer
        config={chartConfig}
        className="mx-auto h-64 w-full max-w-md"
      >
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={80}
            innerRadius={20}
            paddingAngle={2}
            strokeWidth={0}
          >
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Pie>
          <ChartTooltip content={<PieTooltipContent />} />
        </PieChart>
      </ChartContainer>

      {/* 凡例 */}
      <div className="flex flex-wrap justify-center gap-4">
        {chartData.map((item) => (
          <div key={item.name} className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: item.fill }}
            />
            <span className="text-sm">
              {item.name} ({item.percentage.toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// HorizontalBarChartDisplay component for Checkbox (multiple choice)
interface HorizontalBarChartDisplayProps {
  data: ChoiceOptionAnalytics[];
  blockTitle?: string;
  totalResponses: number;
}

export const HorizontalBarChartDisplay: FC<HorizontalBarChartDisplayProps> = ({
  data,
  blockTitle,
  totalResponses,
}) => {
  // Empty state
  if (totalResponses === 0 || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="text-muted-foreground">
          <p className="text-lg font-medium">データがありません</p>
          <p className="text-sm">まだ回答がありません</p>
        </div>
      </div>
    );
  }

  // Prepare data for horizontal bar chart
  const chartData = data.map((option) => ({
    name: option.label,
    count: option.count,
    percentage: option.percentage,
    fill: labelToCssColor(option.label),
  }));

  // Sort by count (descending) for better visualization
  chartData.sort((a, b) => b.count - a.count);

  return (
    <div className="w-full space-y-4">
      {blockTitle && (
        <div className="text-center">
          <h3 className="text-lg font-semibold">{blockTitle}</h3>
          <p className="text-sm text-muted-foreground">
            総回答数: {totalResponses.toLocaleString()}件
          </p>
        </div>
      )}

      <ChartContainer config={chartConfig} className="h-[400px]">
        <BarChart
          layout="vertical"
          data={chartData}
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
            dataKey="name"
            width={120}
            tick={{ fontSize: 12 }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, _name) => [
                  `${value}件 (${((Number(value) / totalResponses) * 100).toFixed(1)}%)`,
                  "回答数",
                ]}
                labelFormatter={(label) => `選択肢: ${label}`}
              />
            }
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>

      {/* Additional statistics */}
      <div className="mt-4 grid grid-cols-1 gap-2 text-sm">
        {chartData.map((item) => (
          <div
            key={item.name}
            className="flex items-center justify-between rounded-md bg-muted/50 p-2"
          >
            <span className="font-medium">{item.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{item.count}件</span>
              <span className="font-mono text-xs text-muted-foreground">
                ({item.percentage.toFixed(1)}%)
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// 縦向き棒グラフ表示コンポーネント（XPA-213で実装）
interface VerticalBarChartDisplayProps {
  data: ChoiceOptionAnalytics[];
  blockTitle?: string;
  totalResponses: number;
}

export const VerticalBarChartDisplay: FC<VerticalBarChartDisplayProps> = ({
  data,
  blockTitle,
  totalResponses,
}) => {
  if (totalResponses === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-muted-foreground/25">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            回答データがありません
          </p>
        </div>
      </div>
    );
  }

  // Linear Scale と Rating 用のデータを準備
  // スケール値（1, 2, 3, 4, 5など）でソート
  const sortedData = [...data].sort((a, b) => {
    const aValue = parseFloat(a.label);
    const bValue = parseFloat(b.label);
    return aValue - bValue;
  });

  const baseFill = labelToCssColor(blockTitle ?? "scale");
  const chartData = sortedData.map((item) => ({
    ...item,
    fill: baseFill,
  }));

  return (
    <div className="space-y-4">
      {blockTitle && <h3 className="text-lg font-semibold">{blockTitle}</h3>}
      <ChartContainer config={chartConfig} className="h-64">
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12 }}
            tickLine={{ stroke: "hsl(var(--muted-foreground))" }}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            tickLine={{ stroke: "hsl(var(--muted-foreground))" }}
            axisLine={{ stroke: "hsl(var(--muted-foreground))" }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, _name, props) => [
                  `${value}件 (${props.payload.percentage.toFixed(1)}%)`,
                  "回答数",
                ]}
                labelFormatter={(label) => `スケール値: ${label}`}
              />
            }
          />
          <Bar dataKey="count" fill={baseFill} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>

      {/* バーの上にパーセンテージを表示するためのカスタムレンダリング */}
      <div className="mt-2 grid grid-cols-5 gap-2 text-center text-xs text-muted-foreground">
        {chartData.map((item) => (
          <div key={item.label} className="flex flex-col items-center">
            <span className="font-medium">{item.label}</span>
            <span className="text-xs">{item.percentage.toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};
