import { db } from "@nexus-form/database";
import { form, formSchedule } from "@nexus-form/database/schema";
import type { FormStatusValue } from "@nexus-form/shared";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { SnapshotNotFoundError } from "../errors/form-errors";
import { logError } from "../logger";
import {
  activateSnapshotInTransaction,
  transitionPublicationStatusInTransaction,
} from "./snapshot-repository";

const NO_SCHEDULE_CHANGES_MESSAGE = "No schedule changes needed";
const ALREADY_PROCESSED_MESSAGE =
  "Schedule was already processed by another worker; skipped";

/**
 * スケジュール処理結果の型定義
 */
export interface ScheduleProcessResult {
  processed: boolean;
  statusChanged: boolean;
  newStatus: FormStatusValue;
  message: string;
}

function getAffectedRows(updateResult: unknown): number {
  if (!Array.isArray(updateResult)) return 0;
  const [header] = updateResult;
  if (typeof header !== "object" || header === null) return 0;
  if (!("affectedRows" in header)) return 0;
  return typeof header.affectedRows === "number" ? header.affectedRows : 0;
}

/**
 * フォームのスケジュール処理を実行
 *
 * ## タイムゾーン処理について
 * - すべての日時はUTC形式でデータベースに保存されます
 * - `triggerAt`と`currentTime`の比較はUTC時刻として行われます
 */
export async function processFormSchedule(
  formId: string,
  currentTime: Date = new Date(),
): Promise<ScheduleProcessResult> {
  try {
    const result = await db.transaction(async (tx) => {
      const snapshotSchedules: Array<{
        id: string;
        snapshotVersion: number;
      }> = [];

      // フォームと due schedule を同一 TX でロックして stale read を避ける。
      const [foundForm] = await tx
        .select({
          id: form.id,
          status: form.status,
          publishedAt: form.publishedAt,
          unpublishedAt: form.unpublishedAt,
          creatorId: form.creatorId,
        })
        .from(form)
        .where(eq(form.id, formId))
        .for("update")
        .limit(1);

      if (!foundForm) {
        throw new Error("Form not found");
      }

      // 未処理のスケジュールを取得（トリガー時刻が現在時刻以前のもの）
      const pendingSchedules = await tx
        .select()
        .from(formSchedule)
        .where(
          and(
            eq(formSchedule.formId, formId),
            isNull(formSchedule.processedAt),
            lte(formSchedule.triggerAt, currentTime),
          ),
        )
        .orderBy(
          asc(formSchedule.triggerAt),
          asc(formSchedule.createdAt),
          asc(formSchedule.id),
        )
        .for("update");

      if (pendingSchedules.length === 0) {
        return {
          snapshotSchedules,
          processed: false,
          statusChanged: false,
          newStatus: foundForm.status,
          message: "No pending schedules to process",
        };
      }

      let statusChanged = false;
      let currentStatus = foundForm.status;
      let newStatus = foundForm.status;
      let message = NO_SCHEDULE_CHANGES_MESSAGE;

      // 各スケジュールを処理
      for (const schedule of pendingSchedules) {
        if (schedule.action === "SWITCH_SNAPSHOT") {
          const targetVersion = schedule.snapshotVersion;
          if (targetVersion != null) {
            snapshotSchedules.push({
              id: schedule.id,
              snapshotVersion: targetVersion,
            });
            continue;
          }

          logError("SWITCH_SNAPSHOT schedule has no snapshotVersion", "api", {
            formId,
            scheduleId: schedule.id,
          });
          message = "SWITCH_SNAPSHOT schedule missing snapshotVersion; skipped";
        }

        const processedResult = await tx
          .update(formSchedule)
          .set({ processedAt: currentTime })
          .where(
            and(
              eq(formSchedule.id, schedule.id),
              isNull(formSchedule.processedAt),
            ),
          );
        if (getAffectedRows(processedResult) === 0) {
          if (message === NO_SCHEDULE_CHANGES_MESSAGE) {
            message = ALREADY_PROCESSED_MESSAGE;
          }
          continue;
        }

        if (schedule.action === "PUBLISH" && currentStatus !== "PUBLISHED") {
          await transitionPublicationStatusInTransaction(
            tx,
            formId,
            currentStatus,
            "PUBLISHED",
            schedule.triggerAt,
          );
          statusChanged = true;
          currentStatus = "PUBLISHED";
          newStatus = "PUBLISHED";
          message = "Form automatically published based on schedule";
        } else if (
          schedule.action === "UNPUBLISH" &&
          currentStatus !== "UNPUBLISHED"
        ) {
          await transitionPublicationStatusInTransaction(
            tx,
            formId,
            currentStatus,
            "UNPUBLISHED",
            schedule.triggerAt,
          );
          statusChanged = true;
          currentStatus = "UNPUBLISHED";
          newStatus = "UNPUBLISHED";
          message = "Form automatically unpublished based on schedule";
        }
      }

      return {
        snapshotSchedules,
        processed: true,
        statusChanged,
        newStatus,
        message,
      };
    });

    const { snapshotSchedules, ...scheduleResult } = result;
    let finalResult = scheduleResult;

    for (const schedule of snapshotSchedules) {
      let activated: boolean;
      try {
        activated = await db.transaction(async (tx) => {
          const processedResult = await tx
            .update(formSchedule)
            .set({ processedAt: currentTime })
            .where(
              and(
                eq(formSchedule.id, schedule.id),
                isNull(formSchedule.processedAt),
              ),
            );
          if (getAffectedRows(processedResult) === 0) return false;

          await activateSnapshotInTransaction(
            tx,
            formId,
            schedule.snapshotVersion,
          );
          return true;
        });
      } catch (error) {
        if (error instanceof SnapshotNotFoundError) {
          logError("SWITCH_SNAPSHOT skipped: snapshot not found", "api", {
            formId,
            targetVersion: schedule.snapshotVersion,
          });
        }
        throw error;
      }

      if (!activated) {
        if (finalResult.message === NO_SCHEDULE_CHANGES_MESSAGE) {
          finalResult = {
            ...finalResult,
            processed: true,
            message: ALREADY_PROCESSED_MESSAGE,
          };
        }
        continue;
      }

      finalResult = {
        ...finalResult,
        processed: true,
        message: `Snapshot switched to version ${schedule.snapshotVersion} based on schedule`,
      };
    }

    return finalResult;
  } catch (error) {
    logError("Schedule processing error", "api", {
      error: error instanceof Error ? error.message : String(error),
      formId,
      currentTime: currentTime.toISOString(),
    });
    throw error;
  }
}

/**
 * 複数のフォームのスケジュール処理を一括実行（並列処理）
 */
export async function processMultipleFormSchedules(
  formIds: string[],
  currentTime: Date = new Date(),
): Promise<Record<string, ScheduleProcessResult>> {
  const results: Record<string, ScheduleProcessResult> = {};

  // 並列処理で全フォームのスケジュールを処理
  const promises = formIds.map(async (id) => ({
    formId: id,
    result: await processFormSchedule(id, currentTime),
  }));

  const settled = await Promise.allSettled(promises);

  // 結果を集約
  for (const promise of settled) {
    if (promise.status === "fulfilled") {
      const { formId: id, result } = promise.value;
      results[id] = result;
    } else {
      const index = settled.indexOf(promise);
      const id = formIds[index];
      if (id) {
        results[id] = {
          processed: false,
          statusChanged: false,
          newStatus: "DRAFT",
          message: `Error processing schedule: ${promise.reason instanceof Error ? promise.reason.message : String(promise.reason)}`,
        };
      }
    }
  }

  return results;
}

/**
 * スケジュール処理が必要なフォームを検索
 */
export async function findFormsNeedingScheduleProcessing(
  currentTime: Date = new Date(),
): Promise<string[]> {
  // トリガー時刻が現在時刻以前で未処理のスケジュールを持つフォームを検索
  const schedules = await db
    .selectDistinct({ formId: formSchedule.formId })
    .from(formSchedule)
    .where(
      and(
        isNull(formSchedule.processedAt),
        lte(formSchedule.triggerAt, currentTime),
      ),
    );

  return schedules.map((schedule) => schedule.formId);
}
