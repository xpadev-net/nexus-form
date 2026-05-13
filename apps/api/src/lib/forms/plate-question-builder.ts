/**
 * plateContent (JSON文字列) を response-validator が期待する質問定義リストに変換する。
 */

import {
  ANSWERABLE_QUESTION_TYPES,
  type AnswerableQuestionType,
  extractQuestionsFromPlateContent,
  questionValidationSchema,
  type ValidatorQuestion,
} from "@nexus-form/shared";

import { logError, logWarn } from "../logger";

export type { ValidatorQuestion } from "@nexus-form/shared";

const answerableSet: ReadonlySet<string> = new Set(ANSWERABLE_QUESTION_TYPES);

/**
 * フォームの plateContent JSON 文字列から ValidatorQuestion[] を構築する。
 * パースに失敗した場合は空配列を返す。
 */
export function buildQuestionsFromPlateContent(
  plateContentJson: string,
): ValidatorQuestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plateContentJson);
  } catch {
    logWarn("Failed to parse plateContent JSON", "plate-question-builder");
    return [];
  }

  if (!Array.isArray(parsed)) {
    logWarn(
      "plateContent is not a JSON array — skipping question extraction",
      "plate-question-builder",
    );
    return [];
  }

  let extracted: ReturnType<typeof extractQuestionsFromPlateContent>;
  try {
    extracted = extractQuestionsFromPlateContent(parsed);
  } catch (err) {
    logError(
      `Failed to extract questions from plateContent: ${String(err)}`,
      "plate-question-builder",
      { error: err },
    );
    return [];
  }

  return extracted
    .filter((q): q is typeof q & { type: AnswerableQuestionType } =>
      answerableSet.has(q.type),
    )
    .map((q) => {
      const result =
        q.validation != null
          ? questionValidationSchema.safeParse(q.validation)
          : { success: true as const, data: undefined };
      if (!result.success) {
        logWarn(
          `Failed to parse validation rules for question ${q.blockId}: ${result.error.message}`,
          "plate-question-builder",
        );
      }
      const rawValidation = result.success ? result.data : undefined;
      const validation =
        rawValidation && Object.keys(rawValidation).length > 0
          ? rawValidation
          : undefined;

      return {
        id: q.blockId,
        type: q.type,
        ...(validation ? { validation } : {}),
      };
    });
}
