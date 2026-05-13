import { db } from "@nexus-form/database";
import { formStructure } from "@nexus-form/database/schema";
import { and, eq } from "drizzle-orm";
import { logError } from "../logger";

interface FormStructureResult {
  id: string;
  formId: string;
  version: number;
  createdAt: Date;
  changeLog: string | null;
  parentVersion: number | null;
}

/**
 * 楽観的ロック用のインターフェース
 */
export interface OptimisticLockRequest {
  formId: string;
  expectedVersion: number;
  newStructure: unknown;
  userId: string;
  changeLog?: string;
}

/**
 * 楽観的ロックを使用してフォーム構造を保存
 */
export async function saveFormStructureWithOptimisticLock(
  request: OptimisticLockRequest,
): Promise<
  | { success: true; structure: FormStructureResult }
  | { success: false; error: string; currentVersion: number }
> {
  try {
    // 現在のバージョンを取得
    const currentStructure = await db.query.formStructure.findFirst({
      where: and(
        eq(formStructure.formId, request.formId),
        eq(formStructure.isActive, true),
      ),
      columns: {
        version: true,
      },
    });

    const currentVersion = currentStructure?.version || 0;

    // 楽観的ロックチェック
    if (currentVersion !== request.expectedVersion) {
      return {
        success: false,
        error: "Form structure has been modified by another user",
        currentVersion,
      };
    }

    // トランザクション内で保存
    const result = await db.transaction(async (tx) => {
      // 既存の構造を非アクティブにする
      await tx
        .update(formStructure)
        .set({ isActive: false })
        .where(
          and(
            eq(formStructure.formId, request.formId),
            eq(formStructure.isActive, true),
          ),
        );

      // 新しい構造を保存
      const newId = crypto.randomUUID();
      await tx.insert(formStructure).values({
        id: newId,
        formId: request.formId,
        structureJson: JSON.stringify(request.newStructure),
        version: request.expectedVersion + 1,
        createdBy: request.userId,
        changeLog:
          request.changeLog || `Version ${request.expectedVersion + 1} created`,
        parentVersion:
          request.expectedVersion > 0 ? request.expectedVersion : null,
      });

      // 作成した構造を取得
      const newStructure = await tx.query.formStructure.findFirst({
        where: eq(formStructure.id, newId),
      });

      if (!newStructure) {
        throw new Error("Failed to create form structure");
      }

      return {
        id: newStructure.id,
        formId: newStructure.formId,
        version: newStructure.version,
        createdAt: newStructure.createdAt,
        changeLog: newStructure.changeLog,
        parentVersion: newStructure.parentVersion,
      };
    });

    return {
      success: true,
      structure: result,
    };
  } catch (error) {
    logError("Error in optimistic lock save:", "api", { error: error });
    throw new Error(
      `Failed to save form structure: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * フォーム構造の現在のバージョンを取得
 */
export async function getCurrentFormStructureVersion(
  formId: string,
): Promise<number> {
  const structure = await db.query.formStructure.findFirst({
    where: and(
      eq(formStructure.formId, formId),
      eq(formStructure.isActive, true),
    ),
    columns: {
      version: true,
    },
  });

  return structure?.version || 0;
}
