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
import { and, eq } from "drizzle-orm";
import { brandConfig } from "./brand-config";
import { logError, logInfo, logWarn } from "./logger";

function getDiscordProvider():
  | { discord: { clientId: string; clientSecret: string; scope: string[] } }
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
    discord: { clientId, clientSecret, scope: ["identify", "email", "guilds"] },
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

export const auth = betterAuth({
  basePath: "/api/auth",
  trustedOrigins: process.env.TRUSTED_ORIGINS
    ? process.env.TRUSTED_ORIGINS.split(",")
    : ["http://localhost:3000"],
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
  },
  secret: getAuthSecret(),
  databaseHooks: {
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

    const guilds = (await guildsResponse.json()) as Array<{
      id: string;
      name: string;
      icon: string | null;
      permissions: string;
    }>;

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
          const botGuilds = (await botGuildsResponse.json()) as Array<{
            id: string;
          }>;
          const botGuildIds = new Set(botGuilds.map((g) => g.id));
          filteredGuilds = adminGuilds.filter((guild) =>
            botGuildIds.has(guild.id),
          );
        } else {
          logWarn(
            "Failed to fetch Bot guilds, syncing all administrator guilds",
            "integration",
            {},
          );
        }
      } catch (botError) {
        logWarn(
          "Failed to fetch Bot guilds, syncing all administrator guilds",
          "integration",
          { error: botError },
        );
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
