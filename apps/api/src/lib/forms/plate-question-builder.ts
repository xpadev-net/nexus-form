/**
 * plateContent (JSON文字列) を response-validator が期待する質問定義リストに変換する。
 */

import {
  ANSWERABLE_QUESTION_TYPES,
  type AnswerableQuestionType,
  extractQuestionsFromPlateContent,
  questionValidationSchema,
  resolveReachableFormContent,
  splitPlateContentIntoPages,
  type ValidatorQuestion,
} from "@nexus-form/shared";

import { logError, logWarn } from "../logger";

export type { ValidatorQuestion } from "@nexus-form/shared";

const answerableSet: ReadonlySet<string> = new Set(ANSWERABLE_QUESTION_TYPES);

export class PlateQuestionBuildError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PlateQuestionBuildError";
  }
}

function parsePlateContentArray(plateContentJson: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plateContentJson);
  } catch (error) {
    throw new PlateQuestionBuildError("Failed to parse plateContent JSON", {
      cause: error,
    });
  }

  if (!Array.isArray(parsed)) {
    throw new PlateQuestionBuildError("plateContent is not a JSON array");
  }

  return parsed;
}

function buildQuestionsFromPlateContentWithMode(
  plateContentJson: string,
  options: { strictValidation: boolean },
): ValidatorQuestion[] {
  const parsed = parsePlateContentArray(plateContentJson);

  let extracted: ReturnType<typeof extractQuestionsFromPlateContent>;
  try {
    extracted = extractQuestionsFromPlateContent(parsed);
  } catch (error) {
    throw new PlateQuestionBuildError(
      `Failed to extract questions from plateContent: ${String(error)}`,
      { cause: error },
    );
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
        const message = `Failed to parse validation rules for question ${q.blockId}: ${result.error.message}`;
        if (options.strictValidation) {
          throw new PlateQuestionBuildError(message);
        }
        logWarn(message, "plate-question-builder");
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

export function buildQuestionsFromPlateContentStrict(
  plateContentJson: string,
): ValidatorQuestion[] {
  return buildQuestionsFromPlateContentWithMode(plateContentJson, {
    strictValidation: true,
  });
}

export function buildReachableQuestionIdsFromPlateContentStrict(
  plateContentJson: string,
  responses: Record<string, unknown>,
): Set<string> {
  const parsed = parsePlateContentArray(plateContentJson);
  const pages = splitPlateContentIntoPages(parsed);
  return new Set(resolveReachableFormContent(pages, responses).questionIds);
}

/**
 * フォームの plateContent JSON 文字列から ValidatorQuestion[] を構築する。
 * パースに失敗した場合は空配列を返す。
 */
export function buildQuestionsFromPlateContent(
  plateContentJson: string,
): ValidatorQuestion[] {
  try {
    return buildQuestionsFromPlateContentWithMode(plateContentJson, {
      strictValidation: false,
    });
  } catch (error) {
    if (error instanceof PlateQuestionBuildError) {
      logWarn(error.message, "plate-question-builder");
      return [];
    }
    logError(
      `Unexpected error while building questions from plateContent: ${String(error)}`,
      "plate-question-builder",
      { error },
    );
    return [];
  }
}
