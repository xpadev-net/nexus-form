// Analytics API response types

/** Text response analytics data */
export interface TextResponseAnalytics {
  response_id: string;
  submitted_at: string;
  value: string;
}

/** Date response analytics data */
export interface DateResponse {
  response_id: string;
  submitted_at: string;
  date: string;
}

/** Time response analytics data */
export interface TimeResponse {
  response_id: string;
  submitted_at: string;
  time: string;
}

/** Choice option analytics */
export interface ChoiceOptionAnalytics {
  label: string;
  count: number;
  percentage: number;
}

/** Choice analytics (radio, dropdown, checkbox, linear_scale, rating) */
export interface ChoiceAnalytics {
  total_responses: number;
  options: ChoiceOptionAnalytics[];
}

/** Date distribution point */
export interface DateDistributionPoint {
  date: string;
  count: number;
  percentage: number;
}

/** Date analytics */
export interface DateAnalytics {
  block_id?: string;
  form_id?: string;
  total_responses?: number;
  distribution: DateDistributionPoint[];
  responses: DateResponse[];
}

/** Time distribution point */
export interface TimeDistributionPoint {
  time: string;
  count: number;
  percentage: number;
}

/** Time analytics */
export interface TimeAnalytics {
  block_id?: string;
  form_id?: string;
  total_responses?: number;
  distribution: TimeDistributionPoint[];
  responses: TimeResponse[];
}

/** Text analytics (short_text, long_text) */
export interface TextAnalytics {
  total_responses: number;
  responses: TextResponseAnalytics[];
  word_count_stats?: {
    average: number;
    min: number;
    max: number;
  };
}

/** Grid column definition */
export interface GridColumn {
  id: string;
  label: string;
}

/** Grid row choice count */
export interface GridRowChoiceCount {
  row_label: string;
  column_counts: Array<{
    column_id: string;
    count: number;
  }>;
}

/** Grid analytics */
export interface GridAnalytics {
  grid_type: "choice_grid" | "checkbox_grid";
  columns: GridColumn[];
  row_analytics: GridRowChoiceCount[];
  response_rate: number;
}

/** Block analytics result */
export interface BlockAnalyticsResult {
  block_id: string;
  block_type: string;
  block_title?: string;
  total_responses: number;
  response_rate: number;
  analytics_data: unknown;
}
