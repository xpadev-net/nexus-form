import { z } from "zod";
import { UserSummary } from "./user";

// フォーム権限の種類
export const FormPermissionType = z.enum(["OWNER", "EDITOR", "VIEWER"]);
export type FormPermissionType = z.infer<typeof FormPermissionType>;

// フォーム権限（基本）
export const FormPermission = z.object({
  id: z.string(),
  form_id: z.string(),
  user_id: z.string(),
  role: FormPermissionType,
  created_at: z.string(),
  updated_at: z.string(),
});

export type FormPermission = z.infer<typeof FormPermission>;

// ユーザー情報付き権限
export const FormPermissionWithUser = FormPermission.extend({
  user: UserSummary,
});

export type FormPermissionWithUser = z.infer<typeof FormPermissionWithUser>;

// フォーム共有リンク
export const FormShareRole = z.enum(["EDITOR", "VIEWER"]);
export type FormShareRole = z.infer<typeof FormShareRole>;

// フォーム共有リンク
export const FormShareLink = z.object({
  id: z.string(),
  form_id: z.string(),
  token: z.string(),
  role: FormShareRole,
  is_active: z.boolean().default(true),
  expires_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string(),
});

export type FormShareLink = z.infer<typeof FormShareLink>;

// 招待の状態
export const FormInvitationStatus = z.enum([
  "PENDING",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "CANCELLED",
]);
export type FormInvitationStatus = z.infer<typeof FormInvitationStatus>;

// フォーム招待
export const FormInvitation = z.object({
  id: z.string(),
  form_id: z.string(),
  email: z.string().email(),
  role: FormPermissionType,
  token: z.string(),
  status: FormInvitationStatus,
  message: z.string().optional(),
  expires_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  invited_by: z.string(),
});

export type FormInvitation = z.infer<typeof FormInvitation>;

// 招待者情報付き招待
export const FormInvitationWithInviter = FormInvitation.extend({
  inviter: UserSummary,
});

export type FormInvitationWithInviter = z.infer<
  typeof FormInvitationWithInviter
>;

// フォーム権限一覧レスポンス
export const FormPermissionListResponse = z.object({
  permissions: z.array(FormPermissionWithUser),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});

export type FormPermissionListResponse = z.infer<
  typeof FormPermissionListResponse
>;

// フォーム共有リンク一覧レスポンス
export const FormShareLinkListResponse = z.object({
  share_links: z.array(FormShareLink),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});

export type FormShareLinkListResponse = z.infer<
  typeof FormShareLinkListResponse
>;

// フォーム招待一覧レスポンス
export const FormInvitationListResponse = z.object({
  invitations: z.array(FormInvitationWithInviter),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});

export type FormInvitationListResponse = z.infer<
  typeof FormInvitationListResponse
>;
