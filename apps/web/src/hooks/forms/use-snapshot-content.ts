import { useQuery } from "@tanstack/react-query";
import { client, rpc } from "@/lib/api";

export const useSnapshotContent = (formId: string, version: number | null) => {
  return useQuery({
    queryKey: ["snapshotContent", formId, version],
    enabled: version !== null,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => {
      if (version === null) throw new Error("version is required");
      return rpc(
        client.api.forms[":id"].snapshots[":version"].content.$get({
          param: { id: formId, version: String(version) },
        }),
      );
    },
  });
};
