import { account, db } from "@nexus-form/database";
import { form } from "@nexus-form/database/schema";
import { providerRegistry } from "@nexus-form/integrations";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { checkFormPermissionLevel, withDualAuth } from "../lib/dual-auth";
import { FormPermissionError } from "../lib/errors/form-errors";
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
  authContext: Parameters<typeof checkFormPermissionLevel>[0],
  formId: string | undefined,
): Promise<string> {
  if (!formId) return authUserId;

  await checkFormPermissionLevel(authContext, formId, "EDITOR");

  const [formRecord] = await db
    .select({ creatorId: form.creatorId })
    .from(form)
    .where(eq(form.id, formId))
    .limit(1);

  return formRecord?.creatorId ?? authUserId;
}

function formPermissionErrorStatus(error: FormPermissionError): 403 | 404 {
  return formPermissionErrorStatusSchema.parse(error.statusCode);
}

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

    const provider = providerRegistry.get(providerName.data);
    const handler = provider?.apiHandlers?.[apiName.data];
    if (!handler) {
      return c.json(errorResponse("External service API not found"), 404);
    }

    const formId = c.req.query("formId") || undefined;

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
          ExternalServicePermissionErrorResponseSchema.parse({
            error: {
              message: error.message,
              code: error.code,
              details: error.details,
            },
          }),
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
        ExternalServiceFailureResponseSchema.parse({
          error: "External service API failed",
          details: error instanceof Error ? error.message : "Unknown error",
        }),
        502,
      );
    }
  });
