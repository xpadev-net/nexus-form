/**
 * フィンガープリント収集に関する型定義
 */

// FingerprintJS の結果型
export interface FingerprintJSResult {
  visitorId: string;
  confidence: number;
  components: {
    [key: string]: {
      value: string | number | boolean | string[];
      duration: number;
    };
  };
}

interface componentInterface {
  [key: string]: string | string[] | number | boolean | componentInterface;
}
// ThumbmarkJS の結果型
export interface ThumbmarkJSResult {
  fingerprint: string;
  components: componentInterface;
}

// 統合されたフィンガープリント結果
export interface FingerprintResult {
  fingerprintjs: FingerprintJSResult;
  thumbmarkjs: ThumbmarkJSResult;
  collectedAt: Date;
  userAgent: string;
  ipAddress?: string;
}

// フィンガープリントコンポーネントの詳細情報
export interface FingerprintComponent {
  name: string;
  value: string;
  valueHash: string;
  confidence?: number;
  duration?: number;
  fingerprintType: "fingerprintjs" | "thumbmarkjs";
}

// フィンガープリント収集の設定
export interface FingerprintConfig {
  enableFingerprintJS: boolean;
  enableThumbmarkJS: boolean;
  collectComponents: boolean;
  hashAlgorithm: "sha256" | "sha512";
}

// フィンガープリント保存用のリクエスト型
export interface SaveFingerprintRequest {
  responseId: string;
  fingerprint: FingerprintResult;
  components: FingerprintComponent[];
}

// フィンガープリント保存用のレスポンス型
export interface SaveFingerprintResponse {
  success: boolean;
  fingerprintId?: string;
  error?: string;
}

// フィンガープリント管理用の型
export interface FingerprintStats {
  totalFingerprints: number;
  totalComponents: number;
  fingerprintTypes: Array<{
    type: string;
    count: number;
  }>;
  componentTypes: Array<{
    type: string;
    count: number;
  }>;
}

// フィンガープリント管理レスポンスの型
export interface FingerprintManageResponse {
  success: boolean;
  data?: {
    fingerprints: Array<{
      id: string;
      responseId: string;
      fingerprintType: string;
      fingerprintValueHash: string;
      collectedAt: Date;
      response: {
        id: string;
        formId: string;
        submittedAt: Date;
        respondentUuid: string;
      };
      fingerprintDetails: Array<{
        id: string;
        fingerprintType: string;
        componentName: string;
        componentValue: string;
        componentValueHash: string;
        confidence: number | null;
        collectedAt: Date;
      }>;
    }>;
    stats?: FingerprintStats;
    summary: {
      count: number;
      lastCollected: Date | null;
    };
  };
  error?: string;
}

// 匿名化フィンガープリント表示用の型
export interface AnonymizedFingerprintDisplayResponse {
  success: boolean;
  data?: {
    fingerprints: Array<{
      id: string;
      responseId: string;
      fingerprintType: string;
      anonymizedId: string;
      isDuplicate: boolean;
      duplicateCount: number;
      collectedAt: Date;
      response: {
        id: string;
        formId: string;
        submittedAt: Date;
        respondentUuid: string;
      };
    }>;
    stats?: {
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
    };
  };
  error?: string;
}

// データ保持期間管理用の型（簡素化）
export interface DataRetentionResponse {
  success: boolean;
  data?: {
    stats: {
      totalFingerprintDetails: number;
      expiredFingerprintDetails: number;
      totalResponses: number;
      expiredResponses: number;
      lastCleanupDate: Date | null;
      nextCleanupDate: Date | null;
    };
    config: {
      fingerprintDetailRetentionDays: number;
      responseRetentionDays?: number;
      autoCleanupEnabled: boolean;
      cleanupSchedule: string;
    };
  };
  error?: string;
}

// データクリーンアップ結果の型（簡素化）
export interface DataCleanupResponse {
  success: boolean;
  data?: {
    deletedFingerprintDetails: number;
    deletedResponses: number;
    totalDeleted: number;
    errors: string[];
    cleanupDate: Date;
  };
  error?: string;
}

// エクスポート用のコンポーネント列の型
export interface ComponentColumn {
  block_id: string;
  block_type: string;
  value: unknown;
}

// 疑似ID化されたフィンガープリントの型
export interface PseudonymousFingerprint {
  component_name: string;
  pseudonymous_id: string;
}

// 新しいエクスポート仕様のレスポンス型
export interface ExportResponseData {
  metadata: {
    id: string;
    form_id: string;
    respondent_uuid: string;
    submitted_at: string;
    updated_at?: string;
    ip_address_hash?: string;
    user_agent?: string;
  };
  responses: Array<{
    question_id: string;
    question_type: string;
    value: unknown;
  }>;
  component_columns: ComponentColumn[];
  fingerprints: never[]; // 指紋の生データ/ハッシュ列は出さない
  pseudonymous_ids: PseudonymousFingerprint[];
}
