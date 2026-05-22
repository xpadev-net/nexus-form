import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { RESTORE_EDIT_EVENT } from "@/hooks/forms/events";
import { client, rpc } from "@/lib/api";

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
    queryKey: ["unpublishedChanges", formId],
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
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["snapshots", formId] }),
        queryClient.invalidateQueries({ queryKey: ["latestSnapshot", formId] }),
        queryClient.invalidateQueries({
          queryKey: ["unpublishedChanges", formId],
        }),
        queryClient.invalidateQueries({ queryKey: ["formDiff", formId] }),
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
        queryClient.invalidateQueries({ queryKey: ["formDiff", formId] }),
        queryClient.invalidateQueries({ queryKey: ["formContent", formId] }),
        queryClient.invalidateQueries({
          queryKey: ["unpublishedChanges", formId],
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
