// @vitest-environment jsdom

import { fireEvent, getAllByRole, getByRole } from "@testing-library/dom";
import type { TElement } from "platejs";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  type AnswerEntry,
  FormResponseProvider,
  useFormResponse,
} from "@/contexts/form-response-context";
import { CheckboxGridInput } from "./form-checkbox-grid-node";
import { CheckboxInput } from "./form-checkbox-node";
import { ChoiceGridInput } from "./form-choice-grid-node";
import { RadioInput } from "./form-radio-node";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./editor-controls", () => ({
  AllowOtherEditor: () => null,
  CheckboxGridInput: () => null,
  ChoiceOptionsEditor: () => null,
  EditorControlsWrapper: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  GridItemsEditor: () => null,
  GridSelectionLimitsEditor: () => null,
  SelectionLimitsEditor: () => null,
}));

vi.mock("./form-question-base", () => ({
  FormQuestionElement: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
}));

function AnswerProbe({
  blockId,
  onAnswer,
}: {
  blockId: string;
  onAnswer: (answer: AnswerEntry | undefined) => void;
}) {
  const { answers } = useFormResponse();
  onAnswer(answers.get(blockId));
  return null;
}

function renderWithAnswers(
  control: ReactNode,
  options: {
    blockId: string;
    onAnswer: (answer: AnswerEntry | undefined) => void;
  },
): { container: HTMLElement; root: Root } {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(
      <FormResponseProvider>
        {control}
        <AnswerProbe blockId={options.blockId} onAnswer={options.onAnswer} />
      </FormResponseProvider>,
    );
  });
  return { container, root };
}

function testElement(
  type: string,
  blockId: string,
  validation: Record<string, unknown>,
): TElement {
  return {
    type,
    blockId,
    validation,
    children: [{ text: "" }],
  };
}

function getAssociatedLabel(
  container: HTMLElement,
  input: HTMLInputElement,
): HTMLLabelElement {
  const label = container.querySelector<HTMLLabelElement>(
    `label[for="${input.id}"]`,
  );
  if (!label) {
    throw new Error(`Expected label for ${input.id}`);
  }
  return label;
}

function requireInput(element: HTMLElement): HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("Expected a native input element");
  }
  return element;
}

describe("public choice controls accessible labels", () => {
  it("exposes radio options by visible label and keeps saving option IDs", async () => {
    const onAnswer = vi.fn();
    const element = testElement(
      "form_radio",
      "company-type",
      {
        options: [
          { id: "corp", label: "法人" },
          { id: "individual", label: "個人" },
        ],
      },
    );
    const { container, root } = renderWithAnswers(
      <RadioInput element={element} />,
      { blockId: "company-type", onAnswer },
    );

    const radio = getByRole(container, "radio", { name: "法人" });
    await act(async () => {
      fireEvent.click(radio);
    });

    expect(onAnswer).toHaveBeenLastCalledWith({ value: "corp" });

    act(() => root.unmount());
  });

  it("exposes duplicate checkbox labels while saving the clicked option ID", async () => {
    const onAnswer = vi.fn();
    const element = testElement(
      "form_checkbox",
      "company-tags",
      {
        options: [
          { id: "corp-primary", label: "法人" },
          { id: "corp-secondary", label: "法人" },
        ],
      },
    );
    const { container, root } = renderWithAnswers(
      <CheckboxInput element={element} />,
      { blockId: "company-tags", onAnswer },
    );

    const checkboxes = getAllByRole(container, "checkbox", { name: "法人" });
    expect(checkboxes).toHaveLength(2);
    const secondCheckbox = checkboxes[1];
    expect(secondCheckbox).toBeDefined();
    if (!secondCheckbox) throw new Error("Expected second checkbox");

    await act(async () => {
      fireEvent.click(secondCheckbox);
    });

    expect(onAnswer).toHaveBeenLastCalledWith({
      values: ["corp-secondary"],
      other_values: undefined,
    });

    act(() => root.unmount());
  });

  it("exposes choice grid cells as native radios with label-backed cell clicks", async () => {
    const onAnswer = vi.fn();
    const element = testElement(
      "form_choice_grid",
      "contract-grid",
      {
        rows: [{ id: "contract-type", label: "契約種別" }],
        columns: [
          { id: "corp", label: "法人" },
          { id: "individual", label: "個人" },
        ],
      },
    );
    const { container, root } = renderWithAnswers(
      <ChoiceGridInput element={element} />,
      { blockId: "contract-grid", onAnswer },
    );

    const cell = requireInput(
      getByRole(container, "radio", { name: "契約種別: 法人" }),
    );
    const secondCell = requireInput(
      getByRole(container, "radio", { name: "契約種別: 個人" }),
    );
    expect(cell.id).not.toBe("");
    expect(cell.name).toBe(secondCell.name);
    expect(getAssociatedLabel(container, cell).htmlFor).toBe(cell.id);

    await act(async () => {
      fireEvent.click(cell);
    });

    expect(onAnswer).toHaveBeenLastCalledWith({
      responses: { "contract-type": "corp" },
    });
    expect(cell.checked).toBe(true);

    await act(async () => {
      getAssociatedLabel(container, secondCell).click();
    });

    expect(onAnswer).toHaveBeenLastCalledWith({
      responses: { "contract-type": "individual" },
    });
    expect(cell.checked).toBe(false);
    expect(secondCell.checked).toBe(true);

    act(() => root.unmount());
  });

  it("exposes checkbox grid cells as native checkboxes with label-backed cell clicks", async () => {
    const onAnswer = vi.fn();
    const element = testElement(
      "form_checkbox_grid",
      "contract-checkbox-grid",
      {
        rows: [{ id: "contract-type", label: "契約種別" }],
        columns: [
          { id: "corp", label: "法人" },
          { id: "individual", label: "個人" },
        ],
      },
    );
    const { container, root } = renderWithAnswers(
      <CheckboxGridInput element={element} />,
      { blockId: "contract-checkbox-grid", onAnswer },
    );

    const cell = requireInput(
      getByRole(container, "checkbox", {
        name: "契約種別: 法人",
      }),
    );
    const secondCell = requireInput(
      getByRole(container, "checkbox", {
        name: "契約種別: 個人",
      }),
    );
    expect(cell.id).not.toBe("");
    expect(getAssociatedLabel(container, cell).htmlFor).toBe(cell.id);

    await act(async () => {
      fireEvent.click(cell);
    });

    expect(onAnswer).toHaveBeenLastCalledWith({
      responses: { "contract-type": ["corp"] },
    });
    expect(cell.checked).toBe(true);

    await act(async () => {
      getAssociatedLabel(container, secondCell).click();
    });

    expect(onAnswer).toHaveBeenLastCalledWith({
      responses: { "contract-type": ["corp", "individual"] },
    });
    expect(cell.checked).toBe(true);
    expect(secondCell.checked).toBe(true);

    await act(async () => {
      fireEvent.click(cell);
    });

    expect(onAnswer).toHaveBeenLastCalledWith({
      responses: { "contract-type": ["individual"] },
    });
    expect(cell.checked).toBe(false);
    expect(secondCell.checked).toBe(true);

    act(() => root.unmount());
  });
});
