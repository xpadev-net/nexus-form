import { PATTERN_MISMATCH_MODES } from "@nexus-form/shared";
import type { Block, BlockType } from "../../types/domain/form-block";
import {
  MIN_OPTIONS_COUNT,
  MIN_QUESTIONS_COUNT,
} from "../constants/validation";

// 選択肢型の質問タイプの定数
const CHOICE_QUESTION_TYPES = ["radio", "checkbox", "dropdown"] as const;

// チェックボックスの最小選択肢数
const MIN_CHECKBOX_OPTIONS_COUNT = 1;

// 質問タイプが選択肢型かどうかを判定する型ガード
export const isChoiceQuestion = (
  type: BlockType,
): type is "radio" | "checkbox" | "dropdown" => {
  return (CHOICE_QUESTION_TYPES as ReadonlyArray<BlockType>).includes(type);
};

// 選択肢型の質問のバリデーション設定の型
interface ChoiceValidation {
  options?: Array<{ id: string; label: string; value: string }>;
}

// グリッド型の質問のバリデーション設定の型
interface GridValidation {
  rows?: Array<{ id: string; label: string }>;
  columns?: Array<{ id: string; label: string }>;
}

interface PatternValidation {
  patternMismatchMode?: unknown;
  otherTextValidation?: {
    patternMismatchMode?: unknown;
  };
}

// グリッド型の質問タイプの定数
const GRID_QUESTION_TYPES = ["choice_grid", "checkbox_grid"] as const;

// 選択肢型の質問のバリデーション設定を取得する型ガード
export const getChoiceValidation = (
  question: Block,
): ChoiceValidation | null => {
  if (!isChoiceQuestion(question.type)) {
    return null;
  }

  return question.validation as ChoiceValidation;
};

// 選択肢型の質問が有効な選択肢を持っているかチェック
export const hasValidOptions = (question: Block): boolean => {
  const validation = getChoiceValidation(question);
  const minCount =
    question.type === "checkbox"
      ? MIN_CHECKBOX_OPTIONS_COUNT
      : MIN_OPTIONS_COUNT;
  return validation?.options ? validation.options.length >= minCount : false;
};

// 質問のタイトルが空かどうかチェック
export const hasEmptyTitle = (question: Block): boolean => {
  return !question.title?.trim();
};

// フォーム全体のバリデーション結果の型
export interface FormValidationResult {
  isValid: boolean;
  errors: string[];
}

// フォームの基本バリデーション
export const validateFormBasic = (
  title: string,
  questions: Block[],
): FormValidationResult => {
  const errors: string[] = [];

  if (!title.trim()) {
    errors.push("フォームのタイトルは必須です。");
  }

  if (questions.length < MIN_QUESTIONS_COUNT) {
    errors.push("フォームには最低1つの質問が必要です。");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

// 質問のバリデーション
export const validateQuestions = (questions: Block[]): FormValidationResult => {
  const errors: string[] = [];

  // 質問のタイトルが空の場合のチェック
  const emptyTitleQuestions = questions.filter(hasEmptyTitle);
  if (emptyTitleQuestions.length > 0) {
    errors.push("すべての質問にタイトルを入力してください。");
  }

  // 選択肢型の質問で選択肢が不足している場合のチェック
  const invalidChoiceQuestions = questions.filter((q) => {
    if (isChoiceQuestion(q.type)) {
      return !hasValidOptions(q);
    }
    return false;
  });

  const invalidCheckboxQuestions = invalidChoiceQuestions.filter(
    (q) => q.type === "checkbox",
  );
  const invalidOtherChoiceQuestions = invalidChoiceQuestions.filter(
    (q) => q.type !== "checkbox",
  );

  if (invalidCheckboxQuestions.length > 0) {
    errors.push("チェックボックスの質問には最低1つの選択肢が必要です。");
  }
  if (invalidOtherChoiceQuestions.length > 0) {
    errors.push("選択肢型の質問には最低2つの選択肢が必要です。");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

// フォーム全体のバリデーション
export const validateForm = (
  title: string,
  questions: Block[],
): FormValidationResult => {
  const basicValidation = validateFormBasic(title, questions);
  const questionValidation = validateQuestions(questions);

  const allErrors = [...basicValidation.errors, ...questionValidation.errors];

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
  };
};

// Blockがグリッド型かどうかを判定
export const isGridQuestion = (
  type: BlockType,
): type is "choice_grid" | "checkbox_grid" => {
  return (GRID_QUESTION_TYPES as ReadonlyArray<BlockType>).includes(type);
};

// 選択肢型ブロックに空ラベルのオプションがあるかチェック
export const hasEmptyOptionLabels = (block: Block): boolean => {
  if (!isChoiceQuestion(block.type)) {
    return false;
  }
  const validation = block.validation as ChoiceValidation;
  if (!validation?.options) {
    return false;
  }
  return validation.options.some((option) => !option.label.trim());
};

// グリッド型ブロックに空ラベルの行・列があるかチェック
export const hasEmptyGridLabels = (block: Block): boolean => {
  if (!isGridQuestion(block.type)) {
    return false;
  }
  const validation = block.validation as GridValidation;
  if (!validation) {
    return false;
  }
  const hasEmptyRow =
    validation.rows?.some((row) => !row.label.trim()) ?? false;
  const hasEmptyCol =
    validation.columns?.some((col) => !col.label.trim()) ?? false;
  return hasEmptyRow || hasEmptyCol;
};

function hasInvalidPatternMismatchModeValue(value: unknown): boolean {
  return (
    value !== undefined &&
    !PATTERN_MISMATCH_MODES.includes(
      value as (typeof PATTERN_MISMATCH_MODES)[number],
    )
  );
}

export const hasInvalidPatternMismatchMode = (block: Block): boolean => {
  const validation = block.validation as PatternValidation | undefined;
  if (!validation) return false;
  return (
    hasInvalidPatternMismatchModeValue(validation.patternMismatchMode) ||
    hasInvalidPatternMismatchModeValue(
      validation.otherTextValidation?.patternMismatchMode,
    )
  );
};

// ===== Block版のバリデーション関数（新規追加） =====

// Blockのタイトルが空かどうかチェック
export const hasEmptyBlockTitle = (block: Block): boolean => {
  return !block.title.trim();
};

// Blockが選択肢型かどうかを判定
export const isChoiceBlock = (block: Block): boolean => {
  return isChoiceQuestion(block.type);
};

// Blockの選択肢型バリデーション設定を取得
export const getChoiceBlockValidation = (
  block: Block,
): ChoiceValidation | null => {
  if (!isChoiceBlock(block)) {
    return null;
  }

  return block.validation as ChoiceValidation;
};

// Blockが有効な選択肢を持っているかチェック
export const hasValidBlockOptions = (block: Block): boolean => {
  const validation = getChoiceBlockValidation(block);
  const minCount =
    block.type === "checkbox" ? MIN_CHECKBOX_OPTIONS_COUNT : MIN_OPTIONS_COUNT;
  return validation?.options ? validation.options.length >= minCount : false;
};

// Block配列のバリデーション
export const validateBlocks = (blocks: Block[]): FormValidationResult => {
  const errors: string[] = [];

  // 削除されていないブロックのみを対象
  const activeBlocks = blocks.filter((block) => !block.isDeleted);

  const emptyTitleBlocks = activeBlocks.filter((block) =>
    hasEmptyBlockTitle(block),
  );
  if (emptyTitleBlocks.length > 0) {
    errors.push("すべてのブロックにタイトルを入力してください。");
  }

  // 選択肢型のブロックで選択肢が不足している場合のチェック
  const invalidChoiceBlocks = activeBlocks.filter((block) => {
    if (isChoiceBlock(block)) {
      return !hasValidBlockOptions(block);
    }
    return false;
  });

  const invalidCheckboxBlocks = invalidChoiceBlocks.filter(
    (b) => b.type === "checkbox",
  );
  const invalidOtherChoiceBlocks = invalidChoiceBlocks.filter(
    (b) => b.type !== "checkbox",
  );

  if (invalidCheckboxBlocks.length > 0) {
    errors.push("チェックボックスのブロックには最低1つの選択肢が必要です。");
  }
  if (invalidOtherChoiceBlocks.length > 0) {
    errors.push("選択肢型のブロックには最低2つの選択肢が必要です。");
  }

  // 選択肢型ブロックで空ラベルのオプションがある場合のチェック（数不足のブロックは除外）
  const emptyOptionLabelBlocks = activeBlocks.filter(
    (block) =>
      !invalidChoiceBlocks.includes(block) && hasEmptyOptionLabels(block),
  );
  if (emptyOptionLabelBlocks.length > 0) {
    errors.push(
      "選択肢のラベルが空のブロックがあります。すべての選択肢にラベルを入力してください。",
    );
  }

  // グリッド型ブロックで行・列が不足している場合のチェック
  const invalidGridBlocks = activeBlocks.filter((block) => {
    if (!isGridQuestion(block.type)) return false;
    const validation = block.validation as GridValidation;
    const minCols = block.type === "choice_grid" ? 2 : 1;
    return (
      !validation?.rows?.length || (validation.columns?.length ?? 0) < minCols
    );
  });
  if (invalidGridBlocks.length > 0) {
    errors.push("グリッド型のブロックには最低1つの行と必要数の列が必要です。");
  }

  // グリッド型ブロックで空ラベルの行・列がある場合のチェック（数不足のブロックは除外）
  const emptyGridLabelBlocks = activeBlocks.filter(
    (block) => !invalidGridBlocks.includes(block) && hasEmptyGridLabels(block),
  );
  if (emptyGridLabelBlocks.length > 0) {
    errors.push(
      "グリッドの行または列のラベルが空のブロックがあります。すべての行・列にラベルを入力してください。",
    );
  }

  const invalidPatternModeBlocks = activeBlocks.filter(
    hasInvalidPatternMismatchMode,
  );
  if (invalidPatternModeBlocks.length > 0) {
    errors.push("入力パターンの不一致時の動作が不正なブロックがあります。");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

// Block版のフォーム基本バリデーション
export const validateBlockFormBasic = (
  title: string,
  blocks: Block[],
): FormValidationResult => {
  const errors: string[] = [];

  if (!title.trim()) {
    errors.push("フォームのタイトルは必須です。");
  }

  const activeBlocks = blocks.filter((block) => !block.isDeleted);
  if (activeBlocks.length < MIN_QUESTIONS_COUNT) {
    errors.push("フォームには最低1つのブロックが必要です。");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

// Block版のフォーム全体バリデーション
export const validateBlockForm = (
  title: string,
  blocks: Block[],
): FormValidationResult => {
  const basicValidation = validateBlockFormBasic(title, blocks);
  const blockValidation = validateBlocks(blocks);

  const allErrors = [...basicValidation.errors, ...blockValidation.errors];

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
  };
};
