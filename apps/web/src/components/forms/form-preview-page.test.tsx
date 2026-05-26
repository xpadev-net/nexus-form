// @vitest-environment jsdom

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vi } from "vitest";
import { FormPreviewPage } from "./form-preview-page";

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
    if (queryKey[0] === "formContent") {
      return {
        data: { plateContent: "[]", plateContentVersion: 1 },
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
  FormBody: () => <main data-testid="form-body" />,
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
  it("renders preview navigation links without nested buttons", () => {
    const html = renderToStaticMarkup(<FormPreviewPage />);

    expect(html).not.toContain("<button");
    expect(html).toContain("公開フォーム");
    expect(html).toContain("エディタに戻る");
    expect(html).toContain('href="/forms/public/public-1"');
    expect(html).toContain('href="/forms/form-1/edit"');
    expect(html).toContain('target="_blank"');
  });
});
