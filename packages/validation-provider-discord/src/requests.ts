import pLimit from "p-limit";
import { z } from "zod";

import { getDiscordApiTimeoutMs } from "./config";
import {
  type DiscordApplication,
  type DiscordGuild,
  type DiscordGuildId,
  type DiscordGuildMember,
  type DiscordGuildRole,
  type DiscordGuildRoleId,
  type DiscordToken,
  type DiscordUser,
  type DiscordUserId,
  ZDiscordApplication,
  ZDiscordGuild,
  ZDiscordGuildMember,
  ZDiscordGuildRole,
  ZDiscordRateLimitResponse,
  ZDiscordUser,
} from "./types";
import { DiscordHttpError } from "./utils";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const limit = pLimit(3);

export const discordApiFetch = (
  url: string,
  init: RequestInit = {},
): Promise<Response> => {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(getDiscordApiTimeoutMs()),
  });
};

const discordFetchWithRetry = async (
  url: string,
  init: RequestInit,
): Promise<Response> => {
  return limit(async () => {
    const response = await discordApiFetch(url, init);
    if (response.status === 429) {
      const data = ZDiscordRateLimitResponse.parse(await response.json());
      await sleep(data.retry_after * 1000 * 1.5);
      const retryResponse = await discordApiFetch(url, init);
      if (retryResponse.status === 429) {
        const retryData = ZDiscordRateLimitResponse.parse(
          await retryResponse.json(),
        );
        await sleep(retryData.retry_after * 1000 * 2);
        const finalResponse = await discordApiFetch(url, init);
        if (finalResponse.status === 429) {
          await finalResponse.body?.cancel();
          throw new DiscordHttpError(
            429,
            "Discord rate limit exceeded after 3 attempts",
          );
        }
        return finalResponse;
      }
      return retryResponse;
    }
    return response;
  });
};

const discordRequest = async (
  url: string,
  token: DiscordToken,
): Promise<Response> => {
  return discordFetchWithRetry(url, {
    headers: { Authorization: `Bot ${token}` },
  });
};

const discordRequestWithMethod = async (
  url: string,
  token: DiscordToken,
  method: string,
  body?: unknown,
): Promise<Response> => {
  const headers: Record<string, string> = {
    Authorization: `Bot ${token}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return discordFetchWithRetry(url, init);
};

export async function getGuild(
  token: DiscordToken,
  guildId: DiscordGuildId,
): Promise<DiscordGuild> {
  const response = await discordRequest(
    `https://discord.com/api/v10/guilds/${guildId}?with_counts=true`,
    token,
  );
  if (!response.ok) {
    throw new DiscordHttpError(
      response.status,
      `Failed to get guild: ${response.statusText} (HTTP ${response.status})`,
    );
  }
  const data = ZDiscordGuild.safeParse(await response.json());
  if (!data.success) {
    throw new Error(`Failed to parse guild: ${data.error}`);
  }
  return data.data;
}

export async function searchGuildMembers(
  token: DiscordToken,
  guildId: DiscordGuildId,
  query: string,
  searchLimit = 25,
): Promise<DiscordGuildMember[]> {
  const validLimit = Math.max(1, Math.min(1000, searchLimit));
  const response = await discordRequest(
    `https://discord.com/api/v10/guilds/${guildId}/members/search?limit=${validLimit}&query=${encodeURIComponent(query)}`,
    token,
  );
  if (!response.ok) {
    throw new DiscordHttpError(
      response.status,
      `Failed to search guild members: ${response.statusText} (HTTP ${response.status})`,
    );
  }
  const data = z.array(ZDiscordGuildMember).safeParse(await response.json());
  if (!data.success) {
    throw new Error(`Failed to parse guild members: ${data.error}`);
  }
  return data.data;
}

export async function getGuildMember(
  token: DiscordToken,
  guildId: DiscordGuildId,
  userId: DiscordUserId,
): Promise<DiscordGuildMember> {
  const response = await discordRequest(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
    token,
  );
  if (!response.ok) {
    throw new DiscordHttpError(
      response.status,
      `Failed to get guild member: ${response.statusText} (HTTP ${response.status})`,
    );
  }
  const data = ZDiscordGuildMember.safeParse(await response.json());
  if (!data.success) {
    throw new Error(`Failed to parse guild member: ${data.error}`);
  }
  return data.data;
}

export async function getGuildRoles(
  token: DiscordToken,
  guildId: DiscordGuildId,
): Promise<DiscordGuildRole[]> {
  const response = await discordRequest(
    `https://discord.com/api/v10/guilds/${guildId}/roles`,
    token,
  );
  if (!response.ok) {
    throw new DiscordHttpError(
      response.status,
      `Failed to get guild roles: ${response.statusText} (HTTP ${response.status})`,
    );
  }
  const data = z.array(ZDiscordGuildRole).safeParse(await response.json());
  if (!data.success) {
    throw new Error(`Failed to parse guild roles: ${data.error}`);
  }
  return data.data;
}

export async function getUser(
  token: DiscordToken,
  userId: DiscordUserId,
): Promise<DiscordUser> {
  const response = await discordRequest(
    `https://discord.com/api/v10/users/${userId}`,
    token,
  );
  if (!response.ok) {
    throw new DiscordHttpError(
      response.status,
      `Failed to get user: ${response.statusText} (HTTP ${response.status})`,
    );
  }
  const data = ZDiscordUser.safeParse(await response.json());
  if (!data.success) {
    throw new Error(`Failed to parse user: ${data.error}`);
  }
  return data.data;
}

export async function listGuildMembers(
  token: DiscordToken,
  guildId: DiscordGuildId,
  options?: { limit?: number },
): Promise<DiscordGuildMember[]> {
  const memberLimit = Math.max(1, Math.min(1000, options?.limit ?? 1000));
  const response = await discordRequest(
    `https://discord.com/api/v10/guilds/${guildId}/members?limit=${memberLimit}`,
    token,
  );
  if (!response.ok) {
    throw new DiscordHttpError(
      response.status,
      `Failed to list guild members: ${response.statusText} (HTTP ${response.status})`,
    );
  }
  const data = z.array(ZDiscordGuildMember).safeParse(await response.json());
  if (!data.success) {
    throw new Error(`Failed to parse guild members: ${data.error}`);
  }
  return data.data;
}

export async function addGuildMemberRole(
  token: DiscordToken,
  guildId: DiscordGuildId,
  userId: DiscordUserId,
  roleId: DiscordGuildRoleId,
): Promise<void> {
  const response = await discordRequestWithMethod(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    token,
    "PUT",
  );
  if (!response.ok) {
    throw new DiscordHttpError(
      response.status,
      `Failed to add role: ${response.statusText} (HTTP ${response.status})`,
    );
  }
}

export async function deleteGuildMemberRole(
  token: DiscordToken,
  guildId: DiscordGuildId,
  userId: DiscordUserId,
  roleId: DiscordGuildRoleId,
): Promise<void> {
  const response = await discordRequestWithMethod(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    token,
    "DELETE",
  );
  if (!response.ok) {
    throw new DiscordHttpError(
      response.status,
      `Failed to delete role: ${response.statusText} (HTTP ${response.status})`,
    );
  }
}

export async function getBelongGuilds(
  token: DiscordToken,
): Promise<DiscordGuild[]> {
  const response = await discordRequest(
    "https://discord.com/api/v10/users/@me/guilds",
    token,
  );
  if (!response.ok) {
    throw new DiscordHttpError(
      response.status,
      `Failed to get belong guilds: ${response.statusText} (HTTP ${response.status})`,
    );
  }
  const data = z.array(ZDiscordGuild).safeParse(await response.json());
  if (!data.success) {
    throw new Error(`Failed to parse belong guilds: ${data.error}`);
  }
  return data.data;
}

export async function getSelfApplication(
  token: DiscordToken,
): Promise<DiscordApplication> {
  const response = await discordRequest(
    "https://discord.com/api/v10/applications/@me",
    token,
  );
  if (!response.ok) {
    throw new DiscordHttpError(
      response.status,
      `Failed to get self application: ${response.statusText} (HTTP ${response.status})`,
    );
  }
  const data = ZDiscordApplication.safeParse(await response.json());
  if (!data.success) {
    throw new Error(`Failed to parse self application: ${data.error}`);
  }
  return data.data;
}
