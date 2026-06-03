import {
  type ExtractedQuestion,
  extractQuestionsFromPlateContent,
  isPlateQuestionType,
  splitPlateContentIntoPages,
} from "@nexus-form/shared";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useCallback,
  useMemo,
} from "react";
import { PlateViewer } from "@/components/editor/plate-viewer";
import { Button } from "@/components/ui/button";
import { useFormResponse } from "@/contexts/form-response-context";
import { useFormPaging } from "@/hooks/forms/use-form-paging";
import { findUnansweredRequired } from "@/lib/forms/find-unanswered-required";
import { sanitizeFormPlateContent } from "@/lib/rich-text";
import { cn } from "@/lib/utils";
import {
  type FormAppearance,
  FormAppearanceSchema,
} from "@/types/validation/form";
import { FormPageNavigation } from "./form-page-navigation";

export interface FormSubmitRequestData {
  responses: {
    question_id: string;
    question_type: string;
    question_title: string;
    value?: unknown;
    values?: unknown[];
    responses?: Record<string, unknown>;
    other_value?: string;
    other_values?: string[];
  }[];
  visitedQuestionIds: string[];
}

interface FormBodyProps {
  title: string;
  description?: string;
  plateContent: string;
  mode: "public" | "preview";
  onSubmitRequest?: (data: FormSubmitRequestData) => void;
  /** Rendered before the submit button on the last page (e.g., hCaptcha widget) */
  preSubmitSlot?: ReactNode;
  isSubmitting?: boolean;
  captchaReady?: boolean;
  error?: string | null;
  success?: string | null;
  onErrorChange?: (error: string | null) => void;
  appearance?: FormAppearance;
}

type FormBodyStyle = CSSProperties & {
  "--background": string;
  "--card": string;
  "--form-accent-color": string;
  "--primary": string;
  "--primary-foreground": string;
  "--ring": string;
};

type BackgroundImageStyle = CSSProperties & {
  backgroundImage: string;
};

function contrastTextColor(hexColor: string): string {
  const expanded =
    hexColor.length === 4
      ? `#${hexColor
          .slice(1)
          .split("")
          .map((char) => `${char}${char}`)
          .join("")}`
      : hexColor;
  const value = Number.parseInt(expanded.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(
    (channel) => {
      const normalized = channel / 255;
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    },
  );
  const red = channels[0] ?? 0;
  const green = channels[1] ?? 0;
  const blue = channels[2] ?? 0;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast ? "black" : "white";
}

function formBodyStyle(appearance: FormAppearance): FormBodyStyle {
  const { theme } = appearance;
  return {
    "--background": theme.background_color,
    "--card": theme.background_color,
    "--form-accent-color": theme.accent_color,
    "--primary": theme.primary_color,
    "--primary-foreground": contrastTextColor(theme.primary_color),
    "--ring": theme.primary_color,
    backgroundColor: theme.background_color,
    color: contrastTextColor(theme.background_color),
    fontFamily: theme.font_family,
  };
}

function backgroundImageStyle(url: string): BackgroundImageStyle {
  const escapedUrl = url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return { backgroundImage: `url("${escapedUrl}")` };
}

function formWidthClass(width: FormAppearance["layout"]["width"]): string {
  switch (width) {
    case "full":
      return "max-w-none";
    case "compact":
      return "max-w-2xl";
    case "medium":
      return "max-w-3xl";
  }
}

function formSpacingClass(spacing: FormAppearance["layout"]["spacing"]): {
  section: string;
  card: string;
} {
  switch (spacing) {
    case "compact":
      return { section: "space-y-3 p-4", card: "p-4" };
    case "spacious":
      return { section: "space-y-5 p-8", card: "p-8" };
    case "comfortable":
      return { section: "space-y-4 p-6", card: "p-6" };
  }
}

function normalizeAppearance(appearance: FormAppearance | undefined) {
  return appearance ?? FormAppearanceSchema.parse({});
}

function addQuestionNumbersToPlateContent(
  nodes: unknown[],
  questionNumberByBlockId: ReadonlyMap<string, number>,
): unknown[] {
  return nodes.map((node) => {
    if (node == null || typeof node !== "object" || Array.isArray(node)) {
      return node;
    }
    const element = { ...node } as Record<string, unknown>;
    const children = Array.isArray(element.children)
      ? addQuestionNumbersToPlateContent(
          element.children,
          questionNumberByBlockId,
        )
      : undefined;
    if (
      isPlateQuestionType(element.type) &&
      element.type !== "form_section_separator"
    ) {
      const questionNumber =
        typeof element.blockId === "string"
          ? questionNumberByBlockId.get(element.blockId)
          : undefined;
      if (questionNumber === undefined) return element;
      return {
        ...element,
        children: [
          {
            type: "p",
            children: [
              {
                bold: true,
                text: `Q${questionNumber}. `,
              },
            ],
          },
          ...(children ?? []),
        ],
      };
    }
    if (children) {
      return {
        ...element,
        children,
      };
    }
    return element;
  });
}

export function FormBody({
  title,
  description,
  plateContent,
  mode,
  onSubmitRequest,
  preSubmitSlot,
  isSubmitting = false,
  captchaReady = false,
  error,
  success,
  onErrorChange,
  appearance: appearanceProp,
}: FormBodyProps) {
  const { answers } = useFormResponse();
  const appearance = useMemo(
    () => normalizeAppearance(appearanceProp),
    [appearanceProp],
  );

  const { parsedContent, isContentEmpty } = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(plateContent);
      if (!Array.isArray(parsed)) {
        return { parsedContent: [] as unknown[], isContentEmpty: false };
      }
      const sanitized = sanitizeFormPlateContent(parsed);
      return {
        parsedContent: sanitized,
        isContentEmpty: sanitized.length === 0,
      };
    } catch {
      return { parsedContent: [] as unknown[], isContentEmpty: false };
    }
  }, [plateContent]);
  const pages = useMemo(
    () => splitPlateContentIntoPages(parsedContent),
    [parsedContent],
  );

  const allQuestions = useMemo(
    () => extractQuestionsFromPlateContent(parsedContent),
    [parsedContent],
  );
  const questionNumberByBlockId = useMemo(() => {
    const numbers = new Map<string, number>();
    let questionNumber = 0;
    for (const question of allQuestions) {
      if (question.type === "section_separator") continue;
      questionNumber += 1;
      numbers.set(question.blockId, questionNumber);
    }
    return numbers;
  }, [allQuestions]);

  const isMultiPage = pages.length > 1;
  const paging = useFormPaging({ pages, answers });

  const viewerPlateContent = useMemo(() => {
    const sourceNodes = isMultiPage ? paging.currentPage.nodes : parsedContent;
    const visibleNodes = appearance.layout.show_question_numbers
      ? addQuestionNumbersToPlateContent(sourceNodes, questionNumberByBlockId)
      : sourceNodes;
    return JSON.stringify(visibleNodes);
  }, [
    appearance.layout.show_question_numbers,
    isMultiPage,
    paging.currentPage.nodes,
    parsedContent,
    questionNumberByBlockId,
  ]);

  const currentPageQuestions = useMemo(() => {
    const pageQuestionIds = new Set(paging.currentPage.questionIds);
    return allQuestions.filter((q) => pageQuestionIds.has(q.blockId));
  }, [allQuestions, paging.currentPage.questionIds]);

  const validateCurrentPage = useCallback((): boolean => {
    const unanswered = findUnansweredRequired(currentPageQuestions, answers);
    if (unanswered.length > 0) {
      const names = unanswered.map((q) => q.title || "無題の質問").join("、");
      onErrorChange?.(`必須項目が未入力です: ${names}`);
      return false;
    }
    onErrorChange?.(null);
    return true;
  }, [currentPageQuestions, answers, onErrorChange]);

  const handleNextPage = useCallback(() => {
    if (!validateCurrentPage()) return;
    paging.goToNextPage();
  }, [validateCurrentPage, paging]);

  const handlePreviousPage = useCallback(() => {
    onErrorChange?.(null);
    paging.goToPreviousPage();
  }, [paging, onErrorChange]);

  const buildSubmitPayload = useCallback(
    (
      questions: ExtractedQuestion[],
      visitedIds: string[],
    ): FormSubmitRequestData => {
      const visitedSet = new Set(visitedIds);
      const submittableQuestions = questions.filter(
        (q) => visitedSet.has(q.blockId) && q.type !== "section_separator",
      );

      const responses = submittableQuestions.map((q) => {
        const answer = answers.get(q.blockId);
        return {
          question_id: q.blockId,
          question_type: q.type,
          question_title: q.title,
          value: answer?.value,
          values: answer?.values,
          responses: answer?.responses,
          other_value: answer?.other_value,
          other_values: answer?.other_values,
        };
      });

      return { responses, visitedQuestionIds: visitedIds };
    },
    [answers],
  );

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!validateCurrentPage()) return;
      const payload = buildSubmitPayload(
        allQuestions,
        paging.visitedQuestionIds,
      );
      onSubmitRequest?.(payload);
    },
    [
      validateCurrentPage,
      buildSubmitPayload,
      allQuestions,
      paging.visitedQuestionIds,
      onSubmitRequest,
    ],
  );

  const isPreview = mode === "preview";
  const showSubmitArea = paging.isLastPage || paging.shouldSubmit;
  const effectiveCaptchaReady = isPreview ? true : captchaReady;
  const spacingClass = formSpacingClass(appearance.layout.spacing);
  const alignClass =
    appearance.layout.alignment === "center" ? "mx-auto" : "mr-auto";

  return (
    <section
      className={cn(
        formWidthClass(appearance.layout.width),
        alignClass,
        spacingClass.section,
      )}
      style={formBodyStyle(appearance)}
      data-form-appearance-width={appearance.layout.width}
      data-form-appearance-spacing={appearance.layout.spacing}
      data-form-question-numbers={
        appearance.layout.show_question_numbers ? "shown" : "hidden"
      }
    >
      {appearance.theme.cover_image_url ? (
        <div
          aria-hidden="true"
          className="h-40 w-full rounded-lg bg-cover bg-center"
          style={backgroundImageStyle(appearance.theme.cover_image_url)}
        />
      ) : null}
      {(appearance.theme.logo_url || appearance.theme.brand_name) && (
        <div className="flex items-center gap-3">
          {appearance.theme.logo_url ? (
            <div
              aria-hidden="true"
              className="h-10 w-10 rounded-md bg-contain bg-center bg-no-repeat"
              style={backgroundImageStyle(appearance.theme.logo_url)}
            />
          ) : null}
          {appearance.theme.brand_name ? (
            <p className="text-sm font-medium">{appearance.theme.brand_name}</p>
          ) : null}
        </div>
      )}
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}

      {/* Section title for pages after the first */}
      {isMultiPage && paging.currentPage.title && (
        <div className="rounded-lg border border-primary/30 bg-muted/20 px-4 py-3">
          <h2 className="text-lg font-medium">{paging.currentPage.title}</h2>
        </div>
      )}

      <form onSubmit={handleFormSubmit} className="space-y-3">
        {/* Plate ドキュメントによるフォーム描画 (現在ページのみ) */}
        {parsedContent.length > 0 ? (
          <div className={cn("rounded-lg border bg-card", spacingClass.card)}>
            <PlateViewer
              key={paging.currentPageIndex}
              value={viewerPlateContent}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isContentEmpty
              ? "フォームの内容が空です。"
              : "フォームの内容を読み込めませんでした。"}
          </p>
        )}

        {/* 質問がある場合のみ送信・ナビゲーションを表示 */}
        {allQuestions.length > 0 && (
          <>
            {showSubmitArea && preSubmitSlot}

            {isMultiPage ? (
              <FormPageNavigation
                step={paging.isFirstPage ? "first" : "middle"}
                nextAction={
                  paging.isLastPage || paging.shouldSubmit ? "submit" : "next"
                }
                submitAvailability={
                  isSubmitting
                    ? "submitting"
                    : effectiveCaptchaReady
                      ? "ready"
                      : "captcha-pending"
                }
                onPrevious={handlePreviousPage}
                onNext={handleNextPage}
                totalPages={paging.totalPages}
                currentPageIndex={paging.currentPageIndex}
              />
            ) : (
              <Button
                type="submit"
                disabled={isSubmitting || !effectiveCaptchaReady}
              >
                {isSubmitting ? "送信中..." : "回答を送信"}
              </Button>
            )}
          </>
        )}

        {/* コンテンツはあるが質問がない場合のメッセージ */}
        {parsedContent.length > 0 && allQuestions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            フォームに質問がありません。
          </p>
        )}
      </form>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {success ? (
        <p
          className={
            isPreview
              ? "text-sm text-amber-700 dark:text-amber-400"
              : "text-sm text-emerald-600"
          }
        >
          {success}
        </p>
      ) : null}
    </section>
  );
}
