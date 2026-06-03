import {
  createFormAppearanceSchema,
  createFormThemeSchema,
  FormLayoutSchema,
} from "@nexus-form/shared";
import { z } from "zod";
import { brandConfig } from "../../lib/brand-config";

export const FormThemeSchema = createFormThemeSchema(brandConfig);
export { FormLayoutSchema };
export const FormAppearanceSchema = createFormAppearanceSchema(brandConfig);

export type {
  FormAccessControl,
  FormConfirmation,
  FormNotifications,
  FormNotificationsTransport,
} from "@nexus-form/shared";
// 通知・Webhook・アクセス制御スキーマは @nexus-form/shared から re-export
export {
  ALLOWED_WEBHOOK_DOMAINS,
  DiscordNotificationChannelSchema,
  DiscordNotificationChannelTransportSchema,
  DiscordWebhookUrlSchema,
  EmailNotificationChannelSchema,
  FormAccessControlSchema,
  FormConfirmationSchema,
  FormNotificationsSchema,
  FormNotificationsTransportSchema,
  SecureWebhookUrlSchema,
  WebhookNotificationChannelSchema,
  WebhookNotificationChannelTransportSchema,
} from "@nexus-form/shared";

export const FormLogicConditionSchema = z.object({
  question_id: z.string(),
  operator: z.enum([
    "equals",
    "not_equals",
    "contains",
    "not_contains",
    "greater_than",
    "greater_than_or_equal",
    "less_than",
    "less_than_or_equal",
    "is_answered",
    "is_not_answered",
    "includes_any",
    "includes_all",
    "before",
    "after",
  ]),
  value: z
    .union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.string()),
      z.array(z.number()),
    ])
    .optional(),
});

export const FormLogicActionSchema = z.object({
  type: z.enum(["jump_to_section", "next", "submit"]),
  target_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DefaultActionSchema = z.object({
  type: z.enum(["jump_to_section", "next", "submit"]),
  target_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const FormLogicRuleSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  conditions: z.array(FormLogicConditionSchema).min(1),
  condition_match: z.enum(["all", "any"]).default("all"),
  action: FormLogicActionSchema,
  stop_on_match: z.boolean().default(false),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).default(0),
});

export type { StoredLogicRule } from "@nexus-form/shared";
// StoredLogicRuleSchema は @nexus-form/shared から re-export
export { StoredLogicRuleSchema } from "@nexus-form/shared";

export const FormSectionSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  order: z.number().int().min(0),
  question_ids: z.array(z.string()).min(1),
  logic: z.array(FormLogicRuleSchema).optional(),
});

export type FormTheme = z.infer<typeof FormThemeSchema>;
export type FormLayout = z.infer<typeof FormLayoutSchema>;
export type FormAppearance = z.infer<typeof FormAppearanceSchema>;
export type FormLogicCondition = z.infer<typeof FormLogicConditionSchema>;
export type FormLogicAction = z.infer<typeof FormLogicActionSchema>;
export type DefaultAction = z.infer<typeof DefaultActionSchema>;
export type FormLogicRule = z.infer<typeof FormLogicRuleSchema>;
export type FormSection = z.infer<typeof FormSectionSchema>;
