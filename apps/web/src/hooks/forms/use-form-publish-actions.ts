import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { client, rpc } from "@/lib/api";
import { useFormDiff } from "./use-form-diff";
import { useSnapshotPublish } from "./use-snapshot-publish";

export const useFormPublishActions = (formId: string) => {
  const queryClient = useQueryClient();

  const {
    isPublishing: isSnapshotSaving,
    isResetting,
    lastPublishedVersion,
    activeSnapshotVersion,
    publishSnapshotMutation,
    resetToSnapshotMutation,
    latestSnapshotQuery,
  } = useSnapshotPublish(formId);

  const { hasUnpublishedChanges, hasChangesFromActive, totalChanges } =
    useFormDiff(formId);

  const hasActiveSnapshot =
    latestSnapshotQuery.data?.hasActiveSnapshot ?? false;

  // activate mutation (inline, to avoid pulling full useSnapshots)
  const activateSnapshotMutation = useMutation({
    mutationFn: (version: number) =>
      rpc(
        client.api.forms[":id"].snapshots[":version"].activate.$post({
          param: { id: formId, version: String(version) },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["snapshots", formId] }),
        queryClient.invalidateQueries({
          queryKey: ["latestSnapshot", formId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["unpublishedChanges", formId],
        }),
        queryClient.invalidateQueries({ queryKey: ["formDetail", formId] }),
        queryClient.invalidateQueries({ queryKey: ["formDiff", formId] }),
      ]);
    },
    onError: () => {
      toast.error("公開版の更新に失敗しました");
    },
  });

  // form publish mutation
  const publishFormMutation = useMutation({
    mutationFn: () =>
      rpc(client.api.forms[":id"].publish.$post({ param: { id: formId } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["formDetail", formId],
      });
    },
    onError: () => {
      toast.error("フォームの公開に失敗しました");
    },
  });

  // form unpublish mutation
  const unpublishFormMutation = useMutation({
    mutationFn: () =>
      rpc(client.api.forms[":id"].unpublish.$post({ param: { id: formId } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["formDetail", formId],
      });
    },
    onError: () => {
      toast.error("フォームの非公開に失敗しました");
    },
  });

  const isProcessing =
    isSnapshotSaving ||
    isResetting ||
    activateSnapshotMutation.isPending ||
    publishFormMutation.isPending ||
    unpublishFormMutation.isPending;

  /** スナップショット保存のみ */
  const saveSnapshot = async (
    changeLog?: string,
  ): Promise<{ version: number }> => {
    const result = await publishSnapshotMutation.mutateAsync({ changeLog });
    if (result.version == null)
      throw new Error("バージョン情報の取得に失敗しました");
    return { version: result.version };
  };

  /** スナップショット保存 → activate → フォーム公開 (DRAFT/UNPUBLISHED→PUBLISHED) */
  const saveAndPublish = async (changeLog?: string): Promise<void> => {
    const result = await publishSnapshotMutation.mutateAsync({ changeLog });
    if (result.version == null)
      throw new Error("バージョン情報の取得に失敗しました");
    try {
      await activateSnapshotMutation.mutateAsync(result.version);
    } catch (_error) {
      throw new Error(
        `スナップショット(v${result.version})は保存されましたが、公開版の設定に失敗しました。バージョン履歴から手動で公開版を選択してください。`,
      );
    }
    try {
      await publishFormMutation.mutateAsync();
    } catch (_error) {
      throw new Error(
        `スナップショット(v${result.version})は公開版に設定されましたが、フォームの公開に失敗しました。ヘッダーから再度公開を試みてください。`,
      );
    }
  };

  /** スナップショット保存 → activate (公開中フォームの公開版を更新) */
  const saveAndActivate = async (changeLog?: string): Promise<void> => {
    const result = await publishSnapshotMutation.mutateAsync({ changeLog });
    if (result.version == null)
      throw new Error("バージョン情報の取得に失敗しました");
    try {
      await activateSnapshotMutation.mutateAsync(result.version);
    } catch (_error) {
      throw new Error(
        `スナップショット(v${result.version})は保存されましたが、公開版の更新に失敗しました。バージョン履歴から手動で公開版を選択してください。`,
      );
    }
  };

  /** フォームを公開 (active snapshot が存在する場合のみ) */
  const publishForm = async (): Promise<void> => {
    await publishFormMutation.mutateAsync();
  };

  /** フォームを非公開にする */
  const unpublishForm = async (): Promise<void> => {
    await unpublishFormMutation.mutateAsync();
  };

  /** 公開版スナップショットにリセット */
  const resetToActiveSnapshot = async (): Promise<void> => {
    await resetToSnapshotMutation.mutateAsync();
  };

  return {
    // 状態
    hasUnpublishedChanges,
    hasChangesFromActive,
    hasActiveSnapshot,
    lastPublishedVersion,
    activeSnapshotVersion,
    isProcessing,
    totalChanges,

    // アクション
    saveSnapshot,
    saveAndPublish,
    saveAndActivate,
    publishForm,
    unpublishForm,
    resetToActiveSnapshot,
  };
};
