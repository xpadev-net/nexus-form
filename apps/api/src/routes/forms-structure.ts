import { zValidator } from "@hono/zod-validator";
import {
  type PasswordProtectionPublicationSnapshot,
  PasswordProtectionPublicationSnapshotSchema,
  type PasswordProtectionPublicationState,
  PasswordProtectionPublicationStateSchema,
} from "@nexus-form/shared";
import { z } from "zod";
import { withDualFormAuth } from "../lib/dual-auth";
import { FormStructureNotFoundError } from "../lib/errors/form-errors";
import {
  getFormStructure,
  getFormStructureDiff,
  getFormStructureHistory,
  restoreFormStructure,
  saveFormStructure,
} from "../lib/forms/form-structure-service";
import { parseStoredStructure } from "../lib/forms/parse-stored-structure";
import { getLatestSnapshot } from "../lib/forms/snapshot-repository";
import { withFormStructureMutationLock } from "../lib/forms/structure-mutation-lock";
import { createHonoApp } from "../lib/hono";
import { createRateLimit, getClientIp } from "../lib/rate-limit";
import { resolveAuditUserId } from "../lib/resolve-audit-user-id";
import { hashPassword } from "../lib/security/password";
import {
  FormStructure,
  type FormStructure as FormStructureType,
} from "../types/domain/form";
import { isoDate } from "../types/domain/iso-date";
import {
  DiscordNotificationChannelTransportSchema,
  EmailNotificationChannelSchema,
  FormAppearanceSchema,
  FormConfirmationSchema,
  type FormNotifications,
  FormNotificationsSchema,
  type FormNotificationsTransport,
  FormNotificationsTransportSchema,
  StoredLogicRuleSchema,
  WebhookNotificationChannelTransportSchema,
} from "../types/validation/form";
import { formVersionDiffQuerySchema } from "./form-route-schemas";

const FormStructureTransport = FormStructure.extend({
  notifications: FormNotificationsTransportSchema.optional(),
});
type FormStructureTransportType = z.infer<typeof FormStructureTransport>;

const structureUpdateSchema = z.object({
  structure: FormStructureTransport,
  changeLog: z.string().max(500).optional(),
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["version", "createdAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

const restoreSchema = z.object({
  version: z.number().int().min(1),
  changeLog: z.string().max(500).optional(),
});

const accessControlUpdateSchema = z.object({
  password_protection: z.object({
    enabled: z.boolean(),
    password: z.string().min(8).optional(),
    password_hint: z.string().max(200).optional(),
  }),
});

const appearanceUpdateSchema = z.object({
  appearance: FormAppearanceSchema,
});

const postSubmitSupplementalLinkUpdateSchema = z.object({
  label: z.string().min(1).max(80),
  url: z.string().url(),
});

const postSubmitContactUpdateSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    email: z.string().email().optional(),
    url: z.string().url().optional(),
  })
  .refine((data) => !!data.email || !!data.url, {
    message: "問い合わせ先には email または url が必要です",
  });

const postSubmitConfirmationUpdateSchema = z.object({
  title: z.string().min(1).max(120),
  message: z.string().max(2000),
  redirect_url: z.string().url().optional(),
  supplemental_link: postSubmitSupplementalLinkUpdateSchema
    .nullable()
    .optional(),
  contact: postSubmitContactUpdateSchema.nullable().optional(),
  show_response_summary: z.boolean().optional(),
  allow_edit_link: z.boolean().optional(),
});

const postSubmitDiscordUpdateSchema = DiscordNotificationChannelTransportSchema;

const postSubmitWebhookUpdateSchema = WebhookNotificationChannelTransportSchema;

const postSubmitNotificationsUpdateSchema = z.object({
  on_submit: z.object({
    email: EmailNotificationChannelSchema.optional(),
    discord: postSubmitDiscordUpdateSchema.optional(),
    webhook: postSubmitWebhookUpdateSchema.optional(),
  }),
});

const postSubmitSettingsUpdateSchema = z.object({
  confirmation: postSubmitConfirmationUpdateSchema,
  notifications: postSubmitNotificationsUpdateSchema,
});

const logicUpdateSchema = z.object({
  logic: z.array(StoredLogicRuleSchema),
});

const servicePaginationSchema = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});

export type {
  PasswordProtectionPublicationSnapshot,
  PasswordProtectionPublicationState,
};
export {
  PasswordProtectionPublicationSnapshotSchema,
  PasswordProtectionPublicationStateSchema,
};

const FormStructureEnvelopeSchema = z.object({
  structure: FormStructureTransport,
  password_protection_publication:
    PasswordProtectionPublicationStateSchema.optional(),
});
export type FormStructureEnvelope = z.infer<typeof FormStructureEnvelopeSchema>;

const FormStructureErrorResponseSchema = z.object({
  error: z.string().min(1),
});

/**
 * Error response shape returned by forms structure endpoints.
 *
 * The `error` field carries the client-facing error message validated by
 * {@link FormStructureErrorResponseSchema}.
 */
export type FormStructureErrorResponse = z.infer<
  typeof FormStructureErrorResponseSchema
>;

const formStructureError = (error: string): FormStructureErrorResponse => {
  const parsed = FormStructureErrorResponseSchema.safeParse({ error });
  return parsed.success ? parsed.data : { error: "Request failed" };
};

function maskFormStructureSecrets(
  structure: FormStructureType,
): FormStructureType {
  const ac = structure.access_control;
  const pp = ac?.password_protection;
  const notifications = structure.notifications;

  return {
    ...structure,
    ...(ac && pp
      ? {
          access_control: {
            ...ac,
            password_protection: {
              enabled: pp.enabled,
              password_hint: pp.password_hint,
              has_password: !!pp.password,
            },
          },
        }
      : {}),
    ...(notifications
      ? {
          notifications: maskNotificationSecrets(notifications),
        }
      : {}),
  };
}

function getPasswordProtectionPublicationSnapshot(
  structure: FormStructureType,
): {
  publicSnapshot: PasswordProtectionPublicationSnapshot;
  passwordHash?: string;
} {
  const passwordProtection = structure.access_control?.password_protection;
  if (!passwordProtection) {
    return {
      publicSnapshot: {
        enabled: false,
        has_password: false,
      },
    };
  }

  return {
    publicSnapshot: {
      enabled: passwordProtection.enabled ?? false,
      has_password: !!passwordProtection.password,
      password_hint: passwordProtection.password_hint,
    },
    passwordHash: passwordProtection.password,
  };
}

async function getPasswordProtectionPublicationState(
  formId: string,
  currentStructure: FormStructureType,
): Promise<PasswordProtectionPublicationState> {
  const activeSnapshot = await getLatestSnapshot(formId);
  const currentSummary =
    getPasswordProtectionPublicationSnapshot(currentStructure);
  const publishedSummary = activeSnapshot
    ? getPasswordProtectionPublicationSnapshot(
        parseStoredStructure(activeSnapshot.structureJson),
      )
    : undefined;
  const current = currentSummary.publicSnapshot;
  const published = publishedSummary?.publicSnapshot ?? null;

  const isSynced =
    published === null
      ? !current.enabled && !current.has_password
      : current.enabled === published.enabled &&
        current.has_password === published.has_password &&
        current.password_hint === published.password_hint &&
        currentSummary.passwordHash === publishedSummary?.passwordHash;

  return PasswordProtectionPublicationStateSchema.parse({
    current,
    published,
    is_synced: isSynced,
  });
}

function maskNotificationSecrets(
  value: NonNullable<FormStructureType["notifications"]>,
): FormStructureType["notifications"] {
  return maskNotificationValue(value, []) as FormStructureType["notifications"];
}

function maskNotificationValue(value: unknown, path: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      maskNotificationValue(item, [...path, String(index)]),
    );
  }
  if (!isRecord(value)) return value;

  const masked = Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      maskNotificationValue(entryValue, [...path, entryKey]),
    ]),
  );
  const channel = path.at(-1);
  if (channel === "discord") {
    return {
      ...masked,
      webhook_url: undefined,
      has_webhook_url: !!value.webhook_url,
    };
  }
  if (channel === "webhook") {
    return {
      ...masked,
      url: undefined,
      secret: undefined,
      has_url: !!value.url,
      has_secret: !!value.secret,
    };
  }
  return masked;
}

function restoreMaskedNotificationSecrets(
  structure: FormStructureTransportType,
  currentStructure: FormStructureType,
): FormStructureTransportType {
  const notifications = structure.notifications;
  if (!notifications) return structure;

  return {
    ...structure,
    notifications: {
      ...notifications,
      on_submit: restoreMaskedNotificationChannels(
        notifications.on_submit,
        currentStructure.notifications?.on_submit,
      ),
      ...(notifications.on_duplicate_detected
        ? {
            on_duplicate_detected: restoreMaskedNotificationChannels(
              notifications.on_duplicate_detected,
              currentStructure.notifications?.on_duplicate_detected,
            ),
          }
        : {}),
    },
  };
}

function hasMaskedNotificationSecretFlags(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasMaskedNotificationSecretFlags(item));
  }
  if (!isRecord(value)) return false;

  if (
    value.has_webhook_url === true ||
    value.has_url === true ||
    value.has_secret === true
  ) {
    return true;
  }

  return Object.values(value).some((item) =>
    hasMaskedNotificationSecretFlags(item),
  );
}

function restoreMaskedNotificationChannels(
  channels: FormNotificationsTransport["on_submit"],
  currentChannels: FormNotifications["on_submit"] | undefined,
): FormNotificationsTransport["on_submit"] {
  const discord = channels.discord;
  const webhook = channels.webhook;
  const currentDiscord = currentChannels?.discord;
  const currentWebhook = currentChannels?.webhook;
  const restoredDiscordWebhookUrl =
    discord?.webhook_url ??
    (discord?.has_webhook_url ? currentDiscord?.webhook_url : undefined);
  const restoredWebhookUrl =
    webhook?.url ?? (webhook?.has_url ? currentWebhook?.url : undefined);

  return {
    ...channels,
    ...(discord
      ? {
          discord: {
            ...discord,
            enabled:
              discord.enabled &&
              (!discord.has_webhook_url || !!restoredDiscordWebhookUrl),
            webhook_url: restoredDiscordWebhookUrl,
            has_webhook_url: undefined,
          },
        }
      : {}),
    ...(webhook
      ? {
          webhook: {
            ...webhook,
            enabled:
              webhook.enabled && (!webhook.has_url || !!restoredWebhookUrl),
            url: restoredWebhookUrl,
            secret:
              webhook.secret ??
              (webhook.has_secret ? currentWebhook?.secret : undefined),
            has_url: undefined,
            has_secret: undefined,
          },
        }
      : {}),
  };
}

const formStructureMutationRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 30,
  keyGenerator: (c) => {
    const auth = c.get("dualAuthContext");
    const subject =
      auth?.user_id !== undefined
        ? `user:${auth.user_id}`
        : `ip:${getClientIp(c)}`;
    return `rate_limit:forms-structure:${subject}:${c.req.path}`;
  },
});

const FormStructureVersionSchema = z.object({
  id: z.string(),
  formId: z.string(),
  version: z.number().int().min(1),
  createdAt: isoDate,
  changeLog: z.string().nullable(),
  parentVersion: z.number().int().min(1).nullable(),
});

const FormStructureVersionResponseSchema = z.object({
  structure: FormStructureVersionSchema,
});
export type FormStructureVersionResponse = z.infer<
  typeof FormStructureVersionResponseSchema
>;

const FormStructureHistoryResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      version: z.number().int().min(1),
      createdAt: z.string().datetime(),
      createdBy: z.string().nullable(),
      changeLog: z.string().nullable(),
      isActive: z.boolean(),
      parentVersion: z.number().int().min(1).nullable(),
    }),
  ),
  pagination: servicePaginationSchema,
});
export type FormStructureHistoryResponse = z.infer<
  typeof FormStructureHistoryResponseSchema
>;

const StructureDiffChangeSchema = z.object({
  type: z.enum(["added", "removed", "modified"]),
  path: z.string(),
  from: z.unknown().optional(),
  to: z.unknown().optional(),
});

const FormStructureDiffResponseSchema = z.object({
  fromVersion: z.number().int().min(1),
  toVersion: z.number().int().min(1),
  changes: z.array(StructureDiffChangeSchema),
  metadata: z.object({
    memoryUsedMB: z.number(),
    calculationTime: z.number().int(),
  }),
});
export type FormStructureDiffResponse = z.infer<
  typeof FormStructureDiffResponseSchema
>;

const REDACTED_STRUCTURE_VALUE = "[redacted]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function redactSensitiveStructureValue(
  value: unknown,
  path: string[],
): unknown {
  const key = path.at(-1);
  const scope = path[0];
  const notificationChannel = path.at(-2);
  if (
    (scope === "notifications" &&
      ((notificationChannel === "discord" && key === "webhook_url") ||
        (notificationChannel === "webhook" &&
          (key === "url" || key === "secret")))) ||
    (scope === "access_control" && key === "password")
  ) {
    return REDACTED_STRUCTURE_VALUE;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      redactSensitiveStructureValue(item, [...path, String(index)]),
    );
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactSensitiveStructureValue(entryValue, [...path, entryKey]),
      ]),
    );
  }
  return value;
}

function redactStructureDiff(
  diff: z.infer<typeof FormStructureDiffResponseSchema>,
): z.infer<typeof FormStructureDiffResponseSchema> {
  return {
    ...diff,
    changes: diff.changes.map((change) => {
      const path = change.path.split(".");
      return {
        ...change,
        from:
          change.from === undefined
            ? undefined
            : redactSensitiveStructureValue(change.from, path),
        to:
          change.to === undefined
            ? undefined
            : redactSensitiveStructureValue(change.to, path),
      };
    }),
  };
}

const AccessControlUpdateResponseSchema = z.object({
  ok: z.literal(true),
  password_protection: z.object({
    enabled: z.boolean(),
    has_password: z.boolean(),
    password_hint: z.string().optional(),
  }),
});
export type AccessControlUpdateResponse = z.infer<
  typeof AccessControlUpdateResponseSchema
>;

export const formsStructureRouter = createHonoApp()
  .use("/:id/structure*", withDualFormAuth("VIEWER"))
  .get("/:id/structure", async (c) => {
    const formId = c.req.param("id");
    let structure: FormStructureType;
    try {
      structure = await getFormStructure(formId);
    } catch (error) {
      if (error instanceof FormStructureNotFoundError) {
        return c.json(formStructureError("Form structure not found"), 404);
      }
      throw error;
    }
    let passwordProtectionPublication:
      | PasswordProtectionPublicationState
      | undefined;
    try {
      passwordProtectionPublication =
        await getPasswordProtectionPublicationState(formId, structure);
    } catch {
      passwordProtectionPublication = undefined;
    }
    return c.json(
      FormStructureEnvelopeSchema.parse({
        structure: maskFormStructureSecrets(structure),
        password_protection_publication: passwordProtectionPublication,
      }),
    );
  })
  .put(
    "/:id/structure",
    withDualFormAuth("EDITOR"),
    formStructureMutationRateLimit,
    zValidator("json", structureUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(formStructureError("Unauthorized"), 401);
      const payload = c.req.valid("json");

      const result = await withFormStructureMutationLock(formId, async () => {
        let structure = payload.structure;
        const needsCurrentStructure =
          !!structure.access_control?.password_protection?.has_password ||
          hasMaskedNotificationSecretFlags(structure.notifications);
        const currentStructure = needsCurrentStructure
          ? await getFormStructure(formId)
          : undefined;
        const ac = structure.access_control;
        const pp = ac?.password_protection;
        if (ac && pp?.has_password && !pp.password) {
          const existingHash =
            currentStructure?.access_control?.password_protection?.password;
          if (existingHash) {
            structure = {
              ...structure,
              access_control: {
                ...ac,
                password_protection: {
                  ...pp,
                  password: existingHash,
                  has_password: undefined,
                },
              },
            };
          } else {
            // 並行 PATCH 等でハッシュが DB から消えていた場合、保護を無効化してフラグを除去する
            structure = {
              ...structure,
              access_control: {
                ...ac,
                password_protection: {
                  ...pp,
                  enabled: false,
                  has_password: undefined,
                },
              },
            };
          }
        } else if (ac && pp && pp.has_password !== undefined) {
          // has_password が false 等、上のブランチに該当しない場合もフラグを除去して DB に残さない
          structure = {
            ...structure,
            access_control: {
              ...ac,
              password_protection: { ...pp, has_password: undefined },
            },
          };
        }
        if (currentStructure) {
          structure = restoreMaskedNotificationSecrets(
            structure,
            currentStructure,
          );
        }

        return saveFormStructure(
          formId,
          FormStructure.parse(structure),
          resolveAuditUserId(auth.user_id),
          payload.changeLog,
        );
      }).catch((error) => {
        if (error instanceof FormStructureNotFoundError) {
          return null;
        }
        throw error;
      });
      if (!result) {
        return c.json(formStructureError("Form structure not found"), 404);
      }
      return c.json(
        FormStructureVersionResponseSchema.parse({ structure: result }),
      );
    },
  )
  .get(
    "/:id/structure/history",
    zValidator("query", historyQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const query = c.req.valid("query");
      const history = await getFormStructureHistory(formId, query);
      return c.json(FormStructureHistoryResponseSchema.parse(history));
    },
  )
  .get(
    "/:id/structure/diff",
    zValidator("query", formVersionDiffQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const query = c.req.valid("query");
      const diff = await getFormStructureDiff(
        formId,
        query.fromVersion,
        query.toVersion,
      );
      const parsedDiff = FormStructureDiffResponseSchema.parse(diff);
      return c.json(redactStructureDiff(parsedDiff));
    },
  )
  .post(
    "/:id/structure/restore",
    withDualFormAuth("EDITOR"),
    formStructureMutationRateLimit,
    zValidator("json", restoreSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(formStructureError("Unauthorized"), 401);
      const payload = c.req.valid("json");
      const restored = await withFormStructureMutationLock(formId, () =>
        restoreFormStructure(
          formId,
          payload.version,
          resolveAuditUserId(auth.user_id),
          payload.changeLog,
        ),
      );
      return c.json(
        FormStructureVersionResponseSchema.parse({ structure: restored }),
      );
    },
  )
  .patch(
    "/:id/structure/logic",
    withDualFormAuth("EDITOR"),
    formStructureMutationRateLimit,
    zValidator("json", logicUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(formStructureError("Unauthorized"), 401);
      const payload = c.req.valid("json");

      const result = await withFormStructureMutationLock(formId, async () => {
        const currentStructure = await getFormStructure(formId);

        return saveFormStructure(
          formId,
          {
            ...currentStructure,
            logic: payload.logic,
          },
          resolveAuditUserId(auth.user_id),
          "Update logic rules",
        );
      }).catch((error) => {
        if (error instanceof FormStructureNotFoundError) {
          return null;
        }
        throw error;
      });

      if (!result) {
        return c.json(formStructureError("Form structure not found"), 404);
      }

      return c.json(
        FormStructureVersionResponseSchema.parse({ structure: result }),
      );
    },
  )
  .patch(
    "/:id/structure/appearance",
    withDualFormAuth("EDITOR"),
    formStructureMutationRateLimit,
    zValidator("json", appearanceUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(formStructureError("Unauthorized"), 401);
      const payload = c.req.valid("json");

      const result = await withFormStructureMutationLock(formId, async () => {
        const currentStructure = await getFormStructure(formId);

        return saveFormStructure(
          formId,
          {
            ...currentStructure,
            appearance: payload.appearance,
          },
          resolveAuditUserId(auth.user_id),
          "Update appearance settings",
        );
      }).catch((error) => {
        if (error instanceof FormStructureNotFoundError) {
          return null;
        }
        throw error;
      });

      if (!result) {
        return c.json(formStructureError("Form structure not found"), 404);
      }

      return c.json(
        FormStructureVersionResponseSchema.parse({ structure: result }),
      );
    },
  )
  .patch(
    "/:id/structure/post-submit",
    withDualFormAuth("EDITOR"),
    formStructureMutationRateLimit,
    zValidator("json", postSubmitSettingsUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(formStructureError("Unauthorized"), 401);
      const payload = c.req.valid("json");

      const result = await withFormStructureMutationLock(formId, async () => {
        const currentStructure = await getFormStructure(formId);
        const currentOnSubmit = currentStructure.notifications?.on_submit ?? {};
        const requestedOnSubmit = payload.notifications.on_submit;
        const hasRequestedEmail = Object.hasOwn(requestedOnSubmit, "email");
        const hasRequestedDiscord = Object.hasOwn(requestedOnSubmit, "discord");
        const hasRequestedWebhook = Object.hasOwn(requestedOnSubmit, "webhook");
        const requestedDiscord = hasRequestedDiscord
          ? requestedOnSubmit.discord
          : undefined;
        const requestedWebhook = hasRequestedWebhook
          ? requestedOnSubmit.webhook
          : undefined;

        const discordWebhookUrl =
          requestedDiscord?.webhook_url ??
          (requestedDiscord?.has_webhook_url
            ? currentOnSubmit.discord?.webhook_url
            : undefined);
        const webhookUrl =
          requestedWebhook?.url ??
          (requestedWebhook?.has_url
            ? currentOnSubmit.webhook?.url
            : undefined);
        const webhookSecret =
          requestedWebhook?.secret ??
          (requestedWebhook?.has_secret
            ? currentOnSubmit.webhook?.secret
            : undefined);
        const webhookHeaders =
          requestedWebhook && Object.hasOwn(requestedWebhook, "headers")
            ? requestedWebhook.headers
            : currentOnSubmit.webhook?.headers;

        const notificationsResult = FormNotificationsSchema.safeParse({
          ...currentStructure.notifications,
          on_submit: {
            email: hasRequestedEmail
              ? requestedOnSubmit.email
              : currentOnSubmit.email,
            discord: hasRequestedDiscord
              ? requestedDiscord
                ? {
                    ...requestedDiscord,
                    webhook_url: discordWebhookUrl,
                    has_webhook_url: undefined,
                  }
                : undefined
              : currentOnSubmit.discord,
            webhook: hasRequestedWebhook
              ? requestedWebhook
                ? {
                    ...requestedWebhook,
                    url: webhookUrl,
                    secret: webhookSecret,
                    headers: webhookHeaders,
                    has_url: undefined,
                    has_secret: undefined,
                  }
                : undefined
              : currentOnSubmit.webhook,
          },
        });

        if (!notificationsResult.success) {
          return {
            error:
              notificationsResult.error.issues[0]?.message ??
              "Invalid post-submit notification settings",
          };
        }
        const confirmationCandidate = {
          ...currentStructure.confirmation,
          ...payload.confirmation,
        };
        if (payload.confirmation.supplemental_link === null) {
          delete confirmationCandidate.supplemental_link;
        }
        if (payload.confirmation.contact === null) {
          delete confirmationCandidate.contact;
        }

        const confirmationResult = FormConfirmationSchema.safeParse(
          confirmationCandidate,
        );
        if (!confirmationResult.success) {
          return {
            error:
              confirmationResult.error.issues[0]?.message ??
              "Invalid post-submit confirmation settings",
          };
        }

        return saveFormStructure(
          formId,
          {
            ...currentStructure,
            confirmation: confirmationResult.data,
            notifications: notificationsResult.data,
          },
          resolveAuditUserId(auth.user_id),
          "Update post-submit settings",
        );
      }).catch((error) => {
        if (error instanceof FormStructureNotFoundError) {
          return null;
        }
        throw error;
      });

      if (!result) {
        return c.json(formStructureError("Form structure not found"), 404);
      }
      if ("error" in result && typeof result.error === "string") {
        return c.json(formStructureError(result.error), 400);
      }

      return c.json(
        FormStructureVersionResponseSchema.parse({ structure: result }),
      );
    },
  )
  .patch(
    "/:id/structure/access-control",
    withDualFormAuth("EDITOR"),
    formStructureMutationRateLimit,
    zValidator("json", accessControlUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(formStructureError("Unauthorized"), 401);
      const payload = c.req.valid("json");

      const hashedPassword = payload.password_protection.password
        ? await hashPassword(payload.password_protection.password)
        : undefined;

      const result = await withFormStructureMutationLock(formId, async () => {
        let currentStructure: FormStructureType;
        try {
          currentStructure = await getFormStructure(formId);
        } catch (error) {
          if (error instanceof FormStructureNotFoundError) {
            return null;
          }
          throw error;
        }

        const currentAc = currentStructure.access_control ?? {
          require_authentication: false,
        };
        const currentPp = currentAc.password_protection;

        const newPassword = payload.password_protection.enabled
          ? (hashedPassword ?? currentPp?.password)
          : currentPp?.password;

        if (payload.password_protection.enabled && !newPassword) {
          return {
            error: "パスワードを設定してから保護を有効にしてください",
          };
        }

        // 空文字列は「ヒントを削除」として扱い、undefined は既存値を保持する
        const newHint =
          payload.password_protection.password_hint === ""
            ? undefined
            : (payload.password_protection.password_hint ??
              currentPp?.password_hint);

        const updatedStructure = {
          ...currentStructure,
          access_control: {
            ...currentAc,
            password_protection: {
              enabled: payload.password_protection.enabled,
              password: newPassword,
              password_hint: newHint,
            },
          },
        };

        await saveFormStructure(
          formId,
          updatedStructure,
          resolveAuditUserId(auth.user_id),
          "Update password protection settings",
        );

        return {
          passwordProtection: {
            enabled: payload.password_protection.enabled,
            has_password: !!newPassword,
            password_hint: newHint,
          },
        };
      });

      if (result === null) {
        return c.json(formStructureError("Form structure not found"), 404);
      }
      if ("error" in result && typeof result.error === "string") {
        return c.json(formStructureError(result.error), 400);
      }

      return c.json(
        AccessControlUpdateResponseSchema.parse({
          ok: true,
          password_protection: result.passwordProtection,
        }),
      );
    },
  );
