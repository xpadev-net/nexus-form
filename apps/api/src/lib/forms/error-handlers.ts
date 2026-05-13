import { z } from "zod";
import { FormPermissionError } from "../errors/form-errors";
import { logError } from "../logger";

/**
 * API エラーレスポンスの型
 */
export interface ApiErrorResponse {
  message: string;
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;
}

/**
 * 共通エラーハンドリング関数
 * @param error エラーオブジェクト
 * @param context エラーコンテキスト（デバッグ用）
 * @returns ApiErrorResponse
 */
export const handleApiError = (
  error: unknown,
  context: string,
): ApiErrorResponse => {
  logError(`${context} error:`, "api", { error: error });

  // フォーム権限エラー
  if (error instanceof FormPermissionError) {
    return {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      details: error.details,
    };
  }

  // Zodバリデーションエラー
  if (error instanceof z.ZodError) {
    // コンテキストに基づいてエラーメッセージを決定
    const message = context.includes("Get responses")
      ? "Invalid query parameters"
      : "Invalid request data";

    return {
      message,
      code: "VALIDATION_ERROR",
      statusCode: 400,
      details: {
        validation_errors: error.issues,
      },
    };
  }

  // 一般的なエラー
  return {
    message: "Internal server error",
    code: "INTERNAL_ERROR",
    statusCode: 500,
    details: { context },
  };
};

/**
 * データベースエラーのハンドリング
 * @param error エラーオブジェクト
 * @param context エラーコンテキスト
 * @returns ApiErrorResponse
 */
export const handleDatabaseError = (
  error: unknown,
  context: string,
): ApiErrorResponse => {
  logError(`Database error in ${context}:`, "api", { error: error });

  // Drizzle/MySQL固有のエラーをチェック
  if (error && typeof error === "object" && "code" in error) {
    const dbError = error as { code: string; message: string };

    switch (dbError.code) {
      case "ER_DUP_ENTRY": // MySQL unique constraint violation
        return {
          message: "Resource already exists",
          code: "DUPLICATE_RESOURCE",
          statusCode: 409,
        };
      case "ER_NO_REFERENCED_ROW_2": // MySQL foreign key constraint violation
        return {
          message: "Invalid reference",
          code: "INVALID_REFERENCE",
          statusCode: 400,
        };
      default:
        return {
          message: "Database operation failed",
          code: "DATABASE_ERROR",
          statusCode: 500,
          details: { error_code: dbError.code },
        };
    }
  }

  return handleApiError(error, context);
};
