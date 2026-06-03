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
  formAccessControlStructureQueryKey,
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
      if (!formId) return;
      const targetFormId = formId;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["snapshots", targetFormId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["latestSnapshot", targetFormId],
        }),
        queryClient.invalidateQueries({
          queryKey: formAccessControlStructureQueryKey(targetFormId),
        }),
        queryClient.invalidateQueries({
          queryKey: unpublishedChangesQueryKey(targetFormId),
        }),
        queryClient.invalidateQueries({
          queryKey: formDiffQueryKey(targetFormId),
        }),
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
      if (!formId) return;
      const targetFormId = formId;
      await queryClient.cancelQueries({
        queryKey: ["formContent", targetFormId],
      });
      window.dispatchEvent(
        new CustomEvent(RESTORE_EDIT_EVENT, {
          detail: {
            formId: targetFormId,
            plateContent: data.plateContent,
          },
        }),
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: formDiffQueryKey(targetFormId),
        }),
        queryClient.invalidateQueries({
          queryKey: formAccessControlStructureQueryKey(targetFormId),
        }),
        queryClient.invalidateQueries({
          queryKey: ["formContent", targetFormId],
        }),
        queryClient.invalidateQueries({
          queryKey: unpublishedChangesQueryKey(targetFormId),
        }),
        queryClient.invalidateQueries({
          queryKey: ["latestSnapshot", targetFormId],
        }),
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
