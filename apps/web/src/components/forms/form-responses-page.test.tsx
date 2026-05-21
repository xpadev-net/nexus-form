// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormResponsesContent } from "./form-responses-page";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderResponses(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<FormResponsesContent formId="form-1" />);
  });
  return root;
}

const queryMock = vi.hoisted(() => ({
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
  },
}));

vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: Symbol("keepPreviousData"),
  useQuery: () => queryMock.state,
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
  }) => (
    <label>
      Filter
      <input
        value={keyword}
        onChange={(event) => onKeywordChange(event.currentTarget.value)}
      />
    </label>
  ),
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
  client: {},
  rpc: vi.fn(),
}));

beforeEach(() => {
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
        ...queryMock.state.data,
        hasNext: true,
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
});
