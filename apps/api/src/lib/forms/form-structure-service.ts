import { randomUUID } from "node:crypto";
import { db } from "@nexus-form/database";
import { formStructure } from "@nexus-form/database/schema";
import { and, asc, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  FormStructure,
  type FormStructure as FormStructureType,
} from "../../types/domain/form";
import { FormStructureNotFoundError } from "../errors/form-errors";
import { logError } from "../logger";
import type { PaginatedResult, PaginationOptions } from "./pagination";
import { calculatePagination, validatePaginationOptions } from "./pagination";
import { parseStoredStructure } from "./parse-stored-structure";
import { generateStructureDiff } from "./structure-diff";

interface FormStructureHistory {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string;
  changeLog: string | null;
  isActive: boolean;
  parentVersion: number | null;
}

/**
 * フォーム構造を保存
 *
 * 入力は FormStructure スキーマで検証してから保存する。
 * 内部関数から直接呼ばれた場合のランタイム防御として再パースを行う。
 */
export async function saveFormStructure(
  formId: string,
  structure: FormStructureType,
  userId: string,
  changeLog?: string,
) {
  const parsed = FormStructure.safeParse(structure);
  if (!parsed.success) {
    throw new Error(
      `saveFormStructure: invalid structure: ${JSON.stringify(parsed.error.issues.slice(0, 5))}`,
    );
  }
  const validatedStructure = parsed.data;

  // 現在のバージョンを取得
  const currentVersion = await getCurrentStructureVersion(formId);
  const newVersion = currentVersion + 1;

  return await db.transaction(async (tx) => {
    try {
      // 既存の構造を非アクティブにする
      await tx
        .update(formStructure)
        .set({ isActive: false })
        .where(
          and(
            eq(formStructure.formId, formId),
            eq(formStructure.isActive, true),
          ),
        );

      // 新しい構造を保存
      await tx.insert(formStructure).values({
        id: randomUUID(),
        formId,
        structureJson: JSON.stringify(validatedStructure),
        version: newVersion,
        createdBy: userId,
        changeLog: changeLog || `Version ${newVersion} created`,
        parentVersion: currentVersion > 0 ? currentVersion : null,
      });

      // 作成した構造を取得
      const [newStructure] = await tx
        .select()
        .from(formStructure)
        .where(
          and(
            eq(formStructure.formId, formId),
            eq(formStructure.version, newVersion),
          ),
        )
        .limit(1);

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
    } catch (error) {
      // トランザクション内でエラーが発生した場合、自動的にロールバックされる
      logError("Transaction failed in saveFormStructure:", "api", {
        error: error,
      });
      throw new Error(
        `Failed to save form structure: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  });
}

/**
 * フォーム構造を取得（最新版）
 */
export async function getFormStructure(
  formId: string,
): Promise<FormStructureType> {
  const [structure] = await db
    .select()
    .from(formStructure)
    .where(
      and(eq(formStructure.formId, formId), eq(formStructure.isActive, true)),
    )
    .orderBy(desc(formStructure.version))
    .limit(1);

  if (!structure) {
    throw new FormStructureNotFoundError(formId);
  }

  return parseStoredStructure(structure.structureJson);
}

/**
 * フォーム構造を取得（特定バージョン）
 */
export async function getFormStructureByVersion(
  formId: string,
  version: number,
): Promise<FormStructureType> {
  const [structure] = await db
    .select()
    .from(formStructure)
    .where(
      and(eq(formStructure.formId, formId), eq(formStructure.version, version)),
    )
    .limit(1);

  if (!structure) {
    throw new Error(`Form structure version ${version} not found`);
  }

  return parseStoredStructure(structure.structureJson);
}

/**
 * フォーム構造の履歴を取得
 */
export async function getFormStructureHistory(
  formId: string,
  paginationOptions?: Partial<PaginationOptions>,
): Promise<PaginatedResult<FormStructureHistory>> {
  const options = validatePaginationOptions(paginationOptions || {});

  const skip = (options.page - 1) * options.limit;

  const orderByColumn =
    options.sortBy === "version"
      ? formStructure.version
      : formStructure.createdAt;
  const orderByFn = options.sortOrder === "asc" ? asc : desc;

  const [structures, totalResult] = await Promise.all([
    db
      .select({
        id: formStructure.id,
        version: formStructure.version,
        createdAt: formStructure.createdAt,
        createdBy: formStructure.createdBy,
        changeLog: formStructure.changeLog,
        isActive: formStructure.isActive,
        parentVersion: formStructure.parentVersion,
      })
      .from(formStructure)
      .where(eq(formStructure.formId, formId))
      .orderBy(orderByFn(orderByColumn))
      .offset(skip)
      .limit(options.limit),
    db
      .select({ count: count() })
      .from(formStructure)
      .where(eq(formStructure.formId, formId)),
  ]);

  const total = totalResult[0]?.count ?? 0;

  const formattedStructures = structures.map((structure) => ({
    id: structure.id,
    version: structure.version,
    createdAt: structure.createdAt.toISOString(),
    createdBy: structure.createdBy,
    changeLog: structure.changeLog,
    isActive: structure.isActive,
    parentVersion: structure.parentVersion,
  }));

  return {
    data: formattedStructures,
    pagination: calculatePagination(total, options.page, options.limit),
  };
}

/**
 * フォーム構造を復元（特定バージョンに戻す）
 */
export async function restoreFormStructure(
  formId: string,
  version: number,
  userId: string,
  changeLog?: string,
) {
  // 指定されたバージョンの存在確認と現在のバージョン取得を並列実行
  const [[targetStructure], currentVersion] = await Promise.all([
    db
      .select()
      .from(formStructure)
      .where(
        and(
          eq(formStructure.formId, formId),
          eq(formStructure.version, version),
        ),
      )
      .limit(1),
    getCurrentStructureVersion(formId),
  ]);

  if (!targetStructure) {
    throw new Error(`Form structure version ${version} not found`);
  }

  // 歴史的な正確性を保つため、raw structureJson をそのまま保存する。
  const newVersion = currentVersion + 1;
  const rawJson = targetStructure.structureJson;

  // Validate readability only — result discarded intentionally.
  parseStoredStructure(rawJson);

  return await db.transaction(async (tx) => {
    // 既存の構造を非アクティブにする
    await tx
      .update(formStructure)
      .set({ isActive: false })
      .where(
        and(eq(formStructure.formId, formId), eq(formStructure.isActive, true)),
      );

    // 指定されたバージョンの構造を新しいバージョンとして保存（raw データを維持）
    await tx.insert(formStructure).values({
      id: randomUUID(),
      formId,
      structureJson: rawJson,
      version: newVersion,
      createdBy: userId,
      changeLog: changeLog || `Restored from version ${version}`,
      parentVersion: version,
    });

    // 作成した構造を取得
    const [restoredStructure] = await tx
      .select()
      .from(formStructure)
      .where(
        and(
          eq(formStructure.formId, formId),
          eq(formStructure.version, newVersion),
        ),
      )
      .limit(1);

    if (!restoredStructure) {
      throw new Error("Failed to restore form structure");
    }

    return {
      id: restoredStructure.id,
      formId: restoredStructure.formId,
      version: restoredStructure.version,
      createdAt: restoredStructure.createdAt,
      changeLog: restoredStructure.changeLog,
      parentVersion: restoredStructure.parentVersion,
    };
  });
}

/**
 * フォーム構造を削除（特定バージョン）
 */
export async function deleteFormStructureVersion(
  formId: string,
  version: number,
  userId: string,
) {
  // 権限チェック（作成者のみ削除可能）
  const [structure] = await db
    .select()
    .from(formStructure)
    .where(
      and(eq(formStructure.formId, formId), eq(formStructure.version, version)),
    )
    .limit(1);

  if (!structure) {
    throw new Error(`Form structure version ${version} not found`);
  }

  if (structure.createdBy !== userId) {
    throw new Error("Only the creator can delete structure versions");
  }

  // アクティブな構造は削除できない
  if (structure.isActive) {
    throw new Error("Cannot delete active structure version");
  }

  await db.delete(formStructure).where(eq(formStructure.id, structure.id));

  return { success: true };
}

/**
 * 現在の構造バージョンを取得
 */
async function getCurrentStructureVersion(formId: string): Promise<number> {
  const [latestStructure] = await db
    .select({ version: formStructure.version })
    .from(formStructure)
    .where(eq(formStructure.formId, formId))
    .orderBy(desc(formStructure.version))
    .limit(1);

  return latestStructure?.version || 0;
}

/**
 * 指定されたバージョンが存在するかチェック
 */
export async function checkStructureVersionExists(
  formId: string,
  version: number,
): Promise<boolean> {
  const [structure] = await db
    .select({ id: formStructure.id })
    .from(formStructure)
    .where(
      and(eq(formStructure.formId, formId), eq(formStructure.version, version)),
    )
    .limit(1);

  return structure !== undefined;
}

/**
 * フォーム構造の差分を取得
 */
export async function getFormStructureDiff(
  formId: string,
  fromVersion: number,
  toVersion: number,
  options: {
    timeout?: number;
    maxMemoryMB?: number;
  } = {},
) {
  const { timeout = 30000, maxMemoryMB = 100 } = options;

  // メモリ使用量監視
  const initialMemory = process.memoryUsage().heapUsed;

  const diffCalculation = async () => {
    const [[fromStructureRow], [toStructureRow]] = await Promise.all([
      db
        .select()
        .from(formStructure)
        .where(
          and(
            eq(formStructure.formId, formId),
            eq(formStructure.version, fromVersion),
          ),
        )
        .limit(1),
      db
        .select()
        .from(formStructure)
        .where(
          and(
            eq(formStructure.formId, formId),
            eq(formStructure.version, toVersion),
          ),
        )
        .limit(1),
    ]);

    if (!fromStructureRow || !toStructureRow) {
      throw new Error("One or both structure versions not found");
    }

    // メモリ使用量チェック
    const currentMemory = process.memoryUsage().heapUsed;
    const memoryUsedMB = (currentMemory - initialMemory) / 1024 / 1024;

    if (memoryUsedMB > maxMemoryMB) {
      throw new Error(
        `Memory limit exceeded: ${memoryUsedMB.toFixed(2)}MB > ${maxMemoryMB}MB`,
      );
    }

    // diff は保存されたデータの実差分を見るため、transforms を適用しない。
    // safeParse を使い、古いバージョンのデータが想定外の形式でも明確なエラーメッセージを返す。
    const JsonRecord = z.record(z.string(), z.unknown());
    let fromRaw: unknown;
    let toRaw: unknown;
    try {
      fromRaw = JSON.parse(fromStructureRow.structureJson);
    } catch {
      throw new Error(
        `getFormStructureDiff: version ${fromVersion} contains invalid JSON`,
      );
    }
    try {
      toRaw = JSON.parse(toStructureRow.structureJson);
    } catch {
      throw new Error(
        `getFormStructureDiff: version ${toVersion} contains invalid JSON`,
      );
    }
    const fromResult = JsonRecord.safeParse(fromRaw);
    if (!fromResult.success) {
      throw new Error(
        `getFormStructureDiff: version ${fromVersion} is not a valid object`,
      );
    }
    const toResult = JsonRecord.safeParse(toRaw);
    if (!toResult.success) {
      throw new Error(
        `getFormStructureDiff: version ${toVersion} is not a valid object`,
      );
    }
    const fromData = fromResult.data;
    const toData = toResult.data;

    const result = {
      fromVersion,
      toVersion,
      changes: generateStructureDiff(fromData, toData),
      metadata: {
        memoryUsedMB: Number(memoryUsedMB.toFixed(2)),
        calculationTime: Date.now(),
      },
    };

    // 最終的なメモリ使用量チェック
    const finalMemory = process.memoryUsage().heapUsed;
    const finalMemoryUsedMB = (finalMemory - initialMemory) / 1024 / 1024;

    if (finalMemoryUsedMB > maxMemoryMB) {
      throw new Error(
        `Memory limit exceeded during diff calculation: ${finalMemoryUsedMB.toFixed(2)}MB > ${maxMemoryMB}MB`,
      );
    }

    result.metadata.memoryUsedMB = Number(finalMemoryUsedMB.toFixed(2));

    return result;
  };

  // タイムアウト処理を追加
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Diff calculation timeout after ${timeout}ms`));
    }, timeout);
  });

  try {
    const result = await Promise.race([diffCalculation(), timeoutPromise]);

    // ガベージコレクションの提案（メモリ使用量が多い場合）
    if (result.metadata.memoryUsedMB > maxMemoryMB * 0.8) {
      if (global.gc) {
        global.gc();
      }
    }

    return result;
  } catch (error) {
    // エラー時にもガベージコレクションを実行
    if (global.gc) {
      global.gc();
    }
    throw error;
  }
}

/**
 * フォーム構造の統計情報を取得
 */
export async function getFormStructureStats(formId: string) {
  const [totalResult, activeVersionRow, oldestVersionRow] = await Promise.all([
    db
      .select({ count: count() })
      .from(formStructure)
      .where(eq(formStructure.formId, formId)),
    db
      .select({ version: formStructure.version })
      .from(formStructure)
      .where(
        and(eq(formStructure.formId, formId), eq(formStructure.isActive, true)),
      )
      .limit(1),
    db
      .select({
        version: formStructure.version,
        createdAt: formStructure.createdAt,
      })
      .from(formStructure)
      .where(eq(formStructure.formId, formId))
      .orderBy(asc(formStructure.version))
      .limit(1),
  ]);

  const totalVersions = totalResult[0]?.count ?? 0;

  return {
    totalVersions,
    activeVersion: activeVersionRow[0]?.version || 0,
    oldestVersion: oldestVersionRow[0]?.version || 0,
    createdAt: oldestVersionRow[0]?.createdAt,
  };
}
