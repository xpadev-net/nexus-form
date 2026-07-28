import { createHash } from "node:crypto";
import {
  buildResponseExportColumnsFromBlocks,
  buildResponseExportTable,
  buildResponseExportValidationOutputColumns,
  isAnswerableBlockType,
  mapRecordToSheetRow,
  normalizeResponseExportColumns,
  type ResponseExportColumn,
  type ResponseExportFormBlock,
  type ResponseExportRecord,
  type ResponseExportTable,
  type ResponseExportValidationOutputColumn,
  type ResponseExportValidationOutputValue,
  type ValidationOutputExportSettings,
} from "@nexus-form/shared";
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

type ExportFormBlock = ResponseExportFormBlock;

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

export type { ResponseExportColumn, ResponseExportRecord, ResponseExportTable };
export {
  buildResponseExportColumnsFromBlocks,
  buildResponseExportTable,
  buildResponseExportValidationOutputColumns,
  mapRecordToSheetRow,
};

// RFC 4180準拠のCSVエスケープ関数
const escapeCSV = (str: string): string => {
  // ダブルクォートをエスケープ
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
};

function getBlockTitle(block: Pick<ExportFormBlock, "blockId" | "content">) {
  const content =
    block.content && typeof block.content === "object"
      ? (block.content as Record<string, unknown>)
      : null;
  return (content?.title as string) || block.blockId;
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
  validationOutputsByResponseId: Map<
    string,
    ResponseExportValidationOutputValue[]
  > = new Map(),
): { records: ResponseExportRecord[]; fingerprintComponents: Set<string> } {
  // ブロックタイトルマップを作成
  const blockTitleMap = new Map<string, string>();
  formBlocks.forEach((block) => {
    blockTitleMap.set(block.blockId, getBlockTitle(block));
  });
  const answerableFormBlocks = formBlocks.filter((block) =>
    isAnswerableBlockType(block.type),
  );
  const responseLabelLookup = buildResponseLabelLookupFromBlocks(formBlocks);

  // 疑似ID生成用の名前空間（フォーム固有）
  const namespace = uuidv5(formId, uuidv5.DNS);

  // ユニーク度スコアを事前計算
  const responsesWithFingerprints = responses.map((response) => ({
    id: response.id,
    sessionId: response.sessionId,
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
        session_alias:
          response.sessionId && process.env.SESSION_ALIAS_SALT
            ? computeSessionAlias(formId, response.sessionId)
            : undefined,
      },
      component_columns: componentColumns,
      validation_output_columns:
        validationOutputsByResponseId.get(response.id) ?? [],
    };
  });

  return { records, fingerprintComponents };
}

/**
 * Builds the deterministic validation output columns used by response CSV export.
 *
 * @param settings Saved per-rule/per-output export settings. Missing settings
 * keep discovered validation outputs enabled by default.
 * @param validationOutputsByResponseId Parsed validation output values grouped
 * by response ID from the constrained export query.
 * @returns Selected validation output columns in shared export order.
 */
export function buildValidationOutputColumnsForResponseExport(
  settings: ValidationOutputExportSettings | undefined,
  validationOutputsByResponseId: Map<
    string,
    ResponseExportValidationOutputValue[]
  >,
): ResponseExportValidationOutputColumn[] {
  return buildResponseExportValidationOutputColumns(
    settings,
    [...validationOutputsByResponseId.values()].flat(),
  );
}

/**
 * 共通中間形式のレコードをCSV文字列に変換する
 */
export function formatRecordsToCsv(
  records: ResponseExportRecord[],
  fingerprintComponents: Set<string>,
  blockTitleMap: Map<string, string>,
  emptyRecordBlockIds: Array<string | ResponseExportColumn> = [],
  emptyValidationOutputColumns?: ResponseExportValidationOutputColumn[],
  includeFingerprintColumns = false,
): string {
  try {
    const table = buildResponseExportTable(
      records,
      fingerprintComponents,
      blockTitleMap,
      normalizeResponseExportColumns(emptyRecordBlockIds, blockTitleMap),
      emptyValidationOutputColumns,
      includeFingerprintColumns,
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
