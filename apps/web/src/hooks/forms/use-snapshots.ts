import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export const useSnapshots = (formId: string | null | undefined) => {
  const queryClient = useQueryClient();

  const snapshotsQuery = useQuery({
    queryKey: ["snapshots", formId],
    enabled: Boolean(formId),
    staleTime: 60_000,
    queryFn: () => fetchAllSnapshots(formId as string),
  });

  const latestSnapshotQuery = useQuery({
    queryKey: ["latestSnapshot", formId],
    enabled: Boolean(formId),
    queryFn: () =>
      rpc(
        client.api.forms[":id"].snapshots.latest.$get({
          param: { id: formId as string },
        }),
      ),
  });

  const unpublishedChangesQuery = useQuery({
    queryKey: ["unpublishedChanges", formId],
    enabled: Boolean(formId),
    queryFn: () =>
      rpc(
        client.api.forms[":id"]["unpublished-changes"].$get({
          param: { id: formId as string },
        }),
      ),
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
    onSuccess: async () => {
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
