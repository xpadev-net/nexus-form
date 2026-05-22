/**
 * データ保持期間管理コンポーネント
 * フィンガープリントデータの保持期間を管理し、期限切れデータを自動削除
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useReducer } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { client } from "@/lib/api";
import type { DataRetentionConfig } from "@/lib/fingerprint/data-retention";
import { logError } from "@/lib/logger";
import { cn } from "@/lib/utils";
import {
  cleanupResponseSchema,
  configUpdateResponseSchema,
  dataRetentionManagerReducer,
  initialDataRetentionState,
  type RetentionQueryData,
  retentionGetResponseSchema,
  retentionQueryKey,
} from "./data-retention-manager/model";
import {
  ActionFeedbackAlert,
  CleanupActionsCard,
  CleanupResultAlert,
  RetentionConfigCard,
  RetentionStatsCard,
} from "./data-retention-manager/sections";

interface DataRetentionManagerProps {
  className?: string;
}

export function DataRetentionManager({ className }: DataRetentionManagerProps) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(
    dataRetentionManagerReducer,
    initialDataRetentionState,
  );

  const {
    data: retentionData,
    error: fetchError,
    isLoading: loading,
    refetch: refetchRetentionData,
    isRefetching: isRefetchingStats,
  } = useQuery<RetentionQueryData>({
    queryKey: retentionQueryKey,
    queryFn: async () => {
      const response = await client.api.fingerprint.retention.$get();
      if (!response.ok) {
        throw new Error(
          `データ保持期間情報の取得に失敗しました: HTTP ${response.status}`,
        );
      }
      const json: unknown = await response.json();
      return retentionGetResponseSchema.parse(json);
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const stats = retentionData?.stats || null;
  const config = retentionData?.config || null;
  const formConfig = state.formConfig ?? config ?? {};

  const handleCleanup = async () => {
    try {
      dispatch({ type: "cleanup-start" });

      const response = await client.api.fingerprint.retention.$put();
      if (!response.ok) {
        throw new Error(
          `クリーンアップに失敗しました: HTTP ${response.status}`,
        );
      }

      const json: unknown = await response.json();
      const result = cleanupResponseSchema.parse(json).result;
      dispatch({ type: "cleanup-success", result });

      queryClient.setQueryData<RetentionQueryData>(
        retentionQueryKey,
        (currentData) => {
          if (!currentData) return currentData;
          return {
            ...currentData,
            stats: {
              ...currentData.stats,
              totalFingerprintDetails: Math.max(
                0,
                currentData.stats.totalFingerprintDetails -
                  result.deletedFingerprintDetails,
              ),
              expiredFingerprintDetails: Math.max(
                0,
                currentData.stats.expiredFingerprintDetails -
                  result.deletedFingerprintDetails,
              ),
              totalResponses: Math.max(
                0,
                currentData.stats.totalResponses - result.deletedResponses,
              ),
              expiredResponses: Math.max(
                0,
                currentData.stats.expiredResponses - result.deletedResponses,
              ),
              lastCleanupDate: result.cleanupDate,
            },
          };
        },
      );
    } catch (err) {
      logError("Failed to cleanup expired data:", "ui", { error: err });
      dispatch({
        type: "cleanup-error",
        message:
          err instanceof Error
            ? `クリーンアップに失敗しました: ${err.message}`
            : "クリーンアップに失敗しました: 不明なエラーが発生しました",
      });
    }
  };

  const handleConfigUpdate = async () => {
    try {
      dispatch({ type: "config-start" });

      const response = await client.api.fingerprint.retention.$post({
        json: {
          fingerprintDetailRetentionDays:
            formConfig.fingerprintDetailRetentionDays,
          responseRetentionDays: formConfig.responseRetentionDays,
          autoCleanupEnabled: formConfig.autoCleanupEnabled,
          cleanupSchedule: formConfig.cleanupSchedule,
        },
      });

      if (!response.ok) {
        const errorJson: unknown = await response.json();
        const errorParsed = configUpdateResponseSchema.parse(errorJson);
        throw new Error(errorParsed.error || "設定の更新に失敗しました");
      }

      const json: unknown = await response.json();
      const parsed = configUpdateResponseSchema.parse(json);
      if (!parsed.config) {
        throw new Error("設定の更新に失敗しました: 設定データが不足しています");
      }
      const updatedConfig: DataRetentionConfig = parsed.config;

      queryClient.setQueryData<RetentionQueryData>(
        retentionQueryKey,
        (currentData) => {
          if (!currentData) return currentData;
          return { ...currentData, config: updatedConfig };
        },
      );

      dispatch({ type: "config-success", config: updatedConfig });
    } catch (err) {
      logError("Failed to update configuration:", "ui", { error: err });
      dispatch({
        type: "config-error",
        message:
          err instanceof Error
            ? `設定の更新に失敗しました: ${err.message}`
            : "設定の更新に失敗しました: 不明なエラーが発生しました",
      });
    }
  };

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center p-8", className)}>
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">データ保持期間情報を読み込み中...</span>
      </div>
    );
  }

  if (fetchError) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          データ保持期間情報の取得に失敗しました: {fetchError.message}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className={cn("space-y-6", className)}>
      {stats && <RetentionStatsCard stats={stats} />}
      {state.cleanupResult && (
        <CleanupResultAlert cleanupResult={state.cleanupResult} />
      )}
      {state.actionFeedback && (
        <ActionFeedbackAlert feedback={state.actionFeedback} />
      )}
      {config && (
        <RetentionConfigCard
          config={config}
          configLoading={state.configLoading}
          formConfig={formConfig}
          onFormConfigChange={(nextFormConfig) =>
            dispatch({ type: "update-form-config", config: nextFormConfig })
          }
          onConfigUpdate={() => void handleConfigUpdate()}
        />
      )}
      <CleanupActionsCard
        cleanupLoading={state.cleanupLoading}
        isRefetchingStats={isRefetchingStats}
        onCleanup={() => void handleCleanup()}
        onRefetch={() => void refetchRetentionData()}
      />
    </div>
  );
}
