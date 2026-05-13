import { z } from "zod";

export const UserSummary = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().email(),
  discord_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type UserSummary = z.infer<typeof UserSummary>;

export const UserDetail = UserSummary.extend({
  image: z.string().nullable(),
  email_verified: z.string().nullable(),
  stats: z
    .object({
      forms_owned: z.number().int().nonnegative(),
      form_permissions: z.number().int().nonnegative(),
      active_tokens: z.number().int().nonnegative(),
    })
    .default({
      forms_owned: 0,
      form_permissions: 0,
      active_tokens: 0,
    }),
});

export type UserDetail = z.infer<typeof UserDetail>;

export const UserListResponse = z.object({
  users: z.array(UserSummary),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});

export type UserListResponse = z.infer<typeof UserListResponse>;

export const UserDetailResponse = z.object({
  user: UserDetail,
});

export type UserDetailResponse = z.infer<typeof UserDetailResponse>;
