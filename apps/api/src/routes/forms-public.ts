import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db } from "@nexus-form/database";
import {
  externalServiceValidationResult,
  fingerprintDetail,
  form,
  formIntegration,
  formResponse,
  formStructure,
} from "@nexus-form/database/schema";
import { providerRegistry } from "@nexus-form/integrations";
import {
  extractQuestionsFromPlateContent,
  responsePayloadItemSchema,
} from "@nexus-form/shared";
import { and, count, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { validateShareLink } from "../lib/forms/permission-service";
import { buildQuestionsFromPlateContent } from "../lib/forms/plate-question-builder";
import { buildPublicFormStructure } from "../lib/forms/public-structure";
import { validateResponseData } from "../lib/forms/response-validator";
import { processFormSchedule } from "../lib/forms/schedule-processor";
import { getLatestSnapshot } from "../lib/forms/snapshot-repository";
import { parseValidationRuleSnapshot } from "../lib/forms/validation-rule-repository";
import { createHonoApp } from "../lib/hono";
import { extractClientIP } from "../lib/ip-address";
import { logError, logWarn } from "../lib/logger";
import {
  getSheetsSyncQueue,
  getValidationQueue,
  isValidServiceName,
} from "../lib/queues";
import { createRateLimit } from "../lib/rate-limit";
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
import type { FormSnapshot } from "../types/domain/form-snapshot";

// ── Schemas ──────────────────────────────────────────────────────────

const publicSubmitSchema = z.object({
  responses: z.array(responsePayloadItemSchema),
  respondentUuid: z.string().optional(),
  submittedAt: z.string().datetime().optional(),
  captchaToken: z.string().min(1, "hCaptcha token is required"),
  telemetry: z
    .object({
      v4Token: z.string().optional(),
      v6Token: z.string().optional(),
    })
    .refine((data) => data.v4Token || data.v6Token, {
      message: "At least one telemetry token is required",
    }),
  fingerprints: z
    .array(
      z.object({
        type: z.enum(["fingerprintjs", "thumbmarkjs", "browser"]),
        name: z.string(),
        value_hash: z.string(),
      }),
    )
    .min(1, "Fingerprint data is required"),
});

const verifyPasswordSchema = z.object({
  password: z.string().min(1),
});

// ── Types ────────────────────────────────────────────────────────────

interface PasswordProtection {
  enabled?: boolean;
  password?: string;
  password_hint?: string;
}

interface ResponseLimit {
  enabled: boolean;
  max_responses: number;
  message?: string;
}

interface ParsedStructure {
  version?: number;
  settings?: {
    response_limit?: ResponseLimit;
    [key: string]: unknown;
  };
  access_control?: {
    password_protection?: PasswordProtection;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseStructure(structureJson: string): ParsedStructure | null {
  try {
    return JSON.parse(structureJson) as ParsedStructure;
  } catch {
    return null;
  }
}

function getPasswordProtection(
  parsed: ParsedStructure,
): PasswordProtection | undefined {
  return parsed.access_control?.password_protection;
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

// ── Router ───────────────────────────────────────────────────────────

export const formsPublicRouter = createHonoApp()
  // ── GET /public/:publicId ────────────────────────────────────────
  .get("/public/:publicId", async (c) => {
    const publicId = c.req.param("publicId");
    const [target] = await db
      .select()
      .from(form)
      .where(eq(form.publicId, publicId))
      .limit(1);

    if (!target) return c.json({ error: "Form not found" }, 404);

    const scheduleResult = await processFormSchedule(target.id).catch(
      () => null,
    );
    const currentStatus = scheduleResult?.statusChanged
      ? scheduleResult.newStatus
      : target.status;

    if (currentStatus !== "PUBLISHED")
      return c.json({ error: "Form not found" }, 404);

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

    const parsedStructure = structure
      ? parseStructure(structure.structureJson)
      : null;

    const pwProtection = parsedStructure
      ? getPasswordProtection(parsedStructure)
      : undefined;

    return c.json({
      form: {
        id: target.id,
        publicId: target.publicId,
        title: target.title,
        description: target.description,
        status: target.status,
        isPasswordProtected: pwProtection?.enabled ?? false,
        passwordHint: pwProtection?.password_hint,
      },
      structure: parsedStructure
        ? buildPublicFormStructure(parsedStructure)
        : null,
      plateContent: activeSnapshot?.plateContent ?? target.plateContent ?? "[]",
    });
  })

  // ── POST /public/:publicId/submit ────────────────────────────────
  .post(
    "/public/:publicId/submit",
    createRateLimit({ windowMs: 60 * 1000, maxRequests: 10 }),
    zValidator("json", publicSubmitSchema),
    async (c) => {
      const publicId = c.req.param("publicId");

      // 1. Look up form
      const [target] = await db
        .select({
          id: form.id,
          status: form.status,
          plateContent: form.plateContent,
        })
        .from(form)
        .where(eq(form.publicId, publicId))
        .limit(1);
      if (!target) return c.json({ error: "Form not found" }, 404);

      const submitScheduleResult = await processFormSchedule(target.id).catch(
        () => null,
      );
      const submitStatus = submitScheduleResult?.statusChanged
        ? submitScheduleResult.newStatus
        : target.status;
      if (submitStatus !== "PUBLISHED")
        return c.json({ error: "Form not found" }, 404);

      const [payload, activeSnapshot] = [
        c.req.valid("json"),
        await getLatestSnapshot(target.id),
      ];
      const { ip } = extractClientIP(c.req.raw, { strategy: "general" });

      // 2. Answer validation against active snapshot's plateContent-derived questions.
      // Run before quota/rate-limit checks to reject malformed payloads cheaply.
      const publishedContent =
        activeSnapshot?.plateContent ?? target.plateContent;
      if (!publishedContent) {
        logWarn(
          "POST: published form missing plateContent in snapshot",
          "forms-public",
          {
            publicId,
          },
        );
      }
      const questions = publishedContent
        ? buildQuestionsFromPlateContent(publishedContent)
        : [];
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
        return c.json({ error: "Invalid response data" }, 400);
      }

      // 3. Verify hCaptcha
      const captchaValid = await verifyHCaptcha(payload.captchaToken, {
        remoteip: ip,
      });
      if (!captchaValid) {
        return c.json({ error: "Captcha verification failed" }, 403);
      }

      // 4. Verify and consume telemetry tokens
      const telemetryTokens = [
        payload.telemetry.v4Token,
        payload.telemetry.v6Token,
      ].filter((t): t is string => !!t);

      try {
        await consumeTokensOrThrow(telemetryTokens);
      } catch {
        return c.json({ error: "Invalid or expired telemetry tokens" }, 403);
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

      const parsedStructure = structure
        ? parseStructure(structure.structureJson)
        : null;

      // 6. Password protection check
      const pwProtection = parsedStructure
        ? getPasswordProtection(parsedStructure)
        : undefined;

      if (pwProtection?.enabled && pwProtection.password) {
        const jwtToken = extractJwtFromRequest(c);
        const decoded = jwtToken ? verifySessionJwt(jwtToken) : null;
        const isVerified = decoded?.verifiedForms?.includes(target.id) ?? false;

        if (!isVerified) {
          return c.json(
            {
              error: "Password verification required",
              passwordRequired: true,
              passwordHint: pwProtection.password_hint,
            },
            403,
          );
        }
      }

      // 7. Response limit check
      const responseLimit = parsedStructure?.settings?.response_limit as
        | ResponseLimit
        | undefined;

      if (responseLimit?.enabled && responseLimit.max_responses) {
        const [existingCount] = await db
          .select({ count: count() })
          .from(formResponse)
          .where(eq(formResponse.formId, target.id));

        if ((existingCount?.count ?? 0) >= responseLimit.max_responses) {
          return c.json(
            {
              error:
                responseLimit.message ??
                "This form has reached its response limit",
              responseLimitReached: true,
            },
            403,
          );
        }
      }

      // 8. Session management
      const userAgent = c.req.header("user-agent") ?? undefined;
      const jwtToken = extractJwtFromRequest(c);
      const { sessionId, jwt: newJwt } = await resolveSessionIdOrCreate(
        jwtToken,
        { ip, ua: userAgent },
      );
      setSessionCookie(c, newJwt);

      // 9. Save response
      const responseId = randomUUID();
      await db.insert(formResponse).values({
        id: responseId,
        formId: target.id,
        responseDataJson: JSON.stringify(payload.responses),
        respondentUuid: payload.respondentUuid ?? randomUUID(),
        sessionId,
        userAgent: userAgent ?? null,
        countryCode: null,
      });

      // 10. Save fingerprints
      if (payload.fingerprints.length > 0) {
        await db.insert(fingerprintDetail).values(
          payload.fingerprints.map((fp) => ({
            id: randomUUID(),
            responseId,
            fingerprintType: fp.type,
            componentName: fp.name,
            componentValue: "",
            componentValueHash: fp.value_hash,
          })),
        );
      }

      // 11. Queue external validation jobs (non-blocking)
      if (activeSnapshot) {
        queueExternalValidations(target.id, responseId, activeSnapshot).catch(
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
      queueSheetsSyncIfNeeded(target.id).catch(() => {
        // Log errors but don't fail the response
      });

      // 13. Return the created response
      const [createdResponse] = await db
        .select()
        .from(formResponse)
        .where(eq(formResponse.id, responseId))
        .limit(1);

      return c.json({ response: createdResponse ?? null }, 201);
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
      if (!target) return c.json({ error: "Form not found" }, 404);

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

      if (!structure) return c.json({ valid: true });

      const parsed = parseStructure(structure.structureJson);
      if (!parsed) return c.json({ valid: true });

      const pwProtection = getPasswordProtection(parsed);

      if (!pwProtection?.enabled || !pwProtection.password) {
        return c.json({ valid: true });
      }

      const valid = await verifyPassword(
        payload.password,
        pwProtection.password,
      );

      if (!valid) {
        return c.json({ valid: false });
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

      return c.json({ valid: true });
    },
  )

  // ── GET /shared/:token ───────────────────────────────────────────
  .get("/shared/:token", async (c) => {
    const token = c.req.param("token");
    try {
      const result = await validateShareLink(token);
      const { share_link } = result;
      return c.json({
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
    } catch {
      return c.json({ error: "Share link not found" }, 404);
    }
  });

// ── Background Job Helpers ───────────────────────────────────────────

type ValidationPair = {
  ruleId: string;
  providerName: string;
  ruleType: string;
  referencedBlockId: string;
  configJson: Record<string, unknown>;
};

async function queueExternalValidations(
  _formId: string,
  responseId: string,
  activeSnapshot: FormSnapshot,
): Promise<void> {
  const snapshotEntries = parseValidationRuleSnapshot(
    activeSnapshot.validationRulesJson,
  );
  if (snapshotEntries.length === 0) return;

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

  for (const pair of missingRows) {
    inserts.push({
      id: randomUUID(),
      responseId,
      ruleId: pair.ruleId,
      referencedBlockId: pair.referencedBlockId,
      service: pair.providerName,
      status: "MISSING",
      errorCode: "REFERENCED_BLOCK_MISSING",
      errorMessage: `Referenced block not found in form: ${pair.referencedBlockId}`,
    });
  }
  for (const pair of invalidProviderRows) {
    inserts.push({
      id: randomUUID(),
      responseId,
      ruleId: pair.ruleId,
      referencedBlockId: pair.referencedBlockId,
      service: pair.providerName,
      status: "FAILED",
      errorCode: "INVALID_SERVICE_NAME",
      errorMessage: `Invalid service name: ${pair.providerName}`,
    });
  }
  for (const pair of unregisteredProviderRows) {
    inserts.push({
      id: randomUUID(),
      responseId,
      ruleId: pair.ruleId,
      referencedBlockId: pair.referencedBlockId,
      service: pair.providerName,
      status: "FAILED",
      errorCode: "PROVIDER_NOT_REGISTERED",
      errorMessage: `Validation provider not registered: ${pair.providerName}`,
    });
  }
  for (const pair of unknownRuleTypeRows) {
    inserts.push({
      id: randomUUID(),
      responseId,
      ruleId: pair.ruleId,
      referencedBlockId: pair.referencedBlockId,
      service: pair.providerName,
      status: "FAILED",
      errorCode: "UNKNOWN_RULE_TYPE",
      errorMessage: `Provider ${pair.providerName} does not expose rule: ${pair.ruleType}`,
    });
  }

  const pendingRows = validRows.map((pair) => ({
    id: randomUUID(),
    responseId,
    ruleId: pair.ruleId,
    referencedBlockId: pair.referencedBlockId,
    service: pair.providerName,
    status: "PENDING" as const,
  }));
  inserts.push(...pendingRows);

  if (inserts.length > 0) {
    await db.insert(externalServiceValidationResult).values(inserts);
  }

  // リトライ経路 (forms-responses.ts) と同様に per-row で enqueue し、
  // 失敗した行のみ FAILED (ENQUEUE_FAILED) に更新してジョブ無しの
  // PENDING 行が残留しないようにする。
  await Promise.all(
    validRows.map(async (pair, index) => {
      // pendingRows は validRows.map で生成しているため index は 1:1 対応する。
      const pendingRow = pendingRows[index];
      if (!pendingRow) return;
      try {
        // getValidationQueue は内部で Redis 接続を確立しうるため try 内で呼ぶ。
        const queue = getValidationQueue(pair.providerName);
        await queue.add(
          `validate-${pair.providerName}`,
          {
            responseId,
            ruleId: pair.ruleId,
            referencedBlockId: pair.referencedBlockId,
            snapshotProviderName: pair.providerName,
            snapshotRuleType: pair.ruleType,
            snapshotConfigJson: pair.configJson,
          },
          { removeOnComplete: 100, removeOnFail: 100 },
        );
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
            .where(eq(externalServiceValidationResult.id, pendingRow.id));
        } catch (updateError) {
          logError(
            "Failed to mark validation result as FAILED after enqueue error",
            "api",
            { error: updateError, resultId: pendingRow.id },
          );
          captureError(updateError);
        }
      }
    }),
  );
}

async function queueSheetsSyncIfNeeded(formId: string): Promise<void> {
  const [integration] = await db
    .select({ id: formIntegration.id })
    .from(formIntegration)
    .where(eq(formIntegration.formId, formId))
    .limit(1);

  if (integration) {
    await getSheetsSyncQueue().add(
      "auto-sync",
      {
        formId,
        integrationId: integration.id,
        force: false,
      },
      { removeOnComplete: 100, removeOnFail: 100 },
    );
  }
}
