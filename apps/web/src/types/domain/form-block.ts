import { z } from "zod";
import {
  FormLogicActionSchema,
  FormLogicRuleSchema,
} from "@/types/validation/form";

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
  minDate: z.string().optional(), // ISO date string
  maxDate: z.string().optional(), // ISO date string
  format: DateFormat.default("YYYY-MM-DD"),
});

export type DateValidationConfig = z.infer<typeof DateValidationConfig>;

export const TimeFormat = z.enum(["24h", "12h"]);
export type TimeFormat = z.infer<typeof TimeFormat>;

// 時刻のバリデーション設定
export const TimeValidationConfig = BaseValidationConfig.extend({
  type: z.literal("time"),
  minTime: z.string().optional(), // HH:MM format
  maxTime: z.string().optional(), // HH:MM format
  format: z.enum(["24h", "12h"]).default("24h"),
});

export type TimeValidationConfig = z.infer<typeof TimeValidationConfig>;

// FormLogicRuleスキーマの参照（types/validation/form.ts の定義を使用）
const FormLogicRuleReference = FormLogicRuleSchema;

// セクション遷移アクション
export const SectionTransitionAction = FormLogicActionSchema;
export type SectionTransitionAction = z.infer<typeof FormLogicActionSchema>;

// セクション区切りのバリデーション設定
export const SectionSeparatorValidationConfig = BaseValidationConfig.extend({
  type: z.literal("section_separator"),
  // 前セクション終了後のデフォルトアクション
  default_action: SectionTransitionAction.optional(),
  // 条件付き遷移ルール（前セクションに適用）
  navigation_rules: z.array(FormLogicRuleReference).optional(),
});

export type SectionSeparatorValidationConfig = z.infer<
  typeof SectionSeparatorValidationConfig
>;

// BaseQuestionは削除されました - Block型を使用してください

// Question型の具体的な型定義は削除されました - Block型を使用してください

// Question型は削除されました - Block型を使用してください

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

// QuestionValidationByTypeは削除されました - Block型を使用してください

// QuestionByTypeは削除されました - BlockByTypeを使用してください

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

// DateQuestionTypeとTimeQuestionTypeは削除されました - Block型を使用してください

// 衝突情報の型定義
export interface ConflictItem {
  path: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}

export const BlockCategory = z.enum(["question", "system"]);
export type BlockCategory = z.infer<typeof BlockCategory>;

// ブロックタイプの定義（回答画面でのフィルタリング用に保持）
export const FormBlockType = z.enum(["question"]);

export type FormBlockType = z.infer<typeof FormBlockType>;

// NOTE: FormBlockSchema / FormBlock は廃止されました。Block（discriminated union）を使用してください。

// 基本フィールド定義（各FormBlockに共通）
const BaseFormBlockFields = z.object({
  id: z.string(), // DB primary key
  formId: z.string(),
  blockId: z.string(), // ブロック識別子
  type: BlockType,
  category: BlockCategory,
  order: z.number().int().min(0),
  version: z.number().int().min(1), // 楽観的ロック用
  isDeleted: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string(),
  updatedBy: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(), // ブロックエディター用
});

// 質問ブロックの基本構造
export const BaseFormQuestionBlock = BaseFormBlockFields.extend({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.literal("question"),
});

// システムブロックの基本構造（タイトル・説明文なし）
export const BaseFormSystemBlockWithoutTitle = BaseFormBlockFields.extend({
  title: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  category: z.literal("system"),
});

// 型エクスポート
export type BaseFormQuestionBlock = z.infer<typeof BaseFormQuestionBlock>;
export type BaseFormSystemBlockWithoutTitle = z.infer<
  typeof BaseFormSystemBlockWithoutTitle
>;

// 12種類のFormBlock zodスキーマ作成
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
    title: z.string().min(1).max(200), // セクション区切りはタイトル必須
    validation: SectionSeparatorValidationConfig,
  },
);
export type SectionSeparatorFormBlock = z.infer<
  typeof SectionSeparatorFormBlock
>;

// 最終的なユニオン型
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

// ブロックセッションの定義
export const FormBlockSessionSchema = z.object({
  id: z.string(),
  formId: z.string(),
  blockId: z.string(),
  userId: z.string(),
  userName: z.string(), // Userリレーションから取得
  isActive: z.boolean().default(true),
  lastSeen: z.date(),
  createdAt: z.date(),
  expiresAt: z.date(),
});

export type FormBlockSession = z.infer<typeof FormBlockSessionSchema>;

// ブロック作成用のスキーマ（新しい構造対応）
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
      // システムブロックはcategoryが"system"でなければならない
      const systemTypes = ["section_separator"];
      if (systemTypes.includes(data.type)) {
        return data.category === "system";
      }
      // その他の質問ブロックはcategoryが"question"でなければならない
      return data.category === "question";
    },
    {
      message:
        "Block type and category mismatch. System blocks (section_separator) must have category 'system', other blocks must have category 'question'.",
      path: ["category"],
    },
  )
  .refine(
    (data) => {
      // section_separatorはタイトル必須
      if (data.type === "section_separator") {
        return data.title && data.title.trim().length > 0;
      }
      // その他のブロックはタイトル必須
      return data.title && data.title.trim().length > 0;
    },
    {
      message: "Block title is required.",
      path: ["title"],
    },
  );

export type CreateFormBlock = z.infer<typeof CreateFormBlockSchema>;

// ブロック更新用のスキーマ（新しい構造対応）
export const UpdateFormBlockSchema = z
  .object({
    type: BlockType.optional(),
    title: z.string().max(200).optional(),
    description: z.string().max(1000).optional(),
    order: z.number().int().min(0).optional(),
    validation: QuestionValidation.optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
    version: z.number().int().min(1), // 楽観的ロック用
    allowEmptyTitle: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // タイトルが提供されている場合のみ検証
      if (data.title !== undefined) {
        const trimmedTitle = data.title.trim();
        const isEmpty = trimmedTitle.length === 0;

        // section_separatorはタイトル必須（allowEmptyTitleでも空文字列を拒否）
        if (data.type === "section_separator") {
          return !isEmpty;
        }

        // ここに来るのは、data.typeが undefined、または "section_separator" 以外のケース。
        // 空タイトルである場合:
        if (isEmpty) {
          // 型が未指定でもallowEmptyTitleがtrueなら一旦許可し、実ブロック型の判定は呼び出し側に任せる
          if (data.allowEmptyTitle === true) {
            return true;
          }
          // allowEmptyTitleが指定されていない場合は空タイトルを拒否
          return false;
        }
        // 空タイトルでない場合は常に許可（max lengthはz.string().max(200)で処理）
        return true;
      }
      return true; // タイトルが提供されていない場合は検証をスキップ
    },
    {
      message: "Block title is required.",
      path: ["title"],
    },
  );

export type UpdateFormBlock = z.infer<typeof UpdateFormBlockSchema>;

// ブロックセッション作成用のスキーマ
export const CreateFormBlockSessionSchema = z.object({
  blockId: z.string(),
  expiresAt: z.date(),
});

export type CreateFormBlockSession = z.infer<
  typeof CreateFormBlockSessionSchema
>;

// ブロックセッション更新用のスキーマ
export const UpdateFormBlockSessionSchema = z.object({
  isActive: z.boolean().optional(),
  lastSeen: z.date().optional(),
});

export type UpdateFormBlockSession = z.infer<
  typeof UpdateFormBlockSessionSchema
>;

// ブロック一覧取得用のレスポンス
export const FormBlocksResponseSchema = z.object({
  blocks: z.array(Block),
  sessions: z.array(FormBlockSessionSchema),
  etag: z.string().optional(),
});

export type FormBlocksResponse = z.infer<typeof FormBlocksResponseSchema>;

// ブロック変更検知用のレスポンス
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

// 3-wayマージ用の型定義
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
