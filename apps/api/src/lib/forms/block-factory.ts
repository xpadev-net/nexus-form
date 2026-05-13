import type {
  Block,
  BlockType,
  CheckboxGridValidationConfig,
  CheckboxValidationConfig,
  ChoiceGridValidationConfig,
  DateValidationConfig,
  DropdownValidationConfig,
  LinearScaleValidationConfig,
  LongTextValidationConfig,
  QuestionValidation,
  RadioValidationConfig,
  RatingValidationConfig,
  SectionSeparatorValidationConfig,
  ShortTextValidationConfig,
  TimeValidationConfig,
} from "../../types/domain/form-block";

// デフォルトバリデーション設定を作成するヘルパー関数
export const createDefaultValidation = (
  type: BlockType,
): QuestionValidation => {
  switch (type) {
    case "short_text":
      return {
        type: "short_text",
        required: false,
        maxLength: 1000,
        allowPatternMismatch: false,
        placeholder: undefined,
      };
    case "long_text":
      return {
        type: "long_text",
        required: false,
        maxLength: 10000,
      };
    case "radio":
      return {
        type: "radio",
        required: false,
        options: [
          { id: "option-1", label: "選択肢1" },
          { id: "option-2", label: "選択肢2" },
        ],
        allowOther: false,
      };
    case "checkbox":
      return {
        type: "checkbox",
        required: false,
        options: [
          { id: "option-1", label: "選択肢1" },
          { id: "option-2", label: "選択肢2" },
        ],
        allowOther: false,
      };
    case "dropdown":
      return {
        type: "dropdown",
        required: false,
        options: [
          { id: "option-1", label: "選択肢1" },
          { id: "option-2", label: "選択肢2" },
        ],
        allowOther: false,
      };
    case "linear_scale":
      return {
        type: "linear_scale",
        required: false,
        min: 1,
        max: 5,
        step: 1,
      };
    case "rating":
      return {
        type: "rating",
        required: false,
        maxRating: 5,
        icon: "star",
      };
    case "choice_grid":
      return {
        type: "choice_grid",
        required: false,
        rows: [{ id: "row-1", label: "行1" }],
        columns: [
          { id: "col-1", label: "列1" },
          { id: "col-2", label: "列2" },
        ],
      };
    case "checkbox_grid":
      return {
        type: "checkbox_grid",
        required: false,
        rows: [{ id: "row-1", label: "行1" }],
        columns: [
          { id: "col-1", label: "列1" },
          { id: "col-2", label: "列2" },
        ],
      };
    case "date":
      return {
        type: "date",
        required: false,
        format: "YYYY-MM-DD",
      };
    case "time":
      return {
        type: "time",
        required: false,
        format: "24h",
      };
    case "section_separator":
      return {
        type: "section_separator",
        required: false,
      };
    default:
      return {
        type: "short_text",
        required: false,
        maxLength: 1000,
        allowPatternMismatch: false,
        placeholder: undefined,
      };
  }
};

// ID生成のヘルパー関数
export const generateQuestionId = (): string => {
  return `question-${crypto.randomUUID()}`;
};

// Block用のID生成ヘルパー関数
export const generateBlockId = (): string => {
  return `block-${crypto.randomUUID()}`;
};

// 新しいBlockを作成する関数（型安全）
export const createBlock = (
  type: BlockType,
  formId: string,
  userId: string,
  order: number,
  title?: string,
): Block => {
  const validation = createDefaultValidation(type);
  const blockId = generateBlockId();
  const now = new Date();

  const baseBlock = {
    id: `temp-${Date.now()}`, // 一時的なID、実際はDBで生成
    formId,
    blockId,
    category: type === "section_separator" ? "system" : "question",
    type,
    title: title || `質問${order + 1}`,
    description: "",
    order,
    validation,
    version: 1,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
    meta: {},
  };

  // 型安全なBlockオブジェクトを作成
  switch (type) {
    case "short_text":
      return {
        ...baseBlock,
        type: "short_text",
        validation: validation as ShortTextValidationConfig,
      } as Block;
    case "long_text":
      return {
        ...baseBlock,
        type: "long_text",
        validation: validation as LongTextValidationConfig,
      } as Block;
    case "radio":
      return {
        ...baseBlock,
        type: "radio",
        validation: validation as RadioValidationConfig,
      } as Block;
    case "checkbox":
      return {
        ...baseBlock,
        type: "checkbox",
        validation: validation as CheckboxValidationConfig,
      } as Block;
    case "dropdown":
      return {
        ...baseBlock,
        type: "dropdown",
        validation: validation as DropdownValidationConfig,
      } as Block;
    case "linear_scale":
      return {
        ...baseBlock,
        type: "linear_scale",
        validation: validation as LinearScaleValidationConfig,
      } as Block;
    case "rating":
      return {
        ...baseBlock,
        type: "rating",
        validation: validation as RatingValidationConfig,
      } as Block;
    case "choice_grid":
      return {
        ...baseBlock,
        type: "choice_grid",
        validation: validation as ChoiceGridValidationConfig,
      } as Block;
    case "checkbox_grid":
      return {
        ...baseBlock,
        type: "checkbox_grid",
        validation: validation as CheckboxGridValidationConfig,
      } as Block;
    case "date":
      return {
        ...baseBlock,
        type: "date",
        validation: validation as DateValidationConfig,
      } as Block;
    case "time":
      return {
        ...baseBlock,
        type: "time",
        validation: validation as TimeValidationConfig,
      } as Block;
    case "section_separator":
      return {
        ...baseBlock,
        type: "section_separator",
        validation: validation as SectionSeparatorValidationConfig,
      } as Block;
    default:
      // フォールバックとしてshort_textを返す
      return {
        ...baseBlock,
        type: "short_text",
        validation: validation as ShortTextValidationConfig,
      } as Block;
  }
};

// Blockを複製する関数（型安全）
export const duplicateBlock = (
  block: Block,
  formId: string,
  userId: string,
  order: number,
): Block => {
  const duplicatedBase = {
    ...block,
    id: `temp-${Date.now()}`, // 一時的なID、実際はDBで生成
    formId,
    blockId: generateBlockId(),
    title: `${block.title} (コピー)`,
    order,
    version: 1,
    updatedAt: new Date(),
    updatedBy: userId,
  };

  // 型安全な複製オブジェクトを作成
  switch (block.type) {
    case "short_text":
      return {
        ...duplicatedBase,
        type: "short_text",
        validation: block.validation as ShortTextValidationConfig,
      } as Block;
    case "long_text":
      return {
        ...duplicatedBase,
        type: "long_text",
        validation: block.validation as LongTextValidationConfig,
      } as Block;
    case "radio":
      return {
        ...duplicatedBase,
        type: "radio",
        validation: block.validation as RadioValidationConfig,
      } as Block;
    case "checkbox":
      return {
        ...duplicatedBase,
        type: "checkbox",
        validation: block.validation as CheckboxValidationConfig,
      } as Block;
    case "dropdown":
      return {
        ...duplicatedBase,
        type: "dropdown",
        validation: block.validation as DropdownValidationConfig,
      } as Block;
    case "linear_scale":
      return {
        ...duplicatedBase,
        type: "linear_scale",
        validation: block.validation as LinearScaleValidationConfig,
      } as Block;
    case "rating":
      return {
        ...duplicatedBase,
        type: "rating",
        validation: block.validation as RatingValidationConfig,
      } as Block;
    case "choice_grid":
      return {
        ...duplicatedBase,
        type: "choice_grid",
        validation: block.validation as ChoiceGridValidationConfig,
      } as Block;
    case "checkbox_grid":
      return {
        ...duplicatedBase,
        type: "checkbox_grid",
        validation: block.validation as CheckboxGridValidationConfig,
      } as Block;
    case "date":
      return {
        ...duplicatedBase,
        type: "date",
        validation: block.validation as DateValidationConfig,
      } as Block;
    case "time":
      return {
        ...duplicatedBase,
        type: "time",
        validation: block.validation as TimeValidationConfig,
      } as Block;
    case "section_separator":
      return {
        ...duplicatedBase,
        type: "section_separator",
        validation: block.validation as SectionSeparatorValidationConfig,
      } as Block;
    default:
      // フォールバックとしてshort_textを返す
      return {
        ...duplicatedBase,
        type: "short_text",
        validation: {
          type: "short_text",
          required: false,
          maxLength: 1000,
          placeholder: undefined,
        } as ShortTextValidationConfig,
      } as Block;
  }
};
