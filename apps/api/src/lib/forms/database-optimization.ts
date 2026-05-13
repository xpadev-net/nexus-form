import { db } from "@nexus-form/database";
import { formStructure } from "@nexus-form/database/schema";
import { and, count, eq, lt, sql } from "drizzle-orm";
import { logError, logInfo } from "../logger";

/**
 * データベース最適化のためのインデックス作成
 */
export async function createFormStructureIndexes(): Promise<void> {
  try {
    // フォーム構造テーブルのインデックス作成
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_form_structure_form_id ON FormStructure(formId)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_form_structure_version ON FormStructure(formId, version)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_form_structure_active ON FormStructure(formId, isActive)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_form_structure_created_at ON FormStructure(createdAt)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_form_structure_created_by ON FormStructure(createdBy)
    `);

    logInfo("Form structure indexes created successfully", "api", {});
  } catch (error) {
    logError("Error creating form structure indexes:", "api", { error: error });
    throw error;
  }
}

/**
 * 古いフォーム構造データのクリーンアップ
 */
export async function cleanupOldFormStructures(
  olderThanDays: number = 90,
): Promise<number> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db
      .delete(formStructure)
      .where(
        and(
          eq(formStructure.isActive, false),
          lt(formStructure.createdAt, cutoffDate),
        ),
      );

    const deletedCount = result[0]?.affectedRows ?? 0;
    logInfo(`Cleaned up ${deletedCount} old form structures`, "api", {});
    return deletedCount;
  } catch (error) {
    logError("Error cleaning up old form structures:", "api", { error: error });
    throw error;
  }
}

/**
 * フォーム構造の統計情報を取得
 */
export async function getFormStructureStats(formId: string): Promise<{
  totalVersions: number;
  activeVersion: number;
  lastModified: Date | null;
  totalSize: number;
}> {
  try {
    const [totalVersionsResult, activeStructure] = await Promise.all([
      db
        .select({ count: count() })
        .from(formStructure)
        .where(eq(formStructure.formId, formId)),
      db.query.formStructure.findFirst({
        where: and(
          eq(formStructure.formId, formId),
          eq(formStructure.isActive, true),
        ),
        columns: { version: true, createdAt: true },
      }),
    ]);

    const totalVersions = totalVersionsResult[0]?.count ?? 0;

    return {
      totalVersions,
      activeVersion: activeStructure?.version || 0,
      lastModified: activeStructure?.createdAt || null,
      totalSize: totalVersions, // 概算値としてバージョン数を使用
    };
  } catch (error) {
    logError("Error getting form structure stats:", "api", { error: error });
    throw error;
  }
}
