import { randomBytes } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db, user } from "@nexus-form/database";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { constantTimeEqual } from "../lib/crypto/field-encryption";
import { createHonoApp } from "../lib/hono";
import { authMiddleware, requireAuth } from "../lib/middleware";
import { isoDate } from "../types/domain/iso-date";

const updateMeSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  image: z.string().url().nullable().optional(),
});

const signInWithInvitationSchema = z.object({
  code: z.string().min(1),
});

const AuthSessionUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
  emailVerified: z.boolean(),
  image: z.string().nullable().optional(),
  isSuspended: z.boolean(),
});

const AuthMeResponseSchema = z.object({
  user: AuthSessionUserSchema,
});
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

const AuthUpdatedUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().email(),
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
      return c.json({ error: "Unauthorized" }, 401);
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
    zValidator("json", signInWithInvitationSchema),
    async (c) => {
      const { code } = c.req.valid("json");

      const expectedCode = process.env.SIGNUP_INVITATION_CODE;
      if (!expectedCode) {
        return c.json({ error: "招待コードが設定されていません" }, 500);
      }

      if (!constantTimeEqual(code, expectedCode)) {
        return c.json({ error: "招待コードが正しくありません" }, 400);
      }

      // 招待コードが正しい場合、一時トークンを生成して署名
      const invitationToken = randomBytes(32).toString("hex");
      const secret = process.env.AUTH_SECRET;
      if (!secret) {
        return c.json({ error: "サーバー構成エラーが発生しました" }, 500);
      }

      const signedToken = jwt.sign({ token: invitationToken }, secret, {
        algorithm: "HS256",
        expiresIn: "5m",
      });

      // 署名付きトークンをCookieに保存（5分で有効期限切れ）
      c.header(
        "Set-Cookie",
        [
          `invitation-token=${signedToken}`,
          "Path=/",
          "HttpOnly",
          "SameSite=Lax",
          process.env.NODE_ENV === "production" ? "Secure" : null,
          "Max-Age=300",
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
