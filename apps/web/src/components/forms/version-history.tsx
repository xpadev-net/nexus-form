import { type FC, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSnapshots } from "@/hooks/forms/use-snapshots";
import { SnapshotGraph } from "./snapshot-graph";

interface VersionHistoryProps {
  formId: string;
}

export const VersionHistory: FC<VersionHistoryProps> = ({ formId }) => {
  const [pendingRestoreVersion, setPendingRestoreVersion] = useState<
    number | null
  >(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const {
    snapshotsQuery,
    activateSnapshotMutation,
    restoreEditFromSnapshotMutation,
  } = useSnapshots(formId);

  const snapshots = snapshotsQuery.data?.snapshots ?? [];

  const handleActivate = (version: number) => {
    activateSnapshotMutation.mutate(version, {
      onSuccess: () => {
        toast.success(`バージョン ${version} を公開版にしました`);
        setSelectedId(null);
      },
      onError: (error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : "公開版の切り替えに失敗しました",
        );
      },
    });
  };

  const handleRestoreEdit = (version: number) => {
    setPendingRestoreVersion(version);
  };

  const confirmRestore = () => {
    if (pendingRestoreVersion == null) return;
    restoreEditFromSnapshotMutation.mutate(pendingRestoreVersion, {
      onSuccess: () => {
        toast.success(
          `バージョン ${pendingRestoreVersion} の内容で編集データを復元しました`,
        );
        setSelectedId(null);
        setPendingRestoreVersion(null);
      },
      onError: (error) => {
        setPendingRestoreVersion(null);
        toast.error(
          error instanceof Error
            ? error.message
            : "編集データの復元に失敗しました",
        );
      },
    });
  };

  if (snapshotsQuery.isLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        バージョン履歴を読み込み中...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">バージョン履歴</h3>

      <SnapshotGraph
        snapshots={snapshots.map((s) => ({
          ...s,
          publishedAt: s.publishedAt as string | Date,
        }))}
        selectedId={selectedId}
        onSelect={setSelectedId}
        isMutating={
          activateSnapshotMutation.isPending ||
          restoreEditFromSnapshotMutation.isPending
        }
        onActivate={handleActivate}
        onRestore={handleRestoreEdit}
      />

      <AlertDialog
        open={pendingRestoreVersion != null}
        onOpenChange={(open) => {
          if (!open) setPendingRestoreVersion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              バージョン {pendingRestoreVersion}{" "}
              の内容で編集データを復元しますか？
            </AlertDialogTitle>
            <AlertDialogDescription>
              現在の編集内容を破棄し、バージョン {pendingRestoreVersion}{" "}
              の内容で上書きします。この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRestore}>
              復元する
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
