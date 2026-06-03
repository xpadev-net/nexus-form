import { createHmac } from "node:crypto";
import { formSnapshot } from "@nexus-form/database/schema";
import {
  type DiscordNotificationChannel,
  type EmailNotificationChannel,
  type FormNotifications,
  FormNotificationsSchema,
  type FormSubmitNotificationJobData,
  FormSubmitNotificationJobDataSchema,
  type WebhookNotificationChannel,
} from "@nexus-form/shared";
import type { Job } from "bullmq";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { captureError } from "../lib/sentry";

type NotificationChannel = "email" | "discord" | "webhook";

type NotificationContext = {
  channel: NotificationChannel;
  formId: string;
  responseId: string;
  snapshotVersion?: number;
};

type NotificationSummary = {
  delivered: NotificationChannel[];
  failed: NotificationChannel[];
};

class NotificationSoftFailure extends Error {}

const DEFAULT_DISCORD_MESSAGE =
  "新しいフォーム回答が届きました\nForm ID: {{form_id}}\nResponse ID: {{response_id}}";

function withNotificationContext(
  error: unknown,
  context: NotificationContext,
): Error & { notificationContext: NotificationContext } {
  const base = error instanceof Error ? error : new Error(String(error));
  return Object.assign(base, { notificationContext: context });
}

function recordChannelFailure(error: unknown, context: NotificationContext) {
  const contextualError = withNotificationContext(error, context);
  const logPayload = {
    channel: context.channel,
    formId: context.formId,
    responseId: context.responseId,
    snapshotVersion: context.snapshotVersion,
    errorName: contextualError.name,
    errorMessage: contextualError.message,
  };
  if (contextualError instanceof NotificationSoftFailure) {
    console.warn("[notification] channel delivery skipped", logPayload);
    return;
  }
  console.error("[notification] channel delivery failed", logPayload);
  captureError(contextualError);
}

function buildNotificationPayload(data: FormSubmitNotificationJobData) {
  return {
    event: "form.response_submitted",
    form_id: data.formId,
    response_id: data.responseId,
    snapshot_version: data.snapshotVersion,
    submitted_at: data.submittedAt,
  };
}

function getEnabledSubmitNotificationChannels(
  notifications: FormNotifications["on_submit"],
): FormNotifications["on_submit"] {
  const enabledChannels: FormNotifications["on_submit"] = {};
  const email = notifications.email;
  if (email?.enabled && email.recipients.length > 0) {
    enabledChannels.email = email;
  }

  const discord = notifications.discord;
  if (discord?.enabled && discord.webhook_url) {
    enabledChannels.discord = discord;
  }

  const webhook = notifications.webhook;
  if (webhook?.enabled && webhook.url) {
    enabledChannels.webhook = webhook;
  }

  return enabledChannels;
}

async function loadPublishedSubmitNotifications(
  data: FormSubmitNotificationJobData,
): Promise<FormNotifications["on_submit"]> {
  const [snapshot] = await db
    .select({ structureJson: formSnapshot.structureJson })
    .from(formSnapshot)
    .where(
      and(
        eq(formSnapshot.formId, data.formId),
        eq(formSnapshot.version, data.snapshotVersion),
      ),
    )
    .limit(1);

  if (!snapshot) {
    throw new Error(
      `Published snapshot not found for form ${data.formId} version ${data.snapshotVersion}`,
    );
  }

  const parsed = JSON.parse(snapshot.structureJson);
  const rawNotifications =
    typeof parsed === "object" && parsed !== null && "notifications" in parsed
      ? parsed.notifications
      : {};
  const notifications = FormNotificationsSchema.parse(rawNotifications ?? {});
  return getEnabledSubmitNotificationChannels(notifications.on_submit);
}

function renderDiscordMessage(
  template: string | undefined,
  data: FormSubmitNotificationJobData,
): string {
  const source = template?.trim() || DEFAULT_DISCORD_MESSAGE;
  return source
    .replaceAll("{{form_id}}", data.formId)
    .replaceAll("{{response_id}}", data.responseId)
    .replaceAll("{{snapshot_version}}", String(data.snapshotVersion ?? ""))
    .replaceAll("{{submitted_at}}", data.submittedAt)
    .slice(0, 2000);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutSeconds: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, timeoutSeconds) * 1000,
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function backoffDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attempt - 2), 8000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJsonWithRetries(params: {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutSeconds: number;
  retryAttempts: number;
  failureLabel: string;
}): Promise<void> {
  const attempts = Math.max(1, params.retryAttempts + 1);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(backoffDelayMs(attempt));
    }
    try {
      const response = await fetchWithTimeout(
        params.url,
        {
          method: "POST",
          headers: params.headers,
          body: params.body,
        },
        params.timeoutSeconds,
      );
      if (response.ok) return;
      lastError = new Error(
        `${params.failureLabel} notification failed with status ${response.status}`,
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${params.failureLabel} notification failed`);
}

async function sendEmailNotification(
  channel: EmailNotificationChannel,
  data: FormSubmitNotificationJobData,
): Promise<void> {
  const subject = channel.subject?.trim() || "新しいフォーム回答";
  if (process.env.NODE_ENV !== "production") {
    console.info("[notification:email] dev notification generated", {
      formId: data.formId,
      responseId: data.responseId,
      recipientCount: channel.recipients.length,
      subject,
    });
    return;
  }

  throw new NotificationSoftFailure(
    "Email notification provider is not configured",
  );
}

async function sendDiscordNotification(
  channel: DiscordNotificationChannel,
  data: FormSubmitNotificationJobData,
): Promise<void> {
  if (!channel.webhook_url) {
    throw new Error("Discord webhook URL is missing");
  }

  const body = JSON.stringify({
    content: renderDiscordMessage(channel.message_template, data),
  });

  await postJsonWithRetries({
    url: channel.webhook_url,
    body,
    headers: { "content-type": "application/json" },
    timeoutSeconds: 10,
    retryAttempts: 0,
    failureLabel: "Discord",
  });
}

function buildWebhookHeaders(
  channel: WebhookNotificationChannel,
  body: string,
  deliveryId: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    ...(channel.headers ?? {}),
    "content-type": "application/json",
    "x-nexus-form-delivery-id": deliveryId,
    "x-nexus-form-event": "form.response_submitted",
  };

  if (channel.secret) {
    headers["x-nexus-form-signature"] = createHmac("sha256", channel.secret)
      .update(body)
      .digest("hex");
  }

  return headers;
}

async function sendWebhookNotification(
  channel: WebhookNotificationChannel,
  data: FormSubmitNotificationJobData,
): Promise<void> {
  if (!channel.url) {
    throw new Error("Webhook URL is missing");
  }

  const body = JSON.stringify(buildNotificationPayload(data));
  const deliveryId = `${data.formId}:${data.responseId}:webhook`;
  await postJsonWithRetries({
    url: channel.url,
    body,
    headers: buildWebhookHeaders(channel, body, deliveryId),
    timeoutSeconds: channel.timeout_seconds,
    retryAttempts: channel.retry_attempts,
    failureLabel: "Webhook",
  });
}

async function deliverChannel(
  channel: NotificationChannel,
  data: FormSubmitNotificationJobData,
  notifications: FormNotifications["on_submit"],
): Promise<void> {
  switch (channel) {
    case "email": {
      const email = notifications.email;
      if (!email?.enabled) return;
      await sendEmailNotification(email, data);
      return;
    }
    case "discord": {
      const discord = notifications.discord;
      if (!discord?.enabled) return;
      await sendDiscordNotification(discord, data);
      return;
    }
    case "webhook": {
      const webhook = notifications.webhook;
      if (!webhook?.enabled) return;
      await sendWebhookNotification(webhook, data);
      return;
    }
  }
}

export async function handleFormSubmitNotifications(
  job: Job<unknown>,
): Promise<NotificationSummary> {
  const data = FormSubmitNotificationJobDataSchema.parse(job.data);
  const notifications = await loadPublishedSubmitNotifications(data);
  const summary: NotificationSummary = { delivered: [], failed: [] };

  for (const channel of ["email", "discord", "webhook"] as const) {
    const context: NotificationContext = {
      channel,
      formId: data.formId,
      responseId: data.responseId,
      snapshotVersion: data.snapshotVersion,
    };
    try {
      await deliverChannel(channel, data, notifications);
      if (notifications[channel]?.enabled) {
        summary.delivered.push(channel);
      }
    } catch (error) {
      summary.failed.push(channel);
      recordChannelFailure(error, context);
    }
  }

  await job.updateProgress(summary);
  return summary;
}
