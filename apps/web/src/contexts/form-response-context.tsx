import type { FC, ReactNode } from "react";
import { createContext, use, useCallback, useMemo, useReducer } from "react";

/** A single response value per question block. */
export interface AnswerEntry {
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
  initialAnswers?: ReadonlyMap<string, AnswerEntry>;
}

type AnswersAction =
  | { type: "set"; blockId: string; entry: AnswerEntry }
  | { type: "clear" };

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownArraysEqual(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => unknownValuesEqual(value, right[index]));
}

function unknownRecordsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      Object.hasOwn(right, key) && unknownValuesEqual(left[key], right[key]),
  );
}

function unknownValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return unknownArraysEqual(left, right);
  }
  if (isUnknownRecord(left) && isUnknownRecord(right)) {
    return unknownRecordsEqual(left, right);
  }
  return false;
}

function answerEntriesEqual(
  left: AnswerEntry | undefined,
  right: AnswerEntry | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return (
    unknownValuesEqual(left.value, right.value) &&
    unknownValuesEqual(left.values, right.values) &&
    unknownValuesEqual(left.responses, right.responses) &&
    unknownValuesEqual(left.other_value, right.other_value) &&
    unknownValuesEqual(left.other_values, right.other_values)
  );
}

const answersReducer = (
  prev: Map<string, AnswerEntry>,
  action: AnswersAction,
): Map<string, AnswerEntry> => {
  if (action.type === "clear") {
    if (prev.size === 0) return prev;
    return new Map();
  }

  if (answerEntriesEqual(prev.get(action.blockId), action.entry)) {
    return prev;
  }

  const next = new Map(prev);
  next.set(action.blockId, action.entry);
  return next;
};

function createInitialAnswersMap(
  initialAnswers?: ReadonlyMap<string, AnswerEntry>,
): Map<string, AnswerEntry> {
  return initialAnswers ? new Map(initialAnswers) : new Map();
}

export const FormResponseProvider: FC<FormResponseProviderProps> = ({
  children,
  initialAnswers,
}) => {
  const [answersMap, dispatchAnswers] = useReducer(
    answersReducer,
    initialAnswers,
    createInitialAnswersMap,
  );

  const getAnswer = useCallback(
    (blockId: string) => answersMap.get(blockId),
    [answersMap],
  );

  const setAnswer = useCallback((blockId: string, entry: AnswerEntry) => {
    dispatchAnswers({ type: "set", blockId, entry });
  }, []);

  const clearAnswers = useCallback(() => {
    dispatchAnswers({ type: "clear" });
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
  const ctx = use(FormResponseContext);
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
  return use(FormResponseContext);
}
