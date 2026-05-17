import { useQuery } from "@tanstack/react-query";
import type { FC } from "react";
import { BlockAnalyticsDisplay } from "@/components/forms/analytics/block-analytics-display";
import { client, rpc } from "@/lib/api";

interface FormResponseAnalyticsProps {
  formId: string;
}

const ANALYTICS_PAGE_SIZE = 100;

async function fetchAllResponseAnalytics(formId: string) {
  const timeline = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await rpc(
      client.api.forms[":id"].responses.analytics.$get({
        param: { id: formId },
        query: { page: String(page), pageSize: String(ANALYTICS_PAGE_SIZE) },
      }),
    );
    timeline.push(...res.timeline);
    totalPages = res.pagination.totalPages;
    page++;
  } while (page <= totalPages);

  return { timeline };
}

export const FormResponseAnalytics: FC<FormResponseAnalyticsProps> = ({
  formId,
}) => {
  const analyticsQuery = useQuery({
    queryKey: ["formResponseAnalytics", formId],
    queryFn: () => fetchAllResponseAnalytics(formId),
    enabled: !!formId,
  });

  const blockAnalyticsQuery = useQuery({
    queryKey: ["formBlockAnalytics", formId],
    queryFn: () =>
      rpc(
        client.api.forms[":id"].responses["block-analytics"].$get({
          param: { id: formId },
        }),
      ),
    enabled: !!formId,
  });

  if (analyticsQuery.isLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        分析データを読み込み中...
      </div>
    );
  }

  if (analyticsQuery.error) {
    return (
      <div className="p-4 text-sm text-red-500">
        分析データの読み込みに失敗しました
      </div>
    );
  }

  const data = analyticsQuery.data;
  if (!data) return null;

  const totalResponses = data.timeline.reduce((sum, d) => sum + d.count, 0);
  const maxCount = Math.max(...data.timeline.map((d) => d.count), 1);
  const blockAnalytics = blockAnalyticsQuery.data?.blocks ?? [];

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium">レスポンス分析</h3>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <div className="text-sm text-muted-foreground">総レスポンス数</div>
          <div className="mt-1 text-2xl font-bold">{totalResponses}</div>
        </div>
      </div>

      {data.timeline.length > 0 && (
        <div className="rounded-lg border p-4">
          <h4 className="mb-3 text-sm font-medium text-card-foreground">
            日別レスポンス数
          </h4>
          <div className="space-y-1">
            {data.timeline.map((entry) => (
              <div key={entry.date} className="flex items-center gap-2 text-sm">
                <span className="w-24 text-muted-foreground">{entry.date}</span>
                <div className="flex-1">
                  <div
                    className="h-4 rounded bg-blue-500"
                    style={{
                      width: `${Math.max(4, (entry.count / maxCount) * 100)}%`,
                    }}
                  />
                </div>
                <span className="w-8 text-right text-muted-foreground">
                  {entry.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {blockAnalyticsQuery.isLoading && (
        <div className="p-4 text-sm text-muted-foreground">
          ブロック別分析を読み込み中...
        </div>
      )}

      {blockAnalytics.length > 0 && (
        <div className="space-y-4">
          <h4 className="text-base font-medium">ブロック別分析</h4>
          {blockAnalytics.map((block) => (
            <BlockAnalyticsDisplay key={block.block_id} data={block} />
          ))}
        </div>
      )}
    </div>
  );
};
