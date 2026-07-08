import {
  type ExtractedQuestion,
  getTextLengthViolations,
  isBlankResponseValue,
  isBlockType,
  normalizePatternMismatchMode,
  parseFiniteResponseNumber,
  type ShortTextCompatibleValidationConfigInput as ShortTextCompatibleValidation,
  textMatchesPattern,
} from "@nexus-form/shared";
import { getPatternTemplate } from "@/lib/constants/validation-patterns";
import { logWarn } from "@/lib/logger";
import { isValidEmail } from "@/lib/validation/email";
import { getValidationMessage } from "@/lib/validation-messages";
import {
  type Block,
  QuestionValidation as QuestionValidationSchema,
} from "@/types/domain/form-block";
import type {
  ValidationError,
  ValidationResult,
} from "@/types/domain/validation";

export interface AnswerLike {
  value?: unknown;
  values?: unknown[];
  responses?: Record<string, unknown>;
  other_value?: unknown;
  other_values?: unknown[];
}

type ValidatableQuestion = Pick<
  Block,
  "blockId" | "type" | "title" | "validation"
>;

type QuestionResponseData =
  | { question_type: "short_text"; value?: unknown }
  | { question_type: "long_text"; value?: unknown }
  | { question_type: "radio"; value?: string; other_value?: string }
  | { question_type: "checkbox"; values?: string[]; other_values?: string[] }
  | { question_type: "dropdown"; value?: string; other_value?: string }
  | { question_type: "linear_scale"; value?: number }
  | { question_type: "rating"; value?: number }
  | { question_type: "choice_grid"; responses?: Record<string, string> }
  | { question_type: "checkbox_grid"; responses?: Record<string, string[]> }
  | { question_type: "date"; value?: unknown }
  | { question_type: "time"; value?: unknown };

type AnswerableQuestionType = Exclude<Block["type"], "section_separator">;

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

function isOpenEndedQuantifier(pattern: string, index: number): boolean {
  const endIndex = pattern.indexOf("}", index + 1);
  if (endIndex === -1) return true;
  return pattern.slice(index + 1, endIndex).includes(",");
}

function isEscapedRegexCharacter(pattern: string, index: number): boolean {
  let slashCount = 0;
  for (
    let slashIndex = index - 1;
    slashIndex >= 0 && pattern[slashIndex] === "\\";
    slashIndex -= 1
  ) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function hasNestedQuantifier(pattern: string): boolean {
  let inCharacterClass = false;
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (isEscapedRegexCharacter(pattern, index)) continue;
    if (char === "[") {
      inCharacterClass = true;
      continue;
    }
    if (char === "]") {
      inCharacterClass = false;
      continue;
    }
    if (inCharacterClass || char !== "(") continue;

    let depth = 1;
    let hasInnerQuantifier = false;
    for (
      let groupIndex = index + 1;
      groupIndex < pattern.length;
      groupIndex += 1
    ) {
      const groupChar = pattern[groupIndex];
      const groupPrevious = pattern[groupIndex - 1];
      if (groupChar === undefined) continue;
      if (isEscapedRegexCharacter(pattern, groupIndex)) continue;
      if (groupChar === "[") {
        inCharacterClass = true;
        continue;
      }
      if (groupChar === "]") {
        inCharacterClass = false;
        continue;
      }
      if (inCharacterClass) continue;
      if (
        ["+", "*"].includes(groupChar) ||
        (groupChar === "{" && isOpenEndedQuantifier(pattern, groupIndex)) ||
        (groupChar === "?" && groupPrevious !== "(")
      ) {
        hasInnerQuantifier = true;
      }
      if (groupChar === "(") depth += 1;
      if (groupChar !== ")") continue;
      depth -= 1;
      if (depth > 0) continue;
      const nextChar = pattern[groupIndex + 1];
      if (
        hasInnerQuantifier &&
        (nextChar === "+" || nextChar === "*" || nextChar === "{")
      ) {
        return true;
      }
      break;
    }
  }
  return false;
}

function isSafeRegexPattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
  } catch (error) {
    logWarn(
      "Invalid short text validation regex; skipping pattern check",
      "form-validation",
      {
        pattern,
        error,
      },
    );
    return false;
  }
  if (hasNestedQuantifier(pattern)) {
    logWarn(
      "Unsafe short text validation regex; skipping pattern check",
      "form-validation",
      { pattern },
    );
    return false;
  }
  return true;
}

function safelyTextMatchesPattern(value: string, pattern: string): boolean {
  if (!isSafeRegexPattern(pattern)) {
    return true;
  }
  return textMatchesPattern(value, pattern);
}

function getPatternMismatchMessage(
  validation: ShortTextCompatibleValidation | undefined,
): string {
  if (!validation?.patternTemplate) {
    return "入力形式が正しくありません";
  }
  return (
    getPatternTemplate(validation.patternTemplate)?.errorMessage ??
    "入力形式が正しくありません"
  );
}

function validateShortTextCompatibleValue(
  field: string,
  value: string,
  validation: ShortTextCompatibleValidation | undefined,
): Pick<ValidationResult, "errors" | "warnings"> {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  if (!validation || isBlankResponseValue(value)) {
    return { errors, warnings };
  }

  for (const violation of getTextLengthViolations(value, validation)) {
    if (violation.code === "MIN_LENGTH") {
      errors.push(
        createValidationError(
          field,
          `${violation.limit}文字以上で入力してください`,
          "MIN_LENGTH",
          violation.length,
        ),
      );
    }
    if (violation.code === "MAX_LENGTH") {
      errors.push(
        createValidationError(
          field,
          `${violation.limit}文字以下で入力してください`,
          "MAX_LENGTH",
          violation.length,
        ),
      );
    }
  }

  if (
    validation.pattern &&
    !safelyTextMatchesPattern(value, validation.pattern)
  ) {
    const patternMismatch = createValidationError(
      field,
      getPatternMismatchMessage(validation),
      "PATTERN_MISMATCH",
    );
    const mismatchMode = normalizePatternMismatchMode(validation);
    if (mismatchMode === "warn") {
      warnings.push(patternMismatch);
    } else if (mismatchMode === "block") {
      errors.push(patternMismatch);
    }
  }

  return { errors, warnings };
}

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
  question: ValidatableQuestion,
  response: Extract<QuestionResponseData, { question_type: "short_text" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
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

  if (typeof value !== "string") {
    errors.push(
      createValidationError(
        question.blockId,
        "入力形式が正しくありません",
        "INVALID_VALUE_TYPE",
        value,
      ),
    );
    return { is_valid: false, errors };
  }

  const textResult = validateShortTextCompatibleValue(
    question.blockId,
    value,
    shortTextValidation,
  );
  errors.push(...textResult.errors);
  warnings.push(...(textResult.warnings ?? []));

  if (requiresEmailFormat && !isValidEmail(value)) {
    const emailInvalid = createValidationError(
      question.blockId,
      template?.errorMessage ?? "有効なメールアドレスを入力してください",
      "EMAIL_INVALID",
    );
    const mismatchMode = normalizePatternMismatchMode(shortTextValidation);
    if (mismatchMode === "warn") {
      warnings.push(emailInvalid);
    } else if (!shortTextValidation?.allowPatternMismatch) {
      errors.push(emailInvalid);
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
};

// 長文入力のバリデーション
export const validateLongText = (
  question: ValidatableQuestion,
  response: Extract<QuestionResponseData, { question_type: "long_text" }>,
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

  if (typeof value !== "string") {
    errors.push(
      createValidationError(
        question.blockId,
        "入力形式が正しくありません",
        "INVALID_VALUE_TYPE",
        value,
      ),
    );
    return { is_valid: false, errors };
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
  question: ValidatableQuestion,
  response: Extract<QuestionResponseData, { question_type: "radio" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
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
      } else {
        const otherResult = validateShortTextCompatibleValue(
          question.blockId,
          other_value,
          validation.otherTextValidation,
        );
        errors.push(...otherResult.errors);
        warnings.push(...(otherResult.warnings ?? []));
      }
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
};

// チェックボックスのバリデーション
export const validateCheckbox = (
  question: ValidatableQuestion,
  response: Extract<QuestionResponseData, { question_type: "checkbox" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
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
      if (
        !other_values ||
        other_values.length === 0 ||
        other_values.every((otherValue) => otherValue.trim() === "")
      ) {
        errors.push(
          createValidationError(
            question.blockId,
            "その他の内容を入力してください",
            "OTHER_VALUES_REQUIRED",
          ),
        );
      } else {
        for (const otherValue of other_values) {
          if (otherValue.trim() === "") continue;
          const otherResult = validateShortTextCompatibleValue(
            question.blockId,
            otherValue,
            validation.otherTextValidation,
          );
          errors.push(...otherResult.errors);
          warnings.push(...(otherResult.warnings ?? []));
        }
      }
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
};

// プルダウンのバリデーション
export const validateDropdown = (
  question: ValidatableQuestion,
  response: Extract<QuestionResponseData, { question_type: "dropdown" }>,
): ValidationResult => {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
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
      } else {
        const otherResult = validateShortTextCompatibleValue(
          question.blockId,
          other_value,
          validation.otherTextValidation,
        );
        errors.push(...otherResult.errors);
        warnings.push(...(otherResult.warnings ?? []));
      }
    }
  }

  return {
    is_valid: errors.length === 0,
    errors,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
};

// 均等目盛のバリデーション
export const validateLinearScale = (
  question: ValidatableQuestion,
  response: Extract<QuestionResponseData, { question_type: "linear_scale" }>,
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
  question: ValidatableQuestion,
  response: Extract<QuestionResponseData, { question_type: "rating" }>,
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
  question: ValidatableQuestion,
  response: Extract<QuestionResponseData, { question_type: "choice_grid" }>,
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
  question: ValidatableQuestion,
  response: Extract<QuestionResponseData, { question_type: "checkbox_grid" }>,
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
  question: ValidatableQuestion,
  response: Extract<QuestionResponseData, { question_type: "date" }>,
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

  if (typeof value !== "string") {
    errors.push(
      createValidationError(
        question.blockId,
        "入力形式が正しくありません",
        "INVALID_VALUE_TYPE",
        value,
      ),
    );
    return { is_valid: false, errors };
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
  question: ValidatableQuestion,
  response: Extract<QuestionResponseData, { question_type: "time" }>,
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

  if (typeof value !== "string") {
    errors.push(
      createValidationError(
        question.blockId,
        "入力形式が正しくありません",
        "INVALID_VALUE_TYPE",
        value,
      ),
    );
    return { is_valid: false, errors };
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
  question: ValidatableQuestion,
  response: QuestionResponseData,
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
    question: ValidatableQuestion,
    response: QuestionResponseData,
  ) => ValidationResult;
  return (validator as GenericValidator)(question, response);
};

function isAnswerableQuestionType(
  type: string,
): type is AnswerableQuestionType {
  return isBlockType(type) && type !== "section_separator";
}

function getStringArray(values: unknown[] | undefined): string[] | undefined {
  if (!values) return undefined;
  return values.filter((value) => typeof value === "string");
}

function getStringRecord(
  responses: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (!responses) return undefined;

  const record: Record<string, string> = {};
  for (const [rowId, value] of Object.entries(responses)) {
    if (typeof value === "string") {
      record[rowId] = value;
    }
  }
  return record;
}

function getStringArrayRecord(
  responses: Record<string, unknown> | undefined,
): Record<string, string[]> | undefined {
  if (!responses) return undefined;

  const record: Record<string, string[]> = {};
  for (const [rowId, value] of Object.entries(responses)) {
    if (Array.isArray(value)) {
      record[rowId] = value.filter((entry) => typeof entry === "string");
    }
  }
  return record;
}

function getNumberValue(value: unknown): number | undefined {
  if (isBlankResponseValue(value)) return undefined;
  return parseFiniteResponseNumber(value) ?? undefined;
}

function createInvalidResponseValueError(questionId: string): ValidationError {
  return createValidationError(
    questionId,
    "回答データの形式が正しくありません",
    "INVALID_RESPONSE_VALUE",
  );
}

function hasInvalidStringArrayValues(values: unknown[] | undefined): boolean {
  return values?.some((value) => typeof value !== "string") ?? false;
}

function hasInvalidChoiceGridResponses(
  responses: Record<string, unknown> | undefined,
): boolean {
  if (!responses) return false;
  return Object.values(responses).some((value) => typeof value !== "string");
}

function hasInvalidCheckboxGridResponses(
  responses: Record<string, unknown> | undefined,
): boolean {
  if (!responses) return false;
  return Object.values(responses).some(
    (value) =>
      !Array.isArray(value) || value.some((entry) => typeof entry !== "string"),
  );
}

function hasInvalidNumberValue(value: unknown): boolean {
  return (
    !isBlankResponseValue(value) && parseFiniteResponseNumber(value) == null
  );
}

function getInvalidAnswerShapeErrors(
  questionType: AnswerableQuestionType,
  questionId: string,
  answer: AnswerLike | undefined,
): ValidationError[] {
  if (!answer) return [];

  switch (questionType) {
    case "radio":
    case "dropdown":
      if (
        !isBlankResponseValue(answer.value) &&
        typeof answer.value !== "string"
      ) {
        return [createInvalidResponseValueError(questionId)];
      }
      if (
        answer.other_value !== undefined &&
        typeof answer.other_value !== "string"
      ) {
        return [createInvalidResponseValueError(questionId)];
      }
      return [];
    case "checkbox":
      if (
        hasInvalidStringArrayValues(answer.values) ||
        hasInvalidStringArrayValues(answer.other_values)
      ) {
        return [createInvalidResponseValueError(questionId)];
      }
      return [];
    case "linear_scale":
    case "rating":
      if (hasInvalidNumberValue(answer.value)) {
        return [createInvalidResponseValueError(questionId)];
      }
      return [];
    case "choice_grid":
      if (hasInvalidChoiceGridResponses(answer.responses)) {
        return [createInvalidResponseValueError(questionId)];
      }
      return [];
    case "checkbox_grid":
      if (hasInvalidCheckboxGridResponses(answer.responses)) {
        return [createInvalidResponseValueError(questionId)];
      }
      return [];
    case "short_text":
    case "long_text":
    case "date":
    case "time":
      return [];
  }
}

function buildQuestionResponse(
  questionType: AnswerableQuestionType,
  answer: AnswerLike | undefined,
): QuestionResponseData {
  switch (questionType) {
    case "short_text":
      return { question_type: "short_text", value: answer?.value };
    case "long_text":
      return { question_type: "long_text", value: answer?.value };
    case "radio":
      return {
        question_type: "radio",
        value: typeof answer?.value === "string" ? answer.value : undefined,
        other_value:
          typeof answer?.other_value === "string"
            ? answer.other_value
            : undefined,
      };
    case "checkbox":
      return {
        question_type: "checkbox",
        values: getStringArray(answer?.values),
        other_values: getStringArray(answer?.other_values),
      };
    case "dropdown":
      return {
        question_type: "dropdown",
        value: typeof answer?.value === "string" ? answer.value : undefined,
        other_value:
          typeof answer?.other_value === "string"
            ? answer.other_value
            : undefined,
      };
    case "linear_scale":
      return {
        question_type: "linear_scale",
        value: getNumberValue(answer?.value),
      };
    case "rating":
      return {
        question_type: "rating",
        value: getNumberValue(answer?.value),
      };
    case "choice_grid":
      return {
        question_type: "choice_grid",
        responses: getStringRecord(answer?.responses),
      };
    case "checkbox_grid":
      return {
        question_type: "checkbox_grid",
        responses: getStringArrayRecord(answer?.responses),
      };
    case "date":
      return { question_type: "date", value: answer?.value };
    case "time":
      return { question_type: "time", value: answer?.value };
  }
}

export const validateExtractedQuestionAnswer = (
  question: ExtractedQuestion,
  answer: AnswerLike | undefined,
): ValidationResult => {
  if (!isAnswerableQuestionType(question.type)) {
    return { is_valid: true, errors: [] };
  }

  const shapeErrors = getInvalidAnswerShapeErrors(
    question.type,
    question.blockId,
    answer,
  );
  if (shapeErrors.length > 0) {
    return { is_valid: false, errors: shapeErrors };
  }

  const validationResult = QuestionValidationSchema.safeParse({
    ...question.validation,
    type: question.type,
  });
  if (!validationResult.success) {
    return {
      is_valid: false,
      errors: [
        createValidationError(
          question.blockId,
          "質問設定が正しくありません",
          "INVALID_QUESTION_VALIDATION",
        ),
      ],
    };
  }

  return validateQuestion(
    {
      blockId: question.blockId,
      title: question.title,
      type: question.type,
      validation: validationResult.data,
    },
    buildQuestionResponse(question.type, answer),
  );
};
