// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormList } from "./form-list";

const mocks = vi.hoisted(() => ({
  forms: [
    { id: "draft-form", status: "DRAFT", title: "下書きフォーム" },
    { id: "archived-form", status: "ARCHIVED", title: "古いフォーム" },
  ],
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
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

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("FormList archive filtering", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("hides archived forms from the default all filter and shows them in the archived filter", () => {
    const root = renderList();

    expect(document.body.textContent).toContain("下書きフォーム");
    expect(document.body.textContent).not.toContain("古いフォーム");

    selectStatus("archived");

    expect(document.body.textContent).not.toContain("下書きフォーム");
    expect(document.body.textContent).toContain("古いフォーム");

    act(() => root.unmount());
  });
});
