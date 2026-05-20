import type { FC } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  BlockAnalyticsResult,
  ChoiceAnalytics,
  DateAnalytics,
  GridAnalytics,
  TextAnalytics,
  TimeAnalytics,
} from "@/types/api/analytics";
import {
  HorizontalBarChartDisplay,
  PieChartDisplay,
  VerticalBarChartDisplay,
} from "./choice-chart";
import {
  DateDistributionChart,
  TimeDistributionChart,
} from "./date-time-chart";
import { GridChartDisplay } from "./grid-chart";
import { TextResponseList } from "./text-response-list";

interface BlockAnalyticsDisplayProps {
  data: BlockAnalyticsResult;
}

// ブロックタイプの日本語表示名
const BLOCK_TYPE_LABELS: Record<string, string> = {
  radio: "ラジオボタン",
  dropdown: "ドロップダウン",
  checkbox: "チェックボックス",
  linear_scale: "リニアスケール",
  rating: "レーティング",
  choice_grid: "選択式グリッド",
  checkbox_grid: "チェックボックスグリッド",
  date: "日付",
  time: "時間",
  short_text: "短いテキスト",
  long_text: "長いテキスト",
};

// 回答率の色分け
const getResponseRateColor = (rate: number): string => {
  if (rate >= 0.8) return "bg-green-100 text-green-800";
  if (rate >= 0.6) return "bg-yellow-100 text-yellow-800";
  if (rate >= 0.4) return "bg-orange-100 text-orange-800";
  return "bg-red-100 text-red-800";
};

// 回答率の表示テキスト
const formatResponseRate = (rate: number): string => {
  return `${(rate * 100).toFixed(1)}%`;
};

// 型ガード関数
const isChoiceAnalytics = (data: unknown): data is ChoiceAnalytics => {
  return (
    typeof data === "object" &&
    data !== null &&
    "total_responses" in data &&
    "options" in data &&
    Array.isArray((data as Record<string, unknown>).options)
  );
};

const isGridAnalytics = (data: unknown): data is GridAnalytics => {
  return (
    typeof data === "object" &&
    data !== null &&
    "grid_type" in data &&
    "rows" in data &&
    "columns" in data &&
    "row_analytics" in data &&
    "column_analytics" in data
  );
};

const isDateAnalytics = (data: unknown): data is DateAnalytics => {
  return (
    typeof data === "object" &&
    data !== null &&
    "block_id" in data &&
    "form_id" in data &&
    "total_responses" in data &&
    "distribution" in data &&
    "responses" in data
  );
};

const isTimeAnalytics = (data: unknown): data is TimeAnalytics => {
  return (
    typeof data === "object" &&
    data !== null &&
    "block_id" in data &&
    "form_id" in data &&
    "total_responses" in data &&
    "distribution" in data &&
    "responses" in data
  );
};

const isTextAnalytics = (data: unknown): data is TextAnalytics => {
  return (
    typeof data === "object" &&
    data !== null &&
    "total_responses" in data &&
    ("responses" in data || "word_count_stats" in data)
  );
};

// エンプティステートコンポーネント
const EmptyState: FC<{ blockTitle?: string; blockType: string }> = ({
  blockTitle,
  blockType,
}) => (
  <Card>
    <CardContent className="flex h-64 items-center justify-center">
      <div className="text-center">
        <div className="text-muted-foreground">
          <p className="text-lg font-medium">データがありません</p>
          <p className="text-sm">
            {blockTitle ? `${blockTitle}の` : ""}回答データがまだありません
          </p>
        </div>
        <Badge variant="secondary" className="mt-2">
          {BLOCK_TYPE_LABELS[blockType] || blockType}
        </Badge>
      </div>
    </CardContent>
  </Card>
);

// エラーステートコンポーネント
const ErrorState: FC<{ blockTitle?: string; error: string }> = ({
  blockTitle,
  error,
}) => (
  <Card>
    <CardContent className="flex h-64 items-center justify-center">
      <div className="text-center">
        <div className="text-destructive">
          <p className="text-lg font-medium">エラーが発生しました</p>
          <p className="text-sm">{error}</p>
        </div>
        {blockTitle && (
          <p className="text-xs text-muted-foreground mt-2">{blockTitle}</p>
        )}
      </div>
    </CardContent>
  </Card>
);

// 選択式ブロックのレンダリング
const ChoiceBlockContent = ({
  blockType,
  analytics,
  blockTitle,
  totalResponses,
}: {
  blockType: string;
  analytics: ChoiceAnalytics;
  blockTitle?: string;
  totalResponses: number;
}) => {
  if (blockType === "radio" || blockType === "dropdown") {
    return (
      <PieChartDisplay
        data={analytics.options}
        blockTitle={blockTitle}
        totalResponses={totalResponses}
      />
    );
  }

  if (blockType === "checkbox") {
    return (
      <HorizontalBarChartDisplay
        data={analytics.options}
        blockTitle={blockTitle}
        totalResponses={totalResponses}
      />
    );
  }

  if (blockType === "linear_scale" || blockType === "rating") {
    return (
      <VerticalBarChartDisplay
        data={analytics.options}
        blockTitle={blockTitle}
        totalResponses={totalResponses}
      />
    );
  }

  return null;
};

// グリッドブロックのレンダリング
const GridBlockContent = ({
  analytics,
  blockTitle,
  totalResponses,
}: {
  analytics: GridAnalytics;
  blockTitle?: string;
  totalResponses: number;
}) => (
  <GridChartDisplay
    data={analytics}
    blockTitle={blockTitle}
    totalResponses={totalResponses}
  />
);

// 日付ブロックのレンダリング
const DateBlockContent = ({
  analytics,
  blockTitle,
}: {
  analytics: DateAnalytics;
  blockTitle?: string;
}) => (
  <div className="space-y-6">
    <DateDistributionChart data={analytics} blockTitle={blockTitle} />
    <TextResponseList
      responses={analytics.responses}
      blockTitle={`${blockTitle} - 回答一覧`}
      blockType="date"
    />
  </div>
);

// 時間ブロックのレンダリング
const TimeBlockContent = ({
  analytics,
  blockTitle,
}: {
  analytics: TimeAnalytics;
  blockTitle?: string;
}) => (
  <div className="space-y-6">
    <TimeDistributionChart data={analytics} blockTitle={blockTitle} />
    <TextResponseList
      responses={analytics.responses}
      blockTitle={`${blockTitle} - 回答一覧`}
      blockType="time"
    />
  </div>
);

// テキストブロックのレンダリング
const TextBlockContent = ({
  analytics,
  blockTitle,
  blockType,
}: {
  analytics: TextAnalytics;
  blockTitle?: string;
  blockType: string;
}) => {
  if (!analytics.responses || analytics.responses.length === 0) {
    return <EmptyState blockTitle={blockTitle} blockType={blockType} />;
  }

  return (
    <TextResponseList
      responses={analytics.responses}
      blockTitle={blockTitle}
      blockType={blockType as "short_text" | "long_text"}
    />
  );
};

interface BlockAnalyticsContentProps {
  blockType: string;
  blockTitle?: string;
  totalResponses: number;
  analyticsData: unknown;
}

const BlockAnalyticsContent: FC<BlockAnalyticsContentProps> = ({
  blockType,
  blockTitle,
  totalResponses,
  analyticsData,
}) => {
  try {
    // 選択式ブロック
    if (
      ["radio", "dropdown", "checkbox", "linear_scale", "rating"].includes(
        blockType,
      )
    ) {
      if (!isChoiceAnalytics(analyticsData)) {
        return (
          <ErrorState
            blockTitle={blockTitle}
            error="選択式データの形式が正しくありません"
          />
        );
      }

      return (
        <ChoiceBlockContent
          blockType={blockType}
          analytics={analyticsData}
          blockTitle={blockTitle}
          totalResponses={totalResponses}
        />
      );
    }

    // グリッドブロック
    if (["choice_grid", "checkbox_grid"].includes(blockType)) {
      if (!isGridAnalytics(analyticsData)) {
        return (
          <ErrorState
            blockTitle={blockTitle}
            error="グリッドデータの形式が正しくありません"
          />
        );
      }

      return (
        <GridBlockContent
          analytics={analyticsData}
          blockTitle={blockTitle}
          totalResponses={totalResponses}
        />
      );
    }

    // 日付ブロック
    if (blockType === "date") {
      if (!isDateAnalytics(analyticsData)) {
        return (
          <ErrorState
            blockTitle={blockTitle}
            error="日付データの形式が正しくありません"
          />
        );
      }

      return (
        <DateBlockContent analytics={analyticsData} blockTitle={blockTitle} />
      );
    }

    // 時間ブロック
    if (blockType === "time") {
      if (!isTimeAnalytics(analyticsData)) {
        return (
          <ErrorState
            blockTitle={blockTitle}
            error="時間データの形式が正しくありません"
          />
        );
      }

      return (
        <TimeBlockContent analytics={analyticsData} blockTitle={blockTitle} />
      );
    }

    // テキストブロック
    if (["short_text", "long_text"].includes(blockType)) {
      if (!isTextAnalytics(analyticsData)) {
        return (
          <ErrorState
            blockTitle={blockTitle}
            error="テキストデータの形式が正しくありません"
          />
        );
      }

      return (
        <TextBlockContent
          analytics={analyticsData}
          blockTitle={blockTitle}
          blockType={blockType}
        />
      );
    }

    // 未対応のブロックタイプ
    return (
      <ErrorState
        blockTitle={blockTitle}
        error={`未対応のブロックタイプ: ${blockType}`}
      />
    );
  } catch (error) {
    return (
      <ErrorState
        blockTitle={blockTitle}
        error={`データの処理中にエラーが発生しました: ${
          error instanceof Error ? error.message : "不明なエラー"
        }`}
      />
    );
  }
};

export const BlockAnalyticsDisplay: FC<BlockAnalyticsDisplayProps> = ({
  data,
}) => {
  const {
    block_id,
    block_type,
    block_title,
    total_responses,
    response_rate,
    analytics_data,
  } = data;

  // データが空の場合
  if (total_responses === 0) {
    return <EmptyState blockTitle={block_title} blockType={block_type} />;
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">
            {block_title || `ブロック ${block_id}`}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">
              {BLOCK_TYPE_LABELS[block_type] || block_type}
            </Badge>
            <Badge
              variant="secondary"
              className={getResponseRateColor(response_rate)}
            >
              {formatResponseRate(response_rate)}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>回答数: {total_responses.toLocaleString()}件</span>
          <span>ブロックID: {block_id}</span>
        </div>
      </CardHeader>
      <CardContent>
        <BlockAnalyticsContent
          blockType={block_type}
          blockTitle={block_title}
          totalResponses={total_responses}
          analyticsData={analytics_data}
        />
      </CardContent>
    </Card>
  );
};
