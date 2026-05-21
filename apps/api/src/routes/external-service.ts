import { account, db } from "@nexus-form/database";
import { form } from "@nexus-form/database/schema";
import { providerRegistry } from "@nexus-form/integrations";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { type DualAuthContext, withDualAuth } from "../lib/dual-auth";
import {
  FormNotFoundError,
  FormPermissionError,
  InsufficientFormPermissionError,
} from "../lib/errors/form-errors";
import { createHonoApp } from "../lib/hono";
import { errorResponse } from "../types/domain/common";

const providerNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);
const apiNameSchema = z.string().regex(/^[a-z][a-z0-9_-]*$/);
const externalServiceApiResponseSchema = z.record(z.string(), z.unknown());
/** 外部サービス API のフォーム権限エラーレスポンス。 */
export const ExternalServicePermissionErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ExternalServicePermissionErrorResponse = z.infer<
  typeof ExternalServicePermissionErrorResponseSchema
>;
/** 外部サービス API 呼び出し失敗時のエラーレスポンス。 */
export const ExternalServiceFailureResponseSchema = z.object({
  error: z.literal("External service API failed"),
  details: z.string(),
});
export type ExternalServiceFailureResponse = z.infer<
  typeof ExternalServiceFailureResponseSchema
>;
const formPermissionErrorStatusSchema = z
  .union([z.literal(403), z.literal(404)])
  .catch(403);

async function getLinkedAccount(userId: string, providerId: string) {
  const [linkedAccount] = await db
    .select({
      accountId: account.accountId,
      accessToken: account.accessToken,
    })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))
    .limit(1);

  return linkedAccount ?? null;
}

async function resolveEffectiveUserId(
  authUserId: string,
  authContext: DualAuthContext,
  formId: string | undefined,
): Promise<string> {
  if (!formId) return authUserId;

  const [formRecord] = await db
    .select({ id: form.id, creatorId: form.creatorId })
    .from(form)
    .where(eq(form.id, formId))
    .limit(1);

  if (!formRecord) throw new FormNotFoundError(formId);
  if (authContext.auth_type === "api_token") {
    if (authContext.form_ids && !authContext.form_ids.includes(formId)) {
      throw new InsufficientFormPermissionError(formId, "OWNER", null);
    }
    if (authContext.share_link_id || authUserId.startsWith("anon:")) {
      throw new InsufficientFormPermissionError(formId, "OWNER", null);
    }
  }
  if (formRecord.creatorId !== authUserId) {
    throw new InsufficientFormPermissionError(formId, "OWNER", null);
  }

  return authUserId;
}

function isSyntheticApiTokenPrincipal(authContext: DualAuthContext): boolean {
  return (
    authContext.auth_type === "api_token" &&
    (authContext.share_link_id !== undefined ||
      authContext.user_id.startsWith("anon:") ||
      authContext.user_id.startsWith("share-link:"))
  );
}

function apiTokenExternalServiceErrorResponse(
  code: string,
  message: string,
): ExternalServicePermissionErrorResponse {
  return ExternalServicePermissionErrorResponseSchema.parse({
    error: {
      message,
      code,
    },
  });
}

function formPermissionErrorStatus(error: FormPermissionError): 403 | 404 {
  return formPermissionErrorStatusSchema.parse(error.statusCode);
}

const externalServicePermissionErrorResponse = (
  error: FormPermissionError,
): ExternalServicePermissionErrorResponse => {
  const response = {
    error: {
      message: error.message,
      code: error.code,
      details: error.details,
    },
  } satisfies ExternalServicePermissionErrorResponse;
  const parsed =
    ExternalServicePermissionErrorResponseSchema.safeParse(response);
  return parsed.success ? parsed.data : response;
};

const externalServiceFailureResponse = (
  details: string,
): ExternalServiceFailureResponse => {
  const response = {
    error: "External service API failed",
    details,
  } satisfies ExternalServiceFailureResponse;
  const parsed = ExternalServiceFailureResponseSchema.safeParse(response);
  return parsed.success ? parsed.data : response;
};

export const externalServiceRouter = createHonoApp()
  .use("/*", withDualAuth())
  .get("/:provider/:api", async (c) => {
    const auth = c.get("dualAuthContext");
    if (!auth) return c.json(errorResponse("Unauthorized"), 401);

    const providerName = providerNameSchema.safeParse(c.req.param("provider"));
    const apiName = apiNameSchema.safeParse(c.req.param("api"));
    if (!providerName.success || !apiName.success) {
      return c.json(errorResponse("Invalid external service API path"), 400);
    }

    const formId = c.req.query("formId") || undefined;

    if (isSyntheticApiTokenPrincipal(auth)) {
      return c.json(
        apiTokenExternalServiceErrorResponse(
          "SYNTHETIC_PRINCIPAL_NOT_ALLOWED",
          "External service API token calls require a user-scoped token",
        ),
        403,
      );
    }

    if (auth.auth_type === "api_token" && !formId) {
      return c.json(
        apiTokenExternalServiceErrorResponse(
          "API_TOKEN_FORM_CONTEXT_REQUIRED",
          "External service API token calls require formId",
        ),
        403,
      );
    }

    const provider = providerRegistry.get(providerName.data);
    const handler = provider?.apiHandlers?.[apiName.data];
    if (!handler) {
      return c.json(errorResponse("External service API not found"), 404);
    }

    let effectiveUserId: string;
    try {
      effectiveUserId = await resolveEffectiveUserId(
        auth.user_id,
        auth,
        formId,
      );
    } catch (error) {
      if (error instanceof FormPermissionError) {
        return c.json(
          externalServicePermissionErrorResponse(error),
          formPermissionErrorStatus(error),
        );
      }
      throw error;
    }

    const query = Object.fromEntries(
      Object.entries(c.req.query()).filter(([k]) => k !== "formId"),
    );

    try {
      const result = await handler({
        userId: auth.user_id,
        query,
        getLinkedAccount: (providerId) =>
          getLinkedAccount(effectiveUserId, providerId),
      });
      const response = externalServiceApiResponseSchema.parse(result);
      return c.json(response);
    } catch (error) {
      return c.json(
        externalServiceFailureResponse(
          error instanceof Error ? error.message : "Unknown error",
        ),
        502,
      );
    }
  });
