/**
 * データ保持期間管理コンポーネント
 * フィンガープリントデータの保持期間を管理し、期限切れデータを自動削除
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Database,
  Loader2,
  Settings,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { client } from "@/lib/api";
import type {
  CleanupResult,
  DataRetentionConfig,
  DataRetentionStats,
} from "@/lib/fingerprint/data-retention";
import { japanDateTimeFormatter } from "@/lib/formatters";
import { logError } from "@/lib/logger";
import { cn } from "@/lib/utils";

const dataRetentionStatsSchema = z.object({
  totalFingerprints: z.number(),
  expiredFingerprints: z.number(),
  totalFingerprintDetails: z.number(),
  expiredFingerprintDetails: z.number(),
  totalResponses: z.number(),
  expiredResponses: z.number(),
  lastCleanupDate: z.coerce.date().nullable(),
  nextCleanupDate: z.coerce.date().nullable(),
});

const dataRetentionConfigSchema = z.object({
  fingerprintRetentionDays: z.number(),
  fingerprintDetailRetentionDays: z.number(),
  responseRetentionDays: z.number().optional(),
  autoCleanupEnabled: z.boolean(),
  cleanupSchedule: z.string(),
});

/** GET /api/fingerprint/retention returns { config, stats } directly */
const retentionGetResponseSchema = z.object({
  config: dataRetentionConfigSchema,
  stats: dataRetentionStatsSchema,
});

/** POST /api/fingerprint/retention returns { config } on success or { error, details } on failure */
const configUpdateResponseSchema = z.object({
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

/** PUT /api/fingerprint/retention returns { result } */
const cleanupResponseSchema = z.object({
  result: cleanupResultSchema,
});

interface DataRetentionManagerProps {
  className?: string;
}

export function DataRetentionManager({ className }: DataRetentionManagerProps) {
  const queryClient = useQueryClient();
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<CleanupResult | null>(
    null,
  );

  // 設定フォームの状態
  const [formConfig, setFormConfig] = useState<Partial<DataRetentionConfig>>(
    {},
  );
  const [configLoading, setConfigLoading] = useState(false);

  // TanStack Queryでデータ保持期間情報を取得（Hono RPCクライアント経由）
  const {
    data: retentionData,
    error: fetchError,
    isLoading: loading,
    refetch: refetchRetentionData,
    isRefetching: isRefetchingStats,
  } = useQuery<{
    stats: DataRetentionStats;
    config: DataRetentionConfig;
  }>({
    queryKey: ["fingerprint", "retention"],
    queryFn: async () => {
      const response = await client.api.fingerprint.retention.$get();
      if (!response.ok) {
        throw new Error(
          `データ保持期間情報の取得に失敗しました: HTTP ${response.status}`,
        );
      }
      const json: unknown = await response.json();
      const parsed = retentionGetResponseSchema.parse(json);
      return parsed as {
        stats: DataRetentionStats;
        config: DataRetentionConfig;
      };
    },
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const stats = retentionData?.stats || null;
  const config = retentionData?.config || null;

  // データが取得されたら設定フォームを初期化
  useEffect(() => {
    if (config && !formConfig.fingerprintDetailRetentionDays) {
      setFormConfig(config);
    }
  }, [config, formConfig.fingerprintDetailRetentionDays]);

  const handleCleanup = async () => {
    try {
      setCleanupLoading(true);
      setActionFeedback(null);

      const response = await client.api.fingerprint.retention.$put();

      if (!response.ok) {
        throw new Error(
          `クリーンアップに失敗しました: HTTP ${response.status}`,
        );
      }

      const json: unknown = await response.json();
      const parsed = cleanupResponseSchema.parse(json);
      const result = parsed.result;

      setCleanupResult(result);
      setActionFeedback({
        type: "success",
        message: "クリーンアップが完了しました",
      });

      // TanStack Queryのキャッシュを楽観的に更新
      queryClient.setQueryData<{
        stats: DataRetentionStats;
        config: DataRetentionConfig;
      }>(["fingerprint", "retention"], (currentData) => {
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
      });
    } catch (err) {
      logError("Failed to cleanup expired data:", "ui", { error: err });
      setCleanupResult(null);
      setActionFeedback({
        type: "error",
        message:
          err instanceof Error
            ? `クリーンアップに失敗しました: ${err.message}`
            : "クリーンアップに失敗しました: 不明なエラーが発生しました",
      });
    } finally {
      setCleanupLoading(false);
    }
  };

  const handleConfigUpdate = async () => {
    try {
      setConfigLoading(true);
      setActionFeedback(null);

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

      // TanStack Queryのキャッシュを更新
      queryClient.setQueryData<{
        stats: DataRetentionStats;
        config: DataRetentionConfig;
      }>(["fingerprint", "retention"], (currentData) => {
        if (!currentData || !parsed.config) return currentData;
        return {
          ...currentData,
          config: parsed.config,
        };
      });

      setFormConfig(parsed.config);
      setActionFeedback({
        type: "success",
        message: "設定を更新しました",
      });
    } catch (err) {
      logError("Failed to update configuration:", "ui", { error: err });
      setActionFeedback({
        type: "error",
        message:
          err instanceof Error
            ? `設定の更新に失敗しました: ${err.message}`
            : "設定の更新に失敗しました: 不明なエラーが発生しました",
      });
    } finally {
      setConfigLoading(false);
    }
  };

  const formatDate = (date: Date | null) => {
    if (!date) return "未設定";
    return japanDateTimeFormatter.format(new Date(date));
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
      {/* 統計情報 */}
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              データ保持期間統計
            </CardTitle>
            <CardDescription>
              現在のデータ保持状況と期限切れデータの統計
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {stats.totalFingerprintDetails}
                </div>
                <div className="text-sm text-muted-foreground">
                  総フィンガープリント詳細数
                </div>
                <div className="text-xs text-red-600">
                  期限切れ: <span>{stats.expiredFingerprintDetails}</span>
                </div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {stats.totalResponses}
                </div>
                <div className="text-sm text-muted-foreground">
                  総レスポンス数
                </div>
                <div className="text-xs text-red-600">
                  期限切れ: <span>{stats.expiredResponses}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  最後のクリーンアップ:
                </span>
                <span className="text-sm">
                  {formatDate(stats.lastCleanupDate)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  次のクリーンアップ:
                </span>
                <span className="text-sm">
                  {formatDate(stats.nextCleanupDate)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* クリーンアップ結果 */}
      {cleanupResult && (
        <Alert>
          <Trash2 className="h-4 w-4" />
          <AlertDescription>
            クリーンアップが完了しました。 削除されたデータ: 詳細{" "}
            {cleanupResult.deletedFingerprintDetails}件、 レスポンス{" "}
            {cleanupResult.deletedResponses}件
            {cleanupResult.errors.length > 0 && (
              <div className="mt-2 text-sm text-red-600">
                エラー: {cleanupResult.errors.join(", ")}
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}

      {actionFeedback && (
        <Alert
          variant={actionFeedback.type === "error" ? "destructive" : undefined}
        >
          {actionFeedback.type === "error" ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <Settings className="h-4 w-4" />
          )}
          <AlertDescription>{actionFeedback.message}</AlertDescription>
        </Alert>
      )}

      {/* 設定 */}
      {config && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              データ保持期間設定
            </CardTitle>
            <CardDescription>
              フィンガープリントデータの保持期間を設定します
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="fingerprintRetentionDays">
                  フィンガープリント保持期間（日）
                </Label>
                <Input
                  id="fingerprintRetentionDays"
                  type="number"
                  min="1"
                  max="365"
                  value={formConfig.fingerprintRetentionDays || ""}
                  onChange={(e) =>
                    setFormConfig({
                      ...formConfig,
                      fingerprintRetentionDays:
                        parseInt(e.target.value, 10) || undefined,
                    })
                  }
                />
              </div>

              <div>
                <Label htmlFor="fingerprintDetailRetentionDays">
                  フィンガープリント詳細保持期間（日）
                </Label>
                <Input
                  id="fingerprintDetailRetentionDays"
                  type="number"
                  min="1"
                  max="365"
                  value={formConfig.fingerprintDetailRetentionDays || ""}
                  onChange={(e) =>
                    setFormConfig({
                      ...formConfig,
                      fingerprintDetailRetentionDays:
                        parseInt(e.target.value, 10) || undefined,
                    })
                  }
                />
              </div>

              <div>
                <Label htmlFor="responseRetentionDays">
                  レスポンス保持期間（日）
                </Label>
                <Input
                  id="responseRetentionDays"
                  type="number"
                  min="1"
                  max="3650"
                  value={formConfig.responseRetentionDays || ""}
                  onChange={(e) =>
                    setFormConfig({
                      ...formConfig,
                      responseRetentionDays:
                        parseInt(e.target.value, 10) || undefined,
                    })
                  }
                />
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="autoCleanupEnabled"
                  checked={formConfig.autoCleanupEnabled || false}
                  onCheckedChange={(checked) =>
                    setFormConfig({
                      ...formConfig,
                      autoCleanupEnabled: checked,
                    })
                  }
                />
                <Label htmlFor="autoCleanupEnabled">
                  自動クリーンアップを有効にする
                </Label>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleConfigUpdate} disabled={configLoading}>
                {configLoading && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                設定を更新
              </Button>
              <Button
                variant="outline"
                onClick={() => setFormConfig(config)}
                disabled={configLoading}
              >
                リセット
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* クリーンアップ操作 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            データクリーンアップ
          </CardTitle>
          <CardDescription>
            期限切れのフィンガープリントデータを削除します
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button
              onClick={() => void handleCleanup()}
              disabled={cleanupLoading}
              variant="destructive"
            >
              {cleanupLoading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              全体クリーンアップ
            </Button>
            <Button
              onClick={() => void refetchRetentionData()}
              disabled={isRefetchingStats}
              variant="outline"
            >
              {isRefetchingStats && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              統計を更新
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
