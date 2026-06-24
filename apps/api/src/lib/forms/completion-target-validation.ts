import {
  type CompletionTargetValidationIssue,
  validateCompletionTargetsInPlateContent,
} from "@nexus-form/shared";
import { FormValidationError } from "../errors/form-errors";

export const COMPLETION_TARGET_VALIDATION_ERROR_MESSAGE =
  "送信後画面の遷移先を確認してください";

export interface CompletionTargetValidationErrorResponse {
  error: string;
  details: {
    blockIds: string[];
  };
}

export function summarizeCompletionTargetIssues(
  issues: CompletionTargetValidationIssue[],
): CompletionTargetValidationErrorResponse {
  const blockIds = Array.from(
    new Set(
      issues.flatMap((issue) =>
        issue.code === "completion_target_has_answerable_questions"
          ? issue.answerableQuestionIds
          : [issue.targetPageId],
      ),
    ),
  );

  return {
    error: COMPLETION_TARGET_VALIDATION_ERROR_MESSAGE,
    details: { blockIds },
  };
}

export function validateCompletionTargetsForApi(
  plateContent: unknown[],
): CompletionTargetValidationErrorResponse | null {
  const issues = validateCompletionTargetsInPlateContent(plateContent);
  return issues.length > 0 ? summarizeCompletionTargetIssues(issues) : null;
}

export function assertCompletionTargetsForSnapshot(
  plateContent: unknown[],
): void {
  const response = validateCompletionTargetsForApi(plateContent);
  if (response) {
    throw new FormValidationError(response.error, response.details);
  }
}
