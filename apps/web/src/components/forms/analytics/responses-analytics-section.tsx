import { PieChartDisplay } from "@/components/forms/analytics/choice-chart";
import { DateDistributionChart } from "@/components/forms/analytics/date-time-chart";
import { GridChartDisplay } from "@/components/forms/analytics/grid-chart";
import { TextResponseList } from "@/components/forms/analytics/text-response-list";
import type {
  ChoiceOptionAnalytics,
  DateAnalytics,
  GridAnalytics,
  TextResponseAnalytics,
} from "@/types/api/analytics";

interface ResponsesAnalyticsSectionProps {
  title?: string;
  choiceData?: ChoiceOptionAnalytics[];
  choiceTotalResponses?: number;
  dateData?: DateAnalytics;
  gridData?: GridAnalytics;
  gridTotalResponses?: number;
  textResponses?: TextResponseAnalytics[];
}

const EMPTY_CHOICE_DATA: ChoiceOptionAnalytics[] = [];
const EMPTY_TEXT_RESPONSES: TextResponseAnalytics[] = [];

export function ResponsesAnalyticsSection({
  title = "回答分析",
  choiceData = EMPTY_CHOICE_DATA,
  choiceTotalResponses = 0,
  dateData,
  gridData,
  gridTotalResponses = 0,
  textResponses = EMPTY_TEXT_RESPONSES,
}: ResponsesAnalyticsSectionProps) {
  return (
    <section className="space-y-4 rounded border p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <PieChartDisplay
          data={choiceData}
          totalResponses={choiceTotalResponses}
        />
        {dateData && <DateDistributionChart data={dateData} />}
        {gridData && (
          <GridChartDisplay
            data={gridData}
            totalResponses={gridTotalResponses}
          />
        )}
        <TextResponseList responses={textResponses} blockType="short_text" />
      </div>
    </section>
  );
}
