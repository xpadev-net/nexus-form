import type { FC, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

/** A single response value per question block. */
interface AnswerEntry {
  value?: unknown;
  values?: unknown[];
  responses?: Record<string, unknown>;
  other_value?: string;
  other_values?: string[];
}

interface FormResponseContextValue {
  /** Get the current answer for a block */
  getAnswer: (blockId: string) => AnswerEntry | undefined;
  /** Set or update the answer for a block */
  setAnswer: (blockId: string, entry: AnswerEntry) => void;
  /** Get all answers as a Map */
  answers: ReadonlyMap<string, AnswerEntry>;
  /** Clear all answers */
  clearAnswers: () => void;
}

const FormResponseContext = createContext<FormResponseContextValue | null>(
  null,
);

interface FormResponseProviderProps {
  children: ReactNode;
}

export const FormResponseProvider: FC<FormResponseProviderProps> = ({
  children,
}) => {
  const [answersMap, setAnswersMap] = useState<Map<string, AnswerEntry>>(
    () => new Map(),
  );

  const getAnswer = useCallback(
    (blockId: string) => answersMap.get(blockId),
    [answersMap],
  );

  const setAnswer = useCallback((blockId: string, entry: AnswerEntry) => {
    setAnswersMap((prev) => {
      const next = new Map(prev);
      next.set(blockId, entry);
      return next;
    });
  }, []);

  const clearAnswers = useCallback(() => {
    setAnswersMap(new Map());
  }, []);

  const value = useMemo<FormResponseContextValue>(
    () => ({ getAnswer, setAnswer, answers: answersMap, clearAnswers }),
    [getAnswer, setAnswer, answersMap, clearAnswers],
  );

  return (
    <FormResponseContext.Provider value={value}>
      {children}
    </FormResponseContext.Provider>
  );
};

export function useFormResponse(): FormResponseContextValue {
  const ctx = useContext(FormResponseContext);
  if (!ctx) {
    throw new Error(
      "useFormResponse must be used within a FormResponseProvider",
    );
  }
  return ctx;
}

/**
 * Returns the FormResponseContext value if available, or null when
 * no FormResponseProvider wraps the current tree (e.g. editor mode).
 */
export function useFormResponseOptional(): FormResponseContextValue | null {
  return useContext(FormResponseContext);
}
