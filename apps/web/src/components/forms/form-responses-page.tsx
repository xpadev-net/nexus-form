import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BarChart3, List, X } from "lucide-react";
import { useCallback, useEffect, useReducer } from "react";
import { FormResponseAnalytics } from "@/components/forms/form-response-analytics";
import { ResponseDetailView } from "@/components/forms/response-detail-view";
import { ResponseExport } from "@/components/forms/response-export";
import { ResponseFilter } from "@/components/forms/response-filter";
import { Button } from "@/components/ui/button";
import { useValidationSSE } from "@/hooks/forms/use-validation-sse";
import { client, rpc } from "@/lib/api";
import { formatJapanLocaleDateTime } from "@/lib/formatters";

type ViewMode = "list" | "analytics";

interface FormResponsesState {
  page: number;
  keyword: string;
  debouncedKeyword: string;
  selectedResponseId: string | null;
  viewMode: ViewMode;
}

type FormResponsesAction =
  | { type: "reset" }
  | { type: "set-keyword"; keyword: string }
  | { type: "commit-keyword"; keyword: string }
  | { type: "select-response"; responseId: string }
  | { type: "close-detail" }
  | { type: "set-page"; page: number }
  | { type: "set-view-mode"; viewMode: ViewMode };

const initialFormResponsesState: FormResponsesState = {
  page: 1,
  keyword: "",
  debouncedKeyword: "",
  selectedResponseId: null,
  viewMode: "list",
};

function formResponsesReducer(
  state: FormResponsesState,
  action: FormResponsesAction,
): FormResponsesState {
  switch (action.type) {
    case "reset":
      return initialFormResponsesState;
    case "set-keyword":
      return { ...state, keyword: action.keyword, selectedResponseId: null };
    case "commit-keyword":
      return {
        ...state,
        debouncedKeyword: action.keyword,
        page: action.keyword !== state.debouncedKeyword ? 1 : state.page,
      };
    case "select-response":
      return { ...state, selectedResponseId: action.responseId };
    case "close-detail":
      return { ...state, selectedResponseId: null };
    case "set-page":
      return { ...state, page: action.page, selectedResponseId: null };
    case "set-view-mode":
      return { ...state, viewMode: action.viewMode };
  }
}

export function FormResponsesContent({ formId }: { formId: string }) {
  useValidationSSE(formId);

  const [state, dispatch] = useReducer(
    formResponsesReducer,
    initialFormResponsesState,
  );
  const limit = 20;

  // biome-ignore lint/correctness/useExhaustiveDependencies: Reset the list state when the active form changes.
  useEffect(() => {
    dispatch({ type: "reset" });
  }, [formId]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      dispatch({ type: "commit-keyword", keyword: state.keyword.trim() });
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [state.keyword]);

  const responsesQuery = useQuery({
    queryKey: [
      "formResponses",
      formId,
      state.page,
      limit,
      state.debouncedKeyword,
    ],
    queryFn: () =>
      rpc(
        client.api.forms[":id"].responses.$get({
          param: { id: formId },
          query: {
            page: String(state.page),
            limit: String(limit),
            ...(state.debouncedKeyword
              ? { keyword: state.debouncedKeyword }
              : {}),
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

  const data = responsesQuery.data;
  const hasCurrentPageData = data?.page === state.page;
  const isStalePageData =
    responsesQuery.isPlaceholderData ||
    (data !== undefined && !hasCurrentPageData);
  const hasNextPage = hasCurrentPageData ? data.hasNext : false;

  const handleSelectResponse = useCallback((responseId: string) => {
    dispatch({ type: "select-response", responseId });
  }, []);

  const handleCloseDetail = useCallback(() => {
    dispatch({ type: "close-detail" });
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    dispatch({ type: "set-page", page: newPage });
  }, []);

  const handleKeywordChange = useCallback((value: string) => {
    dispatch({ type: "set-keyword", keyword: value });
  }, []);

  return (
    <div className="space-y-4">
      {/* ツールバー */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">回答一覧</p>
        <div className="flex items-center gap-2">
          <ResponseExport formId={formId} />
          <fieldset className="flex rounded-md border">
            <legend className="sr-only">回答表示モード</legend>
            <button
              type="button"
              onClick={() =>
                dispatch({ type: "set-view-mode", viewMode: "list" })
              }
              aria-pressed={state.viewMode === "list"}
              className={[
                "flex items-center gap-1 px-3 py-1.5 text-sm transition-colors",
                state.viewMode === "list"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              ].join(" ")}
            >
              <List className="h-3.5 w-3.5" />
              リスト
            </button>
            <button
              type="button"
              onClick={() =>
                dispatch({ type: "set-view-mode", viewMode: "analytics" })
              }
              aria-pressed={state.viewMode === "analytics"}
              className={[
                "flex items-center gap-1 px-3 py-1.5 text-sm transition-colors",
                state.viewMode === "analytics"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              ].join(" ")}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              分析
            </button>
          </fieldset>
        </div>
      </div>

      {/* 分析ビュー */}
      {state.viewMode === "analytics" && (
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <FormResponseAnalytics formId={formId} />
        </section>
      )}

      {/* リストビュー */}
      {state.viewMode === "list" && (
        <div className="flex gap-4">
          {/* 回答リスト */}
          <section
            className={[
              "rounded-lg border bg-card p-6 shadow-sm",
              state.selectedResponseId ? "w-1/2" : "w-full",
            ].join(" ")}
          >
            {/* フィルタ */}
            <div className="mb-4">
              <ResponseFilter
                keyword={state.keyword}
                onKeywordChange={handleKeywordChange}
              />
            </div>

            {/* 読み込み中 */}
            {responsesQuery.isLoading && (
              <p className="text-sm text-muted-foreground">読み込み中...</p>
            )}
            {responsesQuery.isFetching && !responsesQuery.isLoading && (
              <p className="text-xs text-muted-foreground">
                {isStalePageData
                  ? "新しいページを読み込み中です。"
                  : "更新中..."}
              </p>
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
                      {state.debouncedKeyword
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
                          disabled={isStalePageData}
                          className={[
                            "flex w-full items-center justify-between rounded border p-3 text-left transition-colors hover:bg-muted/50",
                            isStalePageData
                              ? "cursor-not-allowed opacity-60 hover:bg-transparent"
                              : "",
                            state.selectedResponseId === response.id
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
                              {formatJapanLocaleDateTime(response.submittedAt)}
                            </span>
                            {response.updatedAt && (
                              <span className="text-xs text-muted-foreground">
                                更新:{" "}
                                {formatJapanLocaleDateTime(response.updatedAt)}
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
                {(state.page > 1 || hasNextPage) && (
                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      ページ {state.page}
                    </p>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(state.page - 1)}
                        disabled={state.page <= 1}
                      >
                        前へ
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(state.page + 1)}
                        disabled={!hasCurrentPageData || !hasNextPage}
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
          {state.selectedResponseId && (
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
                responseId={state.selectedResponseId}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
