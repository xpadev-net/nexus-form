import { createHash } from "node:crypto";
import { isAnswerableBlockType } from "@nexus-form/shared";
import { v5 as uuidv5 } from "uuid";
import { z } from "zod";
import { logError } from "../logger";
import {
  buildResponseLabelLookupFromBlocks,
  resolveResponseDisplayValue,
} from "./response-choice-labels";
import { calculateUniqueness } from "./uniqueness-calculator";

/**
 * Minimal ResponseData schema for export
 */
const ResponseData = z.object({
  question_id: z.string(),
  question_type: z.string(),
  question_title: z.string().optional(),
  value: z.unknown().optional(),
  values: z.array(z.unknown()).optional(),
  responses: z.record(z.string(), z.unknown()).optional(),
});

type ResponseData = z.infer<typeof ResponseData>;

// レスポンスデータJSONの形式を定義するZodスキーマ
export const ResponseDataJsonSchema = z.array(ResponseData);

type ExportFormBlock = {
  blockId: string;
  category: string;
  type: string;
  content: unknown;
};

/**
 * セッションエイリアスを計算する
 */
function computeSessionAlias(formId: string, sessionId: string): string {
  const SESSION_ALIAS_SALT = process.env.SESSION_ALIAS_SALT;
  if (!SESSION_ALIAS_SALT) {
    throw new Error("SESSION_ALIAS_SALT environment variable is required");
  }
  const input = `${formId}:${sessionId}:${SESSION_ALIAS_SALT}`;
  return createHash("sha256").update(input).digest("hex");
}

// 共通中間形式の型定義
export type ResponseExportRecord = {
  metadata: {
    id: string;
    form_id: string;
    respondent_uuid: string;
    submitted_at: string;
    updated_at?: string;
    // Cloudflare CF-IPCountryヘッダー由来の国コード（JP, US など）。telemetryの匿名化には含めず、エクスポート時のみ利用する。
    country_code?: string;
    fingerprint_uuids?: Record<string, string | null>;
    ua_uuid?: string | null;
    uniqueness_score?: number;
    session_alias?: string;
  };
  component_columns: Array<{
    block_id: string;
    block_type: string;
    question_title?: string;
    value: unknown;
    display_value?: unknown;
  }>;
};

export type ResponseExportColumn = {
  id: string;
  title: string;
  blockType?: string;
};

export type ResponseExportTable = {
  headerIds: string[];
  headerTitles: string[];
  rows: string[][];
};

// RFC 4180準拠のCSVエスケープ関数
const escapeCSV = (str: string): string => {
  // ダブルクォートをエスケープ
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
};

const FORMULA_OPERATOR_PATTERN = /^[=+\-@]/;
const LEADING_FORMULA_CONTROL_PATTERN = /^\s*[\t\r\n]/;

function neutralizeSpreadsheetFormulaValue(value: string): string {
  if (!value) return value;

  const startsWithFormulaOperator = FORMULA_OPERATOR_PATTERN.test(
    value.trimStart(),
  );
  const startsWithFormulaControl = LEADING_FORMULA_CONTROL_PATTERN.test(value);

  return startsWithFormulaOperator || startsWithFormulaControl
    ? `'${value}`
    : value;
}

function neutralizeSpreadsheetFormulaValues(values: string[]): string[] {
  return values.map(neutralizeSpreadsheetFormulaValue);
}

/**
 * メタデータのヘッダーを生成する（CSVとスプレッドシート共通）
 */
function buildMetadataHeaders(
  fingerprintComponents: Set<string>,
  isJapanese: boolean = false,
): string[] {
  const baseHeaders = isJapanese
    ? [
        "回答ID",
        "回答者UUID",
        "送信日時",
        "更新日時",
        "国コード",
        "UA UUID",
        "ユニーク度スコア",
      ]
    : [
        "Response ID",
        "Respondent UUID",
        "Submitted At",
        "Updated At",
        "Country Code",
        "UA UUID",
        "Uniqueness Score",
      ];

  // フィンガープリントコンポーネントのUUIDヘッダーを追加
  const fingerprintHeaders = Array.from(fingerprintComponents)
    .sort()
    .map((component) => `${component} UUID`);

  return [...baseHeaders, ...fingerprintHeaders];
}

/**
 * メタデータの値を生成する（CSVとスプレッドシート共通）
 */
function buildMetadataValues(
  record: ResponseExportRecord,
  fingerprintComponents: Set<string>,
): string[] {
  const baseValues = [
    record.metadata.id,
    record.metadata.respondent_uuid,
    record.metadata.submitted_at,
    record.metadata.updated_at || "",
    record.metadata.country_code || "",
    record.metadata.ua_uuid || "",
    record.metadata.uniqueness_score?.toFixed(4) || "",
  ];

  // フィンガープリントコンポーネントのUUIDを追加
  const fingerprintValues = Array.from(fingerprintComponents)
    .sort()
    .map((component) => record.metadata.fingerprint_uuids?.[component] || "");

  return [...baseValues, ...fingerprintValues];
}

function isAnswerableExportBlock(
  block: Pick<ExportFormBlock, "type">,
): boolean {
  return isAnswerableBlockType(block.type);
}

function getBlockTitle(block: Pick<ExportFormBlock, "blockId" | "content">) {
  const content =
    block.content && typeof block.content === "object"
      ? (block.content as Record<string, unknown>)
      : null;
  return (content?.title as string) || block.blockId;
}

export function buildResponseExportColumnsFromBlocks(
  formBlocks: ExportFormBlock[],
): ResponseExportColumn[] {
  return formBlocks.filter(isAnswerableExportBlock).map((block) => ({
    id: block.blockId,
    title: getBlockTitle(block),
    blockType: block.type,
  }));
}

/**
 * 回答データを共通中間形式に変換する
 */
function resolveResponseValue(response?: ResponseData): unknown {
  if (!response) return null;

  switch (response.question_type) {
    case "choice_grid":
    case "checkbox_grid":
      return response.responses;
    case "checkbox":
      return response.values;
    case "short_text":
    case "long_text":
    case "radio":
    case "dropdown":
    case "linear_scale":
    case "rating":
    case "date":
    case "time":
      return response.value;
    default:
      return null;
  }
}

export function buildResponseExportRecords(
  formId: string,
  responses: Array<{
    id: string;
    formId: string;
    responseDataJson: string;
    respondentUuid: string;
    submittedAt: Date;
    updatedAt?: Date | null;
    userAgent?: string | null;
    sessionId?: string | null;
    countryCode?: string | null;
    fingerprintDetails: Array<{
      componentName: string;
      componentValueHash: string;
      fingerprintType: string;
    }>;
  }>,
  formBlocks: ExportFormBlock[],
): { records: ResponseExportRecord[]; fingerprintComponents: Set<string> } {
  // ブロックタイトルマップを作成
  const blockTitleMap = new Map<string, string>();
  formBlocks.forEach((block) => {
    blockTitleMap.set(block.blockId, getBlockTitle(block));
  });
  const answerableFormBlocks = formBlocks.filter(isAnswerableExportBlock);
  const responseLabelLookup = buildResponseLabelLookupFromBlocks(formBlocks);

  // 疑似ID生成用の名前空間（フォーム固有）
  const namespace = uuidv5(formId, uuidv5.DNS);

  // ユニーク度スコアを事前計算
  const responsesWithFingerprints = responses.map((response) => ({
    id: response.id,
    fingerprintDetails: response.fingerprintDetails.map((fp) => ({
      componentName: fp.componentName,
      componentValueHash: fp.componentValueHash,
      fingerprintType: fp.fingerprintType,
    })),
  }));

  // フィンガープリントコンポーネントのセットを作成
  const fingerprintComponents = new Set<string>();
  responses.forEach((response) => {
    response.fingerprintDetails.forEach((fp) => {
      fingerprintComponents.add(fp.componentName);
    });
  });

  // レスポンスデータの変換
  const records: ResponseExportRecord[] = responses.map((response) => {
    let responseDataJson: ResponseData[];

    try {
      // JSONパースを実行
      const parsedData = JSON.parse(response.responseDataJson);

      // Zodスキーマでバリデーション（配列形式であることを確認）
      const validationResult = ResponseDataJsonSchema.safeParse(parsedData);

      if (!validationResult.success) {
        logError(
          `Invalid response data format for response ${response.id}`,
          "api",
          {
            issues: validationResult.error.issues,
          },
        );

        // バリデーション失敗時は空配列として処理
        responseDataJson = [];
      } else {
        responseDataJson = validationResult.data;
      }
    } catch (parseError) {
      logError(
        `Failed to parse response data JSON for response ${response.id}`,
        "api",
        {
          error: parseError,
        },
      );

      // パースエラー時は空配列として処理
      responseDataJson = [];
    }

    // フォームブロック順にコンポーネント列を生成（システムブロックを除外）
    const componentColumns = answerableFormBlocks.map((block) => {
      const blockResponse = responseDataJson.find(
        (r) => r.question_id === block.blockId,
      );
      const value = resolveResponseValue(blockResponse);
      const displayValue = resolveResponseDisplayValue(
        blockResponse,
        responseLabelLookup.get(block.blockId),
      );

      return {
        block_id: block.blockId,
        block_type: block.type,
        question_title: blockResponse?.question_title,
        value,
        ...(displayValue !== undefined ? { display_value: displayValue } : {}),
      };
    });

    // 各フィンガープリントコンポーネントのUUID生成
    const fingerprintUuids: Record<string, string | null> = {};
    response.fingerprintDetails.forEach((fp) => {
      const componentUuid = uuidv5(fp.componentValueHash, namespace);
      fingerprintUuids[fp.componentName] = componentUuid;
    });

    const uaUuid = response.userAgent
      ? uuidv5(
          createHash("sha256").update(response.userAgent).digest("hex"),
          namespace,
        )
      : null;

    // ユニーク度スコアの計算
    const currentResponseWithFingerprints = responsesWithFingerprints.find(
      (r) => r.id === response.id,
    );
    const uniquenessScore = currentResponseWithFingerprints
      ? calculateUniqueness(
          currentResponseWithFingerprints,
          responsesWithFingerprints,
        )
      : 0;

    return {
      metadata: {
        id: response.id,
        form_id: response.formId,
        respondent_uuid: response.respondentUuid,
        submitted_at: response.submittedAt.toISOString(),
        updated_at: response.updatedAt?.toISOString(),
        country_code: response.countryCode ?? undefined,
        fingerprint_uuids: fingerprintUuids,
        ua_uuid: uaUuid,
        uniqueness_score: uniquenessScore,
        session_alias: response.sessionId
          ? computeSessionAlias(formId, response.sessionId)
          : undefined,
      },
      component_columns: componentColumns,
    };
  });

  return { records, fingerprintComponents };
}

function buildComponentColumnsFromRecords(
  records: ResponseExportRecord[],
  blockTitleMap: Map<string, string>,
  emptyRecordColumns: ResponseExportColumn[],
): ResponseExportColumn[] {
  const componentHeaders = new Map<string, ResponseExportColumn>();
  if (records.length === 0) {
    for (const column of emptyRecordColumns) {
      if (!componentHeaders.has(column.id)) {
        componentHeaders.set(column.id, column);
      }
    }
    return Array.from(componentHeaders.values());
  }

  for (const record of records) {
    for (const col of record.component_columns ?? []) {
      if (!componentHeaders.has(col.block_id)) {
        const blockTitle =
          col.question_title?.trim() ||
          blockTitleMap.get(col.block_id) ||
          col.block_id;
        componentHeaders.set(col.block_id, {
          id: col.block_id,
          title: blockTitle,
          blockType: col.block_type,
        });
      }
    }
  }

  return Array.from(componentHeaders.values());
}

function normalizeEmptyRecordColumns(
  emptyRecordBlockIds: Array<string | ResponseExportColumn>,
  blockTitleMap: Map<string, string>,
): ResponseExportColumn[] {
  return emptyRecordBlockIds.map((column) =>
    typeof column === "string"
      ? {
          id: column,
          title: blockTitleMap.get(column) ?? column,
        }
      : column,
  );
}

export function buildResponseExportTable(
  records: ResponseExportRecord[],
  fingerprintComponents: Set<string>,
  blockTitleMap: Map<string, string>,
  emptyRecordColumns: ResponseExportColumn[] = [],
): ResponseExportTable {
  const metadataIdHeaders = buildMetadataHeaders(fingerprintComponents, false);
  const metadataTitleHeaders = buildMetadataHeaders(
    fingerprintComponents,
    true,
  );
  const componentColumns = buildComponentColumnsFromRecords(
    records,
    blockTitleMap,
    emptyRecordColumns,
  );
  const headerIds = [
    ...metadataIdHeaders,
    ...componentColumns.map((column) => column.id),
  ];
  const headerTitles = [
    ...metadataTitleHeaders,
    ...componentColumns.map((column) => column.title),
  ];
  const rows = records.map((record) => {
    const metadataValues = buildMetadataValues(record, fingerprintComponents);
    const componentValues = componentColumns.map((column) => {
      const answer = record.component_columns?.find(
        (col) => col.block_id === column.id,
      );
      return answer
        ? stringifyValue(
            answer.display_value ?? answer.value,
            answer.block_type,
          )
        : "";
    });
    return neutralizeSpreadsheetFormulaValues([
      ...metadataValues,
      ...componentValues,
    ]);
  });

  return {
    headerIds: neutralizeSpreadsheetFormulaValues(headerIds),
    headerTitles: neutralizeSpreadsheetFormulaValues(headerTitles),
    rows,
  };
}

/**
 * 共通中間形式のレコードをCSV文字列に変換する
 */
export function formatRecordsToCsv(
  records: ResponseExportRecord[],
  fingerprintComponents: Set<string>,
  blockTitleMap: Map<string, string>,
  emptyRecordBlockIds: Array<string | ResponseExportColumn> = [],
): string {
  try {
    const table = buildResponseExportTable(
      records,
      fingerprintComponents,
      blockTitleMap,
      normalizeEmptyRecordColumns(emptyRecordBlockIds, blockTitleMap),
    );
    const csvRows = [table.headerTitles.map(escapeCSV).join(",")];

    table.rows.forEach((row) => {
      csvRows.push(row.map(escapeCSV).join(","));
    });

    return csvRows.join("\n");
  } catch (error) {
    logError("CSV generation error:", "api", { error });
    throw new Error(
      `CSV生成中にエラーが発生しました: ${error instanceof Error ? error.message : "不明なエラー"}`,
    );
  }
}

/**
 * 値の文字列化
 */
function stringifyValue(value: unknown, blockType: string): string {
  if (value === null || value === undefined) return "";

  switch (blockType) {
    case "short_text":
    case "long_text":
    case "radio":
    case "dropdown":
    case "date":
    case "time":
      return String(value);
    case "linear_scale":
    case "rating":
      return value != null ? String(value) : "";
    case "checkbox": {
      return Array.isArray(value) ? value.join(", ") : "";
    }
    case "choice_grid":
    case "checkbox_grid": {
      if (typeof value === "string") return value;
      return typeof value === "object" ? JSON.stringify(value) : "";
    }
    default:
      return "";
  }
}

export type MappingResult = {
  idRow: string[];
  titleRow: string[];
  row: string[];
  isNewLayout: boolean;
};

export function mapRecordToSheetRow(
  record: ResponseExportRecord,
  existingIdRow: string[],
  blockTitleMap: Map<string, string>,
  fingerprintComponents?: Set<string>,
  existingTitleRow?: string[],
): MappingResult {
  const RESPONSE_ID_HEADER = "Response ID";

  // メタデータヘッダーを取得
  const metadataIdHeaders = fingerprintComponents
    ? buildMetadataHeaders(fingerprintComponents, false)
    : [RESPONSE_ID_HEADER];
  const metadataTitleHeaders = fingerprintComponents
    ? buildMetadataHeaders(fingerprintComponents, true)
    : ["回答ID"];

  // タイトル重複解決用
  const suffixRegex = /^(.*) \((\d+)\)$/;
  const getBase = (name: string): string => {
    const m = name.match(suffixRegex);
    return m?.[1] ?? name;
  };
  const getTitleCountKey = (name: string): string => {
    const base = getBase(name);
    if (!base.startsWith("'")) return base;

    const possibleOriginal = base.slice(1);
    return neutralizeSpreadsheetFormulaValue(possibleOriginal) === base
      ? possibleOriginal
      : base;
  };

  // 既存のID行に新レイアウトの要件を満たすIDが含まれているかを判定
  const hasIdRow =
    existingIdRow.length > 0 && existingIdRow.includes(RESPONSE_ID_HEADER);

  // 新レイアウトとしてヘッダーを構築し直す必要がある場合
  if (!hasIdRow) {
    const metadataIdHeaders = fingerprintComponents
      ? buildMetadataHeaders(fingerprintComponents, false)
      : [RESPONSE_ID_HEADER];
    const metadataTitleHeaders = fingerprintComponents
      ? buildMetadataHeaders(fingerprintComponents, true)
      : ["回答ID"];
    const componentColumns = buildComponentColumnsFromRecords(
      [record],
      blockTitleMap,
      [],
    );
    const componentIds = componentColumns.map((column) => column.id);
    const rawComponentTitles = componentColumns.map((column) => column.title);

    const usedTitleCount: Record<string, number> = {};
    const componentTitles = rawComponentTitles.map((rawTitle) => {
      const base = getTitleCountKey(rawTitle);
      usedTitleCount[base] = (usedTitleCount[base] ?? 0) + 1;
      const titleCount = usedTitleCount[base];
      return titleCount === 1 ? base : `${base} (${titleCount})`;
    });

    const idRow = [...metadataIdHeaders, ...componentIds];
    const titleRow = [...metadataTitleHeaders, ...componentTitles];

    // メタデータ値
    const rowValues: string[] = [];
    if (fingerprintComponents) {
      rowValues.push(...buildMetadataValues(record, fingerprintComponents));
    } else {
      rowValues.push(record.metadata.id);
    }

    // 質問列の値
    const componentValues = componentColumns.map((column) => {
      const col = record.component_columns.find(
        (c) => c.block_id === column.id,
      );
      return col
        ? stringifyValue(col.display_value ?? col.value, col.block_type)
        : "";
    });

    const row = [...rowValues, ...componentValues];

    return {
      idRow: neutralizeSpreadsheetFormulaValues(idRow),
      titleRow: neutralizeSpreadsheetFormulaValues(titleRow),
      row: neutralizeSpreadsheetFormulaValues(row),
      isNewLayout: true,
    };
  }

  // 既にID行が存在する場合（= 新レイアウト運用中）
  const idRow = existingIdRow.slice();
  const titleRow: string[] = existingTitleRow
    ? existingTitleRow.slice(0, idRow.length)
    : [];

  while (titleRow.length < idRow.length) {
    titleRow.push("");
  }

  const row: string[] = Array(idRow.length).fill("");

  const usedTitleCount: Record<string, number> = {};
  for (const title of titleRow) {
    if (!title) continue;
    const base = getTitleCountKey(title);
    const current = usedTitleCount[base] ?? 0;
    const maybeNumber = title.match(suffixRegex)?.[2];
    const n = maybeNumber ? Number(maybeNumber) : 1;
    usedTitleCount[base] = Math.max(current, n);
  }

  // メタデータ列
  const findIdColumnIndex = (header: string): number =>
    idRow.indexOf(header) !== -1
      ? idRow.indexOf(header)
      : idRow.indexOf(neutralizeSpreadsheetFormulaValue(header));

  if (fingerprintComponents) {
    const metadataValues = buildMetadataValues(record, fingerprintComponents);
    metadataIdHeaders.forEach((header, idx) => {
      let colIndex = findIdColumnIndex(header);
      if (colIndex === -1) {
        colIndex = idRow.length;
        idRow.push(header);
        titleRow.push(metadataTitleHeaders[idx] ?? header);
        row.push("");
      }
      row[colIndex] = metadataValues[idx] ?? "";
      if (!titleRow[colIndex]) {
        titleRow[colIndex] = metadataTitleHeaders[idx] ?? header;
      }
    });
  } else {
    let colIndex = findIdColumnIndex(RESPONSE_ID_HEADER);
    if (colIndex === -1) {
      colIndex = idRow.length;
      idRow.push(RESPONSE_ID_HEADER);
      titleRow.push("回答ID");
      row.push("");
    }
    row[colIndex] = record.metadata.id;
    if (!titleRow[colIndex]) {
      titleRow[colIndex] = "回答ID";
    }
  }

  // block_id -> 列インデックスのマップを構築
  const idIndexByBlockId = new Map<string, number>();
  idRow.forEach((id, idx) => {
    if (!id) return;
    idIndexByBlockId.set(id, idx);
  });

  const ensureColumnForBlock = (blockId: string, title: string): number => {
    const existing =
      idIndexByBlockId.get(blockId) ??
      idIndexByBlockId.get(neutralizeSpreadsheetFormulaValue(blockId));
    if (existing != null) return existing;

    const base = getTitleCountKey(title);
    usedTitleCount[base] = (usedTitleCount[base] ?? 0) + 1;
    const titleCount = usedTitleCount[base];
    const finalTitle = titleCount === 1 ? base : `${base} (${titleCount})`;

    const colIndex = idRow.length;
    idRow.push(blockId);
    titleRow.push(finalTitle);
    row.push("");
    idIndexByBlockId.set(blockId, colIndex);
    return colIndex;
  };

  // コンポーネント列を処理
  if (record.component_columns) {
    for (const col of record.component_columns) {
      const rawTitle =
        col.question_title?.trim() ||
        blockTitleMap.get(col.block_id) ||
        col.block_id;
      const colIndex = ensureColumnForBlock(col.block_id, rawTitle);
      const value = stringifyValue(
        col.display_value ?? col.value,
        col.block_type,
      );
      row[colIndex] = value ?? "";
    }
  }

  // idRow / titleRow / row の長さを揃える
  while (titleRow.length < idRow.length) {
    titleRow.push("");
  }
  while (row.length < idRow.length) {
    row.push("");
  }

  return {
    idRow: neutralizeSpreadsheetFormulaValues(idRow),
    titleRow: neutralizeSpreadsheetFormulaValues(titleRow),
    row: neutralizeSpreadsheetFormulaValues(row),
    isNewLayout: false,
  };
}
