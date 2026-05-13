import type { Block } from "@/types/domain/form-block";
import {
  validateDate,
  validateTime,
} from "@/utils/validation/question-validators";

/**
 * Validation helper functions
 * Provides a cleaner interface for validation without API coupling
 */

/**
 * Creates a date validation function
 */
export const createDateValidator = (question: Block) => {
  return async (value: string) => {
    if (!question.validation) {
      return { isValid: true };
    }

    // Required field validation
    if (question.validation.required && (!value || value.trim() === "")) {
      return {
        isValid: false,
        error: "この項目は必須です",
      };
    }

    // Skip validation for empty optional fields
    if (!value || value.trim() === "") {
      return { isValid: true };
    }

    // Use existing validation logic but with cleaner error messages
    try {
      const response = {
        question_id: question.id,
        question_type: "date" as const,
        value: value,
      };

      const result = validateDate(question, response);

      if (!result.is_valid && result.errors.length > 0) {
        const error = result.errors[0];
        if (!error) {
          return { isValid: false, error: "バリデーションエラー" };
        }

        // Provide more specific error messages
        let userFriendlyMessage = error.message;

        if (error.code === "REQUIRED") {
          userFriendlyMessage = "この項目は必須です";
        } else if (error.code === "INVALID_DATE_FORMAT") {
          userFriendlyMessage = "正しい日付形式で入力してください";
        } else if (error.code === "DATE_TOO_EARLY") {
          const validation = question.validation;
          if (validation && "minDate" in validation && validation.minDate) {
            userFriendlyMessage = `日付は ${validation.minDate} 以降である必要があります`;
          }
        } else if (error.code === "DATE_TOO_LATE") {
          const validation = question.validation;
          if (validation && "maxDate" in validation && validation.maxDate) {
            userFriendlyMessage = `日付は ${validation.maxDate} 以前である必要があります`;
          }
        }

        return {
          isValid: false,
          error: userFriendlyMessage,
        };
      }

      return { isValid: true };
    } catch (_error) {
      return {
        isValid: false,
        error: "日付の形式が正しくありません",
      };
    }
  };
};

/**
 * Creates a time validation function
 */
export const createTimeValidator = (question: Block) => {
  return async (value: string) => {
    if (!question.validation) {
      return { isValid: true };
    }

    // Required field validation
    if (question.validation.required && (!value || value.trim() === "")) {
      return {
        isValid: false,
        error: "この項目は必須です",
      };
    }

    // Skip validation for empty optional fields
    if (!value || value.trim() === "") {
      return { isValid: true };
    }

    // Use existing validation logic but with cleaner error messages
    try {
      const response = {
        question_id: question.id,
        question_type: "time" as const,
        value: value,
      };

      const result = validateTime(question, response);

      if (!result.is_valid && result.errors.length > 0) {
        const error = result.errors[0];
        if (!error) {
          return { isValid: false, error: "バリデーションエラー" };
        }

        // Provide more specific error messages
        let userFriendlyMessage = error.message;

        if (error.code === "REQUIRED") {
          userFriendlyMessage = "この項目は必須です";
        } else if (error.code === "INVALID_TIME_FORMAT") {
          const validation = question.validation;
          if (validation && "format" in validation) {
            const format =
              validation.format === "12h" ? "HH:MM AM/PM" : "HH:MM";
            userFriendlyMessage = `正しい時刻形式で入力してください (${format})`;
          }
        } else if (error.code === "TIME_TOO_EARLY") {
          const validation = question.validation;
          if (validation && "minTime" in validation && validation.minTime) {
            userFriendlyMessage = `時刻は ${validation.minTime} 以降である必要があります`;
          }
        } else if (error.code === "TIME_TOO_LATE") {
          const validation = question.validation;
          if (validation && "maxTime" in validation && validation.maxTime) {
            userFriendlyMessage = `時刻は ${validation.maxTime} 以前である必要があります`;
          }
        }

        return {
          isValid: false,
          error: userFriendlyMessage,
        };
      }

      return { isValid: true };
    } catch (_error) {
      return {
        isValid: false,
        error: "時刻の形式が正しくありません",
      };
    }
  };
};
