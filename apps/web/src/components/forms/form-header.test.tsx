// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormHeader } from "./form-header";

vi.mock("@/components/ui/spinner", () => ({
  Spinner: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderHeader({
  onTitleBlur,
  onTitleDraftChange,
  root,
  titleSaveFailureCount = 0,
}: {
  onTitleBlur: (title: string) => void;
  onTitleDraftChange: (title: string) => void;
  root?: Root;
  titleSaveFailureCount?: number;
}): { container: HTMLDivElement; root: Root } {
  const container =
    root == null
      ? document.body.appendChild(document.createElement("div"))
      : (document.body.firstElementChild as HTMLDivElement);
  const nextRoot = root ?? createRoot(container);
  act(() => {
    nextRoot.render(
      <FormHeader
        title="保存済みタイトル"
        onTitleBlur={onTitleBlur}
        onTitleDraftChange={onTitleDraftChange}
        titleSaveFailureCount={titleSaveFailureCount}
      />,
    );
  });
  return { container, root: nextRoot };
}

describe("FormHeader title draft synchronization", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("resets the parent title draft when a save failure reverts the input", () => {
    const onTitleBlur = vi.fn();
    const onTitleDraftChange = vi.fn();
    const { container, root } = renderHeader({
      onTitleBlur,
      onTitleDraftChange,
    });
    onTitleDraftChange.mockClear();

    const input = container.querySelector('input[aria-label="フォーム名"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    act(() => {
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("Title input not found");
      }
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, "保存失敗タイトル");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onTitleBlur).toHaveBeenCalledWith("保存失敗タイトル");

    renderHeader({
      onTitleBlur,
      onTitleDraftChange,
      root,
      titleSaveFailureCount: 1,
    });

    expect((input as HTMLInputElement).value).toBe("保存済みタイトル");
    expect(onTitleDraftChange).toHaveBeenLastCalledWith("保存済みタイトル");

    act(() => root.unmount());
  });
});
