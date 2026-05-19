import { db } from "@nexus-form/database";
import { form, formSchedule } from "@nexus-form/database/schema";
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { SnapshotNotFoundError } from "../errors/form-errors";
import { logError } from "../logger";
import { activateSnapshot } from "./snapshot-repository";

/**
 * Form status type (matches schema enum)
 */
type FormStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";

/**
 * スケジュール処理結果の型定義
 */
export interface ScheduleProcessResult {
  processed: boolean;
  statusChanged: boolean;
  newStatus: FormStatus;
  message: string;
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
    // フォームの現在の状態を取得
    const [foundForm] = await db
      .select({
        id: form.id,
        status: form.status,
        publishedAt: form.publishedAt,
        unpublishedAt: form.unpublishedAt,
        creatorId: form.creatorId,
      })
      .from(form)
      .where(eq(form.id, formId))
      .limit(1);

    if (!foundForm) {
      throw new Error("Form not found");
    }

    // 未処理のスケジュールを取得（トリガー時刻が現在時刻以前のもの）
    const pendingSchedules = await db
      .select()
      .from(formSchedule)
      .where(
        and(
          eq(formSchedule.formId, formId),
          isNull(formSchedule.processedAt),
          lte(formSchedule.triggerAt, currentTime),
        ),
      )
      .orderBy(asc(formSchedule.triggerAt));

    if (pendingSchedules.length === 0) {
      return {
        processed: false,
        statusChanged: false,
        newStatus: foundForm.status as FormStatus,
        message: "No pending schedules to process",
      };
    }

    let statusChanged = false;
    let newStatus = foundForm.status as FormStatus;
    let message = "No schedule changes needed";

    // 各スケジュールを処理
    for (const schedule of pendingSchedules) {
      if (schedule.action === "PUBLISH" && foundForm.status !== "PUBLISHED") {
        await db
          .update(form)
          .set({ status: "PUBLISHED", publishedAt: schedule.triggerAt })
          .where(eq(form.id, formId));
        statusChanged = true;
        newStatus = "PUBLISHED";
        message = "Form automatically published based on schedule";
      } else if (
        schedule.action === "UNPUBLISH" &&
        foundForm.status !== "UNPUBLISHED"
      ) {
        await db
          .update(form)
          .set({ status: "UNPUBLISHED", unpublishedAt: schedule.triggerAt })
          .where(eq(form.id, formId));
        statusChanged = true;
        newStatus = "UNPUBLISHED";
        message = "Form automatically unpublished based on schedule";
      } else if (schedule.action === "SWITCH_SNAPSHOT") {
        const targetVersion = schedule.snapshotVersion;
        if (targetVersion == null) {
          logError("SWITCH_SNAPSHOT schedule has no snapshotVersion", "api", {
            formId,
            scheduleId: schedule.id,
          });
          message = `SWITCH_SNAPSHOT schedule missing snapshotVersion; skipped`;
        } else {
          try {
            await activateSnapshot(formId, targetVersion);
            message = `Snapshot switched to version ${targetVersion} based on schedule`;
          } catch (err) {
            if (err instanceof SnapshotNotFoundError) {
              logError("SWITCH_SNAPSHOT skipped: snapshot not found", "api", {
                formId,
                targetVersion,
              });
              message = `Snapshot version ${targetVersion} not found; schedule skipped`;
            } else {
              throw err;
            }
          }
        }
      }

      // スケジュールを処理済みとしてマーク
      await db
        .update(formSchedule)
        .set({ processedAt: currentTime })
        .where(eq(formSchedule.id, schedule.id));
    }

    return {
      processed: true,
      statusChanged,
      newStatus,
      message,
    };
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
