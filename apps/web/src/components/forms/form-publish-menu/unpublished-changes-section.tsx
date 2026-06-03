import { AlertCircle, RotateCcw, Save, Upload } from "lucide-react";
import type { FC } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { UnpublishedChangesSectionState } from "./types";

interface UnpublishedChangesSectionProps {
  state: UnpublishedChangesSectionState;
  onPublishChanges: () => void;
  onSaveOnly: () => void;
  onReset: () => void;
}

export const UnpublishedChangesSection: FC<UnpublishedChangesSectionProps> = ({
  state,
  onPublishChanges,
  onSaveOnly,
  onReset,
}) => {
  const isBusy = state.actionState === "processing";
  const isPublished = state.publishState === "published";
  const currentPublicVersion =
    state.activeSnapshotVersion != null
      ? `現在の公開版: v${state.activeSnapshotVersion}`
      : "現在の公開版はありません";

  return (
    <>
      <Separator />
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertCircle className="h-4 w-4 text-amber-500" />
          未公開の変更
          {state.totalChanges > 0 && (
            <Badge variant="secondary" className="text-xs">
              {state.totalChanges}件
            </Badge>
          )}
        </div>
        <p className="pl-6 text-xs text-muted-foreground">
          公開する場合は現在の編集内容を v{state.nextSnapshotVersion}{" "}
          として公開します。保存のみでは公開版は変更されません。
          <br />
          {currentPublicVersion}
        </p>
        {state.hasPasswordProtectionChanges ? (
          <p className="pl-6 text-xs font-medium text-amber-600">
            未反映の公開設定: パスワード保護
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={isBusy} onClick={onPublishChanges}>
            <Upload className="mr-1 h-3.5 w-3.5" />
            {isPublished ? "変更を公開" : "保存して公開"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={onSaveOnly}
          >
            <Save className="mr-1 h-3.5 w-3.5" />
            スナップショット保存
          </Button>
        </div>
        {state.activeSnapshotVersion != null && state.hasChangesFromActive && (
          <Button
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onClick={onReset}
            className="text-muted-foreground"
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            公開版に戻す
          </Button>
        )}
      </div>
    </>
  );
};
