/**
 * SSE イベントの Zod スキーマ・型定義
 *
 * バリデーションチャネル (form:validation:{formId}) と
 * エディタチャネル (form:editor:{formId}) のイベント型を定義
 */

import { z } from "zod";
import { VALIDATION_STATUS_VALUES } from "./constants/status";

// --- バリデーションチャネル ---

export const ValidationSSEEventSchema = z.object({
  type: z.literal("validation_status_changed"),
  formId: z.string(),
  responseId: z.string(),
  validationResultId: z.string(),
  ruleId: z.string(),
  referencedBlockId: z.string(),
  service: z.string(),
  // Keep the wire contract tied to the DB enum so new persisted statuses are validated consistently.
  status: z.enum(VALIDATION_STATUS_VALUES),
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

// --- SSE 接続制御（権限剥奪時の切断） ---

const SseAccessRevokedBaseSchema = z.object({
  type: z.literal("sse_access_revoked"),
  formId: z.string(),
  timestamp: z.string(),
});

export const SseAccessRevokeTargetSchema = z.discriminatedUnion("targetType", [
  z.object({
    targetType: z.literal("user"),
    userId: z.string(),
  }),
  z.object({
    targetType: z.literal("share_link"),
    shareLinkId: z.string(),
  }),
  z.object({
    targetType: z.literal("form"),
  }),
]);

export type SseAccessRevokeTarget = z.infer<typeof SseAccessRevokeTargetSchema>;

export const SseAccessRevokedEventSchema = z.discriminatedUnion("targetType", [
  SseAccessRevokedBaseSchema.extend({
    targetType: z.literal("user"),
    userId: z.string(),
  }),
  SseAccessRevokedBaseSchema.extend({
    targetType: z.literal("share_link"),
    shareLinkId: z.string(),
  }),
  SseAccessRevokedBaseSchema.extend({
    targetType: z.literal("form"),
  }),
]);

const LegacySseAccessRevokedEventSchema = SseAccessRevokedBaseSchema.extend({
  userId: z.string(),
});

export type SseAccessRevokedEvent = z.infer<typeof SseAccessRevokedEventSchema>;

/**
 * Parses a Redis Pub/Sub payload as an SSE access-revoke control event.
 */
export function parseSseAccessRevokedEvent(
  message: string,
): SseAccessRevokedEvent | null {
  try {
    const parsed: unknown = JSON.parse(message);
    const result = SseAccessRevokedEventSchema.safeParse(parsed);
    if (result.success) return result.data;

    const legacyResult = LegacySseAccessRevokedEventSchema.safeParse(parsed);
    if (!legacyResult.success) return null;

    return {
      type: legacyResult.data.type,
      formId: legacyResult.data.formId,
      targetType: "user",
      userId: legacyResult.data.userId,
      timestamp: legacyResult.data.timestamp,
    };
  } catch {
    return null;
  }
}

// --- Redis チャネル名ヘルパー ---

export const VALIDATION_CHANNEL_PREFIX = "form:validation:";
export const EDITOR_CHANNEL_PREFIX = "form:editor:";

const RedisChannelFormIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);

export function getValidationChannel(formId: string): string {
  return `${VALIDATION_CHANNEL_PREFIX}${RedisChannelFormIdSchema.parse(formId)}`;
}

export function getEditorChannel(formId: string): string {
  return `${EDITOR_CHANNEL_PREFIX}${RedisChannelFormIdSchema.parse(formId)}`;
}
