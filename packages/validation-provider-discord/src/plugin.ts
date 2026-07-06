import type {
  ValidationProvider,
  ValidationProviderResult,
  ValidationProviderRule,
} from "@nexus-form/integrations";
import { z } from "zod";
import { DiscordErrorCode } from "./error-codes";
import {
  hasAdministratorPermission,
  ZDiscordPermissionString,
} from "./permissions";
import {
  discordApiFetch,
  getGuildRoles as fetchGuildRoles,
  findGuildMemberByUsername,
  getBelongGuilds,
  getGuild,
} from "./requests";
import {
  type DiscordGuildMember,
  type DiscordGuildRole,
  ZDiscordGuildId,
  ZDiscordGuildRoleId,
  ZDiscordToken,
} from "./types";
import { DiscordHttpError } from "./utils";

const RETRYABLE_NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "ECONNRESET",
  "EAI_AGAIN",
  "ECONNABORTED",
]);

function getStringProperty(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" ? property : undefined;
}

function isRetryableNetworkError(error: unknown): boolean {
  const code = getStringProperty(error, "code");
  if (code != null && RETRYABLE_NETWORK_ERROR_CODES.has(code)) return true;

  const name = getStringProperty(error, "name");
  if (name === "AbortError" || name === "TimeoutError") return true;

  const message = getStringProperty(error, "message")?.toLowerCase();
  return (
    message?.includes("timeout") === true ||
    message?.includes("network") === true ||
    message?.includes("fetch failed") === true
  );
}

const DiscordInputSchema = z.string().regex(/^[a-z0-9_.]{2,32}$/);

const DiscordConfigSchema = z.object({
  guildId: ZDiscordGuildId.optional(),
  roleIds: z.array(ZDiscordGuildRoleId).optional(),
  roleCondition: z.enum(["AND", "OR"]).optional(),
  usernameLookupMode: z.enum(["single_search", "legacy_scan"]).optional(),
});

const DiscordMetadataSchema = z.object({
  userId: z.string(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
  guildMember: z.boolean(),
  roles: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.number().int(),
    }),
  ),
});

const DISCORD_EXTERNAL_SERVICE_ERROR_MESSAGE =
  "Discord APIへの接続に失敗しました。しばらくしてから再試行してください";
const DISCORD_EXTERNAL_REQUEST_ERROR_MESSAGE =
  "Discord APIへのリクエストに失敗しました";

const DiscordUserGuildSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  permissions: ZDiscordPermissionString,
});

const DiscordRolesQuerySchema = z.object({
  guildId: z.string(),
});

const DiscordGuildsApiResponseSchema = z.object({
  guilds: z.array(
    z.object({
      guildId: ZDiscordGuildId,
      name: z.string(),
      iconUrl: z.string().url().nullable(),
    }),
  ),
});

const DiscordRolesApiResponseSchema = z.object({
  roles: z.array(
    z.object({
      id: ZDiscordGuildRoleId,
      name: z.string(),
      color: z.number().int(),
    }),
  ),
});

function normalizeDiscordUsername(username: string): string {
  let normalized = username.trim();
  if (normalized.startsWith("@")) {
    normalized = normalized.slice(1);
  }
  // Current Discord usernames are case-sensitive only in display, while the
  // account handle accepted by this provider must already be lowercase.
  if (/#\d{4}$/.test(normalized)) {
    throw new Error(
      "旧式のDiscriminator付きユーザー名はサポートされていません",
    );
  }
  return normalized;
}

function filterMemberRoles(
  guildRoles: DiscordGuildRole[],
  member: DiscordGuildMember,
): Array<{ id: string; name: string; color: number }> {
  const memberRoleIds = new Set(member.roles);
  return guildRoles
    .filter((role: DiscordGuildRole) => memberRoleIds.has(role.id))
    .map((role: DiscordGuildRole) => ({
      id: role.id,
      name: role.name,
      color: role.color,
    }));
}

function buildDiscordOutputValues(params: {
  username: string;
  displayName: string;
  guildMember: boolean;
  roles: Array<{ name: string }>;
}): ValidationProviderResult["outputValues"] {
  return [
    {
      key: "username",
      label: "Discord username",
      value: params.username,
    },
    {
      key: "display_name",
      label: "Display name",
      value: params.displayName,
    },
    {
      key: "guild_member",
      label: "Guild member",
      value: params.guildMember,
    },
    {
      key: "roles",
      label: "Roles",
      value: params.roles.map((role) => role.name).join(", "),
    },
  ];
}

function evaluateRoleConditions(
  guildRoles: DiscordGuildRole[],
  member: DiscordGuildMember,
  requiredRoleIds: string[],
  condition: "AND" | "OR",
): { passed: boolean; message: string } {
  if (!requiredRoleIds || requiredRoleIds.length === 0) {
    return { passed: true, message: "ロール条件なし" };
  }

  const memberRoleIds = new Set(member.roles);
  const roleMap = new Map(guildRoles.map((r: DiscordGuildRole) => [r.id, r]));

  if (condition === "AND") {
    const missingRoleIds = requiredRoleIds.filter(
      (roleId) => !memberRoleIds.has(roleId),
    );
    if (missingRoleIds.length > 0) {
      const missingRoleNames = missingRoleIds
        .map((roleId) => roleMap.get(roleId)?.name ?? roleId)
        .join(", ");
      return {
        passed: false,
        message: `必要なロールが不足しています（AND条件）: ${missingRoleNames}`,
      };
    }
    return {
      passed: true,
      message: "すべてのロール条件を満たしています（AND条件）",
    };
  }

  const hasAnyRole = requiredRoleIds.some((roleId) =>
    memberRoleIds.has(roleId),
  );
  if (!hasAnyRole) {
    const requiredRoleNames = requiredRoleIds
      .map((roleId) => roleMap.get(roleId)?.name ?? roleId)
      .join(", ");
    return {
      passed: false,
      message: `いずれかのロールが必要です（OR条件）: ${requiredRoleNames}`,
    };
  }

  return { passed: true, message: "ロール条件を満たしています（OR条件）" };
}

function buildGuildIconUrl(
  guildId: string,
  icon: string | null,
): string | null {
  if (!icon) return null;
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.webp`;
}

async function fetchUserGuilds(accessToken: string) {
  const response = await discordApiFetch(
    "https://discord.com/api/v10/users/@me/guilds",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Discord guilds: ${response.statusText} (HTTP ${response.status})`,
    );
  }

  const guilds = z
    .array(DiscordUserGuildSchema)
    .safeParse(await response.json());
  if (!guilds.success) {
    throw new Error("Failed to parse Discord guilds", { cause: guilds.error });
  }
  return guilds.data;
}

async function getConfiguredGuildRoles(
  guildId: string,
): Promise<Array<{ id: string; name: string; color: number }>> {
  const rawToken = process.env.DISCORD_BOT_TOKEN;
  if (!rawToken) {
    throw new Error("DISCORD_BOT_TOKEN is not set");
  }

  const token = ZDiscordToken.parse(rawToken);
  const parsedGuildId = ZDiscordGuildId.parse(guildId);
  const guildRoles = await fetchGuildRoles(token, parsedGuildId);

  return guildRoles
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const guildMemberRule: ValidationProviderRule = {
  name: "guild_member",
  label: "サーバーメンバー検証",
  description:
    "Discordサーバーへの参加状況（必要に応じてロール）を検証します。実行にはDISCORD_BOT_TOKENと、対象サーバーに追加済みでメンバー検索・ロール取得が可能なBot権限が必要です。",
  inputHint:
    "Discordユーザー名を入力してください（@不要）。Botがサーバーに未参加、または必要権限が不足している場合は権限不足として失敗します。",
  inputPattern: "^[a-z0-9_.]{2,32}$",
  patternTemplate: {
    id: "discord",
    displayName: "Discord",
    pattern: "^[a-z0-9_.]{2,32}$",
    errorMessage:
      "Discordのユーザー名形式で入力してください（2-32文字の小文字英数字、アンダースコア、ピリオド）",
    placeholder: "username",
    description: "2-32文字の小文字英数字、アンダースコア、ピリオド",
    minLength: 2,
    maxLength: 32,
    externalService: "discord",
  },
  configFields: [
    {
      name: "guildId",
      label: "Discordサーバー",
      kind: "select",
      required: true,
      description:
        "検証対象のDiscordサーバーを選択してください。選択肢には、連携ユーザーが管理者権限を持ち、かつ検証用Botが参加済みのサーバーだけが表示されます。",
      optionSource: {
        endpoint: "/api/external-service/discord/guilds",
        collectionPath: "guilds",
        valuePath: "guildId",
        labelPath: "name",
      },
    },
    {
      name: "roleIds",
      label: "必要なロール",
      kind: "multiselect",
      description:
        "検証に必要なロールを選択してください（複数選択可）。Botにロール一覧取得権限がない場合は設定取得または検証が権限不足として失敗します。",
      defaultValue: [],
      optionSource: {
        endpoint: "/api/external-service/discord/roles?guildId={guildId}",
        collectionPath: "roles",
        valuePath: "id",
        labelPath: "name",
        colorPath: "color",
        dependsOn: "guildId",
      },
      showWhen: {
        field: "guildId",
        exists: true,
      },
    },
    {
      name: "roleCondition",
      label: "ロール条件",
      kind: "radio",
      defaultValue: "AND",
      description: "複数のロールを選択した場合の条件を指定してください",
      options: [
        { value: "AND", label: "すべてのロールが必要（AND）" },
        { value: "OR", label: "いずれかのロールが必要（OR）" },
      ],
      showWhen: {
        field: "roleIds",
        minItems: 2,
      },
    },
    {
      name: "usernameLookupMode",
      label: "ユーザー名検索方式",
      kind: "radio",
      defaultValue: "single_search",
      description:
        "既定ではDiscord API呼び出しを1回の検索に制限します。legacy scanは大型ギルドで追加の一覧取得を行うため、必要な場合のみ有効化してください。",
      options: [
        { value: "single_search", label: "単一検索のみ（推奨）" },
        { value: "legacy_scan", label: "従来の追加スキャンを許可" },
      ],
      showWhen: {
        field: "guildId",
        exists: true,
      },
    },
  ],
  inputSchema: DiscordInputSchema,
  configSchema: DiscordConfigSchema,
  metadataSchema: DiscordMetadataSchema,

  async validate(input, config): Promise<ValidationProviderResult> {
    const rawToken = process.env.DISCORD_BOT_TOKEN;
    if (!rawToken) {
      return {
        isValid: false,
        errorCode: DiscordErrorCode.DISCORD_API_ERROR,
        errorMessage: "DISCORD_BOT_TOKEN is not set",
      };
    }

    const parsedConfig = DiscordConfigSchema.parse(config);
    const {
      guildId,
      roleIds = [],
      roleCondition = "AND",
      usernameLookupMode = "single_search",
    } = parsedConfig;

    if (!guildId) {
      return {
        isValid: false,
        errorCode: DiscordErrorCode.DISCORD_API_ERROR,
        errorMessage: "Discord guildId is required",
      };
    }

    const username = input;

    try {
      const token = ZDiscordToken.parse(rawToken);
      const parsedGuildId = ZDiscordGuildId.parse(guildId);

      const guild = await getGuild(token, parsedGuildId);
      const member = await findGuildMemberByUsername(
        token,
        parsedGuildId,
        username,
        { allowListFallback: usernameLookupMode === "legacy_scan" },
      );

      if (!member) {
        return {
          isValid: false,
          errorCode: DiscordErrorCode.DISCORD_USER_NOT_MEMBER,
          errorMessage: `ユーザー「${username}」はギルド「${guild.name}」のメンバーではありません`,
        };
      }

      const guildRoles = await fetchGuildRoles(token, parsedGuildId);
      const roleCheckResult = evaluateRoleConditions(
        guildRoles,
        member,
        roleIds,
        roleCondition,
      );

      const roles = filterMemberRoles(guildRoles, member);
      const displayName =
        member.nick ?? member.user.global_name ?? member.user.username;
      const avatarUrl = member.user.avatar
        ? `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`
        : null;

      if (!roleCheckResult.passed) {
        return {
          isValid: false,
          errorCode: DiscordErrorCode.DISCORD_ROLE_REQUIREMENT_UNMET,
          errorMessage: roleCheckResult.message,
          metadata: {
            userId: member.user.id,
            username: member.user.username,
            displayName,
            avatarUrl,
            guildMember: true,
            roles,
          },
          outputValues: buildDiscordOutputValues({
            username: member.user.username,
            displayName,
            guildMember: true,
            roles,
          }),
        };
      }

      return {
        isValid: true,
        metadata: {
          userId: member.user.id,
          username: member.user.username,
          displayName,
          avatarUrl,
          guildMember: true,
          roles,
        },
        outputValues: buildDiscordOutputValues({
          username: member.user.username,
          displayName,
          guildMember: true,
          roles,
        }),
      };
    } catch (error) {
      if (error instanceof DiscordHttpError) {
        if (error.status === 429) {
          return {
            isValid: false,
            errorCode: DiscordErrorCode.DISCORD_API_RATE_LIMIT,
            errorMessage: "Discord API rate limit exceeded",
            retryAfter: Math.ceil(error.retryAfterSeconds || 30),
            retryable: true,
          };
        }
        if (error.status === 401) {
          return {
            isValid: false,
            errorCode: DiscordErrorCode.DISCORD_AUTH_FAILED,
            errorMessage: "Discord API authentication failed",
          };
        }
        if (error.status === 403) {
          return {
            isValid: false,
            errorCode: DiscordErrorCode.DISCORD_BOT_NOT_IN_GUILD,
            errorMessage:
              "検証用Botが指定されたDiscordサーバーに追加されていないか、必要な権限がありません",
          };
        }
        if (error.status === 404) {
          return {
            isValid: false,
            errorCode: DiscordErrorCode.DISCORD_GUILD_NOT_FOUND,
            errorMessage: `指定されたDiscordサーバーが見つかりません: ${guildId}`,
          };
        }
        if (error.status >= 500) {
          return {
            isValid: false,
            errorCode: DiscordErrorCode.DISCORD_API_ERROR,
            errorMessage: DISCORD_EXTERNAL_SERVICE_ERROR_MESSAGE,
            retryable: true,
          };
        }
      }

      const retryable =
        !(error instanceof DiscordHttpError) && isRetryableNetworkError(error);
      return {
        isValid: false,
        errorCode: DiscordErrorCode.DISCORD_API_ERROR,
        errorMessage: retryable
          ? DISCORD_EXTERNAL_SERVICE_ERROR_MESSAGE
          : DISCORD_EXTERNAL_REQUEST_ERROR_MESSAGE,
        retryable,
      };
    }
  },

  normalizeInput(input: string): string {
    return normalizeDiscordUsername(input);
  },
};

export const discordProvider: ValidationProvider = {
  name: "discord",
  label: "Discord",
  description: "Discordサーバーへの参加状況を検証します",
  rules: {
    guild_member: guildMemberRule,
  },
  apiHandlers: {
    async guilds(context) {
      const rawToken = process.env.DISCORD_BOT_TOKEN;
      if (!rawToken) {
        return { guilds: [] };
      }

      const linkedAccount = await context.getLinkedAccount("discord");
      if (!linkedAccount?.accessToken) {
        return { guilds: [] };
      }

      const token = ZDiscordToken.parse(rawToken);
      const [userGuilds, botGuilds] = await Promise.all([
        fetchUserGuilds(linkedAccount.accessToken),
        getBelongGuilds(token),
      ]);

      const botGuildIds = new Set(botGuilds.map((g) => g.id as string));
      const adminGuilds = userGuilds.filter((guild) =>
        hasAdministratorPermission(guild.permissions),
      );

      return {
        guilds: adminGuilds
          .filter((guild) => botGuildIds.has(guild.id))
          .map((guild) => ({
            guildId: guild.id,
            name: guild.name,
            iconUrl: buildGuildIconUrl(guild.id, guild.icon),
          })),
      };
    },

    async roles(context) {
      const { guildId } = DiscordRolesQuerySchema.parse(context.query);
      if (!ZDiscordGuildId.safeParse(guildId).success) {
        throw new Error("Invalid guild ID format");
      }

      const linkedAccount = await context.getLinkedAccount("discord");
      if (!linkedAccount?.accessToken) {
        throw new Error("Discord account not linked");
      }

      const guilds = await fetchUserGuilds(linkedAccount.accessToken);
      const hasAdministratorAccess = guilds.some((guild) => {
        if (guild.id !== guildId) return false;
        return hasAdministratorPermission(guild.permissions);
      });
      if (!hasAdministratorAccess) {
        throw new Error("Access denied to this guild");
      }

      const roles = await getConfiguredGuildRoles(guildId);
      return { roles };
    },
  },
  apiResponseSchemas: {
    guilds: DiscordGuildsApiResponseSchema,
    roles: DiscordRolesApiResponseSchema,
  },

  async healthCheck(): Promise<boolean> {
    return pingDiscordApi();
  },
};

async function pingDiscordApi(): Promise<boolean> {
  try {
    const res = await discordApiFetch("https://discord.com/api/v10/gateway", {
      method: "GET",
    });
    return res.ok || res.status === 401 || res.status === 403;
  } catch {
    return false;
  }
}

export default discordProvider;
