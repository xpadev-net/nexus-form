import { z } from "zod";
import { Block } from "./form-block";

// 差分の種類
export const DiffType = z.enum(["added", "removed", "modified", "unchanged"]);
export type DiffType = z.infer<typeof DiffType>;

// フィールドレベルの差分情報
export const DiffField = z.object({
  field: z.string(),
  path: z.string(),
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  type: DiffType,
  displayName: z.string(),
});

export type DiffField = z.infer<typeof DiffField>;

// ブロックレベルの差分情報
export const BlockDiff = z.object({
  blockId: z.string(),
  blockType: z.string(),
  title: z.string(),
  order: z.number(),
  type: DiffType,
  fields: z.array(DiffField),
  hasChanges: z.boolean(),
  publishedVersion: z.number().optional(),
  currentVersion: z.number().optional(),
  lastModified: z
    .string()
    .optional()
    .transform((val) => (val ? new Date(val) : undefined)),
  lastModifiedBy: z.string().optional(),
});

export type BlockDiff = z.infer<typeof BlockDiff>;

// 全ブロックの差分情報
export const BlocksDiffResponse = z.object({
  formId: z.string(),
  publishedVersion: z.number().optional(),
  currentVersion: z.number().optional(),
  blocks: z.array(BlockDiff),
  totalChanges: z.number(),
  hasUnpublishedChanges: z.boolean(),
  hasChangesFromActive: z.boolean(),
  lastChecked: z.string().transform((val) => new Date(val)),
});

export type BlocksDiffResponse = z.infer<typeof BlocksDiffResponse>;

// 個別ブロックの差分情報
export const BlockDiffResponse = z.object({
  formId: z.string(),
  blockId: z.string(),
  publishedVersion: z.number().optional(),
  currentVersion: z.number().optional(),
  diff: BlockDiff,
  lastChecked: z.string().transform((val) => new Date(val)),
});

export type BlockDiffResponse = z.infer<typeof BlockDiffResponse>;

// 差分計算用の設定
export const DiffConfig = z.object({
  includeMetadata: z.boolean().default(true),
  includeValidation: z.boolean().default(true),
  includeContent: z.boolean().default(true),
  ignoreFields: z.array(z.string()).default([]),
  maxDepth: z.number().default(10),
});

export type DiffConfig = z.infer<typeof DiffConfig>;

// 差分比較用のブロックデータ
export const BlockComparisonData = z.object({
  blockId: z.string(),
  published: z.lazy(() => Block).optional(),
  current: z.lazy(() => Block).optional(),
  isNew: z.boolean().default(false),
  isDeleted: z.boolean().default(false),
});

export type BlockComparisonData = z.infer<typeof BlockComparisonData>;

// 差分表示用のフィールドマッピング
export const FieldDisplayMapping = z.record(
  z.string(),
  z.object({
    displayName: z.string(),
    type: z.enum(["text", "boolean", "number", "array", "object"]),
    isImportant: z.boolean().default(false),
    formatValue: z.function().optional(),
  }),
);

export type FieldDisplayMapping = z.infer<typeof FieldDisplayMapping>;

// 差分表示用の設定
export const DiffDisplayConfig = z.object({
  showUnchanged: z.boolean().default(false),
  groupByType: z.boolean().default(true),
  highlightChanges: z.boolean().default(true),
  maxFieldsToShow: z.number().default(20),
  fieldMapping: FieldDisplayMapping.optional(),
});

export type DiffDisplayConfig = z.infer<typeof DiffDisplayConfig>;

// 差分統計情報
export const DiffStats = z.object({
  totalBlocks: z.number(),
  changedBlocks: z.number(),
  addedBlocks: z.number(),
  removedBlocks: z.number(),
  modifiedBlocks: z.number(),
  totalFields: z.number(),
  changedFields: z.number(),
});

export type DiffStats = z.infer<typeof DiffStats>;

// 差分フィルター
export const DiffFilter = z.object({
  blockTypes: z.array(z.string()).optional(),
  diffTypes: z.array(DiffType).optional(),
  fields: z.array(z.string()).optional(),
  showOnlyImportant: z.boolean().default(false),
});

export type DiffFilter = z.infer<typeof DiffFilter>;

// 差分ソート設定
export const DiffSort = z.object({
  field: z.enum(["blockId", "title", "order", "lastModified", "changeCount"]),
  direction: z.enum(["asc", "desc"]).default("asc"),
});

export type DiffSort = z.infer<typeof DiffSort>;

// 差分検索クエリ
export const DiffSearchQuery = z.object({
  formId: z.string(),
  blockId: z.string().optional(),
  config: DiffConfig.optional(),
  filter: DiffFilter.optional(),
  sort: DiffSort.optional(),
  display: DiffDisplayConfig.optional(),
});

export type DiffSearchQuery = z.infer<typeof DiffSearchQuery>;

// 差分表示用のコンポーネントプロパティ
export const DiffViewerProps = z.object({
  diff: BlockDiff,
  config: DiffDisplayConfig.optional(),
  showDetails: z.boolean().default(false),
  onFieldClick: z.function().optional(),
});

export type DiffViewerProps = z.infer<typeof DiffViewerProps>;

// 差分リスト用のコンポーネントプロパティ
export const DiffListProps = z.object({
  diffs: z.array(BlockDiff),
  config: DiffDisplayConfig.optional(),
  filter: DiffFilter.optional(),
  sort: DiffSort.optional(),
  onBlockClick: z.function().optional(),
  onFieldClick: z.function().optional(),
});

export type DiffListProps = z.infer<typeof DiffListProps>;

// エラー情報
export const DiffError = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export type DiffError = z.infer<typeof DiffError>;

// 差分計算結果
export const DiffResult = z.object({
  success: z.boolean(),
  data: z.union([BlocksDiffResponse, BlockDiffResponse]).optional(),
  error: DiffError.optional(),
  stats: DiffStats.optional(),
});

export type DiffResult = z.infer<typeof DiffResult>;
