import type { db } from "@nexus-form/database";

/**
 * Drizzleトランザクションクライアントの型エイリアス
 */
export type TransactionClient = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

/**
 * 回答データのバリデーション結果
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * ソート可能なフィールド
 */
export type SortableField = "submitted_at" | "updated_at";

/**
 * ソート順序
 */
export type SortOrder = "asc" | "desc";

/**
 * フィンガープリントデータの型
 */
export interface FingerprintData {
  fingerprintType: string;
  fingerprintValueHash: string;
  collectedAt: Date;
}

/**
 * 回答一覧取得のクエリパラメータ
 */
export interface GetResponsesQuery {
  page: number;
  limit: number;
  sort: SortableField;
  order: SortOrder;
  includeFingerprints?: boolean;
}
