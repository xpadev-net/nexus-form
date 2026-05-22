import { type FC, lazy, Suspense } from "react";
import { ChartLoadingFallback } from "@/components/forms/analytics/chart-loading-fallback";
import type { DateAnalytics, TimeAnalytics } from "@/types/api/analytics";

let dateTimeChartChartsImport: Promise<
  typeof import("./date-time-chart-charts")
> | null = null;

function loadDateTimeChartCharts() {
  dateTimeChartChartsImport ??= import("./date-time-chart-charts").catch(
    (error) => {
      dateTimeChartChartsImport = null;
      throw error;
    },
  );
  return dateTimeChartChartsImport;
}

const LazyDateDistributionChartCharts = lazy(() =>
  loadDateTimeChartCharts().then((m) => ({
    default: m.DateDistributionChartCharts,
  })),
);

const LazyTimeDistributionChartCharts = lazy(() =>
  loadDateTimeChartCharts().then((m) => ({
    default: m.TimeDistributionChartCharts,
  })),
);

interface DateDistributionChartProps {
  data: DateAnalytics;
  blockTitle?: string;
}

export const DateDistributionChart: FC<DateDistributionChartProps> = ({
  data,
  blockTitle,
}) => {
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

  return (
    <Suspense fallback={<ChartLoadingFallback />}>
      <LazyDateDistributionChartCharts data={data} blockTitle={blockTitle} />
    </Suspense>
  );
};

interface TimeDistributionChartProps {
  data: TimeAnalytics;
  blockTitle?: string;
}

export const TimeDistributionChart: FC<TimeDistributionChartProps> = ({
  data,
  blockTitle,
}) => {
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

  return (
    <Suspense fallback={<ChartLoadingFallback />}>
      <LazyTimeDistributionChartCharts data={data} blockTitle={blockTitle} />
    </Suspense>
  );
};
