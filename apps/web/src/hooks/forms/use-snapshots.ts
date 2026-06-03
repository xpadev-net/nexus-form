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
    onError: () => {
      toast.error("スナップショット差分の取得に失敗しました");
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
          queryKey: ["formDetail", targetFormId],
        }),
        queryClient.invalidateQueries({
          queryKey: formDiffQueryKey(targetFormId),
        }),
      ]);
    },
    onError: () => {
      toast.error("スナップショットの公開反映に失敗しました");
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
          queryKey: ["formContent", targetFormId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["formDetail", targetFormId],
        }),
        queryClient.invalidateQueries({
          queryKey: formDiffQueryKey(targetFormId),
        }),
      ]);
    },
    onError: () => {
      toast.error("編集データの復元に失敗しました");
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
