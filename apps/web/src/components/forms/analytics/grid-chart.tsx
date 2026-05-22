import { type FC, lazy, Suspense } from "react";
import { ChartLoadingFallback } from "@/components/forms/analytics/chart-loading-fallback";
import type { GridAnalytics } from "@/types/api/analytics";

const LazyGridChartDisplayCharts = lazy(() =>
  import("./grid-chart-charts").then((m) => ({
    default: m.GridChartDisplayCharts,
  })),
);

interface GridChartDisplayProps {
  data: GridAnalytics;
  blockTitle?: string;
  totalResponses: number;
}

export const GridChartDisplay: FC<GridChartDisplayProps> = ({
  data,
  blockTitle,
  totalResponses,
}) => {
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

  return (
    <Suspense fallback={<ChartLoadingFallback />}>
      <LazyGridChartDisplayCharts
        data={data}
        blockTitle={blockTitle}
        totalResponses={totalResponses}
      />
    </Suspense>
  );
};
