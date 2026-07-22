import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db } from "@nexus-form/database";
import {
  externalServiceValidationResult,
  fingerprintDetail,
  form,
  formResponse,
  formStructure,
  formValidationRule,
  formValidationRuleBlock,
} from "@nexus-form/database/schema";
import { providerRegistry } from "@nexus-form/integrations";
import {
  buildValidationRetryJobId,
  buildValidationRevalidationJobId,
  extractQuestionsFromPlateContent,
  genericValidationJobDataSchema,
  getValidationResultId,
  groupResponseExportValidationOutputsByResponseId,
  MAX_RESPONSE_BODY_BYTES,
  MAX_RESPONSE_ID_LENGTH,
  MAX_RESPONSE_ITEMS,
  parseValidationOutputExportSettings,
  type ResponseExportValidationOutputValue,
  responsePayloadItemSchema,
  type ValidationOutputExportSettings,
  type ValidationStatusValue,
} from "@nexus-form/shared";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { paginationQuerySchema } from "../lib/constants/pagination";
import { withDualFormAuth } from "../lib/dual-auth";
import { parseStoredStructure } from "../lib/forms/parse-stored-structure";
import { buildQuestionsFromPlateContent } from "../lib/forms/plate-question-builder";
import {
  addDisplayLabelsToResponseDataJson,
  buildResponseLabelLookupFromQuestions,
} from "../lib/forms/response-choice-labels";
import {
  buildResponseExportColumnsFromBlocks,
  buildResponseExportRecords,
  buildValidationOutputColumnsForResponseExport,
  formatRecordsToCsv,
} from "../lib/forms/response-export";
import { validateResponseData } from "../lib/forms/response-validator";
import {
  getLatestSnapshotByVersion,
  getSnapshotByVersion,
} from "../lib/forms/snapshot-repository";
import { calculateUniqueness } from "../lib/forms/uniqueness-calculator";
import { getExternalValidationResults } from "../lib/forms/validation-results";
import { parseValidationRuleSnapshot } from "../lib/forms/validation-rule-repository";
import { createHonoApp } from "../lib/hono";
import { logError, logWarn } from "../lib/logger";
import { getValidationQueue, isValidServiceName } from "../lib/queues";
import { createRateLimit } from "../lib/rate-limit";
import { createRequestBodySizeLimit } from "../lib/request-body-size-limit";
import { stringifyResponseDataJson } from "../lib/response-data-json";
import { errorResponse } from "../types/domain/common";
import {
  BulkDeleteResponseSchema,
  InvalidResponseDataErrorResponseSchema,
  ResponseDetailResponseSchema,
  ResponseIdsResponseSchema,
  ResponseMutationResponseSchema,
  ResponsesListResponseSchema,
  ValidationRetryEnqueueErrorResponseSchema,
  ValidationRetryResponseSchema,
  ValidationRevalidationResponseSchema,
} from "../types/domain/form-responses";
import { OkResponseSchema } from "../types/domain/form-row";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isDuplicateKeyError(error: unknown, depth: number = 0): boolean {
  if (typeof error !== "object" || error === null || depth > 2) return false;
  const code = Reflect.get(error, "code");
  const errno = Reflect.get(error, "errno");
  if (code === "ER_DUP_ENTRY" || errno === 1062) return true;
  return isDuplicateKeyError(Reflect.get(error, "cause"), depth + 1);
}

const MAX_USER_AGENT_LENGTH = 512;
const MAX_SESSION_ID_LENGTH = 128;
const VALIDATION_RETRY_CLAIM_LEASE_MS = 5 * 60 * 1000;
const responseBodySizeLimit = createRequestBodySizeLimit({
  maxBytes: MAX_RESPONSE_BODY_BYTES,
});
const LIKE_ESCAPE_CHAR = "!";
const RESPONSE_SEARCH_MIN_BATCH_SIZE = 200;
const RESPONSE_SEARCH_CANDIDATE_SCAN_LIMIT = 5000;
const RESPONSE_EXPORT_ROW_LIMIT = 5000;
const VALIDATION_REVALIDATION_ENQUEUE_CONCURRENCY = 5;
const RESPONSE_UNIQUENESS_CALCULATION_LIMIT = RESPONSE_EXPORT_ROW_LIMIT;

const listResponsesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  /**
   * 回答一覧検索の正式 query。
   * メタデータに加え、短文/長文の回答本文と、radio/checkbox/dropdown の
   * 表示ラベルおよび保存内部値を検索対象にする。
   */
  q: z.string().max(200).optional(),
  /** @deprecated q を使用する。既存クライアント互換のため当面受け付ける。 */
  keyword: z.string().max(200).optional(),
  sort: z.enum(["submittedAt", "updatedAt"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

const limitedListQuerySchema = paginationQuerySchema;
const createResponseSchema = z.object({
  responses: z.array(responsePayloadItemSchema).max(MAX_RESPONSE_ITEMS),
  respondentUuid: z.string().max(MAX_RESPONSE_ID_LENGTH).optional(),
  userAgent: z.string().max(MAX_USER_AGENT_LENGTH).optional(),
  sessionId: z.string().max(MAX_SESSION_ID_LENGTH).optional(),
  countryCode: z.string().max(10).optional(),
});

const updateResponseSchema = z.object({
  responses: z.array(responsePayloadItemSchema).max(MAX_RESPONSE_ITEMS),
});

const bulkRetrySchema = z.object({
  validationResultIds: z
    .array(z.string().min(1))
    .min(1)
    .max(100, "Cannot retry more than 100 validation results at once"),
});

const bulkRevalidationSchema = z.object({
  responseIds: z
    .array(z.string().min(1))
    .min(1, "At least one response ID is required")
    .max(100, "Cannot revalidate more than 100 responses at once"),
});

const cancellableValidationStatusValues = [
  "PENDING",
  "PROCESSING",
  "FAILED",
] as const satisfies ReadonlyArray<ValidationStatusValue>;

const cancellableValidationStatuses = new Set<ValidationStatusValue>(
  cancellableValidationStatusValues,
);

function cancellableValidationStatusCondition() {
  return or(
    ...cancellableValidationStatusValues.map((status) =>
      eq(externalServiceValidationResult.status, status),
    ),
  );
}

function escapeLikePattern(value: string): string {
  return value.replace(/[!%_]/g, (char) => `${LIKE_ESCAPE_CHAR}${char}`);
}

function buildPrefixSearchPattern(keyword: string): string {
  return `${escapeLikePattern(keyword)}%`;
}

function buildContainsSearchPattern(keyword: string): string {
  return `%${escapeLikePattern(keyword)}%`;
}

function buildQuotedJsonContainsPattern(value: string): string {
  return buildContainsSearchPattern(JSON.stringify(value));
}

const responseSearchItemSchema = z
  .object({
    question_id: z.string(),
    question_type: z.string(),
    value: z.unknown().optional(),
    values: z.array(z.unknown()).optional(),
    other_value: z.string().optional(),
    other_values: z.array(z.string()).optional(),
  })
  .passthrough();
const responseSearchItemsSchema = z.array(responseSearchItemSchema);

type ResponseSearchItem = z.infer<typeof responseSearchItemSchema>;

type ResponseChoiceLabelsByQuestion = Map<string, Map<string, string>>;

type ResponseSearchRow = {
  id: string;
  formId: string;
  submittedAt: Date;
  updatedAt: Date | null;
  respondentUuid: string;
  userAgent: string | null;
  sessionId: string | null;
  countryCode: string | null;
  responseDataJson: string;
};

type ResponseListRow = Omit<ResponseSearchRow, "responseDataJson">;

async function getUniquenessScoresForForm(
  formId: string,
  targetResponseIds: string[],
): Promise<Map<string, number> | null> {
  if (targetResponseIds.length === 0) return new Map();

  const responseRows = await db
    .select({ id: formResponse.id })
    .from(formResponse)
    .where(eq(formResponse.formId, formId))
    .limit(RESPONSE_UNIQUENESS_CALCULATION_LIMIT + 1);

  if (responseRows.length === 0) return new Map();
  if (responseRows.length > RESPONSE_UNIQUENESS_CALCULATION_LIMIT) {
    logWarn(
      "Skipping uniqueness score calculation because response count exceeds the bounded calculation limit",
      "forms-responses",
      {
        formId,
        limit: RESPONSE_UNIQUENESS_CALCULATION_LIMIT,
      },
    );
    return null;
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
    Array<{
      componentName: string;
      componentValueHash: string;
      fingerprintType: string;
    }>
  >();
  for (const {
    responseId,
    componentName,
    componentValueHash,
    fingerprintType,
  } of fingerprintRows) {
    const current = fingerprintsByResponseId.get(responseId) ?? [];
    current.push({ componentName, componentValueHash, fingerprintType });
    fingerprintsByResponseId.set(responseId, current);
  }

  const fingerprintSets = responseRows.map((row) => ({
    id: row.id,
    fingerprintDetails: fingerprintsByResponseId.get(row.id) ?? [],
  }));
  const fingerprintSetsById = new Map(
    fingerprintSets.map((fingerprintSet) => [
      fingerprintSet.id,
      fingerprintSet,
    ]),
  );

  return new Map(
    [...new Set(targetResponseIds)].map((responseId) => [
      responseId,
      calculateUniqueness(
        fingerprintSetsById.get(responseId) ?? {
          id: responseId,
          fingerprintDetails: [],
        },
        fingerprintSets,
      ),
    ]),
  );
}

function addUniquenessScore<T extends { id: string }>(
  row: T,
  scores: Map<string, number> | null,
): T & { uniquenessScore: number | null } {
  return {
    ...row,
    uniquenessScore: scores === null ? null : (scores.get(row.id) ?? 1),
  };
}

function buildResponseChoiceLabelsByQuestion(
  plateContent: string | null,
): ResponseChoiceLabelsByQuestion {
  if (!plateContent) return new Map();

  const labelsByQuestion: ResponseChoiceLabelsByQuestion = new Map();
  for (const question of buildQuestionsFromPlateContent(plateContent)) {
    const options = question.validation?.options;
    if (!options || options.length === 0) continue;

    labelsByQuestion.set(
      question.id,
      new Map(options.map((option) => [option.id, option.label])),
    );
  }
  return labelsByQuestion;
}

function normalizeSearchText(value: string): string {
  return value.toLocaleLowerCase();
}

function responseBodySearchTerms(searchTerm: string): string[] {
  return [
    ...new Set([
      searchTerm,
      normalizeSearchText(searchTerm),
      searchTerm.toLocaleUpperCase(),
    ]),
  ];
}

function searchableScalar(value: unknown): string | null {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return null;
}

function matchesSearchTerm(value: string | null, normalizedTerm: string) {
  return value !== null && normalizeSearchText(value).includes(normalizedTerm);
}

function choiceSearchValues(
  item: ResponseSearchItem,
  choiceLabels: ResponseChoiceLabelsByQuestion,
): string[] {
  const labels = choiceLabels.get(item.question_id);
  const values =
    item.question_type === "checkbox" && item.values
      ? item.values
      : item.value !== undefined
        ? [item.value]
        : [];

  return values.flatMap((value) => {
    const raw = searchableScalar(value);
    if (raw === null) return [];
    const label = labels?.get(raw);
    return label ? [label, raw] : [raw];
  });
}

function responseItemMatchesSearch(
  item: ResponseSearchItem,
  choiceLabels: ResponseChoiceLabelsByQuestion,
  normalizedTerm: string,
): boolean {
  if (
    (item.question_type === "short_text" ||
      item.question_type === "long_text") &&
    matchesSearchTerm(searchableScalar(item.value), normalizedTerm)
  ) {
    return true;
  }

  if (
    ["radio", "checkbox", "dropdown"].includes(item.question_type) &&
    choiceSearchValues(item, choiceLabels).some((value) =>
      matchesSearchTerm(value, normalizedTerm),
    )
  ) {
    return true;
  }

  if (matchesSearchTerm(item.other_value ?? null, normalizedTerm)) {
    return true;
  }

  return (
    item.other_values?.some((value) =>
      matchesSearchTerm(value, normalizedTerm),
    ) ?? false
  );
}

function parseResponseSearchItems(responseDataJson: string) {
  try {
    const parsed: unknown = JSON.parse(responseDataJson);
    const result = responseSearchItemsSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

function metadataMatchesPrefixSearch(
  row: Pick<ResponseSearchRow, "id" | "respondentUuid" | "countryCode">,
  normalizedTerm: string,
): boolean {
  return [row.id, row.respondentUuid, row.countryCode ?? ""].some((value) =>
    normalizeSearchText(value).startsWith(normalizedTerm),
  );
}

function responseRowMatchesSearch(
  row: ResponseSearchRow,
  searchTerm: string,
  choiceLabels: ResponseChoiceLabelsByQuestion,
): boolean {
  const normalizedTerm = normalizeSearchText(searchTerm);
  if (metadataMatchesPrefixSearch(row, normalizedTerm)) return true;

  return parseResponseSearchItems(row.responseDataJson).some((item) =>
    responseItemMatchesSearch(item, choiceLabels, normalizedTerm),
  );
}

function toResponseListRow(row: ResponseSearchRow): ResponseListRow {
  const { responseDataJson: _responseDataJson, ...listRow } = row;
  return listRow;
}

function matchingChoiceOptionIds(
  choiceLabels: ResponseChoiceLabelsByQuestion,
  searchTerm: string,
): string[] {
  const normalizedTerm = normalizeSearchText(searchTerm);
  const matchingIds = new Set<string>();
  for (const options of choiceLabels.values()) {
    for (const [id, label] of options) {
      if (normalizeSearchText(label).includes(normalizedTerm)) {
        matchingIds.add(id);
      }
    }
  }
  return [...matchingIds];
}

function buildResponseListOrderBy(
  sortField: "submittedAt" | "updatedAt",
  sortOrder: "asc" | "desc",
) {
  return sortOrder === "asc"
    ? sortField === "updatedAt"
      ? sql`${formResponse.updatedAt} asc, ${formResponse.id} asc`
      : sql`${formResponse.submittedAt} asc, ${formResponse.id} asc`
    : sortField === "updatedAt"
      ? sql`${formResponse.updatedAt} desc, ${formResponse.id} desc`
      : sql`${formResponse.submittedAt} desc, ${formResponse.id} desc`;
}

function buildResponseSearchCondition(
  formId: string,
  searchTerm: string,
  choiceLabels: ResponseChoiceLabelsByQuestion,
) {
  const keywordPattern = buildPrefixSearchPattern(searchTerm);
  const countryCodePattern = buildPrefixSearchPattern(searchTerm.toUpperCase());
  const responseDataPatterns = [
    ...responseBodySearchTerms(searchTerm).map(buildContainsSearchPattern),
    ...matchingChoiceOptionIds(choiceLabels, searchTerm).map(
      buildQuotedJsonContainsPattern,
    ),
  ];

  return and(
    eq(formResponse.formId, formId),
    or(
      sql`${formResponse.id} like ${keywordPattern} escape ${LIKE_ESCAPE_CHAR}`,
      sql`${formResponse.respondentUuid} like ${keywordPattern} escape ${LIKE_ESCAPE_CHAR}`,
      sql`${formResponse.countryCode} like ${countryCodePattern} escape ${LIKE_ESCAPE_CHAR}`,
      ...responseDataPatterns.map(
        (pattern) =>
          sql`${formResponse.responseDataJson} like ${pattern} escape ${LIKE_ESCAPE_CHAR}`,
      ),
    ),
  );
}

async function listResponsesWithSearch(options: {
  formId: string;
  searchTerm: string;
  page: number;
  limit: number;
  sortField: "submittedAt" | "updatedAt";
  sortOrder: "asc" | "desc";
}): Promise<{ responses: ResponseListRow[]; hasNext: boolean }> {
  const [{ plateContent } = { plateContent: null }] = await db
    .select({ plateContent: form.plateContent })
    .from(form)
    .where(eq(form.id, options.formId))
    .limit(1);
  const choiceLabels = buildResponseChoiceLabelsByQuestion(plateContent);
  const targetMatchCount =
    (options.page - 1) * options.limit + options.limit + 1;
  const batchSize = Math.max(options.limit + 1, RESPONSE_SEARCH_MIN_BATCH_SIZE);
  const matches: ResponseListRow[] = [];
  let candidateOffset = 0;

  while (
    matches.length < targetMatchCount &&
    candidateOffset < RESPONSE_SEARCH_CANDIDATE_SCAN_LIMIT
  ) {
    const batchLimit = Math.min(
      batchSize,
      RESPONSE_SEARCH_CANDIDATE_SCAN_LIMIT - candidateOffset,
    );
    const rows = await db
      .select({
        id: formResponse.id,
        formId: formResponse.formId,
        submittedAt: formResponse.submittedAt,
        updatedAt: formResponse.updatedAt,
        respondentUuid: formResponse.respondentUuid,
        userAgent: formResponse.userAgent,
        sessionId: formResponse.sessionId,
        countryCode: formResponse.countryCode,
        responseDataJson: formResponse.responseDataJson,
      })
      .from(formResponse)
      .where(
        buildResponseSearchCondition(
          options.formId,
          options.searchTerm,
          choiceLabels,
        ),
      )
      .orderBy(buildResponseListOrderBy(options.sortField, options.sortOrder))
      .offset(candidateOffset)
      .limit(batchLimit);

    if (rows.length === 0) break;

    for (const row of rows) {
      if (responseRowMatchesSearch(row, options.searchTerm, choiceLabels)) {
        matches.push(toResponseListRow(row));
        if (matches.length >= targetMatchCount) break;
      }
    }

    candidateOffset += rows.length;
    if (rows.length < batchLimit) break;
  }

  const offset = (options.page - 1) * options.limit;
  return {
    responses: matches.slice(offset, offset + options.limit),
    hasNext: matches.length > offset + options.limit,
  };
}

function buildExportBlocksFromPlateContent(plateContent: string | null): Array<{
  blockId: string;
  category: string;
  type: string;
  content: unknown;
}> {
  if (!plateContent) return [];

  try {
    const parsed: unknown = JSON.parse(plateContent);
    if (!Array.isArray(parsed)) return [];

    return extractQuestionsFromPlateContent(parsed).map((question) => ({
      blockId: question.blockId,
      category: "question",
      type: question.type,
      content: {
        title: question.title,
        validation: question.validation,
      },
    }));
  } catch {
    return [];
  }
}

function csvAttachmentFilename(formId: string): string {
  return `responses-${encodeURIComponent(formId)}.csv`;
}

function parseValidationOutputExportSettingsFromStructureJson(
  structureJson: string | null | undefined,
): ValidationOutputExportSettings {
  if (!structureJson) return { values: [] };
  try {
    return (
      parseStoredStructure(structureJson).settings.validation_output_export ?? {
        values: [],
      }
    );
  } catch {
    return parseValidationOutputExportSettings(undefined);
  }
}

async function getValidationOutputsByResponseId(params: {
  formId: string;
  responseIds: string[];
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

  return groupResponseExportValidationOutputsByResponseId(rows);
}

const bulkDeleteSchema = z.object({
  responseIds: z
    .array(z.string().min(1))
    .min(1, "At least one response ID is required")
    .max(100, "Cannot delete more than 100 responses at once"),
});

function snapshotRuleMapKey(
  formId: string,
  snapshotVersion: number | null,
  ruleId: string,
): string {
  return `${formId}:${snapshotVersion ?? "latest"}:${ruleId}`;
}

function extractCurrentBlockIds(plateContent: string | null): Set<string> {
  if (!plateContent) return new Set();
  try {
    const parsed: unknown = JSON.parse(plateContent);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      extractQuestionsFromPlateContent(parsed).map(
        (question) => question.blockId,
      ),
    );
  } catch {
    return new Set();
  }
}

function validationRetryClaimableCondition(now: Date) {
  const staleProcessingCutoff = new Date(
    now.getTime() - VALIDATION_RETRY_CLAIM_LEASE_MS,
  );
  return and(
    or(
      ne(externalServiceValidationResult.status, "PROCESSING"),
      sql`${externalServiceValidationResult.updatedAt} <= ${staleProcessingCutoff}`,
    ),
    or(
      ne(externalServiceValidationResult.status, "PENDING"),
      sql`${externalServiceValidationResult.nextRetryAt} <= ${now}`,
    ),
  );
}

/**
 * validation result 行を lease 付きで PENDING に claim してから BullMQ ジョブを投入する。
 * claim に失敗した result は並行 retry 済みとして enqueue しない。bulk retry でも
 * claim はレコードごとに行うため、最大 100 件では 100 回の UPDATE になるが、
 * 同一 result の二重 enqueue を避けるためこの順序を優先する。
 *
 * @returns enqueuedCount は claim と BullMQ キュー投入の両方に成功した件数。
 *          enqueue 失敗時は同じ jobId を保持している行だけ FAILED に戻す。
 */
export async function enqueueValidationRetries(
  results: Array<{
    id: string;
    responseId: string;
    ruleId: string;
    referencedBlockId: string;
    service: string | null;
    status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "MISSING";
    formId: string;
    snapshotVersion: number | null;
    liveRuleType: string | null;
    liveConfigJson: unknown;
  }>,
): Promise<{ jobIds: string[]; enqueuedCount: number; skippedCount: number }> {
  // MISSING は参照ブロック自体が存在しないため retry 不可。
  const retryable = results.filter((r) => r.status !== "MISSING");
  for (const r of results) {
    if (r.status === "MISSING") {
      logWarn(
        "Skipping validation retry because referenced block is missing",
        "forms-responses",
        {
          resultId: r.id,
          responseId: r.responseId,
          ruleId: r.ruleId,
          referencedBlockId: r.referencedBlockId,
          formId: r.formId,
        },
      );
    }
  }

  const validResults = retryable.filter(
    (r): r is typeof r & { service: string } => r.service != null,
  );
  if (validResults.length === 0)
    return { jobIds: [], enqueuedCount: 0, skippedCount: results.length };

  // snapshotVersion を持つ結果は公開時 snapshot を正とする。
  // draft 側の同一 ruleId が更新済みでも、既公開 response の retry 内容は変えない。
  const needsSnapshot = validResults.filter(
    (r) =>
      r.snapshotVersion !== null ||
      r.liveRuleType === null ||
      r.liveConfigJson === null,
  );
  const snapshotRuleMap = new Map<
    string,
    { ruleType: string; configJson: Record<string, unknown> }
  >();
  if (needsSnapshot.length > 0) {
    const snapshotKeys = new Map(
      needsSnapshot.map((r) => [
        `${r.formId}:${r.snapshotVersion ?? "latest"}`,
        { formId: r.formId, snapshotVersion: r.snapshotVersion },
      ]),
    );
    for (const { formId: fid, snapshotVersion } of snapshotKeys.values()) {
      const snapshot =
        snapshotVersion === null || snapshotVersion === undefined
          ? await getLatestSnapshotByVersion(fid)
          : await getSnapshotByVersion(fid, snapshotVersion);
      if (snapshot?.validationRulesJson) {
        for (const entry of parseValidationRuleSnapshot(
          snapshot.validationRulesJson,
        )) {
          snapshotRuleMap.set(
            snapshotRuleMapKey(fid, snapshotVersion, entry.id),
            {
              ruleType: entry.ruleType,
              configJson: entry.configJson,
            },
          );
        }
      }
    }
  }

  const jobIds: string[] = [];
  const preparedJobs: Array<{
    result: (typeof validResults)[number];
    jobData: z.infer<typeof genericValidationJobDataSchema>;
    jobId: string;
  }> = [];
  let enqueuedCount = 0;

  for (const result of validResults) {
    if (!isValidServiceName(result.service)) {
      logWarn(
        "Skipping validation retry because service name is invalid",
        "forms-responses",
        {
          resultId: result.id,
          responseId: result.responseId,
          ruleId: result.ruleId,
          service: result.service,
          formId: result.formId,
        },
      );
      continue;
    }

    const snapshotEntry = snapshotRuleMap.get(
      snapshotRuleMapKey(result.formId, result.snapshotVersion, result.ruleId),
    );
    const liveConfigJson = isRecord(result.liveConfigJson)
      ? result.liveConfigJson
      : null;
    const ruleType =
      result.snapshotVersion !== null
        ? (snapshotEntry?.ruleType ?? null)
        : (result.liveRuleType ?? snapshotEntry?.ruleType ?? null);
    const configJson =
      result.snapshotVersion !== null
        ? (snapshotEntry?.configJson ?? null)
        : (liveConfigJson ?? snapshotEntry?.configJson ?? null);

    if (!ruleType || !configJson) {
      logWarn(
        "Skipping validation retry because rule config was not found",
        "forms-responses",
        {
          resultId: result.id,
          responseId: result.responseId,
          ruleId: result.ruleId,
          service: result.service,
          formId: result.formId,
        },
      );
      continue;
    }

    if (!providerRegistry.has(result.service)) {
      logWarn(
        "Skipping validation retry because provider is not registered",
        "forms-responses",
        {
          resultId: result.id,
          responseId: result.responseId,
          ruleId: result.ruleId,
          service: result.service,
          formId: result.formId,
        },
      );
      try {
        await db
          .update(externalServiceValidationResult)
          .set({
            status: "FAILED",
            errorCode: "PROVIDER_NOT_REGISTERED",
            errorMessage: `Validation provider not registered: ${result.service}`,
          })
          .where(eq(externalServiceValidationResult.id, result.id));
      } catch (error) {
        logError(
          "Failed to mark validation result as FAILED for unregistered provider",
          "forms-responses",
          {
            error,
            resultId: result.id,
            responseId: result.responseId,
            ruleId: result.ruleId,
            service: result.service,
            formId: result.formId,
          },
        );
      }
      continue;
    }

    try {
      const jobData = genericValidationJobDataSchema.parse({
        responseId: result.responseId,
        ruleId: result.ruleId,
        referencedBlockId: result.referencedBlockId,
        snapshotProviderName: result.service,
        snapshotRuleType: ruleType,
        snapshotConfigJson: configJson,
        snapshotVersion: result.snapshotVersion ?? undefined,
      });
      preparedJobs.push({
        result,
        jobData,
        jobId: buildValidationRetryJobId(result.id, randomUUID()),
      });
    } catch (error) {
      logError("Failed to prepare validation retry job", "forms-responses", {
        error,
        resultId: result.id,
        responseId: result.responseId,
        ruleId: result.ruleId,
        service: result.service,
        formId: result.formId,
      });
      // enqueue に失敗した場合のみ FAILED に設定
      try {
        await db
          .update(externalServiceValidationResult)
          .set({
            status: "FAILED",
            errorCode: "ENQUEUE_FAILED",
            errorMessage: "Failed to prepare retry job",
          })
          .where(eq(externalServiceValidationResult.id, result.id));
      } catch (error) {
        logError(
          "Failed to mark validation result as FAILED after enqueue error",
          "forms-responses",
          {
            error,
            resultId: result.id,
            responseId: result.responseId,
            ruleId: result.ruleId,
            service: result.service,
            formId: result.formId,
          },
        );
      }
    }
  }

  for (const { result, jobData, jobId } of preparedJobs) {
    const claimed = await claimValidationRetryPending(result.id, jobId);
    if (!claimed) {
      logWarn(
        "Skipping validation retry because result was claimed concurrently",
        "forms-responses",
        {
          resultId: result.id,
          responseId: result.responseId,
          ruleId: result.ruleId,
          service: result.service,
          formId: result.formId,
          jobId,
        },
      );
      continue;
    }

    const queue = getValidationQueue(result.service);

    let job: { id?: string };
    try {
      job = await queue.add(`validate-${result.service}`, jobData, {
        jobId,
      });
    } catch (error) {
      logError("Failed to enqueue validation retry job", "forms-responses", {
        error,
        resultId: result.id,
        responseId: result.responseId,
        ruleId: result.ruleId,
        service: result.service,
        formId: result.formId,
        jobId,
      });
      try {
        await db
          .update(externalServiceValidationResult)
          .set({
            status: "FAILED",
            errorCode: "ENQUEUE_FAILED",
            errorMessage: "Failed to enqueue retry job",
          })
          .where(
            and(
              eq(externalServiceValidationResult.id, result.id),
              eq(externalServiceValidationResult.jobId, jobId),
            ),
          );
      } catch (error) {
        logError(
          "Failed to mark validation result as FAILED after enqueue error",
          "forms-responses",
          {
            error,
            resultId: result.id,
            responseId: result.responseId,
            ruleId: result.ruleId,
            service: result.service,
            formId: result.formId,
            jobId,
          },
        );
      }
      continue;
    }

    if (job.id) {
      jobIds.push(job.id);
    }
    enqueuedCount++;
  }

  return {
    jobIds,
    enqueuedCount,
    skippedCount: results.length - enqueuedCount,
  };
}

async function claimValidationRetryPending(
  resultId: string,
  jobId: string,
): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + VALIDATION_RETRY_CLAIM_LEASE_MS);
  const updateResult = await db
    .update(externalServiceValidationResult)
    .set({
      status: "PENDING",
      lastAttemptAt: null,
      nextRetryAt: leaseUntil,
      errorCode: null,
      errorMessage: null,
      jobId,
    })
    .where(
      and(
        eq(externalServiceValidationResult.id, resultId),
        validationRetryClaimableCondition(now),
      ),
    );
  return (updateResult[0]?.affectedRows ?? 0) > 0;
}

type RevalidationResultReason =
  | "response_not_found"
  | "no_validation_rules"
  | "referenced_block_missing"
  | "invalid_service_name"
  | "provider_not_registered"
  | "unknown_rule_type"
  | "enqueue_failed";

type RevalidationResultItem = {
  responseId: string;
  validationResultId?: string;
  status: "enqueued" | "skipped";
  reason?: RevalidationResultReason;
};

type CurrentValidationRuleTarget = {
  ruleId: string;
  providerName: string;
  ruleType: string;
  referencedBlockId: string;
  configJson: Record<string, unknown>;
};

type RevalidationWorkTarget = {
  responseId: string;
  rule: CurrentValidationRuleTarget;
};

type RevalidationWorkResult = {
  jobId?: string;
  result: RevalidationResultItem;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex++;
        results[currentIndex] = await worker(items[currentIndex] as T);
      }
    }),
  );
  return results;
}

async function getCurrentValidationRuleTargets(formId: string): Promise<{
  blockIds: Set<string>;
  rules: CurrentValidationRuleTarget[];
}> {
  const [targetForm] = await db
    .select({ plateContent: form.plateContent })
    .from(form)
    .where(eq(form.id, formId))
    .limit(1);
  const blockIds = extractCurrentBlockIds(targetForm?.plateContent ?? null);
  const ruleRows = await db
    .select({
      ruleId: formValidationRule.id,
      providerName: formValidationRule.providerName,
      ruleType: formValidationRule.ruleType,
      configJson: formValidationRule.configJson,
      referencedBlockId: formValidationRuleBlock.referencedBlockId,
      orderIndex: formValidationRule.orderIndex,
      blockOrderIndex: formValidationRuleBlock.orderIndex,
    })
    .from(formValidationRule)
    .innerJoin(
      formValidationRuleBlock,
      eq(formValidationRuleBlock.ruleId, formValidationRule.id),
    )
    .where(eq(formValidationRule.formId, formId))
    .orderBy(formValidationRule.orderIndex, formValidationRuleBlock.orderIndex);

  return {
    blockIds,
    rules: ruleRows.flatMap((row) => {
      if (!isRecord(row.configJson)) return [];
      return [
        {
          ruleId: row.ruleId,
          providerName: row.providerName,
          ruleType: row.ruleType,
          referencedBlockId: row.referencedBlockId,
          configJson: row.configJson,
        },
      ];
    }),
  };
}

async function claimValidationRevalidationPending(params: {
  resultId: string;
  responseId: string;
  ruleId: string;
  referencedBlockId: string;
  service: string;
  jobId: string;
}): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + VALIDATION_RETRY_CLAIM_LEASE_MS);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        status: externalServiceValidationResult.status,
        nextRetryAt: externalServiceValidationResult.nextRetryAt,
        updatedAt: externalServiceValidationResult.updatedAt,
      })
      .from(externalServiceValidationResult)
      .where(eq(externalServiceValidationResult.id, params.resultId))
      .for("update");

    if (existing) {
      const staleProcessingCutoff = new Date(
        now.getTime() - VALIDATION_RETRY_CLAIM_LEASE_MS,
      );
      const activeProcessing =
        existing.status === "PROCESSING" &&
        existing.updatedAt > staleProcessingCutoff;
      const activePending =
        existing.status === "PENDING" &&
        (existing.nextRetryAt === null || existing.nextRetryAt > now);
      if (activeProcessing || activePending) return false;

      await tx
        .update(externalServiceValidationResult)
        .set({
          snapshotVersion: null,
          service: params.service,
          status: "PENDING",
          success: null,
          attemptCount: 0,
          lastAttemptAt: null,
          nextRetryAt: leaseUntil,
          metadata: null,
          errorCode: null,
          errorMessage: null,
          jobId: params.jobId,
        })
        .where(eq(externalServiceValidationResult.id, params.resultId));
      return true;
    }

    try {
      await tx.insert(externalServiceValidationResult).values({
        id: params.resultId,
        responseId: params.responseId,
        ruleId: params.ruleId,
        referencedBlockId: params.referencedBlockId,
        snapshotVersion: null,
        service: params.service,
        status: "PENDING",
        success: null,
        attemptCount: 0,
        lastAttemptAt: null,
        nextRetryAt: leaseUntil,
        metadata: null,
        errorCode: null,
        errorMessage: null,
        jobId: params.jobId,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) return false;
      throw error;
    }
    return true;
  });
}

async function enqueueValidationRevalidationTarget(params: {
  formId: string;
  responseId: string;
  rule: CurrentValidationRuleTarget;
}): Promise<RevalidationWorkResult> {
  const { formId, responseId, rule } = params;
  const validationResultId = getValidationResultId({
    responseId,
    ruleId: rule.ruleId,
    referencedBlockId: rule.referencedBlockId,
  });
  const jobId = buildValidationRevalidationJobId(
    validationResultId,
    randomUUID(),
  );

  let jobData: z.infer<typeof genericValidationJobDataSchema>;
  try {
    jobData = genericValidationJobDataSchema.parse({
      responseId,
      ruleId: rule.ruleId,
      referencedBlockId: rule.referencedBlockId,
      snapshotProviderName: rule.providerName,
      snapshotRuleType: rule.ruleType,
      snapshotConfigJson: rule.configJson,
    });
  } catch (error) {
    logError(
      "Failed to build validation revalidation job data",
      "forms-responses",
      {
        error,
        responseId,
        ruleId: rule.ruleId,
        service: rule.providerName,
        formId,
      },
    );
    return {
      result: {
        responseId,
        validationResultId,
        status: "skipped",
        reason: "enqueue_failed",
      },
    };
  }

  const claimed = await claimValidationRevalidationPending({
    resultId: validationResultId,
    responseId,
    ruleId: rule.ruleId,
    referencedBlockId: rule.referencedBlockId,
    service: rule.providerName,
    jobId,
  });
  if (!claimed) {
    return {
      result: {
        responseId,
        validationResultId,
        status: "skipped",
      },
    };
  }

  try {
    const queue = getValidationQueue(rule.providerName);
    const job = await queue.add(`validate-${rule.providerName}`, jobData, {
      jobId,
    });
    return {
      jobId: job.id,
      result: {
        responseId,
        validationResultId,
        status: "enqueued",
      },
    };
  } catch (error) {
    logError(
      "Failed to enqueue validation revalidation job",
      "forms-responses",
      {
        error,
        responseId,
        ruleId: rule.ruleId,
        service: rule.providerName,
        formId,
        jobId,
      },
    );
    try {
      await db
        .update(externalServiceValidationResult)
        .set({
          status: "FAILED",
          errorCode: "ENQUEUE_FAILED",
          errorMessage: "Failed to enqueue revalidation job",
        })
        .where(
          and(
            eq(externalServiceValidationResult.id, validationResultId),
            eq(externalServiceValidationResult.jobId, jobId),
          ),
        );
    } catch (cleanupError) {
      logError(
        "Failed to mark validation revalidation enqueue failure",
        "forms-responses",
        {
          error: cleanupError,
          responseId,
          ruleId: rule.ruleId,
          service: rule.providerName,
          formId,
          jobId,
        },
      );
    }
    return {
      result: {
        responseId,
        validationResultId,
        status: "skipped",
        reason: "enqueue_failed",
      },
    };
  }
}

/**
 * Enqueues historical validation revalidation jobs for selected responses.
 *
 * @param params.formId Form that owns the selected responses.
 * @param params.responseIds Response ids requested by the caller.
 * @returns `jobIds` for queued jobs plus stable `enqueuedCount`, `skippedCount`,
 * and per-response/rule `results` describing enqueued or skipped work.
 */
export async function enqueueValidationRevalidations(params: {
  formId: string;
  responseIds: string[];
}): Promise<{
  jobIds: string[];
  enqueuedCount: number;
  skippedCount: number;
  results: RevalidationResultItem[];
}> {
  const responseIds = [...new Set(params.responseIds)];
  const results: RevalidationResultItem[] = [];
  const jobIds: string[] = [];

  const responseRows =
    responseIds.length > 0
      ? await db
          .select({ id: formResponse.id })
          .from(formResponse)
          .where(
            and(
              eq(formResponse.formId, params.formId),
              inArray(formResponse.id, responseIds),
            ),
          )
      : [];
  const existingResponseIds = new Set(responseRows.map((row) => row.id));

  for (const responseId of responseIds) {
    if (!existingResponseIds.has(responseId)) {
      results.push({
        responseId,
        status: "skipped",
        reason: "response_not_found",
      });
    }
  }

  const { blockIds, rules } = await getCurrentValidationRuleTargets(
    params.formId,
  );
  if (rules.length === 0) {
    for (const responseId of existingResponseIds) {
      results.push({
        responseId,
        status: "skipped",
        reason: "no_validation_rules",
      });
    }
    return {
      jobIds,
      enqueuedCount: 0,
      skippedCount: results.length,
      results,
    };
  }

  const workTargets: RevalidationWorkTarget[] = [];
  for (const responseId of responseIds) {
    if (!existingResponseIds.has(responseId)) continue;

    for (const rule of rules) {
      const validationResultId = getValidationResultId({
        responseId,
        ruleId: rule.ruleId,
        referencedBlockId: rule.referencedBlockId,
      });

      if (!blockIds.has(rule.referencedBlockId)) {
        results.push({
          responseId,
          validationResultId,
          status: "skipped",
          reason: "referenced_block_missing",
        });
        continue;
      }
      if (!isValidServiceName(rule.providerName)) {
        results.push({
          responseId,
          validationResultId,
          status: "skipped",
          reason: "invalid_service_name",
        });
        continue;
      }
      const provider = providerRegistry.get(rule.providerName);
      if (!provider) {
        results.push({
          responseId,
          validationResultId,
          status: "skipped",
          reason: "provider_not_registered",
        });
        continue;
      }
      if (!provider.rules[rule.ruleType]) {
        results.push({
          responseId,
          validationResultId,
          status: "skipped",
          reason: "unknown_rule_type",
        });
        continue;
      }

      workTargets.push({ responseId, rule });
    }
  }

  const workResults = await mapWithConcurrency(
    workTargets,
    VALIDATION_REVALIDATION_ENQUEUE_CONCURRENCY,
    (target) =>
      enqueueValidationRevalidationTarget({
        formId: params.formId,
        responseId: target.responseId,
        rule: target.rule,
      }),
  );
  for (const workResult of workResults) {
    if (workResult.jobId) jobIds.push(workResult.jobId);
    results.push(workResult.result);
  }

  const enqueuedCount = results.filter(
    (result) => result.status === "enqueued",
  ).length;
  return {
    jobIds,
    enqueuedCount,
    skippedCount: results.length - enqueuedCount,
    results,
  };
}

async function discardQueuedValidationJob(params: {
  service: string | null;
  jobId: string | null;
  validationResultId: string;
}): Promise<void> {
  const { service, jobId, validationResultId } = params;
  if (!service || !jobId || !isValidServiceName(service)) return;

  try {
    const queue = getValidationQueue(service);
    const job = await queue.getJob(jobId);
    if (!job) return;

    await job.discard();
    const state = await job.getState();
    if (state === "waiting" || state === "delayed") {
      try {
        await job.remove();
      } catch (error) {
        logWarn(
          "Failed to remove queued validation job during cancellation",
          "forms-responses",
          {
            error,
            service,
            jobId,
            validationResultId,
            state,
          },
        );
      }
    }
  } catch (error) {
    logWarn(
      "Failed to discard queued validation job during cancellation",
      "forms-responses",
      {
        error,
        service,
        jobId,
        validationResultId,
      },
    );
  }
}

export const formsResponsesRouter = createHonoApp()
  .use("/:id/responses*", withDualFormAuth("EDITOR"))
  .get(
    "/:id/responses",
    zValidator("query", listResponsesQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const query = c.req.valid("query");
      const sortField = query.sort ?? "submittedAt";
      const sortOrder = query.order ?? "desc";
      const offset = (query.page - 1) * query.limit;
      const searchTerm = (query.q ?? query.keyword)?.trim();
      if (searchTerm) {
        const { responses, hasNext } = await listResponsesWithSearch({
          formId,
          searchTerm,
          page: query.page,
          limit: query.limit,
          sortField,
          sortOrder,
        });
        const uniquenessScores = await getUniquenessScoresForForm(
          formId,
          responses.map((response) => response.id),
        );

        return c.json(
          ResponsesListResponseSchema.parse({
            responses: responses.map((response) =>
              addUniquenessScore(response, uniquenessScores),
            ),
            page: query.page,
            limit: query.limit,
            hasNext,
          }),
        );
      }

      const rows = await db
        .select({
          id: formResponse.id,
          formId: formResponse.formId,
          submittedAt: formResponse.submittedAt,
          updatedAt: formResponse.updatedAt,
          respondentUuid: formResponse.respondentUuid,
          userAgent: formResponse.userAgent,
          sessionId: formResponse.sessionId,
          countryCode: formResponse.countryCode,
        })
        .from(formResponse)
        .where(eq(formResponse.formId, formId))
        .orderBy(buildResponseListOrderBy(sortField, sortOrder))
        .offset(offset)
        .limit(query.limit + 1);
      const responses = rows.slice(0, query.limit);
      const uniquenessScores = await getUniquenessScoresForForm(
        formId,
        responses.map((response) => response.id),
      );

      return c.json(
        ResponsesListResponseSchema.parse({
          responses: responses.map((response) =>
            addUniquenessScore(response, uniquenessScores),
          ),
          page: query.page,
          limit: query.limit,
          hasNext: rows.length > query.limit,
        }),
      );
    },
  )
  .post(
    "/:id/responses",
    withDualFormAuth("EDITOR"),
    responseBodySizeLimit,
    zValidator("json", createResponseSchema),
    async (c) => {
      const formId = c.req.param("id");
      const payload = c.req.valid("json");

      // Validate answers against plateContent-derived question definitions
      const [targetForm] = await db
        .select({ plateContent: form.plateContent })
        .from(form)
        .where(eq(form.id, formId))
        .limit(1);
      if (!targetForm) return c.json(errorResponse("Form not found"), 404);

      // All forms should have plateContent; log a warning if missing so we can
      // investigate. Validation still runs but without question-level checks.
      if (!targetForm.plateContent) {
        logWarn("POST: form missing plateContent", "forms-responses", {
          formId,
        });
      }
      const questions = targetForm.plateContent
        ? buildQuestionsFromPlateContent(targetForm.plateContent)
        : [];
      const validation = validateResponseData(payload.responses, {
        version: 1,
        settings: {},
        questions,
      });
      if (!validation.isValid) {
        return c.json(
          InvalidResponseDataErrorResponseSchema.parse({
            error: "Invalid response data",
            details: validation.errors,
          }),
          400,
        );
      }

      const responseDataJson = stringifyResponseDataJson(payload.responses);
      if (!responseDataJson) {
        return c.json(errorResponse("Response payload is too large"), 400);
      }

      const id = randomUUID();
      await db.insert(formResponse).values({
        id,
        formId,
        responseDataJson,
        respondentUuid: payload.respondentUuid ?? randomUUID(),
        userAgent: payload.userAgent,
        sessionId: payload.sessionId,
        countryCode: payload.countryCode,
      });

      const [created] = await db
        .select()
        .from(formResponse)
        .where(eq(formResponse.id, id))
        .limit(1);

      return c.json(
        ResponseMutationResponseSchema.parse({ response: created ?? null }),
        201,
      );
    },
  )
  .get(
    "/:id/responses/ids",
    zValidator("query", limitedListQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const { page, pageSize } = c.req.valid("query");
      const offset = (page - 1) * pageSize;
      const rows = await db
        .select({ id: formResponse.id })
        .from(formResponse)
        .where(eq(formResponse.formId, formId))
        .orderBy(desc(formResponse.submittedAt), desc(formResponse.id))
        .offset(offset)
        .limit(pageSize + 1);
      const responseIds = rows.slice(0, pageSize).map((row) => row.id);
      return c.json(
        ResponseIdsResponseSchema.parse({
          responseIds,
          pagination: {
            page,
            pageSize,
            hasNext: rows.length > pageSize,
          },
        }),
      );
    },
  )
  .get(
    "/:id/responses/export",
    zValidator(
      "query",
      z.object({
        includeFingerprint: z
          .enum(["true", "false"])
          .default("false")
          .transform((value) => value === "true"),
      }),
    ),
    async (c) => {
      const formId = c.req.param("id");
      const { includeFingerprint } = c.req.valid("query");

      const [targetForm] = await db
        .select({ plateContent: form.plateContent })
        .from(form)
        .where(eq(form.id, formId))
        .limit(1);
      if (!targetForm) return c.json(errorResponse("Form not found"), 404);

      const responseRows = await db
        .select({
          id: formResponse.id,
          formId: formResponse.formId,
          responseDataJson: formResponse.responseDataJson,
          submittedAt: formResponse.submittedAt,
          updatedAt: formResponse.updatedAt,
          respondentUuid: formResponse.respondentUuid,
          userAgent: formResponse.userAgent,
          sessionId: formResponse.sessionId,
          countryCode: formResponse.countryCode,
        })
        .from(formResponse)
        .where(eq(formResponse.formId, formId))
        .orderBy(desc(formResponse.submittedAt), desc(formResponse.id))
        .limit(RESPONSE_EXPORT_ROW_LIMIT + 1);

      if (responseRows.length > RESPONSE_EXPORT_ROW_LIMIT) {
        return c.json(
          errorResponse(
            `Response export is limited to ${RESPONSE_EXPORT_ROW_LIMIT} responses`,
          ),
          413,
        );
      }

      const responseIds = responseRows.map((row) => row.id);
      const fingerprintRows =
        responseIds.length > 0
          ? await db
              .select({
                responseId: fingerprintDetail.responseId,
                componentName: fingerprintDetail.componentName,
                componentValueHash: fingerprintDetail.componentValueHash,
                fingerprintType: fingerprintDetail.fingerprintType,
              })
              .from(fingerprintDetail)
              .where(inArray(fingerprintDetail.responseId, responseIds))
          : [];

      const fingerprintsByResponseId = new Map<
        string,
        Array<{
          componentName: string;
          componentValueHash: string;
          fingerprintType: string;
        }>
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

      const formBlocks = buildExportBlocksFromPlateContent(
        targetForm.plateContent,
      );
      const [activeStructure] = await db
        .select({ structureJson: formStructure.structureJson })
        .from(formStructure)
        .where(
          and(
            eq(formStructure.formId, formId),
            eq(formStructure.isActive, true),
          ),
        )
        .orderBy(desc(formStructure.version))
        .limit(1);
      const validationOutputExportSettings =
        parseValidationOutputExportSettingsFromStructureJson(
          activeStructure?.structureJson,
        );
      const validationOutputsByResponseId =
        await getValidationOutputsByResponseId({
          formId,
          responseIds,
        });
      const blockTitleMap = new Map(
        formBlocks.map((block) => {
          const content =
            block.content && typeof block.content === "object"
              ? (block.content as Record<string, unknown>)
              : null;
          return [block.blockId, String(content?.title || block.blockId)];
        }),
      );
      const { records, fingerprintComponents } = buildResponseExportRecords(
        formId,
        responseRows.map((row) => ({
          ...row,
          sessionId: process.env.SESSION_ALIAS_SALT ? row.sessionId : null,
          fingerprintDetails: fingerprintsByResponseId.get(row.id) ?? [],
        })),
        formBlocks,
        validationOutputsByResponseId,
      );
      const validationOutputColumns =
        buildValidationOutputColumnsForResponseExport(
          validationOutputExportSettings,
          validationOutputsByResponseId,
        );
      const csv = formatRecordsToCsv(
        records,
        fingerprintComponents,
        blockTitleMap,
        buildResponseExportColumnsFromBlocks(formBlocks),
        validationOutputColumns,
        includeFingerprint,
      );

      return c.body(csv, 200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${csvAttachmentFilename(
          formId,
        )}"`,
      });
    },
  )
  .get("/:id/responses/:responseId", async (c) => {
    const formId = c.req.param("id");
    const responseId = c.req.param("responseId");
    const [result] = await db
      .select({
        response: {
          id: formResponse.id,
          formId: formResponse.formId,
          responseDataJson: formResponse.responseDataJson,
          submittedAt: formResponse.submittedAt,
          updatedAt: formResponse.updatedAt,
          respondentUuid: formResponse.respondentUuid,
          userAgent: formResponse.userAgent,
          sessionId: formResponse.sessionId,
          countryCode: formResponse.countryCode,
        },
        plateContent: form.plateContent,
      })
      .from(formResponse)
      .innerJoin(form, eq(form.id, formResponse.formId))
      .where(
        and(eq(formResponse.id, responseId), eq(formResponse.formId, formId)),
      )
      .limit(1);
    if (!result) return c.json(errorResponse("Response not found"), 404);

    const { response, plateContent } = result;
    const questions = plateContent
      ? buildQuestionsFromPlateContent(plateContent)
      : [];
    const responseDataJsonWithLabels =
      questions.length > 0
        ? addDisplayLabelsToResponseDataJson(
            response.responseDataJson,
            buildResponseLabelLookupFromQuestions(questions),
          )
        : null;
    const displayResponse = responseDataJsonWithLabels
      ? { ...response, responseDataJson: responseDataJsonWithLabels }
      : response;
    const uniquenessScores = await getUniquenessScoresForForm(formId, [
      responseId,
    ]);

    const externalValidations = await getExternalValidationResults(responseId);
    return c.json(
      ResponseDetailResponseSchema.parse({
        response: addUniquenessScore(displayResponse, uniquenessScores),
        externalValidations,
      }),
    );
  })
  .put(
    "/:id/responses/:responseId",
    withDualFormAuth("EDITOR"),
    responseBodySizeLimit,
    zValidator("json", updateResponseSchema),
    async (c) => {
      const formId = c.req.param("id");
      const responseId = c.req.param("responseId");
      const payload = c.req.valid("json");

      // Single query: fetch both the existing response and the form's plateContent
      const [existing] = await db
        .select({
          id: formResponse.id,
          plateContent: form.plateContent,
        })
        .from(formResponse)
        .innerJoin(form, eq(form.id, formResponse.formId))
        .where(
          and(eq(formResponse.id, responseId), eq(formResponse.formId, formId)),
        )
        .limit(1);
      if (!existing) return c.json(errorResponse("Response not found"), 404);

      // Validate answers against plateContent-derived question definitions
      if (!existing.plateContent) {
        logWarn("PUT: form missing plateContent", "forms-responses", {
          formId,
        });
      }
      const questions = existing.plateContent
        ? buildQuestionsFromPlateContent(existing.plateContent)
        : [];
      const validation = validateResponseData(payload.responses, {
        version: 1,
        settings: {},
        questions,
      });
      if (!validation.isValid) {
        return c.json(
          InvalidResponseDataErrorResponseSchema.parse({
            error: "Invalid response data",
            details: validation.errors,
          }),
          400,
        );
      }

      const responseDataJson = stringifyResponseDataJson(payload.responses);
      if (!responseDataJson) {
        return c.json(errorResponse("Response payload is too large"), 400);
      }

      await db
        .update(formResponse)
        .set({
          responseDataJson,
          updatedAt: new Date(),
        })
        .where(eq(formResponse.id, responseId));

      const [updated] = await db
        .select()
        .from(formResponse)
        .where(eq(formResponse.id, responseId))
        .limit(1);

      return c.json(
        ResponseMutationResponseSchema.parse({ response: updated ?? null }),
      );
    },
  )
  .delete(
    "/:id/responses/:responseId",
    withDualFormAuth("EDITOR"),
    async (c) => {
      const formId = c.req.param("id");
      const responseId = c.req.param("responseId");
      const [target] = await db
        .select({ id: formResponse.id })
        .from(formResponse)
        .where(
          and(eq(formResponse.id, responseId), eq(formResponse.formId, formId)),
        )
        .limit(1);
      if (!target) return c.json(errorResponse("Response not found"), 404);

      await db.transaction(async (tx) => {
        await tx
          .delete(fingerprintDetail)
          .where(eq(fingerprintDetail.responseId, responseId));
        await tx
          .delete(externalServiceValidationResult)
          .where(eq(externalServiceValidationResult.responseId, responseId));
        await tx.delete(formResponse).where(eq(formResponse.id, responseId));
      });
      return c.json(OkResponseSchema.parse({ ok: true }));
    },
  )
  .post(
    "/:id/responses/bulk-delete",
    withDualFormAuth("EDITOR"),
    createRateLimit({ windowMs: 60_000, maxRequests: 10 }),
    zValidator("json", bulkDeleteSchema),
    async (c) => {
      const formId = c.req.param("id");
      const { responseIds: rawIds } = c.req.valid("json");
      const responseIds = [...new Set(rawIds)];

      const existingResponses = await db
        .select({ id: formResponse.id })
        .from(formResponse)
        .where(
          and(
            eq(formResponse.formId, formId),
            inArray(formResponse.id, responseIds),
          ),
        );

      const existingIds = new Set(existingResponses.map((r) => r.id));
      const results: Array<{
        responseId: string;
        status: "deleted" | "failed";
        error?: string;
      }> = [];
      let deletedCount = 0;
      let failedCount = 0;

      for (const responseId of responseIds) {
        if (!existingIds.has(responseId)) {
          results.push({
            responseId,
            status: "failed",
            error: "Response not found or does not belong to this form",
          });
          failedCount++;
        }
      }

      const idsToDelete = responseIds.filter((id) => existingIds.has(id));

      if (idsToDelete.length > 0) {
        try {
          await db.transaction(async (tx) => {
            await tx
              .delete(fingerprintDetail)
              .where(inArray(fingerprintDetail.responseId, idsToDelete));
            await tx
              .delete(externalServiceValidationResult)
              .where(
                inArray(
                  externalServiceValidationResult.responseId,
                  idsToDelete,
                ),
              );
            await tx
              .delete(formResponse)
              .where(inArray(formResponse.id, idsToDelete));
          });

          for (const id of idsToDelete) {
            results.push({ responseId: id, status: "deleted" });
            deletedCount++;
          }
        } catch {
          for (const id of idsToDelete) {
            results.push({
              responseId: id,
              status: "failed",
              error: "Transaction failed",
            });
            failedCount++;
          }
        }
      }

      return c.json(
        BulkDeleteResponseSchema.parse({
          success: failedCount === 0,
          data: { deleted: deletedCount, failed: failedCount, results },
        }),
      );
    },
  )
  .post(
    "/:id/responses/validation/revalidate",
    withDualFormAuth("EDITOR"),
    createRateLimit({ windowMs: 60_000, maxRequests: 10 }),
    zValidator("json", bulkRevalidationSchema),
    async (c) => {
      const formId = c.req.param("id");
      const { responseIds } = c.req.valid("json");
      const result = await enqueueValidationRevalidations({
        formId,
        responseIds,
      });

      return c.json(
        ValidationRevalidationResponseSchema.parse({
          enqueued: result.enqueuedCount,
          skipped: result.skippedCount,
          jobIds: result.jobIds,
          results: result.results,
        }),
      );
    },
  )
  .post(
    "/:id/responses/validation/bulk-retry",
    withDualFormAuth("EDITOR"),
    zValidator("json", bulkRetrySchema),
    async (c) => {
      const formId = c.req.param("id");
      const { validationResultIds } = c.req.valid("json");

      const targets = await db
        .select({
          id: externalServiceValidationResult.id,
          responseId: externalServiceValidationResult.responseId,
          ruleId: externalServiceValidationResult.ruleId,
          referencedBlockId: externalServiceValidationResult.referencedBlockId,
          service: externalServiceValidationResult.service,
          status: externalServiceValidationResult.status,
          snapshotVersion: externalServiceValidationResult.snapshotVersion,
          formId: formResponse.formId,
          liveRuleType: formValidationRule.ruleType,
          liveConfigJson: formValidationRule.configJson,
        })
        .from(externalServiceValidationResult)
        .innerJoin(
          formResponse,
          eq(formResponse.id, externalServiceValidationResult.responseId),
        )
        .leftJoin(
          formValidationRule,
          eq(formValidationRule.id, externalServiceValidationResult.ruleId),
        )
        .where(
          and(
            eq(formResponse.formId, formId),
            inArray(externalServiceValidationResult.id, validationResultIds),
            validationRetryClaimableCondition(new Date()),
          ),
        );

      if (targets.length === 0) {
        // ステータスフィルタなしで存在確認し、404 と 409 を区別する
        const [anyExisting] = await db
          .select({ id: externalServiceValidationResult.id })
          .from(externalServiceValidationResult)
          .innerJoin(
            formResponse,
            eq(formResponse.id, externalServiceValidationResult.responseId),
          )
          .where(
            and(
              eq(formResponse.formId, formId),
              inArray(externalServiceValidationResult.id, validationResultIds),
            ),
          )
          .limit(1);

        if (anyExisting) {
          return c.json(
            errorResponse(
              "Some or all matching validation results are already PENDING or PROCESSING",
            ),
            409,
          );
        }
        return c.json(
          errorResponse("No matching validation results found for this form"),
          404,
        );
      }

      // PENDING への claim は enqueueValidationRetries 内でレコードごとに行う
      const { jobIds, enqueuedCount, skippedCount } =
        await enqueueValidationRetries(targets);

      if (enqueuedCount === 0) {
        return c.json(
          ValidationRetryEnqueueErrorResponseSchema.parse({
            error:
              "No validation jobs could be enqueued; results may already be claimed or service configuration may be invalid",
            enqueued: 0,
            skipped: skippedCount,
            jobIds: [],
          }),
          422,
        );
      }

      return c.json(
        ValidationRetryResponseSchema.parse({
          enqueued: enqueuedCount,
          skipped: skippedCount,
          jobIds,
        }),
      );
    },
  )
  .post(
    "/:id/responses/:responseId/validation/revalidate",
    withDualFormAuth("EDITOR"),
    async (c) => {
      const formId = c.req.param("id");
      const responseId = c.req.param("responseId");

      const result = await enqueueValidationRevalidations({
        formId,
        responseIds: [responseId],
      });
      if (
        result.enqueuedCount === 0 &&
        result.results.length === 1 &&
        result.results[0]?.reason === "response_not_found"
      ) {
        return c.json(errorResponse("Response not found"), 404);
      }

      return c.json(
        ValidationRevalidationResponseSchema.parse({
          enqueued: result.enqueuedCount,
          skipped: result.skippedCount,
          jobIds: result.jobIds,
          results: result.results,
        }),
      );
    },
  )
  .post(
    "/:id/responses/:responseId/validation/retry",
    withDualFormAuth("EDITOR"),
    async (c) => {
      const formId = c.req.param("id");
      const responseId = c.req.param("responseId");

      const rows = await db
        .select({
          id: externalServiceValidationResult.id,
          responseId: externalServiceValidationResult.responseId,
          ruleId: externalServiceValidationResult.ruleId,
          referencedBlockId: externalServiceValidationResult.referencedBlockId,
          service: externalServiceValidationResult.service,
          status: externalServiceValidationResult.status,
          snapshotVersion: externalServiceValidationResult.snapshotVersion,
          formId: formResponse.formId,
          liveRuleType: formValidationRule.ruleType,
          liveConfigJson: formValidationRule.configJson,
        })
        .from(externalServiceValidationResult)
        .innerJoin(
          formResponse,
          eq(formResponse.id, externalServiceValidationResult.responseId),
        )
        .leftJoin(
          formValidationRule,
          eq(formValidationRule.id, externalServiceValidationResult.ruleId),
        )
        .where(
          and(
            eq(formResponse.formId, formId),
            eq(formResponse.id, responseId),
            validationRetryClaimableCondition(new Date()),
          ),
        );
      if (rows.length === 0) {
        // ステータスフィルタなしで存在確認し、404 と 409 を区別する
        const [anyExisting] = await db
          .select({ id: externalServiceValidationResult.id })
          .from(externalServiceValidationResult)
          .innerJoin(
            formResponse,
            eq(formResponse.id, externalServiceValidationResult.responseId),
          )
          .where(
            and(
              eq(formResponse.formId, formId),
              eq(formResponse.id, responseId),
            ),
          )
          .limit(1);

        if (anyExisting) {
          return c.json(
            errorResponse(
              "Some or all matching validation results are already PENDING or PROCESSING",
            ),
            409,
          );
        }
        return c.json(errorResponse("Validation result not found"), 404);
      }

      // PENDING への claim は enqueueValidationRetries 内でレコードごとに行う
      const { jobIds, enqueuedCount, skippedCount } =
        await enqueueValidationRetries(rows);

      if (enqueuedCount === 0) {
        return c.json(
          ValidationRetryEnqueueErrorResponseSchema.parse({
            error:
              "No validation jobs could be enqueued; results may already be claimed or service configuration may be invalid",
            enqueued: 0,
            skipped: skippedCount,
            jobIds: [],
          }),
          422,
        );
      }

      return c.json(
        ValidationRetryResponseSchema.parse({
          enqueued: enqueuedCount,
          skipped: skippedCount,
          jobIds,
        }),
      );
    },
  )
  .post(
    "/:id/responses/:responseId/validation/:validationResultId/cancel",
    withDualFormAuth("EDITOR"),
    async (c) => {
      const formId = c.req.param("id");
      const responseId = c.req.param("responseId");
      const validationResultId = c.req.param("validationResultId");

      const [target] = await db
        .select({
          id: externalServiceValidationResult.id,
          service: externalServiceValidationResult.service,
          jobId: externalServiceValidationResult.jobId,
          status: externalServiceValidationResult.status,
        })
        .from(externalServiceValidationResult)
        .innerJoin(
          formResponse,
          eq(formResponse.id, externalServiceValidationResult.responseId),
        )
        .where(
          and(
            eq(formResponse.formId, formId),
            eq(formResponse.id, responseId),
            eq(externalServiceValidationResult.id, validationResultId),
          ),
        )
        .limit(1);

      if (!target) {
        return c.json(errorResponse("Validation result not found"), 404);
      }

      if (!cancellableValidationStatuses.has(target.status)) {
        return c.json(
          errorResponse(
            "Validation result cannot be cancelled in its current status",
          ),
          409,
        );
      }

      await discardQueuedValidationJob({
        service: target.service,
        jobId: target.jobId,
        validationResultId,
      });

      const updateResult = await db
        .update(externalServiceValidationResult)
        .set({
          status: "FAILED",
          nextRetryAt: null,
          errorCode: "CANCELLED_BY_USER",
          errorMessage: "Validation cancelled by user",
        })
        .where(
          and(
            eq(externalServiceValidationResult.id, validationResultId),
            cancellableValidationStatusCondition(),
          ),
        );

      if ((updateResult[0]?.affectedRows ?? 0) === 0) {
        const [current] = await db
          .select({
            id: externalServiceValidationResult.id,
            status: externalServiceValidationResult.status,
          })
          .from(externalServiceValidationResult)
          .innerJoin(
            formResponse,
            eq(formResponse.id, externalServiceValidationResult.responseId),
          )
          .where(
            and(
              eq(formResponse.formId, formId),
              eq(formResponse.id, responseId),
              eq(externalServiceValidationResult.id, validationResultId),
            ),
          )
          .limit(1);

        if (!current) {
          return c.json(errorResponse("Validation result not found"), 404);
        }

        return c.json(
          errorResponse(
            "Validation result cannot be cancelled in its current status",
          ),
          409,
        );
      }

      return c.json(OkResponseSchema.parse({ ok: true }));
    },
  );
