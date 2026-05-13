import { z } from "zod";
import { requests } from "../../utils/requests";
import { discordLimit } from "../plimit";
import { type DiscordGuildId, ZDiscordGuildMember } from "../types/guild";
import type { DiscordToken } from "../types/token";

export const getSearchGuildMembers = async (
  token: DiscordToken,
  guildId: DiscordGuildId,
  query: string,
  limit: number = 25,
) => {
  const validLimit = Math.max(1, Math.min(1000, limit));
  const response = await discordLimit(() =>
    requests(
      `https://discord.com/api/v10/guilds/${guildId}/members/search?limit=${validLimit}&query=${encodeURIComponent(query)}`,
      {
        headers: {
          Authorization: `Bot ${token}`,
        },
      },
    ),
  );
  if (!response.ok) {
    console.error(await response.text());
    throw new Error(
      `Failed to get guild members: ${response.statusText} (HTTP ${response.status})`,
    );
  }
  const data = z.array(ZDiscordGuildMember).safeParse(await response.json());
  if (!data.success) {
    throw new Error(`Failed to parse guild: ${data.error}`);
  }
  return data.data;
};
