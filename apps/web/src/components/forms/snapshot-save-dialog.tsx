import { GitCompare, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NodesDiffList } from "./nodes-diff-list";

interface SnapshotSaveDialogProps {
  formId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isProcessing: boolean;
  hasUnpublishedChanges: boolean;
  lastPublishedVersion: number | null;
  totalChanges: number;
  confirmLabel: string;
  onConfirm: (changeLog: string) => void;
}

export function SnapshotSaveDialog({
  formId,
  open,
  onOpenChange,
  isProcessing,
  hasUnpublishedChanges,
  lastPublishedVersion,
  totalChanges,
  confirmLabel,
  onConfirm,
}: SnapshotSaveDialogProps) {
  const [changeLog, setChangeLog] = useState("");
  const [activeTab, setActiveTab] = useState("publish");

  // open prop が外部から false に変更された場合にもリセットする
  useEffect(() => {
    if (!open) {
      setChangeLog("");
      setActiveTab("publish");
    }
  }, [open]);

  const handleConfirm = () => {
    onConfirm(changeLog);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setChangeLog("");
      setActiveTab("publish");
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-4xl max-h-[80vh] overflow-hidden"
        onEscapeKeyDown={(e) => {
          if (isProcessing) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (isProcessing) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>スナップショットを保存</DialogTitle>
          <DialogDescription>
            現在の編集内容をスナップショットとして保存します。保存後、バージョン履歴から公開版を選択できます。
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="publish">保存設定</TabsTrigger>
            <TabsTrigger value="diff" className="flex items-center gap-2">
              <GitCompare className="h-4 w-4" />
              変更内容
              {totalChanges > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {totalChanges}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="publish" className="space-y-4">
            <div>
              <Label htmlFor="changeLog">変更ログ (任意)</Label>
              <Input
                id="changeLog"
                placeholder="今回の変更内容を記入してください..."
                value={changeLog}
                onChange={(e) => setChangeLog(e.target.value)}
              />
            </div>
            {lastPublishedVersion != null && (
              <div className="text-sm text-muted-foreground">
                最新スナップショット: v{lastPublishedVersion}
              </div>
            )}
          </TabsContent>

          <TabsContent value="diff" className="space-y-4">
            <div className="h-96 overflow-auto">
              <NodesDiffList formId={formId} />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isProcessing}
          >
            キャンセル
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isProcessing || !hasUnpublishedChanges}
            title={
              !hasUnpublishedChanges ? "保存する変更がありません" : undefined
            }
          >
            <Save className="h-4 w-4 mr-2" />
            {isProcessing ? "処理中..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
