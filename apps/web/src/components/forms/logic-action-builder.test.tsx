// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { FormLogicAction } from "@/types/validation/form";
import { LogicActionBuilder } from "./logic-action-builder";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({
    children,
    disabled,
    value,
  }: {
    children: ReactNode;
    disabled?: boolean;
    value: string;
  }) => (
    <option disabled={disabled} value={value}>
      {children}
    </option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    placeholder ? <option value="">{placeholder}</option> : null,
}));

const availableSections = [
  { id: "section-next", title: "通常セクション" },
  { id: "section-complete", title: "完了セクション" },
];

const completionTargetSections = [
  {
    id: "section-complete",
    title: "完了セクション",
    isCompletionTarget: true,
  },
  {
    id: "section-with-question",
    title: "入力欄ありセクション",
    isCompletionTarget: false,
  },
];

function renderBuilder(
  container: HTMLElement,
  action: FormLogicAction,
  onChange: (action: FormLogicAction) => void,
  options: {
    completionTargetSections?: ComponentProps<
      typeof LogicActionBuilder
    >["completionTargetSections"];
  } = {},
): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <LogicActionBuilder
        action={action}
        availableBlocks={[]}
        availableSections={availableSections}
        completionTargetSections={
          options.completionTargetSections ?? completionTargetSections
        }
        onChange={onChange}
      />,
    );
  });
  return root;
}

describe("LogicActionBuilder", () => {
  it("selects the first inputless completion section when switching to submit", () => {
    const container = document.createElement("div");
    const onChange = vi.fn();
    const root = renderBuilder(container, { type: "next" }, onChange);
    const actionTypeSelect = container.querySelector("select");

    expect(actionTypeSelect?.textContent).toContain("送信後セクションへ移動");
    expect(actionTypeSelect?.textContent).not.toContain("送信する");

    act(() => {
      if (actionTypeSelect instanceof HTMLSelectElement) {
        actionTypeSelect.value = "submit";
        actionTypeSelect.dispatchEvent(
          new Event("change", { bubbles: true, cancelable: true }),
        );
      }
    });

    expect(onChange).toHaveBeenLastCalledWith({
      type: "submit",
      target_id: "section-complete",
    });

    act(() => root.unmount());
  });

  it("disables answerable sections as new submit completion targets", () => {
    const container = document.createElement("div");
    const root = renderBuilder(
      container,
      { type: "submit", target_id: "section-complete" },
      vi.fn(),
    );

    const targetOptions = Array.from(
      container.querySelectorAll<HTMLSelectElement>("select")[1]?.options ?? [],
    );
    const invalidTarget = targetOptions.find(
      (option) => option.value === "section-with-question",
    );

    expect(invalidTarget?.disabled).toBe(true);
    expect(container.textContent).toContain(
      "入力欄ありセクション（入力欄あり）",
    );

    act(() => root.unmount());
  });

  it("keeps an existing invalid submit target visible with a warning", () => {
    const container = document.createElement("div");
    const root = renderBuilder(
      container,
      { type: "submit", target_id: "section-with-question" },
      vi.fn(),
    );

    const selectedOption = container.querySelector<HTMLOptionElement>(
      'option[value="section-with-question"]',
    );

    expect(selectedOption?.disabled).toBe(false);
    expect(container.textContent).toContain(
      "選択中の完了セクションに入力欄が含まれています",
    );

    act(() => root.unmount());
  });

  it("keeps an existing missing submit target visible with a warning", () => {
    const container = document.createElement("div");
    const root = renderBuilder(
      container,
      { type: "submit", target_id: "deleted-section" },
      vi.fn(),
    );

    const missingOption = container.querySelector<HTMLOptionElement>(
      'option[value="deleted-section"]',
    );

    expect(missingOption?.textContent).toBe("不明な完了セクション");
    expect(container.textContent).toContain(
      "選択中の完了セクションが見つかりません",
    );

    act(() => root.unmount());
  });

  it("keeps submit without a target as the legacy confirmation flow", () => {
    const container = document.createElement("div");
    const root = renderBuilder(container, { type: "submit" }, vi.fn());

    expect(container.textContent).not.toContain(
      "選択中の完了セクションが見つかりません",
    );

    act(() => root.unmount());
  });

  it("does not show completion warnings for ordinary section jumps", () => {
    const container = document.createElement("div");
    const root = renderBuilder(
      container,
      { type: "jump_to_section", target_id: "section-with-question" },
      vi.fn(),
    );

    expect(container.textContent).not.toContain(
      "選択中の完了セクションに入力欄が含まれています",
    );

    act(() => root.unmount());
  });
});
