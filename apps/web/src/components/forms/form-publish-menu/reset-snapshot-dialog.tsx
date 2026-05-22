import type { FC } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { NodesDiffList } from "../nodes-diff-list";

interface ResetSnapshotDialogProps {
  formId: string;
  open: boolean;
  activeSnapshotVersion: number | null;
  totalChanges: number;
  isProcessing: boolean;
  onOpenChange: (open: boolean) => void;
  onReset: () => void;
}

export const ResetSnapshotDialog: FC<ResetSnapshotDialogProps> = ({
  formId,
  open,
  activeSnapshotVersion,
  totalChanges,
  isProcessing,
  onOpenChange,
  onReset,
}) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className="max-w-4xl max-h-[80vh] overflow-hidden">
      <AlertDialogHeader>
        <AlertDialogTitle>公開版スナップショットに戻す</AlertDialogTitle>
        <AlertDialogDescription>
          現在の編集内容を破棄し、公開版のスナップショット
          {activeSnapshotVersion != null && ` (v${activeSnapshotVersion})`}
          に戻します。 この操作は元に戻せません。本当に実行しますか？
        </AlertDialogDescription>
      </AlertDialogHeader>

      {totalChanges > 0 && (
        <div className="my-4">
          <h4 className="text-sm font-medium mb-2">
            変更内容 ({totalChanges}件):
          </h4>
          <div className="max-h-96 overflow-auto">
            <NodesDiffList formId={formId} />
          </div>
        </div>
      )}

      <AlertDialogFooter>
        <AlertDialogCancel disabled={isProcessing}>
          キャンセル
        </AlertDialogCancel>
        <Button onClick={onReset} disabled={isProcessing}>
          {isProcessing ? "リセット中..." : "リセットする"}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
