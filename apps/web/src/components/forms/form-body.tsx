import {
  type ExtractedQuestion,
  extractQuestionsFromPlateContent,
  isCompletionTargetPage,
  isPlateQuestionType,
  resolvePageIndexByPageId,
  splitPlateContentIntoPages,
} from "@nexus-form/shared";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PlateViewer } from "@/components/editor/plate-viewer";
import { Button } from "@/components/ui/button";
import { FormQuestionA11yProvider } from "@/components/ui/form-question-nodes/form-question-base";
import {
  type AnswerEntry,
  useFormResponse,
} from "@/contexts/form-response-context";
import { useFormPaging } from "@/hooks/forms/use-form-paging";
import { sanitizeFormPlateContent } from "@/lib/rich-text";
import { cn } from "@/lib/utils";
import type { FormAppearance } from "@/types/validation/form";
import { validateExtractedQuestionAnswer } from "@/utils/validation/question-validators";
import { normalizeFormAppearance } from "./form-appearance-surface";
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
  completionTargetPageId?: string;
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
  submittedCompletionPageId?: string | null;
  onErrorChange?: (error: string | null) => void;
  appearance?: FormAppearance;
}

interface QuestionValidationMessage {
  questionId: string;
  title: string;
  messages: string[];
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

function uniqueMessages(messages: string[]): string[] {
  return Array.from(new Set(messages));
}

const FORM_VALIDATION_ALERT_MESSAGE =
  "入力内容を確認してください。該当する質問の近くにエラーを表示しています。";

function findQuestionControl(
  root: HTMLElement,
  questionId: string,
): HTMLElement | null {
  const controls = Array.from(
    root.querySelectorAll<HTMLElement>("input, textarea, select, button"),
  );
  return (
    controls.find((control) => {
      if (control.getAttribute("disabled") != null) return false;
      const ariaLabel = control.getAttribute("aria-label");
      const name = control.getAttribute("name");
      const id = control.getAttribute("id") ?? "";
      return (
        ariaLabel === questionId ||
        name === questionId ||
        id === questionId ||
        id.startsWith(`${questionId}-`)
      );
    }) ?? null
  );
}

function findFirstFocusableControl(root: HTMLElement): HTMLElement | null {
  const controls = Array.from(
    root.querySelectorAll<HTMLElement>("input, textarea, select, button"),
  );
  return (
    controls.find((control) => control.getAttribute("disabled") == null) ?? null
  );
}

function findQuestionControlByPageOrder(
  viewer: HTMLElement | null,
  pageQuestionIds: readonly string[],
  questionId: string,
): HTMLElement | null {
  if (!viewer) return null;
  if (!pageQuestionIds.includes(questionId)) return null;
  const questionCard =
    Array.from(
      viewer.querySelectorAll<HTMLElement>("[data-form-question-id]"),
    ).find((element) => element.dataset.formQuestionId === questionId) ?? null;
  return questionCard ? findFirstFocusableControl(questionCard) : null;
}

function findQuestionErrorElement(
  form: HTMLFormElement,
  questionId: string,
): HTMLElement | null {
  const errors = Array.from(
    form.querySelectorAll<HTMLElement>("[data-question-error-for]"),
  );
  return (
    errors.find((element) => element.dataset.questionErrorFor === questionId) ??
    null
  );
}

function focusQuestionValidationTarget(
  form: HTMLFormElement | null,
  viewer: HTMLElement | null,
  questionId: string,
  pageQuestionIds: readonly string[],
): boolean {
  if (!form) return false;
  const target =
    findQuestionControl(form, questionId) ??
    findQuestionControlByPageOrder(viewer, pageQuestionIds, questionId) ??
    findQuestionErrorElement(form, questionId);
  if (!target) return false;
  target.focus();
  return true;
}

function findPageIndexForQuestion(
  pages: ReturnType<typeof splitPlateContentIntoPages>,
  pageIndexes: number[],
  questionId: string,
): number | undefined {
  for (const pageIndex of pageIndexes) {
    const page = pages[pageIndex];
    if (page?.questionIds.includes(questionId)) {
      return pageIndex;
    }
  }
  return undefined;
}

function questionsForPageIndexes(
  questions: ExtractedQuestion[],
  pages: ReturnType<typeof splitPlateContentIntoPages>,
  pageIndexes: number[],
): ExtractedQuestion[] {
  const questionById = new Map(
    questions
      .filter((question) => question.type !== "section_separator")
      .map((question) => [question.blockId, question]),
  );

  return pageIndexes.flatMap((pageIndex) => {
    const page = pages[pageIndex];
    if (!page) return [];
    return page.questionIds.flatMap((questionId) => {
      const question = questionById.get(questionId);
      return question ? [question] : [];
    });
  });
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
  submittedCompletionPageId,
  onErrorChange,
  appearance: appearanceProp,
}: FormBodyProps) {
  const { answers } = useFormResponse();
  const formRef = useRef<HTMLFormElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusQuestionIdRef = useRef<string | null>(null);
  const [questionErrors, setQuestionErrors] = useState<
    QuestionValidationMessage[]
  >([]);
  const [touchedQuestionIds, setTouchedQuestionIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const touchedQuestionIdsRef = useRef<ReadonlySet<string>>(new Set());
  const [validationDisplayPageIndexes, setValidationDisplayPageIndexes] =
    useState<ReadonlySet<number>>(() => new Set());
  const appearance = useMemo(
    () => normalizeFormAppearance(appearanceProp),
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
  const submittedCompletionPage = useMemo(() => {
    if (!submittedCompletionPageId) return undefined;
    const pageIndex = resolvePageIndexByPageId(
      pages,
      submittedCompletionPageId,
    );
    const page = pages[pageIndex];
    return page && isCompletionTargetPage(page) ? page : undefined;
  }, [pages, submittedCompletionPageId]);
  const displayedPage = submittedCompletionPage ?? paging.currentPage;
  const displayedPageIndex = submittedCompletionPage
    ? resolvePageIndexByPageId(pages, submittedCompletionPage.pageId)
    : paging.currentPageIndex;
  const isShowingSubmittedCompletionPage =
    submittedCompletionPage !== undefined;

  const viewerPlateContent = useMemo(() => {
    const sourceNodes =
      isMultiPage || isShowingSubmittedCompletionPage
        ? displayedPage.nodes
        : parsedContent;
    const visibleNodes = appearance.layout.show_question_numbers
      ? addQuestionNumbersToPlateContent(sourceNodes, questionNumberByBlockId)
      : sourceNodes;
    return JSON.stringify(visibleNodes);
  }, [
    appearance.layout.show_question_numbers,
    displayedPage.nodes,
    isMultiPage,
    isShowingSubmittedCompletionPage,
    parsedContent,
    questionNumberByBlockId,
  ]);

  const currentPageQuestions = useMemo(() => {
    const pageQuestionIds = new Set(paging.currentPage.questionIds);
    return allQuestions.filter((q) => pageQuestionIds.has(q.blockId));
  }, [allQuestions, paging.currentPage.questionIds]);

  const questionById = useMemo(
    () => new Map(allQuestions.map((question) => [question.blockId, question])),
    [allQuestions],
  );

  const currentPageQuestionErrors = useMemo(() => {
    const showPageErrors = validationDisplayPageIndexes.has(
      paging.currentPageIndex,
    );
    const pageQuestionIds = new Set(paging.currentPage.questionIds);
    return questionErrors.filter(
      (error) =>
        pageQuestionIds.has(error.questionId) &&
        (showPageErrors || touchedQuestionIds.has(error.questionId)),
    );
  }, [
    questionErrors,
    paging.currentPage.questionIds,
    paging.currentPageIndex,
    touchedQuestionIds,
    validationDisplayPageIndexes,
  ]);
  const currentPageInvalidQuestionIds = useMemo(
    () => new Set(currentPageQuestionErrors.map((error) => error.questionId)),
    [currentPageQuestionErrors],
  );
  const currentPageErrorMessagesByQuestionId = useMemo(
    () =>
      new Map(
        currentPageQuestionErrors.map((error) => [
          error.questionId,
          `${error.title}: ${error.messages.join("、")}`,
        ]),
      ),
    [currentPageQuestionErrors],
  );
  const shouldShowPageValidationAlert =
    validationDisplayPageIndexes.has(paging.currentPageIndex) &&
    currentPageQuestionErrors.length > 0;

  const collectQuestionErrors = useCallback(
    (questions: ExtractedQuestion[]): QuestionValidationMessage[] => {
      return questions.flatMap((question) => {
        const result = validateExtractedQuestionAnswer(
          question,
          answers.get(question.blockId),
        );
        if (result.is_valid) return [];
        return [
          {
            questionId: question.blockId,
            title: question.title || "無題の質問",
            messages: uniqueMessages(
              result.errors.map((error) => error.message),
            ),
          },
        ];
      });
    },
    [answers],
  );

  const collectSingleQuestionError = useCallback(
    (
      question: ExtractedQuestion,
      answer?: AnswerEntry,
    ): QuestionValidationMessage[] => {
      const result = validateExtractedQuestionAnswer(question, answer);
      if (result.is_valid) return [];
      return [
        {
          questionId: question.blockId,
          title: question.title || "無題の質問",
          messages: uniqueMessages(result.errors.map((error) => error.message)),
        },
      ];
    },
    [],
  );

  const updateSingleQuestionError = useCallback(
    (questionId: string, answer?: AnswerEntry) => {
      const question = questionById.get(questionId);
      if (!question || question.type === "section_separator") return;
      const nextErrors = collectSingleQuestionError(
        question,
        answer ?? answers.get(questionId),
      );
      setQuestionErrors((currentErrors) => [
        ...currentErrors.filter((error) => error.questionId !== questionId),
        ...nextErrors,
      ]);
    },
    [answers, collectSingleQuestionError, questionById],
  );

  const markQuestionTouched = useCallback(
    (questionId: string, answer?: AnswerEntry) => {
      const currentIds = touchedQuestionIdsRef.current;
      if (!currentIds.has(questionId)) {
        const nextIds = new Set(currentIds);
        nextIds.add(questionId);
        touchedQuestionIdsRef.current = nextIds;
        setTouchedQuestionIds(nextIds);
      }
      updateSingleQuestionError(questionId, answer);
    },
    [updateSingleQuestionError],
  );

  const notifyQuestionAnswerChange = useCallback(
    (questionId: string, answer: AnswerEntry) => {
      if (!touchedQuestionIdsRef.current.has(questionId)) return;
      updateSingleQuestionError(questionId, answer);
    },
    [updateSingleQuestionError],
  );

  const showOnlyValidationDisplayPage = useCallback((pageIndex: number) => {
    setValidationDisplayPageIndexes(new Set([pageIndex]));
  }, []);

  const clearValidationDisplayPage = useCallback((pageIndex: number) => {
    setValidationDisplayPageIndexes((currentPageIndexes) => {
      if (!currentPageIndexes.has(pageIndex)) return currentPageIndexes;
      const nextPageIndexes = new Set(currentPageIndexes);
      nextPageIndexes.delete(pageIndex);
      return nextPageIndexes;
    });
  }, []);

  const clearValidationDisplayPages = useCallback(() => {
    setValidationDisplayPageIndexes(new Set());
  }, []);

  const clearTouchedQuestionIds = useCallback(() => {
    const emptyIds = new Set<string>();
    touchedQuestionIdsRef.current = emptyIds;
    setTouchedQuestionIds(emptyIds);
  }, []);

  const applyQuestionErrors = useCallback(
    (errors: QuestionValidationMessage[]): boolean => {
      setQuestionErrors(errors);
      if (errors.length > 0) {
        const questionId = errors[0]?.questionId ?? null;
        pendingFocusQuestionIdRef.current = questionId;
        if (
          questionId &&
          focusQuestionValidationTarget(
            formRef.current,
            viewerRef.current,
            questionId,
            paging.currentPage.questionIds,
          )
        ) {
          pendingFocusQuestionIdRef.current = null;
        }
        onErrorChange?.(FORM_VALIDATION_ALERT_MESSAGE);
        return false;
      }
      pendingFocusQuestionIdRef.current = null;
      onErrorChange?.(null);
      return true;
    },
    [onErrorChange, paging.currentPage.questionIds],
  );

  useEffect(() => {
    const questionId = pendingFocusQuestionIdRef.current;
    if (!questionId) return;
    const isErrorRendered = currentPageQuestionErrors.some(
      (error) => error.questionId === questionId,
    );
    if (!isErrorRendered) return;
    if (
      focusQuestionValidationTarget(
        formRef.current,
        viewerRef.current,
        questionId,
        paging.currentPage.questionIds,
      )
    ) {
      pendingFocusQuestionIdRef.current = null;
    }
  }, [currentPageQuestionErrors, paging.currentPage.questionIds]);

  const validateCurrentPage = useCallback((): boolean => {
    const errors = collectQuestionErrors(currentPageQuestions);
    if (errors.length > 0) {
      showOnlyValidationDisplayPage(paging.currentPageIndex);
      return applyQuestionErrors(errors);
    }
    onErrorChange?.(null);
    pendingFocusQuestionIdRef.current = null;
    const currentPageQuestionIds = new Set(
      currentPageQuestions.map((question) => question.blockId),
    );
    setQuestionErrors((currentErrors) =>
      currentErrors.filter(
        (error) => !currentPageQuestionIds.has(error.questionId),
      ),
    );
    clearValidationDisplayPage(paging.currentPageIndex);
    return true;
  }, [
    currentPageQuestions,
    collectQuestionErrors,
    applyQuestionErrors,
    showOnlyValidationDisplayPage,
    paging.currentPageIndex,
    onErrorChange,
    clearValidationDisplayPage,
  ]);

  const handleNextPage = useCallback(() => {
    if (!validateCurrentPage()) return;
    const nextPageIndex = paging.goToNextPage();
    if (nextPageIndex !== undefined) {
      clearValidationDisplayPage(nextPageIndex);
    }
  }, [validateCurrentPage, paging, clearValidationDisplayPage]);

  const handlePreviousPage = useCallback(() => {
    onErrorChange?.(null);
    clearValidationDisplayPages();
    pendingFocusQuestionIdRef.current = null;
    paging.goToPreviousPage();
  }, [paging, onErrorChange, clearValidationDisplayPages]);

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
      const reachableQuestions = questionsForPageIndexes(
        allQuestions,
        pages,
        paging.reachablePageIndexes,
      );
      const errors = collectQuestionErrors(reachableQuestions);
      if (errors.length > 0) {
        const firstErrorQuestionId = errors[0]?.questionId;
        let displayPageIndex = paging.currentPageIndex;
        if (firstErrorQuestionId) {
          const firstErrorPageIndex = findPageIndexForQuestion(
            pages,
            paging.reachablePageIndexes,
            firstErrorQuestionId,
          );
          displayPageIndex = firstErrorPageIndex ?? displayPageIndex;
          if (
            firstErrorPageIndex !== undefined &&
            firstErrorPageIndex !== paging.currentPageIndex
          ) {
            paging.goToPage(firstErrorPageIndex);
          }
        }
        showOnlyValidationDisplayPage(displayPageIndex);
        applyQuestionErrors(errors);
        return;
      }
      applyQuestionErrors([]);
      clearValidationDisplayPages();
      clearTouchedQuestionIds();
      const payload = buildSubmitPayload(
        allQuestions,
        paging.reachableQuestionIds,
      );
      if (paging.submitTargetPageId) {
        payload.completionTargetPageId = paging.submitTargetPageId;
      }
      onSubmitRequest?.(payload);
    },
    [
      pages,
      collectQuestionErrors,
      applyQuestionErrors,
      buildSubmitPayload,
      allQuestions,
      paging.reachablePageIndexes,
      paging.reachableQuestionIds,
      paging.submitTargetPageId,
      paging.currentPageIndex,
      paging.goToPage,
      showOnlyValidationDisplayPage,
      clearValidationDisplayPages,
      clearTouchedQuestionIds,
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
      data-form-appearance-width={appearance.layout.width}
      data-form-appearance-spacing={appearance.layout.spacing}
      data-form-question-numbers={
        appearance.layout.show_question_numbers ? "shown" : "hidden"
      }
    >
      {appearance.theme.cover_image_url ? (
        // biome-ignore lint/performance/noImgElement: Public appearance images need referrerPolicy, which CSS backgrounds cannot provide.
        <img
          alt=""
          aria-hidden="true"
          className="h-40 w-full rounded-lg object-cover"
          decoding="async"
          referrerPolicy="no-referrer"
          src={appearance.theme.cover_image_url}
        />
      ) : null}
      {(appearance.theme.logo_url || appearance.theme.brand_name) && (
        <div className="flex items-center gap-3">
          {appearance.theme.logo_url ? (
            // biome-ignore lint/performance/noImgElement: Public appearance images need referrerPolicy, which CSS backgrounds cannot provide.
            <img
              alt=""
              aria-hidden="true"
              className="h-10 w-10 rounded-md object-contain"
              decoding="async"
              loading="lazy"
              referrerPolicy="no-referrer"
              src={appearance.theme.logo_url}
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
      {(isMultiPage || isShowingSubmittedCompletionPage) &&
        displayedPage.title && (
          <div className="rounded-lg border border-primary/30 bg-muted/20 px-4 py-3">
            <h2 className="text-lg font-medium">{displayedPage.title}</h2>
          </div>
        )}

      <form ref={formRef} onSubmit={handleFormSubmit} className="space-y-3">
        {/* Plate ドキュメントによるフォーム描画 (現在ページのみ) */}
        {parsedContent.length > 0 ? (
          <div
            className={cn(
              "rounded-lg border bg-card text-card-foreground",
              spacingClass.card,
            )}
            ref={viewerRef}
          >
            <FormQuestionA11yProvider
              errorMessagesByQuestionId={currentPageErrorMessagesByQuestionId}
              invalidQuestionIds={currentPageInvalidQuestionIds}
              markQuestionTouched={markQuestionTouched}
              notifyQuestionAnswerChange={notifyQuestionAnswerChange}
            >
              <PlateViewer
                key={displayedPageIndex}
                value={viewerPlateContent}
              />
            </FormQuestionA11yProvider>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isContentEmpty
              ? "フォームの内容が空です。"
              : "フォームの内容を読み込めませんでした。"}
          </p>
        )}

        {shouldShowPageValidationAlert ? (
          <div
            aria-live="assertive"
            className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
            role="alert"
          >
            <p className="text-sm text-destructive">
              {FORM_VALIDATION_ALERT_MESSAGE}
            </p>
          </div>
        ) : null}

        {/* 質問がある場合のみ送信・ナビゲーションを表示 */}
        {allQuestions.length > 0 && !isShowingSubmittedCompletionPage && (
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
