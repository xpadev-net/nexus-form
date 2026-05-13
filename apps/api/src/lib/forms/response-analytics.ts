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

interface GridRowDef {
  id: string;
  label: string;
}

interface GridColumnDef {
  id: string;
  label: string;
}

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
  const options = (block.validation.options ?? []) as ChoiceOption[];
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
  const rows = (block.validation.rows ?? []) as GridRowDef[];
  const columns = (block.validation.columns ?? []) as GridColumnDef[];
  const gridType = block.type as "choice_grid" | "checkbox_grid";

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
  blocks: Array<{
    blockId: string;
    type: string;
    content: unknown;
  }>,
  rawResponses: Array<{
    id: string;
    submittedAt: Date | string;
    responseDataJson: string;
  }>,
): BlockAnalyticsResult[] {
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

  return results;
}
