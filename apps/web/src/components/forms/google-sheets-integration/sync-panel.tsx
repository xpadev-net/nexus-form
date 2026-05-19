import { Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import type { UiSyncState } from "./types";

interface SyncStatusPanelProps {
  syncStatus: UiSyncState;
  isSyncing: boolean;
  onClearSyncStatus: () => void;
}

export function SyncStatusPanel({
  syncStatus,
  isSyncing,
  onClearSyncStatus,
}: SyncStatusPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>同期状態</Label>
        {!isSyncing && (
          <button
            type="button"
            onClick={onClearSyncStatus}
            className="text-muted-foreground hover:text-foreground"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {syncStatus.status === "failed"
              ? (syncStatus.error ?? "同期に失敗しました")
              : syncStatus.status === "completed"
                ? "同期が完了しました"
                : syncStatus.status === "queued"
                  ? "待機中..."
                  : syncStatus.progress?.processed !== undefined ||
                      syncStatus.progress?.total !== undefined
                    ? `${syncStatus.progress.processed ?? 0} / ${syncStatus.progress.total ?? 0} 件処理中`
                    : "処理中..."}
          </span>
          <span className="font-medium">
            {syncStatus.progress?.percentage !== undefined
              ? `${syncStatus.progress.percentage}%`
              : ""}
          </span>
        </div>
        {syncStatus.progress?.percentage !== undefined &&
          syncStatus.status !== "failed" && (
            <Progress value={syncStatus.progress.percentage} />
          )}
        {syncStatus.status === "completed" && syncStatus.result && (
          <div className="text-xs text-muted-foreground">
            {syncStatus.result.updatedRows !== undefined
              ? `${syncStatus.result.updatedRows} 行を書き込みました`
              : "同期が完了しました"}
          </div>
        )}
      </div>
    </div>
  );
}

interface SyncActionButtonsProps {
  selectedSpreadsheetId: string;
  selectedSheetName: string;
  isSyncing: boolean;
  hasUnsavedChanges: boolean;
  hasSavedConfig: boolean;
  onSaveConfig: () => void;
  onSync: () => void;
}

export function SyncActionButtons({
  selectedSpreadsheetId,
  selectedSheetName,
  isSyncing,
  hasUnsavedChanges,
  hasSavedConfig,
  onSaveConfig,
  onSync,
}: SyncActionButtonsProps) {
  return (
    <div className="flex gap-3">
      <Button
        onClick={onSaveConfig}
        disabled={!selectedSpreadsheetId || !selectedSheetName || isSyncing}
        className="flex-1"
      >
        設定を保存
      </Button>
      <Button
        onClick={onSync}
        disabled={
          !selectedSpreadsheetId ||
          !selectedSheetName ||
          isSyncing ||
          hasUnsavedChanges ||
          !hasSavedConfig
        }
        variant="default"
        className="flex-1"
        title={
          hasUnsavedChanges || !hasSavedConfig
            ? "設定を保存してから同期してください"
            : undefined
        }
      >
        {isSyncing ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            同期中...
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 mr-2" />
            今すぐ差分同期
          </>
        )}
      </Button>
    </div>
  );
}

export function GoogleSheetsSyncDescription() {
  return (
    <div className="rounded-lg bg-muted/50 p-4 text-xs text-muted-foreground space-y-2">
      <p>
        <strong>自動拡張:</strong>{" "}
        指定されたヘッダー名が存在しない場合、自動的に新しい列として追加されます。
      </p>
      <p>
        <strong>差分同期:</strong>{" "}
        前回の同期以降の新しい回答のみが追加されます。
      </p>
    </div>
  );
}
