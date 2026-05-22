import { type FC, lazy, Suspense } from "react";
import { ChartLoadingFallback } from "@/components/forms/analytics/chart-loading-fallback";
import type { ChoiceOptionAnalytics } from "@/types/api/analytics";

let choiceChartChartsImport: Promise<
  typeof import("./choice-chart-charts")
> | null = null;

function loadChoiceChartCharts() {
  choiceChartChartsImport ??= import("./choice-chart-charts").catch((error) => {
    choiceChartChartsImport = null;
    throw error;
  });
  return choiceChartChartsImport;
}

const LazyPieChartDisplayCharts = lazy(() =>
  loadChoiceChartCharts().then((m) => ({
    default: m.PieChartDisplayCharts,
  })),
);

const LazyHorizontalBarChartDisplayCharts = lazy(() =>
  loadChoiceChartCharts().then((m) => ({
    default: m.HorizontalBarChartDisplayCharts,
  })),
);

const LazyVerticalBarChartDisplayCharts = lazy(() =>
  loadChoiceChartCharts().then((m) => ({
    default: m.VerticalBarChartDisplayCharts,
  })),
);

interface PieChartDisplayProps {
  data: ChoiceOptionAnalytics[];
  blockTitle?: string;
  totalResponses: number;
}

export const PieChartDisplay: FC<PieChartDisplayProps> = ({
  data,
  blockTitle,
  totalResponses,
}) => {
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

  return (
    <Suspense fallback={<ChartLoadingFallback />}>
      <LazyPieChartDisplayCharts
        data={data}
        blockTitle={blockTitle}
        totalResponses={totalResponses}
      />
    </Suspense>
  );
};

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

  return (
    <Suspense fallback={<ChartLoadingFallback />}>
      <LazyHorizontalBarChartDisplayCharts
        data={data}
        blockTitle={blockTitle}
        totalResponses={totalResponses}
      />
    </Suspense>
  );
};

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

  return (
    <Suspense fallback={<ChartLoadingFallback />}>
      <LazyVerticalBarChartDisplayCharts data={data} blockTitle={blockTitle} />
    </Suspense>
  );
};
