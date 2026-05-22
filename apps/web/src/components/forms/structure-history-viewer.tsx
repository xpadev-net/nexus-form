import { GitBranch } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSnapshots } from "@/hooks/forms/use-snapshots";
import { SnapshotGraph } from "./snapshot-graph";

interface StructureHistoryViewerProps {
  formId: string;
}

export function StructureHistoryViewer({
  formId,
}: StructureHistoryViewerProps) {
  const {
    snapshotsQuery,
    activateSnapshotMutation,
    restoreEditFromSnapshotMutation,
  } = useSnapshots(formId);

  const snapshots = snapshotsQuery.data?.snapshots ?? [];

  const handleActivate = (version: number) => {
    activateSnapshotMutation.mutate(version, {
      onSuccess: () =>
        toast.success(`バージョン ${version} を公開版にしました`),
      onError: () => toast.error("公開版の切り替えに失敗しました"),
    });
  };

  const handleRestore = (version: number) => {
    restoreEditFromSnapshotMutation.mutate(version, {
      onSuccess: () =>
        toast.success(`バージョン ${version} の内容で編集データを復元しました`),
      onError: () => toast.error("編集データの復元に失敗しました"),
    });
  };

  return (
    <div className="space-y-4 rounded border p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <GitBranch className="h-4 w-4" />
        バージョン履歴グラフ
      </h3>

      {snapshotsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : snapshotsQuery.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">
            履歴を読み込めませんでした。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void snapshotsQuery.refetch()}
          >
            再試行
          </Button>
        </div>
      ) : (
        <SnapshotGraph
          snapshots={snapshots}
          isMutating={
            activateSnapshotMutation.isPending ||
            restoreEditFromSnapshotMutation.isPending
          }
          onActivate={handleActivate}
          onRestore={handleRestore}
        />
      )}
    </div>
  );
}
