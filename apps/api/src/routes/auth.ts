import { zValidator } from "@hono/zod-validator";
import { db, user } from "@nexus-form/database";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  INVITATION_AUTHORIZATION_COOKIE_NAME,
  INVITATION_AUTHORIZATION_TTL_SECONDS,
  issueInvitationSignupAuthorization,
} from "../lib/auth";
import { constantTimeEqual } from "../lib/crypto/field-encryption";
import { createHonoApp } from "../lib/hono";
import { logError, logWarn } from "../lib/logger";
import { authMiddleware, requireAuth } from "../lib/middleware";
import { getClientIp, invitationSignInRateLimiter } from "../lib/rate-limit";
import { isoDate } from "../types/domain/iso-date";

const updateMeSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  image: z.string().url().nullable().optional(),
});

const signInWithInvitationSchema = z.object({
  code: z.string().min(1),
});

const loopbackHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);

const isHttpLoopbackUrl = (value: string | undefined): boolean => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && loopbackHostnames.has(url.hostname);
  } catch {
    return false;
  }
};

const shouldUseSecureInvitationCookie = (
  requestUrl: string,
  requestOrigin: string | undefined,
): boolean => {
  const isLocalHttpDevelopment =
    isHttpLoopbackUrl(requestUrl) &&
    isHttpLoopbackUrl(requestOrigin) &&
    (process.env.NODE_ENV === undefined ||
      process.env.NODE_ENV === "development" ||
      process.env.NODE_ENV === "test");
  return !isLocalHttpDevelopment;
};

const AuthSessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
  emailVerified: z.boolean(),
  image: z.string().nullable().optional(),
  isSuspended: z.boolean(),
});

/** Error response shape returned by auth extension endpoints. */
export const AuthErrorResponseSchema = z.object({
  error: z.string().min(1),
});
/** Inferred TypeScript type for `AuthErrorResponseSchema`. */
export type AuthErrorResponse = z.infer<typeof AuthErrorResponseSchema>;

const authError = (error: string): AuthErrorResponse => ({ error });

const AuthMeResponseSchema = z.object({
  user: AuthSessionUserSchema,
});
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

const AuthUpdatedUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  image: z.string().nullable(),
  role: z.string(),
  isSuspended: z.boolean(),
});

const AuthUpdateMeResponseSchema = z.object({
  user: AuthUpdatedUserSchema.nullable(),
});
export type AuthUpdateMeResponse = z.infer<typeof AuthUpdateMeResponseSchema>;

const SignInWithInvitationResponseSchema = z.object({
  ok: z.literal(true),
  redirectUrl: z.string(),
});
export type SignInWithInvitationResponse = z.infer<
  typeof SignInWithInvitationResponseSchema
>;

export const authRouter = createHonoApp()
  .use("*", authMiddleware)
  .get("/me", requireAuth, async (c) => {
    const currentUser = c.get("user");
    return c.json(AuthMeResponseSchema.parse({ user: currentUser }));
  })
  .put("/me", requireAuth, zValidator("json", updateMeSchema), async (c) => {
    const currentUser = c.get("user");
    if (!currentUser) {
      return c.json(authError("Unauthorized"), 401);
    }
    const payload = c.req.valid("json");
    await db
      .update(user)
      .set({
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.image !== undefined ? { image: payload.image } : {}),
      })
      .where(eq(user.id, currentUser.id));

    const [updated] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
        isSuspended: user.isSuspended,
      })
      .from(user)
      .where(eq(user.id, currentUser.id))
      .limit(1);

    return c.json(AuthUpdateMeResponseSchema.parse({ user: updated ?? null }));
  })
  .post(
    "/signin-with-invitation",
    invitationSignInRateLimiter,
    zValidator("json", signInWithInvitationSchema),
    async (c) => {
      const { code } = c.req.valid("json");

      const expectedCode = process.env.SIGNUP_INVITATION_CODE;
      if (!expectedCode) {
        return c.json(authError("招待コードが設定されていません"), 500);
      }

      if (!constantTimeEqual(code, expectedCode)) {
        logWarn("[Auth] Invalid invitation sign-in code", "api", {
          path: c.req.path,
          ip: getClientIp(c),
        });
        return c.json(authError("招待コードが正しくありません"), 400);
      }

      let invitationToken: string;
      try {
        invitationToken = await issueInvitationSignupAuthorization();
      } catch (error) {
        logError("Failed to issue invitation signup authorization", "api", {
          error,
        });
        return c.json(authError("サーバー構成エラーが発生しました"), 500);
      }

      // Store an opaque, single-use authorization in a short-lived cookie.
      c.header(
        "Set-Cookie",
        [
          `${INVITATION_AUTHORIZATION_COOKIE_NAME}=${invitationToken}`,
          "Path=/",
          "HttpOnly",
          "SameSite=Lax",
          shouldUseSecureInvitationCookie(c.req.url, c.req.header("Origin"))
            ? "Secure"
            : null,
          `Max-Age=${INVITATION_AUTHORIZATION_TTL_SECONDS}`,
        ]
          .filter(Boolean)
          .join("; "),
      );

      return c.json(
        SignInWithInvitationResponseSchema.parse({
          ok: true,
          redirectUrl: "/api/auth/sign-in/social",
        }),
      );
    },
  );
