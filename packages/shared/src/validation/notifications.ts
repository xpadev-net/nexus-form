/**
 * 通知チャンネル・Webhook・アクセス制御のバリデーションスキーマ
 *
 * API と Web で同一のバリデーションを適用するため、共有パッケージに定義する。
 */

import { z } from "zod";

// --- Confirmation URL ---

const SAFE_CONFIRMATION_URL_PROTOCOLS = new Set(["http:", "https:"]);

export function isSafeConfirmationUrl(value: string): boolean {
  try {
    return SAFE_CONFIRMATION_URL_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

export const SafeConfirmationUrlSchema = z
  .string()
  .url()
  .refine(isSafeConfirmationUrl, {
    message: "URLは http:// または https:// で始まる必要があります",
  });

// --- Discord Webhook URL ---

const ALLOWED_DISCORD_HOSTS = new Set([
  "discord.com",
  "ptb.discord.com",
  "canary.discord.com",
]);

function isAllowedDiscordHost(hostname: string): boolean {
  return ALLOWED_DISCORD_HOSTS.has(hostname);
}

/** Discord webhook パスが /api/webhooks/{id}/{token} 形式であるか検証する */
function isValidDiscordWebhookPath(pathname: string): boolean {
  if (!pathname.startsWith("/api/webhooks/")) return false;
  const segments = pathname
    .replace(/^\/api\/webhooks\//, "")
    .split("/")
    .filter(Boolean);
  return segments.length === 2;
}

export const DiscordWebhookUrlSchema = z
  .string()
  .url()
  .refine(
    (url) => {
      try {
        const urlObj = new URL(url);
        return (
          isAllowedDiscordHost(urlObj.hostname) &&
          isValidDiscordWebhookPath(urlObj.pathname)
        );
      } catch {
        return false;
      }
    },
    {
      message:
        "Discord webhook URLは discord.com の /api/webhooks/{id}/{token} 形式である必要があります",
    },
  );

// --- Email Notification Channel ---

export const EmailNotificationChannelSchema = z
  .object({
    enabled: z.boolean().default(false),
    recipients: z.array(z.string().email()).max(20).default([]),
    subject: z.string().max(150).optional(),
    template_id: z.string().optional(),
  })
  .refine((data) => !data.enabled || data.recipients.length > 0, {
    message: "メール通知が有効な場合、recipientsは1件以上必須です",
  });

// --- Discord Notification Channel ---

const DiscordNotificationChannelBaseSchema = z.object({
  enabled: z.boolean().default(false),
  webhook_url: DiscordWebhookUrlSchema.optional(),
  message_template: z.string().max(2000).optional(),
});

export const DiscordNotificationChannelSchema =
  DiscordNotificationChannelBaseSchema.refine(
    (data) => !data.enabled || !!data.webhook_url,
    {
      message: "Discord通知が有効な場合、webhook_urlは必須です",
    },
  );

export const DiscordNotificationChannelTransportSchema =
  DiscordNotificationChannelBaseSchema.extend({
    has_webhook_url: z.boolean().optional(),
  }).refine(
    (data) => !data.enabled || !!data.webhook_url || data.has_webhook_url,
    {
      message: "Discord通知が有効な場合、webhook_urlは必須です",
    },
  );

// --- Secure Webhook URL (generic webhook with domain allowlist) ---

/** 本番環境で常に許可される webhook ドメイン一覧 */
export const BASE_WEBHOOK_DOMAINS = [
  "discord.com",
  "slack.com",
  "zapier.com",
  "pipedream.com",
] as const;

// 注意: TypeScript の推論型は実行時条件に関わらず全エントリを含む superset になる。
// 本番環境で安全なドメイン型が必要な場合は `typeof BASE_WEBHOOK_DOMAINS[number]` を使用すること。
export const ALLOWED_WEBHOOK_DOMAINS = [
  ...BASE_WEBHOOK_DOMAINS,
  ...(process.env.NODE_ENV !== "production"
    ? (["webhook.site", "localhost"] as const)
    : []),
] as const;

export const SecureWebhookUrlSchema = z
  .string()
  .url()
  .refine(
    (url) => {
      try {
        const urlObj = new URL(url);
        // Allow HTTPS only; HTTP is permitted for localhost in non-production
        if (urlObj.protocol !== "https:" && urlObj.hostname !== "localhost") {
          return false;
        }
        // Check against allowed domains or allow subdomains of allowed domains.
        // discord.com はホワイトリスト方式で許可ホストを制限する。
        const domainAllowed =
          isAllowedDiscordHost(urlObj.hostname) ||
          ALLOWED_WEBHOOK_DOMAINS.some(
            (domain) =>
              domain !== "discord.com" &&
              (urlObj.hostname === domain ||
                urlObj.hostname.endsWith(`.${domain}`)),
          );
        if (!domainAllowed) {
          return false;
        }
        // discord.com は専用チャンネル (DiscordNotificationChannel) を使うべきだが、
        // 汎用 webhook に設定された場合でも /api/webhooks/{id}/{token} パスのみ許可する
        if (
          isAllowedDiscordHost(urlObj.hostname) &&
          !isValidDiscordWebhookPath(urlObj.pathname)
        ) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    {
      message: "Webhook URLは許可されたドメインのHTTPS URLである必要があります",
    },
  );

// --- Webhook Notification Channel ---
// Note: timeout_seconds / retry_attempts use .optional().default() so the
// output type is always `number` after parsing.  Values stored in the DB may
// lack these fields, so callers must re-parse through this schema (e.g. via
// parseStoredStructure) before accessing them to guarantee the defaults.

export const WebhookNotificationChannelSchema = z
  .object({
    enabled: z.boolean().default(false),
    url: SecureWebhookUrlSchema.optional(),
    secret: z.string().min(32).max(200).optional(), // HMAC-SHA256 requires ≥256 bits (32 chars)
    headers: z.record(z.string(), z.string()).optional(),
    timeout_seconds: z.number().int().min(1).max(60).optional().default(30),
    retry_attempts: z.number().int().min(0).max(5).optional().default(3),
  })
  .refine((data) => !data.enabled || !!data.url, {
    message: "Webhook通知が有効な場合、urlは必須です",
  });

export const WebhookNotificationChannelTransportSchema = z
  .object({
    enabled: z.boolean().default(false),
    url: SecureWebhookUrlSchema.optional(),
    has_url: z.boolean().optional(),
    secret: z.string().min(32).max(200).optional(), // HMAC-SHA256 requires ≥256 bits (32 chars)
    has_secret: z.boolean().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    timeout_seconds: z.number().int().min(1).max(60).optional().default(30),
    retry_attempts: z.number().int().min(0).max(5).optional().default(3),
  })
  .refine((data) => !data.enabled || !!data.url || data.has_url, {
    message: "Webhook通知が有効な場合、urlは必須です",
  });

// --- Form Notifications ---

const NotificationChannelsSchema = z.object({
  email: EmailNotificationChannelSchema.optional(),
  discord: DiscordNotificationChannelSchema.optional(),
  webhook: WebhookNotificationChannelSchema.optional(),
});

const NotificationChannelsTransportSchema = z.object({
  email: EmailNotificationChannelSchema.optional(),
  discord: DiscordNotificationChannelTransportSchema.optional(),
  webhook: WebhookNotificationChannelTransportSchema.optional(),
});

export const FormNotificationsSchema = z.object({
  on_submit: NotificationChannelsSchema.default({}),
  on_duplicate_detected: NotificationChannelsSchema.optional(),
});

export const FormNotificationsTransportSchema = z.object({
  on_submit: NotificationChannelsTransportSchema.default({}),
  on_duplicate_detected: NotificationChannelsTransportSchema.optional(),
});

// --- Form Submit Notification Jobs ---

export const FORM_SUBMIT_NOTIFICATION_QUEUE = "form-submit-notifications";
export const FORM_SUBMIT_NOTIFICATION_JOB_PREFIX = "form-submit-notification.";

function encodeJobIdSegment(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function buildFormSubmitNotificationJobId(
  formId: string,
  responseId: string,
): string {
  return `${FORM_SUBMIT_NOTIFICATION_JOB_PREFIX}${encodeJobIdSegment(formId)}.${encodeJobIdSegment(responseId)}`;
}

export const FormSubmitNotificationJobDataSchema = z.object({
  formId: z.string().min(1),
  responseId: z.string().min(1),
  snapshotVersion: z.number().int().positive(),
  submittedAt: z.string().datetime(),
});

// --- Form Access Control ---

/** Maximum length accepted for user-entered public form passwords. */
export const MAX_PUBLIC_PASSWORD_LENGTH = 1_024;

const passwordProtectionRequirement = (data: {
  enabled: boolean;
  password?: string;
  has_password?: boolean;
}) => !!data.password || !!data.has_password || !data.enabled;

const passwordProtectionRefinement = {
  message: "パスワード保護が有効な場合、パスワードは必須です",
};

const passwordProtectionShape = {
  enabled: z.boolean().default(false),
  has_password: z.boolean().optional(), // クライアント向けレスポンス用フラグ
  password_hint: z.string().max(200).optional(),
};

const storedPasswordProtectionSchema = z
  .object({
    ...passwordProtectionShape,
    password: z.string().min(1).optional(), // 既存保存値の読み取り互換性を維持する
  })
  .refine(passwordProtectionRequirement, passwordProtectionRefinement);

const passwordProtectionInputSchema = z
  .object({
    ...passwordProtectionShape,
    password: z.string().min(1).max(MAX_PUBLIC_PASSWORD_LENGTH).optional(),
  })
  .refine(passwordProtectionRequirement, passwordProtectionRefinement);

const formAccessControlShape = {
  require_authentication: z.boolean().default(false),
  allowed_roles: z.array(z.string()).max(20).optional(),
  allowed_domains: z.array(z.string()).max(20).optional(),
};

/** Persisted structures remain readable even if a legacy password value is longer. */
export const FormAccessControlSchema = z.object({
  ...formAccessControlShape,
  password_protection: storedPasswordProtectionSchema.optional(),
});

/** Input contract for full structure mutations with a bounded plaintext password. */
export const FormAccessControlInputSchema = z.object({
  ...formAccessControlShape,
  password_protection: passwordProtectionInputSchema.optional(),
});

// --- Form Confirmation ---

export const FormConfirmationSchema = z.object({
  title: z.string().min(1).max(120).default("ご回答ありがとうございます"),
  message: z
    .string()
    .max(2000)
    .default("回答を受け付けました。ご協力ありがとうございました。"),
  redirect_url: SafeConfirmationUrlSchema.optional(),
  supplemental_link: z
    .object({
      label: z.string().min(1).max(80),
      url: SafeConfirmationUrlSchema,
    })
    .optional(),
  contact: z
    .object({
      label: z.string().min(1).max(80).optional(),
      email: z.string().email().optional(),
      url: SafeConfirmationUrlSchema.optional(),
    })
    .refine((data) => !!data.email || !!data.url, {
      message: "問い合わせ先には email または url が必要です",
    })
    .optional(),
  show_response_summary: z.boolean().default(false),
  show_response_id: z.boolean().default(true),
  allow_edit_link: z.boolean().default(false),
});

// --- Type exports ---

export type EmailNotificationChannel = z.infer<
  typeof EmailNotificationChannelSchema
>;
export type DiscordNotificationChannel = z.infer<
  typeof DiscordNotificationChannelSchema
>;
export type DiscordNotificationChannelTransport = z.infer<
  typeof DiscordNotificationChannelTransportSchema
>;
export type WebhookNotificationChannel = z.infer<
  typeof WebhookNotificationChannelSchema
>;
export type WebhookNotificationChannelTransport = z.infer<
  typeof WebhookNotificationChannelTransportSchema
>;
export type FormNotifications = z.infer<typeof FormNotificationsSchema>;
export type FormNotificationsTransport = z.infer<
  typeof FormNotificationsTransportSchema
>;
export type FormSubmitNotificationJobData = z.infer<
  typeof FormSubmitNotificationJobDataSchema
>;
export type FormAccessControl = z.infer<typeof FormAccessControlSchema>;
export type FormConfirmation = z.infer<typeof FormConfirmationSchema>;
