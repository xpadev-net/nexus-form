// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { FormLogicCondition } from "@/types/validation/form";
import { LogicConditionBuilder } from "./logic-condition-builder";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    type = "button",
    ...props
  }: ComponentProps<"button"> & {
    size?: string;
    variant?: string;
  }) => (
    <button {...props} type={type}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: Omit<ComponentProps<"input">, "checked" | "onChange"> & {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }) => (
    <input
      {...props}
      type="checkbox"
      checked={checked === true}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
    />
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));

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
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    placeholder ? <option value="">{placeholder}</option> : null,
}));

const availableBlocks = [
  {
    blockId: "q-radio",
    title: "色",
    questionType: "radio",
    valueOptions: [
      { value: "red", label: "赤" },
      { value: "blue", label: "青" },
    ],
  },
  {
    blockId: "q-dropdown",
    title: "サイズ",
    questionType: "dropdown",
    valueOptions: [
      { value: "small", label: "小" },
      { value: "large", label: "大" },
    ],
  },
  {
    blockId: "q-checkbox",
    title: "機能",
    questionType: "checkbox",
    valueOptions: [
      { value: "export", label: "エクスポート" },
      { value: "share", label: "共有" },
    ],
  },
] satisfies ComponentProps<typeof LogicConditionBuilder>["availableBlocks"];

function renderBuilder(
  container: HTMLElement,
  conditions: FormLogicCondition[],
  onChange: (conditions: FormLogicCondition[]) => void,
): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <LogicConditionBuilder
        conditions={conditions}
        availableBlocks={availableBlocks}
        onChange={onChange}
        conditionMatch="all"
        onConditionMatchChange={vi.fn()}
      />,
    );
  });
  return root;
}

function changeSelect(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function changeCheckbox(checkbox: HTMLInputElement, checked: boolean) {
  act(() => {
    if (checkbox.checked !== checked) {
      checkbox.click();
    }
  });
}

describe("LogicConditionBuilder", () => {
  it("選択式の radio 条件値をラベルではなく option ID として保存する", () => {
    const container = document.createElement("div");
    let changed: FormLogicCondition[] | undefined;
    const root = renderBuilder(
      container,
      [{ question_id: "q-radio", operator: "equals", value: "red" }],
      (conditions) => {
        changed = conditions;
      },
    );

    const selects = container.querySelectorAll("select");
    expect(selects[2]?.value).toBe("red");

    changeSelect(selects[2] as HTMLSelectElement, "blue");

    expect(changed?.[0]).toMatchObject({
      question_id: "q-radio",
      operator: "equals",
      value: "blue",
    });
    root.unmount();
  });

  it("質問変更時に dropdown の先頭 option ID へ互換性のない値を初期化する", () => {
    const container = document.createElement("div");
    let changed: FormLogicCondition[] | undefined;
    const root = renderBuilder(
      container,
      [{ question_id: "q-radio", operator: "equals", value: "red" }],
      (conditions) => {
        changed = conditions;
      },
    );

    const selects = container.querySelectorAll("select");
    changeSelect(selects[0] as HTMLSelectElement, "q-dropdown");

    expect(changed?.[0]).toMatchObject({
      question_id: "q-dropdown",
      operator: "equals",
      value: "small",
    });
    root.unmount();
  });

  it("checkbox の includes_all は複数 option ID を配列として保存する", () => {
    const container = document.createElement("div");
    let changed: FormLogicCondition[] | undefined;
    const root = renderBuilder(
      container,
      [
        {
          question_id: "q-checkbox",
          operator: "includes_all",
          value: ["export"],
        },
      ],
      (conditions) => {
        changed = conditions;
      },
    );

    const checkboxes = container.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(checkboxes).toHaveLength(2);

    changeCheckbox(checkboxes[1] as HTMLInputElement, true);

    expect(changed?.[0]).toMatchObject({
      question_id: "q-checkbox",
      operator: "includes_all",
      value: ["export", "share"],
    });
    root.unmount();
  });

  it("operator 変更時に複数値を単一値へ安全に初期化する", () => {
    const container = document.createElement("div");
    let changed: FormLogicCondition[] | undefined;
    const root = renderBuilder(
      container,
      [
        {
          question_id: "q-checkbox",
          operator: "includes_any",
          value: ["export", "share"],
        },
      ],
      (conditions) => {
        changed = conditions;
      },
    );

    const selects = container.querySelectorAll("select");
    changeSelect(selects[1] as HTMLSelectElement, "equals");

    expect(changed?.[0]).toMatchObject({
      question_id: "q-checkbox",
      operator: "equals",
      value: "export",
    });
    root.unmount();
  });
});
