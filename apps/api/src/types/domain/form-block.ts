import { z } from "zod";

// ===== Question型定義の移行 =====
// 質問タイプの列挙型
export const BlockType = z.enum([
  "short_text",
  "long_text",
  "radio",
  "checkbox",
  "dropdown",
  "linear_scale",
  "rating",
  "choice_grid",
  "checkbox_grid",
  "date",
  "time",
  "section_separator",
]);

export type BlockType = z.infer<typeof BlockType>;

// 外部検証サービスの型 (組み込みプロバイダー + 動的プロバイダー対応)
// provider-registry / plugin-loader / 0005 migration の制約に合わせ、
// 64 文字以下の lowercase snake_case のみ受け付ける。
export const ExternalValidationService = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);

// システム外部サービス検証用サービスの型（外部検証と同一ラインナップ）
export type ExternalValidationService = z.infer<
  typeof ExternalValidationService
>;

// 基本バリデーション設定
export const BaseValidationConfig = z.object({
  required: z.boolean().default(false),
});

export type BaseValidationConfig = z.infer<typeof BaseValidationConfig>;

// 短文入力のバリデーション設定
export const ShortTextValidationConfig = BaseValidationConfig.extend({
  type: z.literal("short_text"),
  maxLength: z.number().min(1).max(1000).optional(),
  minLength: z.number().min(0).optional(),
  pattern: z.string().optional(), // 正規表現パターン
  patternTemplate: z.string().optional(), // パターンテンプレートのID
  allowPatternMismatch: z.boolean().default(false), // パターン不一致を許容するか
  placeholder: z.string().max(200).optional(),
});

export type ShortTextValidationConfig = z.infer<
  typeof ShortTextValidationConfig
>;

// 長文入力のバリデーション設定
export const LongTextValidationConfig = BaseValidationConfig.extend({
  type: z.literal("long_text"),
  maxLength: z.number().min(1).max(10000).optional(),
  minLength: z.number().min(0).optional(),
});

export type LongTextValidationConfig = z.infer<typeof LongTextValidationConfig>;

// 選択肢の型
export const Option = z.object({
  id: z.string(),
  label: z.string(),
});

export type Option = z.infer<typeof Option>;

// ラジオボタンのバリデーション設定
export const RadioValidationConfig = BaseValidationConfig.extend({
  type: z.literal("radio"),
  options: z.array(Option),
  allowOther: z.boolean().default(false),
  otherLabel: z.string().optional(),
});

export type RadioValidationConfig = z.infer<typeof RadioValidationConfig>;

// チェックボックスのバリデーション設定
export const CheckboxValidationConfig = BaseValidationConfig.extend({
  type: z.literal("checkbox"),
  options: z.array(Option),
  minSelections: z.number().min(0).optional(),
  maxSelections: z.number().min(1).optional(),
  allowOther: z.boolean().default(false),
  otherLabel: z.string().optional(),
});

export type CheckboxValidationConfig = z.infer<typeof CheckboxValidationConfig>;

// プルダウンのバリデーション設定
export const DropdownValidationConfig = BaseValidationConfig.extend({
  type: z.literal("dropdown"),
  options: z.array(Option).min(2),
  allowOther: z.boolean().default(false),
  otherLabel: z.string().optional(),
});

export type DropdownValidationConfig = z.infer<typeof DropdownValidationConfig>;

// 均等目盛のバリデーション設定
export const LinearScaleValidationConfig = BaseValidationConfig.extend({
  type: z.literal("linear_scale"),
  min: z.number().default(1),
  max: z.number(),
  minLabel: z.string().optional(),
  maxLabel: z.string().optional(),
  step: z.number().min(1).default(1),
});

export type LinearScaleValidationConfig = z.infer<
  typeof LinearScaleValidationConfig
>;

// 評価のバリデーション設定
export const RatingValidationConfig = BaseValidationConfig.extend({
  type: z.literal("rating"),
  maxRating: z.number().min(1).max(10).default(5),
  icon: z.enum(["star", "heart", "thumbs"]).default("star"),
});

export type RatingValidationConfig = z.infer<typeof RatingValidationConfig>;

// グリッド行・列の型
export const GridRow = z.object({
  id: z.string(),
  label: z.string(),
});

export const GridColumn = z.object({
  id: z.string(),
  label: z.string(),
});

export type GridRow = z.infer<typeof GridRow>;
export type GridColumn = z.infer<typeof GridColumn>;

// 選択式グリッドのバリデーション設定
export const ChoiceGridValidationConfig = BaseValidationConfig.extend({
  type: z.literal("choice_grid"),
  rows: z.array(GridRow).min(1),
  columns: z.array(GridColumn).min(2),
});

export type ChoiceGridValidationConfig = z.infer<
  typeof ChoiceGridValidationConfig
>;

// チェックボックスグリッドのバリデーション設定
export const CheckboxGridValidationConfig = BaseValidationConfig.extend({
  type: z.literal("checkbox_grid"),
  rows: z.array(GridRow).min(1),
  columns: z.array(GridColumn).min(1),
  minSelectionsPerRow: z.number().min(0).optional(),
  maxSelectionsPerRow: z.number().min(1).optional(),
});

export type CheckboxGridValidationConfig = z.infer<
  typeof CheckboxGridValidationConfig
>;

export const DateFormat = z.enum(["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"]);
export type DateFormat = z.infer<typeof DateFormat>;

// 日付のバリデーション設定
export const DateValidationConfig = BaseValidationConfig.extend({
  type: z.literal("date"),
  minDate: z.string().optional(),
  maxDate: z.string().optional(),
  format: DateFormat.default("YYYY-MM-DD"),
});

export type DateValidationConfig = z.infer<typeof DateValidationConfig>;

export const TimeFormat = z.enum(["24h", "12h"]);
export type TimeFormat = z.infer<typeof TimeFormat>;

// 時刻のバリデーション設定
export const TimeValidationConfig = BaseValidationConfig.extend({
  type: z.literal("time"),
  minTime: z.string().optional(),
  maxTime: z.string().optional(),
  format: z.enum(["24h", "12h"]).default("24h"),
});

export type TimeValidationConfig = z.infer<typeof TimeValidationConfig>;

// セクション区切りのバリデーション設定
export const SectionSeparatorValidationConfig = BaseValidationConfig.extend({
  type: z.literal("section_separator"),
});

export type SectionSeparatorValidationConfig = z.infer<
  typeof SectionSeparatorValidationConfig
>;

export const QuestionValidation = z.discriminatedUnion("type", [
  ShortTextValidationConfig,
  LongTextValidationConfig,
  RadioValidationConfig,
  CheckboxValidationConfig,
  DropdownValidationConfig,
  LinearScaleValidationConfig,
  RatingValidationConfig,
  ChoiceGridValidationConfig,
  CheckboxGridValidationConfig,
  DateValidationConfig,
  TimeValidationConfig,
  SectionSeparatorValidationConfig,
]);
export type QuestionValidation = z.infer<typeof QuestionValidation>;

// ブロックタイプ別の型マッピング
export type BlockByType<T extends BlockType> = T extends "short_text"
  ? z.infer<typeof ShortTextFormBlock>
  : T extends "long_text"
    ? z.infer<typeof LongTextFormBlock>
    : T extends "radio"
      ? z.infer<typeof RadioFormBlock>
      : T extends "checkbox"
        ? z.infer<typeof CheckboxFormBlock>
        : T extends "dropdown"
          ? z.infer<typeof DropdownFormBlock>
          : T extends "linear_scale"
            ? z.infer<typeof LinearScaleFormBlock>
            : T extends "rating"
              ? z.infer<typeof RatingFormBlock>
              : T extends "choice_grid"
                ? z.infer<typeof ChoiceGridFormBlock>
                : T extends "checkbox_grid"
                  ? z.infer<typeof CheckboxGridFormBlock>
                  : T extends "date"
                    ? z.infer<typeof DateFormBlock>
                    : T extends "time"
                      ? z.infer<typeof TimeFormBlock>
                      : T extends "section_separator"
                        ? z.infer<typeof SectionSeparatorFormBlock>
                        : never;

// 衝突情報の型定義
export interface ConflictItem {
  path: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}

export const BlockCategory = z.enum(["question", "system"]);
export type BlockCategory = z.infer<typeof BlockCategory>;

export const FormBlockType = z.enum(["question"]);
export type FormBlockType = z.infer<typeof FormBlockType>;

// NOTE: FormBlockSchema / FormBlock は廃止されました。Block（discriminated union）を使用してください。

const BaseFormBlockFields = z.object({
  id: z.string(),
  formId: z.string(),
  blockId: z.string(),
  type: BlockType,
  category: BlockCategory,
  order: z.number().int().min(0),
  version: z.number().int().min(1),
  isDeleted: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string(),
  updatedBy: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const BaseFormQuestionBlock = BaseFormBlockFields.extend({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.literal("question"),
});

export const BaseFormSystemBlockWithoutTitle = BaseFormBlockFields.extend({
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  category: z.literal("system"),
});

export type BaseFormQuestionBlock = z.infer<typeof BaseFormQuestionBlock>;
export type BaseFormSystemBlockWithoutTitle = z.infer<
  typeof BaseFormSystemBlockWithoutTitle
>;

export const ShortTextFormBlock = BaseFormQuestionBlock.extend({
  type: z.literal("short_text"),
  validation: ShortTextValidationConfig,
});
export type ShortTextFormBlock = z.infer<typeof ShortTextFormBlock>;

export const LongTextFormBlock = BaseFormQuestionBlock.extend({
  type: z.literal("long_text"),
  validation: LongTextValidationConfig,
});
export type LongTextFormBlock = z.infer<typeof LongTextFormBlock>;

export const RadioFormBlock = BaseFormQuestionBlock.extend({
  type: z.literal("radio"),
  validation: RadioValidationConfig,
});
export type RadioFormBlock = z.infer<typeof RadioFormBlock>;

export const CheckboxFormBlock = BaseFormQuestionBlock.extend({
  type: z.literal("checkbox"),
  validation: CheckboxValidationConfig,
});
export type CheckboxFormBlock = z.infer<typeof CheckboxFormBlock>;

export const DropdownFormBlock = BaseFormQuestionBlock.extend({
  type: z.literal("dropdown"),
  validation: DropdownValidationConfig,
});
export type DropdownFormBlock = z.infer<typeof DropdownFormBlock>;

export const LinearScaleFormBlock = BaseFormQuestionBlock.extend({
  type: z.literal("linear_scale"),
  validation: LinearScaleValidationConfig,
});
export type LinearScaleFormBlock = z.infer<typeof LinearScaleFormBlock>;

export const RatingFormBlock = BaseFormQuestionBlock.extend({
  type: z.literal("rating"),
  validation: RatingValidationConfig,
});
export type RatingFormBlock = z.infer<typeof RatingFormBlock>;

export const ChoiceGridFormBlock = BaseFormQuestionBlock.extend({
  type: z.literal("choice_grid"),
  validation: ChoiceGridValidationConfig,
});
export type ChoiceGridFormBlock = z.infer<typeof ChoiceGridFormBlock>;

export const CheckboxGridFormBlock = BaseFormQuestionBlock.extend({
  type: z.literal("checkbox_grid"),
  validation: CheckboxGridValidationConfig,
});
export type CheckboxGridFormBlock = z.infer<typeof CheckboxGridFormBlock>;

export const DateFormBlock = BaseFormQuestionBlock.extend({
  type: z.literal("date"),
  validation: DateValidationConfig,
});
export type DateFormBlock = z.infer<typeof DateFormBlock>;

export const TimeFormBlock = BaseFormQuestionBlock.extend({
  type: z.literal("time"),
  validation: TimeValidationConfig,
});
export type TimeFormBlock = z.infer<typeof TimeFormBlock>;

export const SectionSeparatorFormBlock = BaseFormSystemBlockWithoutTitle.extend(
  {
    type: z.literal("section_separator"),
    title: z.string().min(1).max(200),
    validation: SectionSeparatorValidationConfig,
  },
);
export type SectionSeparatorFormBlock = z.infer<
  typeof SectionSeparatorFormBlock
>;

export const Block = z.discriminatedUnion("type", [
  ShortTextFormBlock,
  LongTextFormBlock,
  RadioFormBlock,
  CheckboxFormBlock,
  DropdownFormBlock,
  LinearScaleFormBlock,
  RatingFormBlock,
  ChoiceGridFormBlock,
  CheckboxGridFormBlock,
  DateFormBlock,
  TimeFormBlock,
  SectionSeparatorFormBlock,
]);

export type Block = z.infer<typeof Block>;

export const FormBlockSessionSchema = z.object({
  id: z.string(),
  formId: z.string(),
  blockId: z.string(),
  userId: z.string(),
  userName: z.string(),
  isActive: z.boolean().default(true),
  lastSeen: z.date(),
  createdAt: z.date(),
  expiresAt: z.date(),
});

export type FormBlockSession = z.infer<typeof FormBlockSessionSchema>;

export const CreateFormBlockSchema = z
  .object({
    category: BlockCategory,
    type: BlockType,
    title: z.string().max(200),
    description: z.string().max(1000).optional(),
    order: z.number().int().min(0),
    validation: QuestionValidation,
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (data) => {
      const systemTypes = ["section_separator"];
      if (systemTypes.includes(data.type)) {
        return data.category === "system";
      }
      return data.category === "question";
    },
    {
      message:
        "Block type and category mismatch. System blocks (section_separator) must have category 'system', other blocks must have category 'question'.",
      path: ["category"],
    },
  );

export type CreateFormBlock = z.infer<typeof CreateFormBlockSchema>;

export const UpdateFormBlockSchema = z
  .object({
    type: BlockType.optional(),
    title: z.string().max(200).optional(),
    description: z.string().max(1000).optional(),
    order: z.number().int().min(0).optional(),
    validation: QuestionValidation.optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    version: z.number().int().min(1),
    allowEmptyTitle: z.boolean().optional(),
  })
  .refine(
    (data) => {
      if (data.title !== undefined) {
        const trimmedTitle = data.title.trim();
        const isEmpty = trimmedTitle.length === 0;
        if (data.type === "section_separator") {
          return !isEmpty;
        }
        if (isEmpty) {
          if (data.allowEmptyTitle === true) {
            return true;
          }
          return false;
        }
        return true;
      }
      return true;
    },
    {
      message: "Block title is required.",
      path: ["title"],
    },
  );

export type UpdateFormBlock = z.infer<typeof UpdateFormBlockSchema>;

export const CreateFormBlockSessionSchema = z.object({
  blockId: z.string(),
  expiresAt: z.date(),
});

export type CreateFormBlockSession = z.infer<
  typeof CreateFormBlockSessionSchema
>;

export const UpdateFormBlockSessionSchema = z.object({
  isActive: z.boolean().optional(),
  lastSeen: z.date().optional(),
});

export type UpdateFormBlockSession = z.infer<
  typeof UpdateFormBlockSessionSchema
>;

export const FormBlocksResponseSchema = z.object({
  blocks: z.array(Block),
  sessions: z.array(FormBlockSessionSchema),
  etag: z.string().optional(),
});

export type FormBlocksResponse = z.infer<typeof FormBlocksResponseSchema>;

export const FormBlockChangesResponseSchema = z.object({
  changes: z.array(
    z.object({
      blockId: z.string(),
      action: z.enum(["created", "updated", "deleted"]),
      version: z.number().int(),
      updatedAt: z.date(),
      updatedBy: z.string(),
    }),
  ),
  etag: z.string(),
});

export type FormBlockChangesResponse = z.infer<
  typeof FormBlockChangesResponseSchema
>;

export const EndSessionResponseSchema = z.object({
  ok: z.literal(true),
  ended: z.boolean(),
});

export type EndSessionResponse = z.infer<typeof EndSessionResponseSchema>;

export const EndAllSessionsResponseSchema = z.object({
  ok: z.literal(true),
  endedCount: z.number().int().min(0),
});

export type EndAllSessionsResponse = z.infer<
  typeof EndAllSessionsResponseSchema
>;

export interface MergeContext {
  base: Block;
  local: Block;
  remote: Block;
}

export interface MergeResult {
  merged: Block;
  hasConflict: boolean;
  conflicts: ConflictItem[];
}

/**
 * Block からマージ・比較可能なコンテンツフィールドを抽出する
 * （DB の content JSON カラムと同等の構造）
 */
export function extractBlockContent(block: Block): Record<string, unknown> {
  return {
    type: block.type,
    title: "title" in block ? block.title : undefined,
    description: "description" in block ? block.description : undefined,
    validation: block.validation,
    meta: block.meta,
  };
}

/** スナップショットの blocksJson をパースし Block[] を返す。 */
export function parseSnapshotBlocks(blocksJson: string): Block[] {
  const rawBlocks = JSON.parse(blocksJson) as Record<string, unknown>[];
  return rawBlocks as unknown as Block[];
}
