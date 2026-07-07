// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { usePageTitle } from "@/hooks/use-page-title";
import { RpcError } from "@/lib/api";
import { NetworkError } from "@/lib/fetch-json";
import { buildPublicFormUrl } from "@/lib/forms/public-url";
import { FormEditorPage } from "./form-editor-page";

const {
  autosaveOptionsMock,
  hasUnsavedLocalEditsMock,
  toastErrorMock,
  toastInfoMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  autosaveOptionsMock: vi.fn(),
  hasUnsavedLocalEditsMock: vi.fn(() => false),
  toastErrorMock: vi.fn(),
  toastInfoMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

let searchTab: string | undefined;
let searchShareToken: string | undefined;
const navigateMock = vi.fn();
const snapshotEditorToDraftMock = vi.fn();
type QueryState = {
  data?: unknown;
  error?: unknown;
  isError: boolean;
  isLoading: boolean;
};
type RetryFn = (failureCount: number, error: unknown) => boolean;
type QueryOptions = {
  enabled?: boolean;
  queryFn: () => Promise<unknown>;
  queryKey: string[];
  retry?: RetryFn;
};
type MutationOptions = {
  mutationFn: (variables?: unknown) => Promise<unknown>;
  onError?: (error: unknown) => void;
  onSuccess?: (data: unknown, variables?: unknown) => void;
};

function readMockOperation(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("operation" in value)) {
    return undefined;
  }
  const operation = value.operation;
  return typeof operation === "string" ? operation : undefined;
}

let formQueryState: QueryState;
let contentQueryState: QueryState;
let permissionQueryState: QueryState;
let pendingTitleSaveResolver: (() => void) | undefined;
const retryByQueryKey = new Map<string, RetryFn>();
const optionsByQueryKey = new Map<string, QueryOptions>();

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

function updateMockFormTitle(title: string | undefined) {
  formQueryState = {
    ...formQueryState,
    data: {
      form: {
        ...(formQueryState.data as { form: Record<string, unknown> }).form,
        title,
      },
    },
  };
  return { form: (formQueryState.data as { form: unknown }).form };
}

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useParams: () => ({ id: "form-1" }),
  useRouter: () => ({ navigate: navigateMock }),
  useSearch: () => ({ shareToken: searchShareToken, tab: searchTab }),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: MutationOptions) => ({
    failureCount: 0,
    isPending: false,
    mutate: vi.fn((variables?: unknown) => {
      void options
        .mutationFn(variables)
        .then((data) => options.onSuccess?.(data, variables))
        .catch((error) => options.onError?.(error));
    }),
    mutateAsync: vi.fn(async (variables?: unknown) => {
      try {
        const data = await options.mutationFn(variables);
        options.onSuccess?.(data, variables);
        return data;
      } catch (error) {
        options.onError?.(error);
        throw error;
      }
    }),
  }),
  useQuery: (options: QueryOptions) => {
    const { queryKey, retry } = options;
    optionsByQueryKey.set(queryKey[0] ?? "", options);
    if (retry) {
      retryByQueryKey.set(queryKey[0] ?? "", retry);
    }
    if (queryKey[0] === "formContent") {
      return {
        ...contentQueryState,
        refetch: vi.fn(),
      };
    }
    if (queryKey[0] === "formPermissionMe") {
      return {
        ...permissionQueryState,
        refetch: vi.fn(),
      };
    }
    return {
      ...formQueryState,
      refetch: vi.fn(),
    };
  },
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  }),
}));

vi.mock("@/hooks/forms/use-form-content-autosave", () => ({
  useFormContentAutosave: (options: { enabled?: boolean }) => {
    autosaveOptionsMock(options);
    return {
      conflictResolutions: {},
      conflictState: null,
      dismissConflict: vi.fn(),
      draftContent: "[]",
      handleContentChange: vi.fn(),
      hasUnsavedLocalEdits: hasUnsavedLocalEditsMock,
      isMerging: false,
      isSaving: false,
      resolveConflicts: vi.fn(),
      setConflictResolutions: vi.fn(),
      snapshotEditorToDraft: () => snapshotEditorToDraftMock(),
    };
  },
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
      disabled,
      value,
    }: ComponentProps<"button"> & { value: string }) => {
      const context = React.useContext(TabContext);
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (!disabled) context?.onValueChange(value);
          }}
        >
          {children}
        </button>
      );
    },
  };
});

vi.mock("@/components/editor/plate-editor", () => ({
  PlateEditor: ({ readOnly }: { readOnly?: boolean }) => (
    <div
      data-read-only={readOnly ? "true" : "false"}
      data-testid="plate-editor"
    />
  ),
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
  FormDuplicateModal: ({
    open,
    onConfirm,
    sourceTitle,
  }: {
    open: boolean;
    onConfirm: () => void;
    sourceTitle?: string;
  }) =>
    open ? (
      <div>
        <p>コピー後: {sourceTitle} のコピー</p>
        <button type="button" onClick={onConfirm}>
          複製確定
        </button>
      </div>
    ) : null,
}));
vi.mock("@/components/forms/form-header", () => ({
  FormHeader: ({
    action,
    onTitleBlur,
    onTitleDraftChange,
    title,
  }: {
    action?: ReactNode;
    onTitleBlur?: (title: string) => void;
    onTitleDraftChange?: (title: string) => void;
    title: string;
  }) => (
    <header>
      {onTitleBlur ? (
        <input
          aria-label="フォーム名"
          defaultValue={title}
          onBlur={(event) => onTitleBlur(event.currentTarget.value)}
          onChange={(event) => onTitleDraftChange?.(event.currentTarget.value)}
        />
      ) : (
        <h1>{title}</h1>
      )}
      {action}
    </header>
  ),
}));
vi.mock("@/components/forms/form-publish-menu", () => ({
  FormPublishMenu: () => null,
}));
vi.mock("@/components/forms/form-access-control-settings", () => ({
  FormAccessControlSettings: () => null,
}));
vi.mock("@/components/forms/form-appearance-settings", () => ({
  FormAppearanceSettings: ({
    formId,
    formTitle,
    plateContent,
  }: {
    formId: string;
    formTitle: string;
    plateContent: string;
  }) => (
    <section
      data-form-id={formId}
      data-plate-content={plateContent}
      data-testid="appearance-settings"
    >
      {formTitle}
    </section>
  ),
}));
vi.mock("@/components/forms/form-post-submit-settings", () => ({
  FormPostSubmitSettings: () => null,
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
vi.mock("@/components/forms/form-validation-output-export-settings", () => ({
  FormValidationOutputExportSettings: () => null,
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
  Button: ({
    asChild,
    children,
    ...props
  }: ComponentProps<"button"> & { asChild?: boolean }) =>
    asChild ? children : <button {...props}>{children}</button>,
}));
vi.mock("@/hooks/use-page-title", () => ({
  usePageTitle: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    info: toastInfoMock,
    success: toastSuccessMock,
  },
}));
vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        ":id": {
          $delete: vi.fn(() => ({ operation: "delete" })),
          $get: vi.fn(() => ({ operation: "get-form" })),
          $put: vi.fn(({ json }: { json: { title: string } }) => ({
            operation: "update-title",
            title: json.title,
          })),
          archive: {
            $post: vi.fn(() => ({ operation: "archive" })),
          },
          content: {
            $get: vi.fn(() => ({ operation: "get-content" })),
          },
          duplicate: {
            $post: vi.fn(() => ({ operation: "duplicate" })),
          },
          permissions: {
            me: {
              $get: vi.fn(() => ({ operation: "get-permission" })),
            },
          },
          unarchive: {
            $post: vi.fn(() => ({ operation: "unarchive" })),
          },
        },
      },
    },
  },
  RpcError: class RpcError extends Error {
    readonly details = null;
    readonly status: number;

    constructor(message: string, status: number) {
      super(message);
      this.name = "RpcError";
      this.status = status;
    }
  },
  getShareTokenAuthorizationHeader: (shareToken?: string | null) =>
    shareToken ? { Authorization: `Bearer ${shareToken}` } : {},
  rpc: vi.fn(async (request: { operation?: string; title?: string }) => {
    if (request.operation === "update-title") {
      if (request.title === "保存失敗タイトル") {
        throw new Error("Title save failed");
      }
      if (request.title === "保存中タイトル") {
        return new Promise((resolve) => {
          pendingTitleSaveResolver = () => {
            resolve(updateMockFormTitle(request.title));
          };
        });
      }
      return updateMockFormTitle(request.title);
    }
    if (request.operation === "duplicate") {
      return {
        form: {
          id: "duplicated-form",
          title: `${
            (formQueryState.data as { form: { title: string } }).form.title
          } のコピー`,
        },
      };
    }
    return {};
  }),
}));
vi.mock("@/lib/logger", () => ({
  logWarn: vi.fn(),
}));

describe("FormEditorPage tab synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchTab = undefined;
    searchShareToken = undefined;
    formQueryState = {
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
    };
    contentQueryState = {
      data: { plateContent: "[]", plateContentVersion: 1 },
      isError: false,
      isLoading: false,
    };
    permissionQueryState = {
      data: { role: "OWNER" },
      isError: false,
      isLoading: false,
    };
    navigateMock.mockClear();
    autosaveOptionsMock.mockClear();
    hasUnsavedLocalEditsMock.mockReset();
    hasUnsavedLocalEditsMock.mockReturnValue(false);
    snapshotEditorToDraftMock.mockClear();
    toastErrorMock.mockReset();
    toastInfoMock.mockReset();
    toastSuccessMock.mockReset();
    pendingTitleSaveResolver = undefined;
    vi.mocked(usePageTitle).mockClear();
    optionsByQueryKey.clear();
    retryByQueryKey.clear();
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

  it("passes shareToken from the edit route to initial form requests", async () => {
    searchShareToken = "shared-editor-token";
    const { client } = await import("@/lib/api");
    const container = document.createElement("div");
    const root = renderPage(container);

    await optionsByQueryKey.get("formDetail")?.queryFn();
    await optionsByQueryKey.get("formContent")?.queryFn();
    await optionsByQueryKey.get("formPermissionMe")?.queryFn();

    expect(client.api.forms[":id"].$get).toHaveBeenCalledWith(
      { param: { id: "form-1" } },
      { headers: { Authorization: "Bearer shared-editor-token" } },
    );
    expect(client.api.forms[":id"].content.$get).toHaveBeenCalledWith(
      { param: { id: "form-1" } },
      { headers: { Authorization: "Bearer shared-editor-token" } },
    );
    expect(client.api.forms[":id"].permissions.me.$get).toHaveBeenCalledWith(
      { param: { id: "form-1" } },
      { headers: { Authorization: "Bearer shared-editor-token" } },
    );
    expect(optionsByQueryKey.get("formDetail")?.queryKey).toEqual([
      "formDetail",
      "form-1",
      "shared-editor-token",
    ]);

    act(() => root.unmount());
  });

  it("passes shareToken from the edit route to title update requests", async () => {
    searchShareToken = "shared-editor-token";
    const { client } = await import("@/lib/api");
    const container = document.createElement("div");
    const root = renderPage(container);

    const titleInput = container.querySelector(
      'input[aria-label="フォーム名"]',
    );
    expect(titleInput).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      if (!(titleInput instanceof HTMLInputElement)) {
        throw new Error("Title input not found");
      }
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(titleInput, "共有リンクタイトル");
      titleInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(client.api.forms[":id"].$put).toHaveBeenCalledWith(
      {
        json: { title: "共有リンクタイトル" },
        param: { id: "form-1" },
      },
      { headers: { Authorization: "Bearer shared-editor-token" } },
    );

    act(() => root.unmount());
  });

  it("prevents browser unload while autosave reports unsaved local edits", () => {
    hasUnsavedLocalEditsMock.mockReturnValue(true);
    const container = document.createElement("div");
    const root = renderPage(container);

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(hasUnsavedLocalEditsMock).toHaveBeenCalled();

    act(() => root.unmount());
  });

  it("does not prevent browser unload after local edits are saved", () => {
    hasUnsavedLocalEditsMock.mockReturnValue(false);
    const container = document.createElement("div");
    const root = renderPage(container);

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(hasUnsavedLocalEditsMock).toHaveBeenCalled();

    act(() => root.unmount());
  });

  it("removes the browser unload listener when the editor page unmounts", () => {
    hasUnsavedLocalEditsMock.mockReturnValue(true);
    const container = document.createElement("div");
    const root = renderPage(container);

    act(() => root.unmount());
    hasUnsavedLocalEditsMock.mockClear();

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(hasUnsavedLocalEditsMock).not.toHaveBeenCalled();
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

  it("renders viewer share links as read-only and disables edit-only tabs", () => {
    searchShareToken = "shared-viewer-token";
    permissionQueryState = {
      data: { role: "VIEWER" },
      isError: false,
      isLoading: false,
    };
    const container = document.createElement("div");
    const root = renderPage(container);

    expect(
      container
        .querySelector("[data-testid='plate-editor']")
        ?.getAttribute("data-read-only"),
    ).toBe("true");
    expect(
      container.querySelector('input[aria-label="フォーム名"]'),
    ).toBeNull();

    const settingsButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("設定"));
    const validationButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("検証"));
    const sharingButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("共有"),
    );
    const responsesButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回答"));
    expect(settingsButton?.disabled).toBe(true);
    expect(validationButton?.disabled).toBe(true);
    expect(sharingButton?.disabled).toBe(true);
    expect(responsesButton?.disabled).toBe(true);
    expect(autosaveOptionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    expect(container.textContent).not.toContain("フォーム管理");

    act(() => root.unmount());
  });

  it("waits for permission before rendering an editable owner share page", () => {
    searchShareToken = "shared-editor-token";
    permissionQueryState = {
      data: undefined,
      isError: false,
      isLoading: true,
    };
    const container = document.createElement("div");
    const root = renderPage(container);

    expect(container.textContent).toContain("読み込み中...");
    expect(container.querySelector("[data-testid='plate-editor']")).toBeNull();

    permissionQueryState = {
      data: { role: "OWNER" },
      isError: false,
      isLoading: false,
    };
    rerenderPage(root);

    expect(
      container
        .querySelector("[data-testid='plate-editor']")
        ?.getAttribute("data-read-only"),
    ).toBe("false");
    const settingsButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("設定"));
    expect(settingsButton?.disabled).toBe(false);
    expect(autosaveOptionsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true }),
    );

    act(() => root.unmount());
  });

  it.each([
    "settings",
    "validation",
    "sharing",
    "responses",
  ])("redirects viewer share links away from %s tab URLs", (blockedTab) => {
    searchShareToken = "shared-viewer-token";
    searchTab = blockedTab;
    permissionQueryState = {
      data: { role: "VIEWER" },
      isError: false,
      isLoading: false,
    };
    const container = document.createElement("div");
    const root = renderPage(container);

    expect(navigateMock).toHaveBeenCalledWith({
      params: { id: "form-1" },
      replace: true,
      search: { shareToken: "shared-viewer-token", tab: "editor" },
      to: "/forms/$id/edit",
    });
    expect(
      container.querySelector("[data-testid='appearance-settings']"),
    ).toBeNull();

    act(() => root.unmount());
  });

  it("uses the current public URL in the editor header open action", () => {
    const container = document.createElement("div");
    const root = renderPage(container);
    const publicLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/forms/public/public-1"]',
    );

    expect(publicLink).not.toBeNull();
    expect(publicLink?.getAttribute("aria-label")).toBe(
      `公開フォームを開く: ${buildPublicFormUrl("public-1")}`,
    );

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

  it("renders settings tab from the URL for an unpublished form", () => {
    searchTab = "settings";
    formQueryState = {
      ...formQueryState,
      data: {
        form: {
          id: "form-1",
          publicId: null,
          status: "DRAFT",
          title: "Draft settings form",
        },
      },
    };
    const container = document.createElement("div");
    const root = renderPage(container);

    expect(
      container.querySelector("[data-active-tab='settings']"),
    ).not.toBeNull();
    const appearanceSettings = container.querySelector(
      "[data-testid='appearance-settings']",
    );
    expect(appearanceSettings).not.toBeNull();
    expect(appearanceSettings?.textContent).toContain("Draft settings form");
    expect(appearanceSettings?.getAttribute("data-form-id")).toBe("form-1");
    expect(container.textContent).toContain("フォーム管理");

    act(() => root.unmount());
  });

  it("renders settings tab from the URL for a published form", () => {
    searchTab = "settings";
    formQueryState = {
      ...formQueryState,
      data: {
        form: {
          id: "form-1",
          publicId: "public-1",
          status: "PUBLISHED",
          title: "Published settings form",
        },
      },
    };
    const container = document.createElement("div");
    const root = renderPage(container);

    expect(
      container.querySelector("[data-active-tab='settings']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='appearance-settings']")
        ?.textContent,
    ).toContain("Published settings form");
    expect(
      container.querySelector<HTMLAnchorElement>(
        'a[href="/forms/public/public-1"]',
      ),
    ).not.toBeNull();

    act(() => root.unmount());
  });

  it("renders settings tab after switching tabs", () => {
    const container = document.createElement("div");
    const root = renderPage(container);

    expect(
      container.querySelector("[data-testid='appearance-settings']"),
    ).toBeNull();

    const settingsButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("設定"));
    expect(settingsButton).toBeDefined();

    act(() => {
      settingsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(navigateMock).toHaveBeenCalledWith({
      params: { id: "form-1" },
      search: { tab: "settings" },
      to: "/forms/$id/edit",
    });

    searchTab = "settings";
    rerenderPage(root);

    expect(
      container.querySelector("[data-active-tab='settings']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='appearance-settings']"),
    ).not.toBeNull();

    act(() => root.unmount());
  });

  it("does not snapshot editor draft for same-tab rerenders", () => {
    const container = document.createElement("div");
    const root = renderPage(container);

    rerenderPage(root);

    expect(snapshotEditorToDraftMock).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it("saves a dirty title before duplicating and previews that title in the dialog", async () => {
    searchTab = "settings";
    const { client, rpc } = await import("@/lib/api");
    const container = document.createElement("div");
    const root = renderPage(container);

    const titleInput = container.querySelector(
      'input[aria-label="フォーム名"]',
    );
    expect(titleInput).toBeInstanceOf(HTMLInputElement);
    act(() => {
      if (!(titleInput instanceof HTMLInputElement)) {
        throw new Error("Title input not found");
      }
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(titleInput, "保存前タイトル");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const duplicateButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("複製"));
    expect(duplicateButton).toBeDefined();
    await act(async () => {
      duplicateButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("保存前タイトル のコピー");

    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("複製確定"),
    );
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const formsClient = client.api.forms[":id"];
    expect(formsClient.$put).toHaveBeenCalledWith({
      json: { title: "保存前タイトル" },
      param: { id: "form-1" },
    });
    expect(formsClient.duplicate.$post).toHaveBeenCalledWith({
      param: { id: "form-1" },
    });
    const updateTitleCallIndex = vi
      .mocked(rpc)
      .mock.calls.findIndex(
        ([request]) => readMockOperation(request) === "update-title",
      );
    const duplicateCallIndex = vi
      .mocked(rpc)
      .mock.calls.findIndex(
        ([request]) => readMockOperation(request) === "duplicate",
      );
    expect(updateTitleCallIndex).toBeGreaterThanOrEqual(0);
    expect(duplicateCallIndex).toBeGreaterThan(updateTitleCallIndex);

    act(() => root.unmount());
  });

  it("saves a newer title draft after an earlier pending title save before duplicating", async () => {
    searchTab = "settings";
    const { client, rpc } = await import("@/lib/api");
    const container = document.createElement("div");
    const root = renderPage(container);

    const titleInput = container.querySelector(
      'input[aria-label="フォーム名"]',
    );
    expect(titleInput).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      if (!(titleInput instanceof HTMLInputElement)) {
        throw new Error("Title input not found");
      }
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(titleInput, "保存中タイトル");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      titleInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(pendingTitleSaveResolver).toBeDefined();

    act(() => {
      if (!(titleInput instanceof HTMLInputElement)) {
        throw new Error("Title input not found");
      }
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(titleInput, "最新タイトル");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const duplicateButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("複製"));
    await act(async () => {
      duplicateButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("最新タイトル のコピー");

    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("複製確定"),
    );
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(client.api.forms[":id"].duplicate.$post).not.toHaveBeenCalled();

    await act(async () => {
      pendingTitleSaveResolver?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    const titleUpdates = vi
      .mocked(rpc)
      .mock.calls.filter(
        ([request]) => readMockOperation(request) === "update-title",
      )
      .map(([request]) =>
        typeof request === "object" && request != null && "title" in request
          ? request.title
          : undefined,
      );
    expect(titleUpdates).toEqual(["保存中タイトル", "最新タイトル"]);
    expect(client.api.forms[":id"].duplicate.$post).toHaveBeenCalledWith({
      param: { id: "form-1" },
    });

    act(() => root.unmount());
  });

  it("falls back to the saved title in duplicate preview when the title draft is blank", async () => {
    searchTab = "settings";
    const container = document.createElement("div");
    const root = renderPage(container);

    const titleInput = container.querySelector(
      'input[aria-label="フォーム名"]',
    );
    expect(titleInput).toBeInstanceOf(HTMLInputElement);
    act(() => {
      if (!(titleInput instanceof HTMLInputElement)) {
        throw new Error("Title input not found");
      }
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(titleInput, "   ");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const duplicateButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("複製"));
    await act(async () => {
      duplicateButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("Test form のコピー");
    expect(container.textContent).not.toContain("    のコピー");

    act(() => root.unmount());
  });

  it("does not show a duplicate failure toast when title save fails before duplication", async () => {
    searchTab = "settings";
    const { client } = await import("@/lib/api");
    const container = document.createElement("div");
    const root = renderPage(container);

    const titleInput = container.querySelector(
      'input[aria-label="フォーム名"]',
    );
    expect(titleInput).toBeInstanceOf(HTMLInputElement);
    act(() => {
      if (!(titleInput instanceof HTMLInputElement)) {
        throw new Error("Title input not found");
      }
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(titleInput, "保存失敗タイトル");
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const duplicateButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("複製"));
    await act(async () => {
      duplicateButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    const confirmButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("複製確定"),
    );
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const formsClient = client.api.forms[":id"];
    expect(formsClient.$put).toHaveBeenCalledWith({
      json: { title: "保存失敗タイトル" },
      param: { id: "form-1" },
    });
    expect(formsClient.duplicate.$post).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "フォーム名の保存に失敗しました",
    );
    expect(toastErrorMock).not.toHaveBeenCalledWith("Title save failed");
    expect(toastErrorMock).not.toHaveBeenCalledWith("複製に失敗しました");

    act(() => root.unmount());
  });

  it("handles title save failures from blur without rethrowing", async () => {
    const container = document.createElement("div");
    const root = renderPage(container);

    const titleInput = container.querySelector(
      'input[aria-label="フォーム名"]',
    );
    expect(titleInput).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      if (!(titleInput instanceof HTMLInputElement)) {
        throw new Error("Title input not found");
      }
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(titleInput, "保存失敗タイトル");
      titleInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "フォーム名の保存に失敗しました",
    );

    act(() => root.unmount());
  });

  it("renders a not-found page for a missing editable form", () => {
    formQueryState = {
      error: new RpcError("Not found", 404),
      isError: true,
      isLoading: false,
    };

    const container = document.createElement("div");
    const root = renderPage(container);

    expect(container.textContent).toContain("フォームが見つかりません");
    expect(container.textContent).toContain(
      "このフォームは存在しないか、編集権限がありません。",
    );
    expect(container.textContent).toContain("フォーム一覧へ戻る");
    expect(usePageTitle).toHaveBeenCalledWith("フォームが見つかりません");
    expect(container.querySelector("[data-testid='plate-editor']")).toBeNull();
    expect(optionsByQueryKey.get("formContent")?.enabled).toBe(false);

    act(() => root.unmount());
  });

  it("keeps content-only 404 failures on the generic error path", () => {
    contentQueryState = {
      error: new RpcError("Content not found", 404),
      isError: true,
      isLoading: false,
    };

    const container = document.createElement("div");
    const root = renderPage(container);

    expect(container.textContent).toContain(
      "フォームの読み込みに失敗しました。",
    );
    expect(container.textContent).not.toContain("フォームが見つかりません");
    expect(container.textContent).not.toContain("フォーム一覧へ戻る");

    act(() => root.unmount());
  });

  it("keeps non-404 editor load failures on the generic error path", () => {
    formQueryState = {
      error: new RpcError("Forbidden", 403),
      isError: true,
      isLoading: false,
    };

    const container = document.createElement("div");
    const root = renderPage(container);

    expect(container.textContent).toContain(
      "フォームの読み込みに失敗しました。",
    );
    expect(container.textContent).not.toContain("フォームが見つかりません");
    expect(container.textContent).not.toContain("フォーム一覧へ戻る");

    act(() => root.unmount());
  });

  it("keeps server editor load failures on the generic error path", () => {
    formQueryState = {
      error: new RpcError("Server error", 500),
      isError: true,
      isLoading: false,
    };

    const container = document.createElement("div");
    const root = renderPage(container);

    expect(container.textContent).toContain(
      "フォームの読み込みに失敗しました。",
    );
    expect(container.textContent).not.toContain("フォームが見つかりません");
    expect(container.textContent).not.toContain("フォーム一覧へ戻る");

    act(() => root.unmount());
  });

  it("does not retry 4xx editor queries", () => {
    const container = document.createElement("div");
    const root = renderPage(container);

    expect(
      retryByQueryKey.get("formDetail")?.(0, new RpcError("Not found", 404)),
    ).toBe(false);
    expect(
      retryByQueryKey.get("formContent")?.(0, new RpcError("Not found", 404)),
    ).toBe(false);
    expect(
      retryByQueryKey.get("formDetail")?.(0, new RpcError("Forbidden", 403)),
    ).toBe(false);
    expect(
      retryByQueryKey.get("formDetail")?.(
        2,
        new NetworkError("Network request failed", new TypeError()),
      ),
    ).toBe(true);
    expect(
      retryByQueryKey.get("formDetail")?.(
        3,
        new NetworkError("Network request failed", new TypeError()),
      ),
    ).toBe(false);
    expect(
      retryByQueryKey.get("formContent")?.(
        2,
        new NetworkError("Network request failed", new TypeError()),
      ),
    ).toBe(true);
    expect(
      retryByQueryKey.get("formContent")?.(
        3,
        new NetworkError("Network request failed", new TypeError()),
      ),
    ).toBe(false);
    expect(
      retryByQueryKey.get("formDetail")?.(
        0,
        new Error("Unexpected parse failure"),
      ),
    ).toBe(false);
    expect(
      retryByQueryKey.get("formDetail")?.(
        0,
        new TypeError("Cannot read properties of undefined"),
      ),
    ).toBe(false);

    act(() => root.unmount());
  });
});
