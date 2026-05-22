import { z } from "zod";
import type {
  CleanupResult,
  DataRetentionConfig,
  DataRetentionStats,
} from "@/lib/fingerprint/data-retention";

export const retentionQueryKey = ["fingerprint", "retention"] as const;

export const dataRetentionStatsSchema = z.object({
  totalFingerprints: z.number(),
  expiredFingerprints: z.number(),
  totalFingerprintDetails: z.number(),
  expiredFingerprintDetails: z.number(),
  totalResponses: z.number(),
  expiredResponses: z.number(),
  lastCleanupDate: z.coerce.date().nullable(),
  nextCleanupDate: z.coerce.date().nullable(),
});

export const dataRetentionConfigSchema = z.object({
  fingerprintRetentionDays: z.number(),
  fingerprintDetailRetentionDays: z.number(),
  responseRetentionDays: z.number().optional(),
  autoCleanupEnabled: z.boolean(),
  cleanupSchedule: z.string(),
});

export const retentionGetResponseSchema = z.object({
  config: dataRetentionConfigSchema,
  stats: dataRetentionStatsSchema,
});

export const configUpdateResponseSchema = z.object({
  config: dataRetentionConfigSchema.optional(),
  error: z.string().optional(),
  details: z.array(z.string()).optional(),
});

const cleanupResultSchema = z.object({
  deletedFingerprints: z.number(),
  deletedFingerprintDetails: z.number(),
  deletedResponses: z.number(),
  totalDeleted: z.number(),
  errors: z.array(z.string()),
  cleanupDate: z.coerce.date(),
});

export const cleanupResponseSchema = z.object({
  result: cleanupResultSchema,
});

export type ActionFeedback = {
  type: "success" | "error";
  message: string;
};

export interface DataRetentionManagerState {
  actionFeedback: ActionFeedback | null;
  cleanupLoading: boolean;
  cleanupResult: CleanupResult | null;
  formConfig: Partial<DataRetentionConfig> | null;
  configLoading: boolean;
}

export type DataRetentionManagerAction =
  | { type: "update-form-config"; config: Partial<DataRetentionConfig> }
  | { type: "cleanup-start" }
  | { type: "cleanup-success"; result: CleanupResult }
  | { type: "cleanup-error"; message: string }
  | { type: "config-start" }
  | { type: "config-success"; config: DataRetentionConfig }
  | { type: "config-error"; message: string };

export const initialDataRetentionState: DataRetentionManagerState = {
  actionFeedback: null,
  cleanupLoading: false,
  cleanupResult: null,
  formConfig: null,
  configLoading: false,
};

export function dataRetentionManagerReducer(
  state: DataRetentionManagerState,
  action: DataRetentionManagerAction,
): DataRetentionManagerState {
  switch (action.type) {
    case "update-form-config":
      return { ...state, formConfig: action.config };
    case "cleanup-start":
      return { ...state, cleanupLoading: true, actionFeedback: null };
    case "cleanup-success":
      return {
        ...state,
        cleanupLoading: false,
        cleanupResult: action.result,
        actionFeedback: {
          type: "success",
          message: "クリーンアップが完了しました",
        },
      };
    case "cleanup-error":
      return {
        ...state,
        cleanupLoading: false,
        cleanupResult: null,
        actionFeedback: { type: "error", message: action.message },
      };
    case "config-start":
      return { ...state, configLoading: true, actionFeedback: null };
    case "config-success":
      return {
        ...state,
        configLoading: false,
        formConfig: action.config,
        actionFeedback: { type: "success", message: "設定を更新しました" },
      };
    case "config-error":
      return {
        ...state,
        configLoading: false,
        actionFeedback: { type: "error", message: action.message },
      };
  }
}

export interface RetentionQueryData {
  stats: DataRetentionStats;
  config: DataRetentionConfig;
}
