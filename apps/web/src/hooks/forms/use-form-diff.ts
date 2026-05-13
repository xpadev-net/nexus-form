import { useQuery } from "@tanstack/react-query";
import { client, rpc } from "@/lib/api";

export const useFormDiff = (formId: string | null | undefined) => {
  const formDiffQuery = useQuery({
    queryKey: ["formDiff", formId],
    enabled: Boolean(formId),
    queryFn: () =>
      rpc(
        client.api.forms[":id"].diff.$get({
          param: { id: formId as string },
        }),
      ),
  });

  const diffData = formDiffQuery.data;
  const totalChanges = diffData?.data?.totalChanges ?? 0;
  const hasUnpublishedChanges = diffData?.data?.hasUnpublishedChanges ?? false;
  const hasChangesFromActive = diffData?.data?.hasChangesFromActive ?? false;
  const hasValidationRuleChanges =
    diffData?.data?.hasValidationRuleChanges ?? false;
  const nodes = diffData?.data?.nodes ?? [];

  return {
    formDiffQuery,
    diffData,
    totalChanges,
    hasUnpublishedChanges,
    hasChangesFromActive,
    hasValidationRuleChanges,
    nodes,
  };
};

export const useDiffDisplay = () => {
  const getDiffTypeDisplayName = (type: string) => {
    if (type === "added") return "追加";
    if (type === "removed") return "削除";
    if (type === "modified") return "変更";
    return type;
  };

  const getDiffTypeColor = (type: string): string => {
    if (type === "added") return "text-green-600 border-green-300";
    if (type === "removed") return "text-red-600 border-red-300";
    if (type === "modified") return "text-amber-600 border-amber-300";
    return "text-muted-foreground";
  };

  return {
    getDiffTypeDisplayName,
    getDiffTypeColor,
  };
};
