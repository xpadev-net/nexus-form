import type { ExtractedQuestion } from "@nexus-form/shared";

interface AnswerLike {
  value?: unknown;
  values?: unknown[];
  responses?: Record<string, unknown>;
  other_value?: string;
  other_values?: string[];
}

function getRequiredGridRows(question: ExtractedQuestion): string[] {
  if (question.type !== "choice_grid" && question.type !== "checkbox_grid") {
    return [];
  }
  const rows = (question.validation as Record<string, unknown>).rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (
      typeof row === "object" &&
      row !== null &&
      typeof (row as { id?: unknown }).id === "string"
    ) {
      return [(row as { id: string }).id];
    }
    return [];
  });
}

function hasRequiredGridRowsAnswered(
  question: ExtractedQuestion,
  responses: Record<string, unknown> | undefined,
): boolean {
  const requiredRows = getRequiredGridRows(question);
  if (requiredRows.length === 0) {
    return responses != null && Object.keys(responses).length > 0;
  }
  if (!responses) return false;
  return requiredRows.every((rowId) => {
    const value = responses[rowId];
    if (question.type === "choice_grid") {
      return typeof value === "string" && value !== "";
    }
    return Array.isArray(value) && value.length > 0;
  });
}

function isIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(year);

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function hasRequiredDateAnswered(
  question: ExtractedQuestion,
  value: unknown,
): boolean {
  if (typeof value !== "string") return false;
  if (value === "" || !isIsoCalendarDate(value)) return false;

  const validation = question.validation as Record<string, unknown>;
  const minDate =
    typeof validation.minDate === "string" ? validation.minDate : undefined;
  const maxDate =
    typeof validation.maxDate === "string" ? validation.maxDate : undefined;

  if (minDate && value < minDate) return false;
  if (maxDate && value > maxDate) return false;
  return true;
}

/** Return required questions that have no answer yet. */
export function findUnansweredRequired(
  questions: ExtractedQuestion[],
  answers: ReadonlyMap<string, AnswerLike>,
): ExtractedQuestion[] {
  return questions.filter((q) => {
    if (
      q.validation == null ||
      typeof q.validation !== "object" ||
      !(q.validation as Record<string, unknown>).required
    ) {
      return false;
    }
    const answer = answers.get(q.blockId);
    if (!answer) return true;

    // Check "other" text: if "other" is selected, the text must be non-empty
    const val = q.validation as Record<string, unknown>;
    const qType = q.type as string | undefined;
    if (
      val.allowOther &&
      (qType === "radio" || qType === "dropdown" || qType === "checkbox")
    ) {
      // radio / dropdown: value === "other" requires other_value
      if (
        answer.value === "other" &&
        (!answer.other_value || answer.other_value.trim() === "")
      ) {
        return true;
      }
      // checkbox: values includes "other" requires non-empty other_values
      if (
        Array.isArray(answer.values) &&
        answer.values.includes("other") &&
        (!answer.other_values ||
          answer.other_values.length === 0 ||
          answer.other_values.every((v) => v.trim() === ""))
      ) {
        return true;
      }
    }

    if (q.type === "date") {
      return !hasRequiredDateAnswered(q, answer.value);
    }
    if (answer.value != null && answer.value !== "") return false;
    if (Array.isArray(answer.values) && answer.values.length > 0) return false;
    if (q.type === "choice_grid" || q.type === "checkbox_grid") {
      return !hasRequiredGridRowsAnswered(q, answer.responses);
    }
    if (
      answer.responses != null &&
      typeof answer.responses === "object" &&
      Object.keys(answer.responses as Record<string, unknown>).length > 0
    ) {
      return false;
    }
    return true;
  });
}
