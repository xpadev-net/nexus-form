import {
  type ResponseDataItem,
  responsePayloadItemSchema,
  type ValidatorQuestion,
} from "@nexus-form/shared";
import { z } from "zod";

const EMPTY_CHOICE_LABEL = "（空の選択肢）";
const OTHER_CHOICE_LABEL = "その他";
const UNANSWERED_LABEL = "未回答";

const LabelItemSchema = z.object({
  id: z.string(),
  label: z.string(),
});

const LabelItemsSchema = z.array(LabelItemSchema);

const BlockContentSchema = z
  .object({
    validation: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .passthrough();

export interface ResponseQuestionLabelLookup {
  options: Map<string, string>;
  rows: Map<string, string>;
  columns: Map<string, string>;
  otherLabel?: string;
}

export type ResponseLabelLookupByQuestion = Map<
  string,
  ResponseQuestionLabelLookup
>;

export interface ResponseLabelBlock {
  blockId: string;
  content: unknown;
}

export interface ResponseDisplayItem {
  question_id: string;
  question_type: string;
  value?: unknown;
  values?: unknown[];
  responses?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toLabelMap(value: unknown): Map<string, string> {
  const result = LabelItemsSchema.safeParse(value);
  if (!result.success) return new Map();
  return new Map(result.data.map((item) => [item.id, item.label]));
}

function getOtherLabel(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function buildLookupFromValidation(
  validation: Record<string, unknown> | undefined,
): ResponseQuestionLabelLookup {
  return {
    options: toLabelMap(validation?.options),
    rows: toLabelMap(validation?.rows),
    columns: toLabelMap(validation?.columns),
    otherLabel: getOtherLabel(validation?.otherLabel),
  };
}

export function buildResponseLabelLookupFromQuestions(
  questions: ValidatorQuestion[],
): ResponseLabelLookupByQuestion {
  const lookup: ResponseLabelLookupByQuestion = new Map();
  for (const question of questions) {
    lookup.set(question.id, buildLookupFromValidation(question.validation));
  }
  return lookup;
}

export function buildResponseLabelLookupFromBlocks(
  blocks: ResponseLabelBlock[],
): ResponseLabelLookupByQuestion {
  const lookup: ResponseLabelLookupByQuestion = new Map();

  for (const block of blocks) {
    const content = BlockContentSchema.safeParse(block.content);
    lookup.set(
      block.blockId,
      buildLookupFromValidation(
        content.success ? content.data.validation : undefined,
      ),
    );
  }

  return lookup;
}

function choiceLabel(
  labels: Map<string, string>,
  value: string,
  emptyFallback: string,
): string {
  const label = labels.get(value);
  if (label === undefined) return value;
  return label || emptyFallback;
}

function optionLabel(
  lookup: ResponseQuestionLabelLookup,
  value: string,
): string {
  if (value === "other") return lookup.otherLabel ?? OTHER_CHOICE_LABEL;
  return choiceLabel(lookup.options, value, EMPTY_CHOICE_LABEL);
}

function gridItemLabel(labels: Map<string, string>, value: string): string {
  return choiceLabel(labels, value, value);
}

function formatGridDisplayValue(
  item: ResponseDisplayItem,
  lookup: ResponseQuestionLabelLookup,
): string | undefined {
  if (!item.responses) return undefined;

  const lines = Object.entries(item.responses).map(([rowId, rowValue]) => {
    const rowLabel = gridItemLabel(lookup.rows, rowId);
    if (item.question_type === "choice_grid" && typeof rowValue === "string") {
      return `${rowLabel}: ${gridItemLabel(lookup.columns, rowValue)}`;
    }
    if (item.question_type === "checkbox_grid" && Array.isArray(rowValue)) {
      const columnLabels = rowValue.map((value) =>
        gridItemLabel(lookup.columns, value),
      );
      return `${rowLabel}: ${
        columnLabels.length > 0 ? columnLabels.join(", ") : UNANSWERED_LABEL
      }`;
    }
    return `${rowLabel}: ${UNANSWERED_LABEL}`;
  });

  return lines.length > 0 ? lines.join("\n") : undefined;
}

export function resolveResponseDisplayValue(
  item: ResponseDisplayItem | undefined,
  lookup: ResponseQuestionLabelLookup | undefined,
): unknown {
  if (!item || !lookup) return undefined;

  if (
    (item.question_type === "radio" || item.question_type === "dropdown") &&
    typeof item.value === "string"
  ) {
    return optionLabel(lookup, item.value);
  }

  if (item.question_type === "checkbox" && Array.isArray(item.values)) {
    return item.values.map((value) => optionLabel(lookup, String(value)));
  }

  if (
    item.question_type === "choice_grid" ||
    item.question_type === "checkbox_grid"
  ) {
    return formatGridDisplayValue(item, lookup);
  }

  return undefined;
}

function getDisplayFields(
  item: ResponseDataItem,
  lookup: ResponseQuestionLabelLookup | undefined,
): Record<string, unknown> {
  const displayValue = resolveResponseDisplayValue(item, lookup);
  if (displayValue === undefined) return {};
  if (Array.isArray(displayValue)) return { display_values: displayValue };
  return { display_value: displayValue };
}

export function addDisplayLabelsToResponseDataJson(
  responseDataJson: string,
  lookup: ResponseLabelLookupByQuestion,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseDataJson);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const enriched = parsed.map((item) => {
    if (!isRecord(item)) return item;
    const result = responsePayloadItemSchema.safeParse(item);
    if (!result.success) return item;
    return {
      ...item,
      ...getDisplayFields(result.data, lookup.get(result.data.question_id)),
    };
  });

  return JSON.stringify(enriched);
}
