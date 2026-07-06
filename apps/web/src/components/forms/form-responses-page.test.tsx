// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useValidationSSE } from "@/hooks/forms/use-validation-sse";
import { FormResponsesContent } from "./form-responses-page";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ResponsesQueryState = {
  data:
    | {
        responses: {
          countryCode: string;
          id: string;
          respondentUuid: string;
          submittedAt: string;
          uniquenessScore: number;
          updatedAt: string | null;
        }[];
        hasNext: boolean;
        page: number;
        limit: number;
      }
    | undefined;
  error: Error | null;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  isPlaceholderData: boolean;
  refetch: () => void;
};

type CapturedUseQueryOptions = {
  queryFn: () => unknown;
  queryKey: readonly unknown[];
};

type CapturedUseMutationOptions = {
  mutationFn: (variables: unknown) => Promise<unknown>;
  onError?: (error: unknown, variables: unknown) => void;
  onSuccess?: (data: unknown, variables: unknown) => void | Promise<void>;
};

function renderResponses(container: HTMLElement, shareToken?: string): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <FormResponsesContent formId="form-1" shareToken={shareToken} />,
    );
  });
  return root;
}

const queryMock = vi.hoisted(
  (): {
    invalidateQueries: ReturnType<typeof vi.fn>;
    isDeletePending: boolean;
    isRevalidatePending: boolean;
    lastOptions: CapturedUseQueryOptions | null;
    mutationOptions: CapturedUseMutationOptions | null;
    refetch: ReturnType<typeof vi.fn<ResponsesQueryState["refetch"]>>;
    setQueriesData: ReturnType<typeof vi.fn>;
    state: ResponsesQueryState;
  } => ({
    invalidateQueries: vi.fn(() => Promise.resolve()),
    isDeletePending: false,
    isRevalidatePending: false,
    lastOptions: null,
    mutationOptions: null,
    refetch: vi.fn<ResponsesQueryState["refetch"]>(),
    setQueriesData: vi.fn(),
    state: {
      data: {
        responses: [
          {
            countryCode: "JP",
            id: "response-1",
            respondentUuid: "respondent-uuid-1",
            submittedAt: "2026-01-01T00:00:00.000Z",
            uniquenessScore: 1,
            updatedAt: null,
          },
        ],
        hasNext: false,
        page: 1,
        limit: 20,
      },
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      isPlaceholderData: false,
      refetch: vi.fn<ResponsesQueryState["refetch"]>(),
    },
  }),
);

const apiMock = vi.hoisted(() => ({
  deleteResponse: vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ ok: true }))),
  ),
  getResponses: vi.fn(() => Promise.resolve({ ok: true })),
  revalidateResponses: vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          enqueued: 1,
          skipped: 0,
          jobIds: ["job-1"],
          results: [{ responseId: "response-1", status: "enqueued" }],
        }),
      ),
    ),
  ),
  revalidateSingleResponse: vi.fn(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          enqueued: 1,
          skipped: 0,
          jobIds: ["job-1"],
          results: [{ responseId: "response-1", status: "enqueued" }],
        }),
      ),
    ),
  ),
  rpc: vi.fn(async (value: unknown) => {
    const resolved = await value;
    if (resolved instanceof Response) {
      if (!resolved.ok) {
        const payload = (await resolved.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? `HTTP ${resolved.status}`);
      }
      return resolved.json();
    }
    return resolved;
  }),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

const filterMock = vi.hoisted(
  (): {
    onKeywordChange: ((value: string) => void) | null;
  } => ({
    onKeywordChange: null,
  }),
);

vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: Symbol("keepPreviousData"),
  useMutation: (options: CapturedUseMutationOptions) => {
    queryMock.mutationOptions = options;
    return {
      isPending: queryMock.isDeletePending || queryMock.isRevalidatePending,
      mutate: async (variables: unknown) => {
        try {
          const data = await options.mutationFn(variables);
          await options.onSuccess?.(data, variables);
        } catch (error) {
          options.onError?.(error, variables);
        }
      },
    };
  },
  useQuery: (options: CapturedUseQueryOptions) => {
    queryMock.lastOptions = options;
    return queryMock.state;
  },
  useQueryClient: () => ({
    invalidateQueries: queryMock.invalidateQueries,
    setQueriesData: queryMock.setQueriesData,
  }),
}));

vi.mock("@/hooks/forms/use-validation-sse", () => ({
  useValidationSSE: vi.fn(),
}));
vi.mock("@/components/forms/form-response-analytics", () => ({
  FormResponseAnalytics: () => <section data-testid="analytics" />,
}));
vi.mock("@/components/forms/response-detail-view", () => ({
  ResponseDetailView: ({ responseId }: { responseId: string }) => (
    <section data-testid="response-detail">{responseId}</section>
  ),
}));
vi.mock("@/components/forms/response-export", () => ({
  ResponseExport: () => <button type="button">Export</button>,
}));
vi.mock("@/components/forms/response-filter", () => ({
  ResponseFilter: ({
    keyword,
    onKeywordChange,
  }: {
    keyword: string;
    onKeywordChange: (value: string) => void;
  }) => {
    filterMock.onKeywordChange = onKeywordChange;
    return (
      <label>
        Filter
        <input
          value={keyword}
          onChange={(event) => onKeywordChange(event.currentTarget.value)}
        />
      </label>
    );
  },
}));
vi.mock("@/components/ui/alert-dialog", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const DialogContext = React.createContext<{
    open: boolean;
    setOpen: (open: boolean) => void;
  } | null>(null);

  const useDialogContext = () => {
    const context = React.useContext(DialogContext);
    if (!context) throw new Error("AlertDialog context is missing");
    return context;
  };

  return {
    AlertDialog: ({ children }: { children: ReactNode }) => {
      const [open, setOpen] = React.useState(false);
      return (
        <DialogContext.Provider value={{ open, setOpen }}>
          <div>{children}</div>
        </DialogContext.Provider>
      );
    },
    AlertDialogAction: ({
      children,
      onClick,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      children: ReactNode;
    }) => {
      const { setOpen } = useDialogContext();
      return (
        <button
          {...props}
          onClick={(event) => {
            onClick?.(event);
            setOpen(false);
          }}
        >
          {children}
        </button>
      );
    },
    AlertDialogCancel: ({
      children,
      onClick,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      children: ReactNode;
    }) => {
      const { setOpen } = useDialogContext();
      return (
        <button
          {...props}
          onClick={(event) => {
            onClick?.(event);
            setOpen(false);
          }}
        >
          {children}
        </button>
      );
    },
    AlertDialogContent: ({ children }: { children: ReactNode }) => {
      const { open } = useDialogContext();
      return open ? <div>{children}</div> : null;
    },
    AlertDialogDescription: ({ children }: { children: ReactNode }) => (
      <p>{children}</p>
    ),
    AlertDialogFooter: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogHeader: ({ children }: { children: ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogTitle: ({ children }: { children: ReactNode }) => (
      <h2>{children}</h2>
    ),
    AlertDialogTrigger: ({
      children,
    }: {
      children: React.ReactElement<
        React.ButtonHTMLAttributes<HTMLButtonElement>
      >;
    }) => {
      const { setOpen } = useDialogContext();
      return React.cloneElement(children, {
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          children.props.onClick?.(event);
          setOpen(true);
        },
      });
    },
  };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: ReactNode;
  }) => <button {...props}>{children}</button>,
}));
vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        ":id": {
          responses: {
            ":responseId": {
              $delete: apiMock.deleteResponse,
              validation: {
                revalidate: {
                  $post: apiMock.revalidateSingleResponse,
                },
              },
            },
            validation: {
              revalidate: {
                $post: apiMock.revalidateResponses,
              },
            },
            $get: apiMock.getResponses,
          },
        },
      },
    },
  },
  rpc: apiMock.rpc,
}));
vi.mock("sonner", () => ({
  toast: {
    error: apiMock.toastError,
    info: apiMock.toastInfo,
    success: apiMock.toastSuccess,
    warning: apiMock.toastWarning,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  filterMock.onKeywordChange = null;
  queryMock.isDeletePending = false;
  queryMock.isRevalidatePending = false;
  queryMock.lastOptions = null;
  queryMock.mutationOptions = null;
  queryMock.invalidateQueries.mockResolvedValue(undefined);
  queryMock.setQueriesData.mockImplementation((_filter, updater) => {
    queryMock.state.data = updater(queryMock.state.data);
  });
  apiMock.deleteResponse.mockResolvedValue(
    new Response(JSON.stringify({ ok: true })),
  );
  apiMock.revalidateResponses.mockResolvedValue(
    new Response(
      JSON.stringify({
        enqueued: 1,
        skipped: 0,
        jobIds: ["job-1"],
        results: [{ responseId: "response-1", status: "enqueued" }],
      }),
    ),
  );
  apiMock.revalidateSingleResponse.mockResolvedValue(
    new Response(
      JSON.stringify({
        enqueued: 1,
        skipped: 0,
        jobIds: ["job-1"],
        results: [{ responseId: "response-1", status: "enqueued" }],
      }),
    ),
  );
  queryMock.state = {
    data: {
      responses: [
        {
          countryCode: "JP",
          id: "response-1",
          respondentUuid: "respondent-uuid-1",
          submittedAt: "2026-01-01T00:00:00.000Z",
          uniquenessScore: 1,
          updatedAt: null,
        },
      ],
      hasNext: false,
      page: 1,
      limit: 20,
    },
    error: null,
    isError: false,
    isFetching: false,
    isLoading: false,
    isPlaceholderData: false,
    refetch: queryMock.refetch,
  };
});

describe("FormResponsesContent accessibility", () => {
  it("passes shareToken to validation SSE", () => {
    const container = document.createElement("div");
    const root = renderResponses(container, "shared-editor-token");

    expect(useValidationSSE).toHaveBeenCalledWith(
      "form-1",
      "shared-editor-token",
    );

    act(() => root.unmount());
  });

  it("labels the response detail close button and exposes view toggle state", () => {
    const container = document.createElement("div");
    const root = renderResponses(container);

    const listButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("リスト"),
    );
    const analyticsButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("分析"));

    expect(listButton?.getAttribute("aria-pressed")).toBe("true");
    expect(analyticsButton?.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector("fieldset > legend")?.textContent).toBe(
      "回答表示モード",
    );
    expect(container.textContent).toContain("ユニーク度: 1.0000");

    const responseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回答者:"));
    expect(responseButton).toBeDefined();

    act(() => {
      responseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector('button[aria-label="回答詳細を閉じる"]'),
    ).not.toBeNull();

    act(() => root.unmount());
  });

  it("clears selection on page change and disables stale placeholder rows", () => {
    queryMock.state = {
      ...queryMock.state,
      data: {
        responses: [
          {
            countryCode: "JP",
            id: "response-1",
            respondentUuid: "respondent-uuid-1",
            submittedAt: "2026-01-01T00:00:00.000Z",
            uniquenessScore: 1,
            updatedAt: null,
          },
        ],
        hasNext: true,
        page: 1,
        limit: 20,
      },
    };
    const container = document.createElement("div");
    const root = renderResponses(container);

    const initialResponseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回答者:"));
    expect(initialResponseButton).toBeDefined();

    act(() => {
      initialResponseButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(
      container.querySelector("[data-testid='response-detail']"),
    ).not.toBeNull();

    const nextButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "次へ",
    );
    expect(nextButton).toBeDefined();

    act(() => {
      nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector("[data-testid='response-detail']"),
    ).toBeNull();

    queryMock.state = {
      ...queryMock.state,
      isFetching: true,
      isPlaceholderData: true,
    };

    act(() => {
      root.render(<FormResponsesContent formId="form-1" />);
    });

    expect(container.textContent).toContain("新しいページを読み込み中です。");

    const responseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回答者:"));

    expect(responseButton).toBeDefined();
    expect(responseButton?.disabled).toBe(true);

    act(() => {
      responseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelector("[data-testid='response-detail']"),
    ).toBeNull();

    act(() => root.unmount());
  });

  it("shows a retryable error state without rendering the empty state", () => {
    queryMock.state = {
      ...queryMock.state,
      data: undefined,
      error: new Error("回答一覧を読み込めませんでした。"),
      isError: true,
    };
    const container = document.createElement("div");
    const root = renderResponses(container);

    expect(container.textContent).toContain("回答一覧を読み込めませんでした。");
    expect(container.textContent).not.toContain("回答はまだありません。");

    const retryButton = container.querySelector(
      'button[data-testid="form-responses-query-retry"]',
    );
    expect(retryButton).not.toBeNull();

    act(() => {
      retryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(queryMock.refetch).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });

  it("passes the committed search term as q", () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const root = renderResponses(container);
    expect(filterMock.onKeywordChange).not.toBeNull();

    act(() => {
      filterMock.onKeywordChange?.("Needle");
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(queryMock.lastOptions?.queryKey).toContain("Needle");

    queryMock.lastOptions?.queryFn();
    expect(apiMock.getResponses).toHaveBeenLastCalledWith({
      param: { id: "form-1" },
      query: {
        page: "1",
        limit: "20",
        q: "Needle",
      },
    });

    act(() => root.unmount());
  });

  it("cancels response deletion without calling the API", () => {
    const container = document.createElement("div");
    const root = renderResponses(container);

    const responseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回答者:"));

    act(() => {
      responseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const openDeleteDialogButton = container.querySelector(
      'button[aria-label="回答を削除"]',
    );
    expect(openDeleteDialogButton).not.toBeNull();

    act(() => {
      openDeleteDialogButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const cancelButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "キャンセル",
    );
    expect(cancelButton).toBeDefined();

    act(() => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(apiMock.deleteResponse).not.toHaveBeenCalled();
    expect(
      container.querySelector("[data-testid='response-detail']"),
    ).not.toBeNull();

    act(() => root.unmount());
  });

  it("deletes the selected response, clears detail, updates cached list, and invalidates dependent queries", async () => {
    const container = document.createElement("div");
    const root = renderResponses(container);

    const responseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回答者:"));

    act(() => {
      responseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const openDeleteDialogButton = container.querySelector(
      'button[aria-label="回答を削除"]',
    );
    expect(openDeleteDialogButton).not.toBeNull();

    act(() => {
      openDeleteDialogButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("回答 #response");
    expect(
      container.querySelector("[data-testid='response-detail']"),
    ).not.toBeNull();

    const deleteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "削除する",
    );
    expect(deleteButton).toBeDefined();

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(apiMock.deleteResponse).toHaveBeenCalledWith({
      param: { id: "form-1", responseId: "response-1" },
    });
    expect(apiMock.toastSuccess).toHaveBeenCalledWith("回答を削除しました");
    expect(
      container.querySelector("[data-testid='response-detail']"),
    ).toBeNull();
    expect(queryMock.state.data?.responses).toEqual([]);
    expect(queryMock.setQueriesData).toHaveBeenCalledWith(
      { queryKey: ["formResponses", "form-1"] },
      expect.any(Function),
    );
    expect(queryMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["formResponses", "form-1"],
    });
    expect(queryMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["validationResults", "form-1", "response-1"],
    });
    expect(queryMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["responseAnalytics", "form-1"],
    });
    expect(queryMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["responseAggregate", "form-1"],
    });
    expect(queryMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["responseStatuses", "form-1"],
    });
    expect(queryMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["responseBlockAnalytics", "form-1"],
    });

    act(() => root.unmount());
  });

  it("revalidates selected responses, clears selection, and invalidates dependent queries", async () => {
    queryMock.state = {
      ...queryMock.state,
      data: {
        responses: [
          {
            countryCode: "JP",
            id: "response-1",
            respondentUuid: "respondent-uuid-1",
            submittedAt: "2026-01-01T00:00:00.000Z",
            uniquenessScore: 1,
            updatedAt: null,
          },
          {
            countryCode: "US",
            id: "response-2",
            respondentUuid: "respondent-uuid-2",
            submittedAt: "2026-01-02T00:00:00.000Z",
            uniquenessScore: 0.5,
            updatedAt: null,
          },
        ],
        hasNext: false,
        page: 1,
        limit: 20,
      },
    };
    apiMock.revalidateResponses.mockResolvedValue(
      new Response(
        JSON.stringify({
          enqueued: 1,
          skipped: 1,
          jobIds: ["job-1"],
          results: [
            { responseId: "response-1", status: "enqueued" },
            {
              responseId: "response-2",
              status: "skipped",
              reason: "no_validation_rules",
            },
          ],
        }),
      ),
    );
    const container = document.createElement("div");
    const root = renderResponses(container);

    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    expect(checkboxes).toHaveLength(2);

    act(() => {
      checkboxes[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      checkboxes[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("2件を選択中");

    const revalidateButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("選択を再検証"));
    expect(revalidateButton).toBeDefined();

    await act(async () => {
      revalidateButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(apiMock.revalidateResponses).toHaveBeenCalledWith({
      param: { id: "form-1" },
      json: { responseIds: ["response-1", "response-2"] },
    });
    expect(apiMock.revalidateSingleResponse).not.toHaveBeenCalled();
    expect(apiMock.toastWarning).toHaveBeenCalledWith(
      "1件の再検証を開始しました。1件はスキップされました。",
    );
    expect(queryMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["formResponses", "form-1"],
    });
    expect(queryMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["validationResults", "form-1", "response-1"],
    });
    expect(queryMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["validationResults", "form-1", "response-2"],
    });
    expect(queryMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["responseStatuses", "form-1"],
    });
    expect(container.textContent).toContain("回答を選択して再検証できます");

    act(() => root.unmount());
  });

  it("revalidates the selected detail with the single response endpoint", async () => {
    const container = document.createElement("div");
    const root = renderResponses(container);

    const responseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回答者:"));

    act(() => {
      responseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const revalidateButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="回答を再検証"]',
    );
    expect(revalidateButton).not.toBeNull();

    await act(async () => {
      revalidateButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(apiMock.revalidateSingleResponse).toHaveBeenCalledWith({
      param: { id: "form-1", responseId: "response-1" },
    });
    expect(apiMock.revalidateResponses).not.toHaveBeenCalled();
    expect(apiMock.toastSuccess).toHaveBeenCalledWith(
      "1件の再検証を開始しました。",
    );
    expect(queryMock.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["validationResults", "form-1", "response-1"],
    });

    act(() => root.unmount());
  });

  it("preserves checked responses when revalidating from the detail panel", async () => {
    const container = document.createElement("div");
    const root = renderResponses(container);

    const checkbox = container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkbox).not.toBeNull();

    act(() => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("1件を選択中");

    const responseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回答者:"));

    act(() => {
      responseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const revalidateButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="回答を再検証"]',
    );

    await act(async () => {
      revalidateButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(apiMock.revalidateSingleResponse).toHaveBeenCalledWith({
      param: { id: "form-1", responseId: "response-1" },
    });
    expect(container.textContent).toContain("1件を選択中");
    expect(checkbox?.checked).toBe(true);

    act(() => root.unmount());
  });

  it("keeps selection and shows an error toast when revalidation fails", async () => {
    apiMock.revalidateSingleResponse.mockResolvedValue(
      new Response(JSON.stringify({ error: "Response not found" }), {
        status: 404,
      }),
    );
    const container = document.createElement("div");
    const root = renderResponses(container);

    const responseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回答者:"));

    act(() => {
      responseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const revalidateButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="回答を再検証"]',
    );

    await act(async () => {
      revalidateButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(apiMock.toastError).toHaveBeenCalledWith("Response not found");
    expect(apiMock.toastSuccess).not.toHaveBeenCalled();
    expect(queryMock.invalidateQueries).not.toHaveBeenCalled();
    expect(
      container.querySelector("[data-testid='response-detail']"),
    ).not.toBeNull();

    act(() => root.unmount());
  });

  it("shows skipped-only revalidation outcome without optimistic success", async () => {
    apiMock.revalidateSingleResponse.mockResolvedValue(
      new Response(
        JSON.stringify({
          enqueued: 0,
          skipped: 1,
          jobIds: [],
          results: [
            {
              responseId: "response-1",
              status: "skipped",
              reason: "no_validation_rules",
            },
          ],
        }),
      ),
    );
    const container = document.createElement("div");
    const root = renderResponses(container);

    const responseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回答者:"));

    act(() => {
      responseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const revalidateButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="回答を再検証"]',
    );

    await act(async () => {
      revalidateButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(apiMock.toastInfo).toHaveBeenCalledWith(
      "1件の回答は再検証対象がないためスキップされました。",
    );
    expect(apiMock.toastSuccess).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it("keeps the selected detail visible and shows an error toast when deletion fails", async () => {
    apiMock.deleteResponse.mockResolvedValue(
      new Response(JSON.stringify({ error: "Response not found" }), {
        status: 404,
      }),
    );
    const container = document.createElement("div");
    const root = renderResponses(container);

    const responseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回答者:"));

    act(() => {
      responseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const openDeleteDialogButton = container.querySelector(
      'button[aria-label="回答を削除"]',
    );
    expect(openDeleteDialogButton).not.toBeNull();

    act(() => {
      openDeleteDialogButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const deleteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "削除する",
    );

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(apiMock.toastError).toHaveBeenCalledWith("Response not found");
    expect(apiMock.toastSuccess).not.toHaveBeenCalled();
    expect(queryMock.setQueriesData).not.toHaveBeenCalled();
    expect(queryMock.invalidateQueries).not.toHaveBeenCalled();
    expect(
      container.querySelector("[data-testid='response-detail']"),
    ).not.toBeNull();
    expect(queryMock.state.data?.responses).toHaveLength(1);

    act(() => root.unmount());
  });

  it("disables response delete and close controls while deletion is pending", () => {
    queryMock.isDeletePending = true;
    const container = document.createElement("div");
    const root = renderResponses(container);

    const responseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回答者:"));

    act(() => {
      responseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const deleteControl = container.querySelector<HTMLButtonElement>(
      'button[aria-label="回答を削除"]',
    );
    const closeControl = container.querySelector<HTMLButtonElement>(
      'button[aria-label="回答詳細を閉じる"]',
    );

    expect(deleteControl?.disabled).toBe(true);
    expect(closeControl?.disabled).toBe(true);
    expect(deleteControl?.querySelector(".animate-spin")).not.toBeNull();

    act(() => root.unmount());
  });

  it("does not close a newly selected detail when an older delete finishes", async () => {
    let resolveDelete: (response: Response) => void = () => {};
    apiMock.deleteResponse.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveDelete = resolve;
      }),
    );
    queryMock.state = {
      ...queryMock.state,
      data: {
        responses: [
          {
            countryCode: "JP",
            id: "response-1",
            respondentUuid: "respondent-uuid-1",
            submittedAt: "2026-01-01T00:00:00.000Z",
            uniquenessScore: 1,
            updatedAt: null,
          },
          {
            countryCode: "US",
            id: "response-2",
            respondentUuid: "respondent-uuid-2",
            submittedAt: "2026-01-02T00:00:00.000Z",
            uniquenessScore: 0.5,
            updatedAt: null,
          },
        ],
        hasNext: false,
        page: 1,
        limit: 20,
      },
    };
    const container = document.createElement("div");
    const root = renderResponses(container);

    const responseButtons = Array.from(
      container.querySelectorAll("button"),
    ).filter((button) => button.textContent?.includes("回答者:"));

    act(() => {
      responseButtons[0]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(
      container.querySelector("[data-testid='response-detail']")?.textContent,
    ).toBe("response-1");

    const openDeleteDialogButton = container.querySelector(
      'button[aria-label="回答を削除"]',
    );
    act(() => {
      openDeleteDialogButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const deleteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "削除する",
    );
    act(() => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    act(() => {
      responseButtons[1]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(
      container.querySelector("[data-testid='response-detail']")?.textContent,
    ).toBe("response-2");

    await act(async () => {
      resolveDelete(new Response(JSON.stringify({ ok: true })));
    });

    expect(
      container.querySelector("[data-testid='response-detail']")?.textContent,
    ).toBe("response-2");
    expect(
      queryMock.state.data?.responses.map((response) => response.id),
    ).toEqual(["response-2"]);

    act(() => root.unmount());
  });

  it("distinguishes searching, empty, and error states", () => {
    vi.useFakeTimers();
    queryMock.state = {
      ...queryMock.state,
      data: {
        responses: [],
        hasNext: false,
        page: 1,
        limit: 20,
      },
      isFetching: true,
    };
    const container = document.createElement("div");
    const root = renderResponses(container);
    expect(filterMock.onKeywordChange).not.toBeNull();

    act(() => {
      filterMock.onKeywordChange?.("Needle");
    });

    expect(container.textContent).toContain("検索中...");
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "検索中...",
    );
    expect(container.textContent).not.toContain(
      "検索条件に一致する回答はありません。",
    );

    act(() => {
      vi.advanceTimersByTime(300);
    });

    queryMock.state = {
      ...queryMock.state,
      isFetching: false,
    };

    act(() => {
      root.render(<FormResponsesContent formId="form-1" />);
    });

    expect(container.textContent).toContain(
      "検索条件に一致する回答はありません。",
    );
    expect(container.textContent).not.toContain("検索中...");

    queryMock.state = {
      ...queryMock.state,
      data: undefined,
      error: new Error("回答一覧を読み込めませんでした。"),
      isError: true,
    };

    act(() => {
      root.render(<FormResponsesContent formId="form-1" />);
    });

    expect(container.textContent).toContain("回答一覧を読み込めませんでした。");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "回答一覧を読み込めませんでした。",
    );
    expect(container.textContent).not.toContain(
      "検索条件に一致する回答はありません。",
    );

    act(() => root.unmount());
  });
});
