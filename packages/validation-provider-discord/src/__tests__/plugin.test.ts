import { describe, expect, it } from "vitest";
import { discordProvider } from "../plugin";

describe("discordProvider.rules.guild_member.configSchema", () => {
  it("accepts valid Discord snowflake IDs", () => {
    const result = discordProvider.rules.guild_member?.configSchema.safeParse({
      guildId: "123456789012345678",
      roleIds: ["234567890123456789"],
      roleCondition: "AND",
    });

    expect(result?.success).toBe(true);
  });

  it("rejects empty guild IDs", () => {
    const result = discordProvider.rules.guild_member?.configSchema.safeParse({
      guildId: "",
    });

    expect(result?.success).toBe(false);
  });

  it("rejects malformed guild IDs", () => {
    const result = discordProvider.rules.guild_member?.configSchema.safeParse({
      guildId: "not-a-discord-id",
    });

    expect(result?.success).toBe(false);
  });

  it("rejects malformed role IDs", () => {
    const result = discordProvider.rules.guild_member?.configSchema.safeParse({
      guildId: "123456789012345678",
      roleIds: ["role-name"],
    });

    expect(result?.success).toBe(false);
  });
});
