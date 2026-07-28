// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResponseFilter } from "./response-filter";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ResponseFilter Component", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("renders search input and responds to keyword changes", () => {
    const onKeywordChange = vi.fn();
    root = createRoot(container);
    act(() => {
      root.render(
        <ResponseFilter keyword="test" onKeywordChange={onKeywordChange} />,
      );
    });

    const searchInput = container.querySelector(
      "input[type='search']",
    ) as HTMLInputElement;
    expect(searchInput).not.toBeNull();
    expect(searchInput.value).toBe("test");

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(searchInput, "new value");
      searchInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onKeywordChange).toHaveBeenCalledWith("new value");
  });

  it("toggles filter panel when filter button is clicked", () => {
    root = createRoot(container);
    act(() => {
      root.render(<ResponseFilter keyword="" onKeywordChange={() => {}} />);
    });

    const filterButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("フィルター"),
    );
    expect(filterButton).toBeDefined();

    // Open panel
    act(() => {
      filterButton?.click();
    });

    expect(container.textContent).toContain("検証結果");
    expect(container.textContent).toContain("ユニーク度スコア");
    expect(container.textContent).toContain("並び替え");
  });

  it("calls onResetFilters when reset button is clicked", () => {
    const onResetFilters = vi.fn();
    root = createRoot(container);
    act(() => {
      root.render(
        <ResponseFilter
          keyword="test"
          onKeywordChange={() => {}}
          onResetFilters={onResetFilters}
        />,
      );
    });

    const resetButton = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("リセット"),
    );
    expect(resetButton).toBeDefined();

    act(() => {
      resetButton?.click();
    });

    expect(onResetFilters).toHaveBeenCalledOnce();
  });
});
