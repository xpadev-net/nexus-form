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

vi.mock("./form-question-base", () => {
  const headingTypes = ["h1", "h2", "h3", "h4", "h5", "h6"];
  const collectText = (node: unknown): string => {
    if (typeof node !== "object" || node === null) {
      return "";
    }
    const record = node as { children?: unknown; text?: unknown };
    if (Array.isArray(record.children)) {
      return record.children.map(collectText).join("");
    }
    return typeof record.text === "string" ? record.text : "";
  };
  const getQuestionAccessibleName = (element: TElement): string => {
    const children = Array.isArray(element.children) ? element.children : [];
    const headingText = children
      .filter(
        (child) =>
          typeof child === "object" &&
          child !== null &&
          headingTypes.includes((child as { type?: unknown }).type as string),
      )
      .map((child) => collectText(child).replace(/\s+/g, " ").trim())
      .find(Boolean);
    const texts = children.map((child) =>
      collectText(child).replace(/\s+/g, " ").trim(),
    );
    const prefix = /^Q\d+\.$/.test(texts[0] ?? "") ? `${texts[0]} ` : "";
    const title =
      headingText ?? texts.find((text) => text && !/^Q\d+\.$/.test(text));
    return `${prefix}${title ?? ""}`.trim() || "無題の質問";
  };
  const getQuestionLabelId = (blockId: string): string =>
    `${blockId}-question-label`;
  const getQuestionControlId = (blockId: string, suffix = "answer"): string =>
    `${blockId}-${suffix}`;

  return {
    collectText,
    FormQuestionElement: ({ children }: { children: ReactNode }) => (
      <section>{children}</section>
    ),
    getQuestionAccessibleName,
    getQuestionControlId,
    getQuestionControlLabelProps: (blockId: string) => ({
      id: getQuestionControlId(blockId),
      name: blockId,
      "aria-labelledby": getQuestionLabelId(blockId),
    }),
    getQuestionLabelId,
    getQuestionValueAccessibleName: (
      element: TElement,
      valueLabel: string,
    ) => `${getQuestionAccessibleName(element)}: ${valueLabel}`,
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
