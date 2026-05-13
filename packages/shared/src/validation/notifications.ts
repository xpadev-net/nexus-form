/**
 * 通知チャンネル・Webhook・アクセス制御のバリデーションスキーマ
 *
 * API と Web で同一のバリデーションを適用するため、共有パッケージに定義する。
 */

import { z } from "zod";

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

export const DiscordNotificationChannelSchema = z
  .object({
    enabled: z.boolean().default(false),
    webhook_url: DiscordWebhookUrlSchema.optional(),
    message_template: z.string().max(2000).optional(),
  })
  .refine((data) => !data.enabled || !!data.webhook_url, {
    message: "Discord通知が有効な場合、webhook_urlは必須です",
  });

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

// --- Form Notifications ---

const NotificationChannelsSchema = z.object({
  email: EmailNotificationChannelSchema.optional(),
  discord: DiscordNotificationChannelSchema.optional(),
  webhook: WebhookNotificationChannelSchema.optional(),
});

export const FormNotificationsSchema = z.object({
  on_submit: NotificationChannelsSchema.default({}),
  on_duplicate_detected: NotificationChannelsSchema.optional(),
});

// --- Form Access Control ---

export const FormAccessControlSchema = z.object({
  require_authentication: z.boolean().default(false),
  allowed_roles: z.array(z.string()).max(20).optional(),
  allowed_domains: z.array(z.string()).max(20).optional(),
  password_protection: z
    .object({
      enabled: z.boolean().default(false),
      password: z.string().min(1).optional(), // ハッシュ化されたパスワード（サーバー内部のみ）
      has_password: z.boolean().optional(), // クライアント向けレスポンス用フラグ
      password_hint: z.string().max(200).optional(),
    })
    .refine(
      (data) => {
        // パスワード保護が有効な場合、パスワードハッシュまたは has_password フラグが必須
        // has_password はクライアント向けレスポンス用フラグで、ハッシュがマスクされた
        // 構造を PUT で再送信する際に有効なケースとして認める
        if (data.enabled && !data.password && !data.has_password) {
          return false;
        }
        return true;
      },
      {
        message: "パスワード保護が有効な場合、パスワードは必須です",
      },
    )
    .optional(),
});

// --- Form Confirmation ---

export const FormConfirmationSchema = z.object({
  title: z.string().min(1).max(120).default("ご回答ありがとうございます"),
  message: z
    .string()
    .max(2000)
    .default("回答を受け付けました。ご協力ありがとうございました。"),
  redirect_url: z.string().url().optional(),
  show_response_summary: z.boolean().default(false),
  allow_edit_link: z.boolean().default(false),
});

// --- Type exports ---

export type EmailNotificationChannel = z.infer<
  typeof EmailNotificationChannelSchema
>;
export type DiscordNotificationChannel = z.infer<
  typeof DiscordNotificationChannelSchema
>;
export type WebhookNotificationChannel = z.infer<
  typeof WebhookNotificationChannelSchema
>;
export type FormNotifications = z.infer<typeof FormNotificationsSchema>;
export type FormAccessControl = z.infer<typeof FormAccessControlSchema>;
export type FormConfirmation = z.infer<typeof FormConfirmationSchema>;
