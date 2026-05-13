/**
 * SSE イベントの Zod スキーマ・型定義
 *
 * バリデーションチャネル (form:validation:{formId}) と
 * エディタチャネル (form:editor:{formId}) のイベント型を定義
 */

import { z } from "zod";

// --- バリデーションチャネル ---

export const ValidationSSEEventSchema = z.object({
  type: z.literal("validation_status_changed"),
  formId: z.string(),
  responseId: z.string(),
  validationResultId: z.string(),
  ruleId: z.string(),
  referencedBlockId: z.string(),
  service: z.string(),
  status: z.enum(["PROCESSING", "COMPLETED", "FAILED", "MISSING"]),
  success: z.boolean().nullable(),
  timestamp: z.string(),
});

export type ValidationSSEEvent = z.infer<typeof ValidationSSEEventSchema>;

// --- エディタチャネル ---

const DocumentChangedEventSchema = z.object({
  type: z.literal("document_changed"),
  formId: z.string(),
  updatedBy: z.string(),
  version: z.number(),
  timestamp: z.string(),
});

export const EditorSSEEventSchema = z.discriminatedUnion("type", [
  DocumentChangedEventSchema,
]);

export type EditorSSEEvent = z.infer<typeof EditorSSEEventSchema>;

// --- Redis チャネル名ヘルパー ---

export const VALIDATION_CHANNEL_PREFIX = "form:validation:";
export const EDITOR_CHANNEL_PREFIX = "form:editor:";

export function getValidationChannel(formId: string): string {
  return `${VALIDATION_CHANNEL_PREFIX}${formId}`;
}

export function getEditorChannel(formId: string): string {
  return `${EDITOR_CHANNEL_PREFIX}${formId}`;
}
