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
import { type Job, UnrecoverableError } from "bullmq";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";

type NotificationChannel = "email" | "discord" | "webhook";
const NOTIFICATION_CHANNELS = ["email", "discord", "webhook"] as const;

type NotificationContext = {
  channel: NotificationChannel;
  formId: string;
  responseId: string;
  snapshotVersion?: number;
};

type NotificationSummary = {
  delivered: NotificationChannel[];
  skipped: NotificationChannel[];
  failed: NotificationChannel[];
};

class NotificationSoftFailure extends Error {}
class NotificationPermanentFailure extends Error {}
class NotificationRetryableFailure extends Error {}

type DeliveryResult = "delivered" | "skipped" | "disabled";

const DEFAULT_DISCORD_MESSAGE =
  "新しいフォーム回答が届きました\nForm ID: {{form_id}}\nResponse ID: {{response_id}}";
const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
const NotificationProgressSchema = z.object({
  delivered: z.array(NotificationChannelSchema).optional(),
  skipped: z.array(NotificationChannelSchema).optional(),
});

function uniqueChannels(
  channels: readonly NotificationChannel[] | undefined,
): NotificationChannel[] {
  if (!channels) return [];
  return NOTIFICATION_CHANNELS.filter((channel) => channels.includes(channel));
}

function createInitialSummary(job: Job<unknown>): NotificationSummary {
  const progress = NotificationProgressSchema.safeParse(job.progress);
  if (!progress.success) {
    return {
      delivered: [],
      skipped: [],
      failed: [],
    };
  }

  return {
    delivered: uniqueChannels(progress.data.delivered),
    skipped: uniqueChannels(progress.data.skipped),
    failed: [],
  };
}

function snapshotSummary(summary: NotificationSummary): NotificationSummary {
  return {
    delivered: [...summary.delivered],
    skipped: [...summary.skipped],
    failed: [...summary.failed],
  };
}

function withNotificationContext(
  error: unknown,
  context: NotificationContext,
): Error & { notificationContext: NotificationContext } {
  const base = error instanceof Error ? error : new Error(String(error));
  return Object.assign(base, { notificationContext: context });
}

function classifyNotificationFailure(
  error: unknown,
): "permanent" | "retryable" {
  if (
    error instanceof NotificationSoftFailure ||
    error instanceof NotificationPermanentFailure
  ) {
    return "permanent";
  }
  return "retryable";
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
  if (classifyNotificationFailure(contextualError) === "permanent") {
    console.warn("[notification] channel delivery skipped", logPayload);
    return;
  }
  // Retryable failures are thrown for BullMQ retry; exhausted attempts are
  // captured by the worker-level failed handler.
  console.error("[notification] channel delivery failed", logPayload);
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

function isStoredNotificationConfigError(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof z.ZodError;
}

function logStoredNotificationConfigSkip(
  error: unknown,
  data: FormSubmitNotificationJobData,
) {
  const configError = error instanceof Error ? error : new Error(String(error));
  console.warn("[notification] stored notification config skipped", {
    formId: data.formId,
    responseId: data.responseId,
    snapshotVersion: data.snapshotVersion,
    errorName: configError.name,
    errorMessage: configError.message,
  });
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
    return await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
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
      lastError = createNotificationHttpFailure(
        params.failureLabel,
        response.status,
      );
      if (classifyNotificationFailure(lastError) === "permanent") {
        break;
      }
    } catch (error) {
      lastError = error;
      if (classifyNotificationFailure(lastError) === "permanent") {
        break;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${params.failureLabel} notification failed`);
}

function isRetryableNotificationStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function createNotificationHttpFailure(
  failureLabel: string,
  status: number,
): Error {
  if (status >= 300 && status < 400) {
    return new NotificationPermanentFailure(
      `${failureLabel} notification rejected redirect with status ${status}`,
    );
  }

  const message = `${failureLabel} notification failed with status ${status}`;
  if (isRetryableNotificationStatus(status)) {
    return new NotificationRetryableFailure(message);
  }
  return new NotificationPermanentFailure(message);
}

async function sendEmailNotification(
  channel: EmailNotificationChannel,
  data: FormSubmitNotificationJobData,
): Promise<Exclude<DeliveryResult, "disabled">> {
  const subject = channel.subject?.trim() || "新しいフォーム回答";
  if (process.env.NODE_ENV !== "production") {
    console.info("[notification:email] dev notification generated", {
      formId: data.formId,
      responseId: data.responseId,
      recipientCount: channel.recipients.length,
      subject,
    });
    return "skipped";
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

  // Delivery is intentionally at-least-once. If Discord accepts this POST and
  // the worker crashes before BullMQ progress is persisted, the stable job can
  // retry and Discord may receive a duplicate. Marking progress before POST
  // would instead create silent loss and is deliberately not used.
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
    headers["x-nexus-form-signature"] = `sha256=${createHmac(
      "sha256",
      channel.secret,
    )
      .update(body)
      .digest("hex")}`;
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
  // This ID is stable across BullMQ retries and durable-outbox recovery so a
  // receiver can deduplicate the unavoidable at-least-once crash ambiguity.
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
): Promise<DeliveryResult> {
  switch (channel) {
    case "email": {
      const email = notifications.email;
      if (!email?.enabled) return "disabled";
      return sendEmailNotification(email, data);
    }
    case "discord": {
      const discord = notifications.discord;
      if (!discord?.enabled) return "disabled";
      await sendDiscordNotification(discord, data);
      return "delivered";
    }
    case "webhook": {
      const webhook = notifications.webhook;
      if (!webhook?.enabled) return "disabled";
      await sendWebhookNotification(webhook, data);
      return "delivered";
    }
  }
}

export async function handleFormSubmitNotifications(
  job: Job<unknown>,
): Promise<NotificationSummary> {
  const dataResult = FormSubmitNotificationJobDataSchema.safeParse(job.data);
  if (!dataResult.success) {
    throw new UnrecoverableError("Invalid form submit notification job data");
  }

  const data = dataResult.data;
  const summary = createInitialSummary(job);
  let notifications: FormNotifications["on_submit"];
  try {
    notifications = await loadPublishedSubmitNotifications(data);
  } catch (error) {
    if (!isStoredNotificationConfigError(error)) {
      throw error;
    }
    logStoredNotificationConfigSkip(error, data);
    await job.updateProgress(snapshotSummary(summary));
    return summary;
  }

  let retryableFailure: Error | null = null;

  const terminalChannels = new Set([...summary.delivered, ...summary.skipped]);

  for (const channel of NOTIFICATION_CHANNELS) {
    if (terminalChannels.has(channel)) continue;

    const context: NotificationContext = {
      channel,
      formId: data.formId,
      responseId: data.responseId,
      snapshotVersion: data.snapshotVersion,
    };
    let result: DeliveryResult;
    try {
      result = await deliverChannel(channel, data, notifications);
    } catch (error) {
      recordChannelFailure(error, context);
      if (classifyNotificationFailure(error) === "permanent") {
        summary.skipped.push(channel);
        terminalChannels.add(channel);
        await job.updateProgress(snapshotSummary(summary));
        continue;
      }
      summary.failed.push(channel);
      retryableFailure ??= withNotificationContext(error, context);
      continue;
    }

    if (result === "delivered") {
      summary.delivered.push(channel);
      terminalChannels.add(channel);
      await job.updateProgress(snapshotSummary(summary));
    } else if (result === "skipped") {
      summary.skipped.push(channel);
      terminalChannels.add(channel);
      await job.updateProgress(snapshotSummary(summary));
    }
  }

  await job.updateProgress(snapshotSummary(summary));
  if (retryableFailure) {
    throw retryableFailure;
  }
  return summary;
}
