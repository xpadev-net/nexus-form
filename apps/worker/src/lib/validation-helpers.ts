/**
 * バリデーションハンドラ共通ユーティリティ
 */

import {
  db,
  externalServiceValidationResult,
  formResponse,
  formSnapshot,
} from "@nexus-form/database";
import type { ValidationSSEEvent } from "@nexus-form/shared";
import {
  extractQuestionsFromPlateContent,
  getValidationResultId,
} from "@nexus-form/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { publishValidationEvent } from "./redis-publisher";
import { extractReferencedValueFromJson } from "./response-data-extractor";

export class ConcurrentDeleteError extends Error {
  constructor(
    public readonly responseId: string,
    public readonly ruleId: string,
    public readonly referencedBlockId: string,
  ) {
    super(
      `markValidationProcessing: row deleted concurrently for responseId=${responseId} ruleId=${ruleId} referencedBlockId=${referencedBlockId}`,
    );
    this.name = "ConcurrentDeleteError";
  }
}

export class ReferencedBlockMissingError extends Error {
  constructor(
    public readonly formId: string,
    public readonly responseId: string,
    public readonly ruleId: string,
    public readonly referencedBlockId: string,
  ) {
    super(
      `Referenced block missing: rule=${ruleId} referencedBlockId=${referencedBlockId}`,
    );
    this.name = "ReferencedBlockMissingError";
  }
}

/**
 * バリデーションルールとレスポンスデータを取得する。
 * ブロック存在確認は公開済みスナップショットの plateContent を基準とする。
 * ドラフトでブロックが削除されていても、スナップショット上に存在すれば MISSING にしない。
 * フォームが非公開 (isActive なし) の場合はバージョン降順で最新スナップショットにフォールバックする。
 */
export async function getValidationContext(
  responseId: string,
  ruleId: string,
  referencedBlockId: string,
) {
  const [response] = await db
    .select()
    .from(formResponse)
    .where(eq(formResponse.id, responseId))
    .limit(1);
  if (!response) {
    throw new Error(`Form response not found: ${responseId}`);
  }

  // isActive DESC → version DESC でソートすることで、アクティブスナップショットを
  // 優先しつつ、非公開時は最新バージョンのスナップショットにフォールバックする。
  const [snapshotRow] = await db
    .select({ plateContent: formSnapshot.plateContent })
    .from(formSnapshot)
    .where(eq(formSnapshot.formId, response.formId))
    .orderBy(sql`${formSnapshot.isActive} = 1 DESC`, desc(formSnapshot.version))
    .limit(1);

  let blockIds: Set<string>;
  try {
    const raw = snapshotRow?.plateContent;
    const parsed = raw ? JSON.parse(raw) : [];
    const questions = Array.isArray(parsed)
      ? extractQuestionsFromPlateContent(parsed)
      : [];
    blockIds = new Set(questions.map((q) => q.blockId));
  } catch {
    blockIds = new Set();
  }

  if (!blockIds.has(referencedBlockId)) {
    throw new ReferencedBlockMissingError(
      response.formId,
      responseId,
      ruleId,
      referencedBlockId,
    );
  }

  const referencedValue = extractReferencedValueFromJson(
    response.responseDataJson,
    referencedBlockId,
    response.id,
  );

  return { response, referencedValue };
}

/**
 * バリデーション結果をDBに書き込み、SSEイベントを publish する。
 * INSERT ... ON DUPLICATE KEY UPDATE で競合状態を回避する。
 */
export async function writeValidationResult(params: {
  responseId: string;
  formId: string;
  ruleId: string;
  referencedBlockId: string;
  service: string;
  status?: "COMPLETED" | "FAILED" | "MISSING";
  success: boolean | null;
  metadata?: unknown;
  errorCode?: string;
  errorMessage?: string;
  jobId?: string;
}) {
  const now = new Date();
  const status: "COMPLETED" | "FAILED" | "MISSING" =
    params.status ?? (params.success ? "COMPLETED" : "FAILED");
  const resultId = getValidationResultId(params);

  const { skipped } = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        status: externalServiceValidationResult.status,
        errorCode: externalServiceValidationResult.errorCode,
      })
      .from(externalServiceValidationResult)
      .where(eq(externalServiceValidationResult.id, resultId))
      .for("update");

    if (
      existing?.status === "FAILED" &&
      existing.errorCode === "CANCELLED_BY_USER"
    ) {
      return { skipped: true };
    }

    await tx
      .insert(externalServiceValidationResult)
      .values({
        id: resultId,
        responseId: params.responseId,
        ruleId: params.ruleId,
        referencedBlockId: params.referencedBlockId,
        service: params.service,
        status,
        success: params.success,
        attemptCount: 1,
        lastAttemptAt: now,
        metadata: params.metadata ?? null,
        errorCode: params.errorCode ?? null,
        errorMessage: params.errorMessage ?? null,
        jobId: params.jobId ?? null,
      })
      .onDuplicateKeyUpdate({
        set: {
          id: resultId,
          status,
          success: params.success,
          attemptCount: sql`${externalServiceValidationResult.attemptCount} + 1`,
          lastAttemptAt: now,
          metadata: params.metadata ?? null,
          errorCode: params.errorCode ?? null,
          errorMessage: params.errorMessage ?? null,
          jobId: params.jobId ?? null,
        },
      });

    return { skipped: false };
  });

  if (skipped) {
    return resultId;
  }

  const event: ValidationSSEEvent = {
    type: "validation_status_changed",
    formId: params.formId,
    responseId: params.responseId,
    validationResultId: resultId,
    ruleId: params.ruleId,
    referencedBlockId: params.referencedBlockId,
    service: params.service,
    status,
    success: params.success,
    timestamp: now.toISOString(),
  };
  await publishValidationEvent(event);

  return resultId;
}

/**
 * バリデーション結果のステータスを PROCESSING に更新し、SSEイベントを publish する。
 */
export async function markValidationProcessing(params: {
  responseId: string;
  ruleId: string;
  referencedBlockId: string;
  formId: string;
  service: string;
}) {
  const resultId = getValidationResultId(params);

  const updateResult = await db
    .update(externalServiceValidationResult)
    .set({ id: resultId, status: "PROCESSING" })
    .where(
      and(
        eq(externalServiceValidationResult.responseId, params.responseId),
        eq(externalServiceValidationResult.ruleId, params.ruleId),
        eq(
          externalServiceValidationResult.referencedBlockId,
          params.referencedBlockId,
        ),
        sql`(${externalServiceValidationResult.status} <> ${"FAILED"} OR ${externalServiceValidationResult.errorCode} IS NULL OR ${externalServiceValidationResult.errorCode} <> ${"CANCELLED_BY_USER"})`,
      ),
    );

  // mysql2 includes CLIENT_FOUND_ROWS by default, so affectedRows counts matched
  // rows (not changed rows). affectedRows === 0 therefore means the row is gone.
  if ((updateResult[0]?.affectedRows ?? 0) === 0) {
    throw new ConcurrentDeleteError(
      params.responseId,
      params.ruleId,
      params.referencedBlockId,
    );
  }

  const event: ValidationSSEEvent = {
    type: "validation_status_changed",
    formId: params.formId,
    responseId: params.responseId,
    validationResultId: resultId,
    ruleId: params.ruleId,
    referencedBlockId: params.referencedBlockId,
    service: params.service,
    status: "PROCESSING",
    success: null,
    timestamp: new Date().toISOString(),
  };
  await publishValidationEvent(event);
}
