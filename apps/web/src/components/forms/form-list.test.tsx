// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormList } from "./form-list";

const mocks = vi.hoisted(() => ({
  forms: [
    { id: "draft-form", status: "DRAFT", title: "下書きフォーム" },
    { id: "archived-form", status: "ARCHIVED", title: "古いフォーム" },
  ],
  invalidateQueries: vi.fn(),
  mutationIsPending: false,
  setQueryData: vi.fn(),
  unarchiveDeferred: undefined as
    | { promise: Promise<unknown>; resolve: (value: unknown) => void }
    | undefined,
  unarchivePost: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <a className={className} href="/">
      {children}
    </a>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: ({
    mutationFn,
    onError,
    onMutate,
    onSettled,
    onSuccess,
  }: {
    mutationFn: (formId: string) => Promise<unknown>;
    onError?: (err: unknown) => void;
    onMutate?: (formId: string) => void;
    onSettled?: () => void;
    onSuccess?: (data: unknown, formId: string) => void;
  }) => ({
    isPending: mocks.mutationIsPending,
    mutate: vi.fn(async (formId: string) => {
      mocks.mutationIsPending = true;
      onMutate?.(formId);
      try {
        const data = await mutationFn(formId);
        onSuccess?.(data, formId);
      } catch (err) {
        onError?.(err);
      } finally {
        mocks.mutationIsPending = false;
        onSettled?.();
      }
    }),
  }),
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
    setQueryData: mocks.setQueryData,
  }),
}));

vi.mock("@/hooks/forms/use-forms", () => ({
  useForms: () => ({
    formsQuery: {
      data: { forms: mocks.forms },
      isError: false,
      isLoading: false,
    },
  }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild: _asChild,
    children,
    ...props
  }: ComponentProps<"button"> & {
    asChild?: boolean;
    size?: string;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        ":id": {
          unarchive: {
            $post: mocks.unarchivePost,
          },
        },
      },
    },
  },
  rpc: vi.fn(async (request: { operation?: string }) => {
    if (request.operation === "unarchive" && mocks.unarchiveDeferred) {
      return mocks.unarchiveDeferred.promise;
    }
    return { ok: true };
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createDeferred() {
  let resolve: (value: unknown) => void = () => {};
  const promise = new Promise<unknown>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function renderList(): Root {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<FormList />);
  });
  return root;
}

function selectStatus(value: string): void {
  const select = document.querySelector(
    'select[aria-label="フォームステータス絞り込み"]',
  );
  expect(select).toBeInstanceOf(HTMLSelectElement);
  act(() => {
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error("Status filter not found");
    }
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function setSearchTerm(value: string): void {
  const input = document.querySelector('input[aria-label="フォーム名検索"]');
  expect(input).toBeInstanceOf(HTMLInputElement);
  act(() => {
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Search input not found");
    }
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("FormList archive filtering", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    mocks.forms = [
      { id: "draft-form", status: "DRAFT", title: "下書きフォーム" },
      { id: "archived-form", status: "ARCHIVED", title: "古いフォーム" },
    ];
    mocks.invalidateQueries.mockClear();
    mocks.mutationIsPending = false;
    mocks.setQueryData.mockClear();
    mocks.unarchiveDeferred = undefined;
    mocks.unarchivePost.mockClear();
    mocks.unarchivePost.mockReturnValue({ operation: "unarchive" });
    vi.mocked(toast.success).mockClear();
  });

  it("hides archived forms from the default all filter and shows them in the archived filter", () => {
    const root = renderList();

    expect(document.body.textContent).toContain("下書きフォーム");
    expect(document.body.textContent).not.toContain("古いフォーム");
    expect(document.body.textContent).toContain("アーカイブを表示");

    selectStatus("archived");

    expect(document.body.textContent).not.toContain("下書きフォーム");
    expect(document.body.textContent).toContain("古いフォーム");
    expect(document.body.textContent).toContain("復元");

    act(() => root.unmount());
  });

  it("hides the archived forms banner while searching active forms", () => {
    const root = renderList();

    expect(document.body.textContent).toContain("アーカイブを表示");

    setSearchTerm("下書き");

    expect(document.body.textContent).toContain("下書きフォーム");
    expect(document.body.textContent).not.toContain(
      "アーカイブ済みフォームが 1 件あります",
    );
    expect(document.body.textContent).not.toContain("アーカイブを表示");

    act(() => root.unmount());
  });

  it("hides the archived forms banner outside the all filter", () => {
    const root = renderList();

    selectStatus("published");

    expect(document.body.textContent).not.toContain(
      "アーカイブ済みフォームが 1 件あります",
    );
    expect(document.body.textContent).not.toContain("アーカイブを表示");
    expect(document.body.textContent).toContain(
      "条件に一致するフォームがありません",
    );

    act(() => root.unmount());
  });

  it("restores an archived form from the home archived filter", async () => {
    const root = renderList();

    selectStatus("archived");
    const restoreButton = Array.from(document.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("復元"),
    );
    expect(restoreButton).toBeDefined();

    await act(async () => {
      restoreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.unarchivePost).toHaveBeenCalledWith({
      param: { id: "archived-form" },
    });
    expect(mocks.setQueryData).toHaveBeenCalledWith(
      ["forms"],
      expect.any(Function),
    );
    const updateCache = mocks.setQueryData.mock.calls[0]?.[1];
    expect(updateCache).toBeInstanceOf(Function);
    if (typeof updateCache !== "function") {
      throw new Error("Forms cache updater not found");
    }
    expect(
      updateCache({
        forms: [
          { id: "draft-form", status: "DRAFT", title: "下書きフォーム" },
          { id: "archived-form", status: "ARCHIVED", title: "古いフォーム" },
        ],
      }),
    ).toEqual({
      forms: [
        { id: "draft-form", status: "DRAFT", title: "下書きフォーム" },
        { id: "archived-form", status: "DRAFT", title: "古いフォーム" },
      ],
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["forms"],
    });
    expect(toast.success).toHaveBeenCalledWith("アーカイブを解除しました");

    act(() => root.unmount());
  });

  it("shows restore loading state while unarchive is pending", async () => {
    mocks.unarchiveDeferred = createDeferred();
    const root = renderList();

    selectStatus("archived");
    const restoreButton = Array.from(document.querySelectorAll("button")).find(
      (item) => item.textContent?.includes("復元"),
    );
    expect(restoreButton).toBeDefined();

    await act(async () => {
      restoreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const pendingRestoreButton = Array.from(
      document.querySelectorAll("button"),
    ).find((item) => item.textContent?.includes("復元"));
    expect(pendingRestoreButton).toBeInstanceOf(HTMLButtonElement);
    expect(pendingRestoreButton).toHaveProperty("disabled", true);
    expect(pendingRestoreButton?.querySelector(".animate-spin")).not.toBeNull();

    await act(async () => {
      mocks.unarchiveDeferred?.resolve({ ok: true });
      await mocks.unarchiveDeferred?.promise;
      await Promise.resolve();
    });

    const settledRestoreButton = Array.from(
      document.querySelectorAll("button"),
    ).find((item) => item.textContent?.includes("復元"));
    expect(settledRestoreButton).toBeInstanceOf(HTMLButtonElement);
    expect(settledRestoreButton).toHaveProperty("disabled", false);
    expect(settledRestoreButton?.querySelector(".animate-spin")).toBeNull();

    act(() => root.unmount());
  });

  it("points users to the archived filter when all forms are archived", () => {
    mocks.forms = [
      { id: "archived-form", status: "ARCHIVED", title: "古いフォーム" },
    ];
    const root = renderList();

    expect(document.body.textContent).toContain(
      "表示できるフォームがありません",
    );
    expect(document.body.textContent).toContain(
      "アーカイブされたフォームはアーカイブフィルターから確認できます。",
    );
    expect(document.body.textContent).not.toContain("古いフォーム");

    act(() => root.unmount());
  });

  it("keeps the regular empty-state message when a search term hides the results", () => {
    const root = renderList();

    setSearchTerm("一致しない検索語");

    expect(document.body.textContent).toContain(
      "条件に一致するフォームがありません",
    );
    expect(document.body.textContent).toContain(
      "検索条件やフィルターを変更してみてください。",
    );
    expect(document.body.textContent).not.toContain(
      "アーカイブされたフォームはアーカイブフィルターから確認できます。",
    );

    act(() => root.unmount());
  });
});
