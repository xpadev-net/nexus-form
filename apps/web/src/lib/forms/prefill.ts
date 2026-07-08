import type { ExtractedQuestion, PlatePage } from "@nexus-form/shared";
import { resolveReachableFormContent } from "@nexus-form/shared";
import type { AnswerEntry } from "@/contexts/form-response-context";

export type PrefillData = Record<string, AnswerEntry>;

export const PREFILL_SUPPORTED_QUESTION_TYPES = [
  "short_text",
  "long_text",
  "radio",
  "checkbox",
  "dropdown",
  "linear_scale",
  "rating",
  "date",
  "time",
] as const;

export const PREFILL_UNSUPPORTED_QUESTION_TYPES = [
  "choice_grid",
  "checkbox_grid",
] as const;

const PREFILL_QUESTION_TYPE_LABELS: Record<string, string> = {
  short_text: "短文",
  long_text: "長文",
  radio: "ラジオ",
  checkbox: "チェックボックス",
  dropdown: "プルダウン",
  linear_scale: "均等目盛",
  rating: "評価",
  choice_grid: "選択グリッド",
  checkbox_grid: "チェックボックスグリッド",
  date: "日付",
  time: "時刻",
};

interface UnsupportedPrefillGuidance {
  alternative: string;
  reason: string;
}

export interface PrefillQuestionTypeInfo {
  alternative?: string;
  label: string;
  reason?: string;
  supported: boolean;
}

const PREFILL_UNSUPPORTED_GUIDANCE: Record<string, UnsupportedPrefillGuidance> =
  {
    choice_grid: {
      reason: "行と列の組み合わせを1つの短いURLで安全に表現しづらいためです。",
      alternative:
        "単一選択の設問に分割するか、回答者向けの説明文で事前入力内容を伝えてください。",
    },
    checkbox_grid: {
      reason:
        "行ごとに複数選択を持つ表形式のため、URL内の初期値が複雑になりやすいためです。",
      alternative:
        "チェックボックス設問に分割するか、回答者向けの説明文で事前入力内容を伝えてください。",
    },
  };

export function isPrefillSupportedQuestionType(type: string): boolean {
  return (PREFILL_SUPPORTED_QUESTION_TYPES as readonly string[]).includes(type);
}

export function getPrefillQuestionTypeLabel(type: string): string {
  return PREFILL_QUESTION_TYPE_LABELS[type] ?? type;
}

export function getPrefillQuestionTypeInfo(
  type: string,
): PrefillQuestionTypeInfo {
  const guidance = PREFILL_UNSUPPORTED_GUIDANCE[type];
  const supported = isPrefillSupportedQuestionType(type);
  return {
    alternative:
      guidance?.alternative ??
      (supported ? undefined : "通常の設問へ分割してください。"),
    label: getPrefillQuestionTypeLabel(type),
    reason:
      guidance?.reason ??
      (supported
        ? undefined
        : "この質問タイプ用の初期値入力UIがまだ用意されていないためです。"),
    supported,
  };
}

export function isEntryEmpty(entry: AnswerEntry): boolean {
  return (
    entry.value === undefined &&
    entry.values === undefined &&
    entry.responses === undefined &&
    entry.other_value === undefined &&
    entry.other_values === undefined
  );
}

export function filterPrefillDataForSupportedQuestions(
  questions: ExtractedQuestion[],
  data: PrefillData,
): PrefillData {
  const supportedQuestionIds = new Set(
    questions
      .filter((question) => isPrefillSupportedQuestionType(question.type))
      .map((question) => question.blockId),
  );
  const filtered: PrefillData = {};

  for (const [questionId, entry] of Object.entries(data)) {
    if (supportedQuestionIds.has(questionId) && !isEntryEmpty(entry)) {
      filtered[questionId] = entry;
    }
  }

  return filtered;
}

function toPrefillResponseRecord(data: PrefillData): Record<string, unknown> {
  const responseRecord: Record<string, unknown> = {};
  for (const [questionId, entry] of Object.entries(data)) {
    if (isEntryEmpty(entry)) continue;
    const response = toPrefillResponseValue(entry);
    if (response !== undefined) {
      responseRecord[questionId] = response;
    }
  }
  return responseRecord;
}

function toPrefillResponseValue(entry: AnswerEntry): unknown {
  if (entry.responses !== undefined) return entry.responses;

  if (entry.values !== undefined || entry.other_values !== undefined) {
    return [...(entry.values ?? []), ...(entry.other_values ?? [])];
  }

  if (entry.value !== undefined) {
    if (entry.other_value !== undefined) {
      return [entry.value, entry.other_value];
    }
    return entry.value;
  }

  return entry.other_value ?? entry.other_values;
}

/**
 * Resolves the question ids reachable from the supplied Plate pages and prefill
 * answers. The prefill data is first converted to the response-record shape
 * expected by the shared reachability helper, including compound "other" text.
 *
 * @param pages Plate pages produced from the current form content.
 * @param data Current prefill answer entries keyed by question block id.
 * @returns Question block ids reachable for the current prefill answers.
 */
export function getReachableQuestionIdsFromPrefillValues(
  pages: PlatePage[],
  data: PrefillData,
): string[] {
  if (pages.length === 0) return [];
  return resolveReachableFormContent(pages, toPrefillResponseRecord(data))
    .questionIds;
}

/**
 * Filters prefill data to entries that are both supported by the prefill URL
 * format and reachable from the supplied Plate pages. This variant computes
 * reachability internally from `pages` and `data`.
 *
 * @param questions Extracted form questions used for type support checks.
 * @param pages Plate pages used to resolve branch reachability.
 * @param data Current prefill answer entries keyed by question block id.
 * @returns Prefill entries safe to encode into the generated URL.
 */
export function filterPrefillDataForReachableQuestions(
  questions: ExtractedQuestion[],
  pages: PlatePage[],
  data: PrefillData,
): PrefillData {
  return filterPrefillDataForReachableQuestionIds(
    questions,
    new Set(getReachableQuestionIdsFromPrefillValues(pages, data)),
    data,
  );
}

/**
 * Filters prefill data using a caller-provided reachable question id set. Use
 * this when reachability has already been computed for the same pages/data so
 * the shared reachability traversal is not repeated.
 *
 * @param questions Extracted form questions used for type support checks.
 * @param reachableQuestionIds Precomputed reachable question block ids.
 * @param data Current prefill answer entries keyed by question block id.
 * @returns Prefill entries safe to encode into the generated URL.
 */
export function filterPrefillDataForReachableQuestionIds(
  questions: ExtractedQuestion[],
  reachableQuestionIds: ReadonlySet<string>,
  data: PrefillData,
): PrefillData {
  const supportedQuestionIds = new Set(
    questions
      .filter((question) => isPrefillSupportedQuestionType(question.type))
      .map((question) => question.blockId),
  );
  const filtered: PrefillData = {};

  for (const [questionId, entry] of Object.entries(data)) {
    if (
      supportedQuestionIds.has(questionId) &&
      reachableQuestionIds.has(questionId) &&
      !isEntryEmpty(entry)
    ) {
      filtered[questionId] = entry;
    }
  }

  return filtered;
}

export function getPrefilledQuestions(
  questions: ExtractedQuestion[],
  data: PrefillData,
): ExtractedQuestion[] {
  return questions.filter((question) => {
    const entry = data[question.blockId];
    return (
      entry !== undefined &&
      !isEntryEmpty(entry) &&
      isPrefillSupportedQuestionType(question.type)
    );
  });
}

function isValidScalar(v: unknown): boolean {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

function isValidAnswerEntry(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (
    "value" in entry &&
    entry.value !== undefined &&
    !isValidScalar(entry.value)
  )
    return false;
  if (
    "values" in entry &&
    entry.values !== undefined &&
    !Array.isArray(entry.values)
  )
    return false;
  if ("responses" in entry && entry.responses !== undefined) {
    if (
      typeof entry.responses !== "object" ||
      entry.responses === null ||
      Array.isArray(entry.responses)
    )
      return false;
  }
  if (
    "other_value" in entry &&
    entry.other_value !== undefined &&
    typeof entry.other_value !== "string"
  )
    return false;
  if (
    "other_values" in entry &&
    entry.other_values !== undefined &&
    !Array.isArray(entry.other_values)
  )
    return false;
  return true;
}

function base64UrlEncode(uint8: Uint8Array): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let result = "";
  for (let i = 0; i < uint8.length; i += 3) {
    const b1 = uint8[i] ?? 0;
    const b2 = i + 1 < uint8.length ? (uint8[i + 1] ?? 0) : 0;
    const b3 = i + 2 < uint8.length ? (uint8[i + 2] ?? 0) : 0;
    result += chars[b1 >> 2];
    result += chars[((b1 & 3) << 4) | (b2 >> 4)];
    result += chars[((b2 & 15) << 2) | (b3 >> 6)];
    result += chars[b3 & 63];
  }
  const rem = uint8.length % 3;
  if (rem === 1) result = result.slice(0, -2);
  else if (rem === 2) result = result.slice(0, -1);
  return result;
}

function base64UrlDecode(str: string): Uint8Array {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const map: Record<string, number> = {};
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch != null) map[ch] = i;
  }

  const len = str.length;
  const bytes: number[] = [];
  for (let i = 0; i < len; i += 4) {
    const c1 = map[str[i] ?? ""] ?? 0;
    const c2 = map[str[i + 1] ?? ""] ?? 0;
    const c3 = map[str[i + 2] ?? ""] ?? 0;
    const c4 = map[str[i + 3] ?? ""] ?? 0;
    bytes.push((c1 << 2) | (c2 >> 4));
    if (i + 2 < len) bytes.push(((c2 & 15) << 4) | (c3 >> 2));
    if (i + 3 < len) bytes.push(((c3 & 3) << 6) | c4);
  }
  return new Uint8Array(bytes);
}

export function encodePrefillData(data: PrefillData): string {
  const json = JSON.stringify(data);
  const encoder = new TextEncoder();
  const uint8 = encoder.encode(json);
  return base64UrlEncode(uint8);
}

export function decodePrefillData(encoded: string): PrefillData | null {
  try {
    const uint8 = base64UrlDecode(encoded);
    const decoder = new TextDecoder();
    const json = decoder.decode(uint8);
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    for (const value of Object.values(parsed)) {
      if (!isValidAnswerEntry(value)) return null;
    }
    return parsed as PrefillData;
  } catch {
    return null;
  }
}
