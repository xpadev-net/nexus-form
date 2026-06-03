import { NO_CHANGES_TO_PUBLISH_MESSAGE } from "@nexus-form/shared";

/**
 * フォーム権限関連のカスタムエラークラス
 */

export enum FormPermissionErrorCode {
  FORM_NOT_FOUND = "FORM_NOT_FOUND",
  INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS",
}

export class FormPermissionError extends Error {
  constructor(
    public code: FormPermissionErrorCode,
    message: string,
    public statusCode: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FormPermissionError";
  }
}

export class FormNotFoundError extends FormPermissionError {
  constructor(formId: string) {
    super(FormPermissionErrorCode.FORM_NOT_FOUND, "Form not found", 404, {
      form_id: formId,
    });
  }
}

export class InsufficientFormPermissionError extends FormPermissionError {
  constructor(
    formId: string,
    requiredRole: string,
    effectiveRole: string | null,
  ) {
    super(
      FormPermissionErrorCode.INSUFFICIENT_PERMISSIONS,
      "Insufficient permissions",
      403,
      {
        form_id: formId,
        required_role: requiredRole,
        effective_role: effectiveRole,
      },
    );
  }
}

/**
 * フォーム構造が見つからないエラー
 */
export class FormStructureNotFoundError extends Error {
  constructor(formId: string) {
    super(`Form structure not found for form ${formId}`);
    this.name = "FormStructureNotFoundError";
  }

  get statusCode(): number {
    return 404;
  }
}

/**
 * スナップショットが見つからないエラー
 */
export class SnapshotNotFoundError extends Error {
  constructor(formId: string, version?: number) {
    const message =
      version !== undefined
        ? `Snapshot not found for form ${formId} version ${version}`
        : `No active snapshot found for form ${formId}`;
    super(message);
    this.name = "SnapshotNotFoundError";
  }

  get statusCode(): number {
    return 404;
  }
}

/**
 * 保存対象の変更がないエラー
 */
export class NoChangesError extends Error {
  constructor() {
    super(NO_CHANGES_TO_PUBLISH_MESSAGE);
    this.name = "NoChangesError";
  }

  get statusCode(): number {
    return 400;
  }
}

/**
 * フォームバリデーションエラー
 */
export class FormValidationError extends Error {
  constructor(
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FormValidationError";
  }

  get statusCode(): number {
    return 400;
  }

  get code(): string {
    return "VALIDATION_ERROR";
  }
}
