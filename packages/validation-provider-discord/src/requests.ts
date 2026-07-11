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
  ZDiscordUserId,
} from "./types";
import { DiscordHttpError } from "./utils";

const limit = pLimit(1);

export interface DiscordRequestOptions {
  readonly signal?: AbortSignal;
}

function getRateLimitRetryAfterSeconds(
  responseBody: unknown,
): number | undefined {
  const data = ZDiscordRateLimitResponse.safeParse(responseBody);
  if (!data.success) return undefined;
  return Number.isFinite(data.data.retry_after) && data.data.retry_after > 0
    ? data.data.retry_after
    : undefined;
}

/**
 * Fetches a Discord API URL with the configured timeout applied.
 *
 * @param url - Discord API URL to request.
 * @param init - Optional `RequestInit` values spread into the underlying fetch.
 * @returns The underlying `fetch` promise.
 *
 * The timeout comes from `AbortSignal.timeout(getDiscordApiTimeoutMs())`. When
 * `init.signal` is provided, it is combined with the timeout via
 * `AbortSignal.any()`, so the request aborts when either signal fires.
 */
export const discordApiFetch = (
  url: string,
  init: RequestInit = {},
): Promise<Response> => {
  const timeoutSignal = AbortSignal.timeout(getDiscordApiTimeoutMs());
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  return fetch(url, {
    ...init,
    signal,
  });
};

const discordFetchWithRateLimitHandling = async (
  url: string,
  init: RequestInit,
): Promise<Response> => {
  return limit(async () => {
    const response = await discordApiFetch(url, init);
    if (response.status === 429) {
      let retryAfterSeconds: number | undefined;
      try {
        retryAfterSeconds = getRateLimitRetryAfterSeconds(
          await response.json(),
        );
      } catch {
        retryAfterSeconds = undefined;
      }
      throw new DiscordHttpError(
        429,
        "Discord rate limit exceeded",
        retryAfterSeconds,
      );
    }
    return response;
  });
};

const discordRequest = async (
  url: string,
  token: DiscordToken,
  options?: DiscordRequestOptions,
): Promise<Response> => {
  return discordFetchWithRateLimitHandling(url, {
    headers: { Authorization: `Bot ${token}` },
    signal: options?.signal,
  });
};

const discordRequestWithMethod = async (
  url: string,
  token: DiscordToken,
  method: string,
  body?: unknown,
  options?: DiscordRequestOptions,
): Promise<Response> => {
  const headers: Record<string, string> = {
    Authorization: `Bot ${token}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const init: RequestInit = { method, headers, signal: options?.signal };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return discordFetchWithRateLimitHandling(url, init);
};

export async function getGuild(
  token: DiscordToken,
  guildId: DiscordGuildId,
  options?: DiscordRequestOptions,
): Promise<DiscordGuild> {
  const response = await discordRequest(
    `https://discord.com/api/v10/guilds/${guildId}?with_counts=true`,
    token,
    options,
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

const DISCORD_GUILD_MEMBER_PAGE_SIZE = 1000;
/**
 * Cap explicit opt-in list-member fallback scans to 3 pages (3k members).
 *
 * The search endpoint returns at most 1000 prefix-matched results. When that
 * page is full and no exact match is found, list-member fallback can consume
 * multiple large Discord API requests with respondent-controlled input. Keep
 * the default path to a single search request; allow this bounded scan only for
 * forms that explicitly opt in to the legacy behavior.
 */
const DISCORD_LIST_MEMBERS_MAX_PAGES = 3;

/**
 * Prefix-search guild members via Discord's Search Guild Members endpoint.
 *
 * @param token - Bot token used for `Authorization: Bot …`.
 * @param guildId - Target guild snowflake.
 * @param query - Prefix matched against usernames and nicknames (`query` is URL-encoded).
 * @param searchLimit - Max results per request (1–1000, default 25).
 * @returns Members whose username/nickname starts with `query` (up to `searchLimit`).
 * @throws {DiscordHttpError} When Discord returns a non-2xx HTTP status.
 * @throws {Error} When the response body cannot be parsed.
 *
 * Note: this endpoint accepts only `query` and `limit` (no `after` cursor). Use
 * {@link findGuildMemberByUsername} when an exact username match is required.
 */
export async function searchGuildMembers(
  token: DiscordToken,
  guildId: DiscordGuildId,
  query: string,
  searchLimit = 25,
  options?: DiscordRequestOptions,
): Promise<DiscordGuildMember[]> {
  const validLimit = Math.max(1, Math.min(1000, searchLimit));
  const params = new URLSearchParams({
    limit: String(validLimit),
    query,
  });
  const response = await discordRequest(
    `https://discord.com/api/v10/guilds/${guildId}/members/search?${params.toString()}`,
    token,
    options,
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

/**
 * Finds a guild member whose username exactly matches `username`.
 *
 * Uses Search Guild Members at `limit=1000`. By default, this function returns
 * `undefined` when that single search page is saturated without an exact match.
 * Set `allowListFallback` only for forms that explicitly opt in to the legacy
 * bounded List Guild Members scan.
 */
export async function findGuildMemberByUsername(
  token: DiscordToken,
  guildId: DiscordGuildId,
  username: string,
  options: { allowListFallback?: boolean; signal?: AbortSignal } = {},
): Promise<DiscordGuildMember | undefined> {
  const searchResults = await searchGuildMembers(
    token,
    guildId,
    username,
    DISCORD_GUILD_MEMBER_PAGE_SIZE,
    options,
  );
  const searchMatch = searchResults.find(
    (member) => member.user.username === username,
  );
  if (searchMatch) {
    return searchMatch;
  }
  if (searchResults.length < DISCORD_GUILD_MEMBER_PAGE_SIZE) {
    return undefined;
  }
  if (options.allowListFallback !== true) {
    return undefined;
  }

  let after: DiscordUserId | undefined;
  for (let page = 0; page < DISCORD_LIST_MEMBERS_MAX_PAGES; page += 1) {
    const members = await listGuildMembers(token, guildId, {
      limit: DISCORD_GUILD_MEMBER_PAGE_SIZE,
      after,
      signal: options.signal,
    });
    const listMatch = members.find(
      (member) => member.user.username === username,
    );
    if (listMatch) {
      return listMatch;
    }
    if (members.length < DISCORD_GUILD_MEMBER_PAGE_SIZE) {
      return undefined;
    }

    const lastMember = members.at(-1);
    if (!lastMember) {
      return undefined;
    }

    after = ZDiscordUserId.parse(lastMember.user.id);
  }

  return undefined;
}

export async function getGuildMember(
  token: DiscordToken,
  guildId: DiscordGuildId,
  userId: DiscordUserId,
  options?: DiscordRequestOptions,
): Promise<DiscordGuildMember> {
  const response = await discordRequest(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
    token,
    options,
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
  options?: DiscordRequestOptions,
): Promise<DiscordGuildRole[]> {
  const response = await discordRequest(
    `https://discord.com/api/v10/guilds/${guildId}/roles`,
    token,
    options,
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
  options?: DiscordRequestOptions,
): Promise<DiscordUser> {
  const response = await discordRequest(
    `https://discord.com/api/v10/users/${userId}`,
    token,
    options,
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
  options?: { limit?: number; after?: DiscordUserId; signal?: AbortSignal },
): Promise<DiscordGuildMember[]> {
  const memberLimit = Math.max(1, Math.min(1000, options?.limit ?? 1000));
  const params = new URLSearchParams({ limit: String(memberLimit) });
  if (options?.after !== undefined) {
    params.set("after", options.after);
  }
  const response = await discordRequest(
    `https://discord.com/api/v10/guilds/${guildId}/members?${params.toString()}`,
    token,
    options,
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
  options?: DiscordRequestOptions,
): Promise<void> {
  const response = await discordRequestWithMethod(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    token,
    "PUT",
    undefined,
    options,
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
  options?: DiscordRequestOptions,
): Promise<void> {
  const response = await discordRequestWithMethod(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    token,
    "DELETE",
    undefined,
    options,
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
  options?: DiscordRequestOptions,
): Promise<DiscordGuild[]> {
  const response = await discordRequest(
    "https://discord.com/api/v10/users/@me/guilds",
    token,
    options,
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
  options?: DiscordRequestOptions,
): Promise<DiscordApplication> {
  const response = await discordRequest(
    "https://discord.com/api/v10/applications/@me",
    token,
    options,
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
