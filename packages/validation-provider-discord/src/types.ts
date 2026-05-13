import { z } from "zod";

export const ZDiscordToken = z.string().brand<"DiscordToken">("DiscordToken");
export type DiscordToken = z.infer<typeof ZDiscordToken>;

const DiscordSnowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/, "Discord ID must be a 17-20 digit snowflake");

export const ZDiscordUserId =
  DiscordSnowflakeSchema.brand<"DiscordUserId">("DiscordUserId");
export type DiscordUserId = z.infer<typeof ZDiscordUserId>;

export const ZDiscordUsername = z.string().brand("DiscordUsername");
export type DiscordUsername = z.infer<typeof ZDiscordUsername>;

export const ZDiscordUser = z.object({
  id: z.string(),
  username: ZDiscordUsername,
  global_name: z.string().nullable(),
  discriminator: z.string(),
  avatar: z.string().nullable(),
});
export type DiscordUser = z.infer<typeof ZDiscordUser>;

export const ZDiscordGuildId =
  DiscordSnowflakeSchema.brand<"DiscordGuildId">("DiscordGuildId");
export type DiscordGuildId = z.infer<typeof ZDiscordGuildId>;

export const ZDiscordGuild = z.object({
  id: ZDiscordGuildId,
  name: z.string(),
  icon: z.string().nullable().optional(),
  owner_id: z.string().optional(),
  approximate_member_count: z.number().optional(),
});
export type DiscordGuild = z.infer<typeof ZDiscordGuild>;

export const ZDiscordGuildRoleId =
  DiscordSnowflakeSchema.brand<"DiscordGuildRoleId">("DiscordGuildRoleId");
export type DiscordGuildRoleId = z.infer<typeof ZDiscordGuildRoleId>;

export const ZDiscordGuildRole = z.object({
  id: z.string(),
  name: z.string(),
  color: z.number(),
  icon: z.string().nullable().optional(),
  permissions: z.string().optional(),
  position: z.number().optional(),
});
export type DiscordGuildRole = z.infer<typeof ZDiscordGuildRole>;

export const ZDiscordGuildMember = z.object({
  user: z.object({
    id: z.string(),
    username: z.string(),
    global_name: z.string().nullable().optional(),
    avatar: z.string().nullable().optional(),
    discriminator: z.string().optional(),
  }),
  roles: z.array(z.string()),
  nick: z.string().nullable().optional(),
  joined_at: z.string().optional(),
});
export type DiscordGuildMember = z.infer<typeof ZDiscordGuildMember>;

export const ZDiscordApplication = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  verify_key: z.string(),
  flags: z.number(),
  icon: z.string().nullable().optional(),
});
export type DiscordApplication = z.infer<typeof ZDiscordApplication>;

export const ZDiscordRateLimitResponse = z.object({
  message: z.string(),
  retry_after: z.number(),
  global: z.boolean(),
});
