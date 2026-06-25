// @vitest-environment jsdom

import { fireEvent, getByLabelText, getByRole } from "@testing-library/dom";
import type { TElement } from "platejs";
import { act, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AnswerEntry,
  FormResponseProvider,
  useFormResponse,
} from "@/contexts/form-response-context";
import {
  clickAssociatedLabel,
  requireInput,
} from "@/test-utils/form-control-labels";
import type { FormAppearance } from "@/types/validation/form";
import type { FormSubmitRequestData } from "./form-body";
import { FormBody } from "./form-body";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const plateViewerValues = vi.hoisted(() => [] as string[]);

vi.mock("@/components/editor/plate-viewer", async () => {
  const { useFormResponseOptional } = await import(
    "@/contexts/form-response-context"
  );
  const { DateInput } = await import(
    "@/components/ui/form-question-nodes/form-date-node"
  );
  const { DropdownInput } = await import(
    "@/components/ui/form-question-nodes/form-dropdown-node"
  );
  const { LongTextInput } = await import(
    "@/components/ui/form-question-nodes/form-long-text-node"
  );
  const { LinearScaleInput } = await import(
    "@/components/ui/form-question-nodes/form-linear-scale-node"
  );
  const { ShortTextInput } = await import(
    "@/components/ui/form-question-nodes/form-short-text-node"
  );
  const { RatingInput } = await import(
    "@/components/ui/form-question-nodes/form-rating-node"
  );
  const { TimeInput } = await import(
    "@/components/ui/form-question-nodes/form-time-node"
  );
  const { CheckboxGridInput } = await import(
    "@/components/ui/form-question-nodes/form-checkbox-grid-node"
  );
  const { CheckboxInput } = await import(
    "@/components/ui/form-question-nodes/form-checkbox-node"
  );
  const { ChoiceGridInput } = await import(
    "@/components/ui/form-question-nodes/form-choice-grid-node"
  );
  const { FormQuestionErrorMessage, getFormQuestionTitleId } = await import(
    "@/components/ui/form-question-nodes/form-question-base"
  );
  type OptionLike = { id: string; label: string };

  function NativeRadioInput({ element }: { element: TElement }) {
    const ctx = useFormResponseOptional();
    if (!ctx) return null;
    const blockId = element.blockId as string;
    const answer = ctx.getAnswer(blockId);
    const validation = element.validation as
      | { options?: OptionLike[] }
      | undefined;

    return (
      <div>
        {(validation?.options ?? []).map((option) => (
          <label key={option.id}>
            <input
              aria-label={option.label}
              checked={answer?.value === option.id}
              name={blockId}
              type="radio"
              value={option.id}
              onChange={(event) => {
                if (event.currentTarget.checked) {
                  ctx.setAnswer(blockId, { value: option.id });
                }
              }}
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  }

  function QuestionShell({
    children,
    questionId,
    title,
  }: {
    children: ReactNode;
    questionId: string;
    title: string;
  }) {
    return (
      <section
        className="my-3 rounded-lg border bg-card"
        data-form-question-id={questionId}
      >
        <div id={getFormQuestionTitleId(questionId)}>{title}</div>
        {children}
        <FormQuestionErrorMessage questionId={questionId} />
      </section>
    );
  }

  function textFromNode(node: unknown): string {
    if (typeof node !== "object" || node === null) return "";
    if ("text" in node) {
      return typeof node.text === "string" ? node.text : "";
    }
    if (!("children" in node) || !Array.isArray(node.children)) {
      return "";
    }
    return node.children.map(textFromNode).join("");
  }

  function questionTitle(node: unknown): string {
    const title = textFromNode(node).trim();
    return title || "無題の質問";
  }

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
            const title = questionTitle(node);
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_radio"
            ) {
              return (
                <QuestionShell
                  key={key}
                  questionId={key.toString()}
                  title={title}
                >
                  <NativeRadioInput element={node as TElement} />
                </QuestionShell>
              );
            }
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_short_text"
            ) {
              return (
                <QuestionShell
                  key={key}
                  questionId={key.toString()}
                  title={title}
                >
                  <ShortTextInput element={node as TElement} />
                </QuestionShell>
              );
            }
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_long_text"
            ) {
              return (
                <QuestionShell
                  key={key}
                  questionId={key.toString()}
                  title={title}
                >
                  <LongTextInput element={node as TElement} />
                </QuestionShell>
              );
            }
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_date"
            ) {
              return (
                <QuestionShell
                  key={key}
                  questionId={key.toString()}
                  title={title}
                >
                  <DateInput element={node as TElement} />
                </QuestionShell>
              );
            }
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_time"
            ) {
              return (
                <QuestionShell
                  key={key}
                  questionId={key.toString()}
                  title={title}
                >
                  <TimeInput element={node as TElement} />
                </QuestionShell>
              );
            }
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_checkbox"
            ) {
              return (
                <QuestionShell
                  key={key}
                  questionId={key.toString()}
                  title={title}
                >
                  <CheckboxInput element={node as TElement} />
                </QuestionShell>
              );
            }
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_dropdown"
            ) {
              return (
                <QuestionShell
                  key={key}
                  questionId={key.toString()}
                  title={title}
                >
                  <DropdownInput element={node as TElement} />
                </QuestionShell>
              );
            }
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_linear_scale"
            ) {
              return (
                <QuestionShell
                  key={key}
                  questionId={key.toString()}
                  title={title}
                >
                  <LinearScaleInput element={node as TElement} />
                </QuestionShell>
              );
            }
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_rating"
            ) {
              return (
                <QuestionShell
                  key={key}
                  questionId={key.toString()}
                  title={title}
                >
                  <RatingInput element={node as TElement} />
                </QuestionShell>
              );
            }
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_choice_grid"
            ) {
              return (
                <QuestionShell
                  key={key}
                  questionId={key.toString()}
                  title={title}
                >
                  <ChoiceGridInput element={node as TElement} />
                </QuestionShell>
              );
            }
            if (
              typeof node === "object" &&
              node !== null &&
              (node as { type?: unknown }).type === "form_checkbox_grid"
            ) {
              return (
                <QuestionShell
                  key={key}
                  questionId={key.toString()}
                  title={title}
                >
                  <CheckboxGridInput element={node as TElement} />
                </QuestionShell>
              );
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
    onErrorChange?: (error: string | null) => void;
    onSubmitRequest?: (data: FormSubmitRequestData) => void;
    providerSlot?: ReactNode;
    showCompletionTargetAfterSubmit?: boolean;
  } = {},
): Root {
  function FormBodyHarness() {
    const [error, setError] = useState<string | null>(null);
    const [submittedCompletionPageId, setSubmittedCompletionPageId] = useState<
      string | undefined
    >();

    return (
      <FormResponseProvider initialAnswers={options.initialAnswers}>
        {options.providerSlot}
        <FormBody
          title="公開フォーム"
          plateContent={plateContent}
          mode="public"
          appearance={options.appearance}
          captchaReady={options.captchaReady}
          description={options.description}
          error={error}
          submittedCompletionPageId={submittedCompletionPageId}
          onErrorChange={(nextError) => {
            setError(nextError);
            options.onErrorChange?.(nextError);
          }}
          onSubmitRequest={(data) => {
            options.onSubmitRequest?.(data);
            if (options.showCompletionTargetAfterSubmit) {
              setSubmittedCompletionPageId(data.completionTargetPageId);
            }
          }}
        />
      </FormResponseProvider>
    );
  }

  const shouldRemoveContainer = !container.isConnected;
  if (shouldRemoveContainer) {
    document.body.appendChild(container);
  }
  const root = createRoot(container);
  const unmount = root.unmount.bind(root);
  root.unmount = () => {
    unmount();
    if (shouldRemoveContainer) {
      container.remove();
    }
  };
  act(() => {
    root.render(<FormBodyHarness />);
  });
  return root;
}

function BranchAnswerSwitcher() {
  const { setAnswer } = useFormResponse();
  return (
    <button
      type="button"
      onClick={() => setAnswer("q-entity-type", { value: "individual" })}
    >
      switch to individual
    </button>
  );
}

function InvalidCodeSwitcher() {
  const { setAnswer } = useFormResponse();
  return (
    <button type="button" onClick={() => setAnswer("q-code", { value: "ab" })}>
      invalidate code
    </button>
  );
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

function sectionBranchingPlateContent(
  overrides: { conditionValue?: string; targetId?: string } = {},
): string {
  return JSON.stringify([
    questionNode("radio", "q-entity-type", "契約種別", {
      required: true,
      options: [
        { id: "individual", label: "個人" },
        { id: "corporate", label: "法人" },
      ],
    }),
    questionNode("section_separator", "section-corporate", "法人追加情報", {
      navigation_rules: [
        {
          id: "rule-corporate-branch",
          name: "法人の場合は追加情報へ",
          conditions: [
            {
              question_id: "q-entity-type",
              operator: "equals",
              value: overrides.conditionValue ?? "corporate",
            },
          ],
          condition_match: "all",
          action: {
            type: "jump_to_section",
            target_id: overrides.targetId ?? "section-corporate",
          },
          enabled: true,
          priority: 1,
        },
      ],
      default_action: { type: "submit" },
    }),
    questionNode("short_text", "q-company-name", "法人名", {
      required: true,
      minLength: 2,
    }),
  ]);
}

function sectionBranchingPlateContentWithIntermediateTarget(
  targetId: string,
): string {
  return JSON.stringify([
    questionNode("radio", "q-entity-type", "契約種別", {
      required: true,
      options: [
        { id: "individual", label: "個人" },
        { id: "corporate", label: "法人" },
      ],
    }),
    questionNode("section_separator", "section-unrelated", "確認ページ", {
      navigation_rules: [
        {
          id: "rule-corporate-branch",
          name: "法人の場合は追加情報へ",
          conditions: [
            {
              question_id: "q-entity-type",
              operator: "equals",
              value: "corporate",
            },
          ],
          condition_match: "all",
          action: {
            type: "jump_to_section",
            target_id: targetId,
          },
          enabled: true,
          priority: 1,
        },
      ],
      default_action: { type: "submit" },
    }),
    questionNode("short_text", "q-review-code", "確認コード", {
      required: true,
    }),
    questionNode("section_separator", "section-corporate", "法人追加情報"),
    questionNode("short_text", "q-company-name", "法人名", {
      required: true,
      minLength: 2,
    }),
  ]);
}

function completionTargetBranchingPlateContent(
  options: { includeAnswerableCompletionQuestion?: boolean } = {},
): string {
  const vipCompletionNodes = options.includeAnswerableCompletionQuestion
    ? [
        questionNode("short_text", "q-completion-note", "完了後の入力欄", {
          required: true,
        }),
      ]
    : [{ type: "p", children: [{ text: "VIP 向け完了メッセージ" }] }];

  return JSON.stringify([
    questionNode("radio", "q-plan", "プラン", {
      required: true,
      options: [
        { id: "vip", label: "VIP" },
        { id: "standard", label: "通常" },
      ],
    }),
    questionNode("section_separator", "section-complete-vip", "VIP 完了", {
      navigation_rules: [
        {
          id: "rule-vip-complete",
          name: "VIP は専用完了画面",
          conditions: [
            {
              question_id: "q-plan",
              operator: "equals",
              value: "vip",
            },
          ],
          condition_match: "all",
          action: {
            type: "submit",
            target_id: "section-complete-vip",
          },
          enabled: true,
          priority: 1,
        },
      ],
      default_action: {
        type: "submit",
        target_id: "section-complete-standard",
      },
    }),
    ...vipCompletionNodes,
    questionNode("section_separator", "section-complete-standard", "通常完了"),
    { type: "p", children: [{ text: "通常向け完了メッセージ" }] },
  ]);
}

function legacySubmitPlateContent(): string {
  return JSON.stringify([
    questionNode("radio", "q-plan", "プラン", {
      required: true,
      options: [{ id: "standard", label: "通常" }],
    }),
    questionNode("section_separator", "section-complete", "完了セクション", {
      default_action: { type: "submit" },
    }),
    { type: "p", children: [{ text: "target なしでは表示しない完了文" }] },
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

describe("FormBody", () => {
  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverStub;
    plateViewerValues.length = 0;
  });

  afterEach(() => {
    document.body.replaceChildren();
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

  it("keeps appearance page and card colors consistent in light and dark themes", () => {
    const plateContent = JSON.stringify([
      questionNode("short_text", "question-1", "氏名", {
        required: false,
      }),
    ]);
    const container = document.createElement("div");
    const lightAppearance = appearanceWithQuestionNumbers(false);
    const lightRoot = renderFormBody(container, plateContent, {
      appearance: lightAppearance,
    });

    const lightSurface = container.querySelector<HTMLElement>(
      "[data-form-appearance-width='compact']",
    );
    expect(lightSurface?.style.getPropertyValue("--background")).toBe(
      "#ffffff",
    );
    expect(lightSurface?.style.getPropertyValue("--foreground")).toBe("black");
    expect(lightSurface?.style.getPropertyValue("--card")).toBe("#ebebeb");
    expect(lightSurface?.style.getPropertyValue("--card-foreground")).toBe(
      "black",
    );
    expect(
      container
        .querySelector("[data-testid='plate-viewer']")
        ?.parentElement?.classList.contains("text-card-foreground"),
    ).toBe(true);

    act(() => lightRoot.unmount());
    container.replaceChildren();

    const darkRoot = renderFormBody(container, plateContent, {
      appearance: {
        ...lightAppearance,
        theme: {
          ...lightAppearance.theme,
          primary_color: "#93c5fd",
          accent_color: "#bbf7d0",
          background_color: "#111827",
        },
      },
    });

    const darkSurface = container.querySelector<HTMLElement>(
      "[data-form-appearance-width='compact']",
    );
    expect(darkSurface?.style.getPropertyValue("--background")).toBe("#111827");
    expect(darkSurface?.style.getPropertyValue("--foreground")).toBe("white");
    expect(darkSurface?.style.getPropertyValue("--card")).toBe("#242a38");
    expect(darkSurface?.style.getPropertyValue("--card-foreground")).toBe(
      "white",
    );
    expect(darkSurface?.style.getPropertyValue("--card")).not.toBe(
      darkSurface?.style.getPropertyValue("--background"),
    );
    expect(
      container
        .querySelector("[data-testid='plate-viewer']")
        ?.parentElement?.classList.contains("text-card-foreground"),
    ).toBe(true);

    act(() => darkRoot.unmount());
  });

  it("renders appearance images with no-referrer privacy controls", () => {
    const container = document.createElement("div");
    const appearance = appearanceWithQuestionNumbers(false);
    const root = renderFormBody(
      container,
      JSON.stringify([
        questionNode("short_text", "question-1", "氏名", {
          required: false,
        }),
      ]),
      {
        appearance: {
          ...appearance,
          theme: {
            ...appearance.theme,
            logo_url: "https://cdn.example.com/logo.png",
            cover_image_url: "https://cdn.example.com/cover.jpg",
          },
        },
      },
    );

    const images = Array.from(container.querySelectorAll("img"));
    expect(images).toHaveLength(2);
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "https://cdn.example.com/cover.jpg",
      "https://cdn.example.com/logo.png",
    ]);
    expect(
      images.every(
        (image) => image.getAttribute("referrerpolicy") === "no-referrer",
      ),
    ).toBe(true);
    expect(images.every((image) => image.style.backgroundImage === "")).toBe(
      true,
    );

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

  it("labels public answer controls with their question titles when multiple questions render", () => {
    const plateContent = JSON.stringify([
      questionNode("short_text", "q-short", "Short answer"),
      questionNode("long_text", "q-long", "Long answer"),
      questionNode("date", "q-date", "Preferred date"),
      questionNode("time", "q-time", "Preferred time"),
      questionNode("dropdown", "q-dropdown", "Country", {
        options: [
          { id: "jp", label: "Japan" },
          { id: "us", label: "United States" },
        ],
      }),
    ]);
    const container = document.createElement("div");
    const root = renderFormBody(container, plateContent);

    expect(
      getByRole(container, "textbox", { name: "Short answer" }),
    ).not.toBeNull();
    expect(
      getByRole(container, "textbox", { name: "Long answer" }),
    ).not.toBeNull();
    expect(
      getByRole(container, "combobox", { name: "Country" }),
    ).not.toBeNull();

    expect(getByLabelText(container, "Preferred date")).toBe(
      container.querySelector<HTMLInputElement>("input[type='date']"),
    );
    expect(getByLabelText(container, "Preferred time")).toBe(
      container.querySelector<HTMLInputElement>("input[type='time']"),
    );

    act(() => root.unmount());
  });

  it.each([
    ["mobile", 375],
    ["desktop", 1024],
  ])(
    "submits required grid answers after ordinary cell label clicks at %s width",
    async (_viewportName, width) => {
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
        "入力内容を確認してください。該当する質問の近くにエラーを表示しています。",
      );
      expect(container.textContent).toContain(
        "Choice grid: この項目は必須です",
      );
      expect(container.textContent).toContain(
        "Checkbox grid: この項目は必須です",
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
    },
    15_000,
  );

  it("keeps public required validation blocking submit when answers are missing", async () => {
    const onSubmitRequest = vi.fn();
    const onErrorChange = vi.fn();
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      JSON.stringify([
        questionNode("short_text", "q-name", "Name", { required: true }),
      ]),
      {
        captchaReady: true,
        onErrorChange,
        onSubmitRequest,
      },
    );

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    const nameInput = getByRole(container, "textbox", { name: "Name" });
    expect(nameInput.getAttribute("aria-describedby")).toBeNull();
    expect(nameInput.getAttribute("aria-invalid")).toBeNull();

    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(onSubmitRequest).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("必須項目が未入力です: Name");
    expect(container.textContent).toContain("Name: この項目は必須です");
    expect(onErrorChange).toHaveBeenLastCalledWith(
      "入力内容を確認してください。該当する質問の近くにエラーを表示しています。",
    );
    expect(nameInput.getAttribute("aria-describedby")).toBe(
      "form-question-q-name-error",
    );
    expect(nameInput.getAttribute("aria-invalid")).toBe("true");

    act(() => root.unmount());
  });

  it("renders validation messages inside each invalid question card", async () => {
    const onSubmitRequest = vi.fn();
    const rows = [{ id: "row-a", label: "Row A" }];
    const columns = [{ id: "col-1", label: "Column 1" }];
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      JSON.stringify([
        questionNode("short_text", "q-name", "Name", { required: true }),
        questionNode("dropdown", "q-country", "Country", {
          required: true,
          options: [
            { id: "jp", label: "Japan" },
            { id: "us", label: "United States" },
          ],
        }),
        questionNode("checkbox", "q-colors", "Colors", {
          required: true,
          minSelections: 1,
          options: [{ id: "red", label: "Red" }],
        }),
        questionNode("checkbox_grid", "q-grid", "Grid", {
          required: true,
          rows,
          columns,
          minSelectionsPerRow: 1,
        }),
      ]),
      {
        captchaReady: true,
        onSubmitRequest,
      },
    );

    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onSubmitRequest).not.toHaveBeenCalled();

    const nameCard = container.querySelector<HTMLElement>(
      '[data-form-question-id="q-name"]',
    );
    const countryCard = container.querySelector<HTMLElement>(
      '[data-form-question-id="q-country"]',
    );
    const colorsCard = container.querySelector<HTMLElement>(
      '[data-form-question-id="q-colors"]',
    );
    const gridCard = container.querySelector<HTMLElement>(
      '[data-form-question-id="q-grid"]',
    );
    expect(nameCard).not.toBeNull();
    expect(countryCard).not.toBeNull();
    expect(colorsCard).not.toBeNull();
    expect(gridCard).not.toBeNull();

    const nameError = nameCard?.querySelector<HTMLElement>(
      "#form-question-q-name-error",
    );
    const countryError = countryCard?.querySelector<HTMLElement>(
      "#form-question-q-country-error",
    );
    const colorsError = colorsCard?.querySelector<HTMLElement>(
      "#form-question-q-colors-error",
    );
    const gridError = gridCard?.querySelector<HTMLElement>(
      "#form-question-q-grid-error",
    );
    expect(nameError?.textContent).toBe("Name: この項目は必須です");
    expect(countryError?.textContent).toBe("Country: この項目は必須です");
    expect(colorsError?.textContent).toBe("Colors: この項目は必須です");
    expect(gridError?.textContent).toBe("Grid: この項目は必須です");

    const nameInput = getByRole(container, "textbox", { name: "Name" });
    const countryInput = getByRole(container, "combobox", {
      name: "Country",
    });
    const colorsGroup =
      colorsCard?.querySelector<HTMLElement>('[role="group"]');
    const gridGroup = gridCard?.querySelector<HTMLElement>('[role="group"]');
    expect(nameInput.getAttribute("aria-describedby")).toBe(
      "form-question-q-name-error",
    );
    expect(nameInput.getAttribute("aria-invalid")).toBe("true");
    expect(countryInput.getAttribute("aria-describedby")).toBe(
      "form-question-q-country-error",
    );
    expect(countryInput.getAttribute("aria-invalid")).toBe("true");
    expect(colorsGroup?.getAttribute("aria-describedby")).toBe(
      "form-question-q-colors-error",
    );
    expect(colorsGroup?.getAttribute("aria-invalid")).toBe("true");
    expect(gridGroup?.getAttribute("aria-describedby")).toBe(
      "form-question-q-grid-error",
    );
    expect(gridGroup?.getAttribute("aria-invalid")).toBe("true");

    const summary = container.querySelector<HTMLElement>('[role="alert"]');
    expect(summary?.textContent).toBe(
      "入力内容を確認してください。該当する質問の近くにエラーを表示しています。",
    );

    act(() => root.unmount());
  });

  it("keeps the current page open and focuses the invalid question when page validation fails", async () => {
    const plateContent = JSON.stringify([
      questionNode("short_text", "q-code", "Access code", {
        required: true,
        minLength: 3,
        omitMockQuestionId: true,
      }),
      questionNode("section_separator", "section-next", "Next page"),
      questionNode("short_text", "q-name", "Name", { required: true }),
    ]);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = renderFormBody(container, plateContent, {
      captchaReady: true,
    });

    const codeInput = container.querySelector<HTMLInputElement>("input");
    expect(codeInput).not.toBeNull();
    await act(async () => {
      if (!codeInput) return;
      fireEvent.change(codeInput, { target: { value: "ab" } });
    });

    await act(async () => {
      getByRole(container, "button", { name: /次へ/ }).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("1 / 2");
    expect(container.textContent).not.toContain("Next page");
    expect(container.textContent).toContain(
      "入力内容を確認してください。該当する質問の近くにエラーを表示しています。",
    );
    expect(container.textContent).toContain(
      "Access code: 3文字以上で入力してください",
    );
    expect(document.activeElement).toBe(codeInput);

    await act(async () => {
      if (!codeInput) return;
      fireEvent.change(codeInput, { target: { value: "abc" } });
    });
    await act(async () => {
      getByRole(container, "button", { name: /次へ/ }).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("Next page");
    expect(container.textContent).toContain("2 / 2");
    expect(container.textContent).not.toContain(
      "Access code: 3文字以上で入力してください",
    );

    act(() => root.unmount());
    container.remove();
  });

  it("keeps the current page open and focuses the short text question when regex validation fails", async () => {
    const plateContent = JSON.stringify([
      questionNode("short_text", "q-code", "Access code", {
        required: true,
        pattern: "^NF-\\d{4}$",
        allowPatternMismatch: false,
        omitMockQuestionId: true,
      }),
      questionNode("section_separator", "section-next", "Next page"),
      questionNode("short_text", "q-name", "Name", { required: true }),
    ]);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = renderFormBody(container, plateContent, {
      captchaReady: true,
    });

    const codeInput = container.querySelector<HTMLInputElement>("input");
    if (!codeInput) {
      throw new Error("Access code input was not rendered");
    }
    await act(async () => {
      fireEvent.change(codeInput, { target: { value: "draft" } });
    });

    await act(async () => {
      getByRole(container, "button", { name: /次へ/ }).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("1 / 2");
    expect(container.textContent).not.toContain("Next page");
    expect(container.textContent).toContain(
      "入力内容を確認してください。該当する質問の近くにエラーを表示しています。",
    );
    expect(container.textContent).toContain(
      "Access code: 入力形式が正しくありません",
    );
    expect(codeInput.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(codeInput);

    await act(async () => {
      fireEvent.change(codeInput, { target: { value: "NF-1234" } });
    });
    await act(async () => {
      getByRole(container, "button", { name: /次へ/ }).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("Next page");
    expect(container.textContent).toContain("2 / 2");
    expect(container.textContent).not.toContain(
      "Access code: 入力形式が正しくありません",
    );

    act(() => root.unmount());
    container.remove();
  });

  it("blocks submit and focuses the invalid question when submit validation fails", async () => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = renderFormBody(
      container,
      JSON.stringify([
        questionNode("short_text", "q-code", "Access code", {
          required: true,
          minLength: 3,
          omitMockQuestionId: true,
        }),
      ]),
      {
        captchaReady: true,
        onSubmitRequest,
      },
    );

    const codeInput = container.querySelector<HTMLInputElement>("input");
    expect(codeInput).not.toBeNull();
    await act(async () => {
      if (!codeInput) return;
      fireEvent.change(codeInput, { target: { value: "ab" } });
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onSubmitRequest).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "入力内容を確認してください。該当する質問の近くにエラーを表示しています。",
    );
    expect(container.textContent).toContain(
      "Access code: 3文字以上で入力してください",
    );
    expect(document.activeElement).toBe(codeInput);

    act(() => root.unmount());
    container.remove();
  });

  it("returns to the invalid reachable page when submit validation finds a short text regex mismatch", async () => {
    const onSubmitRequest = vi.fn();
    const plateContent = JSON.stringify([
      questionNode("short_text", "q-code", "Access code", {
        required: true,
        pattern: "^NF-\\d{4}$",
        allowPatternMismatch: false,
        omitMockQuestionId: true,
      }),
      questionNode("section_separator", "section-next", "Next page"),
      questionNode("short_text", "q-name", "Name", { required: false }),
    ]);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = renderFormBody(container, plateContent, {
      captchaReady: true,
      onSubmitRequest,
      providerSlot: <InvalidCodeSwitcher />,
    });

    const codeInput = container.querySelector<HTMLInputElement>("input");
    if (!codeInput) {
      throw new Error("Access code input was not rendered");
    }
    await act(async () => {
      fireEvent.change(codeInput, { target: { value: "NF-1234" } });
    });
    await act(async () => {
      getByRole(container, "button", { name: /次へ/ }).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("Next page");
    await act(async () => {
      getByRole(container, "button", {
        name: "invalidate code",
      }).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    const focusedCodeInput = container.querySelector<HTMLInputElement>("input");
    expect(onSubmitRequest).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1 / 2");
    expect(container.textContent).toContain(
      "入力内容を確認してください。該当する質問の近くにエラーを表示しています。",
    );
    expect(container.textContent).toContain(
      "Access code: 入力形式が正しくありません",
    );
    expect(document.activeElement).toBe(focusedCodeInput);

    act(() => root.unmount());
    container.remove();
  });

  it("focuses the question error when the invalid question has no focusable control", async () => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = renderFormBody(
      container,
      JSON.stringify([
        questionNode("radio", "q-empty-radio", "Empty radio", {
          required: true,
          options: [],
        }),
      ]),
      {
        captchaReady: true,
        onSubmitRequest,
      },
    );

    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    const errorTarget = container.querySelector<HTMLElement>(
      '[data-question-error-for="q-empty-radio"]',
    );
    expect(onSubmitRequest).not.toHaveBeenCalled();
    expect(errorTarget).not.toBeNull();
    expect(container.textContent).toContain("Empty radio: この項目は必須です");
    expect(document.activeElement).toBe(errorTarget);

    act(() => root.unmount());
    container.remove();
  });

  it("returns to the invalid reachable page when submit validation fails outside the current page", async () => {
    const onSubmitRequest = vi.fn();
    const plateContent = JSON.stringify([
      questionNode("short_text", "q-code", "Access code", {
        required: true,
        minLength: 3,
        omitMockQuestionId: true,
      }),
      questionNode("section_separator", "section-next", "Next page"),
      questionNode("short_text", "q-name", "Name", { required: false }),
    ]);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = renderFormBody(container, plateContent, {
      captchaReady: true,
      onSubmitRequest,
      providerSlot: <InvalidCodeSwitcher />,
    });

    const codeInput = container.querySelector<HTMLInputElement>("input");
    expect(codeInput).not.toBeNull();
    await act(async () => {
      if (!codeInput) return;
      fireEvent.change(codeInput, { target: { value: "abc" } });
    });
    await act(async () => {
      getByRole(container, "button", { name: /次へ/ }).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("Next page");
    await act(async () => {
      getByRole(container, "button", {
        name: "invalidate code",
      }).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    const focusedCodeInput = container.querySelector<HTMLInputElement>("input");
    expect(onSubmitRequest).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1 / 2");
    expect(container.textContent).toContain(
      "入力内容を確認してください。該当する質問の近くにエラーを表示しています。",
    );
    expect(container.textContent).toContain(
      "Access code: 3文字以上で入力してください",
    );
    expect(container.textContent).not.toContain("Name: この項目は必須です");
    expect(container.textContent).not.toContain("Access code、Name");
    expect(document.activeElement).toBe(focusedCodeInput);

    act(() => root.unmount());
    container.remove();
  });

  it("blocks restored invalid choice answer shapes before submit payload serialization", async () => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      JSON.stringify([
        questionNode("checkbox", "q-checkbox", "Choices", {
          required: false,
          options: [{ id: "red", label: "Red" }],
        }),
      ]),
      {
        captchaReady: true,
        initialAnswers: new Map<string, AnswerEntry>([
          ["q-checkbox", { values: ["red", 42] }],
        ]),
        onSubmitRequest,
      },
    );

    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onSubmitRequest).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "入力内容を確認してください。該当する質問の近くにエラーを表示しています。",
    );
    expect(container.textContent).toContain(
      "Choices: 回答データの形式が正しくありません",
    );

    act(() => root.unmount());
  });

  it("treats blank required numeric answers as missing before submit", async () => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      JSON.stringify([
        questionNode("linear_scale", "q-scale", "Scale", {
          required: true,
          min: 0,
          max: 5,
        }),
      ]),
      {
        captchaReady: true,
        initialAnswers: new Map<string, AnswerEntry>([
          ["q-scale", { value: "" }],
        ]),
        onSubmitRequest,
      },
    );

    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onSubmitRequest).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("必須項目が未入力です: Scale");
    expect(container.textContent).toContain("Scale: この項目は必須です");

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

  it("routes corporate respondents to the section branch and blocks submit until corporate required fields are answered", async () => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    const root = renderFormBody(container, sectionBranchingPlateContent(), {
      captchaReady: true,
      onSubmitRequest,
    });

    await act(async () => {
      fireEvent.click(getByRole(container, "radio", { name: "法人" }));
    });

    const nextButton = getByRole(container, "button", { name: /次へ/ });
    await act(async () => {
      nextButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("法人追加情報");
    expect(container.textContent).toContain("2 / 2");
    expect(container.textContent).not.toContain("必須項目が未入力です: 法人名");
    expect(container.textContent).not.toContain("法人名: この項目は必須です");

    expect(
      getByRole(container, "button", { name: "回答を送信" }),
    ).not.toBeNull();
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(onSubmitRequest).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("必須項目が未入力です: 法人名");
    expect(container.textContent).toContain("法人名: この項目は必須です");

    const companyInput = getByRole(container, "textbox", {
      name: "法人名",
    });
    await act(async () => {
      fireEvent.change(companyInput, { target: { value: "Nexus 株式会社" } });
    });
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(onSubmitRequest).toHaveBeenCalledOnce();
    expect(onSubmitRequest.mock.calls[0]?.[0]).toEqual({
      visitedQuestionIds: ["q-entity-type", "q-company-name"],
      responses: [
        expect.objectContaining({
          question_id: "q-entity-type",
          question_title: "契約種別",
          question_type: "radio",
          value: "corporate",
        }),
        expect.objectContaining({
          question_id: "q-company-name",
          question_title: "法人名",
          question_type: "short_text",
          value: "Nexus 株式会社",
        }),
      ],
    });

    act(() => root.unmount());
  });

  it("recomputes reachable branch questions at submit time and omits stale branch answers", async () => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    const root = renderFormBody(container, sectionBranchingPlateContent(), {
      captchaReady: true,
      onSubmitRequest,
      providerSlot: <BranchAnswerSwitcher />,
    });

    await act(async () => {
      fireEvent.click(getByRole(container, "radio", { name: "法人" }));
    });
    await act(async () => {
      getByRole(container, "button", { name: /次へ/ }).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("法人追加情報");
    await act(async () => {
      fireEvent.change(getByRole(container, "textbox", { name: "法人名" }), {
        target: { value: "x" },
      });
    });
    await act(async () => {
      getByRole(container, "button", {
        name: "switch to individual",
      }).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onSubmitRequest).toHaveBeenCalledOnce();
    expect(onSubmitRequest.mock.calls[0]?.[0]).toEqual({
      visitedQuestionIds: ["q-entity-type"],
      responses: [
        expect.objectContaining({
          question_id: "q-entity-type",
          question_title: "契約種別",
          question_type: "radio",
          value: "individual",
        }),
      ],
    });
    expect(onSubmitRequest.mock.calls[0]?.[0].responses).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ question_id: "q-company-name" }),
      ]),
    );

    act(() => root.unmount());
  });

  it("jumps to a non-adjacent corporate section when the rule target matches the section id", async () => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      sectionBranchingPlateContentWithIntermediateTarget("section-corporate"),
      {
        captchaReady: true,
        onSubmitRequest,
      },
    );

    await act(async () => {
      fireEvent.click(getByRole(container, "radio", { name: "法人" }));
    });
    await act(async () => {
      getByRole(container, "button", { name: /次へ/ }).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("法人追加情報");
    expect(container.textContent).toContain("3 / 3");
    expect(container.textContent).not.toContain("確認ページ");
    expect(container.textContent).not.toContain("必須項目が未入力です: 法人名");
    expect(container.textContent).not.toContain("法人名: この項目は必須です");

    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(container.textContent).not.toContain("必須項目が未入力です: 法人名");
    expect(container.textContent).toContain("法人名: この項目は必須です");
    expect(onSubmitRequest).not.toHaveBeenCalled();

    const companyInput = getByRole(container, "textbox", {
      name: "法人名",
    });
    await act(async () => {
      fireEvent.change(companyInput, { target: { value: "Nexus 株式会社" } });
    });
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(onSubmitRequest).toHaveBeenCalledOnce();
    expect(onSubmitRequest.mock.calls[0]?.[0]).toEqual({
      visitedQuestionIds: ["q-entity-type", "q-company-name"],
      responses: [
        expect.objectContaining({
          question_id: "q-entity-type",
          value: "corporate",
        }),
        expect.objectContaining({
          question_id: "q-company-name",
          value: "Nexus 株式会社",
        }),
      ],
    });

    act(() => root.unmount());
  });

  it("submits the individual branch without visiting or serializing empty corporate answers", async () => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    const root = renderFormBody(container, sectionBranchingPlateContent(), {
      captchaReady: true,
      onSubmitRequest,
    });

    await act(async () => {
      fireEvent.click(getByRole(container, "radio", { name: "個人" }));
    });

    expect(
      getByRole(container, "button", { name: "回答を送信" }),
    ).not.toBeNull();
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(onSubmitRequest).toHaveBeenCalledOnce();
    expect(onSubmitRequest.mock.calls[0]?.[0]).toEqual({
      visitedQuestionIds: ["q-entity-type"],
      responses: [
        expect.objectContaining({
          question_id: "q-entity-type",
          question_title: "契約種別",
          question_type: "radio",
          value: "individual",
        }),
      ],
    });
    expect(onSubmitRequest.mock.calls[0]?.[0].responses).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ question_id: "q-company-name" }),
      ]),
    );
    expect(container.textContent).not.toContain("法人追加情報");

    act(() => root.unmount());
  });

  it.each([
    {
      optionLabel: "VIP",
      expectedTargetPageId: "section-complete-vip",
      expectedMessage: "VIP 向け完了メッセージ",
      unexpectedMessage: "通常向け完了メッセージ",
    },
    {
      optionLabel: "通常",
      expectedTargetPageId: "section-complete-standard",
      expectedMessage: "通常向け完了メッセージ",
      unexpectedMessage: "VIP 向け完了メッセージ",
    },
  ])("shows the $optionLabel completion section after submit success", async ({
    optionLabel,
    expectedTargetPageId,
    expectedMessage,
    unexpectedMessage,
  }) => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      completionTargetBranchingPlateContent(),
      {
        captchaReady: true,
        onSubmitRequest,
        showCompletionTargetAfterSubmit: true,
      },
    );

    await act(async () => {
      fireEvent.click(getByRole(container, "radio", { name: optionLabel }));
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onSubmitRequest).toHaveBeenCalledOnce();
    expect(onSubmitRequest.mock.calls[0]?.[0]).toEqual({
      completionTargetPageId: expectedTargetPageId,
      visitedQuestionIds: ["q-plan"],
      responses: [
        expect.objectContaining({
          question_id: "q-plan",
          question_title: "プラン",
          question_type: "radio",
        }),
      ],
    });
    expect(container.textContent).toContain(expectedMessage);
    expect(container.textContent).not.toContain(unexpectedMessage);
    expect(container.textContent).not.toContain("回答を送信");

    act(() => root.unmount());
  });

  it("keeps submit without target_id on the legacy confirmation flow", async () => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    const root = renderFormBody(container, legacySubmitPlateContent(), {
      captchaReady: true,
      onSubmitRequest,
      showCompletionTargetAfterSubmit: true,
    });

    await act(async () => {
      fireEvent.click(getByRole(container, "radio", { name: "通常" }));
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onSubmitRequest).toHaveBeenCalledOnce();
    expect(onSubmitRequest.mock.calls[0]?.[0].completionTargetPageId).toBe(
      undefined,
    );
    expect(container.textContent).not.toContain(
      "target なしでは表示しない完了文",
    );
    expect(
      getByRole(container, "button", { name: "回答を送信" }),
    ).not.toBeNull();

    act(() => root.unmount());
  });

  it("does not validate or serialize questions inside a submit completion target", async () => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      completionTargetBranchingPlateContent({
        includeAnswerableCompletionQuestion: true,
      }),
      {
        captchaReady: true,
        initialAnswers: new Map<string, AnswerEntry>([
          ["q-completion-note", { value: "should stay local" }],
        ]),
        onSubmitRequest,
      },
    );

    await act(async () => {
      fireEvent.click(getByRole(container, "radio", { name: "VIP" }));
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onSubmitRequest).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain(
      "完了後の入力欄: この項目は必須です",
    );
    expect(onSubmitRequest.mock.calls[0]?.[0]).toEqual({
      completionTargetPageId: "section-complete-vip",
      visitedQuestionIds: ["q-plan"],
      responses: [
        expect.objectContaining({
          question_id: "q-plan",
          value: "vip",
        }),
      ],
    });
    expect(onSubmitRequest.mock.calls[0]?.[0].responses).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ question_id: "q-completion-note" }),
      ]),
    );

    act(() => root.unmount());
  });

  it("does not branch when a condition compares the choice label instead of the saved option value", async () => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      sectionBranchingPlateContent({ conditionValue: "法人" }),
      {
        captchaReady: true,
        onSubmitRequest,
      },
    );

    await act(async () => {
      fireEvent.click(getByRole(container, "radio", { name: "法人" }));
    });

    expect(container.textContent).not.toContain("法人追加情報");
    expect(
      getByRole(container, "button", { name: "回答を送信" }),
    ).not.toBeNull();

    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(onSubmitRequest).toHaveBeenCalledOnce();
    expect(onSubmitRequest.mock.calls[0]?.[0]).toEqual({
      visitedQuestionIds: ["q-entity-type"],
      responses: [
        expect.objectContaining({
          question_id: "q-entity-type",
          value: "corporate",
        }),
      ],
    });

    act(() => root.unmount());
  });

  it("falls back to the next physical page when a matching branch targets an unknown section id", async () => {
    const onSubmitRequest = vi.fn();
    const container = document.createElement("div");
    const root = renderFormBody(
      container,
      sectionBranchingPlateContentWithIntermediateTarget("section-missing"),
      {
        captchaReady: true,
        onSubmitRequest,
      },
    );

    await act(async () => {
      fireEvent.click(getByRole(container, "radio", { name: "法人" }));
    });
    await act(async () => {
      getByRole(container, "button", { name: /次へ/ }).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).toContain("確認ページ");
    expect(container.textContent).not.toContain("法人追加情報");
    await act(async () => {
      getByRole(container, "button", { name: /次へ/ }).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).not.toContain(
      "必須項目が未入力です: 確認コード",
    );
    expect(container.textContent).toContain("確認コード: この項目は必須です");
    expect(onSubmitRequest).not.toHaveBeenCalled();

    act(() => root.unmount());
  });
});
