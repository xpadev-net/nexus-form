import type {
  ResponsesListResponse,
  ValidationRevalidationResponse,
} from "@nexus-form/api/src/types/domain/form-responses";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { BarChart3, List, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { toast } from "sonner";
import { FormResponseAnalytics } from "@/components/forms/form-response-analytics";
import { ResponseDetailView } from "@/components/forms/response-detail-view";
import { ResponseExport } from "@/components/forms/response-export";
import {
  ResponseFilter,
  type ValidationFilterStatus,
} from "@/components/forms/response-filter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useValidationSSE } from "@/hooks/forms/use-validation-sse";
import { client, rpc } from "@/lib/api";
import { formatJapanLocaleDateTime } from "@/lib/formatters";

type ViewMode = "list" | "analytics";

export type { ValidationFilterStatus };

type RevalidationRequest = {
  responseIds: string[];
  clearSelectionOnSuccess: boolean;
};

interface FormResponsesState {
  page: number;
  keyword: string;
  debouncedKeyword: string;
  minScore: number | null;
  maxScore: number | null;
  validationStatus: ValidationFilterStatus | null;
  sort: "submittedAt" | "updatedAt" | "uniquenessScore";
  order: "asc" | "desc";
  selectedResponseId: string | null;
  selectedResponseIds: string[];
  viewMode: ViewMode;
}

type FormResponsesAction =
  | { type: "reset" }
  | { type: "set-keyword"; keyword: string }
  | { type: "commit-keyword"; keyword: string }
  | { type: "set-score-range"; min: number | null; max: number | null }
  | {
      type: "set-validation-status";
      validationStatus: ValidationFilterStatus | null;
    }
  | { type: "set-sort"; sort: "submittedAt" | "updatedAt" | "uniquenessScore" }
  | { type: "set-order"; order: "asc" | "desc" }
  | { type: "reset-filters" }
  | { type: "select-response"; responseId: string }
  | { type: "toggle-response-selection"; responseId: string }
  | { type: "clear-response-selection" }
  | { type: "close-detail" }
  | { type: "close-deleted-response"; responseId: string }
  | { type: "set-page"; page: number }
  | { type: "set-view-mode"; viewMode: ViewMode };

const initialFormResponsesState: FormResponsesState = {
  page: 1,
  keyword: "",
  debouncedKeyword: "",
  minScore: null,
  maxScore: null,
  validationStatus: null,
  sort: "submittedAt",
  order: "desc",
  selectedResponseId: null,
  selectedResponseIds: [],
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
      return {
        ...state,
        keyword: action.keyword,
        selectedResponseId: null,
        selectedResponseIds: [],
      };
    case "commit-keyword":
      return {
        ...state,
        debouncedKeyword: action.keyword,
        page: action.keyword !== state.debouncedKeyword ? 1 : state.page,
      };
    case "set-score-range":
      return {
        ...state,
        minScore: action.min,
        maxScore: action.max,
        page: 1,
        selectedResponseId: null,
        selectedResponseIds: [],
      };
    case "set-validation-status":
      return {
        ...state,
        validationStatus: action.validationStatus,
        page: 1,
        selectedResponseId: null,
        selectedResponseIds: [],
      };
    case "set-sort":
      return {
        ...state,
        sort: action.sort,
        page: 1,
      };
    case "set-order":
      return {
        ...state,
        order: action.order,
        page: 1,
      };
    case "reset-filters":
      return {
        ...state,
        keyword: "",
        debouncedKeyword: "",
        minScore: null,
        maxScore: null,
        validationStatus: null,
        sort: "submittedAt",
        order: "desc",
        page: 1,
        selectedResponseId: null,
        selectedResponseIds: [],
      };
    case "select-response":
      return { ...state, selectedResponseId: action.responseId };
    case "toggle-response-selection":
      return {
        ...state,
        selectedResponseIds: state.selectedResponseIds.includes(
          action.responseId,
        )
          ? state.selectedResponseIds.filter(
              (responseId) => responseId !== action.responseId,
            )
          : [...state.selectedResponseIds, action.responseId],
      };
    case "clear-response-selection":
      return { ...state, selectedResponseIds: [] };
    case "close-detail":
      return { ...state, selectedResponseId: null };
    case "close-deleted-response":
      return state.selectedResponseId === action.responseId
        ? {
            ...state,
            selectedResponseId: null,
            selectedResponseIds: state.selectedResponseIds.filter(
              (selectedId) => selectedId !== action.responseId,
            ),
          }
        : {
            ...state,
            selectedResponseIds: state.selectedResponseIds.filter(
              (selectedId) => selectedId !== action.responseId,
            ),
          };
    case "set-page":
      return {
        ...state,
        page: action.page,
        selectedResponseId: null,
        selectedResponseIds: [],
      };
    case "set-view-mode":
      return { ...state, viewMode: action.viewMode };
  }
}

export function FormResponsesContent({
  formId,
  shareToken,
}: {
  formId: string;
  shareToken?: string;
}) {
  useValidationSSE(formId, shareToken);
  const queryClient = useQueryClient();

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
      state.minScore,
      state.maxScore,
      state.validationStatus,
      state.sort,
      state.order,
    ],
    queryFn: () =>
      rpc(
        client.api.forms[":id"].responses.$get({
          param: { id: formId },
          query: {
            page: String(state.page),
            limit: String(limit),
            ...(state.debouncedKeyword ? { q: state.debouncedKeyword } : {}),
            ...(state.minScore !== null
              ? { minScore: String(state.minScore) }
              : {}),
            ...(state.maxScore !== null
              ? { maxScore: String(state.maxScore) }
              : {}),
            ...(state.validationStatus
              ? { validationStatus: state.validationStatus }
              : {}),
            sort: state.sort,
            order: state.order,
          },
        }),
      ),
    placeholderData: keepPreviousData,
  });

  const deleteResponseMutation = useMutation({
    mutationFn: (responseId: string) =>
      rpc(
        client.api.forms[":id"].responses[":responseId"].$delete({
          param: { id: formId, responseId },
        }),
      ),
    onSuccess: async (_data, responseId) => {
      dispatch({ type: "close-deleted-response", responseId });
      queryClient.setQueriesData<ResponsesListResponse>(
        { queryKey: ["formResponses", formId] },
        (current) => {
          if (!current) return current;
          return {
            ...current,
            responses: current.responses.filter(
              (response) => response.id !== responseId,
            ),
          };
        },
      );
      toast.success("回答を削除しました");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["formResponses", formId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["validationResults", formId, responseId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["responseAnalytics", formId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["responseAggregate", formId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["responseStatuses", formId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["responseBlockAnalytics", formId],
        }),
      ]);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "回答の削除に失敗しました",
      );
    },
  });

  const invalidateRevalidationQueries = useCallback(
    async (responseIds: string[]) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["formResponses", formId],
        }),
        ...responseIds.map((responseId) =>
          queryClient.invalidateQueries({
            queryKey: ["validationResults", formId, responseId],
          }),
        ),
        queryClient.invalidateQueries({
          queryKey: ["responseAnalytics", formId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["responseAggregate", formId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["responseStatuses", formId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["responseBlockAnalytics", formId],
        }),
      ]);
    },
    [formId, queryClient],
  );

  const revalidateResponsesMutation = useMutation({
    mutationFn: ({ responseIds }: RevalidationRequest) => {
      if (responseIds.length === 1) {
        const [responseId] = responseIds;
        if (!responseId) {
          throw new Error("再検証する回答を選択してください");
        }
        return rpc(
          client.api.forms[":id"].responses[
            ":responseId"
          ].validation.revalidate.$post({
            param: { id: formId, responseId },
          }),
        );
      }

      return rpc(
        client.api.forms[":id"].responses.validation.revalidate.$post({
          param: { id: formId },
          json: { responseIds },
        }),
      );
    },
    onSuccess: async (
      result: ValidationRevalidationResponse,
      { responseIds, clearSelectionOnSuccess },
    ) => {
      await invalidateRevalidationQueries(responseIds);
      const message =
        result.enqueued > 0 && result.skipped > 0
          ? `${result.enqueued}件の再検証を開始しました。${result.skipped}件はスキップされました。`
          : result.enqueued > 0
            ? `${result.enqueued}件の再検証を開始しました。`
            : `${result.skipped}件の回答は再検証対象がないためスキップされました。`;

      if (result.enqueued > 0 && result.skipped > 0) {
        toast.warning(message);
      } else if (result.enqueued > 0) {
        toast.success(message);
      } else {
        toast.info(message);
      }

      if (clearSelectionOnSuccess) {
        dispatch({ type: "clear-response-selection" });
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "回答の再検証に失敗しました",
      );
    },
  });

  const data = responsesQuery.data;
  const hasCurrentPageData = data?.page === state.page;
  const isStalePageData =
    responsesQuery.isPlaceholderData ||
    (data !== undefined && !hasCurrentPageData);
  const hasNextPage = hasCurrentPageData ? data.hasNext : false;
  const isKeywordCommitPending =
    state.keyword.trim() !== state.debouncedKeyword;
  const isSearching =
    state.viewMode === "list" &&
    (isKeywordCommitPending ||
      (state.debouncedKeyword !== "" &&
        (responsesQuery.isLoading || responsesQuery.isFetching))) &&
    !responsesQuery.isError;

  const handleSelectResponse = useCallback((responseId: string) => {
    dispatch({ type: "select-response", responseId });
  }, []);

  const handleCloseDetail = useCallback(() => {
    dispatch({ type: "close-detail" });
  }, []);

  const handleDeleteSelectedResponse = useCallback(() => {
    if (!state.selectedResponseId) return;
    deleteResponseMutation.mutate(state.selectedResponseId);
  }, [deleteResponseMutation, state.selectedResponseId]);

  const handleRevalidateSelectedResponses = useCallback(() => {
    if (state.selectedResponseIds.length === 0) return;
    revalidateResponsesMutation.mutate({
      responseIds: state.selectedResponseIds,
      clearSelectionOnSuccess: true,
    });
  }, [revalidateResponsesMutation, state.selectedResponseIds]);

  const handleRevalidateCurrentResponse = useCallback(() => {
    if (!state.selectedResponseId) return;
    revalidateResponsesMutation.mutate({
      responseIds: [state.selectedResponseId],
      clearSelectionOnSuccess: false,
    });
  }, [revalidateResponsesMutation, state.selectedResponseId]);

  const handlePageChange = useCallback((newPage: number) => {
    dispatch({ type: "set-page", page: newPage });
  }, []);

  const handleKeywordChange = useCallback((value: string) => {
    dispatch({ type: "set-keyword", keyword: value });
  }, []);

  const selectedResponseIdSet = useMemo(
    () => new Set(state.selectedResponseIds),
    [state.selectedResponseIds],
  );
  const isActionPending =
    deleteResponseMutation.isPending || revalidateResponsesMutation.isPending;

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
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* 回答リスト */}
          <section
            className={[
              "rounded-lg border bg-card p-6 shadow-sm",
              state.selectedResponseId ? "w-full lg:w-1/2" : "w-full",
            ].join(" ")}
          >
            {/* フィルタ */}
            <div className="mb-4">
              <ResponseFilter
                keyword={state.keyword}
                onKeywordChange={handleKeywordChange}
                minScore={state.minScore}
                maxScore={state.maxScore}
                onScoreRangeChange={(min, max) =>
                  dispatch({ type: "set-score-range", min, max })
                }
                validationStatus={state.validationStatus}
                onValidationStatusChange={(status) =>
                  dispatch({
                    type: "set-validation-status",
                    validationStatus: status,
                  })
                }
                sort={state.sort}
                onSortChange={(sort) => dispatch({ type: "set-sort", sort })}
                order={state.order}
                onOrderChange={(order) =>
                  dispatch({ type: "set-order", order })
                }
                onResetFilters={() => dispatch({ type: "reset-filters" })}
              />
            </div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-sm text-muted-foreground">
                {state.selectedResponseIds.length > 0
                  ? `${state.selectedResponseIds.length}件を選択中`
                  : "回答を選択して再検証できます"}
              </p>
              <div className="flex items-center gap-2">
                {state.selectedResponseIds.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      dispatch({ type: "clear-response-selection" })
                    }
                    disabled={isActionPending}
                  >
                    選択解除
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRevalidateSelectedResponses}
                  disabled={
                    state.selectedResponseIds.length === 0 ||
                    isStalePageData ||
                    isActionPending
                  }
                >
                  {revalidateResponsesMutation.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  選択を再検証
                </Button>
              </div>
            </div>

            {/* 読み込み中 */}
            {isSearching && (
              <p
                className="text-sm text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                検索中...
              </p>
            )}
            {responsesQuery.isLoading && !isSearching && (
              <p className="text-sm text-muted-foreground">読み込み中...</p>
            )}
            {responsesQuery.isFetching &&
              !responsesQuery.isLoading &&
              !isSearching &&
              !responsesQuery.isError && (
                <p className="text-xs text-muted-foreground">
                  {isStalePageData
                    ? "新しいページを読み込み中です。"
                    : "更新中..."}
                </p>
              )}

            {/* エラー */}
            {responsesQuery.isError && (
              <div
                className="space-y-2 rounded border border-destructive/30 bg-destructive/5 p-3"
                role="alert"
              >
                <p className="text-sm text-destructive">
                  {responsesQuery.error instanceof Error
                    ? responsesQuery.error.message
                    : "回答一覧を読み込めませんでした。"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="form-responses-query-retry"
                  onClick={() => void responsesQuery.refetch()}
                >
                  再読み込み
                </Button>
              </div>
            )}

            {/* 回答リスト */}
            {data && !responsesQuery.isError && (
              <>
                {data.responses.length === 0 && !isSearching ? (
                  <div className="flex flex-col items-center gap-2 rounded border border-dashed p-8 text-muted-foreground">
                    <p className="text-sm">
                      {state.debouncedKeyword ||
                      state.minScore !== null ||
                      state.maxScore !== null ||
                      state.validationStatus
                        ? "検索条件に一致する回答はありません。"
                        : "回答はまだありません。"}
                    </p>
                  </div>
                ) : data.responses.length > 0 ? (
                  <ul className="space-y-2">
                    {data.responses.map((response) => (
                      <li key={response.id}>
                        <div
                          className={[
                            "flex w-full items-start gap-3 rounded border p-3 transition-colors hover:bg-muted/50",
                            isStalePageData
                              ? "cursor-not-allowed opacity-60 hover:bg-transparent"
                              : "",
                            state.selectedResponseId === response.id
                              ? "border-primary bg-primary/5"
                              : "",
                          ].join(" ")}
                        >
                          <input
                            type="checkbox"
                            aria-label={`回答 #${response.id.slice(0, 8)} を選択`}
                            checked={selectedResponseIdSet.has(response.id)}
                            disabled={isStalePageData || isActionPending}
                            onChange={() =>
                              dispatch({
                                type: "toggle-response-selection",
                                responseId: response.id,
                              })
                            }
                            className="mt-1 h-4 w-4 rounded border-input"
                          />
                          <button
                            type="button"
                            onClick={() => handleSelectResponse(response.id)}
                            disabled={isStalePageData}
                            className="flex min-w-0 flex-1 items-center justify-between text-left disabled:cursor-not-allowed"
                          >
                            <span className="flex flex-col gap-1">
                              <span className="flex items-center gap-2">
                                <span className="text-sm font-medium">
                                  {response.respondentUuid
                                    ? `回答者: ${response.respondentUuid.slice(0, 8)}...`
                                    : `回答 #${response.id.slice(0, 8)}`}
                                </span>
                                {response.validationStatus && (
                                  <Badge
                                    variant={
                                      response.validationStatus ===
                                        "COMPLETED" &&
                                      response.validationSuccess !== false
                                        ? "default"
                                        : response.validationStatus ===
                                              "FAILED" ||
                                            response.validationSuccess === false
                                          ? "destructive"
                                          : response.validationStatus ===
                                              "PENDING"
                                            ? "secondary"
                                            : "outline"
                                    }
                                    className="px-1.5 py-0 text-[10px]"
                                  >
                                    {response.validationStatus ===
                                      "COMPLETED" &&
                                    response.validationSuccess !== false
                                      ? "検証成功"
                                      : response.validationStatus ===
                                            "FAILED" ||
                                          response.validationSuccess === false
                                        ? "検証失敗"
                                        : response.validationStatus ===
                                            "PENDING"
                                          ? "検証待機中"
                                          : response.validationStatus ===
                                              "PROCESSING"
                                            ? "検証処理中"
                                            : "参照欠落"}
                                  </Badge>
                                )}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                提出:{" "}
                                {formatJapanLocaleDateTime(
                                  response.submittedAt,
                                )}
                              </span>
                              {response.updatedAt && (
                                <span className="text-xs text-muted-foreground">
                                  更新:{" "}
                                  {formatJapanLocaleDateTime(
                                    response.updatedAt,
                                  )}
                                </span>
                              )}
                              {typeof response.uniquenessScore === "number" && (
                                <span className="text-xs text-muted-foreground">
                                  ユニーク度:{" "}
                                  {response.uniquenessScore.toFixed(4)}
                                </span>
                              )}
                            </span>
                            {response.countryCode && (
                              <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                                {response.countryCode}
                              </span>
                            )}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}

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
                        disabled={state.page <= 1 || isActionPending}
                      >
                        前へ
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(state.page + 1)}
                        disabled={
                          !hasCurrentPageData || !hasNextPage || isActionPending
                        }
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
            <section className="w-full rounded-lg border bg-card p-6 shadow-sm lg:w-1/2">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">回答詳細</h2>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    aria-label="回答を再検証"
                    onClick={handleRevalidateCurrentResponse}
                    disabled={isActionPending}
                  >
                    {revalidateResponsesMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        aria-label="回答を削除"
                        disabled={isActionPending}
                      >
                        {deleteResponseMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          回答を削除しますか？
                        </AlertDialogTitle>
                        <AlertDialogDescription className="space-y-2">
                          <span className="block">
                            回答 #{state.selectedResponseId.slice(0, 8)}
                            を削除します。この操作は取り消せません。
                          </span>
                          <span className="block">
                            関連する検証結果も削除され、一覧・分析・エクスポートから除外されます。
                          </span>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={isActionPending}>
                          キャンセル
                        </AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={handleDeleteSelectedResponse}
                          disabled={isActionPending}
                        >
                          削除する
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCloseDetail}
                    className="h-8 w-8 p-0"
                    aria-label="回答詳細を閉じる"
                    disabled={isActionPending}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
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
