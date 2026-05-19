import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BarChart3, List, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FormResponseAnalytics } from "@/components/forms/form-response-analytics";
import { ResponseDetailView } from "@/components/forms/response-detail-view";
import { ResponseExport } from "@/components/forms/response-export";
import { ResponseFilter } from "@/components/forms/response-filter";
import { Button } from "@/components/ui/button";
import { useValidationSSE } from "@/hooks/forms/use-validation-sse";
import { client, rpc } from "@/lib/api";

type ViewMode = "list" | "analytics";

export function FormResponsesContent({ formId }: { formId: string }) {
  useValidationSSE(formId);

  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [selectedResponseId, setSelectedResponseId] = useState<string | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const limit = 20;
  const debouncedKeywordRef = useRef(debouncedKeyword);
  debouncedKeywordRef.current = debouncedKeyword;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextKeyword = keyword.trim();
      setDebouncedKeyword(nextKeyword);
      if (nextKeyword !== debouncedKeywordRef.current) {
        setPage(1);
      }
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [keyword]);

  const responsesQuery = useQuery({
    queryKey: ["formResponses", formId, page, limit, debouncedKeyword],
    queryFn: () =>
      rpc(
        client.api.forms[":id"].responses.$get({
          param: { id: formId },
          query: {
            page: String(page),
            limit: String(limit),
            ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

  const data = responsesQuery.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  const handleSelectResponse = useCallback((responseId: string) => {
    setSelectedResponseId(responseId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedResponseId(null);
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
    setSelectedResponseId(null);
  }, []);

  const handleKeywordChange = useCallback((value: string) => {
    setKeyword(value);
    setSelectedResponseId(null);
  }, []);

  return (
    <div className="space-y-4">
      {/* ツールバー */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          全 {data?.total ?? 0} 件
        </p>
        <div className="flex items-center gap-2">
          <ResponseExport formId={formId} />
          <div className="flex rounded-md border">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
              className={[
                "flex items-center gap-1 px-3 py-1.5 text-sm transition-colors",
                viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              ].join(" ")}
            >
              <List className="h-3.5 w-3.5" />
              リスト
            </button>
            <button
              type="button"
              onClick={() => setViewMode("analytics")}
              aria-pressed={viewMode === "analytics"}
              className={[
                "flex items-center gap-1 px-3 py-1.5 text-sm transition-colors",
                viewMode === "analytics"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              ].join(" ")}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              分析
            </button>
          </div>
        </div>
      </div>

      {/* 分析ビュー */}
      {viewMode === "analytics" && (
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <FormResponseAnalytics formId={formId} />
        </section>
      )}

      {/* リストビュー */}
      {viewMode === "list" && (
        <div className="flex gap-4">
          {/* 回答リスト */}
          <section
            className={[
              "rounded-lg border bg-card p-6 shadow-sm",
              selectedResponseId ? "w-1/2" : "w-full",
            ].join(" ")}
          >
            {/* フィルタ */}
            <div className="mb-4">
              <ResponseFilter
                keyword={keyword}
                onKeywordChange={handleKeywordChange}
              />
            </div>

            {/* 読み込み中 */}
            {responsesQuery.isLoading && (
              <p className="text-sm text-muted-foreground">読み込み中...</p>
            )}
            {responsesQuery.isFetching && !responsesQuery.isLoading && (
              <p className="text-xs text-muted-foreground">更新中...</p>
            )}

            {/* エラー */}
            {responsesQuery.isError && (
              <p className="text-sm text-destructive">
                {responsesQuery.error instanceof Error
                  ? responsesQuery.error.message
                  : "不明なエラーが発生しました"}
              </p>
            )}

            {/* 回答リスト */}
            {data && (
              <>
                {data.responses.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded border border-dashed p-8 text-muted-foreground">
                    <p className="text-sm">
                      {debouncedKeyword
                        ? "検索条件に一致する回答はありません。"
                        : "回答はまだありません。"}
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {data.responses.map((response) => (
                      <li key={response.id}>
                        <button
                          type="button"
                          onClick={() => handleSelectResponse(response.id)}
                          className={[
                            "flex w-full items-center justify-between rounded border p-3 text-left transition-colors hover:bg-muted/50",
                            selectedResponseId === response.id
                              ? "border-primary bg-primary/5"
                              : "",
                          ].join(" ")}
                        >
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium">
                              {response.respondentUuid
                                ? `回答者: ${response.respondentUuid.slice(0, 8)}...`
                                : `回答 #${response.id.slice(0, 8)}`}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              提出:{" "}
                              {new Date(response.submittedAt).toLocaleString(
                                "ja-JP",
                              )}
                            </span>
                            {response.updatedAt && (
                              <span className="text-xs text-muted-foreground">
                                更新:{" "}
                                {new Date(response.updatedAt).toLocaleString(
                                  "ja-JP",
                                )}
                              </span>
                            )}
                          </div>
                          {response.countryCode && (
                            <span className="text-xs text-muted-foreground">
                              {response.countryCode}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* ページネーション */}
                {totalPages > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      ページ {page} / {totalPages}
                    </p>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(page - 1)}
                        disabled={page <= 1}
                      >
                        前へ
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(page + 1)}
                        disabled={page >= totalPages}
                      >
                        次へ
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          {/* 回答詳細 */}
          {selectedResponseId && (
            <section className="w-1/2 rounded-lg border bg-card p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">回答詳細</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCloseDetail}
                  className="h-8 w-8 p-0"
                  aria-label="回答詳細を閉じる"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <ResponseDetailView
                formId={formId}
                responseId={selectedResponseId}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
