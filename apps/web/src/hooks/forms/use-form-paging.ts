import {
  evaluateRule,
  type PlatePage,
  resolvePageIndexByPageId,
} from "@nexus-form/shared";
import { useCallback, useMemo, useState } from "react";

interface AnswerEntry {
  value?: unknown;
  values?: unknown[];
  responses?: Record<string, unknown>;
}

interface UseFormPagingProps {
  pages: PlatePage[];
  answers: ReadonlyMap<string, AnswerEntry>;
}

interface UseFormPagingReturn {
  currentPageIndex: number;
  currentPage: PlatePage;
  totalPages: number;
  isFirstPage: boolean;
  isLastPage: boolean;
  shouldSubmit: boolean;
  goToNextPage: () => void;
  goToPreviousPage: () => void;
  goToPage: (pageIndex: number) => void;
  pageHistory: number[];
  visitedQuestionIds: string[];
}

function answersToResponseRecord(
  answers: ReadonlyMap<string, AnswerEntry>,
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const [blockId, entry] of answers) {
    record[blockId] = entry.value ?? entry.values ?? entry.responses;
  }
  return record;
}

/**
 * Evaluate the resolved action for a page given the current answers.
 * Returns the action from the first matching navigation rule, or the
 * page's defaultAction, or undefined if nothing matches.
 */
function resolvePageAction(
  page: PlatePage,
  answers: ReadonlyMap<string, AnswerEntry>,
): PlatePage["defaultAction"] | undefined {
  const responses = answersToResponseRecord(answers);

  if (page.navigationRules && page.navigationRules.length > 0) {
    for (const rule of page.navigationRules) {
      const matched = evaluateRule(rule, {
        responses,
        questionId: page.pageId,
      });
      if (matched && rule.action) {
        return {
          type: rule.action.type as "jump_to_section" | "next" | "submit",
          target_id: rule.action.target_id,
          metadata: rule.action.metadata,
        };
      }
    }
  }

  return page.defaultAction;
}

export function useFormPaging({
  pages,
  answers,
}: UseFormPagingProps): UseFormPagingReturn {
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [pageHistory, setPageHistory] = useState<number[]>([]);

  const totalPages = pages.length;
  const fallbackPage: PlatePage = {
    pageId: "default",
    nodes: [],
    questionIds: [],
  };
  const currentPage: PlatePage =
    pages[currentPageIndex] ?? pages[0] ?? fallbackPage;
  const isFirstPage = currentPageIndex === 0;
  const isLastPage = currentPageIndex >= totalPages - 1;

  // Derive shouldSubmit from current answers so it auto-updates when
  // answers change, rather than relying on a stale flag.
  const shouldSubmit = useMemo(() => {
    const action = resolvePageAction(currentPage, answers);
    return action?.type === "submit";
  }, [currentPage, answers]);

  const goToNextPage = useCallback(() => {
    const page = pages[currentPageIndex];
    if (!page) return;

    const action = resolvePageAction(page, answers);

    if (action?.type === "submit") {
      // Submit is handled by shouldSubmit; nothing to navigate.
      return;
    }

    if (action?.type === "jump_to_section" && action.target_id) {
      const targetIndex = resolvePageIndexByPageId(pages, action.target_id);
      if (targetIndex !== -1) {
        setPageHistory((prev) => [...prev, currentPageIndex]);
        setCurrentPageIndex(targetIndex);
        return;
      }
      // target not found, fall through to default next page
    }

    // "next" action or no action: go to next page
    if (currentPageIndex < totalPages - 1) {
      setPageHistory((prev) => [...prev, currentPageIndex]);
      setCurrentPageIndex(currentPageIndex + 1);
    }
  }, [pages, currentPageIndex, totalPages, answers]);

  const goToPreviousPage = useCallback(() => {
    setPageHistory((prev) => {
      if (prev.length === 0) return prev;
      const newHistory = [...prev];
      const previousIndex = newHistory.pop();
      if (previousIndex !== undefined) {
        setCurrentPageIndex(previousIndex);
      }
      return newHistory;
    });
  }, []);

  const goToPage = useCallback(
    (pageIndex: number) => {
      if (pageIndex >= 0 && pageIndex < totalPages) {
        setPageHistory((prev) => [...prev, currentPageIndex]);
        setCurrentPageIndex(pageIndex);
      }
    },
    [totalPages, currentPageIndex],
  );

  const visitedQuestionIds = useMemo(() => {
    const visitedPages = new Set([...pageHistory, currentPageIndex]);
    const ids: string[] = [];
    for (const pageIdx of visitedPages) {
      const page = pages[pageIdx];
      if (page) {
        ids.push(...page.questionIds);
      }
    }
    return ids;
  }, [pages, pageHistory, currentPageIndex]);

  return {
    currentPageIndex,
    currentPage,
    totalPages,
    isFirstPage,
    isLastPage,
    shouldSubmit,
    goToNextPage,
    goToPreviousPage,
    goToPage,
    pageHistory,
    visitedQuestionIds,
  };
}
