// @vitest-environment jsdom

import {
  fireEvent,
  getAllByRole,
  getByLabelText,
  getByRole,
} from "@testing-library/dom";
import type { TElement } from "platejs";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AnswerEntry,
  FormResponseProvider,
  useFormResponse,
} from "@/contexts/form-response-context";
import {
  getAssociatedLabel,
  requireInput,
} from "@/test-utils/form-control-labels";
import { CheckboxGridInput } from "./form-checkbox-grid-node";
import { CheckboxInput } from "./form-checkbox-node";
import { ChoiceGridInput } from "./form-choice-grid-node";
import { DateInput } from "./form-date-node";
import { DropdownInput } from "./form-dropdown-node";
import { LinearScaleInput } from "./form-linear-scale-node";
import { LongTextInput } from "./form-long-text-node";
import {
  getQuestionAccessibleName,
  getQuestionLabelId,
} from "./form-question-base";
import { RadioInput } from "./form-radio-node";
import { RatingInput } from "./form-rating-node";
import { ShortTextInput } from "./form-short-text-node";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

vi.mock("@nexus-form/shared", () => ({
  isIsoCalendarDate: (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value),
  isPlateQuestionType: () => true,
}));

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

vi.mock("./form-question-base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./form-question-base")>();
  return {
    ...actual,
    FormQuestionElement: ({ children }: { children: ReactNode }) => (
      <section>{children}</section>
    ),
  };
});

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
    initialAnswers?: ReadonlyMap<string, AnswerEntry>;
    labelElement?: TElement;
    onAnswer: (answer: AnswerEntry | undefined) => void;
  },
): { container: HTMLElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <FormResponseProvider initialAnswers={options.initialAnswers}>
        {options.labelElement && (
          <span id={getQuestionLabelId(options.blockId)}>
            {getQuestionAccessibleName(options.labelElement)}
          </span>
        )}
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

function getLabeledRadio(
  container: HTMLElement,
  name: string,
): {
  label: HTMLLabelElement;
  radio: HTMLElement;
  row: HTMLElement;
} {
  const radio = getByRole(container, "radio", { name });
  const label = container.querySelector<HTMLLabelElement>(
    `label[for="${radio.id}"]`,
  );
  if (!label) throw new Error(`Expected radio label for ${name}`);
  const row = label.parentElement;
  if (!row) throw new Error(`Expected radio row for ${name}`);
  return { label, radio, row };
}

function expectOnlyRadioSelected(container: HTMLElement, name: string): void {
  const radios = getAllByRole(container, "radio");
  expect(radios.filter((radio) => radio.getAttribute("aria-checked") === "true"))
    .toHaveLength(1);
  for (const radio of radios) {
    const isSelected = radio.getAttribute("aria-label") === name;
    expect(radio.getAttribute("aria-checked")).toBe(
      isSelected ? "true" : "false",
    );
  }
}

describe("public choice controls accessible labels", () => {
  it("names text and date inputs from the visible question label", () => {
    const shortTextElement = testElement("form_short_text", "full-name", {});
    shortTextElement.children = [
      { type: "p", children: [{ text: "氏名" }] },
    ];
    const shortText = renderWithAnswers(
      <ShortTextInput element={shortTextElement} />,
      {
        blockId: "full-name",
        labelElement: shortTextElement,
        onAnswer: vi.fn(),
      },
    );

    const textInput = requireInput(
      getByRole(shortText.container, "textbox", { name: "氏名" }),
    );
    expect(textInput.id).toBe("full-name-answer");
    expect(textInput.name).toBe("full-name");

    act(() => shortText.root.unmount());

    const longTextElement = testElement("form_long_text", "request", {});
    longTextElement.children = [
      { type: "p", children: [{ text: "ご要望" }] },
    ];
    const longText = renderWithAnswers(
      <LongTextInput element={longTextElement} />,
      {
        blockId: "request",
        labelElement: longTextElement,
        onAnswer: vi.fn(),
      },
    );

    expect(
      getByRole(longText.container, "textbox", { name: "ご要望" }),
    ).toBeTruthy();

    act(() => longText.root.unmount());

    const dateElement = testElement("form_date", "birth-date", {});
    dateElement.children = [
      { type: "p", children: [{ text: "生年月日" }] },
    ];
    const date = renderWithAnswers(<DateInput element={dateElement} />, {
      blockId: "birth-date",
      labelElement: dateElement,
      onAnswer: vi.fn(),
    });

    const dateInput = getByLabelText(date.container, "生年月日");
    expect(dateInput.getAttribute("id")).toBe("birth-date-answer");
    expect(dateInput.getAttribute("name")).toBe("birth-date");
    expect(dateInput.getAttribute("type")).toBe("date");

    act(() => date.root.unmount());
  });

  it("names dropdowns and other text inputs from the question label", () => {
    const dropdownElement = testElement(
      "form_dropdown",
      "residence-country",
      {
        options: [{ id: "jp", label: "日本" }],
        allowOther: true,
        otherLabel: "その他",
      },
    );
    dropdownElement.children = [
      { type: "p", children: [{ text: "居住国" }] },
    ];

    const dropdown = renderWithAnswers(
      <DropdownInput element={dropdownElement} />,
      {
        blockId: "residence-country",
        initialAnswers: new Map([
          [
            "residence-country",
            { value: "other", other_value: "" },
          ],
        ]),
        labelElement: dropdownElement,
        onAnswer: vi.fn(),
      },
    );

    expect(
      getByRole(dropdown.container, "combobox", { name: "居住国" }),
    ).toBeTruthy();
    expect(
      getByRole(dropdown.container, "textbox", {
        name: "居住国: その他を入力",
      }),
    ).toBeTruthy();

    act(() => dropdown.root.unmount());
  });

  it("prefers heading text when naming question controls", () => {
    const element = testElement("form_short_text", "heading-title", {});
    element.children = [
      { type: "p", children: [{ text: "補足説明" }] },
      { type: "h2", children: [{ text: "見出しタイトル" }] },
    ];

    const rendered = renderWithAnswers(<ShortTextInput element={element} />, {
      blockId: "heading-title",
      labelElement: element,
      onAnswer: vi.fn(),
    });

    expect(
      getByRole(rendered.container, "textbox", {
        name: "見出しタイトル",
      }),
    ).toBeTruthy();

    act(() => rendered.root.unmount());
  });

  it("names scale and rating buttons with the question label and value", () => {
    const scaleElement = testElement("form_linear_scale", "satisfaction", {
      min: 1,
      max: 3,
    });
    scaleElement.children = [
      { type: "p", children: [{ text: "満足度" }] },
    ];
    const scale = renderWithAnswers(
      <LinearScaleInput element={scaleElement} />,
      {
        blockId: "satisfaction",
        labelElement: scaleElement,
        onAnswer: vi.fn(),
      },
    );

    expect(
      getByRole(scale.container, "group", { name: "満足度" }),
    ).toBeTruthy();
    expect(
      getByRole(scale.container, "button", { name: "満足度: 2" }),
    ).toBeTruthy();

    act(() => scale.root.unmount());

    const ratingElement = testElement("form_rating", "service-rating", {
      maxRating: 3,
    });
    ratingElement.children = [
      { type: "p", children: [{ text: "サービス評価" }] },
    ];
    const rating = renderWithAnswers(<RatingInput element={ratingElement} />, {
      blockId: "service-rating",
      labelElement: ratingElement,
      onAnswer: vi.fn(),
    });

    expect(
      getByRole(rating.container, "group", { name: "サービス評価" }),
    ).toBeTruthy();
    expect(
      getByRole(rating.container, "button", {
        name: "サービス評価: 3",
      }),
    ).toBeTruthy();

    act(() => rating.root.unmount());
  });

  it("keeps radio switching routed through Radix value changes", async () => {
    const onAnswer = vi.fn();
    const element = testElement(
      "form_radio",
      "company-type",
      {
        options: [
          { id: "corp", label: "法人" },
          { id: "individual", label: "個人" },
          { id: "nonprofit", label: "NPO" },
        ],
      },
    );
    element.children = [
      { type: "p", children: [{ text: "会社種別" }] },
    ];
    const { container, root } = renderWithAnswers(
      <RadioInput element={element} />,
      {
        blockId: "company-type",
        labelElement: element,
        onAnswer,
      },
    );

    expect(
      getByRole(container, "radiogroup", { name: "会社種別" }),
    ).toBeTruthy();
    const corp = getLabeledRadio(container, "法人");
    const individual = getLabeledRadio(container, "個人");
    const nonprofit = getLabeledRadio(container, "NPO");
    expect(corp.row.className).toContain("w-full");

    await act(async () => {
      fireEvent.click(corp.row);
    });

    expect(onAnswer).toHaveBeenLastCalledWith({ value: "corp" });
    expect(document.activeElement).toBe(corp.radio);
    expectOnlyRadioSelected(container, "法人");
    const callCountAfterInitialSelection = onAnswer.mock.calls.length;

    await act(async () => {
      fireEvent.click(corp.radio);
    });

    expect(onAnswer).toHaveBeenLastCalledWith({ value: "corp" });
    expect(onAnswer).toHaveBeenCalledTimes(callCountAfterInitialSelection);
    expectOnlyRadioSelected(container, "法人");

    await act(async () => {
      fireEvent.click(individual.radio);
    });

    expect(onAnswer).toHaveBeenLastCalledWith({ value: "individual" });
    expectOnlyRadioSelected(container, "個人");

    await act(async () => {
      nonprofit.label.click();
    });

    expect(onAnswer).toHaveBeenLastCalledWith({ value: "nonprofit" });
    expectOnlyRadioSelected(container, "NPO");

    await act(async () => {
      fireEvent.click(corp.row);
    });

    expect(onAnswer).toHaveBeenLastCalledWith({ value: "corp" });
    expectOnlyRadioSelected(container, "法人");

    await act(async () => {
      individual.radio.focus();
    });
    expect(document.activeElement).toBe(individual.radio);
    expect(individual.radio.getAttribute("aria-checked")).toBe("false");

    act(() => root.unmount());
  });

  it("keeps only the last radio option selected across consecutive clicks", async () => {
    const onAnswer = vi.fn();
    const element = testElement(
      "form_radio",
      "company-type-sequence",
      {
        options: [
          { id: "corp", label: "法人" },
          { id: "individual", label: "個人" },
          { id: "nonprofit", label: "NPO" },
        ],
      },
    );
    element.children = [
      { type: "p", children: [{ text: "会社種別" }] },
    ];
    const { container, root } = renderWithAnswers(
      <RadioInput element={element} />,
      {
        blockId: "company-type-sequence",
        labelElement: element,
        onAnswer,
      },
    );

    const corp = getLabeledRadio(container, "法人");
    const individual = getLabeledRadio(container, "個人");
    const nonprofit = getLabeledRadio(container, "NPO");
    const clicks: [() => void, string, string][] = [
      [() => fireEvent.click(nonprofit.radio), "nonprofit", "NPO"],
      [() => individual.label.click(), "individual", "個人"],
      [() => fireEvent.click(corp.row), "corp", "法人"],
      [() => fireEvent.click(individual.radio), "individual", "個人"],
      [() => nonprofit.label.click(), "nonprofit", "NPO"],
      [() => fireEvent.click(corp.radio), "corp", "法人"],
    ];

    for (const [click, value, name] of clicks) {
      await act(async () => {
        click();
      });

      expect(onAnswer).toHaveBeenLastCalledWith({ value });
      expectOnlyRadioSelected(container, name);
    }

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
    element.children = [
      { type: "p", children: [{ text: "会社タグ" }] },
    ];
    const { container, root } = renderWithAnswers(
      <CheckboxInput element={element} />,
      {
        blockId: "company-tags",
        labelElement: element,
        onAnswer,
      },
    );

    expect(
      getByRole(container, "group", { name: "会社タグ" }),
    ).toBeTruthy();
    expect(onAnswer).toHaveBeenCalledTimes(1);
    const checkboxes = getAllByRole(container, "checkbox", { name: "法人" });
    expect(checkboxes).toHaveLength(2);
    const secondCheckbox = checkboxes[1];
    expect(secondCheckbox).toBeDefined();
    if (!secondCheckbox) throw new Error("Expected second checkbox");
    const secondCheckboxLabel = container.querySelector<HTMLLabelElement>(
      `label[for="${secondCheckbox.id}"]`,
    );
    expect(secondCheckboxLabel).toBeTruthy();
    if (!secondCheckboxLabel) {
      throw new Error("Expected checkbox row label");
    }
    const secondCheckboxRow = secondCheckboxLabel.parentElement;
    expect(secondCheckboxRow?.className).toContain("w-full");

    await act(async () => {
      fireEvent.click(secondCheckboxRow ?? secondCheckboxLabel);
    });

    expect(onAnswer).toHaveBeenLastCalledWith({
      values: ["corp-secondary"],
      other_values: undefined,
    });
    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(secondCheckbox);

    const firstCheckbox = checkboxes[0];
    expect(firstCheckbox).toBeDefined();
    if (!firstCheckbox) throw new Error("Expected first checkbox");
    const firstCheckboxLabel = container.querySelector<HTMLLabelElement>(
      `label[for="${firstCheckbox.id}"]`,
    );
    expect(firstCheckboxLabel).toBeTruthy();
    if (!firstCheckboxLabel) {
      throw new Error("Expected first checkbox label");
    }
    await act(async () => {
      firstCheckboxLabel.click();
    });

    expect(onAnswer).toHaveBeenLastCalledWith({
      values: ["corp-secondary", "corp-primary"],
      other_values: undefined,
    });
    expect(onAnswer).toHaveBeenCalledTimes(3);

    act(() => root.unmount());
  });

  it("uses a single checkbox update path for control, label, row, and other clicks", async () => {
    const onAnswer = vi.fn();
    const element = testElement(
      "form_checkbox",
      "company-tags-other",
      {
        allowOther: true,
        otherLabel: "その他",
        options: [
          { id: "corp", label: "法人" },
          { id: "individual", label: "個人" },
        ],
      },
    );
    element.children = [
      { type: "p", children: [{ text: "会社タグ" }] },
    ];
    const { container, root } = renderWithAnswers(
      <CheckboxInput element={element} />,
      {
        blockId: "company-tags-other",
        labelElement: element,
        onAnswer,
      },
    );

    const corpCheckbox = getByRole(container, "checkbox", { name: "法人" });
    const corpLabel = container.querySelector<HTMLLabelElement>(
      `label[for="${corpCheckbox.id}"]`,
    );
    const corpRow = corpLabel?.parentElement;
    if (!corpLabel || !corpRow) {
      throw new Error("Expected checkbox label and row");
    }
    expect(onAnswer).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(corpCheckbox);
    });
    expect(onAnswer).toHaveBeenLastCalledWith({
      values: ["corp"],
      other_values: undefined,
    });
    expect(onAnswer).toHaveBeenCalledTimes(2);

    await act(async () => {
      corpLabel.click();
    });
    expect(onAnswer).toHaveBeenLastCalledWith({
      values: [],
      other_values: undefined,
    });
    expect(onAnswer).toHaveBeenCalledTimes(3);

    await act(async () => {
      fireEvent.click(corpRow);
    });
    expect(onAnswer).toHaveBeenLastCalledWith({
      values: ["corp"],
      other_values: undefined,
    });
    expect(onAnswer).toHaveBeenCalledTimes(4);

    const otherCheckbox = getByRole(container, "checkbox", { name: "その他" });
    const otherLabel = container.querySelector<HTMLLabelElement>(
      `label[for="${otherCheckbox.id}"]`,
    );
    const otherRow = otherLabel?.parentElement;
    if (!otherLabel || !otherRow) {
      throw new Error("Expected other checkbox label and row");
    }

    await act(async () => {
      otherLabel.click();
    });
    expect(onAnswer).toHaveBeenLastCalledWith({
      values: ["corp", "other"],
      other_values: [],
    });
    expect(onAnswer).toHaveBeenCalledTimes(5);

    await act(async () => {
      fireEvent.click(otherCheckbox);
    });
    expect(onAnswer).toHaveBeenLastCalledWith({
      values: ["corp"],
      other_values: undefined,
    });
    expect(onAnswer).toHaveBeenCalledTimes(6);

    await act(async () => {
      fireEvent.click(otherRow);
    });
    expect(onAnswer).toHaveBeenLastCalledWith({
      values: ["corp", "other"],
      other_values: [],
    });
    expect(onAnswer).toHaveBeenCalledTimes(7);

    act(() => root.unmount());
  });

  it("keeps selected checkboxes removable when max selections disables the rest", async () => {
    const onAnswer = vi.fn();
    const element = testElement(
      "form_checkbox",
      "company-tags-limited",
      {
        options: [
          { id: "corp-primary", label: "法人" },
          { id: "corp-secondary", label: "個人" },
        ],
        maxSelections: 1,
      },
    );
    element.children = [
      { type: "p", children: [{ text: "会社タグ" }] },
    ];
    const { container, root } = renderWithAnswers(
      <CheckboxInput element={element} />,
      {
        blockId: "company-tags-limited",
        initialAnswers: new Map([
          [
            "company-tags-limited",
            { values: ["corp-primary"] },
          ],
        ]),
        labelElement: element,
        onAnswer,
      },
    );

    const selectedCheckbox = getByRole(container, "checkbox", {
      name: "法人",
    });
    const disabledCheckbox = getByRole(container, "checkbox", {
      name: "個人",
    }) as HTMLButtonElement;
    const disabledLabel = container.querySelector<HTMLLabelElement>(
      `label[for="${disabledCheckbox.id}"]`,
    );
    expect(disabledCheckbox.disabled).toBe(true);
    expect(disabledLabel?.className).toContain("cursor-not-allowed");
    expect(onAnswer).toHaveBeenCalledTimes(1);

    await act(async () => {
      disabledLabel?.click();
    });
    expect(onAnswer).toHaveBeenLastCalledWith({
      values: ["corp-primary"],
    });
    expect(onAnswer).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(disabledCheckbox);
    });
    expect(onAnswer).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(disabledLabel?.parentElement ?? disabledCheckbox);
    });
    expect(onAnswer).toHaveBeenCalledTimes(1);

    const selectedLabel = container.querySelector<HTMLLabelElement>(
      `label[for="${selectedCheckbox.id}"]`,
    );
    expect(selectedLabel?.parentElement?.className).toContain("bg-primary/5");
    await act(async () => {
      fireEvent.click(selectedLabel?.parentElement ?? selectedCheckbox);
    });
    expect(onAnswer).toHaveBeenLastCalledWith({
      values: [],
      other_values: undefined,
    });
    expect(onAnswer).toHaveBeenCalledTimes(2);

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
    element.children = [
      { type: "p", children: [{ text: "契約マトリクス" }] },
    ];
    const { container, root } = renderWithAnswers(
      <ChoiceGridInput element={element} />,
      {
        blockId: "contract-grid",
        labelElement: element,
        onAnswer,
      },
    );

    expect(
      getByRole(container, "group", { name: "契約マトリクス" }),
    ).toBeTruthy();
    const cell = requireInput(
      getByRole(container, "radio", { name: "契約種別: 法人" }),
    );
    const secondCell = requireInput(
      getByRole(container, "radio", { name: "契約種別: 個人" }),
    );
    expect(cell.id).not.toBe("");
    expect(cell.name).toBe(secondCell.name);
    expect(getAssociatedLabel(container, cell).htmlFor).toBe(cell.id);
    expect(getAssociatedLabel(container, cell).className).toContain("w-full");
    cell.focus();
    expect(document.activeElement).toBe(cell);
    expect(onAnswer).toHaveBeenCalledTimes(1);

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
    element.children = [
      { type: "p", children: [{ text: "契約チェック項目" }] },
    ];
    const { container, root } = renderWithAnswers(
      <CheckboxGridInput element={element} />,
      {
        blockId: "contract-checkbox-grid",
        labelElement: element,
        onAnswer,
      },
    );

    expect(
      getByRole(container, "group", { name: "契約チェック項目" }),
    ).toBeTruthy();
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
    expect(getAssociatedLabel(container, cell).className).toContain("w-full");
    cell.focus();
    expect(document.activeElement).toBe(cell);

    await act(async () => {
      fireEvent.click(cell);
    });

    expect(onAnswer).toHaveBeenLastCalledWith({
      responses: { "contract-type": ["corp"] },
    });
    expect(onAnswer).toHaveBeenCalledTimes(2);
    expect(cell.checked).toBe(true);

    await act(async () => {
      getAssociatedLabel(container, secondCell).click();
    });

    expect(onAnswer).toHaveBeenLastCalledWith({
      responses: { "contract-type": ["corp", "individual"] },
    });
    expect(onAnswer).toHaveBeenCalledTimes(3);
    expect(cell.checked).toBe(true);
    expect(secondCell.checked).toBe(true);

    await act(async () => {
      fireEvent.click(cell);
    });

    expect(onAnswer).toHaveBeenLastCalledWith({
      responses: { "contract-type": ["individual"] },
    });
    expect(onAnswer).toHaveBeenCalledTimes(4);
    expect(cell.checked).toBe(false);
    expect(secondCell.checked).toBe(true);

    act(() => root.unmount());
  });

  it("keeps selected checkbox grid cells removable when row max disables the rest", async () => {
    const onAnswer = vi.fn();
    const element = testElement(
      "form_checkbox_grid",
      "limited-checkbox-grid",
      {
        rows: [{ id: "contract-type", label: "契約種別" }],
        columns: [
          { id: "corp", label: "法人" },
          { id: "individual", label: "個人" },
        ],
        maxSelectionsPerRow: 1,
      },
    );
    element.children = [
      { type: "p", children: [{ text: "契約チェック項目" }] },
    ];
    const { container, root } = renderWithAnswers(
      <CheckboxGridInput element={element} />,
      {
        blockId: "limited-checkbox-grid",
        initialAnswers: new Map([
          [
            "limited-checkbox-grid",
            { responses: { "contract-type": ["corp"] } },
          ],
        ]),
        labelElement: element,
        onAnswer,
      },
    );

    const selectedCell = requireInput(
      getByRole(container, "checkbox", {
        name: "契約種別: 法人",
      }),
    );
    const disabledCell = requireInput(
      getByRole(container, "checkbox", {
        name: "契約種別: 個人",
      }),
    );
    const selectedCellLabel = getAssociatedLabel(container, selectedCell);
    const disabledCellLabel = getAssociatedLabel(container, disabledCell);

    expect(disabledCell.disabled).toBe(true);
    expect(disabledCellLabel.className).toContain("cursor-not-allowed");
    expect(selectedCellLabel.className).toContain("bg-primary/5");
    expect(onAnswer).toHaveBeenCalledTimes(1);

    await act(async () => {
      disabledCellLabel.click();
    });
    expect(onAnswer).toHaveBeenLastCalledWith({
      responses: { "contract-type": ["corp"] },
    });
    expect(onAnswer).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(disabledCell);
    });
    expect(onAnswer).toHaveBeenCalledTimes(1);

    await act(async () => {
      selectedCellLabel.click();
    });
    expect(onAnswer).toHaveBeenLastCalledWith({
      responses: { "contract-type": [] },
    });
    expect(onAnswer).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
  });
});
