/**
 * 回答分析サービス
 * ブロック種別ごとの回答データを集計する
 */

import { z } from "zod";
import { logWarn } from "../logger";

// ===== 型定義 =====

const ResponseItemSchema = z.object({
  question_id: z.string(),
  question_type: z.string(),
  value: z.unknown().optional(),
  values: z.array(z.unknown()).optional(),
  responses: z.record(z.string(), z.unknown()).optional(),
  other_value: z.string().optional(),
  other_values: z.array(z.string()).optional(),
});

type ResponseItem = z.infer<typeof ResponseItemSchema>;

const ResponseItemsSchema = z.array(ResponseItemSchema);

interface BlockInfo {
  blockId: string;
  type: string;
  title: string;
  validation: Record<string, unknown>;
}

interface ChoiceOption {
  id: string;
  label: string;
}

const ChoiceOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
});

interface GridRowDef {
  id: string;
  label: string;
}

interface GridColumnDef {
  id: string;
  label: string;
}

const GridDefinitionSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
    }),
  ),
  columns: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
    }),
  ),
});

// フロントエンドの BlockAnalyticsResult に一致する出力型
interface BlockAnalyticsResult {
  block_id: string;
  block_type: string;
  block_title: string;
  total_responses: number;
  response_rate: number;
  analytics_data: unknown;
}

interface ChoiceOptionAnalytics {
  label: string;
  count: number;
  percentage: number;
}

interface ChoiceAnalytics {
  total_responses: number;
  options: ChoiceOptionAnalytics[];
}

const ChoiceAnalyticsSchema = z.object({
  total_responses: z.number(),
  options: z.array(
    z.object({
      label: z.string(),
      count: z.number(),
      percentage: z.number(),
    }),
  ),
});

interface GridColumn {
  id: string;
  label: string;
}

interface GridRowChoiceCount {
  row_label: string;
  column_counts: Array<{ column_id: string; count: number }>;
}

interface GridAnalytics {
  grid_type: "choice_grid" | "checkbox_grid";
  columns: GridColumn[];
  row_analytics: GridRowChoiceCount[];
  total_responses: number;
  response_rate: number;
}

const GridAnalyticsSchema = z.object({
  grid_type: z.enum(["choice_grid", "checkbox_grid"]),
  columns: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
    }),
  ),
  row_analytics: z.array(
    z.object({
      row_label: z.string(),
      column_counts: z.array(
        z.object({
          column_id: z.string(),
          count: z.number(),
        }),
      ),
    }),
  ),
  total_responses: z.number(),
  response_rate: z.number(),
});

interface DateDistributionPoint {
  date: string;
  count: number;
  percentage: number;
}

interface DateResponseEntry {
  response_id: string;
  submitted_at: string;
  date: string;
}

interface DateAnalytics {
  block_id: string;
  form_id: string;
  total_responses: number;
  distribution: DateDistributionPoint[];
  responses: DateResponseEntry[];
}

const DateAnalyticsSchema = z.object({
  block_id: z.string(),
  form_id: z.string(),
  total_responses: z.number(),
  distribution: z.array(
    z.object({
      date: z.string(),
      count: z.number(),
      percentage: z.number(),
    }),
  ),
  responses: z.array(
    z.object({
      response_id: z.string(),
      submitted_at: z.string(),
      date: z.string(),
    }),
  ),
});

interface TimeDistributionPoint {
  time: string;
  count: number;
  percentage: number;
}

interface TimeResponseEntry {
  response_id: string;
  submitted_at: string;
  time: string;
}

interface TimeAnalytics {
  block_id: string;
  form_id: string;
  total_responses: number;
  distribution: TimeDistributionPoint[];
  responses: TimeResponseEntry[];
}

const TimeAnalyticsSchema = z.object({
  block_id: z.string(),
  form_id: z.string(),
  total_responses: z.number(),
  distribution: z.array(
    z.object({
      time: z.string(),
      count: z.number(),
      percentage: z.number(),
    }),
  ),
  responses: z.array(
    z.object({
      response_id: z.string(),
      submitted_at: z.string(),
      time: z.string(),
    }),
  ),
});

interface TextResponseEntry {
  response_id: string;
  submitted_at: string;
  value: string;
}

interface TextAnalytics {
  total_responses: number;
  responses: TextResponseEntry[];
  word_count_stats?: {
    average: number;
    min: number;
    max: number;
  };
}

const TextAnalyticsSchema = z.object({
  total_responses: z.number(),
  responses: z.array(
    z.object({
      response_id: z.string(),
      submitted_at: z.string(),
      value: z.string(),
    }),
  ),
  word_count_stats: z
    .object({
      average: z.number(),
      min: z.number(),
      max: z.number(),
    })
    .optional(),
});

type RawResponseRow = {
  id: string;
  submittedAt: Date | string;
  responseDataJson: string;
};

type RawBlock = {
  blockId: string;
  type: string;
  content: unknown;
};

type ResponseBatchCursor = Pick<RawResponseRow, "id" | "submittedAt">;

/**
 * Loads one page of responses sorted by `submittedAt DESC, id DESC`.
 *
 * When `cursor` is present, it is the last row returned by the previous page.
 * The next page must start strictly after that cursor in the same sort order
 * and must not include the cursor row again.
 */
type ResponseBatchLoader = (
  cursor: ResponseBatchCursor | undefined,
  limit: number,
) => Promise<RawResponseRow[]>;

interface AggregateBatchOptions {
  batchSize?: number;
  detailResponseLimit?: number;
}

const DEFAULT_AGGREGATION_BATCH_SIZE = 500;
const DEFAULT_DETAIL_RESPONSE_LIMIT = 1000;

interface TextMergeStats {
  total: number;
  characterSum: number;
  min?: number;
  max?: number;
}

interface AggregateBlocksResult {
  results: BlockAnalyticsResult[];
  totalResponseCount: number;
}

// ===== 回答データ解析 =====

interface ParsedResponse {
  id: string;
  submittedAt: string;
  items: ResponseItem[];
}

function parseResponseData(
  id: string,
  submittedAt: Date | string,
  responseDataJson: string,
): ParsedResponse | null {
  try {
    const parsed: unknown = JSON.parse(responseDataJson);
    const result = ResponseItemsSchema.safeParse(parsed);
    if (!result.success) return null;
    return {
      id,
      submittedAt:
        submittedAt instanceof Date
          ? submittedAt.toISOString()
          : String(submittedAt),
      items: result.data,
    };
  } catch {
    logWarn("Failed to parse response data JSON", "api", {
      responseId: id,
    });
    return null;
  }
}

const BlockContentSchema = z.object({
  title: z.string().optional().default(""),
  validation: z.record(z.string(), z.unknown()).optional().default({}),
});

function parseBlockContent(content: unknown): {
  title: string;
  validation: Record<string, unknown>;
} {
  let raw: unknown = content;
  if (typeof content === "string") {
    try {
      raw = JSON.parse(content);
    } catch {
      return { title: "", validation: {} };
    }
  }
  const result = BlockContentSchema.safeParse(raw);
  if (!result.success) return { title: "", validation: {} };
  return result.data;
}

// ===== 選択式ブロック (radio, checkbox, dropdown) =====

function aggregateChoice(
  block: BlockInfo,
  responses: ParsedResponse[],
): ChoiceAnalytics {
  const optionsResult = z
    .array(ChoiceOptionSchema)
    .safeParse(block.validation.options);
  if (!optionsResult.success) {
    logWarn("Invalid choice analytics options; using empty options", "api", {
      blockId: block.blockId,
      blockType: block.type,
      issues: optionsResult.error.issues,
    });
  }
  const options: ChoiceOption[] = optionsResult.success
    ? optionsResult.data
    : [];
  const optionCounts = new Map<string, number>();

  for (const opt of options) {
    optionCounts.set(opt.id, 0);
  }

  let totalResponses = 0;

  for (const resp of responses) {
    for (const item of resp.items) {
      if (item.question_id !== block.blockId) continue;

      totalResponses++;

      if (item.question_type === "checkbox" && Array.isArray(item.values)) {
        for (const val of item.values) {
          const key = String(val);
          if (optionCounts.has(key)) {
            optionCounts.set(key, (optionCounts.get(key) ?? 0) + 1);
          }
        }
      } else if (item.value !== undefined && item.value !== null) {
        const key = String(item.value);
        if (optionCounts.has(key)) {
          optionCounts.set(key, (optionCounts.get(key) ?? 0) + 1);
        }
      }
    }
  }

  const analyticsOptions: ChoiceOptionAnalytics[] = options.map((opt) => {
    const count = optionCounts.get(opt.id) ?? 0;
    return {
      label: opt.label,
      count,
      percentage:
        totalResponses > 0
          ? Math.round((count / totalResponses) * 10000) / 100
          : 0,
    };
  });

  return { total_responses: totalResponses, options: analyticsOptions };
}

// ===== スケールブロック (linear_scale, rating) =====

function aggregateScale(
  block: BlockInfo,
  responses: ParsedResponse[],
): ChoiceAnalytics {
  const validation = block.validation;
  const min = block.type === "linear_scale" ? Number(validation.min ?? 1) : 1;
  const max =
    block.type === "linear_scale"
      ? Number(validation.max ?? 5)
      : Number(validation.maxRating ?? 5);
  const step = Number(validation.step ?? 1);

  const valueCounts = new Map<number, number>();
  for (let v = min; v <= max; v += step) {
    valueCounts.set(v, 0);
  }

  let totalResponses = 0;

  for (const resp of responses) {
    for (const item of resp.items) {
      if (item.question_id !== block.blockId) continue;
      if (item.value === undefined || item.value === null) continue;
      totalResponses++;
      const numVal = Number(item.value);
      if (!Number.isNaN(numVal) && valueCounts.has(numVal)) {
        valueCounts.set(numVal, (valueCounts.get(numVal) ?? 0) + 1);
      }
    }
  }

  const options: ChoiceOptionAnalytics[] = [];
  for (const [val, cnt] of valueCounts) {
    options.push({
      label: String(val),
      count: cnt,
      percentage:
        totalResponses > 0
          ? Math.round((cnt / totalResponses) * 10000) / 100
          : 0,
    });
  }

  return { total_responses: totalResponses, options };
}

// ===== グリッドブロック (choice_grid, checkbox_grid) =====

function aggregateGrid(
  block: BlockInfo,
  responses: ParsedResponse[],
  totalResponseCount: number,
): GridAnalytics {
  const gridDefinitionResult = GridDefinitionSchema.safeParse(block.validation);
  const { rows, columns }: { rows: GridRowDef[]; columns: GridColumnDef[] } =
    gridDefinitionResult.success
      ? gridDefinitionResult.data
      : {
          rows: [],
          columns: [],
        };
  const gridType =
    block.type === "checkbox_grid" ? "checkbox_grid" : "choice_grid";

  let respondentCount = 0;
  const rowColumnCounts = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const colMap = new Map<string, number>();
    for (const col of columns) {
      colMap.set(col.id, 0);
    }
    rowColumnCounts.set(row.id, colMap);
  }

  for (const resp of responses) {
    for (const item of resp.items) {
      if (item.question_id !== block.blockId) continue;
      if (!item.responses) continue;
      respondentCount++;

      for (const [rowId, value] of Object.entries(item.responses)) {
        const colMap = rowColumnCounts.get(rowId);
        if (!colMap) continue;

        if (gridType === "choice_grid" && typeof value === "string") {
          if (colMap.has(value)) {
            colMap.set(value, (colMap.get(value) ?? 0) + 1);
          }
        } else if (gridType === "checkbox_grid" && Array.isArray(value)) {
          for (const v of value) {
            const colId = String(v);
            if (colMap.has(colId)) {
              colMap.set(colId, (colMap.get(colId) ?? 0) + 1);
            }
          }
        }
      }
    }
  }

  const rowAnalytics: GridRowChoiceCount[] = rows.map((row) => {
    const colMap = rowColumnCounts.get(row.id);
    return {
      row_label: row.label,
      column_counts: columns.map((col) => ({
        column_id: col.id,
        count: colMap?.get(col.id) ?? 0,
      })),
    };
  });

  return {
    grid_type: gridType,
    columns: columns.map((c) => ({ id: c.id, label: c.label })),
    row_analytics: rowAnalytics,
    total_responses: respondentCount,
    response_rate:
      totalResponseCount > 0
        ? Math.round((respondentCount / totalResponseCount) * 10000) / 10000
        : 0,
  };
}

// ===== 日付ブロック (date) =====

function aggregateDate(
  block: BlockInfo,
  formId: string,
  responses: ParsedResponse[],
): DateAnalytics {
  const dateResponses: DateResponseEntry[] = [];

  for (const resp of responses) {
    for (const item of resp.items) {
      if (item.question_id !== block.blockId) continue;
      if (item.value === undefined || item.value === null) continue;
      dateResponses.push({
        response_id: resp.id,
        submitted_at: resp.submittedAt,
        date: String(item.value),
      });
    }
  }

  const dateCounts = new Map<string, number>();
  for (const entry of dateResponses) {
    dateCounts.set(entry.date, (dateCounts.get(entry.date) ?? 0) + 1);
  }

  const total = dateResponses.length;
  const distribution: DateDistributionPoint[] = [...dateCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, cnt]) => ({
      date,
      count: cnt,
      percentage: total > 0 ? Math.round((cnt / total) * 10000) / 100 : 0,
    }));

  return {
    block_id: block.blockId,
    form_id: formId,
    total_responses: total,
    distribution,
    responses: dateResponses,
  };
}

// ===== 時刻ブロック (time) =====

function aggregateTime(
  block: BlockInfo,
  formId: string,
  responses: ParsedResponse[],
): TimeAnalytics {
  const timeResponses: TimeResponseEntry[] = [];

  for (const resp of responses) {
    for (const item of resp.items) {
      if (item.question_id !== block.blockId) continue;
      if (item.value === undefined || item.value === null) continue;
      timeResponses.push({
        response_id: resp.id,
        submitted_at: resp.submittedAt,
        time: String(item.value),
      });
    }
  }

  const timeCounts = new Map<string, number>();
  for (const entry of timeResponses) {
    timeCounts.set(entry.time, (timeCounts.get(entry.time) ?? 0) + 1);
  }

  const total = timeResponses.length;
  const distribution: TimeDistributionPoint[] = [...timeCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, cnt]) => ({
      time,
      count: cnt,
      percentage: total > 0 ? Math.round((cnt / total) * 10000) / 100 : 0,
    }));

  return {
    block_id: block.blockId,
    form_id: formId,
    total_responses: total,
    distribution,
    responses: timeResponses,
  };
}

// ===== テキストブロック (short_text, long_text) =====

function aggregateText(
  block: BlockInfo,
  responses: ParsedResponse[],
): TextAnalytics {
  const textResponses: TextResponseEntry[] = [];

  for (const resp of responses) {
    for (const item of resp.items) {
      if (item.question_id !== block.blockId) continue;
      if (item.value === undefined || item.value === null) continue;
      const val = String(item.value).trim();
      if (val === "") continue;
      textResponses.push({
        response_id: resp.id,
        submitted_at: resp.submittedAt,
        value: val,
      });
    }
  }

  let wordCountStats: { average: number; min: number; max: number } | undefined;

  if (textResponses.length > 0) {
    const lengths = textResponses.map((r) => r.value.length);
    const sum = lengths.reduce((a, b) => a + b, 0);
    wordCountStats = {
      average: Math.round((sum / lengths.length) * 100) / 100,
      min: Math.min(...lengths),
      max: Math.max(...lengths),
    };
  }

  return {
    total_responses: textResponses.length,
    responses: textResponses,
    word_count_stats: wordCountStats,
  };
}

// ===== 全ブロック一括集計 =====

const CHOICE_TYPES = new Set(["radio", "checkbox", "dropdown"]);
const SCALE_TYPES = new Set(["linear_scale", "rating"]);
const GRID_TYPES = new Set(["choice_grid", "checkbox_grid"]);
const TEXT_TYPES = new Set(["short_text", "long_text"]);
const SKIP_TYPES = new Set(["section_separator"]);

export function aggregateAllBlocks(
  formId: string,
  blocks: RawBlock[],
  rawResponses: RawResponseRow[],
): BlockAnalyticsResult[] {
  return aggregateBlocksWithParsedCount(formId, blocks, rawResponses).results;
}

function aggregateBlocksWithParsedCount(
  formId: string,
  blocks: RawBlock[],
  rawResponses: RawResponseRow[],
): AggregateBlocksResult {
  const parsedResponses = rawResponses
    .map((r) => parseResponseData(r.id, r.submittedAt, r.responseDataJson))
    .filter((r): r is ParsedResponse => r !== null);

  const totalResponseCount = parsedResponses.length;
  const results: BlockAnalyticsResult[] = [];

  for (const raw of blocks) {
    if (SKIP_TYPES.has(raw.type)) continue;

    const { title, validation } = parseBlockContent(raw.content);
    const block: BlockInfo = {
      blockId: raw.blockId,
      type: raw.type,
      title,
      validation,
    };

    let analyticsData: unknown;
    let blockResponseCount = 0;

    if (CHOICE_TYPES.has(raw.type)) {
      const data = aggregateChoice(block, parsedResponses);
      analyticsData = data;
      blockResponseCount = data.total_responses;
    } else if (SCALE_TYPES.has(raw.type)) {
      const data = aggregateScale(block, parsedResponses);
      analyticsData = data;
      blockResponseCount = data.total_responses;
    } else if (GRID_TYPES.has(raw.type)) {
      const data = aggregateGrid(block, parsedResponses, totalResponseCount);
      analyticsData = data;
      blockResponseCount = data.total_responses;
    } else if (raw.type === "date") {
      const data = aggregateDate(block, formId, parsedResponses);
      analyticsData = data;
      blockResponseCount = data.total_responses;
    } else if (raw.type === "time") {
      const data = aggregateTime(block, formId, parsedResponses);
      analyticsData = data;
      blockResponseCount = data.total_responses;
    } else if (TEXT_TYPES.has(raw.type)) {
      const data = aggregateText(block, parsedResponses);
      analyticsData = data;
      blockResponseCount = data.total_responses;
    } else {
      continue;
    }

    results.push({
      block_id: raw.blockId,
      block_type: raw.type,
      block_title: title,
      total_responses: blockResponseCount,
      response_rate:
        totalResponseCount > 0
          ? Math.round((blockResponseCount / totalResponseCount) * 10000) /
            10000
          : 0,
      analytics_data: analyticsData,
    });
  }

  return { results, totalResponseCount };
}

function isChoiceAnalytics(data: unknown): data is ChoiceAnalytics {
  return ChoiceAnalyticsSchema.safeParse(data).success;
}

function isGridAnalytics(data: unknown): data is GridAnalytics {
  return GridAnalyticsSchema.safeParse(data).success;
}

function isDateAnalytics(data: unknown): data is DateAnalytics {
  return DateAnalyticsSchema.safeParse(data).success;
}

function isTimeAnalytics(data: unknown): data is TimeAnalytics {
  return TimeAnalyticsSchema.safeParse(data).success;
}

function isTextAnalytics(data: unknown): data is TextAnalytics {
  return TextAnalyticsSchema.safeParse(data).success;
}

function mergeChoiceAnalytics(
  target: ChoiceAnalytics,
  incoming: ChoiceAnalytics,
): void {
  target.total_responses += incoming.total_responses;

  for (const [index, incomingOption] of incoming.options.entries()) {
    const existing = target.options[index];
    if (existing) {
      existing.count += incomingOption.count;
    } else {
      target.options.push({ ...incomingOption });
    }
  }
}

function mergeGridAnalytics(
  target: GridAnalytics,
  incoming: GridAnalytics,
): void {
  target.total_responses += incoming.total_responses;

  for (const [rowIndex, incomingRow] of incoming.row_analytics.entries()) {
    const existingRow = target.row_analytics[rowIndex];
    if (!existingRow) {
      target.row_analytics.push({
        row_label: incomingRow.row_label,
        column_counts: incomingRow.column_counts.map((count) => ({ ...count })),
      });
      continue;
    }

    for (const [
      columnIndex,
      incomingColumn,
    ] of incomingRow.column_counts.entries()) {
      const existingColumn = existingRow.column_counts[columnIndex];
      if (existingColumn) {
        existingColumn.count += incomingColumn.count;
      } else {
        existingRow.column_counts.push({ ...incomingColumn });
      }
    }
  }
}

function mergeDateAnalytics(
  target: DateAnalytics,
  incoming: DateAnalytics,
  detailResponseLimit: number,
): void {
  target.total_responses += incoming.total_responses;
  target.responses.push(...incoming.responses);
  if (target.responses.length > detailResponseLimit) {
    target.responses.length = detailResponseLimit;
  }

  for (const incomingPoint of incoming.distribution) {
    const existing = target.distribution.find(
      (point) => point.date === incomingPoint.date,
    );
    if (existing) {
      existing.count += incomingPoint.count;
    } else {
      target.distribution.push({ ...incomingPoint });
    }
  }
}

function mergeTimeAnalytics(
  target: TimeAnalytics,
  incoming: TimeAnalytics,
  detailResponseLimit: number,
): void {
  target.total_responses += incoming.total_responses;
  target.responses.push(...incoming.responses);
  if (target.responses.length > detailResponseLimit) {
    target.responses.length = detailResponseLimit;
  }

  for (const incomingPoint of incoming.distribution) {
    const existing = target.distribution.find(
      (point) => point.time === incomingPoint.time,
    );
    if (existing) {
      existing.count += incomingPoint.count;
    } else {
      target.distribution.push({ ...incomingPoint });
    }
  }
}

function updateTextMergeStats(
  stats: TextMergeStats,
  analytics: TextAnalytics,
): void {
  stats.total += analytics.total_responses;

  for (const response of analytics.responses) {
    const length = response.value.length;
    stats.characterSum += length;
    stats.min = stats.min === undefined ? length : Math.min(stats.min, length);
    stats.max = stats.max === undefined ? length : Math.max(stats.max, length);
  }
}

function mergeTextAnalytics(
  target: TextAnalytics,
  incoming: TextAnalytics,
  detailResponseLimit: number,
): void {
  target.total_responses += incoming.total_responses;
  target.responses.push(...incoming.responses);
  if (target.responses.length > detailResponseLimit) {
    target.responses.length = detailResponseLimit;
  }
}

function capDetailResponses(
  result: BlockAnalyticsResult,
  detailResponseLimit: number,
): void {
  const data = result.analytics_data;

  if (
    (result.block_type === "date" && isDateAnalytics(data)) ||
    (result.block_type === "time" && isTimeAnalytics(data)) ||
    isTextAnalytics(data)
  ) {
    if (data.responses.length > detailResponseLimit) {
      data.responses.length = detailResponseLimit;
    }
  }
}

function mergeBlockAnalyticsResult(
  target: BlockAnalyticsResult,
  incoming: BlockAnalyticsResult,
  detailResponseLimit: number,
  textMergeStats: Map<string, TextMergeStats>,
): void {
  target.total_responses += incoming.total_responses;

  const targetData = target.analytics_data;
  const incomingData = incoming.analytics_data;

  if (isChoiceAnalytics(targetData) && isChoiceAnalytics(incomingData)) {
    mergeChoiceAnalytics(targetData, incomingData);
    return;
  }

  if (isGridAnalytics(targetData) && isGridAnalytics(incomingData)) {
    mergeGridAnalytics(targetData, incomingData);
    return;
  }

  if (
    target.block_type === "date" &&
    isDateAnalytics(targetData) &&
    isDateAnalytics(incomingData)
  ) {
    mergeDateAnalytics(targetData, incomingData, detailResponseLimit);
    return;
  }

  if (
    target.block_type === "time" &&
    isTimeAnalytics(targetData) &&
    isTimeAnalytics(incomingData)
  ) {
    mergeTimeAnalytics(targetData, incomingData, detailResponseLimit);
    return;
  }

  if (isTextAnalytics(targetData) && isTextAnalytics(incomingData)) {
    mergeTextAnalytics(targetData, incomingData, detailResponseLimit);
    const stats = textMergeStats.get(target.block_id);
    if (stats) updateTextMergeStats(stats, incomingData);
  }
}

function initializeTextMergeStats(
  analytics: BlockAnalyticsResult,
  textMergeStats: Map<string, TextMergeStats>,
): void {
  const data = analytics.analytics_data;
  if (!isTextAnalytics(data)) return;

  const stats: TextMergeStats = {
    total: 0,
    characterSum: 0,
  };
  updateTextMergeStats(stats, data);
  textMergeStats.set(analytics.block_id, stats);
}

function recalculatePercentages(
  results: BlockAnalyticsResult[],
  totalResponseCount: number,
  textMergeStats: Map<string, TextMergeStats>,
): void {
  for (const result of results) {
    result.response_rate =
      totalResponseCount > 0
        ? Math.round((result.total_responses / totalResponseCount) * 10000) /
          10000
        : 0;

    const data = result.analytics_data;

    if (isChoiceAnalytics(data)) {
      for (const option of data.options) {
        option.percentage =
          data.total_responses > 0
            ? Math.round((option.count / data.total_responses) * 10000) / 100
            : 0;
      }
    } else if (isGridAnalytics(data)) {
      data.response_rate =
        totalResponseCount > 0
          ? Math.round((data.total_responses / totalResponseCount) * 10000) /
            10000
          : 0;
    } else if (result.block_type === "date" && isDateAnalytics(data)) {
      data.distribution.sort((a, b) => a.date.localeCompare(b.date));
      for (const point of data.distribution) {
        point.percentage =
          data.total_responses > 0
            ? Math.round((point.count / data.total_responses) * 10000) / 100
            : 0;
      }
    } else if (result.block_type === "time" && isTimeAnalytics(data)) {
      data.distribution.sort((a, b) => a.time.localeCompare(b.time));
      for (const point of data.distribution) {
        point.percentage =
          data.total_responses > 0
            ? Math.round((point.count / data.total_responses) * 10000) / 100
            : 0;
      }
    } else if (isTextAnalytics(data)) {
      const stats = textMergeStats.get(result.block_id);
      if (!stats || stats.total === 0) {
        data.word_count_stats = undefined;
      } else {
        data.word_count_stats = {
          average: Math.round((stats.characterSum / stats.total) * 100) / 100,
          min: stats.min ?? 0,
          max: stats.max ?? 0,
        };
      }
    }
  }
}

function normalizePositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

function normalizeNonNegativeInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

/**
 * Aggregates block analytics from cursor-paginated response batches.
 *
 * `loadBatch` must return rows sorted by `submittedAt DESC, id DESC`. The
 * cursor passed to each subsequent call is the last row from the previous page;
 * callers must return only rows after that cursor in the same order and must
 * not return the cursor row again.
 */
export async function aggregateAllBlocksInBatches(
  formId: string,
  blocks: RawBlock[],
  loadBatch: ResponseBatchLoader,
  options: AggregateBatchOptions = {},
): Promise<BlockAnalyticsResult[]> {
  const batchSize = normalizePositiveInteger(
    options.batchSize ?? DEFAULT_AGGREGATION_BATCH_SIZE,
    DEFAULT_AGGREGATION_BATCH_SIZE,
  );
  const detailResponseLimit = normalizeNonNegativeInteger(
    options.detailResponseLimit ?? DEFAULT_DETAIL_RESPONSE_LIMIT,
    DEFAULT_DETAIL_RESPONSE_LIMIT,
  );
  const mergedResults = new Map<string, BlockAnalyticsResult>();
  const textMergeStats = new Map<string, TextMergeStats>();
  let cursor: ResponseBatchCursor | undefined;
  let totalResponseCount = 0;

  while (true) {
    const batch = await loadBatch(cursor, batchSize);
    if (batch.length === 0) break;

    const { results: batchResults, totalResponseCount: batchResponseCount } =
      aggregateBlocksWithParsedCount(formId, blocks, batch);
    totalResponseCount += batchResponseCount;

    for (const result of batchResults) {
      const existing = mergedResults.get(result.block_id);
      if (!existing) {
        initializeTextMergeStats(result, textMergeStats);
        capDetailResponses(result, detailResponseLimit);
        mergedResults.set(result.block_id, result);
      } else {
        mergeBlockAnalyticsResult(
          existing,
          result,
          detailResponseLimit,
          textMergeStats,
        );
      }
    }

    if (batch.length < batchSize) break;
    const lastRow = batch.at(-1);
    cursor = lastRow
      ? { id: lastRow.id, submittedAt: lastRow.submittedAt }
      : undefined;
  }

  if (mergedResults.size === 0) {
    return aggregateAllBlocks(formId, blocks, []);
  }

  const results = [...mergedResults.values()];
  recalculatePercentages(results, totalResponseCount, textMergeStats);
  return results;
}
