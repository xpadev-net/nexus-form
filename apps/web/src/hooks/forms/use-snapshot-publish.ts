import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { RESTORE_EDIT_EVENT } from "@/hooks/forms/events";
import { client, rpc } from "@/lib/api";
import {
  formDiffQueryKey,
  unpublishedChangesQueryKey,
} from "./form-structure-query-keys";

export const useSnapshotPublish = (formId: string | null | undefined) => {
  const queryClient = useQueryClient();

  const latestSnapshotQuery = useQuery({
    queryKey: ["latestSnapshot", formId],
    queryFn: formId
      ? () =>
          rpc(
            client.api.forms[":id"].snapshots.latest.$get({
              param: { id: formId },
            }),
          )
      : skipToken,
  });

  const unpublishedChangesQuery = useQuery({
    queryKey: unpublishedChangesQueryKey(formId),
    queryFn: formId
      ? () =>
          rpc(
            client.api.forms[":id"]["unpublished-changes"].$get({
              param: { id: formId },
            }),
          )
      : skipToken,
  });

  const publishSnapshotMutation = useMutation({
    mutationFn: (opts?: { changeLog?: string }) => {
      if (!formId) throw new Error("formId is required");
      return rpc(
        client.api.forms[":id"].snapshots.$post({
          param: { id: formId },
          json: { changeLog: opts?.changeLog },
        }),
      );
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "スナップショット保存に失敗しました",
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["snapshots", formId] }),
        queryClient.invalidateQueries({ queryKey: ["latestSnapshot", formId] }),
        queryClient.invalidateQueries({
          queryKey: unpublishedChangesQueryKey(formId),
        }),
        queryClient.invalidateQueries({ queryKey: formDiffQueryKey(formId) }),
      ]);
    },
  });

  const resetToSnapshotMutation = useMutation({
    mutationFn: () => {
      if (!formId) throw new Error("formId is required");
      return rpc(
        client.api.forms[":id"].snapshots.reset.$post({
          param: { id: formId },
        }),
      );
    },
    onError: (error: unknown) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "公開版スナップショットのリセットに失敗しました",
      );
    },
    onSuccess: async (data) => {
      await queryClient.cancelQueries({ queryKey: ["formContent", formId] });
      window.dispatchEvent(
        new CustomEvent(RESTORE_EDIT_EVENT, {
          detail: {
            formId,
            plateContent: data.plateContent,
          },
        }),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: formDiffQueryKey(formId) }),
        queryClient.invalidateQueries({ queryKey: ["formContent", formId] }),
        queryClient.invalidateQueries({
          queryKey: unpublishedChangesQueryKey(formId),
        }),
        queryClient.invalidateQueries({ queryKey: ["latestSnapshot", formId] }),
      ]);
    },
  });

  return {
    isPublishing: publishSnapshotMutation.isPending,
    isResetting: resetToSnapshotMutation.isPending,
    lastPublishedVersion: latestSnapshotQuery.data?.snapshot?.version ?? null,
    activeSnapshotVersion:
      latestSnapshotQuery.data?.activeSnapshotVersion ?? null,
    publishSnapshotMutation,
    resetToSnapshotMutation,
    latestSnapshotQuery,
    unpublishedChangesQuery,
  };
};
