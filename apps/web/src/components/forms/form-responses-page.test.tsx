// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function renderResponses(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<FormResponsesContent formId="form-1" />);
  });
  return root;
}

const queryMock = vi.hoisted(
  (): {
    lastOptions: CapturedUseQueryOptions | null;
    refetch: ReturnType<typeof vi.fn<ResponsesQueryState["refetch"]>>;
    state: ResponsesQueryState;
  } => ({
    lastOptions: null,
    refetch: vi.fn<ResponsesQueryState["refetch"]>(),
    state: {
      data: {
        responses: [
          {
            countryCode: "JP",
            id: "response-1",
            respondentUuid: "respondent-uuid-1",
            submittedAt: "2026-01-01T00:00:00.000Z",
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
  getResponses: vi.fn(() => Promise.resolve({ ok: true })),
  rpc: vi.fn((value: unknown) => value),
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
  useQuery: (options: CapturedUseQueryOptions) => {
    queryMock.lastOptions = options;
    return queryMock.state;
  },
}));

vi.mock("@/hooks/forms/use-validation-sse", () => ({
  useValidationSSE: vi.fn(),
}));
vi.mock("@/components/forms/form-response-analytics", () => ({
  FormResponseAnalytics: () => <section data-testid="analytics" />,
}));
vi.mock("@/components/forms/response-detail-view", () => ({
  ResponseDetailView: () => <section data-testid="response-detail" />,
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
            $get: apiMock.getResponses,
          },
        },
      },
    },
  },
  rpc: apiMock.rpc,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  filterMock.onKeywordChange = null;
  queryMock.lastOptions = null;
  queryMock.state = {
    data: {
      responses: [
        {
          countryCode: "JP",
          id: "response-1",
          respondentUuid: "respondent-uuid-1",
          submittedAt: "2026-01-01T00:00:00.000Z",
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
