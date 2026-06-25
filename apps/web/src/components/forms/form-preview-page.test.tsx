// @vitest-environment jsdom

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormPreviewPage } from "./form-preview-page";

const mockAppearance = vi.hoisted(() => ({
  theme: {
    primary_color: "#2563eb",
    accent_color: "#16a34a",
    background_color: "#ffffff",
    font_family: "Inter",
  },
  layout: {
    width: "medium",
    alignment: "center",
    spacing: "comfortable",
    show_progress_bar: true,
    progress_position: "top",
    show_question_numbers: true,
  },
}));
const formBodyProps = vi.hoisted(
  () =>
    [] as Array<{
      appearance?: unknown;
    }>,
);
const queryMockState = vi.hoisted(() => ({
  loadingKeys: [] as string[],
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
    ...props
  }: {
    children: ReactNode;
    params?: Record<string, string>;
    to: string;
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={to
        .replace("$id", params?.id ?? "form-1")
        .replace("$publicId", params?.publicId ?? "public-1")}
      {...props}
    >
      {children}
    </a>
  ),
  useParams: () => ({ id: "form-1" }),
  useSearch: () => ({}),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    const key = queryKey[0] ?? "";
    if (queryMockState.loadingKeys.includes(key)) {
      return {
        data: undefined,
        error: null,
        isLoading: true,
      };
    }
    if (queryKey[0] === "formContent") {
      return {
        data: { plateContent: "[]", plateContentVersion: 1 },
        error: null,
        isLoading: false,
      };
    }
    if (queryKey[0] === "formStructure") {
      return {
        data: {
          structure: {
            appearance: mockAppearance,
          },
        },
        error: null,
        isLoading: false,
      };
    }
    return {
      data: {
        form: {
          description: "Preview description",
          id: "form-1",
          publicId: "public-1",
          status: "DRAFT",
          title: "Preview form",
        },
      },
      error: null,
      isLoading: false,
    };
  },
}));

vi.mock("@/components/forms/form-status-badge", () => ({
  FormStatusBadge: () => <span data-testid="status-badge" />,
}));
vi.mock("@/components/forms/form-body", () => ({
  FormBody: (props: { appearance?: unknown }) => {
    formBodyProps.push(props);
    return <main data-testid="form-body" />;
  },
}));
vi.mock("@/contexts/form-response-context", () => ({
  FormResponseProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/hooks/forms/use-snapshot-content", () => ({
  useSnapshotContent: () => ({
    data: null,
    error: null,
    isError: false,
    isPending: false,
  }),
}));
vi.mock("@/hooks/forms/use-snapshots", () => ({
  useSnapshots: () => ({
    snapshotsQuery: { data: { snapshots: [] }, error: null },
  }),
}));
vi.mock("@/hooks/use-page-title", () => ({
  usePageTitle: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  client: {},
  rpc: vi.fn(),
}));

describe("FormPreviewPage links", () => {
  beforeEach(() => {
    formBodyProps.length = 0;
    queryMockState.loadingKeys = [];
  });

  it("renders only the preview loading status while initial queries are pending", () => {
    queryMockState.loadingKeys = ["formContent"];

    const html = renderToStaticMarkup(<FormPreviewPage />);

    expect(html).toContain('data-preview-loading="true"');
    expect(html).toContain("プレビューを準備しています。");
    expect(html).not.toContain("読み込み中...");
    expect(html).not.toContain('data-testid="form-body"');
    expect(formBodyProps).toEqual([]);
  });

  it("renders preview navigation links without nested buttons", () => {
    const html = renderToStaticMarkup(<FormPreviewPage />);

    expect(html).not.toContain('data-preview-loading="true"');
    expect(html).not.toContain("読み込み中...");
    expect(html).not.toContain("<button");
    expect(html).toContain("公開フォーム");
    expect(html).toContain("エディタに戻る");
    expect(html).toContain('href="/forms/public/public-1"');
    expect(html).toContain('href="/forms/form-1/edit"');
    expect(html).toContain('target="_blank"');
  });

  it("passes latest structure appearance to FormBody", () => {
    renderToStaticMarkup(<FormPreviewPage />);

    expect(formBodyProps.at(-1)?.appearance).toEqual(mockAppearance);
  });

  it("wraps the latest preview body in the shared appearance surface", () => {
    const html = renderToStaticMarkup(<FormPreviewPage />);

    expect(html).toContain('data-form-appearance-surface="true"');
    expect(html).toContain("--background:#ffffff");
    expect(html).toContain("--card:#ebebeb");
    expect(html).toContain("--primary:#2563eb");
    expect(html).toContain("--accent:#16a34a");
  });
});
