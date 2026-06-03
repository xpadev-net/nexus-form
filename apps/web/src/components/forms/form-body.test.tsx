// @vitest-environment jsdom

import { fireEvent, getByRole } from "@testing-library/dom";
import type { TElement } from "platejs";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AnswerEntry,
  FormResponseProvider,
} from "@/contexts/form-response-context";
import type { FormAppearance } from "@/types/validation/form";
import type { FormSubmitRequestData } from "./form-body";
import { FormBody } from "./form-body";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const plateViewerValues = vi.hoisted(() => [] as string[]);

vi.mock("@/components/editor/plate-viewer", async () => {
  const { DateInput } = await import(
    "@/components/ui/form-question-nodes/form-date-node"
  );
  const { CheckboxGridInput } = await import(
    "@/components/ui/form-question-nodes/form-checkbox-grid-node"
  );
  const { ChoiceGridInput } = await import(
    "@/components/ui/form-question-nodes/form-choice-grid-node"
  );

  return {
    PlateViewer: ({ value }: { value: string }) => {
      plateViewerValues.push(value);
      let nodes: unknown[] = [];
      try {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed)) {
          nodes = parsed;
        }
      } catch {
        nodes = [];
      }

      return (
        <div data-testid="plate-viewer">
          {value}
          {nodes.map((node, index) => {
            const key =
              typeof node === "object" && node !== null
                ? ((node as { blockId?: unknown }).blockId?.toString() ?? index)
                : index;
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_date"
            ) {
              return <DateInput key={key} element={node as TElement} />;
            }
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_choice_grid"
            ) {
              return <ChoiceGridInput key={key} element={node as TElement} />;
            }
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_checkbox_grid"
            ) {
              return <CheckboxGridInput key={key} element={node as TElement} />;
            }
            return null;
          })}
        </div>
      );
    },
  };
});

function renderFormBody(
  container: HTMLElement,
  plateContent: string,
  options: {
    appearance?: FormAppearance;
    captchaReady?: boolean;
    description?: string;
    initialAnswers?: ReadonlyMap<string, AnswerEntry>;
    onSubmitRequest?: (data: FormSubmitRequestData) => void;
  } = {},
): Root {
  function FormBodyHarness() {
    const [error, setError] = useState<string | null>(null);

    return (
      <FormResponseProvider initialAnswers={options.initialAnswers}>
        <FormBody
          title="公開フォーム"
          plateContent={plateContent}
          mode="public"
          appearance={options.appearance}
          captchaReady={options.captchaReady}
          description={options.description}
          error={error}
          onErrorChange={setError}
          onSubmitRequest={options.onSubmitRequest}
        />
      </FormResponseProvider>
    );
  }

  const root = createRoot(container);
  act(() => {
    root.render(<FormBodyHarness />);
  });
  return root;
}

function questionNode(
  type: string,
  blockId: string,
  title: string,
  validation?: Record<string, unknown>,
) {
  return {
    type: `form_${type}`,
    blockId,
    ...(validation ? { validation } : {}),
    children: [{ type: "p", children: [{ text: title }] }],
  };
}

function publicQuestionFixturePlateContent(): string {
  const rows = [
    { id: "row-a", label: "Row A" },
    { id: "row-b", label: "Row B" },
  ];
  const columns = [
    { id: "col-1", label: "Column 1" },
    { id: "col-2", label: "Column 2" },
  ];

  return JSON.stringify([
    questionNode("section_separator", "section-main", "Main section"),
    questionNode("short_text", "q-short", "Short answer", {
      required: true,
      minLength: 2,
      maxLength: 20,
    }),
    questionNode("long_text", "q-long", "Long answer", { required: true }),
    questionNode("radio", "q-radio", "Radio choice", {
      required: true,
      options: [
        { id: "yes", label: "Yes" },
        { id: "no", label: "No" },
      ],
    }),
    questionNode("checkbox", "q-checkbox", "Checkbox choice", {
      required: true,
      minSelections: 2,
      maxSelections: 3,
      options: [
        { id: "red", label: "Red" },
        { id: "blue", label: "Blue" },
        { id: "green", label: "Green" },
      ],
    }),
    questionNode("dropdown", "q-dropdown", "Dropdown choice", {
      required: true,
      options: [
        { id: "jp", label: "Japan" },
        { id: "us", label: "United States" },
      ],
    }),
    questionNode("linear_scale", "q-scale", "Linear scale", {
      required: true,
      min: 1,
      max: 5,
    }),
    questionNode("rating", "q-rating", "Rating", {
      required: true,
      min: 1,
      max: 5,
      maxRating: 5,
    }),
    questionNode("choice_grid", "q-choice-grid", "Choice grid", {
      required: true,
      rows,
      columns,
    }),
    questionNode("checkbox_grid", "q-checkbox-grid", "Checkbox grid", {
      required: true,
      rows,
      columns,
      minSelectionsPerRow: 1,
      maxSelectionsPerRow: 2,
    }),
    questionNode("date", "q-date", "Date", {
      required: true,
      minDate: "2026-01-01",
      maxDate: "2026-12-31",
    }),
    questionNode("time", "q-time", "Time", {
      required: true,
      minTime: "09:00",
      maxTime: "17:00",
    }),
  ]);
}

function appearanceWithQuestionNumbers(
  showQuestionNumbers: boolean,
): FormAppearance {
  return {
    theme: {
      primary_color: "#2563eb",
      accent_color: "#16a34a",
      background_color: "#ffffff",
      font_family: "Inter",
    },
    layout: {
      width: "compact",
      alignment: "left",
      spacing: "compact",
      show_progress_bar: true,
      progress_position: "top",
      show_question_numbers: showQuestionNumbers,
    },
  };
}

function clickAssociatedLabel(container: HTMLElement, input: HTMLInputElement) {
  const label = container.querySelector<HTMLLabelElement>(
    `label[for="${input.id}"]`,
  );
  if (!label) {
    throw new Error(`Expected label for ${input.id}`);
  }
  label.click();
}

function requireInput(element: HTMLElement): HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("Expected a native input element");
  }
  return element;
}

describe("FormBody", () => {
  beforeEach(() => {
    plateViewerValues.length = 0;
  });

  it("excludes isolated slash and empty blocks from public viewer content", () => {
    const plateContent = JSON.stringify([
      { type: "p", children: [{ text: "/" }] },
      {
        type: "p",
        children: [{ type: "a", url: "/", children: [{ text: "/" }] }],
      },
      { type: "p", children: [{ text: "" }] },
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text", required: false },
        children: [{ type: "p", children: [{ text: "氏名" }] }],
      },
    ]);

    const container = document.createElement("div");
    const root = renderFormBody(container, plateContent);

    const renderedValue = plateViewerValues.at(-1);
    expect(renderedValue).toBeDefined();
    expect(JSON.parse(renderedValue ?? "[]")).toEqual([
      {
        type: "form_short_text",
        blockId: "question-1",
        validation: { type: "short_text", required: false },
        children: [{ type: "p", children: [{ text: "氏名" }] }],
      },
    ]);
    expect(renderedValue).not.toContain("Q1.");
    expect(
      container.querySelector("[data-form-question-numbers='hidden']"),
    ).not.toBeNull();
    expect(container.textContent).not.toContain('text":"/"');

    act(() => root.unmount());
  });

  it("hides question numbers when appearance disables them", () => {
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      JSON.stringify([
        questionNode("short_text", "question-1", "氏名", {
          required: false,
        }),
      ]),
      {
        appearance: appearanceWithQuestionNumbers(false),
      },
    );

    const renderedValue = plateViewerValues.at(-1);
    expect(renderedValue).toBeDefined();
    expect(renderedValue).not.toContain("Q1.");
    expect(
      container
        .querySelector<HTMLElement>("[data-form-appearance-width='compact']")
        ?.style.getPropertyValue("--primary-foreground"),
    ).toBe("white");
    expect(
      container.querySelector("[data-form-question-numbers='hidden']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-form-appearance-width='compact']"),
    ).not.toBeNull();

    act(() => root.unmount());
  });

  it("adds global question numbers to nested public questions", () => {
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      JSON.stringify([
        {
          type: "column_group",
          children: [
            {
              type: "column",
              children: [
                questionNode(
                  "short_text",
                  "nested-question",
                  "Nested question",
                  {
                    required: false,
                  },
                ),
              ],
            },
          ],
        },
      ]),
      { appearance: appearanceWithQuestionNumbers(true) },
    );

    const renderedValue = plateViewerValues.at(-1);
    expect(renderedValue).toBeDefined();
    expect(JSON.parse(renderedValue ?? "[]")).toEqual([
      {
        type: "column_group",
        children: [
          {
            type: "column",
            children: [
              {
                type: "form_short_text",
                blockId: "nested-question",
                validation: { required: false },
                children: [
                  { type: "p", children: [{ bold: true, text: "Q1. " }] },
                  { type: "p", children: [{ text: "Nested question" }] },
                ],
              },
            ],
          },
        ],
      },
    ]);

    act(() => root.unmount());
  });

  it("treats slash-only sanitized content as an empty form body", () => {
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      JSON.stringify([{ type: "p", children: [{ text: "/" }] }]),
    );

    expect(container.textContent).toContain("フォームの内容が空です。");
    expect(plateViewerValues).toEqual([]);

    act(() => root.unmount());
  });

  it("renders a long multipage grid form without leaving loading text in the body", () => {
    const longDescription = Array.from(
      { length: 10 },
      (_, index) => `説明テキスト ${index + 1}`,
    ).join("。");
    const plateContent = JSON.stringify([
      questionNode("long_text", "q-long", "Long answer", {
        required: true,
      }),
      questionNode("section_separator", "section-details", "Details"),
      questionNode("choice_grid", "q-choice-grid", "Choice grid", {
        required: true,
        rows: [
          { id: "row-a", label: "Row A" },
          { id: "row-b", label: "Row B" },
        ],
        columns: [
          { id: "col-1", label: "Column 1" },
          { id: "col-2", label: "Column 2" },
        ],
      }),
    ]);

    const container = document.createElement("div");
    const root = renderFormBody(container, plateContent, {
      captchaReady: true,
      description: longDescription,
    });

    expect(container.textContent).toContain("公開フォーム");
    expect(container.textContent).toContain(longDescription);
    expect(container.textContent).toContain("Long answer");
    expect(container.textContent).toContain("次へ");
    expect(container.textContent).not.toContain("読み込み中...");
    expect(
      container.querySelector("[data-testid='plate-viewer']"),
    ).not.toBeNull();
    expect(plateViewerValues.at(-1)).toContain("q-long");
    expect(plateViewerValues.at(-1)).not.toContain("q-choice-grid");

    act(() => root.unmount());
  });

  it("submits all answerable public question types and excludes section separators", async () => {
    const onSubmitRequest = vi.fn();
    const answers = new Map<string, AnswerEntry>([
      ["q-short", { value: "Alice" }],
      ["q-long", { value: "A detailed answer" }],
      ["q-radio", { value: "yes" }],
      ["q-checkbox", { values: ["red", "blue"] }],
      ["q-dropdown", { value: "jp" }],
      ["q-scale", { value: 4 }],
      ["q-rating", { value: 5 }],
      ["q-choice-grid", { responses: { "row-a": "col-1", "row-b": "col-2" } }],
      [
        "q-checkbox-grid",
        { responses: { "row-a": ["col-1"], "row-b": ["col-1", "col-2"] } },
      ],
      ["q-date", { value: "2026-06-15" }],
      ["q-time", { value: "10:30" }],
    ]);

    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      publicQuestionFixturePlateContent(),
      {
        captchaReady: true,
        initialAnswers: answers,
        onSubmitRequest,
      },
    );

    const nextButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("次へ"),
    );
    expect(nextButton).toBeDefined();
    await act(async () => {
      nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(onSubmitRequest).toHaveBeenCalledOnce();
    const submitted = onSubmitRequest.mock.calls[0]?.[0];
    expect(submitted?.visitedQuestionIds).toEqual([
      "q-short",
      "q-long",
      "q-radio",
      "q-checkbox",
      "q-dropdown",
      "q-scale",
      "q-rating",
      "q-choice-grid",
      "q-checkbox-grid",
      "q-date",
      "q-time",
    ]);
    expect(submitted?.responses).toEqual([
      expect.objectContaining({
        question_id: "q-short",
        question_title: "Short answer",
        question_type: "short_text",
        value: "Alice",
      }),
      expect.objectContaining({
        question_id: "q-long",
        question_title: "Long answer",
        question_type: "long_text",
        value: "A detailed answer",
      }),
      expect.objectContaining({
        question_id: "q-radio",
        question_title: "Radio choice",
        question_type: "radio",
        value: "yes",
      }),
      expect.objectContaining({
        question_id: "q-checkbox",
        question_title: "Checkbox choice",
        question_type: "checkbox",
        values: ["red", "blue"],
      }),
      expect.objectContaining({
        question_id: "q-dropdown",
        question_title: "Dropdown choice",
        question_type: "dropdown",
        value: "jp",
      }),
      expect.objectContaining({
        question_id: "q-scale",
        question_title: "Linear scale",
        question_type: "linear_scale",
        value: 4,
      }),
      expect.objectContaining({
        question_id: "q-rating",
        question_title: "Rating",
        question_type: "rating",
        value: 5,
      }),
      expect.objectContaining({
        question_id: "q-choice-grid",
        question_title: "Choice grid",
        question_type: "choice_grid",
        responses: { "row-a": "col-1", "row-b": "col-2" },
      }),
      expect.objectContaining({
        question_id: "q-checkbox-grid",
        question_title: "Checkbox grid",
        question_type: "checkbox_grid",
        responses: { "row-a": ["col-1"], "row-b": ["col-1", "col-2"] },
      }),
      expect.objectContaining({
        question_id: "q-date",
        question_title: "Date",
        question_type: "date",
        value: "2026-06-15",
      }),
      expect.objectContaining({
        question_id: "q-time",
        question_title: "Time",
        question_type: "time",
        value: "10:30",
      }),
    ]);

    act(() => root.unmount());
  });

  it.each([
    ["mobile", 375],
    ["desktop", 1024],
  ])("submits required grid answers after ordinary cell label clicks at %s width", async (_viewportName, width) => {
    const onSubmitRequest = vi.fn();
    const rows = [
      { id: "row-a", label: "Row A" },
      { id: "row-b", label: "Row B" },
    ];
    const columns = [
      { id: "col-1", label: "Column 1" },
      { id: "col-2", label: "Column 2" },
    ];
    const plateContent = JSON.stringify([
      questionNode("choice_grid", "q-choice-grid", "Choice grid", {
        required: true,
        rows,
        columns,
      }),
      questionNode("checkbox_grid", "q-checkbox-grid", "Checkbox grid", {
        required: true,
        rows,
        columns,
        minSelectionsPerRow: 1,
        maxSelectionsPerRow: 2,
      }),
    ]);

    const container = document.createElement("div");
    container.style.width = `${width}px`;
    const root = renderFormBody(container, plateContent, {
      captchaReady: true,
      onSubmitRequest,
    });

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(onSubmitRequest).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "必須項目が未入力です: Choice grid、Checkbox grid",
    );

    const choiceRowAColumn1 = requireInput(
      getByRole(container, "radio", { name: "Row A: Column 1" }),
    );
    const choiceRowAColumn2 = requireInput(
      getByRole(container, "radio", { name: "Row A: Column 2" }),
    );
    const choiceRowBColumn2 = requireInput(
      getByRole(container, "radio", { name: "Row B: Column 2" }),
    );
    const checkboxRowAColumn1 = requireInput(
      getByRole(container, "checkbox", { name: "Row A: Column 1" }),
    );
    const checkboxRowBColumn1 = requireInput(
      getByRole(container, "checkbox", { name: "Row B: Column 1" }),
    );
    const checkboxRowBColumn2 = requireInput(
      getByRole(container, "checkbox", { name: "Row B: Column 2" }),
    );

    await act(async () => {
      clickAssociatedLabel(container, choiceRowAColumn1);
      clickAssociatedLabel(container, choiceRowAColumn2);
      clickAssociatedLabel(container, choiceRowBColumn2);
      clickAssociatedLabel(container, checkboxRowAColumn1);
      clickAssociatedLabel(container, checkboxRowBColumn1);
      clickAssociatedLabel(container, checkboxRowBColumn2);
    });

    expect(choiceRowAColumn1.checked).toBe(false);
    expect(choiceRowAColumn2.checked).toBe(true);
    expect(choiceRowBColumn2.checked).toBe(true);
    expect(checkboxRowAColumn1.checked).toBe(true);
    expect(checkboxRowBColumn1.checked).toBe(true);
    expect(checkboxRowBColumn2.checked).toBe(true);

    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(onSubmitRequest).toHaveBeenCalledOnce();
    expect(onSubmitRequest.mock.calls[0]?.[0].responses).toEqual([
      expect.objectContaining({
        question_id: "q-choice-grid",
        question_title: "Choice grid",
        question_type: "choice_grid",
        responses: { "row-a": "col-2", "row-b": "col-2" },
      }),
      expect.objectContaining({
        question_id: "q-checkbox-grid",
        question_title: "Checkbox grid",
        question_type: "checkbox_grid",
        responses: { "row-a": ["col-1"], "row-b": ["col-1", "col-2"] },
      }),
    ]);
    expect(container.textContent).not.toContain("必須項目が未入力です");

    act(() => root.unmount());
  });

  it("keeps public required validation blocking submit when answers are missing", async () => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      JSON.stringify([
        questionNode("short_text", "q-name", "Name", { required: true }),
      ]),
      {
        captchaReady: true,
        onSubmitRequest,
      },
    );

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(onSubmitRequest).not.toHaveBeenCalled();
    expect(container.textContent).toContain("必須項目が未入力です: Name");

    act(() => root.unmount());
  });

  it("allows moving to the next page after entering a required date", async () => {
    const plateContent = JSON.stringify([
      questionNode("date", "q-date", "Date", {
        required: true,
        minDate: "2026-01-01",
        maxDate: "2026-12-31",
      }),
      questionNode("section_separator", "section-next", "Next page"),
      questionNode("short_text", "q-name", "Name", { required: true }),
    ]);

    const container = document.createElement("div");
    const root = renderFormBody(container, plateContent, {
      appearance: appearanceWithQuestionNumbers(true),
      captchaReady: true,
    });

    const dateInput =
      container.querySelector<HTMLInputElement>("input[type=date]");
    expect(dateInput).not.toBeNull();
    await act(async () => {
      if (!dateInput) return;
      fireEvent.change(dateInput, { target: { value: "2026-06-15" } });
    });

    const nextButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("次へ"),
    );
    expect(nextButton).toBeDefined();
    await act(async () => {
      nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Next page");
    expect(container.textContent).toContain("2 / 2");
    expect(container.textContent).not.toContain("必須項目が未入力です");
    expect(plateViewerValues.at(-1)).toContain("Q2.");
    expect(plateViewerValues.at(-1)).not.toContain("Q1.");

    act(() => root.unmount());
  });

  it("does not move to the next page when a required date is outside its range", async () => {
    const plateContent = JSON.stringify([
      questionNode("date", "q-date", "Date", {
        required: true,
        minDate: "2026-01-01",
        maxDate: "2026-12-31",
      }),
      questionNode("section_separator", "section-next", "Next page"),
      questionNode("short_text", "q-name", "Name", { required: true }),
    ]);

    const container = document.createElement("div");
    const root = renderFormBody(container, plateContent, {
      captchaReady: true,
    });

    const dateInput =
      container.querySelector<HTMLInputElement>("input[type=date]");
    expect(dateInput).not.toBeNull();
    await act(async () => {
      if (!dateInput) return;
      fireEvent.change(dateInput, { target: { value: "2027-01-01" } });
    });

    const nextButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("次へ"),
    );
    await act(async () => {
      nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("1 / 2");
    expect(container.textContent).not.toContain("Next page");

    act(() => root.unmount());
  });
});
