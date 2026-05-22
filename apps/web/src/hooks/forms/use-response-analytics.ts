import { skipToken, useQuery } from "@tanstack/react-query";
import { client, rpc } from "@/lib/api";

const ANALYTICS_PAGE_SIZE = 100;

async function fetchAllResponseAnalytics(formId: string) {
  const timeline = [];
  let page = 1;
  let hasNext = false;

  do {
    const res = await rpc(
      client.api.forms[":id"].responses.analytics.$get({
        param: { id: formId },
        query: { page: String(page), pageSize: String(ANALYTICS_PAGE_SIZE) },
      }),
    );
    timeline.push(...res.timeline);
    hasNext = res.pagination.hasNext;
    page++;
  } while (hasNext);

  return { timeline };
}

export const useResponseAnalytics = (formId: string | null | undefined) => {
  const analyticsQuery = useQuery({
    queryKey: ["responseAnalytics", formId],
    queryFn: formId ? () => fetchAllResponseAnalytics(formId) : skipToken,
  });

  const aggregateQuery = useQuery({
    queryKey: ["responseAggregate", formId],
    queryFn: formId
      ? () =>
          rpc(
            client.api.forms[":id"].responses.aggregate.$get({
              param: { id: formId },
            }),
          )
      : skipToken,
  });

  const statusesQuery = useQuery({
    queryKey: ["responseStatuses", formId],
    queryFn: formId
      ? () =>
          rpc(
            client.api.forms[":id"].responses.statuses.$get({
              param: { id: formId },
            }),
          )
      : skipToken,
  });

  const blockAnalyticsQuery = useQuery({
    queryKey: ["responseBlockAnalytics", formId],
    queryFn: formId
      ? () =>
          rpc(
            client.api.forms[":id"].responses["block-analytics"].$get({
              param: { id: formId },
            }),
          )
      : skipToken,
  });

  return {
    analyticsQuery,
    aggregateQuery,
    statusesQuery,
    blockAnalyticsQuery,
  };
};
