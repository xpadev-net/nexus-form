import {
  extractTextFromChildren,
  type PlateNodeConflict,
} from "@nexus-form/shared";
import { AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import { type FC, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface PlateConflictBannerProps {
  conflicts: PlateNodeConflict[];
  resolutions: Record<string, "local" | "remote">;
  onResolutionChange: (resolutions: Record<string, "local" | "remote">) => void;
  onResolve: (resolutions: Record<string, "local" | "remote">) => Promise<void>;
  onDismiss: () => void;
  isMerging: boolean;
}

export const PlateConflictBanner: FC<PlateConflictBannerProps> = ({
  conflicts,
  resolutions,
  onResolutionChange,
  onResolve,
  onDismiss,
  isMerging,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const allResolved =
    conflicts.length > 0 &&
    conflicts.every((c) => resolutions[c.nodeId] !== undefined);

  const handleResolve = (nodeId: string, choice: "local" | "remote") => {
    onResolutionChange({ ...resolutions, [nodeId]: choice });
  };

  const handleSubmit = async () => {
    setIsOpen(false);
    // resolutions は保持する — 非 409 エラー時にバナーが再表示された場合、
    // ユーザーが選択をやり直す必要がないようにする。
    // 成功時は親が conflictState を null にしてバナーごとアンマウントされる。
    await onResolve(resolutions);
  };

  const handleDismiss = () => {
    setIsOpen(false);
    onResolutionChange({});
    onDismiss();
  };

  if (conflicts.length === 0) return null;

  return (
    <Alert variant="destructive" className="border-orange-200 bg-orange-50">
      <AlertTriangle className="h-4 w-4 text-orange-500" />
      <AlertDescription className="flex items-center justify-between">
        <span className="text-orange-700">
          <strong>{conflicts.length}</strong> 件のブロックで編集が競合しています
        </span>
        <div className="flex items-center gap-2">
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={isMerging}>
                {isMerging && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {isMerging ? "保存中…" : "競合を解決"}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-orange-500" />
                  ブロック競合の解決
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                複数のユーザーが同じブロックを編集しました。
                各ブロックについて、どちらの変更を採用するか選択してください。
              </p>
              <div className="space-y-4 mt-4">
                {conflicts.map((conflict) => (
                  <ConflictCard
                    key={conflict.nodeId}
                    conflict={conflict}
                    resolution={resolutions[conflict.nodeId]}
                    onChoose={(choice) =>
                      handleResolve(conflict.nodeId, choice)
                    }
                  />
                ))}
              </div>
              {allResolved && (
                <Alert className="border-green-200 bg-green-50 mt-4">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-700">
                    すべての競合が解決されました。
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" size="sm" onClick={handleDismiss}>
                  キャンセル（最新版を読み込む）
                </Button>
                <Button
                  size="sm"
                  disabled={!allResolved}
                  onClick={() => void handleSubmit()}
                >
                  解決して保存
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            disabled={isMerging}
          >
            破棄
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
};

interface ConflictCardProps {
  conflict: PlateNodeConflict;
  resolution?: "local" | "remote";
  onChoose: (choice: "local" | "remote") => void;
}

function ConflictCard({ conflict, resolution, onChoose }: ConflictCardProps) {
  const conflictTypeLabel =
    conflict.conflictType === "modified_both" ? "両方が変更" : "削除 vs 変更";

  return (
    <div
      className={cn(
        "rounded-lg border-l-4 border p-4",
        resolution ? "border-l-green-500 opacity-80" : "border-l-orange-500",
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="font-medium text-sm">{conflict.displayLabel}</span>
          <Badge variant="outline" className="ml-2 text-xs">
            {conflictTypeLabel}
          </Badge>
        </div>
        {resolution && (
          <Badge variant="secondary" className="bg-green-100 text-green-700">
            <CheckCircle className="h-3 w-3 mr-1" />
            {resolution === "local" ? "自分の変更" : "相手の変更"}
          </Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          className={cn(
            "rounded-md border p-3 text-left text-sm transition-colors",
            resolution === "local"
              ? "border-blue-500 bg-blue-50"
              : "border-muted hover:border-blue-300 hover:bg-blue-50/50",
          )}
          onClick={() => onChoose("local")}
        >
          <div className="flex items-center gap-1 mb-1">
            <div className="w-2 h-2 bg-blue-500 rounded-full" />
            <span className="font-medium text-blue-600 text-xs">
              {conflict.local === null ? "削除" : "自分の変更"}
            </span>
          </div>
          <div className="text-muted-foreground text-xs font-mono truncate">
            {conflict.local === null
              ? "(このブロックを削除)"
              : previewNode(conflict.local)}
          </div>
        </button>
        <button
          type="button"
          className={cn(
            "rounded-md border p-3 text-left text-sm transition-colors",
            resolution === "remote"
              ? "border-red-500 bg-red-50"
              : "border-muted hover:border-red-300 hover:bg-red-50/50",
          )}
          onClick={() => onChoose("remote")}
        >
          <div className="flex items-center gap-1 mb-1">
            <div className="w-2 h-2 bg-red-500 rounded-full" />
            <span className="font-medium text-red-600 text-xs">
              {conflict.remote === null ? "削除" : "相手の変更"}
            </span>
          </div>
          <div className="text-muted-foreground text-xs font-mono truncate">
            {conflict.remote === null
              ? "(このブロックを削除)"
              : previewNode(conflict.remote)}
          </div>
        </button>
      </div>
    </div>
  );
}

function previewNode(node: unknown): string {
  if (node == null || typeof node !== "object") return "(不明)";
  const el = node as Record<string, unknown>;
  if (Array.isArray(el.children)) {
    return (
      extractTextFromChildren(el.children as unknown[]).slice(0, 80) || "(空)"
    );
  }
  return "(ノード)";
}
