import { requests } from "../../utils/requests";
import { discordLimit } from "../plimit";
import { type DiscordGuildId, ZDiscordGuildMember } from "../types/guild";
import type { DiscordToken } from "../types/token";
import type { DiscordUserId } from "../types/user";

export const getGuildMember = async (
  token: DiscordToken,
  guildId: DiscordGuildId,
  userId: DiscordUserId,
) => {
  const response = await discordLimit(() =>
    requests(
      `https://discord.com/api/v10/guilds/${guildId}/members/${userId}`,
      {
        headers: {
          Authorization: `Bot ${token}`,
        },
      },
    ),
  );
  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(
      `Failed to get guild member: ${response.statusText} (HTTP ${response.status})`,
    );
  }
  const data = ZDiscordGuildMember.safeParse(await response.json());
  if (!data.success) {
    throw new Error(`Failed to parse guild member: ${data.error}`);
  }
  return data.data;
};
