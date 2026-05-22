import {
  AlertTriangle,
  Database,
  Loader2,
  Settings,
  Trash2,
} from "lucide-react";
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
import type {
  CleanupResult,
  DataRetentionConfig,
  DataRetentionStats,
} from "@/lib/fingerprint/data-retention";
import { type ActionFeedback, formatRetentionDate } from "./model";

export function RetentionStatsCard({ stats }: { stats: DataRetentionStats }) {
  return (
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
            <div className="text-sm text-muted-foreground">総レスポンス数</div>
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
              {formatRetentionDate(stats.lastCleanupDate)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              次のクリーンアップ:
            </span>
            <span className="text-sm">
              {formatRetentionDate(stats.nextCleanupDate)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CleanupResultAlert({
  cleanupResult,
}: {
  cleanupResult: CleanupResult;
}) {
  return (
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
  );
}

export function ActionFeedbackAlert({
  feedback,
}: {
  feedback: ActionFeedback;
}) {
  return (
    <Alert variant={feedback.type === "error" ? "destructive" : undefined}>
      {feedback.type === "error" ? (
        <AlertTriangle className="h-4 w-4" />
      ) : (
        <Settings className="h-4 w-4" />
      )}
      <AlertDescription>{feedback.message}</AlertDescription>
    </Alert>
  );
}

interface RetentionConfigCardProps {
  config: DataRetentionConfig;
  configLoading: boolean;
  formConfig: Partial<DataRetentionConfig>;
  onFormConfigChange: (config: Partial<DataRetentionConfig>) => void;
  onConfigUpdate: () => void;
}

export function RetentionConfigCard({
  config,
  configLoading,
  formConfig,
  onFormConfigChange,
  onConfigUpdate,
}: RetentionConfigCardProps) {
  return (
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
                onFormConfigChange({
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
                onFormConfigChange({
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
                onFormConfigChange({
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
                onFormConfigChange({
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
          <Button onClick={onConfigUpdate} disabled={configLoading}>
            {configLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            設定を更新
          </Button>
          <Button
            variant="outline"
            onClick={() => onFormConfigChange(config)}
            disabled={configLoading}
          >
            リセット
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function CleanupActionsCard({
  cleanupLoading,
  isRefetchingStats,
  onCleanup,
  onRefetch,
}: {
  cleanupLoading: boolean;
  isRefetchingStats: boolean;
  onCleanup: () => void;
  onRefetch: () => void;
}) {
  return (
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
            onClick={onCleanup}
            disabled={cleanupLoading}
            variant="destructive"
          >
            {cleanupLoading && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            全体クリーンアップ
          </Button>
          <Button
            onClick={onRefetch}
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
  );
}
