/**
 * 共有型定義
 * 複数のドメインで使用される共通の型定義
 */

import type { FormStatus } from "./form";

// 質問の基本型（循環依存を避けるため、最小限の定義）
export interface BaseQuestion {
  id: string;
  type:
    | "short_text"
    | "long_text"
    | "radio"
    | "checkbox"
    | "dropdown"
    | "linear_scale"
    | "rating"
    | "choice_grid"
    | "checkbox_grid"
    | "date"
    | "time";
  title: string;
  description?: string;
  required: boolean;
  order: number;
}

// フォーム設定
export interface FormSettings {
  allowEditResponses: boolean;
  collectFingerprints: boolean; // 常にtrue（固定値）
  privacyNotice: string;
  duplicateDetection: {
    enabled: boolean; // 常にtrue（固定値）
    sensitivity: "low" | "medium" | "high"; // 常に"medium"（固定値）
  };
  responseLimit?: {
    enabled: boolean;
    maxResponses?: number;
    message?: string;
  };
  schedule?: {
    publishAt?: string;
    unpublishAt?: string;
    timezone?: string;
  };
}

// フォーム構造
export interface FormStructure {
  version: string;
  settings: FormSettings;
}

// フォームメタデータ
export interface FormMetadata {
  id: string;
  title: string;
  description?: string;
  creatorId: string;
  status: FormStatus;
  publishedAt?: string;
  unpublishedAt?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
