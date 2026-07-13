import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import {
  assertRequiredSecurityMigrationsApplied,
  db,
} from "@nexus-form/database";
import {
  externalServiceValidationResult,
  fingerprintDetail,
  form,
  formIntegration,
  formResponse,
  formSchedule,
} from "@nexus-form/database/schema";
import { providerRegistry } from "@nexus-form/integrations";
import {
  buildAutoSheetsSyncJobId,
  buildFormSubmitNotificationJobId,
  buildValidationOutboxJobId,
  extractQuestionsFromPlateContent,
  FormConfirmationSchema,
  type FormNotifications,
  type FormStatusValue,
  genericValidationJobDataSchema,
  getValidationResultId,
  MAX_RESPONSE_BODY_BYTES,
  MAX_RESPONSE_ID_LENGTH,
  MAX_RESPONSE_ITEMS,
  responsePayloadItemSchema,
} from "@nexus-form/shared";
import { and, count, eq, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { parseStoredStructure } from "../lib/forms/parse-stored-structure";
import { MAX_PUBLIC_PASSWORD_LENGTH } from "../lib/forms/password-protection";
import { validateShareLink } from "../lib/forms/permission-service";
import {
  buildQuestionsFromPlateContentStrict,
  buildReachableQuestionIdsFromPlateContentStrict,
  PlateQuestionBuildError,
} from "../lib/forms/plate-question-builder";
import { buildPublicFormStructure } from "../lib/forms/public-structure";
import {
  buildResponseAnswerRecord,
  validateReachableResponseData,
  validateResponseData,
} from "../lib/forms/response-validator";
import { logFormScheduleError } from "../lib/forms/schedule-error-logging";
import { processFormSchedule } from "../lib/forms/schedule-processor";
import {
  getActivePublication,
  getLatestSnapshot,
} from "../lib/forms/snapshot-repository";
import {
  insertSubmitOutboxRows,
  recoverSubmitOutboxForResponse,
  type SubmitOutboxInsert,
} from "../lib/forms/submit-outbox-sweeper";
import type { TransactionClient } from "../lib/forms/types";
import { parseValidationRuleSnapshot } from "../lib/forms/validation-rule-repository";
import { createHonoApp } from "../lib/hono";
import { extractClientIP } from "../lib/ip-address";
import { logError, logWarn } from "../lib/logger";
import { getValidationQueue, isValidServiceName } from "../lib/queues";
import { createRateLimit, getClientIp } from "../lib/rate-limit";
import { createRequestBodySizeLimit } from "../lib/request-body-size-limit";
import { stringifyResponseDataJson } from "../lib/response-data-json";
import { isFormSecurityBypassEnabled } from "../lib/security/form-security-bypass";
import { verifyHCaptcha } from "../lib/security/hcaptcha";
import { verifyPassword } from "../lib/security/password";
import { captureError } from "../lib/sentry";
import {
  extractJwtFromRequest,
  type PasswordGrantContext,
  resolveSessionIdOrCreate,
  signSessionJwt,
  verifySessionJwt,
} from "../lib/sessions/jwt";
import { consumeTokensOrThrow } from "../lib/telemetry/tokens";
import { errorResponse } from "../types/domain/common";
import type { FormSnapshot } from "../types/domain/form-snapshot";
import {
  PasswordRequiredErrorResponseSchema,
  PublicFormResponseSchema,
  PublicSubmitLimitErrorResponseSchema,
  PublicSubmitResponseSchema,
  SharedFormResponseSchema,
  VerifyPasswordResponseSchema,
} from "../types/domain/public-form";

export { MAX_PUBLIC_PASSWORD_LENGTH } from "../lib/forms/password-protection";

// ── Schemas ──────────────────────────────────────────────────────────

const MAX_FINGERPRINTS = 200;
const MAX_FINGERPRINT_VALUE_LENGTH = 255;
export const MAX_PUBLIC_PASSWORD_REQUEST_BODY_BYTES = 8 * 1024;
const MAX_TOKEN_LENGTH = 4_096;
const MAX_USER_AGENT_LENGTH = 512;
const responseBodySizeLimit = createRequestBodySizeLimit({
  maxBytes: MAX_RESPONSE_BODY_BYTES,
});
const publicPasswordRequestBodySizeLimit = createRequestBodySizeLimit({
  maxBytes: MAX_PUBLIC_PASSWORD_REQUEST_BODY_BYTES,
});

let publicMigrationGate: Promise<void> | null = null;
function assertPublicMigrationGate(): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    return Promise.resolve();
  }

  if (!publicMigrationGate) {
    publicMigrationGate = (async () => {
      try {
        await assertRequiredSecurityMigrationsApplied();
      } catch (error) {
        publicMigrationGate = null;
        throw error;
      }
    })();
  }

  return publicMigrationGate;
}

function publicFormRateLimitKey(
  c: Parameters<typeof getClientIp>[0],
  scope: "public_form_get" | "shared_link_get",
  resourceId: string,
): string {
  const ip = getClientIp(c);
  if (ip === "unknown") {
    // Per-resource bucket prevents one form from exhausting another's limit.
    // Trade-off: one unknown-IP source may consume 60 req/min per publicId/token
    // (vs 60 total for a known IP). Acceptable blast-radius reduction for R12-M3.
    return `rate_limit:${scope}:unknown:${resourceId}`;
  }
  return `rate_limit:${scope}:${ip}`;
}

const publicFormGetRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 60,
  keyGenerator: (c) =>
    publicFormRateLimitKey(
      c,
      "public_form_get",
      c.req.param("publicId") ?? "missing",
    ),
});
const sharedLinkGetRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 60,
  keyGenerator: (c) =>
    publicFormRateLimitKey(
      c,
      "shared_link_get",
      c.req.param("token") ?? "missing",
    ),
});
const publicFormSelect = {
  id: form.id,
  publicId: form.publicId,
  title: form.title,
  description: form.description,
  creatorId: form.creatorId,
  status: form.status,
  publishedAt: form.publishedAt,
  unpublishedAt: form.unpublishedAt,
  allowEditResponses: form.allowEditResponses,
  createdAt: form.createdAt,
  updatedAt: form.updatedAt,
  version: form.version,
  plateContent: form.plateContent,
  plateContentVersion: form.plateContentVersion,
  baseSnapshotVersion: form.baseSnapshotVersion,
  dueScheduleId: formSchedule.id,
};
const publicFormAccessSelect = {
  id: form.id,
  status: form.status,
  dueScheduleId: formSchedule.id,
};

const publicSubmitSchema = z.object({
  responses: z.array(responsePayloadItemSchema).max(MAX_RESPONSE_ITEMS),
  respondentUuid: z.string().max(MAX_RESPONSE_ID_LENGTH).optional(),
  submittedAt: z.string().datetime().optional(),
  captchaToken: z
    .string()
    .min(1, "hCaptcha token is required")
    .max(MAX_TOKEN_LENGTH),
  telemetry: z
    .object({
      v4Token: z.string().max(MAX_TOKEN_LENGTH).optional(),
      v6Token: z.string().max(MAX_TOKEN_LENGTH).optional(),
    })
    .refine((data) => data.v4Token || data.v6Token, {
      message: "At least one telemetry token is required",
    }),
  fingerprints: z
    .array(
      z.object({
        type: z.enum(["fingerprintjs", "thumbmarkjs", "browser"]),
        name: z.string().min(1).max(MAX_FINGERPRINT_VALUE_LENGTH),
        value_hash: z.string().min(1).max(MAX_FINGERPRINT_VALUE_LENGTH),
      }),
    )
    .max(MAX_FINGERPRINTS),
});

const verifyPasswordSchema = z.object({
  password: z.string().min(1).max(MAX_PUBLIC_PASSWORD_LENGTH),
});

// ── Types ────────────────────────────────────────────────────────────

type ParsedStructure = ReturnType<typeof parseStoredStructure>;
type PasswordProtection = NonNullable<
  ParsedStructure["access_control"]
>["password_protection"];

// ── Helpers ──────────────────────────────────────────────────────────

function logInvalidPublishedConfiguration(
  reason: string,
  metadata: { formId: string; publicId: string; operation: string },
  error?: unknown,
): void {
  logError(reason, "forms-public", {
    ...metadata,
    ...(error ? { error } : {}),
  });
}

function parsePublishedStructure(
  structureJson: string | undefined,
  metadata: { formId: string; publicId: string; operation: string },
): ParsedStructure | null {
  if (!structureJson) {
    logInvalidPublishedConfiguration(
      "Published form snapshot is missing structureJson",
      metadata,
    );
    return null;
  }

  try {
    return parseStoredStructure(structureJson);
  } catch (error) {
    logInvalidPublishedConfiguration(
      "Published form snapshot has invalid structureJson",
      metadata,
      error,
    );
    return null;
  }
}

function buildPublishedQuestions(
  plateContent: string | null | undefined,
  metadata: { formId: string; publicId: string; operation: string },
) {
  if (!plateContent) {
    logInvalidPublishedConfiguration(
      "Published form is missing plateContent",
      metadata,
    );
    return null;
  }

  try {
    return buildQuestionsFromPlateContentStrict(plateContent);
  } catch (error) {
    logInvalidPublishedConfiguration(
      error instanceof PlateQuestionBuildError
        ? error.message
        : "Published form has invalid plateContent",
      metadata,
      error,
    );
    return null;
  }
}

function getPasswordProtection(
  parsed: ParsedStructure,
): PasswordProtection | undefined {
  return parsed.access_control?.password_protection;
}

function buildSubmitConfirmation(parsed: ParsedStructure) {
  return FormConfirmationSchema.parse(parsed.confirmation ?? {});
}

function getEnabledSubmitNotificationChannels(
  notifications: ParsedStructure["notifications"],
): FormNotifications["on_submit"] | null {
  const onSubmit = notifications?.on_submit;
  if (!onSubmit) return null;

  const enabledChannels: FormNotifications["on_submit"] = {};
  const email = onSubmit.email;
  if (email?.enabled && email.recipients.length > 0) {
    enabledChannels.email = email;
  }

  const discord = onSubmit.discord;
  if (discord?.enabled && discord.webhook_url) {
    enabledChannels.discord = discord;
  }

  const webhook = onSubmit.webhook;
  if (webhook?.enabled && webhook.url) {
    enabledChannels.webhook = webhook;
  }

  return enabledChannels.email ||
    enabledChannels.discord ||
    enabledChannels.webhook
    ? enabledChannels
    : null;
}

function isPasswordVerified(
  jwtToken: string,
  passwordGrant: PasswordGrantContext,
): boolean {
  return verifySessionJwt(jwtToken, passwordGrant) !== null;
}

async function getAuthoritativeProtectedPublication(params: {
  formId: string;
  publicId: string;
  operation: string;
}): Promise<{
  activeSnapshot: FormSnapshot;
  parsedStructure: ParsedStructure;
  publicPasswordGrantGeneration: bigint;
} | null> {
  const publication = await getActivePublication(params.formId);
  const parsedStructure = parsePublishedStructure(
    publication?.snapshot.structureJson,
    {
      formId: params.formId,
      publicId: params.publicId,
      operation: params.operation,
    },
  );
  if (!publication || !parsedStructure) return null;

  return {
    activeSnapshot: publication.snapshot,
    parsedStructure,
    publicPasswordGrantGeneration: publication.publicPasswordGrantGeneration,
  };
}

function setSessionCookie(
  c: { header: (name: string, value: string) => void },
  jwt: string,
) {
  c.header(
    "Set-Cookie",
    [
      `cf_session=${jwt}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      process.env.NODE_ENV === "production" ? "Secure" : null,
      "Max-Age=1209600",
    ]
      .filter(Boolean)
      .join("; "),
  );
}

function extractBlockIdsFromPlateContent(plateContent: string): Set<string> {
  try {
    const parsed = JSON.parse(plateContent);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      extractQuestionsFromPlateContent(parsed).map((q) => q.blockId),
    );
  } catch {
    return new Set();
  }
}

async function resolveScheduledStatus(params: {
  formId: string;
  currentStatus: FormStatusValue;
  dueScheduleId: string | null | undefined;
  currentTime: Date;
  publicId: string;
  operation: string;
}): Promise<FormStatusValue | null> {
  const { formId, currentStatus, dueScheduleId, currentTime, publicId } =
    params;
  if (!dueScheduleId) return currentStatus;

  const scheduleResult = await processFormSchedule(formId, currentTime).catch(
    (error) =>
      logFormScheduleError(error, {
        formId,
        publicId,
        operation: params.operation,
      }),
  );
  if (!scheduleResult) return null;

  // ScheduleProcessResult always carries the latest locked form status,
  // including no-op and already-processed schedule paths.
  return scheduleResult.newStatus;
}

async function resolvePublishedPublicFormStatus(params: {
  formId: string;
  currentStatus: FormStatusValue;
  dueScheduleId: string | null | undefined;
  currentTime: Date;
  publicId: string;
  operation: string;
}) {
  const currentStatus = await resolveScheduledStatus({
    formId: params.formId,
    currentStatus: params.currentStatus,
    dueScheduleId: params.dueScheduleId,
    currentTime: params.currentTime,
    publicId: params.publicId,
    operation: params.operation,
  });

  return currentStatus === "PUBLISHED" ? currentStatus : null;
}

async function resolvePublishedPublicForm(params: {
  publicId: string;
  currentTime: Date;
  operation: string;
}) {
  const { publicId, currentTime, operation } = params;
  const [target] = await db
    .select(publicFormSelect)
    .from(form)
    .leftJoin(
      formSchedule,
      and(
        eq(formSchedule.formId, form.id),
        isNull(formSchedule.processedAt),
        lte(formSchedule.triggerAt, currentTime),
      ),
    )
    .where(eq(form.publicId, publicId))
    .limit(1);

  if (!target) return null;

  const currentStatus = await resolvePublishedPublicFormStatus({
    formId: target.id,
    currentStatus: target.status,
    dueScheduleId: target.dueScheduleId,
    currentTime,
    publicId,
    operation,
  });

  if (currentStatus !== "PUBLISHED") return null;

  return { target, currentStatus };
}

async function resolvePublishedPublicFormAccess(params: {
  publicId: string;
  currentTime: Date;
  operation: string;
}) {
  const { publicId, currentTime, operation } = params;
  const [target] = await db
    .select(publicFormAccessSelect)
    .from(form)
    .leftJoin(
      formSchedule,
      and(
        eq(formSchedule.formId, form.id),
        isNull(formSchedule.processedAt),
        lte(formSchedule.triggerAt, currentTime),
      ),
    )
    .where(eq(form.publicId, publicId))
    .limit(1);

  if (!target) return null;

  const currentStatus = await resolvePublishedPublicFormStatus({
    formId: target.id,
    currentStatus: target.status,
    dueScheduleId: target.dueScheduleId,
    currentTime,
    publicId,
    operation,
  });

  if (currentStatus !== "PUBLISHED") return null;

  return { target, currentStatus };
}

// ── Router ───────────────────────────────────────────────────────────

export const formsPublicRouter = createHonoApp()
  .use(async (_c, next) => {
    await assertPublicMigrationGate();
    await next();
  })
  // ── GET /public/:publicId ────────────────────────────────────────
  .get("/public/:publicId", publicFormGetRateLimit, async (c) => {
    const publicId = c.req.param("publicId");
    const currentTime = new Date();
    const resolved = await resolvePublishedPublicForm({
      currentTime,
      publicId,
      operation: "GET /public/:publicId",
    });
    if (!resolved) {
      return c.json(errorResponse("Form not found"), 404);
    }
    const { target, currentStatus } = resolved;

    let activeSnapshot = await getLatestSnapshot(target.id);

    const parsedStructure = parsePublishedStructure(
      activeSnapshot?.structureJson,
      {
        formId: target.id,
        publicId,
        operation: "GET /public/:publicId",
      },
    );
    if (!parsedStructure || !activeSnapshot) {
      return c.json(errorResponse("Form configuration is invalid"), 500);
    }

    let effectiveStructure = parsedStructure;
    let pwProtection = getPasswordProtection(effectiveStructure);
    let isProtected = pwProtection?.enabled ?? false;

    if (isProtected) {
      if (!pwProtection?.password) {
        logError(
          "Password protection is enabled without a password hash",
          "forms-public",
          { formId: target.id, publicId },
        );
        return c.json(
          errorResponse("Form password protection is misconfigured"),
          500,
        );
      }

      const jwtToken = extractJwtFromRequest(c);
      if (!jwtToken) {
        const response = PublicFormResponseSchema.parse({
          form: {
            id: target.id,
            publicId: target.publicId,
            title: target.title,
            description: target.description,
            status: currentStatus,
            isPasswordProtected: true,
            passwordHint: pwProtection.password_hint,
          },
          structure: null,
          plateContent: null,
        });
        return c.json(response);
      }

      const publication = await getAuthoritativeProtectedPublication({
        formId: target.id,
        publicId,
        operation: "GET /public/:publicId",
      });
      if (!publication) {
        return c.json(errorResponse("Form configuration is invalid"), 500);
      }
      activeSnapshot = publication.activeSnapshot;
      effectiveStructure = publication.parsedStructure;
      pwProtection = getPasswordProtection(effectiveStructure);
      isProtected = pwProtection?.enabled ?? false;

      if (isProtected && !pwProtection?.password) {
        logError(
          "Password protection is enabled without a password hash",
          "forms-public",
          { formId: target.id, publicId },
        );
        return c.json(
          errorResponse("Form password protection is misconfigured"),
          500,
        );
      }

      if (
        isProtected &&
        !isPasswordVerified(jwtToken, {
          formId: target.id,
          publicPasswordGrantGeneration:
            publication.publicPasswordGrantGeneration,
        })
      ) {
        const response = PublicFormResponseSchema.parse({
          form: {
            id: target.id,
            publicId: target.publicId,
            title: target.title,
            description: target.description,
            status: currentStatus,
            isPasswordProtected: true,
            passwordHint: pwProtection?.password_hint,
          },
          structure: null,
          plateContent: null,
        });
        return c.json(response);
      }
    }

    const publishedContent = activeSnapshot?.plateContent;
    const questions = buildPublishedQuestions(publishedContent, {
      formId: target.id,
      publicId,
      operation: "GET /public/:publicId",
    });
    if (!questions) {
      return c.json(errorResponse("Form configuration is invalid"), 500);
    }

    const response = PublicFormResponseSchema.parse({
      form: {
        id: target.id,
        publicId: target.publicId,
        title: target.title,
        description: target.description,
        status: currentStatus,
        isPasswordProtected: isProtected,
        passwordHint: pwProtection?.password_hint,
      },
      structure: buildPublicFormStructure(effectiveStructure),
      plateContent: publishedContent,
    });
    return c.json(response);
  })

  // ── POST /public/:publicId/submit ────────────────────────────────
  .post(
    "/public/:publicId/submit",
    createRateLimit({ windowMs: 60 * 1000, maxRequests: 10 }),
    responseBodySizeLimit,
    zValidator("json", publicSubmitSchema),
    async (c) => {
      const publicId = c.req.param("publicId");
      const payload = c.req.valid("json");
      const submitIpResult = extractClientIP(c.req.raw, {
        strategy: "general",
      });
      const { ip } = submitIpResult;
      const formSecurityBypassEnabled = isFormSecurityBypassEnabled();

      // 1. Verify hCaptcha before any form-specific work.
      const captchaValid = await verifyHCaptcha(payload.captchaToken, {
        remoteip: ip,
      });
      if (!captchaValid) {
        return c.json(errorResponse("Captcha verification failed"), 403);
      }

      // 2. Look up form
      const currentTime = new Date();
      const resolved = await resolvePublishedPublicFormAccess({
        currentTime,
        publicId,
        operation: "POST /public/:publicId/submit",
      });
      if (!resolved) {
        return c.json(errorResponse("Form not found"), 404);
      }
      const { target } = resolved;

      let activeSnapshot = await getLatestSnapshot(target.id);

      let parsedStructure = parsePublishedStructure(
        activeSnapshot?.structureJson,
        {
          formId: target.id,
          publicId,
          operation: "POST /public/:publicId/submit",
        },
      );
      if (!parsedStructure || !activeSnapshot) {
        return c.json(errorResponse("Form configuration is invalid"), 500);
      }

      // 3. Password protection check. Keep this before question validation and
      // telemetry so locked forms do not leak structure-derived failures.
      let pwProtection = getPasswordProtection(parsedStructure);

      if (pwProtection?.enabled) {
        if (!pwProtection.password) {
          logError(
            "Password protection is enabled without a password hash",
            "forms-public",
            { formId: target.id, publicId },
          );
          return c.json(
            errorResponse("Form password protection is misconfigured"),
            500,
          );
        }

        const jwtToken = extractJwtFromRequest(c);
        if (!jwtToken) {
          return c.json(
            PasswordRequiredErrorResponseSchema.parse({
              error: "Password verification required",
              passwordRequired: true,
              passwordHint: pwProtection.password_hint,
            }),
            403,
          );
        }

        const publication = await getAuthoritativeProtectedPublication({
          formId: target.id,
          publicId,
          operation: "POST /public/:publicId/submit",
        });
        if (!publication) {
          return c.json(errorResponse("Form configuration is invalid"), 500);
        }
        activeSnapshot = publication.activeSnapshot;
        parsedStructure = publication.parsedStructure;
        pwProtection = getPasswordProtection(parsedStructure);

        if (pwProtection?.enabled && !pwProtection.password) {
          logError(
            "Password protection is enabled without a password hash",
            "forms-public",
            { formId: target.id, publicId },
          );
          return c.json(
            errorResponse("Form password protection is misconfigured"),
            500,
          );
        }

        if (
          pwProtection?.enabled &&
          !isPasswordVerified(jwtToken, {
            formId: target.id,
            publicPasswordGrantGeneration:
              publication.publicPasswordGrantGeneration,
          })
        ) {
          return c.json(
            PasswordRequiredErrorResponseSchema.parse({
              error: "Password verification required",
              passwordRequired: true,
              passwordHint: pwProtection?.password_hint,
            }),
            403,
          );
        }
      }

      // 4. Answer validation against active snapshot's plateContent-derived questions.
      // Run before quota checks to reject malformed payloads cheaply.
      const publishedContent = activeSnapshot?.plateContent;
      if (!publishedContent) {
        logInvalidPublishedConfiguration(
          "Published form is missing plateContent",
          {
            formId: target.id,
            publicId,
            operation: "POST /public/:publicId/submit",
          },
        );
        return c.json(errorResponse("Form configuration is invalid"), 500);
      }
      const questions = buildPublishedQuestions(publishedContent, {
        formId: target.id,
        publicId,
        operation: "POST /public/:publicId/submit",
      });
      if (!questions) {
        return c.json(errorResponse("Form configuration is invalid"), 500);
      }
      if (questions.length === 0) {
        return c.json(errorResponse("このフォームには質問がありません"), 400);
      }
      const answerValidation = validateResponseData(payload.responses, {
        version: 1,
        settings: {},
        questions,
      });
      if (!answerValidation.isValid) {
        logWarn("POST: response validation failed", "forms-public", {
          publicId,
          errors: answerValidation.errors,
        });
        return c.json(errorResponse("Invalid response data"), 400);
      }
      const reachableQuestionIds =
        buildReachableQuestionIdsFromPlateContentStrict(
          publishedContent,
          buildResponseAnswerRecord(payload.responses),
        );
      const reachabilityValidation = validateReachableResponseData(
        payload.responses,
        reachableQuestionIds,
      );
      if (!reachabilityValidation.isValid) {
        logWarn(
          "POST: response reachability validation failed",
          "forms-public",
          {
            publicId,
            errors: reachabilityValidation.errors,
          },
        );
        return c.json(errorResponse("Invalid response data"), 400);
      }

      // 5. Verify and consume telemetry tokens
      const telemetryTokens = [
        payload.telemetry.v4Token,
        payload.telemetry.v6Token,
      ].filter((t): t is string => !!t);

      if (!formSecurityBypassEnabled) {
        if (ip === "unknown") {
          logWarn("POST: telemetry token IP detection failed", "forms-public", {
            publicId,
            strategy: "general",
            source: submitIpResult.source,
            hasXForwardedFor: c.req.header("x-forwarded-for") !== undefined,
            hasXNginxForwardedFor:
              c.req.header("x-nginx-forwarded-for") !== undefined,
          });
          return c.json(errorResponse("Unable to determine client IP"), 400);
        }

        if (c.req.header("x-nginx-forwarded-for") !== undefined) {
          const telemetryIpResult = extractClientIP(c.req.raw, {
            strategy: "telemetry",
          });
          if (
            telemetryIpResult.ip !== "unknown" &&
            telemetryIpResult.ip !== ip
          ) {
            logWarn(
              "POST: telemetry token IP header mismatch",
              "forms-public",
              {
                publicId,
                submitStrategy: "general",
                submitSource: submitIpResult.source,
                telemetryStrategy: "telemetry",
                telemetrySource: telemetryIpResult.source,
              },
            );
            return c.json(errorResponse("Unable to determine client IP"), 400);
          }
        }

        try {
          await consumeTokensOrThrow(telemetryTokens, ip);
        } catch {
          return c.json(
            errorResponse("Invalid or expired telemetry tokens"),
            403,
          );
        }
      }

      // 6. Response limit variable (enforcement happens inside atomic transaction)
      const responseLimit = parsedStructure.settings?.response_limit;
      const requireFingerprint =
        !formSecurityBypassEnabled &&
        (parsedStructure.settings?.require_fingerprint ?? true);
      if (requireFingerprint && payload.fingerprints.length === 0) {
        return c.json(errorResponse("Fingerprint data is required"), 400);
      }
      const fingerprints = requireFingerprint ? payload.fingerprints : [];

      // 7+9+10. Atomically enforce response limit and persist response/fingerprints
      const responseId = randomUUID();
      const respondentUuid = payload.respondentUuid ?? randomUUID();
      const responseDataJson = stringifyResponseDataJson(payload.responses);
      if (!responseDataJson) {
        return c.json(errorResponse("Response payload is too large"), 400);
      }
      // 8. Session management is resolved inside the response transaction so
      // response-limit rejection cannot leave an unreachable FormSession row.
      const userAgent = c.req.header("user-agent") ?? undefined;
      if (userAgent && userAgent.length > MAX_USER_AGENT_LENGTH) {
        return c.json(errorResponse("User-Agent is too long"), 400);
      }

      const jwtToken = extractJwtFromRequest(c);
      const [submitIntegration] = await db
        .select({ id: formIntegration.id })
        .from(formIntegration)
        .where(eq(formIntegration.formId, target.id))
        .limit(1);

      type PublicSubmitInsertResult =
        | {
            limitReached: true;
            message: string;
          }
        | {
            limitReached: false;
            hasSubmitOutbox: boolean;
            validationOutbox: ValidationOutbox | null;
            sessionJwt: string;
          };

      const insertResult: PublicSubmitInsertResult = await db.transaction(
        async (tx) => {
          if (responseLimit?.enabled && responseLimit.max_responses) {
            // Acquire exclusive lock on the form row to serialize concurrent
            // submissions and prevent TOCTOU on the response limit check.
            // This must be the first transactional read: a preceding
            // non-locking SELECT would establish a stale REPEATABLE READ view
            // before this transaction waits for the form row lock.
            await tx
              .select({ id: form.id })
              .from(form)
              .where(eq(form.id, target.id))
              .for("update");
          }

          if (responseLimit?.enabled && responseLimit.max_responses) {
            const [existingCount] = await tx
              .select({ count: count() })
              .from(formResponse)
              .where(eq(formResponse.formId, target.id));

            if ((existingCount?.count ?? 0) >= responseLimit.max_responses) {
              return {
                limitReached: true as const,
                message:
                  responseLimit.message ??
                  "This form has reached its response limit",
              };
            }
          }

          const { sessionId, jwt: sessionJwt } = await resolveSessionIdOrCreate(
            jwtToken,
            { ip, ua: userAgent },
            tx,
          );

          const validationOutbox = activeSnapshot
            ? await buildExternalValidationOutbox(
                tx,
                responseId,
                activeSnapshot,
              )
            : null;

          const submitOutboxRows: SubmitOutboxInsert[] = [];
          if (
            activeSnapshot &&
            getEnabledSubmitNotificationChannels(parsedStructure.notifications)
          ) {
            submitOutboxRows.push({
              id: buildFormSubmitNotificationJobId(target.id, responseId),
              responseId,
              formId: target.id,
              effectType: "NOTIFICATION",
              snapshotVersion: activeSnapshot.version,
              integrationId: null,
            });
          }
          if (submitIntegration) {
            submitOutboxRows.push({
              id: buildAutoSheetsSyncJobId(submitIntegration.id, responseId),
              responseId,
              formId: target.id,
              effectType: "SHEETS",
              snapshotVersion: activeSnapshot?.version ?? null,
              integrationId: submitIntegration.id,
            });
          }

          await tx.insert(formResponse).values({
            id: responseId,
            formId: target.id,
            responseDataJson,
            respondentUuid,
            sessionId,
            userAgent: userAgent ?? null,
            countryCode: null,
          });

          if (fingerprints.length > 0) {
            await tx.insert(fingerprintDetail).values(
              fingerprints.map((fp) => ({
                id: randomUUID(),
                responseId,
                fingerprintType: fp.type,
                componentName: fp.name,
                componentValue: "",
                componentValueHash: fp.value_hash,
              })),
            );
          }

          if (validationOutbox) {
            await insertExternalValidationOutbox(tx, validationOutbox);
          }

          await insertSubmitOutboxRows(tx, submitOutboxRows);

          return {
            limitReached: false as const,
            hasSubmitOutbox: submitOutboxRows.length > 0,
            validationOutbox,
            sessionJwt,
          };
        },
      );

      if (insertResult.limitReached) {
        return c.json(
          PublicSubmitLimitErrorResponseSchema.parse({
            error: insertResult.message,
            responseLimitReached: true,
          }),
          403,
        );
      }

      // Set session cookie only after a successful submission
      setSessionCookie(c, insertResult.sessionJwt);

      // 11. Load the created response so background jobs can reuse the
      // database-side submittedAt timestamp.
      const [createdResponse] = await db
        .select()
        .from(formResponse)
        .where(eq(formResponse.id, responseId))
        .limit(1);

      // 12. Queue external validation jobs (non-blocking)
      if (
        !insertResult.limitReached &&
        insertResult.validationOutbox &&
        insertResult.validationOutbox.pendingJobs.length > 0
      ) {
        enqueueExternalValidationJobs(
          responseId,
          insertResult.validationOutbox,
        ).catch((error) => {
          logError("Failed to queue external validations", "api", {
            error,
            responseId,
            formId: target.id,
          });
          captureError(error);
        });
      }

      // 13+14. Kick durable notification and Sheets recovery. The outbox rows
      // were committed with the response, so Redis failure or process exit is
      // recovered by the periodic startup sweeper.
      if (insertResult.hasSubmitOutbox) {
        recoverSubmitOutboxForResponse(responseId);
      }

      // 15. Return the created response
      const submitResponse = PublicSubmitResponseSchema.parse({
        responseId,
        response: createdResponse ?? null,
        confirmation: buildSubmitConfirmation(parsedStructure),
      });
      return c.json(submitResponse, 201);
    },
  )

  // ── POST /public/:publicId/verify-password ───────────────────────
  .post(
    "/public/:publicId/verify-password",
    createRateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 10 }),
    publicPasswordRequestBodySizeLimit,
    zValidator("json", verifyPasswordSchema),
    async (c) => {
      const publicId = c.req.param("publicId");
      const payload = c.req.valid("json");

      const currentTime = new Date();
      const resolved = await resolvePublishedPublicFormAccess({
        currentTime,
        publicId,
        operation: "POST /public/:publicId/verify-password",
      });
      if (!resolved) {
        return c.json(errorResponse("Form not found"), 404);
      }
      const { target } = resolved;

      let activeSnapshot = await getLatestSnapshot(target.id);
      let parsed = parsePublishedStructure(activeSnapshot?.structureJson, {
        formId: target.id,
        publicId,
        operation: "POST /public/:publicId/verify-password",
      });
      if (!parsed || !activeSnapshot) {
        return c.json(errorResponse("Form configuration is invalid"), 500);
      }

      let pwProtection = getPasswordProtection(parsed);

      if (!pwProtection?.enabled) {
        return c.json(VerifyPasswordResponseSchema.parse({ valid: true }));
      }

      if (!pwProtection.password) {
        logError(
          "Password protection is enabled without a password hash",
          "forms-public",
          { formId: target.id, publicId },
        );
        return c.json(
          errorResponse("Form password protection is misconfigured"),
          500,
        );
      }

      const publication = await getAuthoritativeProtectedPublication({
        formId: target.id,
        publicId,
        operation: "POST /public/:publicId/verify-password",
      });
      if (!publication) {
        return c.json(errorResponse("Form configuration is invalid"), 500);
      }
      activeSnapshot = publication.activeSnapshot;
      parsed = publication.parsedStructure;
      pwProtection = getPasswordProtection(parsed);

      if (!pwProtection?.enabled) {
        return c.json(VerifyPasswordResponseSchema.parse({ valid: true }));
      }

      if (!pwProtection.password) {
        logError(
          "Password protection is enabled without a password hash",
          "forms-public",
          { formId: target.id, publicId },
        );
        return c.json(
          errorResponse("Form password protection is misconfigured"),
          500,
        );
      }

      const valid = await verifyPassword(
        payload.password,
        pwProtection.password,
      );

      if (!valid) {
        return c.json(VerifyPasswordResponseSchema.parse({ valid: false }));
      }

      // Issue a publication-bound V2 grant. Legacy verifiedForms claims are
      // intentionally not copied into newly issued tokens.
      const existingJwt = extractJwtFromRequest(c);
      const existing = existingJwt ? verifySessionJwt(existingJwt) : null;

      const { ip } = extractClientIP(c.req.raw, { strategy: "general" });
      const userAgent = c.req.header("user-agent") ?? undefined;
      const { sessionId } = await resolveSessionIdOrCreate(existingJwt, {
        ip,
        ua: userAgent,
      });

      const newJwt = signSessionJwt(sessionId, {
        verifiedFormGrants: existing?.verifiedFormGrants ?? [],
        passwordGrant: {
          formId: target.id,
          publicPasswordGrantGeneration:
            publication.publicPasswordGrantGeneration,
        },
      });
      setSessionCookie(c, newJwt);

      return c.json(VerifyPasswordResponseSchema.parse({ valid: true }));
    },
  )

  // ── GET /shared/:token ───────────────────────────────────────────
  .get("/shared/:token", sharedLinkGetRateLimit, async (c) => {
    const token = c.req.param("token");

    // validateShareLink のドメインエラーのみ 404 に変換する。
    // レスポンス整形・schema parse は try の外に置き、ZodError 等が
    // 404 に誤って握り潰されないようにする。
    let result: Awaited<ReturnType<typeof validateShareLink>>;
    try {
      result = await validateShareLink(token);
    } catch {
      return c.json(errorResponse("Share link not found"), 404);
    }

    const { share_link } = result;
    const sharedResponse = SharedFormResponseSchema.parse({
      form: result.form,
      role: result.role,
      share_link: {
        id: share_link.id,
        form_id: share_link.form_id,
        role: share_link.role,
        is_active: share_link.is_active,
        expires_at: share_link.expires_at,
        created_at: share_link.created_at,
        updated_at: share_link.updated_at,
        created_by: share_link.created_by,
      },
    });
    return c.json(sharedResponse);
  });

// ── Background Job Helpers ───────────────────────────────────────────

type ValidationPair = {
  ruleId: string;
  providerName: string;
  ruleType: string;
  referencedBlockId: string;
  configJson: Record<string, unknown>;
};

type PendingValidationJob = {
  pair: ValidationPair;
  resultId: string;
};

type ValidationOutbox = {
  inserts: Array<typeof externalServiceValidationResult.$inferInsert>;
  pendingJobs: PendingValidationJob[];
  snapshotVersion: number;
};

async function buildExternalValidationOutbox(
  _tx: TransactionClient,
  responseId: string,
  activeSnapshot: FormSnapshot,
): Promise<ValidationOutbox> {
  const snapshotEntries = parseValidationRuleSnapshot(
    activeSnapshot.validationRulesJson,
  );
  if (snapshotEntries.length === 0) {
    return {
      inserts: [],
      pendingJobs: [],
      snapshotVersion: activeSnapshot.version,
    };
  }

  const blockIds = extractBlockIdsFromPlateContent(activeSnapshot.plateContent);
  const pairs: ValidationPair[] = snapshotEntries.flatMap((entry) =>
    entry.referencedBlockIds.map((blockId) => ({
      ruleId: entry.id,
      providerName: entry.providerName,
      ruleType: entry.ruleType,
      referencedBlockId: blockId,
      configJson: entry.configJson,
    })),
  );

  const missingRows: ValidationPair[] = [];
  const invalidProviderRows: ValidationPair[] = [];
  const unregisteredProviderRows: ValidationPair[] = [];
  const unknownRuleTypeRows: ValidationPair[] = [];
  const validRows: ValidationPair[] = [];

  for (const pair of pairs) {
    if (!blockIds.has(pair.referencedBlockId)) {
      missingRows.push(pair);
      continue;
    }
    if (!isValidServiceName(pair.providerName)) {
      invalidProviderRows.push(pair);
      continue;
    }
    const provider = providerRegistry.get(pair.providerName);
    if (!provider) {
      unregisteredProviderRows.push(pair);
      continue;
    }
    if (!provider.rules[pair.ruleType]) {
      unknownRuleTypeRows.push(pair);
      continue;
    }
    validRows.push(pair);
  }

  const inserts: Array<typeof externalServiceValidationResult.$inferInsert> =
    [];
  const getPairValidationResultId = (pair: ValidationPair): string =>
    getValidationResultId({
      responseId,
      ruleId: pair.ruleId,
      referencedBlockId: pair.referencedBlockId,
    });

  for (const pair of missingRows) {
    inserts.push({
      id: getPairValidationResultId(pair),
      responseId,
      ruleId: pair.ruleId,
      referencedBlockId: pair.referencedBlockId,
      snapshotVersion: activeSnapshot.version,
      service: pair.providerName,
      enqueueMode: "STABLE",
      status: "MISSING",
      errorCode: "REFERENCED_BLOCK_MISSING",
      errorMessage: `Referenced block not found in form: ${pair.referencedBlockId}`,
    });
  }
  for (const pair of invalidProviderRows) {
    inserts.push({
      id: getPairValidationResultId(pair),
      responseId,
      ruleId: pair.ruleId,
      referencedBlockId: pair.referencedBlockId,
      snapshotVersion: activeSnapshot.version,
      service: pair.providerName,
      enqueueMode: "STABLE",
      status: "FAILED",
      errorCode: "INVALID_SERVICE_NAME",
      errorMessage: `Invalid service name: ${pair.providerName}`,
    });
  }
  for (const pair of unregisteredProviderRows) {
    inserts.push({
      id: getPairValidationResultId(pair),
      responseId,
      ruleId: pair.ruleId,
      referencedBlockId: pair.referencedBlockId,
      snapshotVersion: activeSnapshot.version,
      service: pair.providerName,
      enqueueMode: "STABLE",
      status: "FAILED",
      errorCode: "PROVIDER_NOT_REGISTERED",
      errorMessage: `Validation provider not registered: ${pair.providerName}`,
    });
  }
  for (const pair of unknownRuleTypeRows) {
    inserts.push({
      id: getPairValidationResultId(pair),
      responseId,
      ruleId: pair.ruleId,
      referencedBlockId: pair.referencedBlockId,
      snapshotVersion: activeSnapshot.version,
      service: pair.providerName,
      enqueueMode: "STABLE",
      status: "FAILED",
      errorCode: "UNKNOWN_RULE_TYPE",
      errorMessage: `Provider ${pair.providerName} does not expose rule: ${pair.ruleType}`,
    });
  }

  const pendingRows = validRows.map((pair) => ({
    id: getPairValidationResultId(pair),
    responseId,
    ruleId: pair.ruleId,
    referencedBlockId: pair.referencedBlockId,
    snapshotVersion: activeSnapshot.version,
    service: pair.providerName,
    enqueueMode: "STABLE" as const,
    status: "PENDING" as const,
  }));
  inserts.push(...pendingRows);

  return {
    inserts,
    pendingJobs: validRows.map((pair) => ({
      pair,
      resultId: getPairValidationResultId(pair),
    })),
    snapshotVersion: activeSnapshot.version,
  };
}

async function insertExternalValidationOutbox(
  tx: TransactionClient,
  outbox: ValidationOutbox,
): Promise<void> {
  if (outbox.inserts.length === 0) return;
  await tx.insert(externalServiceValidationResult).values(outbox.inserts);
}

async function reserveInitialValidationEnqueueAttempt(
  resultId: string,
): Promise<boolean> {
  try {
    const [result] = await db
      .update(externalServiceValidationResult)
      .set({ enqueueAttemptCount: 1 })
      .where(
        and(
          eq(externalServiceValidationResult.id, resultId),
          eq(externalServiceValidationResult.status, "PENDING"),
          eq(externalServiceValidationResult.enqueueMode, "STABLE"),
          eq(externalServiceValidationResult.enqueueAttemptCount, 0),
          isNull(externalServiceValidationResult.jobId),
          isNull(externalServiceValidationResult.claimToken),
        ),
      );
    return result.affectedRows > 0;
  } catch (error) {
    logError("Failed to reserve initial validation enqueue attempt", "api", {
      error,
      resultId,
    });
    captureError(error);
    return false;
  }
}

async function enqueueExternalValidationJobs(
  responseId: string,
  outbox: ValidationOutbox,
): Promise<void> {
  await Promise.all(
    outbox.pendingJobs.map(async ({ pair, resultId }) => {
      let jobData: z.infer<typeof genericValidationJobDataSchema>;
      try {
        jobData = genericValidationJobDataSchema.parse({
          responseId,
          ruleId: pair.ruleId,
          referencedBlockId: pair.referencedBlockId,
          snapshotProviderName: pair.providerName,
          snapshotRuleType: pair.ruleType,
          snapshotConfigJson: pair.configJson,
          snapshotVersion: outbox.snapshotVersion,
        });
      } catch (error) {
        logError("Failed to prepare validation outbox job", "api", {
          error,
          resultId,
          responseId,
          ruleId: pair.ruleId,
          service: pair.providerName,
        });
        captureError(error);
        try {
          await db
            .update(externalServiceValidationResult)
            .set({
              status: "FAILED",
              errorCode: "ENQUEUE_FAILED",
              errorMessage: "Failed to prepare validation job",
            })
            .where(
              and(
                eq(externalServiceValidationResult.id, resultId),
                eq(externalServiceValidationResult.status, "PENDING"),
                eq(externalServiceValidationResult.enqueueMode, "STABLE"),
                isNull(externalServiceValidationResult.jobId),
                isNull(externalServiceValidationResult.claimToken),
              ),
            );
        } catch (updateError) {
          logError(
            "Failed to mark validation result as FAILED after preparation error",
            "api",
            { error: updateError, resultId },
          );
          captureError(updateError);
        }
        return;
      }

      const attemptReserved =
        await reserveInitialValidationEnqueueAttempt(resultId);
      if (!attemptReserved) return;

      const jobId = buildValidationOutboxJobId(resultId);
      try {
        // Redis/network failures are transient. The committed STABLE PENDING
        // row remains untouched so the validation outbox sweeper can retry it.
        const queue = getValidationQueue(pair.providerName);
        await queue.add(`validate-${pair.providerName}`, jobData, { jobId });
      } catch (error) {
        logError("Failed to enqueue external validation job", "api", {
          error,
          resultId,
          responseId,
          ruleId: pair.ruleId,
          service: pair.providerName,
          jobId,
        });
        captureError(error);
        return;
      }

      try {
        // A zero-row CAS or acknowledgement exception stays recoverable: the
        // stable queue ID lets the Worker admit the job durably, and a still-
        // PENDING row remains eligible for the sweeper. Never overwrite a row
        // already owned by a sweeper claim.
        await db
          .update(externalServiceValidationResult)
          .set({ jobId })
          .where(
            and(
              eq(externalServiceValidationResult.id, resultId),
              eq(externalServiceValidationResult.status, "PENDING"),
              eq(externalServiceValidationResult.enqueueMode, "STABLE"),
              isNull(externalServiceValidationResult.jobId),
              isNull(externalServiceValidationResult.claimToken),
            ),
          );
      } catch (updateError) {
        logError("Failed to persist jobId for validation result", "api", {
          error: updateError,
          resultId,
          jobId,
        });
        captureError(updateError);
      }
    }),
  );
}
