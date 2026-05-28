import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { RESTORE_EDIT_EVENT } from "@/hooks/forms/events";
import { client, rpc } from "@/lib/api";

const SNAPSHOT_PAGE_SIZE = 100;

async function fetchAllSnapshots(formId: string) {
  const snapshots = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await rpc(
      client.api.forms[":id"].snapshots.$get({
        param: { id: formId },
        query: { page: String(page), pageSize: String(SNAPSHOT_PAGE_SIZE) },
      }),
    );
    snapshots.push(...res.snapshots);
    totalPages = res.pagination.totalPages;
    page++;
  } while (page <= totalPages);

  return { snapshots };
}

export type SnapshotListItem = Awaited<
  ReturnType<typeof fetchAllSnapshots>
>["snapshots"][number];

export const useSnapshots = (formId: string | null | undefined) => {
  const queryClient = useQueryClient();

  const snapshotsQuery = useQuery({
    queryKey: ["snapshots", formId],
    staleTime: 60_000,
    queryFn: formId ? () => fetchAllSnapshots(formId) : skipToken,
  });

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

  const getSnapshotDiffMutation = useMutation({
    mutationFn: ({
      fromVersion,
      toVersion,
    }: {
      fromVersion: number;
      toVersion: number;
    }) => {
      if (!formId) throw new Error("formId is required");
      return rpc(
        client.api.forms[":id"].snapshots.diff.$get({
          param: { id: formId },
          query: {
            fromVersion: String(fromVersion),
            toVersion: String(toVersion),
          },
        }),
      );
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "スナップショット差分の取得に失敗しました",
      );
    },
  });

  const activateSnapshotMutation = useMutation({
    mutationFn: (version: number) => {
      if (!formId) throw new Error("formId is required");
      return rpc(
        client.api.forms[":id"].snapshots[":version"].activate.$post({
          param: { id: formId, version: String(version) },
        }),
      );
    },
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
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "スナップショットの公開反映に失敗しました",
      );
    },
  });

  const restoreEditFromSnapshotMutation = useMutation({
    mutationFn: (version: number) => {
      if (!formId) throw new Error("formId is required");
      return rpc(
        client.api.forms[":id"].snapshots[":version"]["restore-edit"].$post({
          param: { id: formId, version: String(version) },
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
        queryClient.invalidateQueries({ queryKey: ["snapshots", formId] }),
        queryClient.invalidateQueries({
          queryKey: ["latestSnapshot", formId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["unpublishedChanges", formId],
        }),
        queryClient.invalidateQueries({ queryKey: ["formContent", formId] }),
        queryClient.invalidateQueries({ queryKey: ["formDetail", formId] }),
        queryClient.invalidateQueries({ queryKey: ["formDiff", formId] }),
      ]);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "編集データの復元に失敗しました",
      );
    },
  });

  return {
    snapshotsQuery,
    latestSnapshotQuery,
    unpublishedChangesQuery,
    getSnapshotDiffMutation,
    activateSnapshotMutation,
    restoreEditFromSnapshotMutation,
  };
};
