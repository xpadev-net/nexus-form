/**
 * フィンガープリント匿名化サービス
 * ユーザーに提示する際、フィンガープリントを完全に別のUUIDや連番に置き換え
 * 同一ユーザーであると判定されたか否かのみがわかるようにする
 */

import { randomUUID } from "node:crypto";
import { db } from "@nexus-form/database";
import { fingerprintDetail, formResponse } from "@nexus-form/database/schema";
import { and, count, eq } from "drizzle-orm";
import { logError } from "../logger";

export interface AnonymizedFingerprint {
  id: string;
  responseId: string;
  fingerprintType: string;
  anonymizedId: string; // UUIDまたは連番で置き換えられたID
  isDuplicate: boolean;
  duplicateCount: number;
  collectedAt: Date;
  response: {
    id: string;
    formId: string;
    submittedAt: Date;
    respondentUuid: string;
  };
}

export interface AnonymizedFingerprintStats {
  totalFingerprints: number;
  uniqueFingerprints: number;
  duplicateFingerprints: number;
  duplicateRate: number;
  fingerprintTypes: Array<{
    type: string;
    count: number;
    uniqueCount: number;
    duplicateCount: number;
  }>;
}

export class FingerprintAnonymizer {
  private static instance: FingerprintAnonymizer;
  private anonymizedIdMap: Map<string, string> = new Map();

  private constructor() {}

  public static getInstance(): FingerprintAnonymizer {
    if (!FingerprintAnonymizer.instance) {
      FingerprintAnonymizer.instance = new FingerprintAnonymizer();
    }
    return FingerprintAnonymizer.instance;
  }

  /**
   * フィンガープリントハッシュを匿名化IDに変換
   */
  private anonymizeFingerprintHash(fingerprintHash: string): string {
    const existingId = this.anonymizedIdMap.get(fingerprintHash);
    if (existingId) {
      return existingId;
    }

    // UUIDベースの匿名化IDを生成
    const anonymizedId = randomUUID();
    this.anonymizedIdMap.set(fingerprintHash, anonymizedId);
    return anonymizedId;
  }

  /**
   * フィンガープリントを匿名化して取得
   */
  async getAnonymizedFingerprints(
    responseId?: string,
    formId?: string,
    includeStats: boolean = false,
  ): Promise<{
    fingerprints: AnonymizedFingerprint[];
    stats?: AnonymizedFingerprintStats;
  }> {
    try {
      // フィンガープリントを取得（responseとjoin）
      const conditions = responseId
        ? [eq(fingerprintDetail.responseId, responseId)]
        : formId
          ? [eq(formResponse.formId, formId)]
          : [];

      const rows = await db
        .select({
          id: fingerprintDetail.id,
          responseId: fingerprintDetail.responseId,
          fingerprintType: fingerprintDetail.fingerprintType,
          componentValueHash: fingerprintDetail.componentValueHash,
          collectedAt: fingerprintDetail.collectedAt,
          respId: formResponse.id,
          respFormId: formResponse.formId,
          respSubmittedAt: formResponse.submittedAt,
          respRespondentUuid: formResponse.respondentUuid,
        })
        .from(fingerprintDetail)
        .innerJoin(
          formResponse,
          eq(fingerprintDetail.responseId, formResponse.id),
        )
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(fingerprintDetail.collectedAt);

      // 重複チェック用のマップ
      const fingerprintHashMap = new Map<string, number>();
      const duplicateMap = new Map<string, boolean>();

      // フィンガープリントハッシュの重複をチェック
      for (const row of rows) {
        const hash = row.componentValueHash;
        const currentCount = fingerprintHashMap.get(hash) || 0;
        fingerprintHashMap.set(hash, currentCount + 1);
        duplicateMap.set(hash, currentCount > 0);
      }

      // 匿名化されたフィンガープリントを生成
      const anonymizedFingerprints: AnonymizedFingerprint[] = rows.map(
        (row) => {
          const hash = row.componentValueHash;
          const duplicateCount = fingerprintHashMap.get(hash) || 0;
          const isDuplicate = duplicateMap.get(hash) || false;

          return {
            id: row.id,
            responseId: row.responseId,
            fingerprintType: row.fingerprintType,
            anonymizedId: this.anonymizeFingerprintHash(hash),
            isDuplicate,
            duplicateCount,
            collectedAt: row.collectedAt,
            response: {
              id: row.respId,
              formId: row.respFormId,
              submittedAt: row.respSubmittedAt,
              respondentUuid: row.respRespondentUuid,
            },
          };
        },
      );

      let stats: AnonymizedFingerprintStats | undefined;

      if (includeStats) {
        const totalFingerprints = rows.length;
        const uniqueHashes = new Set(rows.map((r) => r.componentValueHash));
        const uniqueFingerprints = uniqueHashes.size;
        const duplicateFingerprints = totalFingerprints - uniqueFingerprints;
        const duplicateRate =
          totalFingerprints > 0 ? duplicateFingerprints / totalFingerprints : 0;

        // フィンガープリントタイプ別統計
        const typeStats = new Map<
          string,
          { count: number; uniqueHashes: Set<string> }
        >();
        for (const row of rows) {
          const type = row.fingerprintType;
          if (!typeStats.has(type)) {
            typeStats.set(type, { count: 0, uniqueHashes: new Set() });
          }
          const typeStat = typeStats.get(type);
          if (typeStat) {
            typeStat.count++;
            typeStat.uniqueHashes.add(row.componentValueHash);
          }
        }

        const fingerprintTypes = Array.from(typeStats.entries()).map(
          ([type, stat]) => ({
            type,
            count: stat.count,
            uniqueCount: stat.uniqueHashes.size,
            duplicateCount: stat.count - stat.uniqueHashes.size,
          }),
        );

        stats = {
          totalFingerprints,
          uniqueFingerprints,
          duplicateFingerprints,
          duplicateRate,
          fingerprintTypes,
        };
      }

      return {
        fingerprints: anonymizedFingerprints,
        stats,
      };
    } catch (error) {
      logError("Failed to get anonymized fingerprints:", "database", {
        error: error,
      });
      throw new Error("フィンガープリントの匿名化に失敗しました");
    }
  }

  /**
   * 特定のフィンガープリントの匿名化情報を取得
   */
  async getAnonymizedFingerprintById(
    fingerprintId: string,
  ): Promise<AnonymizedFingerprint | null> {
    try {
      const rows = await db
        .select({
          id: fingerprintDetail.id,
          responseId: fingerprintDetail.responseId,
          fingerprintType: fingerprintDetail.fingerprintType,
          componentValueHash: fingerprintDetail.componentValueHash,
          collectedAt: fingerprintDetail.collectedAt,
          respId: formResponse.id,
          respFormId: formResponse.formId,
          respSubmittedAt: formResponse.submittedAt,
          respRespondentUuid: formResponse.respondentUuid,
        })
        .from(fingerprintDetail)
        .innerJoin(
          formResponse,
          eq(fingerprintDetail.responseId, formResponse.id),
        )
        .where(eq(fingerprintDetail.id, fingerprintId))
        .limit(1);

      const row = rows[0];
      if (!row) {
        return null;
      }

      // 同じハッシュを持つフィンガープリントの数を取得
      const countResult = await db
        .select({ value: count() })
        .from(fingerprintDetail)
        .where(
          eq(fingerprintDetail.componentValueHash, row.componentValueHash),
        );

      const duplicateCount = countResult[0]?.value ?? 0;

      return {
        id: row.id,
        responseId: row.responseId,
        fingerprintType: row.fingerprintType,
        anonymizedId: this.anonymizeFingerprintHash(row.componentValueHash),
        isDuplicate: duplicateCount > 1,
        duplicateCount,
        collectedAt: row.collectedAt,
        response: {
          id: row.respId,
          formId: row.respFormId,
          submittedAt: row.respSubmittedAt,
          respondentUuid: row.respRespondentUuid,
        },
      };
    } catch (error) {
      logError("Failed to get anonymized fingerprint by ID:", "database", {
        error: error,
      });
      throw new Error("フィンガープリントの匿名化情報取得に失敗しました");
    }
  }

  /**
   * 匿名化マップをリセット（テスト用）
   */
  resetAnonymizationMap(): void {
    this.anonymizedIdMap.clear();
  }

  /**
   * 匿名化マップのサイズを取得
   */
  getAnonymizationMapSize(): number {
    return this.anonymizedIdMap.size;
  }
}

// シングルトンインスタンスを取得する関数
export function getFingerprintAnonymizer(): FingerprintAnonymizer {
  return FingerprintAnonymizer.getInstance();
}
