/**
 * データ保持期間管理サービス
 * フィンガープリントデータの保持期間を管理し、期限切れデータを自動削除
 */

import { db } from "@nexus-form/database";
import { fingerprintDetail, formResponse } from "@nexus-form/database/schema";
import { and, count, eq, inArray, lt, or } from "drizzle-orm";
import { logError } from "../logger";

export interface DataRetentionConfig {
  fingerprintDetailRetentionDays: number; // フィンガープリント詳細の保持期間（日）
  responseRetentionDays?: number; // レスポンスの保持期間（日、オプション）
  autoCleanupEnabled: boolean; // 自動クリーンアップの有効/無効
  cleanupSchedule: string; // クリーンアップのスケジュール（cron形式）
}

export interface DataRetentionStats {
  totalFingerprintDetails: number;
  expiredFingerprintDetails: number;
  totalResponses: number;
  expiredResponses: number;
  lastCleanupDate: Date | null;
  nextCleanupDate: Date | null;
}

export interface CleanupResult {
  deletedFingerprintDetails: number;
  deletedResponses: number;
  totalDeleted: number;
  errors: string[];
  cleanupDate: Date;
}

export class DataRetentionManager {
  private static instance: DataRetentionManager;
  private config: DataRetentionConfig;

  private constructor(config: Partial<DataRetentionConfig> = {}) {
    this.config = {
      fingerprintDetailRetentionDays: 30, // デフォルト30日
      responseRetentionDays: 365, // デフォルト1年
      autoCleanupEnabled: true,
      cleanupSchedule: "0 2 * * *", // 毎日午前2時
      ...config,
    };
  }

  public static getInstance(
    config?: Partial<DataRetentionConfig>,
  ): DataRetentionManager {
    if (!DataRetentionManager.instance) {
      DataRetentionManager.instance = new DataRetentionManager(config);
    }
    return DataRetentionManager.instance;
  }

  /**
   * 設定を更新
   */
  updateConfig(newConfig: Partial<DataRetentionConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 現在の設定を取得
   */
  getConfig(): DataRetentionConfig {
    return { ...this.config };
  }

  /**
   * 期限切れデータの統計を取得
   */
  async getDataRetentionStats(): Promise<DataRetentionStats> {
    try {
      const now = new Date();
      const fingerprintDetailExpiryDate = new Date(
        now.getTime() -
          this.config.fingerprintDetailRetentionDays * 24 * 60 * 60 * 1000,
      );
      const responseExpiryDate = this.config.responseRetentionDays
        ? new Date(
            now.getTime() -
              this.config.responseRetentionDays * 24 * 60 * 60 * 1000,
          )
        : null;

      // フィンガープリント詳細の統計
      const totalFpResult = await db
        .select({ value: count() })
        .from(fingerprintDetail);
      const totalFingerprintDetails = totalFpResult[0]?.value ?? 0;

      const expiredFpResult = await db
        .select({ value: count() })
        .from(fingerprintDetail)
        .where(
          or(
            lt(fingerprintDetail.expiresAt, now),
            lt(fingerprintDetail.collectedAt, fingerprintDetailExpiryDate),
          ),
        );
      const expiredFingerprintDetails = expiredFpResult[0]?.value ?? 0;

      // レスポンスの統計
      const totalRespResult = await db
        .select({ value: count() })
        .from(formResponse);
      const totalResponses = totalRespResult[0]?.value ?? 0;

      let expiredResponses = 0;
      if (responseExpiryDate) {
        const expiredRespResult = await db
          .select({ value: count() })
          .from(formResponse)
          .where(lt(formResponse.submittedAt, responseExpiryDate));
        expiredResponses = expiredRespResult[0]?.value ?? 0;
      }

      // クリーンアップ履歴テーブル（cleanup_history）がスキーマに追加されたら
      // そのテーブルから最終実行日時を取得する
      const lastCleanupDate = null;
      const nextCleanupDate = this.calculateNextCleanupDate();

      return {
        totalFingerprintDetails,
        expiredFingerprintDetails,
        totalResponses,
        expiredResponses,
        lastCleanupDate,
        nextCleanupDate,
      };
    } catch (error) {
      logError("Failed to get data retention stats:", "database", {
        error: error,
      });
      throw new Error("データ保持期間統計の取得に失敗しました");
    }
  }

  /**
   * 期限切れデータをクリーンアップ
   */
  async cleanupExpiredData(): Promise<CleanupResult> {
    const errors: string[] = [];
    let deletedFingerprintDetails = 0;
    let deletedResponses = 0;

    try {
      const now = new Date();
      const fingerprintDetailExpiryDate = new Date(
        now.getTime() -
          this.config.fingerprintDetailRetentionDays * 24 * 60 * 60 * 1000,
      );
      const responseExpiryDate = this.config.responseRetentionDays
        ? new Date(
            now.getTime() -
              this.config.responseRetentionDays * 24 * 60 * 60 * 1000,
          )
        : null;

      // トランザクションでクリーンアップを実行
      await db.transaction(async (tx) => {
        // 1. 期限切れのフィンガープリント詳細を削除
        try {
          const deletedDetails = await tx
            .delete(fingerprintDetail)
            .where(
              or(
                lt(fingerprintDetail.expiresAt, now),
                lt(fingerprintDetail.collectedAt, fingerprintDetailExpiryDate),
              ),
            );
          deletedFingerprintDetails = deletedDetails[0]?.affectedRows ?? 0;
        } catch (error) {
          const errorMessage = `Failed to delete expired fingerprint details: ${error}`;
          logError(errorMessage, "database", {});
          errors.push(errorMessage);
        }

        // 2. 期限切れのレスポンスを削除（オプション）
        if (responseExpiryDate) {
          try {
            const deletedResponsesResult = await tx
              .delete(formResponse)
              .where(lt(formResponse.submittedAt, responseExpiryDate));
            deletedResponses = deletedResponsesResult[0]?.affectedRows ?? 0;
          } catch (error) {
            const errorMessage = `Failed to delete expired responses: ${error}`;
            logError(errorMessage, "database", {});
            errors.push(errorMessage);
          }
        }
      });

      const totalDeleted = deletedFingerprintDetails + deletedResponses;

      return {
        deletedFingerprintDetails,
        deletedResponses,
        totalDeleted,
        errors,
        cleanupDate: now,
      };
    } catch (error) {
      const errorMessage = `Failed to cleanup expired data: ${error}`;
      logError(errorMessage, "database", {});
      errors.push(errorMessage);

      return {
        deletedFingerprintDetails,
        deletedResponses,
        totalDeleted: 0,
        errors,
        cleanupDate: new Date(),
      };
    }
  }

  /**
   * 特定のフォームの期限切れデータをクリーンアップ
   */
  async cleanupExpiredDataForForm(formId: string): Promise<CleanupResult> {
    const errors: string[] = [];
    let deletedFingerprintDetails = 0;
    const deletedResponses = 0;

    try {
      const now = new Date();
      const fingerprintDetailExpiryDate = new Date(
        now.getTime() -
          this.config.fingerprintDetailRetentionDays * 24 * 60 * 60 * 1000,
      );

      await db.transaction(async (tx) => {
        // フォームに関連するレスポンスを取得
        const responses = await tx
          .select({ id: formResponse.id })
          .from(formResponse)
          .where(eq(formResponse.formId, formId));
        const responseIds = responses.map((r) => r.id);

        if (responseIds.length === 0) {
          return;
        }

        // 期限切れのフィンガープリント詳細を削除
        try {
          const deletedDetails = await tx
            .delete(fingerprintDetail)
            .where(
              and(
                inArray(fingerprintDetail.responseId, responseIds),
                or(
                  lt(fingerprintDetail.expiresAt, now),
                  lt(
                    fingerprintDetail.collectedAt,
                    fingerprintDetailExpiryDate,
                  ),
                ),
              ),
            );
          deletedFingerprintDetails = deletedDetails[0]?.affectedRows ?? 0;
        } catch (error) {
          const errorMessage = `Failed to delete expired fingerprint details for form ${formId}: ${error}`;
          logError(errorMessage, "database", {});
          errors.push(errorMessage);
        }
      });

      const totalDeleted = deletedFingerprintDetails + deletedResponses;

      return {
        deletedFingerprintDetails,
        deletedResponses,
        totalDeleted,
        errors,
        cleanupDate: now,
      };
    } catch (error) {
      const errorMessage = `Failed to cleanup expired data for form ${formId}: ${error}`;
      logError(errorMessage, "database", {});
      errors.push(errorMessage);

      return {
        deletedFingerprintDetails,
        deletedResponses,
        totalDeleted: 0,
        errors,
        cleanupDate: new Date(),
      };
    }
  }

  /**
   * 次のクリーンアップ日時を計算
   */
  private calculateNextCleanupDate(): Date {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(2, 0, 0, 0); // 午前2時
    return tomorrow;
  }

  /**
   * データ保持期間の設定を検証
   */
  validateConfig(config: Partial<DataRetentionConfig>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (config.fingerprintDetailRetentionDays !== undefined) {
      if (config.fingerprintDetailRetentionDays < 1) {
        errors.push(
          "フィンガープリント詳細保持期間は1日以上である必要があります",
        );
      }
      if (config.fingerprintDetailRetentionDays > 365) {
        errors.push(
          "フィンガープリント詳細保持期間は365日以下である必要があります",
        );
      }
    }

    if (config.responseRetentionDays !== undefined) {
      if (config.responseRetentionDays < 1) {
        errors.push("レスポンス保持期間は1日以上である必要があります");
      }
      if (config.responseRetentionDays > 3650) {
        errors.push("レスポンス保持期間は3650日以下である必要があります");
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// シングルトンインスタンスを取得する関数
export function getDataRetentionManager(
  config?: Partial<DataRetentionConfig>,
): DataRetentionManager {
  return DataRetentionManager.getInstance(config);
}
