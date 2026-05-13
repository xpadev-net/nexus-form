import type {
  Block,
  BlockType,
  QuestionValidation,
} from "@/types/domain/form-block";

// 定数定義
const TEXT_LIMITS = {
  SHORT_TEXT_MAX_LENGTH: 100,
  LONG_TEXT_MAX_LENGTH: 1000,
  MIN_LENGTH: 1,
} as const;

const RATING_DEFAULTS = {
  MAX_RATING: 5,
  LINEAR_SCALE_MIN: 1,
  LINEAR_SCALE_MAX: 5,
  LINEAR_SCALE_STEP: 1,
} as const;

/**
 * デフォルトの選択肢オプションを生成
 */
function createDefaultOptions() {
  return [
    { id: "option-1", label: "選択肢1" },
    { id: "option-2", label: "選択肢2" },
  ];
}

/**
 * デフォルトのグリッド行を生成
 */
function createDefaultGridRows() {
  return [{ id: "row-1", label: "行1" }];
}

/**
 * デフォルトのグリッド列を生成
 */
function createDefaultGridColumns() {
  return [
    { id: "col-1", label: "列1" },
    { id: "col-2", label: "列2" },
  ];
}

/**
 * 質問タイプに応じたデフォルトのバリデーション設定を作成
 */
export function createValidationForType(
  type: BlockType,
  isRequired: boolean,
): QuestionValidation {
  const baseValidation = { required: isRequired };

  switch (type) {
    case "short_text":
      return {
        ...baseValidation,
        type: "short_text",
        maxLength: TEXT_LIMITS.SHORT_TEXT_MAX_LENGTH,
        minLength: TEXT_LIMITS.MIN_LENGTH,
        allowPatternMismatch: false,
      };

    case "long_text":
      return {
        ...baseValidation,
        type: "long_text",
        maxLength: TEXT_LIMITS.LONG_TEXT_MAX_LENGTH,
        minLength: TEXT_LIMITS.MIN_LENGTH,
      };

    case "radio":
      return {
        ...baseValidation,
        type: "radio",
        options: createDefaultOptions(),
        allowOther: false,
      };

    case "checkbox":
      return {
        ...baseValidation,
        type: "checkbox",
        options: createDefaultOptions(),
        allowOther: false,
      };

    case "dropdown":
      return {
        ...baseValidation,
        type: "dropdown",
        options: createDefaultOptions(),
        allowOther: false,
      };

    case "linear_scale":
      return {
        ...baseValidation,
        type: "linear_scale",
        min: RATING_DEFAULTS.LINEAR_SCALE_MIN,
        max: RATING_DEFAULTS.LINEAR_SCALE_MAX,
        minLabel: "最低",
        maxLabel: "最高",
        step: RATING_DEFAULTS.LINEAR_SCALE_STEP,
      };

    case "rating":
      return {
        ...baseValidation,
        type: "rating",
        maxRating: RATING_DEFAULTS.MAX_RATING,
        icon: "star",
      };

    case "choice_grid":
      return {
        ...baseValidation,
        type: "choice_grid",
        rows: createDefaultGridRows(),
        columns: createDefaultGridColumns(),
      };

    case "checkbox_grid":
      return {
        ...baseValidation,
        type: "checkbox_grid",
        rows: createDefaultGridRows(),
        columns: createDefaultGridColumns(),
      };

    case "date":
      return {
        ...baseValidation,
        type: "date",
        format: "YYYY-MM-DD",
      };

    case "time":
      return {
        ...baseValidation,
        type: "time",
        format: "24h",
      };

    case "section_separator":
      return {
        ...baseValidation,
        type: "section_separator",
      };

    default:
      throw new Error(`Unsupported question type: ${type}`);
  }
}

/**
 * 質問タイプの表示名を取得（内部関数）
 */
function getQuestionTypeDisplayName(type: BlockType): string {
  const typeNames: Record<BlockType, string> = {
    short_text: "短文入力",
    long_text: "長文入力",
    radio: "ラジオボタン",
    checkbox: "チェックボックス",
    dropdown: "プルダウン",
    linear_scale: "均等目盛",
    rating: "評価",
    choice_grid: "選択式グリッド",
    checkbox_grid: "チェックボックスグリッド",
    date: "日付",
    time: "時刻",
    section_separator: "セクションヘッダー",
  };
  return typeNames[type] || type;
}

/**
 * 質問タイプの色を取得（内部関数）
 */
function getQuestionTypeColor(type: BlockType): string {
  const typeColors: Record<BlockType, string> = {
    short_text: "bg-blue-100 text-blue-800",
    long_text: "bg-blue-100 text-blue-800",
    radio: "bg-green-100 text-green-800",
    checkbox: "bg-green-100 text-green-800",
    dropdown: "bg-green-100 text-green-800",
    linear_scale: "bg-purple-100 text-purple-800",
    rating: "bg-purple-100 text-purple-800",
    choice_grid: "bg-orange-100 text-orange-800",
    checkbox_grid: "bg-orange-100 text-orange-800",
    date: "bg-pink-100 text-pink-800",
    time: "bg-pink-100 text-pink-800",
    section_separator: "bg-muted text-foreground",
  };
  return typeColors[type] || "bg-muted text-foreground";
}

// ===== Block版の関数（新規追加） =====

/**
 * Blockの種別を変更する際に、共通の情報（タイトル、説明、必須設定など）を引き継ぐ
 */
export function convertBlockType(block: Block, newType: BlockType): Block {
  // 新しいタイプに応じてカテゴリを決定
  const newCategory =
    newType === "section_separator"
      ? ("system" as const)
      : ("question" as const);

  // 基本情報を保持
  const baseInfo = {
    id: block.id,
    formId: block.formId,
    blockId: block.blockId,
    category: newCategory,
    title: block.title,
    description: block.description,
    order: block.order,
    version: block.version,
    isDeleted: block.isDeleted,
    createdAt: block.createdAt,
    updatedAt: new Date(), // 更新日時を現在時刻に
    createdBy: block.createdBy,
    updatedBy: block.updatedBy,
    meta: block.meta,
  };

  // 必須設定を保持
  const isRequired = block.validation.required;

  // 新しい種別に応じて適切なバリデーション設定を作成
  const newValidation = createValidationForType(newType, isRequired);

  return {
    ...baseInfo,
    type: newType,
    validation: newValidation,
  } as Block;
}

/**
 * Blockタイプの表示名を取得（Question版と同じ）
 */
export function getBlockTypeDisplayName(type: BlockType): string {
  return getQuestionTypeDisplayName(type);
}

/**
 * Blockタイプの色を取得（Question版と同じ）
 */
export function getBlockTypeColor(type: BlockType): string {
  return getQuestionTypeColor(type);
}
