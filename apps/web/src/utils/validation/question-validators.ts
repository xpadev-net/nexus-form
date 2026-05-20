import {
  getTextLengthViolations,
  isBlankResponseValue,
  textMatchesPattern,
} from "@nexus-form/shared";
import { getPatternTemplate } from "@/lib/constants/validation-patterns";
import { isValidEmail } from "@/lib/validation/email";
import { getValidationMessage } from "@/lib/validation-messages";
import type { Block } from "@/types/domain/form-block";
import type { ResponseData } from "@/types/domain/response";
import type {
  ValidationError,
  ValidationResult,
} from "@/types/domain/validation";

// バリデーションエラーを作成するヘルパー関数
const createValidationError = (
  field: string,
  message: string,
  code: string,
  value?: unknown,
): ValidationError => ({
  field,
  message,
  code,
  value,
});

// 型安全な型ガード関数
const isShortTextValidation = (
  validation: Block["validation"],
): validation is Extract<Block["validation"], { type: "short_text" }> => {
  return validation.type === "short_text";
};

const isLongTextValidation = (
  validation: Block["validation"],
): validation is Extract<Block["validation"], { type: "long_text" }> => {
  return validation.type === "long_text";
};

const isRadioValidation = (
  validation: Block["validation"],
): validation is Extract<Block["validation"], { type: "radio" }> => {
  return validation.type === "radio";
};

const isCheckboxValidation = (
  validation: Block["validation"],
): validation is Extract<Block["validation"], { type: "checkbox" }> => {
  return validation.type === "checkbox";
};

const isDropdownValidation = (
  validation: Block["validation"],
): validation is Extract<Block["validation"], { type: "dropdown" }> => {
  return validation.type === "dropdown";
};

const isLinearScaleValidation = (
  validation: Block["validation"],
): validation is Extract<Block["validation"], { type: "linear_scale" }> => {
  return validation.type === "linear_scale";
};

const isRatingValidation = (
  validation: Block["validation"],
): validation is Extract<Block["validation"], { type: "rating" }> => {
  return validation.type === "rating";
};

const isChoiceGridValidation = (
  validation: Block["validation"],
): validation is Extract<Block["validation"], { type: "choice_grid" }> => {
  return validation.type === "choice_grid";
};

const isCheckboxGridValidation = (
  validation: Block["validation"],
): validation is Extract<Block["validation"], { type: "checkbox_grid" }> => {
  return validation.type === "checkbox_grid";
};

const isDateValidation = (
  validation: Block["validation"],
): validation is Extract<Block["validation"], { type: "date" }> => {
  return validation.type === "date";
};

const isTimeValidation = (
  validation: Block["validation"],
): validation is Extract<Block["validation"], { type: "time" }> => {
  return validation.type === "time";
};

// 短文入力のバリデーション
export const validateShortText = (
  question: Block,
  response: Extract<ResponseData, { question_type: "short_text" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const { validation } = question;
  const { value } = response;
  const shortTextValidation = isShortTextValidation(validation)
    ? validation
    : undefined;
  const template = shortTextValidation?.patternTemplate
    ? getPatternTemplate(shortTextValidation.patternTemplate)
    : undefined;
  const requiresEmailFormat = template?.inputType === "email";

  // 必須チェック
  if (validation.required && isBlankResponseValue(value)) {
    errors.push(
      createValidationError(
        question.blockId,
        getValidationMessage("REQUIRED"),
        "REQUIRED",
      ),
    );
    return { is_valid: false, errors };
  }

  // 空の場合は他のバリデーションをスキップ
  if (isBlankResponseValue(value)) {
    return { is_valid: true, errors: [] };
  }

  for (const violation of getTextLengthViolations(
    value,
    shortTextValidation ?? {},
  )) {
    if (violation.code === "MIN_LENGTH") {
      errors.push(
        createValidationError(
          question.blockId,
          `${violation.limit}文字以上で入力してください`,
          "MIN_LENGTH",
          violation.length,
        ),
      );
    }
    if (violation.code === "MAX_LENGTH") {
      errors.push(
        createValidationError(
          question.blockId,
          `${violation.limit}文字以下で入力してください`,
          "MAX_LENGTH",
          violation.length,
        ),
      );
    }
  }

  // パターンマッチングチェック
  if (
    shortTextValidation?.pattern &&
    !shortTextValidation.allowPatternMismatch
  ) {
    if (!textMatchesPattern(value, shortTextValidation.pattern)) {
      // テンプレートが設定されている場合は具体的なエラーメッセージを表示
      let errorMessage = "入力形式が正しくありません";
      if (template) {
        errorMessage = template.errorMessage;
      }

      errors.push(
        createValidationError(
          question.blockId,
          errorMessage,
          "PATTERN_MISMATCH",
        ),
      );
    }
  }

  if (
    requiresEmailFormat &&
    !shortTextValidation?.allowPatternMismatch &&
    !isValidEmail(value)
  ) {
    errors.push(
      createValidationError(
        question.blockId,
        template?.errorMessage ?? "有効なメールアドレスを入力してください",
        "EMAIL_INVALID",
      ),
    );
  }

  return {
    is_valid: errors.length === 0,
    errors,
  };
};

// 長文入力のバリデーション
export const validateLongText = (
  question: Block,
  response: Extract<ResponseData, { question_type: "long_text" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const { validation } = question;
  const { value } = response;

  // 必須チェック
  if (validation.required && isBlankResponseValue(value)) {
    errors.push(
      createValidationError(
        question.blockId,
        getValidationMessage("REQUIRED"),
        "REQUIRED",
      ),
    );
    return { is_valid: false, errors };
  }

  // 空の場合は他のバリデーションをスキップ
  if (isBlankResponseValue(value)) {
    return { is_valid: true, errors: [] };
  }

  for (const violation of getTextLengthViolations(
    value,
    isLongTextValidation(validation) ? validation : {},
  )) {
    if (violation.code === "MIN_LENGTH") {
      errors.push(
        createValidationError(
          question.blockId,
          `${violation.limit}文字以上で入力してください`,
          "MIN_LENGTH",
          violation.length,
        ),
      );
    }
    if (violation.code === "MAX_LENGTH") {
      errors.push(
        createValidationError(
          question.blockId,
          `${violation.limit}文字以下で入力してください`,
          "MAX_LENGTH",
          violation.length,
        ),
      );
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
  };
};

// ラジオボタンのバリデーション
export const validateRadio = (
  question: Block,
  response: Extract<ResponseData, { question_type: "radio" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const { validation } = question;
  const { value, other_value } = response;

  // 必須チェック
  if (validation.required && !value) {
    errors.push(
      createValidationError(
        question.blockId,
        getValidationMessage("REQUIRED"),
        "REQUIRED",
      ),
    );
    return { is_valid: false, errors };
  }

  // 空の場合は他のバリデーションをスキップ
  if (!value) {
    return { is_valid: true, errors: [] };
  }

  // 選択肢の妥当性チェック
  if (isRadioValidation(validation)) {
    const validOptions = validation.options.map((opt) => opt.id);
    if (!validOptions.includes(value)) {
      // "その他"選択肢が許可されている場合は、"other"値を許可
      if (validation.allowOther && value === "other") {
        // "other"値は有効として扱う
      } else {
        errors.push(
          createValidationError(
            question.blockId,
            "無効な選択肢です",
            "INVALID_OPTION",
          ),
        );
      }
    }

    // その他の選択肢のチェック
    if (value === "other" && validation.allowOther) {
      if (!other_value || other_value.trim() === "") {
        errors.push(
          createValidationError(
            question.blockId,
            "その他の内容を入力してください",
            "OTHER_VALUE_REQUIRED",
          ),
        );
      }
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
  };
};

// チェックボックスのバリデーション
export const validateCheckbox = (
  question: Block,
  response: Extract<ResponseData, { question_type: "checkbox" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const { validation } = question;
  const { values, other_values } = response;

  // 必須チェック
  if (validation.required && (!values || values.length === 0)) {
    errors.push(
      createValidationError(
        question.blockId,
        getValidationMessage("REQUIRED"),
        "REQUIRED",
      ),
    );
    return { is_valid: false, errors };
  }

  // 空の場合は他のバリデーションをスキップ
  if (!values || values.length === 0) {
    return { is_valid: true, errors: [] };
  }

  // 選択肢の妥当性チェック
  if (isCheckboxValidation(validation)) {
    const validOptions = validation.options.map((opt) => opt.id);
    const invalidValues = values.filter((value) => {
      // "その他"選択肢が許可されている場合は、"other"値を許可
      if (validation.allowOther && value === "other") {
        return false; // "other"値は有効として扱う
      }
      return !validOptions.includes(value);
    });
    if (invalidValues.length > 0) {
      errors.push(
        createValidationError(
          question.blockId,
          "無効な選択肢が含まれています",
          "INVALID_OPTIONS",
        ),
      );
    }

    // 最小選択数チェック
    if (validation.minSelections && values.length < validation.minSelections) {
      errors.push(
        createValidationError(
          question.blockId,
          `${validation.minSelections}個以上選択してください`,
          "MIN_SELECTIONS",
          values.length,
        ),
      );
    }

    // 最大選択数チェック
    if (validation.maxSelections && values.length > validation.maxSelections) {
      errors.push(
        createValidationError(
          question.blockId,
          `${validation.maxSelections}個以下で選択してください`,
          "MAX_SELECTIONS",
          values.length,
        ),
      );
    }

    // その他の選択肢のチェック
    if (values.includes("other") && validation.allowOther) {
      if (!other_values || other_values.length === 0) {
        errors.push(
          createValidationError(
            question.blockId,
            "その他の内容を入力してください",
            "OTHER_VALUES_REQUIRED",
          ),
        );
      }
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
  };
};

// プルダウンのバリデーション
export const validateDropdown = (
  question: Block,
  response: Extract<ResponseData, { question_type: "dropdown" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const { validation } = question;
  const { value, other_value } = response;

  // 必須チェック
  if (validation.required && !value) {
    errors.push(
      createValidationError(
        question.blockId,
        getValidationMessage("REQUIRED"),
        "REQUIRED",
      ),
    );
    return { is_valid: false, errors };
  }

  // 空の場合は他のバリデーションをスキップ
  if (!value) {
    return { is_valid: true, errors: [] };
  }

  // 選択肢の妥当性チェック
  if (isDropdownValidation(validation)) {
    const validOptions = validation.options.map((opt) => opt.id);
    if (!validOptions.includes(value)) {
      // "その他"選択肢が許可されている場合は、"other"値を許可
      if (validation.allowOther && value === "other") {
        // "other"値は有効として扱う
      } else {
        errors.push(
          createValidationError(
            question.blockId,
            "無効な選択肢です",
            "INVALID_OPTION",
          ),
        );
      }
    }

    // その他の選択肢のチェック
    if (value === "other" && validation.allowOther) {
      if (!other_value || other_value.trim() === "") {
        errors.push(
          createValidationError(
            question.blockId,
            "その他の内容を入力してください",
            "OTHER_VALUE_REQUIRED",
          ),
        );
      }
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
  };
};

// 均等目盛のバリデーション
export const validateLinearScale = (
  question: Block,
  response: Extract<ResponseData, { question_type: "linear_scale" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const { validation } = question;
  const { value } = response;

  // 必須チェック
  if (validation.required && value === undefined) {
    errors.push(
      createValidationError(
        question.blockId,
        getValidationMessage("REQUIRED"),
        "REQUIRED",
      ),
    );
    return { is_valid: false, errors };
  }

  // 空の場合は他のバリデーションをスキップ
  if (value === undefined) {
    return { is_valid: true, errors: [] };
  }

  // 範囲チェック
  if (isLinearScaleValidation(validation)) {
    if (value < validation.min || value > validation.max) {
      errors.push(
        createValidationError(
          question.blockId,
          `${validation.min}から${validation.max}の範囲で選択してください`,
          "OUT_OF_RANGE",
          value,
        ),
      );
    }

    // ステップチェック
    const step = validation.step || 1;
    if ((value - validation.min) % step !== 0) {
      errors.push(
        createValidationError(
          question.blockId,
          "無効な値です",
          "INVALID_STEP",
          value,
        ),
      );
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
  };
};

// 評価のバリデーション
export const validateRating = (
  question: Block,
  response: Extract<ResponseData, { question_type: "rating" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const { validation } = question;
  const { value } = response;

  // 受け取った値は整数として扱う（小数は丸める）
  const normalizedValue =
    typeof value === "number"
      ? Number.parseInt(String(Math.round(value)), 10)
      : value;

  // 必須チェック
  if (validation.required && normalizedValue === undefined) {
    errors.push(
      createValidationError(
        question.blockId,
        getValidationMessage("REQUIRED"),
        "REQUIRED",
      ),
    );
    return { is_valid: false, errors };
  }

  // 空の場合は他のバリデーションをスキップ
  if (normalizedValue === undefined) {
    return { is_valid: true, errors: [] };
  }

  // 範囲チェック
  if (isRatingValidation(validation)) {
    if (normalizedValue < 1 || normalizedValue > validation.maxRating) {
      errors.push(
        createValidationError(
          question.blockId,
          `1から${validation.maxRating}の範囲で選択してください`,
          "OUT_OF_RANGE",
          normalizedValue,
        ),
      );
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
  };
};

// 選択式グリッドのバリデーション
export const validateChoiceGrid = (
  question: Block,
  response: Extract<ResponseData, { question_type: "choice_grid" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const { validation } = question;
  const { responses } = response;

  // 必須チェック
  if (
    validation.required &&
    (!responses || Object.keys(responses).length === 0)
  ) {
    errors.push(
      createValidationError(
        question.blockId,
        getValidationMessage("REQUIRED"),
        "REQUIRED",
      ),
    );
    return { is_valid: false, errors };
  }

  // 空の場合は他のバリデーションをスキップ
  if (!responses || Object.keys(responses).length === 0) {
    return { is_valid: true, errors: [] };
  }

  // 必須行のチェック（すべての行が回答されているか）
  if (validation.required && isChoiceGridValidation(validation)) {
    const answeredRows = Object.keys(responses);
    const allRows = validation.rows.map((row) => row.id);
    const missingRows = allRows.filter(
      (rowId) => !answeredRows.includes(rowId),
    );

    if (missingRows.length > 0) {
      errors.push(
        createValidationError(
          question.blockId,
          `必須の行が未回答です: ${missingRows.join(", ")}`,
          "MISSING_REQUIRED_ROWS",
          missingRows,
        ),
      );
    }
  }

  // 各行の回答チェック
  if (isChoiceGridValidation(validation)) {
    const validRows = validation.rows.map((row) => row.id);
    const validColumns = validation.columns.map((col) => col.id);

    for (const [rowId, columnId] of Object.entries(responses)) {
      if (!validRows.includes(rowId)) {
        errors.push(
          createValidationError(
            question.blockId,
            "無効な行が含まれています",
            "INVALID_ROW",
            rowId,
          ),
        );
      }
      if (!validColumns.includes(columnId)) {
        errors.push(
          createValidationError(
            question.blockId,
            "無効な列が含まれています",
            "INVALID_COLUMN",
            columnId,
          ),
        );
      }
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
  };
};

// チェックボックスグリッドのバリデーション
export const validateCheckboxGrid = (
  question: Block,
  response: Extract<ResponseData, { question_type: "checkbox_grid" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const { validation } = question;
  const { responses } = response;

  // 必須チェック
  if (
    validation.required &&
    (!responses || Object.keys(responses).length === 0)
  ) {
    errors.push(
      createValidationError(
        question.blockId,
        getValidationMessage("REQUIRED"),
        "REQUIRED",
      ),
    );
    return { is_valid: false, errors };
  }

  // 空の場合は他のバリデーションをスキップ
  if (!responses || Object.keys(responses).length === 0) {
    return { is_valid: true, errors: [] };
  }

  // 必須行のチェック（すべての行が回答されているか）
  if (validation.required && isCheckboxGridValidation(validation)) {
    const answeredRows = Object.keys(responses);
    const allRows = validation.rows.map((row) => row.id);
    const missingRows = allRows.filter(
      (rowId) => !answeredRows.includes(rowId),
    );

    if (missingRows.length > 0) {
      errors.push(
        createValidationError(
          question.blockId,
          `必須の行が未回答です: ${missingRows.join(", ")}`,
          "MISSING_REQUIRED_ROWS",
          missingRows,
        ),
      );
    }
  }

  // 各行の回答チェック
  if (isCheckboxGridValidation(validation)) {
    const validRows = validation.rows.map((row) => row.id);
    const validColumns = validation.columns.map((col) => col.id);

    for (const [rowId, columnIds] of Object.entries(responses)) {
      if (!validRows.includes(rowId)) {
        errors.push(
          createValidationError(
            question.blockId,
            "無効な行が含まれています",
            "INVALID_ROW",
            rowId,
          ),
        );
      }

      if (!Array.isArray(columnIds)) {
        errors.push(
          createValidationError(
            question.blockId,
            "列の選択が正しくありません",
            "INVALID_COLUMN_FORMAT",
            columnIds,
          ),
        );
        continue;
      }

      for (const columnId of columnIds) {
        if (!validColumns.includes(columnId)) {
          errors.push(
            createValidationError(
              question.blockId,
              "無効な列が含まれています",
              "INVALID_COLUMN",
              columnId,
            ),
          );
        }
      }

      // 最小選択数チェック
      if (
        validation.minSelectionsPerRow &&
        columnIds.length < validation.minSelectionsPerRow
      ) {
        errors.push(
          createValidationError(
            question.blockId,
            `各行で${validation.minSelectionsPerRow}個以上選択してください`,
            "MIN_SELECTIONS_PER_ROW",
            { rowId, count: columnIds.length },
          ),
        );
      }

      // 最大選択数チェック
      if (
        validation.maxSelectionsPerRow &&
        columnIds.length > validation.maxSelectionsPerRow
      ) {
        errors.push(
          createValidationError(
            question.blockId,
            `各行で${validation.maxSelectionsPerRow}個以下で選択してください`,
            "MAX_SELECTIONS_PER_ROW",
            { rowId, count: columnIds.length },
          ),
        );
      }
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
  };
};

// 日付のバリデーション
export const validateDate = (
  question: Block,
  response: Extract<ResponseData, { question_type: "date" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const { validation } = question;
  const { value } = response;

  // 必須チェック
  if (validation.required && isBlankResponseValue(value)) {
    errors.push(
      createValidationError(
        question.blockId,
        getValidationMessage("REQUIRED"),
        "REQUIRED",
      ),
    );
    return { is_valid: false, errors };
  }

  // 空の場合は他のバリデーションをスキップ
  if (isBlankResponseValue(value)) {
    return { is_valid: true, errors: [] };
  }

  // 日付フォーマット設定のバリデーション
  if (isDateValidation(validation)) {
    const allowedFormats = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"] as const;
    if (
      typeof validation.format !== "string" ||
      !allowedFormats.includes(
        validation.format as "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY",
      )
    ) {
      errors.push(
        createValidationError(
          question.blockId,
          "不正な日付フォーマットが指定されています",
          "INVALID_DATE_FORMAT_SETTING",
          validation.format,
        ),
      );
      return { is_valid: false, errors };
    }

    // 日付形式チェック（フォーマットに応じて解析）
    let date: Date;
    if (validation.format === "YYYY-MM-DD") {
      // ISO形式の場合はそのまま解析
      date = new Date(value);
    } else if (validation.format === "MM/DD/YYYY") {
      // MM/DD/YYYY形式の場合
      const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!match) {
        errors.push(
          createValidationError(
            question.blockId,
            "有効な日付を入力してください（MM/DD/YYYY形式）",
            "INVALID_DATE_FORMAT",
          ),
        );
        return { is_valid: false, errors };
      }
      const mmMonth = match[1] ?? "0";
      const mmDay = match[2] ?? "0";
      const mmYear = match[3] ?? "0";
      date = new Date(
        parseInt(mmYear, 10),
        parseInt(mmMonth, 10) - 1,
        parseInt(mmDay, 10),
      );
    } else if (validation.format === "DD/MM/YYYY") {
      // DD/MM/YYYY形式の場合
      const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!match) {
        errors.push(
          createValidationError(
            question.blockId,
            "有効な日付を入力してください（DD/MM/YYYY形式）",
            "INVALID_DATE_FORMAT",
          ),
        );
        return { is_valid: false, errors };
      }
      const ddDay = match[1] ?? "0";
      const ddMonth = match[2] ?? "0";
      const ddYear = match[3] ?? "0";
      date = new Date(
        parseInt(ddYear, 10),
        parseInt(ddMonth, 10) - 1,
        parseInt(ddDay, 10),
      );
    } else {
      // デフォルトはISO形式
      date = new Date(value);
    }

    if (Number.isNaN(date.getTime())) {
      errors.push(
        createValidationError(
          question.blockId,
          "有効な日付を入力してください",
          "INVALID_DATE_FORMAT",
        ),
      );
      return { is_valid: false, errors };
    }

    // 最小日付チェック
    if (validation.minDate) {
      const minDate = new Date(validation.minDate);
      if (date < minDate) {
        errors.push(
          createValidationError(
            question.blockId,
            `${validation.minDate}以降の日付を入力してください`,
            "DATE_TOO_EARLY",
            value,
          ),
        );
      }
    }

    // 最大日付チェック
    if (validation.maxDate) {
      const maxDate = new Date(validation.maxDate);
      if (date > maxDate) {
        errors.push(
          createValidationError(
            question.blockId,
            `${validation.maxDate}以前の日付を入力してください`,
            "DATE_TOO_LATE",
            value,
          ),
        );
      }
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
  };
};

// 時刻のバリデーション
export const validateTime = (
  question: Block,
  response: Extract<ResponseData, { question_type: "time" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const { validation } = question;
  const { value } = response;

  // 必須チェック
  if (validation.required && isBlankResponseValue(value)) {
    errors.push(
      createValidationError(
        question.blockId,
        getValidationMessage("REQUIRED"),
        "REQUIRED",
      ),
    );
    return { is_valid: false, errors };
  }

  // 空の場合は他のバリデーションをスキップ
  if (isBlankResponseValue(value)) {
    return { is_valid: true, errors: [] };
  }

  // 時刻フォーマット設定のバリデーション
  if (isTimeValidation(validation)) {
    const allowedFormats = ["24h", "12h"] as const;
    if (
      typeof validation.format !== "string" ||
      !allowedFormats.includes(validation.format as "24h" | "12h")
    ) {
      errors.push(
        createValidationError(
          question.blockId,
          "不正な時刻フォーマットが指定されています",
          "INVALID_TIME_FORMAT_SETTING",
          validation.format,
        ),
      );
      return { is_valid: false, errors };
    }

    // 時刻形式チェック（12時間制と24時間制に対応）
    const is24Hour = validation.format === "24h";
    const timeRegex = is24Hour
      ? /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/
      : /^(0?[1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM)$/i;

    if (!timeRegex.test(value)) {
      const formatMessage = is24Hour
        ? "有効な時刻を入力してください（HH:MM形式）"
        : "有効な時刻を入力してください（HH:MM AM/PM形式）";
      errors.push(
        createValidationError(
          question.blockId,
          formatMessage,
          "INVALID_TIME_FORMAT",
        ),
      );
      return { is_valid: false, errors };
    }

    // 時刻を分単位に変換するヘルパー関数（12時間制と24時間制に対応）
    const timeToMinutes = (timeStr: string): number => {
      if (is24Hour) {
        const parts = timeStr.split(":").map(Number);
        const hours = parts[0] ?? 0;
        const minutes = parts[1] ?? 0;
        return hours * 60 + minutes;
      } else {
        // 12時間制の場合: "2:30 PM" -> [2, 30, "PM"]
        const match = timeStr.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/i);
        if (!match) return 0;

        const matchedHours = match[1];
        const matchedMinutes = match[2];
        const matchedPeriod = match[3];
        if (!matchedHours || !matchedMinutes || !matchedPeriod) return 0;

        let hours = parseInt(matchedHours, 10);
        const minutes = parseInt(matchedMinutes, 10);
        const period = matchedPeriod.toUpperCase();

        // AM/PMの変換
        if (period === "AM" && hours === 12) hours = 0;
        if (period === "PM" && hours !== 12) hours += 12;

        return hours * 60 + minutes;
      }
    };

    // 最小時刻チェック
    if (validation.minTime) {
      const valueMinutes = timeToMinutes(value);
      const minMinutes = timeToMinutes(validation.minTime);
      if (valueMinutes < minMinutes) {
        errors.push(
          createValidationError(
            question.blockId,
            `${validation.minTime}以降の時刻を入力してください`,
            "TIME_TOO_EARLY",
            value,
          ),
        );
      }
    }

    // 最大時刻チェック
    if (validation.maxTime) {
      const valueMinutes = timeToMinutes(value);
      const maxMinutes = timeToMinutes(validation.maxTime);
      if (valueMinutes > maxMinutes) {
        errors.push(
          createValidationError(
            question.blockId,
            `${validation.maxTime}以前の時刻を入力してください`,
            "TIME_TOO_LATE",
            value,
          ),
        );
      }
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
  };
};

// 質問タイプ別バリデーターのマッピング
export const questionValidators = {
  short_text: validateShortText,
  long_text: validateLongText,
  radio: validateRadio,
  checkbox: validateCheckbox,
  dropdown: validateDropdown,
  linear_scale: validateLinearScale,
  rating: validateRating,
  choice_grid: validateChoiceGrid,
  checkbox_grid: validateCheckboxGrid,
  date: validateDate,
  time: validateTime,
} as const;

// 汎用バリデーション関数
export const validateQuestion = (
  question: Block,
  response: ResponseData,
): ValidationResult => {
  const validator =
    questionValidators[question.type as keyof typeof questionValidators];
  if (!validator) {
    return {
      is_valid: false,
      errors: [
        createValidationError(
          question.blockId,
          `未対応の質問タイプです: ${question.type}`,
          "UNSUPPORTED_QUESTION_TYPE",
        ),
      ],
    };
  }

  type GenericValidator = (
    question: Block,
    response: ResponseData,
  ) => ValidationResult;
  return (validator as GenericValidator)(question, response);
};
