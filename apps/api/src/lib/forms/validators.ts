import {
  FormNotFoundError,
  FormPermissionError,
  FormPermissionErrorCode,
} from "../errors/form-errors";

/**
 * フォームの型定義（バリデーションに必要なフィールドのみ）
 */
interface FormForValidation {
  id: string;
  status: string;
  allowEditResponses: boolean;
}

type ValidationResult = { valid: true } | { valid: false; error: Error };

/**
 * フォームの回答修正可能性を検証する
 * @param form フォームオブジェクト
 * @returns 検証結果
 */
export const validateFormForResponseModification = (
  form: FormForValidation | null,
): ValidationResult => {
  if (!form) {
    return {
      valid: false,
      error: new FormNotFoundError("unknown"),
    };
  }

  if (form.status !== "PUBLISHED") {
    return {
      valid: false,
      error: new FormPermissionError(
        FormPermissionErrorCode.INSUFFICIENT_PERMISSIONS,
        "Form is not published",
        400,
        {
          form_id: form.id,
          status: form.status,
        },
      ),
    };
  }

  if (!form.allowEditResponses) {
    return {
      valid: false,
      error: new FormPermissionError(
        FormPermissionErrorCode.INSUFFICIENT_PERMISSIONS,
        "Form does not allow response editing",
        400,
        {
          form_id: form.id,
          allow_edit_responses: form.allowEditResponses,
        },
      ),
    };
  }

  return { valid: true };
};

/**
 * フォームの回答送信可能性を検証する
 * @param form フォームオブジェクト
 * @returns 検証結果
 */
export const validateFormForResponseSubmission = (
  form: FormForValidation | null,
): ValidationResult => {
  if (!form) {
    return {
      valid: false,
      error: new FormNotFoundError("unknown"),
    };
  }

  if (form.status !== "PUBLISHED") {
    return {
      valid: false,
      error: new FormPermissionError(
        FormPermissionErrorCode.INSUFFICIENT_PERMISSIONS,
        "Form is not published",
        400,
        {
          form_id: form.id,
          status: form.status,
        },
      ),
    };
  }

  return { valid: true };
};
