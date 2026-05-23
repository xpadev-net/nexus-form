import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db } from "@nexus-form/database";
import {
  externalServiceValidationResult,
  fingerprintDetail,
  form,
  formIntegration,
  formResponse,
  formSchedule,
  formStructure,
  formValidationRule,
} from "@nexus-form/database/schema";
import { providerRegistry } from "@nexus-form/integrations";
import {
  extractQuestionsFromPlateContent,
  genericValidationJobDataSchema,
  getValidationResultId,
  MAX_RESPONSE_BODY_BYTES,
  MAX_RESPONSE_ID_LENGTH,
  MAX_RESPONSE_ITEMS,
  responsePayloadItemSchema,
  sheetsSyncJobDataSchema,
} from "@nexus-form/shared";
import { and, count, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import { parseStoredStructure } from "../lib/forms/parse-stored-structure";
import { validateShareLink } from "../lib/forms/permission-service";
import {
  buildQuestionsFromPlateContentStrict,
  PlateQuestionBuildError,
} from "../lib/forms/plate-question-builder";
import { buildPublicFormStructure } from "../lib/forms/public-structure";
import { validateResponseData } from "../lib/forms/response-validator";
import { logFormScheduleError } from "../lib/forms/schedule-error-logging";
import { processFormSchedule } from "../lib/forms/schedule-processor";
import { getLatestSnapshot } from "../lib/forms/snapshot-repository";
import type { TransactionClient } from "../lib/forms/types";
import { parseValidationRuleSnapshot } from "../lib/forms/validation-rule-repository";
import { createHonoApp } from "../lib/hono";
import { extractClientIP } from "../lib/ip-address";
import { logError, logWarn } from "../lib/logger";
import {
  getSheetsSyncQueue,
  getValidationQueue,
  isValidServiceName,
} from "../lib/queues";
import { createRateLimit, getClientIp } from "../lib/rate-limit";
import { createRequestBodySizeLimit } from "../lib/request-body-size-limit";
import { stringifyResponseDataJson } from "../lib/response-data-json";
import { verifyHCaptcha } from "../lib/security/hcaptcha";
import { verifyPassword } from "../lib/security/password";
import { captureError } from "../lib/sentry";
import {
  extractJwtFromRequest,
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

// ── Schemas ──────────────────────────────────────────────────────────

const MAX_FINGERPRINTS = 20;
const MAX_FINGERPRINT_VALUE_LENGTH = 255;
const MAX_TOKEN_LENGTH = 4_096;
const MAX_USER_AGENT_LENGTH = 512;
const responseBodySizeLimit = createRequestBodySizeLimit({
  maxBytes: MAX_RESPONSE_BODY_BYTES,
});
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
  password: z.string().min(1),
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
      "Published form is missing an active formStructure",
      metadata,
    );
    return null;
  }

  try {
    return parseStoredStructure(structureJson);
  } catch (error) {
    logInvalidPublishedConfiguration(
      "Published form has invalid active formStructure JSON",
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

function isPasswordVerified(c: Context, formId: string): boolean {
  const jwtToken = extractJwtFromRequest(c);
  const decoded = jwtToken ? verifySessionJwt(jwtToken) : null;
  return decoded?.verifiedForms?.includes(formId) ?? false;
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
  currentStatus: "DRAFT" | "PUBLISHED" | "UNPUBLISHED" | "ARCHIVED";
  dueScheduleId: string | null | undefined;
  currentTime: Date;
  publicId: string;
  operation: string;
}) {
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
  return scheduleResult?.statusChanged
    ? scheduleResult.newStatus
    : currentStatus;
}

// ── Router ───────────────────────────────────────────────────────────

export const formsPublicRouter = createHonoApp()
  // ── GET /public/:publicId ────────────────────────────────────────
  .get("/public/:publicId", publicFormGetRateLimit, async (c) => {
    const publicId = c.req.param("publicId");
    const currentTime = new Date();
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

    if (!target) return c.json(errorResponse("Form not found"), 404);

    const currentStatus = await resolveScheduledStatus({
      formId: target.id,
      currentStatus: target.status,
      dueScheduleId: target.dueScheduleId,
      currentTime,
      publicId,
      operation: "GET /public/:publicId",
    });

    if (currentStatus !== "PUBLISHED")
      return c.json(errorResponse("Form not found"), 404);

    const [[structure], activeSnapshot] = await Promise.all([
      db
        .select({
          structureJson: formStructure.structureJson,
          version: formStructure.version,
        })
        .from(formStructure)
        .where(
          and(
            eq(formStructure.formId, target.id),
            eq(formStructure.isActive, true),
          ),
        )
        .orderBy(desc(formStructure.version))
        .limit(1),
      getLatestSnapshot(target.id),
    ]);

    const parsedStructure = parsePublishedStructure(structure?.structureJson, {
      formId: target.id,
      publicId,
      operation: "GET /public/:publicId",
    });
    if (!parsedStructure) {
      return c.json(errorResponse("Form configuration is invalid"), 500);
    }

    const pwProtection = getPasswordProtection(parsedStructure);
    const isProtected = pwProtection?.enabled ?? false;

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

      if (!isPasswordVerified(c, target.id)) {
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
    }

    const publishedContent =
      activeSnapshot?.plateContent ?? target.plateContent;
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
      structure: buildPublicFormStructure(parsedStructure),
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
      const { ip } = extractClientIP(c.req.raw, { strategy: "general" });

      // 1. Verify hCaptcha before any form-specific work.
      const captchaValid = await verifyHCaptcha(payload.captchaToken, {
        remoteip: ip,
      });
      if (!captchaValid) {
        return c.json(errorResponse("Captcha verification failed"), 403);
      }

      // 2. Look up form
      const currentTime = new Date();
      const [target] = await db
        .select({
          id: form.id,
          status: form.status,
          plateContent: form.plateContent,
          dueScheduleId: formSchedule.id,
        })
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
      if (!target) return c.json(errorResponse("Form not found"), 404);

      const submitStatus = await resolveScheduledStatus({
        formId: target.id,
        currentStatus: target.status,
        dueScheduleId: target.dueScheduleId,
        currentTime,
        publicId,
        operation: "POST /public/:publicId/submit",
      });
      if (submitStatus !== "PUBLISHED")
        return c.json(errorResponse("Form not found"), 404);

      const activeSnapshot = await getLatestSnapshot(target.id);

      // 3. Answer validation against active snapshot's plateContent-derived questions.
      // Run before quota checks to reject malformed payloads cheaply.
      const publishedContent =
        activeSnapshot?.plateContent ?? target.plateContent;
      const questions = buildPublishedQuestions(publishedContent, {
        formId: target.id,
        publicId,
        operation: "POST /public/:publicId/submit",
      });
      if (!questions) {
        return c.json(errorResponse("Form configuration is invalid"), 500);
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

      // 4. Verify and consume telemetry tokens
      const telemetryTokens = [
        payload.telemetry.v4Token,
        payload.telemetry.v6Token,
      ].filter((t): t is string => !!t);

      try {
        await consumeTokensOrThrow(telemetryTokens);
      } catch {
        return c.json(
          errorResponse("Invalid or expired telemetry tokens"),
          403,
        );
      }

      // 5. Load form structure for password/response limit checks
      const [structure] = await db
        .select({ structureJson: formStructure.structureJson })
        .from(formStructure)
        .where(
          and(
            eq(formStructure.formId, target.id),
            eq(formStructure.isActive, true),
          ),
        )
        .orderBy(desc(formStructure.version))
        .limit(1);

      const parsedStructure = parsePublishedStructure(
        structure?.structureJson,
        {
          formId: target.id,
          publicId,
          operation: "POST /public/:publicId/submit",
        },
      );
      if (!parsedStructure) {
        return c.json(errorResponse("Form configuration is invalid"), 500);
      }

      // 6. Password protection check
      const pwProtection = getPasswordProtection(parsedStructure);

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

        if (!isPasswordVerified(c, target.id)) {
          return c.json(
            PasswordRequiredErrorResponseSchema.parse({
              error: "Password verification required",
              passwordRequired: true,
              passwordHint: pwProtection.password_hint,
            }),
            403,
          );
        }
      }

      // 7. Response limit variable (enforcement happens inside atomic transaction)
      const responseLimit = parsedStructure.settings?.response_limit;
      const requireFingerprint =
        parsedStructure.settings?.require_fingerprint ?? true;
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
      const validationOutbox = activeSnapshot
        ? await buildExternalValidationOutbox(responseId, activeSnapshot)
        : null;

      // 8. Session management (resolve before transaction; cookie set only on success)
      const userAgent = c.req.header("user-agent") ?? undefined;
      if (userAgent && userAgent.length > MAX_USER_AGENT_LENGTH) {
        return c.json(errorResponse("User-Agent is too long"), 400);
      }

      const jwtToken = extractJwtFromRequest(c);
      const { sessionId, jwt: newJwt } = await resolveSessionIdOrCreate(
        jwtToken,
        { ip, ua: userAgent },
      );

      const insertResult = await db.transaction(async (tx) => {
        if (responseLimit?.enabled && responseLimit.max_responses) {
          // Acquire exclusive lock on the form row to serialize concurrent
          // submissions and prevent TOCTOU on the response limit check.
          await tx
            .select({ id: form.id })
            .from(form)
            .where(eq(form.id, target.id))
            .for("update");

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

        return { limitReached: false as const };
      });

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
      setSessionCookie(c, newJwt);

      // 11. Queue external validation jobs (non-blocking)
      if (validationOutbox && validationOutbox.pendingJobs.length > 0) {
        enqueueExternalValidationJobs(responseId, validationOutbox).catch(
          (error) => {
            logError("Failed to queue external validations", "api", {
              error,
              responseId,
              formId: target.id,
            });
            captureError(error);
          },
        );
      }

      // 12. Queue Google Sheets sync (non-blocking)
      queueSheetsSyncIfNeeded(target.id, responseId, activeSnapshot).catch(
        (error) => {
          logError("Failed to queue Google Sheets sync", "api", {
            error,
            responseId,
            formId: target.id,
            snapshotVersion: activeSnapshot?.version,
          });
          captureError(error);
        },
      );

      // 13. Return the created response
      const [createdResponse] = await db
        .select()
        .from(formResponse)
        .where(eq(formResponse.id, responseId))
        .limit(1);

      const submitResponse = PublicSubmitResponseSchema.parse({
        response: createdResponse ?? null,
      });
      return c.json(submitResponse, 201);
    },
  )

  // ── POST /public/:publicId/verify-password ───────────────────────
  .post(
    "/public/:publicId/verify-password",
    createRateLimit({ windowMs: 15 * 60 * 1000, maxRequests: 10 }),
    zValidator("json", verifyPasswordSchema),
    async (c) => {
      const publicId = c.req.param("publicId");
      const payload = c.req.valid("json");

      const [target] = await db
        .select({ id: form.id })
        .from(form)
        .where(eq(form.publicId, publicId))
        .limit(1);
      if (!target) return c.json(errorResponse("Form not found"), 404);

      const [structure] = await db
        .select({ structureJson: formStructure.structureJson })
        .from(formStructure)
        .where(
          and(
            eq(formStructure.formId, target.id),
            eq(formStructure.isActive, true),
          ),
        )
        .orderBy(desc(formStructure.version))
        .limit(1);

      const parsed = parsePublishedStructure(structure?.structureJson, {
        formId: target.id,
        publicId,
        operation: "POST /public/:publicId/verify-password",
      });
      if (!parsed) {
        return c.json(errorResponse("Form configuration is invalid"), 500);
      }

      const pwProtection = getPasswordProtection(parsed);

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

      // Issue JWT with verifiedForms
      const existingJwt = extractJwtFromRequest(c);
      const existing = existingJwt ? verifySessionJwt(existingJwt) : null;
      const verifiedForms = new Set(existing?.verifiedForms ?? []);
      verifiedForms.add(target.id);

      const { ip } = extractClientIP(c.req.raw, { strategy: "general" });
      const userAgent = c.req.header("user-agent") ?? undefined;
      const { sessionId } = await resolveSessionIdOrCreate(existingJwt, {
        ip,
        ua: userAgent,
      });

      const newJwt = signSessionJwt(sessionId, {
        verifiedForms: [...verifiedForms],
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

  const existingRuleIds = await getExistingValidationRuleIds(
    Array.from(new Set(pairs.map((pair) => pair.ruleId))),
  );
  const missingRuleRows: ValidationPair[] = [];

  const missingRows: ValidationPair[] = [];
  const invalidProviderRows: ValidationPair[] = [];
  const unregisteredProviderRows: ValidationPair[] = [];
  const unknownRuleTypeRows: ValidationPair[] = [];
  const validRows: ValidationPair[] = [];

  for (const pair of pairs) {
    if (!existingRuleIds.has(pair.ruleId)) {
      missingRuleRows.push(pair);
      continue;
    }
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
      status: "FAILED",
      errorCode: "UNKNOWN_RULE_TYPE",
      errorMessage: `Provider ${pair.providerName} does not expose rule: ${pair.ruleType}`,
    });
  }

  if (missingRuleRows.length > 0) {
    logWarn(
      "Skipped validation rows for deleted validation rules",
      "forms-public",
      {
        responseId,
        ruleIds: [...new Set(missingRuleRows.map((pair) => pair.ruleId))],
      },
    );
  }

  const pendingRows = validRows.map((pair) => ({
    id: getPairValidationResultId(pair),
    responseId,
    ruleId: pair.ruleId,
    referencedBlockId: pair.referencedBlockId,
    snapshotVersion: activeSnapshot.version,
    service: pair.providerName,
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

async function getExistingValidationRuleIds(
  ruleIds: string[],
): Promise<Set<string>> {
  if (ruleIds.length === 0) return new Set();
  const rows = await db
    .select({ id: formValidationRule.id })
    .from(formValidationRule)
    .where(inArray(formValidationRule.id, ruleIds));
  return new Set(rows.map((row) => row.id));
}

async function enqueueExternalValidationJobs(
  responseId: string,
  outbox: ValidationOutbox,
): Promise<void> {
  // リトライ経路 (forms-responses.ts) と同様に per-row で enqueue し、
  // 失敗した行のみ FAILED (ENQUEUE_FAILED) に更新してジョブ無しの
  // PENDING 行が残留しないようにする。
  await Promise.all(
    outbox.pendingJobs.map(async ({ pair, resultId }) => {
      try {
        // getValidationQueue は内部で Redis 接続を確立しうるため try 内で呼ぶ。
        const queue = getValidationQueue(pair.providerName);
        const jobData = genericValidationJobDataSchema.parse({
          responseId,
          ruleId: pair.ruleId,
          referencedBlockId: pair.referencedBlockId,
          snapshotProviderName: pair.providerName,
          snapshotRuleType: pair.ruleType,
          snapshotConfigJson: pair.configJson,
          snapshotVersion: outbox.snapshotVersion,
        });
        const job = await queue.add(`validate-${pair.providerName}`, jobData);
        // リトライ経路と同様、enqueue 済みジョブの jobId を記録して
        // トラッキング/キャンセルを可能にする。失敗しても Worker 側が
        // 処理時に jobId を設定するため致命的ではない。
        try {
          await db
            .update(externalServiceValidationResult)
            .set({ jobId: job.id ?? null })
            .where(
              and(
                eq(externalServiceValidationResult.id, resultId),
                isNull(externalServiceValidationResult.jobId),
              ),
            );
        } catch (updateError) {
          logError("Failed to persist jobId for validation result", "api", {
            error: updateError,
            resultId,
          });
          captureError(updateError);
        }
      } catch (error) {
        logError("Failed to enqueue external validation job", "api", {
          error,
          responseId,
          ruleId: pair.ruleId,
        });
        captureError(error);
        try {
          await db
            .update(externalServiceValidationResult)
            .set({
              status: "FAILED",
              errorCode: "ENQUEUE_FAILED",
              errorMessage: "Failed to enqueue validation job",
            })
            .where(eq(externalServiceValidationResult.id, resultId));
        } catch (updateError) {
          logError(
            "Failed to mark validation result as FAILED after enqueue error",
            "api",
            { error: updateError, resultId },
          );
          captureError(updateError);
        }
      }
    }),
  );
}

async function queueSheetsSyncIfNeeded(
  formId: string,
  responseId: string,
  activeSnapshot: FormSnapshot | null,
): Promise<void> {
  const [integration] = await db
    .select({ id: formIntegration.id })
    .from(formIntegration)
    .where(eq(formIntegration.formId, formId))
    .limit(1);

  if (integration) {
    const jobData = sheetsSyncJobDataSchema.parse({
      formId,
      integrationId: integration.id,
      responseId,
      snapshotVersion: activeSnapshot?.version,
    });
    await getSheetsSyncQueue().add("auto-sync", jobData, {
      jobId: `sheets:${integration.id}:${responseId}`,
    });
  }
}
