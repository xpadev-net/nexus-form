import { useQuery } from "@tanstack/react-query";
import { client, rpc } from "@/lib/api";

export const useResponseAnalytics = (formId: string | null | undefined) => {
  const analyticsQuery = useQuery({
    queryKey: ["responseAnalytics", formId],
    enabled: Boolean(formId),
    queryFn: () =>
      rpc(
        client.api.forms[":id"].responses.analytics.$get({
          param: { id: formId as string },
        }),
      ),
  });

  const aggregateQuery = useQuery({
    queryKey: ["responseAggregate", formId],
    enabled: Boolean(formId),
    queryFn: () =>
      rpc(
        client.api.forms[":id"].responses.aggregate.$get({
          param: { id: formId as string },
        }),
      ),
  });

  const statusesQuery = useQuery({
    queryKey: ["responseStatuses", formId],
    enabled: Boolean(formId),
    queryFn: () =>
      rpc(
        client.api.forms[":id"].responses.statuses.$get({
          param: { id: formId as string },
        }),
      ),
  });

  const blockAnalyticsQuery = useQuery({
    queryKey: ["responseBlockAnalytics", formId],
    enabled: Boolean(formId),
    queryFn: () =>
      rpc(
        client.api.forms[":id"].responses["block-analytics"].$get({
          param: { id: formId as string },
        }),
      ),
  });

  return {
    analyticsQuery,
    aggregateQuery,
    statusesQuery,
    blockAnalyticsQuery,
  };
};
