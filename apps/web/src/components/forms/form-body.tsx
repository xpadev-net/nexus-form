import {
  type ExtractedQuestion,
  extractQuestionsFromPlateContent,
  splitPlateContentIntoPages,
} from "@nexus-form/shared";
import { type FormEvent, type ReactNode, useCallback, useMemo } from "react";
import { PlateViewer } from "@/components/editor/plate-viewer";
import { Button } from "@/components/ui/button";
import { useFormResponse } from "@/contexts/form-response-context";
import { useFormPaging } from "@/hooks/forms/use-form-paging";
import { findUnansweredRequired } from "@/lib/forms/find-unanswered-required";
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
}: FormBodyProps) {
  const { answers } = useFormResponse();

  const { parsedContent, isContentEmpty } = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(plateContent);
      if (!Array.isArray(parsed)) {
        return { parsedContent: [] as unknown[], isContentEmpty: false };
      }
      return {
        parsedContent: parsed as unknown[],
        isContentEmpty: parsed.length === 0,
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

  const isMultiPage = pages.length > 1;
  const paging = useFormPaging({ pages, answers });

  const currentPageValue = useMemo(
    () => JSON.stringify(paging.currentPage.nodes),
    [paging.currentPage.nodes],
  );

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

  return (
    <section className="mx-auto max-w-3xl space-y-4 p-6">
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
          <div className="rounded-lg border bg-card p-6">
            <PlateViewer
              key={paging.currentPageIndex}
              value={isMultiPage ? currentPageValue : plateContent}
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
