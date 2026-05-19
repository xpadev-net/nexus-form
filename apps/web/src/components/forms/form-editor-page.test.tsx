// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, vi } from "vitest";
import { FormEditorPage } from "./form-editor-page";

let searchTab: string | undefined;
const navigateMock = vi.fn();
const snapshotEditorToDraftMock = vi.fn();

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderPage(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<FormEditorPage />);
  });
  return root;
}

function rerenderPage(root: Root) {
  act(() => {
    root.render(<FormEditorPage />);
  });
}

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useParams: () => ({ id: "form-1" }),
  useRouter: () => ({ navigate: navigateMock }),
  useSearch: () => ({ tab: searchTab }),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({
    failureCount: 0,
    isPending: false,
    mutate: vi.fn(),
  }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "formContent") {
      return {
        data: { plateContent: "[]", plateContentVersion: 1 },
        isError: false,
        isLoading: false,
        refetch: vi.fn(),
      };
    }
    return {
      data: {
        form: {
          id: "form-1",
          publicId: "public-1",
          status: "DRAFT",
          title: "Test form",
        },
      },
      isError: false,
      isLoading: false,
      refetch: vi.fn(),
    };
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
}));

vi.mock("@/hooks/forms/use-form-content-autosave", () => ({
  useFormContentAutosave: () => ({
    conflictResolutions: {},
    conflictState: null,
    dismissConflict: vi.fn(),
    draftContent: "[]",
    handleContentChange: vi.fn(),
    isMerging: false,
    isSaving: false,
    resolveConflicts: vi.fn(),
    setConflictResolutions: vi.fn(),
    snapshotEditorToDraft: () => snapshotEditorToDraftMock(),
  }),
}));

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const TabContext = React.createContext<{
    onValueChange: (value: string) => void;
    value: string;
  } | null>(null);

  return {
    Tabs: ({
      children,
      onValueChange,
      value,
    }: ComponentProps<"div"> & {
      onValueChange: (value: string) => void;
      value: string;
    }) => (
      <TabContext.Provider value={{ onValueChange, value }}>
        <div data-active-tab={value}>{children}</div>
      </TabContext.Provider>
    ),
    TabsContent: ({
      children,
      forceMount,
      value,
    }: ComponentProps<"div"> & { forceMount?: boolean; value: string }) => {
      const context = React.useContext(TabContext);
      if (!forceMount && context?.value !== value) return null;
      return (
        <div data-hidden={context?.value !== value} data-tab-content={value}>
          {children}
        </div>
      );
    },
    TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({
      children,
      value,
    }: ComponentProps<"button"> & { value: string }) => {
      const context = React.useContext(TabContext);
      return (
        <button type="button" onClick={() => context?.onValueChange(value)}>
          {children}
        </button>
      );
    },
  };
});

vi.mock("@/components/editor/plate-editor", () => ({
  PlateEditor: () => <div data-testid="plate-editor" />,
}));

vi.mock("@/components/forms/form-responses-page", () => ({
  FormResponsesContent: () => <div data-testid="responses-content" />,
}));

vi.mock("@/components/forms/form-archive-manager", () => ({
  FormArchiveManager: () => null,
}));
vi.mock("@/components/forms/form-deletion-modal", () => ({
  FormDeletionModal: () => null,
}));
vi.mock("@/components/forms/form-duplicate-modal", () => ({
  FormDuplicateModal: () => null,
}));
vi.mock("@/components/forms/form-header", () => ({
  FormHeader: ({ action, title }: { action?: ReactNode; title: string }) => (
    <header>
      <h1>{title}</h1>
      {action}
    </header>
  ),
}));
vi.mock("@/components/forms/form-publish-menu", () => ({
  FormPublishMenu: () => null,
}));
vi.mock("@/components/forms/form-sharing-section", () => ({
  FormSharingSection: () => null,
}));
vi.mock("@/components/forms/form-status-badge", () => ({
  FormStatusBadge: () => null,
}));
vi.mock("@/components/forms/form-validation-rules-page", () => ({
  FormValidationRulesPage: () => null,
}));
vi.mock("@/components/forms/google-sheets-integration", () => ({
  GoogleSheetsIntegration: () => null,
}));
vi.mock("@/components/forms/plate-conflict-banner", () => ({
  PlateConflictBanner: () => null,
}));
vi.mock("@/components/forms/schedule-manager", () => ({
  ScheduleManager: () => null,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/hooks/use-page-title", () => ({
  usePageTitle: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  client: {},
  rpc: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logWarn: vi.fn(),
}));

describe("FormEditorPage tab synchronization", () => {
  beforeEach(() => {
    searchTab = undefined;
    navigateMock.mockClear();
    snapshotEditorToDraftMock.mockClear();
  });

  it("uses search param changes after mount as the active tab", () => {
    const container = document.createElement("div");
    const root = renderPage(container);

    expect(
      container.querySelector("[data-active-tab='editor']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='responses-content']"),
    ).toBeNull();

    searchTab = "responses";
    rerenderPage(root);

    expect(
      container.querySelector("[data-active-tab='responses']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='responses-content']"),
    ).not.toBeNull();

    act(() => root.unmount());
  });

  it("navigates instead of mutating local state when a tab is clicked", () => {
    const container = document.createElement("div");
    const root = renderPage(container);

    const responsesButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回答"));
    expect(responsesButton).toBeDefined();

    act(() => {
      responsesButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(navigateMock).toHaveBeenCalledWith({
      params: { id: "form-1" },
      search: { tab: "responses" },
      to: "/forms/$id/edit",
    });

    act(() => root.unmount());
  });

  it("snapshots editor draft when URL-driven navigation leaves the editor tab", () => {
    const container = document.createElement("div");
    const root = renderPage(container);

    searchTab = "settings";
    rerenderPage(root);

    expect(snapshotEditorToDraftMock).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  it("does not snapshot editor draft for same-tab rerenders", () => {
    const container = document.createElement("div");
    const root = renderPage(container);

    rerenderPage(root);

    expect(snapshotEditorToDraftMock).not.toHaveBeenCalled();

    act(() => root.unmount());
  });
});
