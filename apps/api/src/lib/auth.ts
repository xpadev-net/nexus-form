import { randomBytes } from "node:crypto";
import {
  account,
  db,
  session,
  user as userTable,
  verificationToken,
} from "@nexus-form/database";
import { discordGuild, discordUser } from "@nexus-form/database/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { brandConfig } from "./brand-config";
import {
  assertProductionCorsOriginsConfigured,
  getCorsOrigins,
} from "./cors-origins";
import { logError, logInfo, logWarn } from "./logger";

export const INVITATION_AUTHORIZATION_COOKIE_NAME = "invitation-token";
export const INVITATION_AUTHORIZATION_TTL_SECONDS = 5 * 60;

const INVITATION_AUTHORIZATION_IDENTIFIER_PREFIX = "signup-invitation";
const INVITATION_AUTHORIZATION_VALUE = "authorized";
const invitationAuthorizationTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const AUTH_STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const discordSocialSignInSchema = z
  .object({ provider: z.literal("discord") })
  .passthrough();

const getInvitationAuthorizationIdentifier = (token: string): string =>
  `${INVITATION_AUTHORIZATION_IDENTIFIER_PREFIX}:${token}`;

type InvitationAuthorizationFinder = (
  identifier: string,
) => Promise<{ expiresAt: Date } | null>;

const discordCallbackSchema = z.object({
  path: z.literal("/callback/:id"),
  params: z.object({ id: z.literal("discord") }),
});
const discordIdTokenSignInSchema = z.object({
  path: z.literal("/sign-in/social"),
  body: z.object({ provider: z.literal("discord") }).passthrough(),
});

const isDiscordUserCreationContext = (context: unknown): boolean =>
  discordCallbackSchema.safeParse(context).success ||
  discordIdTokenSignInSchema.safeParse(context).success;

const signupDisabledError = (): APIError =>
  new APIError("FORBIDDEN", { message: "signup disabled" });

export async function authorizeDiscordSignupRequest(input: {
  path: string;
  body: unknown;
  invitationToken: string | null;
  findInvitation: InvitationAuthorizationFinder;
}): Promise<{ body: unknown; apply: boolean }> {
  if (input.path !== "/sign-in/social") {
    return { body: input.body, apply: false };
  }

  const parsedBody = discordSocialSignInSchema.safeParse(input.body);
  if (!parsedBody.success) {
    return { body: input.body, apply: false };
  }

  const parsedToken = invitationAuthorizationTokenSchema.safeParse(
    input.invitationToken,
  );
  const authorization = parsedToken.success
    ? await input.findInvitation(
        getInvitationAuthorizationIdentifier(parsedToken.data),
      )
    : null;
  const authorizationExpiresAt = authorization?.expiresAt.getTime();
  const requestSignUp =
    authorizationExpiresAt !== undefined &&
    Number.isFinite(authorizationExpiresAt) &&
    authorizationExpiresAt > Date.now();

  return {
    body: {
      ...parsedBody.data,
      requestSignUp,
    },
    apply: true,
  };
}

const discordGuildResponseSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string(),
    icon: z.string().nullable(),
    permissions: z.string().regex(/^\d+$/),
  }),
);

const discordBotGuildResponseSchema = z.array(
  z.object({
    id: z.string().min(1),
  }),
);

function getDiscordProvider():
  | {
      discord: {
        clientId: string;
        clientSecret: string;
        scope: string[];
        disableImplicitSignUp: true;
      };
    }
  | undefined {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    logWarn(
      "DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET is not set; Discord OAuth disabled",
      "auth",
      {},
    );
    return undefined;
  }
  return {
    discord: {
      clientId,
      clientSecret,
      scope: ["identify", "email", "guilds"],
      disableImplicitSignUp: true,
    },
  };
}

function getAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "BETTER_AUTH_SECRET or AUTH_SECRET must be set in production",
      );
    }
    logWarn(
      "BETTER_AUTH_SECRET or AUTH_SECRET is not set; session signing will be insecure",
      "auth",
      {},
    );
    return "insecure-default-for-development-only";
  }
  return secret;
}

const authTrustedOrigins = getCorsOrigins();
assertProductionCorsOriginsConfigured();
const authTrustedOriginSet = new Set(authTrustedOrigins);

function normalizeAuthOrigin(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function hasTrustedAuthOrigin(request: Request | undefined): boolean {
  if (
    !request ||
    !AUTH_STATE_CHANGING_METHODS.has(request.method) ||
    !request.headers.get("cookie")?.trim()
  ) {
    return true;
  }

  const originHeader = request.headers.get("origin");
  const candidate = originHeader ?? request.headers.get("referer");
  const origin = normalizeAuthOrigin(candidate);
  return origin !== null && authTrustedOriginSet.has(origin);
}

export const auth = betterAuth({
  basePath: "/api/auth",
  trustedOrigins: authTrustedOrigins,
  database: drizzleAdapter(db, {
    provider: "mysql",
    schema: {
      user: userTable,
      session,
      account,
      verification: verificationToken,
    },
  }),
  socialProviders: {
    ...getDiscordProvider(),
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "user",
      },
      isSuspended: {
        type: "boolean",
        defaultValue: false,
      },
    },
  },
  advanced: {
    // Changing this value on a running deployment will invalidate all active
    // user sessions, as session cookies are prefixed with this value.
    cookiePrefix: brandConfig.cookiePrefix,
    cookies: {
      session_token: {
        attributes: { sameSite: "lax" },
      },
      session_data: {
        attributes: { sameSite: "lax" },
      },
      account_data: {
        attributes: { sameSite: "lax" },
      },
      dont_remember: {
        attributes: { sameSite: "lax" },
      },
    },
  },
  secret: getAuthSecret(),
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (!hasTrustedAuthOrigin(ctx.request)) {
        throw new APIError("FORBIDDEN", { message: "Invalid origin" });
      }

      const invitationToken = ctx.getCookie(
        INVITATION_AUTHORIZATION_COOKIE_NAME,
      );
      const decision = await authorizeDiscordSignupRequest({
        path: ctx.path,
        body: ctx.body,
        invitationToken,
        findInvitation: (identifier) =>
          ctx.context.internalAdapter.findVerificationValue(identifier),
      });

      if (!decision.apply) return;
      return { context: { body: decision.body } };
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (_user, context) => {
          if (!context || !isDiscordUserCreationContext(context)) return;

          const parsedToken = invitationAuthorizationTokenSchema.safeParse(
            context.getCookie(INVITATION_AUTHORIZATION_COOKIE_NAME),
          );
          if (!parsedToken.success) throw signupDisabledError();

          const authorization =
            await context.context.internalAdapter.consumeVerificationValue(
              getInvitationAuthorizationIdentifier(parsedToken.data),
            );
          if (!authorization) throw signupDisabledError();
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          try {
            const userId =
              "userId" in session ? (session.userId as string) : null;
            if (!userId) return;

            // Find Discord account for this user
            const [discordAccount] = await db
              .select({
                accountId: account.accountId,
                accessToken: account.accessToken,
              })
              .from(account)
              .where(
                and(
                  eq(account.userId, userId),
                  eq(account.providerId, "discord"),
                ),
              )
              .limit(1);

            if (!discordAccount?.accessToken) return;

            // Get user info for email/avatar sync
            const [userData] = await db
              .select({
                email: userTable.email,
                image: userTable.image,
              })
              .from(userTable)
              .where(eq(userTable.id, userId))
              .limit(1);

            // Fire-and-forget: sync guilds in background
            void syncDiscordGuilds(
              discordAccount.accountId,
              discordAccount.accessToken,
            );

            // Fire-and-forget: sync user info in background
            if (userData) {
              void syncDiscordUserInfo(
                discordAccount.accountId,
                userData.email,
                userData.image ?? null,
              );
            }
          } catch (error) {
            logError("Failed to trigger Discord sync after sign-in", "auth", {
              error,
            });
          }
        },
      },
    },
  },
});

export async function issueInvitationSignupAuthorization(): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const context = await auth.$context;
  await context.internalAdapter.createVerificationValue({
    identifier: getInvitationAuthorizationIdentifier(token),
    value: INVITATION_AUTHORIZATION_VALUE,
    expiresAt: new Date(
      Date.now() + INVITATION_AUTHORIZATION_TTL_SECONDS * 1_000,
    ),
  });
  return token;
}

/**
 * Discord サインイン後のギルド同期処理
 * Better Auth の afterSignIn で呼び出す
 *
 * @param discordUserId - Discord user's providerAccountId
 * @param accessToken - Discord OAuth access token
 */
export async function syncDiscordGuilds(
  discordUserId: string,
  accessToken: string,
): Promise<void> {
  try {
    // ユーザーのギルド一覧を取得
    const guildsResponse = await fetch(
      "https://discord.com/api/v10/users/@me/guilds",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!guildsResponse.ok) {
      logWarn("Failed to fetch Discord guilds", "integration", {
        status: guildsResponse.status,
      });
      return;
    }

    const parsedGuilds = discordGuildResponseSchema.safeParse(
      await guildsResponse.json(),
    );
    if (!parsedGuilds.success) {
      logWarn("Invalid Discord guilds response", "integration", {
        error: parsedGuilds.error,
      });
      return;
    }
    const guilds = parsedGuilds.data;

    // 管理者権限 (0x8) を持つギルドのみフィルタリング
    const ADMINISTRATOR = BigInt(0x8);
    const adminGuilds = guilds.filter((guild) => {
      const permissions = BigInt(guild.permissions);
      return (permissions & ADMINISTRATOR) === ADMINISTRATOR;
    });

    // Bot のギルドリストでフィルタリング（設定されている場合）
    let filteredGuilds = adminGuilds;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (botToken) {
      try {
        const botGuildsResponse = await fetch(
          "https://discord.com/api/v10/users/@me/guilds",
          {
            headers: {
              Authorization: `Bot ${botToken}`,
            },
          },
        );

        if (botGuildsResponse.ok) {
          const parsedBotGuilds = discordBotGuildResponseSchema.safeParse(
            await botGuildsResponse.json(),
          );
          if (!parsedBotGuilds.success) {
            logWarn("Invalid Discord bot guilds response", "integration", {
              error: parsedBotGuilds.error,
            });
            return;
          }
          const botGuilds = parsedBotGuilds.data;
          const botGuildIds = new Set(botGuilds.map((g) => g.id));
          filteredGuilds = adminGuilds.filter((guild) =>
            botGuildIds.has(guild.id),
          );
        } else {
          logWarn("Failed to fetch Bot guilds", "integration", {
            status: botGuildsResponse.status,
          });
          return;
        }
      } catch (botError) {
        logWarn("Failed to fetch Bot guilds", "integration", {
          error: botError,
        });
        return;
      }
    }

    // 既存のギルド情報を削除
    await db
      .delete(discordGuild)
      .where(eq(discordGuild.discordUserId, discordUserId));

    // 新しいギルド情報を保存
    if (filteredGuilds.length > 0) {
      const buildGuildIconUrl = (
        guildId: string,
        icon: string | null,
      ): string | null => {
        if (!icon) return null;
        return `https://cdn.discordapp.com/icons/${guildId}/${icon}.webp`;
      };

      await db.insert(discordGuild).values(
        filteredGuilds.map((guild) => ({
          id: crypto.randomUUID(),
          guildId: guild.id,
          name: guild.name,
          iconUrl: buildGuildIconUrl(guild.id, guild.icon),
          discordUserId,
        })),
      );
    }

    logInfo(
      `Synced ${filteredGuilds.length} administrator guilds for Discord user ${discordUserId}`,
      "integration",
      {},
    );
  } catch (error) {
    logError("Failed to sync Discord guilds during sign-in", "integration", {
      error,
    });
  }
}

/**
 * Discord ユーザー情報を同期
 */
export async function syncDiscordUserInfo(
  discordAccountId: string,
  email: string,
  avatarUrl: string | null,
): Promise<void> {
  try {
    const [existing] = await db
      .select({ id: discordUser.id })
      .from(discordUser)
      .where(eq(discordUser.discordUserId, discordAccountId))
      .limit(1);

    if (existing) {
      await db
        .update(discordUser)
        .set({
          email,
          avatarUrl,
        })
        .where(eq(discordUser.discordUserId, discordAccountId));
    } else {
      await db.insert(discordUser).values({
        id: crypto.randomUUID(),
        discordUserId: discordAccountId,
        email,
        avatarUrl,
      });
    }
  } catch (error) {
    logError("Failed to sync Discord user info", "integration", {
      error,
    });
  }
}
