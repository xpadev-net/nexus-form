/**
 * Google Sheets 同期ハンドラ
 *
 * 新しいフォーム回答をGoogle Sheetsに追記する
 */

import { createHash } from "node:crypto";
import { db, formIntegration, formResponse } from "@nexus-form/database";
import {
  externalServiceValidationResult,
  fingerprintDetail,
  form,
  formSnapshot,
  formStructure,
  formValidationRule,
} from "@nexus-form/database/schema";
import {
  buildResponseExportValidationOutputColumns,
  buildResponseLabelLookupFromQuestions,
  calculateUniquenessScoreMap,
  denormalizeSpreadsheetFormulaValue,
  type ExtractedQuestion,
  extractQuestionsFromPlateContent,
  getUniquenessScoreRating,
  groupResponseExportValidationOutputsByResponseId,
  isAnswerableBlockType,
  mapRecordToSheetRow,
  neutralizeSpreadsheetFormulaValue,
  parseValidationOutputExportSettings,
  type ResponseDataItem,
  type ResponseExportRecord,
  type ResponseExportValidationOutputValue,
  type ResponseWithFingerprints,
  resolveResponseDisplayValue,
  responsePayloadItemSchema,
  type SheetsSyncJobData,
  sheetsSyncJobDataSchema,
  type ValidationOutputExportSettings,
  type ValidatorQuestion,
} from "@nexus-form/shared";
import { type Job, UnrecoverableError } from "bullmq";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  appendRows,
  batchUpdate,
  clearSheet,
  type GoogleApiError,
  readRange,
  SHEETS_API_TIMEOUT_MS,
  updateRange,
} from "../lib/google-sheets-client";
import {
  getOAuthToken,
  isOAuthRefreshPermanentAuthError,
  type OAuthToken,
  refreshTokenIfNeeded,
} from "../lib/oauth-token-store";
import {
  deleteIdempotencyKey,
  getIdempotencyKeyTtlMs,
  getIdempotencyKeyValue,
  setIdempotencyKey,
  setIdempotencyKeys,
  withRedisLock,
} from "../lib/redis-lock";
import { safeParseResponseData } from "../lib/response-data-extractor";
import { workerShutdownSignal } from "../lib/shutdown-signal";

export type SheetsSyncJob = SheetsSyncJobData;

const RESPONSE_ID_HEADER = "Response ID";
const UNIQUENESS_SCORE_HEADER = "ユニーク度スコア";
const UNIQUENESS_SCORE_ID_HEADER = "Uniqueness Score";
const UNIQUENESS_RATING_HEADER = "ユニーク度評価";
const UNIQUENESS_RATING_ID_HEADER = "Uniqueness Rating";
const SHARED_BASE_ID_HEADERS = [
  RESPONSE_ID_HEADER,
  "Respondent UUID",
  "Submitted At",
  "Updated At",
  "Country Code",
  UNIQUENESS_SCORE_ID_HEADER,
  UNIQUENESS_RATING_ID_HEADER,
];
const SHARED_BASE_TITLE_HEADERS = [
  "回答ID",
  "回答者UUID",
  "送信日時",
  "更新日時",
  "国コード",
  "ユニーク度スコア",
  "ユニーク度評価",
];
// Maximum Sheets API calls inside the critical section:
// 2 reads (idempotency check) + 1 conditional header update
// + 1 conditional uniqueness-score backfill + 1 append
const SHEETS_SYNC_API_CALLS_IN_CRITICAL_SECTION = 5;
const RESPONSE_UNIQUENESS_CALCULATION_LIMIT = 5000;
const MAX_FULL_SHEETS_SYNC_RESPONSES = 1000;
// Maximum rows sent in a single appendRows call during a full resync.
// MAX_FULL_SHEETS_SYNC_RESPONSES (1000) rows would still fit one request's
// size limits, but chunking keeps the "redo unit" small if a chunk hits a
// transient 429/5xx (a retry re-clears and rewrites the whole sheet anyway).
export const FULL_RESYNC_APPEND_CHUNK_SIZE = 200;
// Cap on how many other not-yet-synced same-integration responses a single
// incremental job will piggyback onto its own write (see issue 688). Equal to
// FULL_RESYNC_APPEND_CHUNK_SIZE so the whole batch always fits in one
// appendRows call — no chunking loop, and no need to resize the Redis lock
// TTL for the extra work.
const INCREMENTAL_PIGGYBACK_BATCH_CAP = FULL_RESYNC_APPEND_CHUNK_SIZE;
// How far back to look for piggyback candidates. Deliberately bounded: this
// only targets short submission bursts, not long-standing sync backlogs —
// anything older than this still gets written by its own individual job,
// exactly as before this change.
const INCREMENTAL_PIGGYBACK_LOOKBACK_MS = 5 * 60 * 1000;
// Add the headroom using the same timeout unit as Sheets API calls.
const SHEETS_SYNC_LOCK_BUFFER_MS = SHEETS_API_TIMEOUT_MS;
const PENDING_IDEMPOTENCY_EXTRA_BUFFER_MS = 30_000;
const PENDING_IDEMPOTENCY_POLL_INTERVAL_MS = 1_000;
const PENDING_IDEMPOTENCY_EXPIRED_SETTLE_MS = 100;
export const AUTH_REQUIRED_SYNC_ERROR_PREFIX = "AUTH_REQUIRED";
type SheetsSyncAuthFailure = "AUTH_REQUIRED" | "OTHER_FAILURE";

function classifySheetsSyncFailure(
  error: GoogleApiError,
): SheetsSyncAuthFailure {
  return error.code === "unauthorized" || error.code === "forbidden"
    ? "AUTH_REQUIRED"
    : "OTHER_FAILURE";
}

function getSheetsSyncFailureMessage(
  context: string,
  result: { error: GoogleApiError },
): string {
  if (classifySheetsSyncFailure(result.error) === "AUTH_REQUIRED") {
    return `${AUTH_REQUIRED_SYNC_ERROR_PREFIX}: ${context}: ${result.error.message}`;
  }

  if (result.error.code === "rateLimit") {
    return `Google Sheets API rate limit: ${context}: ${result.error.message}`;
  }

  return `Failed to ${context}: ${result.error.message}`;
}

function failSheetsSyncWithoutRetry(reason: string): never {
  throw new UnrecoverableError(reason);
}

function throwSheetsSyncFailure(
  context: string,
  result: { error: GoogleApiError },
): never {
  const message = getSheetsSyncFailureMessage(context, result);
  if (classifySheetsSyncFailure(result.error) === "AUTH_REQUIRED") {
    failSheetsSyncWithoutRetry(message);
  }
  throw new Error(message);
}
function authRequiredMessage(context: string): string {
  return `${AUTH_REQUIRED_SYNC_ERROR_PREFIX}: ${context}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function refreshTokenForSheetsSync(
  token: OAuthToken,
): Promise<OAuthToken> {
  try {
    return await refreshTokenIfNeeded(token);
  } catch (error) {
    if (isOAuthRefreshPermanentAuthError(error)) {
      failSheetsSyncWithoutRetry(
        authRequiredMessage(
          `OAuth token refresh failed: ${getErrorMessage(error)}`,
        ),
      );
    }
    throw error;
  }
}

function getWorkerShutdownReason(): unknown {
  return (
    workerShutdownSignal.reason ??
    new DOMException("Worker shutting down", "AbortError")
  );
}

function throwIfShuttingDown(): void {
  if (workerShutdownSignal.aborted) {
    throw getWorkerShutdownReason();
  }
}

function sleepForPendingIdempotency(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  throwIfShuttingDown();

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(getWorkerShutdownReason());
    };
    timer = setTimeout(() => {
      workerShutdownSignal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    workerShutdownSignal.addEventListener("abort", onAbort, { once: true });
  });
}

const SHEETS_SYNC_API_CRITICAL_TIMEOUT_MS =
  SHEETS_API_TIMEOUT_MS * SHEETS_SYNC_API_CALLS_IN_CRITICAL_SECTION;
const SHEETS_SYNC_CRITICAL_SECTION_TTL_MS =
  SHEETS_SYNC_API_CRITICAL_TIMEOUT_MS + SHEETS_SYNC_LOCK_BUFFER_MS;
/** Exported public API: pending idempotency TTL in seconds; must exceed one critical section by an extra retry margin. */
export const PENDING_IDEMPOTENCY_TTL_SECONDS = Math.ceil(
  (SHEETS_SYNC_CRITICAL_SECTION_TTL_MS + PENDING_IDEMPOTENCY_EXTRA_BUFFER_MS) /
    1000,
);
/**
 * Exported public API: Redis lock TTL in ms; sized for one pending
 * idempotency wait plus one critical section.
 */
export const SHEETS_SYNC_LOCK_TTL_MS =
  SHEETS_SYNC_CRITICAL_SECTION_TTL_MS + PENDING_IDEMPOTENCY_TTL_SECONDS * 1000;
/** Exported public API: Redis lock wait timeout in ms; covers one held lock. */
export const SHEETS_SYNC_LOCK_WAIT_TIMEOUT_MS = SHEETS_SYNC_LOCK_TTL_MS + 5_000;
export const DONE_IDEMPOTENCY_TTL_SECONDS = 7 * 24 * 60 * 60;

const GoogleSheetsIntegrationSettingSchema = z.object({
  spreadsheetId: z.string().min(1),
  sheetName: z.string().min(1),
});

const IntegrationConfigSchema = z.record(z.string(), z.unknown());
type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;
type FingerprintSet = ResponseWithFingerprints;

type ResponseUniquenessScores = {
  allScores: Map<string, number>;
  fingerprintComponents: Set<string>;
  shouldBlankUnavailableScores: boolean;
  targetScore: number | null;
  targetFingerprintUuids: Record<string, string | null>;
};
type SheetLayout = "empty" | "shared" | "legacy";
type SheetsSyncTargetResponse = typeof formResponse.$inferSelect;
type PreparedSheetsSyncResponse =
  | {
      status: "ready";
      response: SheetsSyncTargetResponse;
      responseData: Record<string, unknown>;
      uniquenessScores: ResponseUniquenessScores;
    }
  | {
      status: "invalid_data";
      response: SheetsSyncTargetResponse;
    };
type ParsedSheetsSyncResponse =
  | Omit<
      Extract<PreparedSheetsSyncResponse, { status: "ready" }>,
      "uniquenessScores"
    >
  | Extract<PreparedSheetsSyncResponse, { status: "invalid_data" }>;
type SheetReadResult = {
  ok: true;
  exists: boolean;
  headers: string[];
  titleHeaders: string[];
  layout: SheetLayout;
  responseIds: string[];
  headerRowCount: number;
};

function resolveGoogleSheetsConfig(
  rawConfig: IntegrationConfig,
): IntegrationConfig {
  if (rawConfig.googleSheets == null) {
    return rawConfig;
  }

  const googleSheetsConfigResult = IntegrationConfigSchema.safeParse(
    rawConfig.googleSheets,
  );
  if (!googleSheetsConfigResult.success) {
    throw new Error("Google Sheets integration setting must be an object");
  }
  return googleSheetsConfigResult.data;
}

export const handleSheetsSync = async (job: Job<SheetsSyncJob>) => {
  const { formId, integrationId, mode, responseId, snapshotVersion } =
    sheetsSyncJobDataSchema.parse(job.data);

  // 1. Integration設定を取得
  const [integration] = await db
    .select()
    .from(formIntegration)
    .where(
      and(
        eq(formIntegration.id, integrationId),
        eq(formIntegration.formId, formId),
      ),
    )
    .limit(1);

  if (!integration) {
    throw new Error(`Form integration not found: ${integrationId}`);
  }

  const rawConfigJson = integration.configJson;
  if (rawConfigJson == null) {
    throw new Error("Form integration configJson is empty");
  }

  let parsedConfig: unknown;
  try {
    parsedConfig =
      typeof rawConfigJson === "string"
        ? JSON.parse(rawConfigJson)
        : rawConfigJson;
  } catch {
    throw new Error("Form integration configJson is not valid");
  }
  const rawConfigResult = IntegrationConfigSchema.safeParse(parsedConfig);
  if (!rawConfigResult.success) {
    throw new Error("Form integration configJson must be an object");
  }
  const rawConfig = rawConfigResult.data;
  const googleSheetsConfig = resolveGoogleSheetsConfig(rawConfig);
  const settingResult =
    GoogleSheetsIntegrationSettingSchema.safeParse(googleSheetsConfig);

  if (!settingResult.success) {
    const paths = settingResult.error.issues.map((i) => i.path.join("."));
    console.error("[sheets-sync] Invalid Google Sheets integration setting", {
      issueCount: settingResult.error.issues.length,
      paths,
    });
    throw new Error("Invalid Google Sheets integration setting");
  }

  const { spreadsheetId, sheetName } = settingResult.data;
  await job.updateProgress(10);

  // 2. OAuthトークンを取得
  const userId = integration.userId ?? integration.ownerUserId;
  if (!userId) {
    throw new Error("No user ID found for integration");
  }

  const initialToken = await getOAuthToken(userId);
  if (!initialToken) {
    return failSheetsSyncWithoutRetry(
      authRequiredMessage("OAuth token not found"),
    );
  }

  const token = await refreshTokenForSheetsSync(initialToken);
  await job.updateProgress(20);

  // 3. 同期対象のレスポンスを取得
  const { responses, shouldClearSheet } = await getSheetsSyncTargetResponses({
    formId,
    mode,
    responseId,
  });

  // 4. 送信時 snapshot の Plate コンテンツからブロックタイトルマップを構築。
  // 古いジョブに snapshotVersion が無い場合だけ現在の draft にフォールバックする。
  const [plateRecord] =
    snapshotVersion === undefined
      ? await db
          .select({ plateContent: form.plateContent })
          .from(form)
          .where(eq(form.id, formId))
          .limit(1)
      : await db
          .select({
            plateContent: formSnapshot.plateContent,
            structureJson: formSnapshot.structureJson,
          })
          .from(formSnapshot)
          .where(
            and(
              eq(formSnapshot.formId, formId),
              eq(formSnapshot.version, snapshotVersion),
            ),
          )
          .limit(1);

  const blockTitleMap = new Map<string, string>();
  let extractedQuestions: ExtractedQuestion[] = [];
  if (plateRecord?.plateContent) {
    try {
      const parsed: unknown = JSON.parse(plateRecord.plateContent);
      if (Array.isArray(parsed)) {
        extractedQuestions = extractQuestionsFromPlateContent(parsed);
        for (const q of extractedQuestions) {
          if (q.blockId) {
            blockTitleMap.set(q.blockId, q.title || q.blockId);
          }
        }
      }
    } catch {
      // plateContent が不正な場合はマップを空のまま続行
    }
  }
  await job.updateProgress(40);

  const lockKey = `sheets-sync:${integrationId}`;

  const preparedResponses = await prepareSheetsSyncResponses(formId, responses);
  const currentStructureJson =
    snapshotVersion === undefined
      ? await getActiveFormStructureJson(formId)
      : undefined;
  const validationOutputExportSettings =
    parseValidationOutputExportSettingsFromStructureJson(
      snapshotVersion === undefined
        ? currentStructureJson
        : getSnapshotStructureJson(plateRecord),
    );
  const validationOutputsByResponseId = await getValidationOutputsByResponseId({
    formId,
    responseIds: preparedResponses.flatMap((prepared) =>
      prepared.status === "ready" ? [prepared.response.id] : [],
    ),
    settings: validationOutputExportSettings,
  });
  const total = preparedResponses.length;
  let processed = 0;
  let skipped = 0;
  let updatedRows = 0;
  let updatedRange: string | undefined;

  // ロックでシート書き込みを直列化（ヘッダー競合を防ぐ）。
  // Full-mode batches keep the same integration lock across all historical
  // rows, so incremental jobs cannot interleave with a partially updated
  // header/layout.
  return await withRedisLock(
    lockKey,
    async () => {
      if (shouldClearSheet) {
        if (preparedResponses.some((prepared) => prepared.status !== "ready")) {
          throw new Error(
            `Full sheets sync aborted for integration ${integrationId}: incomplete response preparation`,
          );
        }
        await clearSheetForFullResync(token, {
          spreadsheetId,
          sheetName,
          integrationId,
          responseIds: preparedResponses.map(
            (prepared) => prepared.response.id,
          ),
        });

        const readyResponses = preparedResponses.filter(
          (
            prepared,
          ): prepared is Extract<
            PreparedSheetsSyncResponse,
            { status: "ready" }
          > => prepared.status === "ready",
        );
        const bulkResult = await bulkWriteFullResyncResponses({
          blockTitleMap,
          extractedQuestions,
          integrationId,
          job,
          readyResponses,
          sheetName,
          spreadsheetId,
          token,
          total,
          validationOutputsByResponseId,
        });

        return {
          ok: true,
          provider: "google-sheets",
          jobId: job.id,
          mode,
          processed: preparedResponses.length,
          total,
          skipped: 0,
          updatedRange: bulkResult.updatedRange,
          updatedRows: bulkResult.updatedRows,
        };
      }
      if (mode === "incremental") {
        const prepared = preparedResponses[0];
        if (!prepared) {
          throw new Error(`Form response not found: ${responseId}`);
        }
        const result =
          prepared.status === "ready"
            ? await writeIncrementalSheetsSyncBatch({
                blockTitleMap,
                extractedQuestions,
                formId,
                integrationId,
                job,
                sheetName,
                spreadsheetId,
                target: prepared,
                token,
                validationOutputExportSettings,
                validationOutputsByResponseId,
              })
            : {
                ok: true,
                skipped: true,
                reason: "invalid_data" as const,
                provider: "google-sheets" as const,
                jobId: job.id,
              };
        await updateSheetsSyncProgress(job, 100, 1, total).catch(() => {
          // Best-effort progress update; job result is what matters.
        });
        const isSkipped = "skipped" in result && result.skipped;
        return {
          ...result,
          mode,
          processed: total,
          total,
          skipped: isSkipped ? total : 0,
        };
      }

      for (const prepared of preparedResponses) {
        const result =
          prepared.status === "ready"
            ? await writePreparedSheetsSyncResponse({
                blockTitleMap,
                extractedQuestions,
                integrationId,
                job,
                prepared,
                progress: { processed, total },
                sheetName,
                spreadsheetId,
                token,
                validationOutputsByResponseId,
              })
            : {
                ok: true,
                skipped: true,
                reason: "invalid_data",
                provider: "google-sheets",
                jobId: job.id,
              };

        processed += 1;
        if ("skipped" in result && result.skipped) {
          skipped += 1;
        } else if ("updatedRows" in result) {
          updatedRows += result.updatedRows;
          updatedRange = result.updatedRange;
        }
        await updateSheetsSyncProgress(job, 100, processed, total).catch(() => {
          // Best-effort progress update; job result is what matters.
        });
      }

      return {
        ok: true,
        provider: "google-sheets",
        jobId: job.id,
        mode,
        processed,
        total,
        skipped,
        updatedRange,
        updatedRows,
      };
    },
    getSheetsSyncLockOptions(total),
  );
};

function getSheetsSyncLockOptions(responseCount: number) {
  const lockMultiplier = Math.max(1, responseCount);
  const ttlMs = SHEETS_SYNC_LOCK_TTL_MS * lockMultiplier;
  return {
    ttlMs,
    waitTimeoutMs:
      SHEETS_SYNC_LOCK_WAIT_TIMEOUT_MS +
      SHEETS_SYNC_LOCK_TTL_MS * (lockMultiplier - 1),
    signal: workerShutdownSignal,
  };
}

async function getSheetsSyncTargetResponses(params: {
  formId: string;
  mode: SheetsSyncJob["mode"];
  responseId: string;
}): Promise<{
  responses: SheetsSyncTargetResponse[];
  shouldClearSheet: boolean;
}> {
  if (params.mode === "incremental") {
    const [response] = await db
      .select()
      .from(formResponse)
      .where(
        and(
          eq(formResponse.id, params.responseId),
          eq(formResponse.formId, params.formId),
        ),
      )
      .limit(1);

    if (!response) {
      throw new Error(`Form response not found: ${params.responseId}`);
    }
    return { responses: [response], shouldClearSheet: false };
  }

  const responses = await db
    .select()
    .from(formResponse)
    .where(eq(formResponse.formId, params.formId))
    .orderBy(asc(formResponse.submittedAt), asc(formResponse.id))
    .limit(MAX_FULL_SHEETS_SYNC_RESPONSES + 1);

  if (responses.length === 0) {
    throw new Error(`Form response not found: ${params.responseId}`);
  }
  if (responses.length > MAX_FULL_SHEETS_SYNC_RESPONSES) {
    failSheetsSyncWithoutRetry(
      `Full Google Sheets sync is limited to ${MAX_FULL_SHEETS_SYNC_RESPONSES} responses`,
    );
  }

  const targetResponseIndex = responses.findIndex(
    (response) => response.id === params.responseId,
  );
  if (targetResponseIndex === -1) {
    throw new Error(`Form response not found: ${params.responseId}`);
  }

  if (targetResponseIndex === 0) {
    return { responses, shouldClearSheet: true };
  }

  const targetResponse = responses[targetResponseIndex];
  if (!targetResponse) {
    throw new Error(`Form response not found: ${params.responseId}`);
  }
  return { responses: [targetResponse], shouldClearSheet: false };
}

async function clearSheetForFullResync(
  token: OAuthToken,
  params: {
    spreadsheetId: string;
    sheetName: string;
    integrationId: string;
    responseIds: string[];
  },
): Promise<void> {
  const keys = params.responseIds.map(
    (responseId) => `sheets-written:${params.integrationId}:${responseId}`,
  );
  for (let i = 0; i < keys.length; i += 500) {
    throwIfShuttingDown();
    const chunk = keys.slice(i, i + 500);
    await Promise.all(chunk.map((key) => deleteIdempotencyKey(key)));
  }

  const clearResult = await clearSheet(token, {
    spreadsheetId: params.spreadsheetId,
    sheetName: params.sheetName,
  });
  if (!clearResult.ok) {
    throwSheetsSyncFailure("clear sheet for full resync", clearResult);
  }
}

/**
 * Writes every ready response for a full resync in bulk instead of one Sheets
 * API round trip per response. Safe only because the caller has just cleared
 * the sheet under the integration lock: the header/row state this function
 * would otherwise re-read from Sheets on every iteration is always exactly
 * what this same call already wrote in a prior iteration, so it can be
 * tracked in memory instead. This also means the per-existing-row uniqueness
 * score backfill (`updateExistingUniquenessScoreCells`) is unnecessary here —
 * every row's own score is already computed against the full response
 * cohort by `getUniquenessScoresForResponses` before this function runs.
 *
 * `readyResponses` is never empty in practice: `getSheetsSyncTargetResponses`
 * throws if a full-mode sync has zero form responses, and the caller already
 * asserts every prepared response is "ready" before invoking this function.
 */
async function bulkWriteFullResyncResponses(params: {
  blockTitleMap: Map<string, string>;
  extractedQuestions: ExtractedQuestion[];
  integrationId: string;
  job: Job<SheetsSyncJob>;
  readyResponses: Array<
    Extract<PreparedSheetsSyncResponse, { status: "ready" }>
  >;
  sheetName: string;
  spreadsheetId: string;
  token: OAuthToken;
  total: number;
  validationOutputsByResponseId: Map<
    string,
    ResponseExportValidationOutputValue[]
  >;
}): Promise<{ updatedRange: string | undefined; updatedRows: number }> {
  const {
    blockTitleMap,
    extractedQuestions,
    integrationId,
    job,
    readyResponses,
    sheetName,
    spreadsheetId,
    token,
    total,
    validationOutputsByResponseId,
  } = params;

  let headers: string[] = [];
  let titleHeaders: string[] = [];
  const rows: string[][] = [];

  for (const prepared of readyResponses) {
    const built = buildRowFromResponse(
      headers,
      titleHeaders,
      "shared",
      prepared.responseData,
      extractedQuestions,
      blockTitleMap,
      prepared.response,
      prepared.uniquenessScores.targetScore,
      prepared.uniquenessScores.fingerprintComponents,
      prepared.uniquenessScores.targetFingerprintUuids,
      validationOutputsByResponseId.get(prepared.response.id) ?? [],
    );
    headers = built.headers;
    titleHeaders = built.titleHeaders;
    rows.push(built.row);
  }

  await updateSheetsSyncProgress(job, 50, 0, total).catch(() => {
    // Best-effort progress update; job result is what matters.
  });

  throwIfShuttingDown();
  const headerUpdateResult = await updateRange(token, {
    spreadsheetId,
    rangeA1: `${sheetName}!1:2`,
    values: [headers, titleHeaders],
  });
  if (!headerUpdateResult.ok) {
    throwSheetsSyncFailure("update headers", headerUpdateResult);
  }

  let updatedRange: string | undefined;
  let updatedRows = 0;
  for (let i = 0; i < rows.length; i += FULL_RESYNC_APPEND_CHUNK_SIZE) {
    throwIfShuttingDown();
    const chunk = rows.slice(i, i + FULL_RESYNC_APPEND_CHUNK_SIZE);
    const appendResult = await appendRows(token, {
      spreadsheetId,
      sheetName,
      rows: chunk,
    });
    if (!appendResult.ok) {
      throwSheetsSyncFailure("append rows", appendResult);
    }
    updatedRange = appendResult.data.updatedRange;
    updatedRows += appendResult.data.updatedRows;
    await updateSheetsSyncProgress(
      job,
      80,
      Math.min(i + chunk.length, rows.length),
      total,
    ).catch(() => {
      // Best-effort progress update; job result is what matters.
    });
  }

  const doneKeys = readyResponses.map((prepared) =>
    getSheetsSyncIdempotencyKey(integrationId, prepared.response.id),
  );
  try {
    await setIdempotencyKeys(doneKeys, DONE_IDEMPOTENCY_TTL_SECONDS, "done");
  } catch (e: unknown) {
    console.warn(
      `[sheets-sync] Could not persist idempotency keys: ${e instanceof Error ? e.message : e}`,
    );
  }

  await updateSheetsSyncProgress(job, 100, total, total).catch(() => {
    // Best-effort progress update; job result is what matters.
  });

  return { updatedRange, updatedRows };
}

async function prepareSheetsSyncResponses(
  formId: string,
  responses: SheetsSyncTargetResponse[],
): Promise<PreparedSheetsSyncResponse[]> {
  const parsedResponses: ParsedSheetsSyncResponse[] = [];
  const readyResponseIds: string[] = [];
  for (const response of responses) {
    // レスポンスデータをパース（不正データはスキップして再試行ループを避ける）
    const responseData = safeParseResponseData(
      response.responseDataJson,
      response.id,
    );
    if (!responseData) {
      parsedResponses.push({ status: "invalid_data", response });
      continue;
    }

    readyResponseIds.push(response.id);
    parsedResponses.push({
      status: "ready",
      response,
      responseData,
    });
  }

  const uniquenessScoresByResponseId =
    readyResponseIds.length === 0
      ? new Map<string, ResponseUniquenessScores>()
      : await getUniquenessScoresForResponses(formId, readyResponseIds);

  return parsedResponses.map((parsedResponse) => {
    if (parsedResponse.status !== "ready") {
      return parsedResponse;
    }
    const uniquenessScores = uniquenessScoresByResponseId.get(
      parsedResponse.response.id,
    );
    if (!uniquenessScores) {
      throw new Error(
        `Uniqueness score was not calculated: ${parsedResponse.response.id}`,
      );
    }
    return {
      ...parsedResponse,
      uniquenessScores,
    };
  });
}

async function getActiveFormStructureJson(
  formId: string,
): Promise<string | undefined> {
  const [activeStructure] = await db
    .select({ structureJson: formStructure.structureJson })
    .from(formStructure)
    .where(
      and(eq(formStructure.formId, formId), eq(formStructure.isActive, true)),
    )
    .orderBy(desc(formStructure.version))
    .limit(1);
  return activeStructure?.structureJson;
}

function getSnapshotStructureJson(
  plateRecord:
    | { plateContent: string | null }
    | { plateContent: string; structureJson: string }
    | undefined,
): string | undefined {
  return plateRecord && "structureJson" in plateRecord
    ? plateRecord.structureJson
    : undefined;
}

function parseValidationOutputExportSettingsFromStructureJson(
  structureJson: string | null | undefined,
): ValidationOutputExportSettings {
  if (!structureJson) return { values: [] };
  try {
    const parsed: unknown = JSON.parse(structureJson);
    const settings =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as { settings?: { validation_output_export?: unknown } })
            .settings
        : undefined;
    return parseValidationOutputExportSettings(
      settings?.validation_output_export,
    );
  } catch {
    return { values: [] };
  }
}

async function getValidationOutputsByResponseId(params: {
  formId: string;
  responseIds: string[];
  settings: ValidationOutputExportSettings;
}): Promise<Map<string, ResponseExportValidationOutputValue[]>> {
  if (params.responseIds.length === 0) return new Map();

  const rows = await db
    .select({
      responseId: externalServiceValidationResult.responseId,
      ruleId: externalServiceValidationResult.ruleId,
      metadata: externalServiceValidationResult.metadata,
      service: externalServiceValidationResult.service,
      ruleName: formValidationRule.name,
      providerName: formValidationRule.providerName,
      ruleType: formValidationRule.ruleType,
    })
    .from(externalServiceValidationResult)
    .innerJoin(
      formResponse,
      eq(externalServiceValidationResult.responseId, formResponse.id),
    )
    .leftJoin(
      formValidationRule,
      eq(externalServiceValidationResult.ruleId, formValidationRule.id),
    )
    .where(
      and(
        eq(formResponse.formId, params.formId),
        inArray(formResponse.id, params.responseIds),
        eq(externalServiceValidationResult.status, "COMPLETED"),
      ),
    )
    .orderBy(
      desc(externalServiceValidationResult.updatedAt),
      desc(externalServiceValidationResult.createdAt),
    );

  const outputsByResponseId =
    groupResponseExportValidationOutputsByResponseId(rows);

  const selectedColumns = buildResponseExportValidationOutputColumns(
    params.settings,
    [...outputsByResponseId.values()].flat(),
  );
  return new Map(
    params.responseIds.map((responseId) => {
      const valueByColumnKey = new Map(
        (outputsByResponseId.get(responseId) ?? []).map((value) => [
          `${value.rule_id}:${value.output_key}`,
          value,
        ]),
      );
      return [
        responseId,
        selectedColumns.map((column) => {
          const value = valueByColumnKey.get(
            `${column.ruleId}:${column.outputKey}`,
          );
          return {
            rule_id: column.ruleId,
            rule_name: column.ruleName,
            provider_name: column.providerName,
            rule_type: column.ruleType,
            output_key: column.outputKey,
            label: column.label,
            value: value?.value ?? "",
          };
        }),
      ];
    }),
  );
}

type SheetsSyncDuplicateSkipResult = {
  ok: true;
  skipped: true;
  reason: "duplicate";
  provider: "google-sheets";
  jobId: string | undefined;
};

type WritableSheetsSyncTargetResolution =
  | { status: "skip"; result: SheetsSyncDuplicateSkipResult }
  | { status: "writable"; sheetCheck: SheetReadResult };

/**
 * Resolves a single response's own Redis idempotency key against the sheet's
 * current content, blocking (while holding the integration lock) until it's
 * safe to write. Shared by the single-response write path and the
 * incremental batch path — both need this exact "own key" duplicate guard
 * before they may touch the sheet at all.
 */
async function resolveWritableSheetsSyncTarget(params: {
  idempotencyKey: string;
  job: Job<SheetsSyncJob>;
  responseId: string;
  sheetName: string;
  spreadsheetId: string;
  token: OAuthToken;
}): Promise<WritableSheetsSyncTargetResolution> {
  const { idempotencyKey, job, responseId, sheetName, spreadsheetId, token } =
    params;

  const duplicateSkippedResult = (): SheetsSyncDuplicateSkipResult => ({
    ok: true,
    skipped: true,
    reason: "duplicate",
    provider: "google-sheets",
    jobId: job.id,
  });

  // BullMQ jobId deduplication prevents duplicate concurrent jobs.
  // A Redis idempotency key guards against duplicate rows on BullMQ retries
  // (jobId dedup only applies while the job is still in the queue).
  while (true) {
    const keyValue = await getIdempotencyKeyValue(idempotencyKey);

    if (keyValue === "done") {
      // A prior attempt already wrote the row; skip.
      return { status: "skip", result: duplicateSkippedResult() };
    }

    if (keyValue === "pending") {
      // The lock TTL expired while another job's critical section is still in
      // progress, or the prior attempt crashed before the row was written.
      // Keep the integration lock while waiting so no other response can
      // update headers or append rows for this integration in between.
      const pendingResult =
        await waitForPendingIdempotencyToResolve(idempotencyKey);
      if (pendingResult === "done") {
        return { status: "skip", result: duplicateSkippedResult() };
      }
      continue;
    }

    // Mark as "pending" before any Sheets API call in this critical section.
    // If Redis is unavailable, throw so the job retries rather than writing
    // without the duplicate guard.
    await setIdempotencyKey(
      idempotencyKey,
      PENDING_IDEMPOTENCY_TTL_SECONDS,
      "pending",
    );

    const sheetCheck = await readSheetForIdempotency(token, {
      spreadsheetId,
      sheetName,
      responseId,
    });
    if (sheetCheck.exists) {
      await setIdempotencyKey(
        idempotencyKey,
        DONE_IDEMPOTENCY_TTL_SECONDS,
        "done",
      ).catch((e: unknown) => {
        console.warn(
          `[sheets-sync] Could not persist idempotency key ${idempotencyKey}: ${e instanceof Error ? e.message : e}`,
        );
      });
      return { status: "skip", result: duplicateSkippedResult() };
    }

    return { status: "writable", sheetCheck };
  }
}

async function writePreparedSheetsSyncResponse(params: {
  blockTitleMap: Map<string, string>;
  extractedQuestions: ExtractedQuestion[];
  integrationId: string;
  job: Job<SheetsSyncJob>;
  prepared: Extract<PreparedSheetsSyncResponse, { status: "ready" }>;
  progress: { processed: number; total: number };
  sheetName: string;
  spreadsheetId: string;
  token: OAuthToken;
  validationOutputsByResponseId: Map<
    string,
    ResponseExportValidationOutputValue[]
  >;
}) {
  const {
    blockTitleMap,
    extractedQuestions,
    integrationId,
    job,
    prepared,
    progress,
    sheetName,
    spreadsheetId,
    token,
    validationOutputsByResponseId,
  } = params;
  const { response, responseData, uniquenessScores } = prepared;
  const idempotencyKey = getSheetsSyncIdempotencyKey(
    integrationId,
    response.id,
  );

  const resolution = await resolveWritableSheetsSyncTarget({
    idempotencyKey,
    job,
    responseId: response.id,
    sheetName,
    spreadsheetId,
    token,
  });
  if (resolution.status === "skip") {
    return resolution.result;
  }
  const { sheetCheck } = resolution;

  // ヘッダー行を取得
  const existingHeaders = sheetCheck.headers;

  await updateSheetsSyncProgress(job, 60, progress.processed, progress.total);

  // ヘッダーと行データを構築
  const { headers, titleHeaders, row } = buildRowFromResponse(
    existingHeaders,
    sheetCheck.titleHeaders,
    sheetCheck.layout,
    responseData,
    extractedQuestions,
    blockTitleMap,
    response,
    uniquenessScores.targetScore,
    uniquenessScores.fingerprintComponents,
    uniquenessScores.targetFingerprintUuids,
    validationOutputsByResponseId.get(response.id) ?? [],
  );

  const titleHeadersChanged =
    sheetCheck.layout !== "legacy" &&
    hasSheetRowChanged(titleHeaders, sheetCheck.titleHeaders);

  // ヘッダーが変更された場合は更新
  if (
    existingHeaders.length === 0 ||
    headers.length > existingHeaders.length ||
    titleHeadersChanged
  ) {
    throwIfShuttingDown();
    const headerUpdateResult = await updateRange(token, {
      spreadsheetId,
      rangeA1:
        sheetCheck.layout === "legacy"
          ? `${sheetName}!1:1`
          : `${sheetName}!1:2`,
      values:
        sheetCheck.layout === "legacy" ? [headers] : [headers, titleHeaders],
    });
    if (!headerUpdateResult.ok) {
      throwSheetsSyncFailure("update headers", headerUpdateResult);
    }
  }
  await updateExistingUniquenessScoreCells(token, {
    spreadsheetId,
    sheetName,
    headers,
    responseIds: sheetCheck.responseIds,
    headerRowCount: sheetCheck.headerRowCount,
    shouldBlankUnavailableScores: uniquenessScores.shouldBlankUnavailableScores,
    uniquenessScores: uniquenessScores.allScores,
  });
  await updateSheetsSyncProgress(job, 80, progress.processed, progress.total);

  // 行を追記
  throwIfShuttingDown();
  const appendResult = await appendRows(token, {
    spreadsheetId,
    sheetName,
    rows: [row],
  });

  if (!appendResult.ok) {
    throwSheetsSyncFailure("append rows", appendResult);
  }
  // Promote "pending" → "done" BEFORE updateProgress so a
  // transient BullMQ/Redis error on progress update doesn't trigger a retry
  // that would duplicate the row. Keep it for the manual retry window.
  // Best-effort: do NOT throw on failure.
  await setIdempotencyKey(
    idempotencyKey,
    DONE_IDEMPOTENCY_TTL_SECONDS,
    "done",
  ).catch((e: unknown) => {
    console.warn(
      `[sheets-sync] Could not persist idempotency key ${idempotencyKey}: ${e instanceof Error ? e.message : e}`,
    );
  });

  return {
    ok: true,
    provider: "google-sheets",
    jobId: job.id,
    updatedRange: appendResult.data.updatedRange,
    updatedRows: appendResult.data.updatedRows,
  };
}

/**
 * Finds other same-form responses not yet written to this integration's
 * sheet, submitted within a short recent window. Bounded to `cap` results,
 * ordered oldest-first, so a sustained burst is drained in FIFO order across
 * successive piggyback batches rather than repeatedly re-fetching the same
 * newest slice (see issue 688 design discussion — plain "most recent N" sampling
 * can permanently starve older pending responses under a sustained burst).
 */
async function findIncrementalPiggybackCandidates(params: {
  cap: number;
  excludeResponseId: string;
  formId: string;
  lookbackMs: number;
  now?: Date;
  sheetResponseIds: string[];
}): Promise<SheetsSyncTargetResponse[]> {
  const since = new Date(
    (params.now ?? new Date()).getTime() - params.lookbackMs,
  );
  // 1. 直近のlookbackMs期間に送信されたレスポンスIDと送信日時をDBから取得（インデックスを利用して高速にIDのみ抽出）
  const recentResponses = await db
    .select({ id: formResponse.id, submittedAt: formResponse.submittedAt })
    .from(formResponse)
    .where(
      and(
        eq(formResponse.formId, params.formId),
        gte(formResponse.submittedAt, since),
      ),
    )
    .orderBy(asc(formResponse.submittedAt), asc(formResponse.id));

  // 2. すでにシートに書き込まれたIDとターゲットIDを除外した未送信のIDリストを作成
  const sheetResponseIdSet = new Set(params.sheetResponseIds);
  const pendingResponseIds = recentResponses
    .filter(
      (row) =>
        row.id !== params.excludeResponseId &&
        !sheetResponseIdSet.has(row.id) &&
        !sheetResponseIdSet.has(neutralizeSpreadsheetFormulaValue(row.id)),
    )
    .map((row) => row.id)
    .slice(0, params.cap);

  if (pendingResponseIds.length === 0) {
    return [];
  }

  // 3. 未送信ID（最大cap件）のデータをDBから取得して返す
  return await db
    .select()
    .from(formResponse)
    .where(inArray(formResponse.id, pendingResponseIds))
    .orderBy(asc(formResponse.submittedAt), asc(formResponse.id));
}

/**
 * Prepares piggyback candidates without repeating the target's own O(n) DB
 * read + O(n²) similarity pass (`getUniquenessScoresForResponses`). Reuses
 * the target's already-computed form-wide `allScores` map — every candidate
 * is scored from that SAME snapshot rather than a second, independently
 * computed one. A candidate submitted after that snapshot was taken (and
 * thus absent from it) is skipped rather than guessed at; it will be picked
 * up by its own future job like any other unhandled response.
 */
async function preparePiggybackResponses(params: {
  candidates: SheetsSyncTargetResponse[];
  formId: string;
  target: Extract<PreparedSheetsSyncResponse, { status: "ready" }>;
}): Promise<Array<Extract<PreparedSheetsSyncResponse, { status: "ready" }>>> {
  const { candidates, formId, target } = params;
  if (candidates.length === 0) return [];

  const { allScores, fingerprintComponents, shouldBlankUnavailableScores } =
    target.uniquenessScores;

  const fingerprintRows = await db
    .select({
      responseId: fingerprintDetail.responseId,
      componentName: fingerprintDetail.componentName,
      componentValueHash: fingerprintDetail.componentValueHash,
      fingerprintType: fingerprintDetail.fingerprintType,
    })
    .from(fingerprintDetail)
    .where(
      inArray(
        fingerprintDetail.responseId,
        candidates.map((candidate) => candidate.id),
      ),
    );

  const fingerprintsByResponseId = new Map<
    string,
    FingerprintSet["fingerprintDetails"]
  >();
  for (const row of fingerprintRows) {
    const current = fingerprintsByResponseId.get(row.responseId) ?? [];
    current.push({
      componentName: row.componentName,
      componentValueHash: row.componentValueHash,
      fingerprintType: row.fingerprintType,
    });
    fingerprintsByResponseId.set(row.responseId, current);
  }

  const prepared: Array<
    Extract<PreparedSheetsSyncResponse, { status: "ready" }>
  > = [];
  for (const response of candidates) {
    const responseData = safeParseResponseData(
      response.responseDataJson,
      response.id,
    );
    if (!responseData) continue; // invalid_data: leave for its own future job

    const targetScore =
      allScores.size > 0
        ? allScores.get(response.id)
        : target.uniquenessScores.targetScore;
    if (targetScore === undefined) continue; // not covered by the target's snapshot yet

    const fingerprintSet: FingerprintSet = {
      id: response.id,
      sessionId: response.sessionId,
      fingerprintDetails: fingerprintsByResponseId.get(response.id) ?? [],
    };

    prepared.push({
      status: "ready",
      response,
      responseData,
      uniquenessScores: {
        allScores,
        fingerprintComponents,
        shouldBlankUnavailableScores,
        targetScore,
        targetFingerprintUuids: buildFingerprintUuids(formId, fingerprintSet),
      },
    });
  }
  return prepared;
}

/**
 * Writes an incremental response together with any other same-integration
 * responses not yet in the sheet, in one batched write (see issue 688). Reuses
 * the header row + Response ID column already read by
 * `resolveWritableSheetsSyncTarget` for the duplicate check, so piggybacking
 * costs no extra Sheets API round trips beyond a slightly larger append.
 */
async function writeIncrementalSheetsSyncBatch(params: {
  blockTitleMap: Map<string, string>;
  extractedQuestions: ExtractedQuestion[];
  formId: string;
  integrationId: string;
  job: Job<SheetsSyncJob>;
  sheetName: string;
  spreadsheetId: string;
  target: Extract<PreparedSheetsSyncResponse, { status: "ready" }>;
  token: OAuthToken;
  validationOutputExportSettings: ValidationOutputExportSettings;
  validationOutputsByResponseId: Map<
    string,
    ResponseExportValidationOutputValue[]
  >;
}) {
  const {
    blockTitleMap,
    extractedQuestions,
    formId,
    integrationId,
    job,
    sheetName,
    spreadsheetId,
    target,
    token,
    validationOutputExportSettings,
    validationOutputsByResponseId,
  } = params;

  const idempotencyKey = getSheetsSyncIdempotencyKey(
    integrationId,
    target.response.id,
  );
  const resolution = await resolveWritableSheetsSyncTarget({
    idempotencyKey,
    job,
    responseId: target.response.id,
    sheetName,
    spreadsheetId,
    token,
  });
  if (resolution.status === "skip") {
    return resolution.result;
  }
  const { sheetCheck } = resolution;

  await updateSheetsSyncProgress(job, 60, 0, 1);

  const piggybackCandidates = await findIncrementalPiggybackCandidates({
    cap: INCREMENTAL_PIGGYBACK_BATCH_CAP - 1,
    excludeResponseId: target.response.id,
    formId,
    lookbackMs: INCREMENTAL_PIGGYBACK_LOOKBACK_MS,
    sheetResponseIds: sheetCheck.responseIds,
  });
  const piggybackReady = await preparePiggybackResponses({
    candidates: piggybackCandidates,
    formId,
    target,
  });

  let mergedValidationOutputs = validationOutputsByResponseId;
  if (piggybackReady.length > 0) {
    const extraValidationOutputs = await getValidationOutputsByResponseId({
      formId,
      responseIds: piggybackReady.map((prepared) => prepared.response.id),
      settings: validationOutputExportSettings,
    });
    mergedValidationOutputs = new Map([
      ...validationOutputsByResponseId,
      ...extraValidationOutputs,
    ]);
  }

  const batch = [target, ...piggybackReady];

  let headers = sheetCheck.headers;
  let titleHeaders = sheetCheck.titleHeaders;
  const rows: string[][] = [];
  for (const prepared of batch) {
    const built = buildRowFromResponse(
      headers,
      titleHeaders,
      sheetCheck.layout,
      prepared.responseData,
      extractedQuestions,
      blockTitleMap,
      prepared.response,
      prepared.uniquenessScores.targetScore,
      prepared.uniquenessScores.fingerprintComponents,
      prepared.uniquenessScores.targetFingerprintUuids,
      mergedValidationOutputs.get(prepared.response.id) ?? [],
    );
    headers = built.headers;
    titleHeaders = built.titleHeaders;
    rows.push(built.row);
  }

  const titleHeadersChanged =
    sheetCheck.layout !== "legacy" &&
    hasSheetRowChanged(titleHeaders, sheetCheck.titleHeaders);

  if (
    sheetCheck.headers.length === 0 ||
    headers.length > sheetCheck.headers.length ||
    titleHeadersChanged
  ) {
    throwIfShuttingDown();
    const headerUpdateResult = await updateRange(token, {
      spreadsheetId,
      rangeA1:
        sheetCheck.layout === "legacy"
          ? `${sheetName}!1:1`
          : `${sheetName}!1:2`,
      values:
        sheetCheck.layout === "legacy" ? [headers] : [headers, titleHeaders],
    });
    if (!headerUpdateResult.ok) {
      throwSheetsSyncFailure("update headers", headerUpdateResult);
    }
  }

  await updateExistingUniquenessScoreCells(token, {
    spreadsheetId,
    sheetName,
    headers,
    responseIds: sheetCheck.responseIds,
    headerRowCount: sheetCheck.headerRowCount,
    shouldBlankUnavailableScores:
      target.uniquenessScores.shouldBlankUnavailableScores,
    uniquenessScores: target.uniquenessScores.allScores,
  });
  await updateSheetsSyncProgress(job, 80, 0, 1);

  throwIfShuttingDown();
  const appendResult = await appendRows(token, {
    spreadsheetId,
    sheetName,
    rows,
  });
  if (!appendResult.ok) {
    throwSheetsSyncFailure("append rows", appendResult);
  }

  const doneKeys = batch.map((prepared) =>
    getSheetsSyncIdempotencyKey(integrationId, prepared.response.id),
  );
  try {
    await setIdempotencyKeys(doneKeys, DONE_IDEMPOTENCY_TTL_SECONDS, "done");
  } catch (e: unknown) {
    console.warn(
      `[sheets-sync] Could not persist idempotency keys: ${e instanceof Error ? e.message : e}`,
    );
  }

  return {
    ok: true,
    provider: "google-sheets",
    jobId: job.id,
    updatedRange: appendResult.data.updatedRange,
    updatedRows: appendResult.data.updatedRows,
  };
}

function getSheetsSyncIdempotencyKey(
  integrationId: string,
  responseId: string,
): string {
  return `sheets-written:${integrationId}:${responseId}`;
}

async function updateSheetsSyncProgress(
  job: Job<SheetsSyncJob>,
  stage: number,
  processed: number,
  total: number,
): Promise<void> {
  if (total <= 1) {
    await job.updateProgress(stage);
    return;
  }
  await job.updateProgress({ processed, stage, total });
}

/**
 * カラムインデックス（0-based）を Google Sheets のカラム文字（A, B, ..., Z, AA, ...）に変換する。
 * e.g. 0→"A", 1→"B", 25→"Z", 26→"AA"
 */
function columnIndexToLetter(index: number): string {
  let letter = "";
  let i = index;
  do {
    letter = String.fromCharCode(65 + (i % 26)) + letter;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return letter;
}

async function getUniquenessScoresForResponses(
  formId: string,
  targetResponseIds: string[],
): Promise<Map<string, ResponseUniquenessScores>> {
  const responseRows = await db
    .select({ id: formResponse.id, sessionId: formResponse.sessionId })
    .from(formResponse)
    .where(eq(formResponse.formId, formId))
    .orderBy(asc(formResponse.submittedAt), asc(formResponse.id))
    .limit(RESPONSE_UNIQUENESS_CALCULATION_LIMIT + 1);

  if (responseRows.length === 0) {
    return new Map(
      targetResponseIds.map((responseId) => [
        responseId,
        {
          allScores: new Map(),
          fingerprintComponents: new Set(),
          shouldBlankUnavailableScores: false,
          targetScore: 1,
          targetFingerprintUuids: {},
        },
      ]),
    );
  }

  if (responseRows.length > RESPONSE_UNIQUENESS_CALCULATION_LIMIT) {
    return new Map(
      targetResponseIds.map((responseId) => [
        responseId,
        {
          allScores: new Map(),
          fingerprintComponents: new Set(),
          shouldBlankUnavailableScores: false,
          targetScore: null,
          targetFingerprintUuids: {},
        },
      ]),
    );
  }

  const responseIds = responseRows.map((row) => row.id);
  const fingerprintRows = await db
    .select({
      responseId: fingerprintDetail.responseId,
      componentName: fingerprintDetail.componentName,
      componentValueHash: fingerprintDetail.componentValueHash,
      fingerprintType: fingerprintDetail.fingerprintType,
    })
    .from(fingerprintDetail)
    .where(inArray(fingerprintDetail.responseId, responseIds));

  const fingerprintsByResponseId = new Map<
    string,
    FingerprintSet["fingerprintDetails"]
  >();
  const fingerprintComponents = new Set<string>();
  for (const {
    responseId: fingerprintResponseId,
    componentName,
    componentValueHash,
    fingerprintType,
  } of fingerprintRows) {
    const current = fingerprintsByResponseId.get(fingerprintResponseId) ?? [];
    current.push({ componentName, componentValueHash, fingerprintType });
    fingerprintsByResponseId.set(fingerprintResponseId, current);
    fingerprintComponents.add(componentName);
  }

  const fingerprintSets = responseRows.map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    fingerprintDetails: fingerprintsByResponseId.get(row.id) ?? [],
  }));

  const allScores = calculateUniquenessScoreMap(fingerprintSets);
  return new Map(
    targetResponseIds.map((responseId) => {
      const target = fingerprintSets.find((set) => set.id === responseId) ?? {
        id: responseId,
        fingerprintDetails: [],
      };
      return [
        responseId,
        {
          allScores,
          fingerprintComponents,
          shouldBlankUnavailableScores: false,
          targetScore: allScores.get(target.id) ?? 1,
          targetFingerprintUuids: buildFingerprintUuids(formId, target),
        },
      ];
    }),
  );
}

const UUID_V5_DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function buildFingerprintUuids(
  formId: string,
  target: FingerprintSet,
): Record<string, string | null> {
  const namespace = uuidV5(formId, UUID_V5_DNS_NAMESPACE);
  return Object.fromEntries(
    target.fingerprintDetails.map((fingerprint) => [
      fingerprint.componentName,
      uuidV5(fingerprint.componentValueHash, namespace),
    ]),
  );
}

function buildUaUuid(
  formId: string,
  userAgent: string | null | undefined,
): string | null {
  if (!userAgent) return null;
  const namespace = uuidV5(formId, UUID_V5_DNS_NAMESPACE);
  const userAgentHash = createHash("sha256").update(userAgent).digest("hex");
  return uuidV5(userAgentHash, namespace);
}

function uuidV5(name: string, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(namespaceBytes)
    .update(Buffer.from(name, "utf8"))
    .digest();
  const versionByte = hash[6];
  const variantByte = hash[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("SHA-1 digest was unexpectedly short");
  }
  hash[6] = (versionByte & 0x0f) | 0x50;
  hash[8] = (variantByte & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function isResponseIdWrittenToSheet(
  responseId: string,
  sheetResponseIds: string[],
): boolean {
  return (
    sheetResponseIds.includes(responseId) ||
    sheetResponseIds.includes(neutralizeSpreadsheetFormulaValue(responseId))
  );
}

async function readSheetForIdempotency(
  token: OAuthToken,
  params: {
    spreadsheetId: string;
    sheetName: string;
    responseId: string;
  },
): Promise<SheetReadResult> {
  throwIfShuttingDown();
  const headerData = await readRange(token, {
    spreadsheetId: params.spreadsheetId,
    rangeA1: `${params.sheetName}!1:2`,
  });
  if (!headerData.ok) {
    throwSheetsSyncFailure("read sheet for idempotency check", headerData);
  }
  if (headerData.data.values.length === 0) {
    return {
      ok: true,
      exists: false,
      headers: [],
      titleHeaders: [],
      layout: "empty",
      responseIds: [],
      headerRowCount: 0,
    };
  }

  const headers = headerData.data.values[0] ?? [];
  const secondRow = headerData.data.values[1] ?? [];
  const responseIdIndex = headers.indexOf(RESPONSE_ID_HEADER);
  if (responseIdIndex === -1) {
    return {
      ok: true,
      exists: false,
      headers,
      titleHeaders: [],
      layout: "legacy",
      responseIds: [],
      headerRowCount: 1,
    };
  }
  const isSharedLayout = isSharedSheetLayout(
    headers,
    secondRow,
    responseIdIndex,
  );
  const layout: SheetLayout = isSharedLayout ? "shared" : "legacy";
  const headerRowCount = isSharedLayout ? 2 : 1;
  const titleHeaders = isSharedLayout ? secondRow : [];

  const columnLetter = columnIndexToLetter(responseIdIndex);
  throwIfShuttingDown();
  const entireColumn = await readRange(token, {
    spreadsheetId: params.spreadsheetId,
    rangeA1: `${params.sheetName}!${columnLetter}:${columnLetter}`,
  });
  if (!entireColumn.ok) {
    throwSheetsSyncFailure(
      "read sheet column for idempotency check",
      entireColumn,
    );
  }

  const responseIds = entireColumn.data.values
    .slice(headerRowCount)
    .map((row) => (typeof row[0] === "string" ? row[0] : ""));
  const exists = isResponseIdWrittenToSheet(params.responseId, responseIds);
  return {
    ok: true,
    exists,
    headers,
    titleHeaders,
    layout,
    responseIds,
    headerRowCount,
  };
}

function isSharedSheetLayout(
  headers: string[],
  titleHeaders: string[],
  responseIdIndex: number,
): boolean {
  if (responseIdIndex !== 0) {
    return false;
  }
  const baseIdHeaders = SHARED_BASE_ID_HEADERS.slice(0, 6);
  const matchesBaseIdHeaders = baseIdHeaders.every(
    (header, index) => headers[index] === header,
  );
  return matchesBaseIdHeaders && isSharedTitleHeaderRow(titleHeaders);
}

function isSharedTitleHeaderRow(titleHeaders: string[]): boolean {
  let hasTitleHeader = false;
  const baseTitleHeaders = SHARED_BASE_TITLE_HEADERS.slice(0, 6);
  const hasOnlySharedTitleHeaders = baseTitleHeaders.every((header, index) => {
    const existing = titleHeaders[index];
    if (existing === undefined || existing === "") return true;
    if (existing !== header) return false;
    hasTitleHeader = true;
    return true;
  });
  return hasTitleHeader && hasOnlySharedTitleHeaders;
}

function hasSheetRowChanged(nextRow: string[], existingRow: string[]): boolean {
  return (
    nextRow.length !== existingRow.length ||
    nextRow.some((value, index) => value !== (existingRow[index] ?? ""))
  );
}

async function updateExistingUniquenessScoreCells(
  token: OAuthToken,
  params: {
    spreadsheetId: string;
    sheetName: string;
    headers: string[];
    responseIds: string[];
    headerRowCount: number;
    shouldBlankUnavailableScores: boolean;
    uniquenessScores: Map<string, number>;
  },
): Promise<void> {
  if (
    params.responseIds.length === 0 ||
    (params.uniquenessScores.size === 0 && !params.shouldBlankUnavailableScores)
  ) {
    return;
  }

  const uniquenessScoreIndex = findUniquenessScoreHeaderIndex(params.headers);
  if (uniquenessScoreIndex === -1) {
    return;
  }

  const uniquenessRatingIndex = findUniquenessRatingHeaderIndex(params.headers);
  const isAdjacentRating =
    uniquenessRatingIndex !== -1 &&
    uniquenessRatingIndex === uniquenessScoreIndex + 1;
  const hasNonAdjacentRating =
    uniquenessRatingIndex !== -1 && !isAdjacentRating;

  throwIfShuttingDown();
  const scoreColumnLetter = columnIndexToLetter(uniquenessScoreIndex);
  const ratingColumnLetter =
    uniquenessRatingIndex !== -1
      ? columnIndexToLetter(uniquenessRatingIndex)
      : "";

  const batchData: Array<{ rangeA1: string; values: string[][] }> = [];
  let rangeStartRow: number | null = null;
  let rangeScoreValues: string[][] = [];
  let rangeRatingValues: string[][] = [];
  let rangeCombinedValues: string[][] = [];

  const collectRange = (endRow: number) => {
    if (rangeStartRow === null) return;
    if (isAdjacentRating) {
      if (rangeCombinedValues.length > 0) {
        batchData.push({
          rangeA1: `${params.sheetName}!${scoreColumnLetter}${rangeStartRow}:${ratingColumnLetter}${endRow}`,
          values: rangeCombinedValues,
        });
      }
    } else {
      if (rangeScoreValues.length > 0) {
        batchData.push({
          rangeA1: `${params.sheetName}!${scoreColumnLetter}${rangeStartRow}:${scoreColumnLetter}${endRow}`,
          values: rangeScoreValues,
        });
      }
      if (hasNonAdjacentRating && rangeRatingValues.length > 0) {
        batchData.push({
          rangeA1: `${params.sheetName}!${ratingColumnLetter}${rangeStartRow}:${ratingColumnLetter}${endRow}`,
          values: rangeRatingValues,
        });
      }
    }
    rangeStartRow = null;
    rangeScoreValues = [];
    rangeRatingValues = [];
    rangeCombinedValues = [];
  };

  for (const [index, responseId] of params.responseIds.entries()) {
    const rowNumber = index + params.headerRowCount + 1;
    const score = getUniquenessScoreForSheetResponseId(
      params.uniquenessScores,
      responseId,
    );
    if (score === undefined && !params.shouldBlankUnavailableScores) {
      collectRange(rowNumber - 1);
      continue;
    }

    rangeStartRow ??= rowNumber;
    if (score === undefined) {
      if (isAdjacentRating) {
        rangeCombinedValues.push(["", ""]);
      } else {
        rangeScoreValues.push([""]);
        if (hasNonAdjacentRating) {
          rangeRatingValues.push([""]);
        }
      }
    } else {
      const formattedScore = score.toFixed(4);
      const ratingLabel = getUniquenessScoreRating(score);
      if (isAdjacentRating) {
        rangeCombinedValues.push([formattedScore, ratingLabel]);
      } else {
        rangeScoreValues.push([formattedScore]);
        if (hasNonAdjacentRating) {
          rangeRatingValues.push([ratingLabel]);
        }
      }
    }
  }
  collectRange(params.responseIds.length + params.headerRowCount);

  if (batchData.length > 0) {
    throwIfShuttingDown();
    const result = await batchUpdate(token, {
      spreadsheetId: params.spreadsheetId,
      data: batchData,
    });
    if (!result.ok) {
      throwSheetsSyncFailure("update uniqueness scores in batch", result);
    }
  }
}

async function waitForPendingIdempotencyToResolve(
  idempotencyKey: string,
): Promise<"done" | "expired"> {
  while (true) {
    const ttlMs = await getIdempotencyKeyTtlMs(idempotencyKey);
    if (ttlMs === -1) {
      throw new Error(
        `[sheets-sync] Pending idempotency key ${idempotencyKey} has no TTL`,
      );
    }
    if (ttlMs <= 0) {
      return "expired";
    }

    await sleepForPendingIdempotency(
      Math.min(ttlMs, PENDING_IDEMPOTENCY_POLL_INTERVAL_MS),
    );

    const currentValue = await getIdempotencyKeyValue(idempotencyKey);
    if (currentValue === "done") {
      return "done";
    }
    if (currentValue !== "pending") {
      return "expired";
    }

    const refreshedTtlMs = await getIdempotencyKeyTtlMs(idempotencyKey);
    if (refreshedTtlMs === -1) {
      throw new Error(
        `[sheets-sync] Pending idempotency key ${idempotencyKey} has no TTL`,
      );
    }
    if (refreshedTtlMs <= 0) {
      await sleepForPendingIdempotency(PENDING_IDEMPOTENCY_EXPIRED_SETTLE_MS);
      return "expired";
    }
  }
}

/**
 * レスポンスデータからシート行を構築する
 */
function buildRowFromResponse(
  existingHeaders: string[],
  existingTitleHeaders: string[],
  layout: SheetLayout,
  responseData: Record<string, unknown>,
  questions: ExtractedQuestion[],
  blockTitleMap: Map<string, string>,
  response: {
    id: string;
    formId: string;
    responseDataJson: string;
    respondentUuid?: string;
    submittedAt?: Date;
    updatedAt?: Date | null;
    countryCode?: string | null;
    userAgent?: string | null;
  },
  uniquenessScore: number | null,
  fingerprintComponents: Set<string>,
  fingerprintUuids: Record<string, string | null>,
  validationOutputValues: ResponseExportValidationOutputValue[],
): { headers: string[]; titleHeaders: string[]; row: string[] } {
  if (layout !== "legacy") {
    const record = buildResponseExportRecord(
      response,
      responseData,
      questions,
      blockTitleMap,
      uniquenessScore,
      fingerprintUuids,
      validationOutputValues,
    );
    const mapped = mapRecordToSheetRow(
      record,
      existingHeaders,
      blockTitleMap,
      fingerprintComponents,
      existingTitleHeaders,
    );
    return {
      headers: mapped.idRow,
      titleHeaders: mapped.titleRow,
      row: mapped.row,
    };
  }

  const headers =
    existingHeaders.length > 0 ? [...existingHeaders] : [RESPONSE_ID_HEADER];

  // ヘッダーにResponse IDが含まれていない場合は追加
  if (!headers.includes(RESPONSE_ID_HEADER)) {
    headers.unshift(RESPONSE_ID_HEADER);
  }

  const row: string[] = Array(headers.length).fill("");

  // Response IDを設定
  const responseIdIdx = headers.indexOf(RESPONSE_ID_HEADER);
  if (responseIdIdx >= 0) {
    row[responseIdIdx] = response.id;
  }

  let uniquenessScoreIdx = findUniquenessScoreHeaderIndex(headers);
  if (uniquenessScoreIdx === -1) {
    headers.push(UNIQUENESS_SCORE_HEADER);
    row.push("");
    uniquenessScoreIdx = headers.length - 1;
  }
  row[uniquenessScoreIdx] =
    uniquenessScore === null ? "" : uniquenessScore.toFixed(4);

  // 各ブロックのデータを行に配置
  for (const [blockId, value] of Object.entries(responseData)) {
    const title = blockTitleMap.get(blockId) ?? blockId;
    let colIdx = headers.indexOf(title);

    if (colIdx === -1) {
      // 新しいカラムを追加
      headers.push(title);
      row.push("");
      colIdx = headers.length - 1;
    }

    row[colIdx] = stringifyValue(value);
  }

  for (const column of buildResponseExportValidationOutputColumns(
    undefined,
    validationOutputValues,
  )) {
    let colIdx = headers.indexOf(column.title);
    if (colIdx === -1) {
      headers.push(column.title);
      row.push("");
      colIdx = headers.length - 1;
    }
    const value = validationOutputValues.find(
      (candidate) =>
        candidate.rule_id === column.ruleId &&
        candidate.output_key === column.outputKey,
    );
    row[colIdx] = value ? stringifyValue(value.value) : "";
  }

  // 行の長さをヘッダーに合わせる
  while (row.length < headers.length) {
    row.push("");
  }

  return { headers, titleHeaders: [], row };
}

function findUniquenessScoreHeaderIndex(headers: string[]): number {
  const idHeaderIndex = headers.indexOf(UNIQUENESS_SCORE_ID_HEADER);
  return idHeaderIndex === -1
    ? headers.indexOf(UNIQUENESS_SCORE_HEADER)
    : idHeaderIndex;
}

function findUniquenessRatingHeaderIndex(headers: string[]): number {
  const idHeaderIndex = headers.indexOf(UNIQUENESS_RATING_ID_HEADER);
  return idHeaderIndex === -1
    ? headers.indexOf(UNIQUENESS_RATING_HEADER)
    : idHeaderIndex;
}

function getUniquenessScoreForSheetResponseId(
  uniquenessScores: Map<string, number>,
  sheetResponseId: string,
): number | undefined {
  const directScore = uniquenessScores.get(sheetResponseId);
  if (directScore !== undefined) return directScore;
  const rawResponseId = denormalizeSpreadsheetFormulaValue(sheetResponseId);
  return rawResponseId === sheetResponseId
    ? undefined
    : uniquenessScores.get(rawResponseId);
}

function buildResponseExportRecord(
  response: {
    id: string;
    formId: string;
    responseDataJson: string;
    respondentUuid?: string;
    submittedAt?: Date;
    updatedAt?: Date | null;
    countryCode?: string | null;
    userAgent?: string | null;
  },
  responseData: Record<string, unknown>,
  questions: ExtractedQuestion[],
  blockTitleMap: Map<string, string>,
  uniquenessScore: number | null,
  fingerprintUuids: Record<string, string | null>,
  validationOutputValues: ResponseExportValidationOutputValue[],
): ResponseExportRecord {
  const responseItemsByQuestionId = parseResponseDataItems(
    response.responseDataJson,
  );
  const answerableQuestions = getAnswerableQuestions(questions);
  const responseLabelLookup = buildResponseLabelLookupFromQuestions(
    answerableQuestions.map((question) => ({
      id: question.blockId,
      type: question.type,
      validation: question.validation,
    })),
  );
  const componentColumns =
    answerableQuestions.length > 0
      ? answerableQuestions.map((question) => {
          const responseItem = responseItemsByQuestionId.get(question.blockId);
          const displayValue = resolveResponseDisplayValue(
            responseItem,
            responseLabelLookup.get(question.blockId),
          );
          return {
            block_id: question.blockId,
            block_type: question.type,
            question_title:
              responseItem?.question_title || question.title || undefined,
            value: responseItem
              ? resolveResponseExportValue(responseItem)
              : (responseData[question.blockId] ?? null),
            ...(displayValue !== undefined
              ? { display_value: displayValue }
              : {}),
          };
        })
      : Object.entries(responseData).map(([blockId, value]) => ({
          block_id: blockId,
          block_type: inferLegacyBlockType(value),
          question_title: blockTitleMap.get(blockId) ?? blockId,
          value,
        }));

  return {
    metadata: {
      id: response.id,
      form_id: response.formId,
      respondent_uuid: response.respondentUuid ?? "",
      submitted_at: response.submittedAt?.toISOString() ?? "",
      updated_at: response.updatedAt?.toISOString(),
      country_code: response.countryCode ?? undefined,
      fingerprint_uuids: fingerprintUuids,
      ua_uuid: buildUaUuid(response.formId, response.userAgent),
      uniqueness_score: uniquenessScore ?? undefined,
    },
    component_columns: componentColumns,
    validation_output_columns: validationOutputValues,
  };
}

function getAnswerableQuestions(
  questions: ExtractedQuestion[],
): Array<ExtractedQuestion & { type: ValidatorQuestion["type"] }> {
  return questions.flatMap((question) =>
    isAnswerableBlockType(question.type)
      ? [{ ...question, type: question.type }]
      : [],
  );
}

function parseResponseDataItems(
  responseDataJson: string,
): Map<string, ResponseDataItem> {
  try {
    const parsed: unknown = JSON.parse(responseDataJson);
    const result = z.array(responsePayloadItemSchema).safeParse(parsed);
    if (!result.success) return new Map();
    return new Map(result.data.map((item) => [item.question_id, item]));
  } catch {
    return new Map();
  }
}

function resolveResponseExportValue(item: ResponseDataItem): unknown {
  switch (item.question_type) {
    case "choice_grid":
    case "checkbox_grid":
      return item.responses;
    case "checkbox":
      return item.values;
    case "short_text":
    case "long_text":
    case "radio":
    case "dropdown":
    case "linear_scale":
    case "rating":
    case "date":
    case "time":
      return item.value;
    default:
      return null;
  }
}

function inferLegacyBlockType(value: unknown): string {
  if (Array.isArray(value)) return "checkbox";
  if (value !== null && typeof value === "object") return "choice_grid";
  return "short_text";
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
