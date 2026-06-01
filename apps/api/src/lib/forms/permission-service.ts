import { randomBytes, randomUUID } from "node:crypto";
import { db, user } from "@nexus-form/database";
import {
  form,
  formIntegration,
  formInvitation,
  formPermission,
  formShareLink,
} from "@nexus-form/database/schema";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { InsufficientFormPermissionError } from "../errors/form-errors";
import { resolveFormPermission } from "../permissions/form-access";

// ── Local type definitions (mirrors src/types/domain/form-permission) ──

type FormPermissionType = "OWNER" | "EDITOR" | "VIEWER";
type FormShareRole = "EDITOR" | "VIEWER";
type FormInvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELLED";

interface UserSummary {
  id: string;
  name: string | null;
  email: string;
  discord_id: string | null;
  created_at: string;
  updated_at: string;
}

interface FormPermissionWithUser {
  id: string;
  form_id: string;
  user_id: string;
  role: FormPermissionType;
  created_at: string;
  updated_at: string;
  user: UserSummary;
}

interface FormShareLinkResult {
  id: string;
  form_id: string;
  token: string;
  role: FormShareRole;
  is_active: boolean;
  expires_at?: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

interface FormInvitationWithInviter {
  id: string;
  form_id: string;
  email: string;
  role: FormPermissionType;
  token: string;
  status: FormInvitationStatus;
  message?: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  invited_by: string;
  inviter: UserSummary;
}

interface GetFormPermissionsRequest {
  form_id: string;
  page: number;
  limit: number;
  role?: FormPermissionType;
  user_id?: string;
}

interface GetFormPermissionsResponse {
  permissions: FormPermissionWithUser[];
  total: number;
  page: number;
  limit: number;
}

interface GetFormByShareLinkResponse {
  form: {
    id: string;
    title: string;
    description?: string;
  };
  role: FormShareRole;
  share_link: FormShareLinkResult;
}

export type PermissionRemovalErrorCode =
  | "FORM_NOT_FOUND"
  | "OWNER_PERMISSION_REMOVAL_FORBIDDEN"
  | "PERMISSION_NOT_FOUND";

export class PermissionRemovalError extends Error {
  constructor(
    readonly code: PermissionRemovalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PermissionRemovalError";
  }
}

// ── Implementation ──

/**
 * 暗号学的に安全なランダムトークンを生成
 */
function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString("base64url");
}

/**
 * フォーム権限一覧を取得
 */
export async function getFormPermissions(
  params: GetFormPermissionsRequest,
): Promise<GetFormPermissionsResponse> {
  const { form_id, page, limit, role, user_id } = params;

  // 検索条件を構築
  const conditions = [eq(formPermission.formId, form_id)];

  if (role) {
    conditions.push(eq(formPermission.role, role));
  }

  if (user_id) {
    conditions.push(eq(formPermission.userId, user_id));
  }

  const whereClause = and(...conditions);

  // 権限一覧を取得
  const [permissions, totalResult] = await Promise.all([
    db
      .select({
        id: formPermission.id,
        formId: formPermission.formId,
        userId: formPermission.userId,
        role: formPermission.role,
        createdAt: formPermission.createdAt,
        updatedAt: formPermission.updatedAt,
        userName: user.name,
        userEmail: user.email,
      })
      .from(formPermission)
      .innerJoin(user, eq(formPermission.userId, user.id))
      .where(whereClause)
      .orderBy(desc(formPermission.createdAt))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ count: count() }).from(formPermission).where(whereClause),
  ]);

  const total = totalResult[0]?.count ?? 0;

  return {
    permissions: permissions.map((permission) => ({
      id: permission.id,
      form_id: permission.formId,
      user_id: permission.userId,
      role: permission.role as FormPermissionType,
      created_at: permission.createdAt.toISOString(),
      updated_at: permission.updatedAt.toISOString(),
      user: {
        id: permission.userId,
        name: permission.userName,
        email: permission.userEmail,
        discord_id: null,
        created_at: "",
        updated_at: "",
      },
    })),
    total,
    page,
    limit,
  };
}

/**
 * 招待リンクを作成
 */
export async function createInvitation(
  formId: string,
  email: string,
  role: FormPermissionType,
  invitedBy: string,
  message?: string,
  expiresAt?: Date,
): Promise<FormInvitationWithInviter> {
  // デフォルトの有効期限は7日後
  const defaultExpiresAt = new Date();
  defaultExpiresAt.setDate(defaultExpiresAt.getDate() + 7);

  return await db.transaction(async (tx) => {
    // フォームの存在確認
    const [foundForm] = await tx
      .select({ id: form.id })
      .from(form)
      .where(eq(form.id, formId))
      .limit(1);

    if (!foundForm) {
      throw new Error("Form not found");
    }

    // 既存の招待がないかチェック
    const [existingInvitation] = await tx
      .select()
      .from(formInvitation)
      .where(
        and(eq(formInvitation.formId, formId), eq(formInvitation.email, email)),
      )
      .limit(1);

    // 既存の招待がある場合は削除（再招待を可能にする）
    if (existingInvitation) {
      if (existingInvitation.status === "PENDING") {
        throw new Error("Invitation already exists for this email");
      }
      // 過去の招待（ACCEPTED/EXPIRED/CANCELLED）を削除
      await tx
        .delete(formInvitation)
        .where(eq(formInvitation.id, existingInvitation.id));
    }

    // 招待トークンを生成
    const token = generateSecureToken();

    // 招待を作成
    await tx.insert(formInvitation).values({
      id: randomUUID(),
      formId,
      email,
      role,
      token,
      message: message || undefined,
      expiresAt: expiresAt || defaultExpiresAt,
      invitedBy,
    });

    // 作成した招待を取得
    const [invitation] = await tx
      .select()
      .from(formInvitation)
      .where(
        and(
          eq(formInvitation.formId, formId),
          eq(formInvitation.email, email),
          eq(formInvitation.token, token),
        ),
      )
      .limit(1);

    if (!invitation) {
      throw new Error("Failed to create invitation");
    }

    // 招待者情報を取得
    const [inviter] = await tx
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
      })
      .from(user)
      .where(eq(user.id, invitedBy))
      .limit(1);

    if (!inviter) {
      throw new Error("Inviter not found");
    }

    return {
      id: invitation.id,
      form_id: invitation.formId,
      email: invitation.email,
      role: invitation.role as FormPermissionType,
      token: invitation.token,
      status: invitation.status as FormInvitationStatus,
      message: invitation.message || undefined,
      expires_at: invitation.expiresAt.toISOString(),
      created_at: invitation.createdAt.toISOString(),
      updated_at: invitation.updatedAt.toISOString(),
      invited_by: invitation.invitedBy,
      inviter: {
        id: inviter.id,
        name: inviter.name,
        email: inviter.email,
        discord_id: null,
        created_at: "",
        updated_at: "",
      },
    };
  });
}

/**
 * 招待を承諾
 */
export async function acceptInvitation(
  token: string,
  userId: string,
): Promise<FormPermissionWithUser> {
  return await db.transaction(async (tx) => {
    // 招待を検索
    const [invitation] = await tx
      .select()
      .from(formInvitation)
      .where(eq(formInvitation.token, token))
      .limit(1);

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    // 招待の有効性をチェック
    if (invitation.status !== "PENDING") {
      throw new Error("Invitation is not pending");
    }

    if (invitation.expiresAt < new Date()) {
      throw new Error("Invitation has expired");
    }

    // ユーザーが存在するかチェック
    const [foundUser] = await tx
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!foundUser) {
      throw new Error("User not found");
    }

    // 招待先メールアドレスとユーザーのメールアドレスが一致するかチェック
    if (foundUser.email !== invitation.email) {
      throw new Error("Invitation email does not match user email");
    }

    // 既に権限が存在するかチェック
    const [existingPermission] = await tx
      .select()
      .from(formPermission)
      .where(
        and(
          eq(formPermission.formId, invitation.formId),
          eq(formPermission.userId, userId),
        ),
      )
      .limit(1);

    if (existingPermission) {
      throw new Error("User already has permission for this form");
    }

    // OWNER招待を禁止
    if (invitation.role === "OWNER") {
      throw new Error(
        "Owner invitations are not allowed. Use transfer ownership instead.",
      );
    }

    // 権限を作成
    await tx.insert(formPermission).values({
      id: randomUUID(),
      formId: invitation.formId,
      userId,
      role: invitation.role,
    });

    // 作成した権限を取得
    const [permission] = await tx
      .select({
        id: formPermission.id,
        formId: formPermission.formId,
        userId: formPermission.userId,
        role: formPermission.role,
        createdAt: formPermission.createdAt,
        updatedAt: formPermission.updatedAt,
        userName: user.name,
        userEmail: user.email,
      })
      .from(formPermission)
      .innerJoin(user, eq(formPermission.userId, user.id))
      .where(
        and(
          eq(formPermission.formId, invitation.formId),
          eq(formPermission.userId, userId),
        ),
      )
      .limit(1);

    if (!permission) {
      throw new Error("Failed to create permission");
    }

    // 招待を承諾済みに更新
    await tx
      .update(formInvitation)
      .set({ status: "ACCEPTED" })
      .where(eq(formInvitation.id, invitation.id));

    return {
      id: permission.id,
      form_id: permission.formId,
      user_id: permission.userId,
      role: permission.role as FormPermissionType,
      created_at: permission.createdAt.toISOString(),
      updated_at: permission.updatedAt.toISOString(),
      user: {
        id: permission.userId,
        name: permission.userName,
        email: permission.userEmail,
        discord_id: null,
        created_at: "",
        updated_at: "",
      },
    };
  });
}

/**
 * 匿名共有リンクを作成
 */
export async function createShareLink(
  formId: string,
  role: FormShareRole,
  createdBy: string,
  expiresAt?: Date,
): Promise<FormShareLinkResult> {
  return await db.transaction(async (tx) => {
    // フォームの存在確認
    const [foundForm] = await tx
      .select({ id: form.id })
      .from(form)
      .where(eq(form.id, formId))
      .limit(1);

    if (!foundForm) {
      throw new Error("Form not found");
    }

    // 共有トークンを生成
    const token = generateSecureToken();

    // 共有リンクを作成
    await tx.insert(formShareLink).values({
      id: randomUUID(),
      formId,
      token,
      role,
      expiresAt,
      createdBy,
    });

    // 作成した共有リンクを取得
    const [shareLink] = await tx
      .select()
      .from(formShareLink)
      .where(eq(formShareLink.token, token))
      .limit(1);

    if (!shareLink) {
      throw new Error("Failed to create share link");
    }

    return {
      id: shareLink.id,
      form_id: shareLink.formId,
      token: shareLink.token,
      role: shareLink.role as FormShareRole,
      is_active: shareLink.isActive,
      expires_at: shareLink.expiresAt?.toISOString(),
      created_at: shareLink.createdAt.toISOString(),
      updated_at: shareLink.updatedAt.toISOString(),
      created_by: shareLink.createdBy,
    };
  });
}

/**
 * 共有リンクを検証
 */
export async function validateShareLink(
  token: string,
): Promise<GetFormByShareLinkResponse> {
  const [shareLink] = await db
    .select({
      id: formShareLink.id,
      formId: formShareLink.formId,
      token: formShareLink.token,
      role: formShareLink.role,
      isActive: formShareLink.isActive,
      expiresAt: formShareLink.expiresAt,
      createdAt: formShareLink.createdAt,
      updatedAt: formShareLink.updatedAt,
      createdBy: formShareLink.createdBy,
      formTitle: form.title,
      formDescription: form.description,
    })
    .from(formShareLink)
    .innerJoin(form, eq(formShareLink.formId, form.id))
    .where(eq(formShareLink.token, token))
    .limit(1);

  if (!shareLink) {
    throw new Error("Share link not found");
  }

  if (!shareLink.isActive) {
    throw new Error("Share link is inactive");
  }

  if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
    throw new Error("Share link has expired");
  }

  return {
    form: {
      id: shareLink.formId,
      title: shareLink.formTitle,
      description: shareLink.formDescription || undefined,
    },
    role: shareLink.role as FormShareRole,
    share_link: {
      id: shareLink.id,
      form_id: shareLink.formId,
      token: shareLink.token,
      role: shareLink.role as FormShareRole,
      is_active: shareLink.isActive,
      expires_at: shareLink.expiresAt?.toISOString(),
      created_at: shareLink.createdAt.toISOString(),
      updated_at: shareLink.updatedAt.toISOString(),
      created_by: shareLink.createdBy,
    },
  };
}

/**
 * 権限を削除（OWNER削除は禁止）
 */
export async function removePermission(
  formId: string,
  userId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // フォームの存在確認
    const [foundForm] = await tx
      .select({ id: form.id })
      .from(form)
      .where(eq(form.id, formId))
      .limit(1);

    if (!foundForm) {
      throw new PermissionRemovalError("FORM_NOT_FOUND", "Form not found");
    }

    // 削除対象の権限を取得
    const [targetPermission] = await tx
      .select()
      .from(formPermission)
      .where(
        and(
          eq(formPermission.formId, formId),
          eq(formPermission.userId, userId),
        ),
      )
      .limit(1);

    if (!targetPermission) {
      throw new PermissionRemovalError(
        "PERMISSION_NOT_FOUND",
        "Permission not found",
      );
    }

    // OWNER削除を完全に禁止
    if (targetPermission.role === "OWNER") {
      throw new PermissionRemovalError(
        "OWNER_PERMISSION_REMOVAL_FORBIDDEN",
        "Cannot remove owner permission. Use transfer ownership instead.",
      );
    }

    // 権限を削除
    await tx
      .delete(formPermission)
      .where(
        and(
          eq(formPermission.formId, formId),
          eq(formPermission.userId, userId),
        ),
      );

    await tx
      .update(formShareLink)
      .set({ isActive: false })
      .where(
        and(
          eq(formShareLink.formId, formId),
          eq(formShareLink.createdBy, userId),
          eq(formShareLink.isActive, true),
        ),
      );
  });

  const { publishSseAccessRevoked } = await import("../redis-publisher");
  await publishSseAccessRevoked(formId, userId);
}

/**
 * 所有者を譲渡
 */
export async function transferOwnership(
  formId: string,
  newOwnerId: string,
  currentOwnerId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // フォームの存在確認
    const [foundForm] = await tx
      .select({ id: form.id })
      .from(form)
      .where(eq(form.id, formId))
      .for("update")
      .limit(1);

    if (!foundForm) {
      throw new Error("Form not found");
    }

    // 同一ユーザーへの譲渡の場合は早期リターン
    if (newOwnerId === currentOwnerId) {
      return;
    }

    // 現在の所有者の権限を確認
    const [currentOwnerPermission] = await tx
      .select()
      .from(formPermission)
      .where(
        and(
          eq(formPermission.formId, formId),
          eq(formPermission.userId, currentOwnerId),
        ),
      )
      .limit(1);

    if (currentOwnerPermission?.role !== "OWNER") {
      throw new Error("Current user is not the owner");
    }

    // 新しい所有者のユーザー存在確認
    const [newOwnerUser] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, newOwnerId))
      .limit(1);
    if (!newOwnerUser) {
      const err = new Error("New owner user not found");
      (err as { code?: string }).code = "NEW_OWNER_NOT_FOUND";
      throw err;
    }

    // 新しい所有者の権限を確認
    const [newOwnerPermission] = await tx
      .select()
      .from(formPermission)
      .where(
        and(
          eq(formPermission.formId, formId),
          eq(formPermission.userId, newOwnerId),
        ),
      )
      .limit(1);

    // 新しい所有者に権限がない場合は作成
    if (!newOwnerPermission) {
      await tx.insert(formPermission).values({
        id: randomUUID(),
        formId,
        userId: newOwnerId,
        role: "OWNER",
      });
    } else {
      // 既存の権限をOWNERに更新
      await tx
        .update(formPermission)
        .set({ role: "OWNER" })
        .where(
          and(
            eq(formPermission.formId, formId),
            eq(formPermission.userId, newOwnerId),
          ),
        );
    }

    // 元の所有者をEDITORに降格
    await tx
      .update(formPermission)
      .set({ role: "EDITOR" })
      .where(
        and(
          eq(formPermission.formId, formId),
          eq(formPermission.userId, currentOwnerId),
        ),
      );

    // フォームの作成者を更新
    await tx
      .update(form)
      .set({ creatorId: newOwnerId })
      .where(eq(form.id, formId));

    await tx
      .update(formIntegration)
      .set({
        ownerUserId: newOwnerId,
        userId: newOwnerId,
      })
      .where(eq(formIntegration.formId, formId));
  });
}

/**
 * 権限レベルを変更（OWNER昇格・降格は禁止）
 */
export async function updatePermissionRole(
  formId: string,
  userId: string,
  newRole: FormPermissionType,
): Promise<FormPermissionWithUser> {
  const { permission, shouldRevokeEditorAccess } = await db.transaction(
    async (tx) => {
      // フォームの存在確認
      const [foundForm] = await tx
        .select({ id: form.id })
        .from(form)
        .where(eq(form.id, formId))
        .limit(1);

      if (!foundForm) {
        throw new Error("Form not found");
      }

      // 現在の権限を取得
      const [currentPermission] = await tx
        .select()
        .from(formPermission)
        .where(
          and(
            eq(formPermission.formId, formId),
            eq(formPermission.userId, userId),
          ),
        )
        .limit(1);

      if (!currentPermission) {
        throw new Error("Permission not found");
      }

      // OWNER昇格・降格を禁止
      if (newRole === "OWNER" || currentPermission.role === "OWNER") {
        throw new Error(
          "Cannot change owner role. Use transfer ownership instead.",
        );
      }

      // VIEWER⇔EDITOR間の変更のみ許可
      if (newRole !== "VIEWER" && newRole !== "EDITOR") {
        throw new Error("Invalid role. Only VIEWER and EDITOR are allowed.");
      }

      const shouldRevokeEditorAccess =
        currentPermission.role === "EDITOR" && newRole === "VIEWER";

      // 権限を更新
      await tx
        .update(formPermission)
        .set({ role: newRole })
        .where(
          and(
            eq(formPermission.formId, formId),
            eq(formPermission.userId, userId),
          ),
        );

      if (newRole === "VIEWER") {
        await tx
          .update(formShareLink)
          .set({ isActive: false })
          .where(
            and(
              eq(formShareLink.formId, formId),
              eq(formShareLink.createdBy, userId),
              eq(formShareLink.isActive, true),
              eq(formShareLink.role, "EDITOR"),
            ),
          );
      }

      // 更新した権限を取得
      const [updatedPermission] = await tx
        .select({
          id: formPermission.id,
          formId: formPermission.formId,
          userId: formPermission.userId,
          role: formPermission.role,
          createdAt: formPermission.createdAt,
          updatedAt: formPermission.updatedAt,
          userName: user.name,
          userEmail: user.email,
        })
        .from(formPermission)
        .innerJoin(user, eq(formPermission.userId, user.id))
        .where(
          and(
            eq(formPermission.formId, formId),
            eq(formPermission.userId, userId),
          ),
        )
        .limit(1);

      if (!updatedPermission) {
        throw new Error("Failed to update permission");
      }

      return {
        permission: {
          id: updatedPermission.id,
          form_id: updatedPermission.formId,
          user_id: updatedPermission.userId,
          role: updatedPermission.role as FormPermissionType,
          created_at: updatedPermission.createdAt.toISOString(),
          updated_at: updatedPermission.updatedAt.toISOString(),
          user: {
            id: updatedPermission.userId,
            name: updatedPermission.userName,
            email: updatedPermission.userEmail,
            discord_id: null,
            created_at: "",
            updated_at: "",
          },
        },
        shouldRevokeEditorAccess,
      };
    },
  );

  if (shouldRevokeEditorAccess) {
    const { publishSseAccessRevoked } = await import("../redis-publisher");
    await publishSseAccessRevoked(formId, userId);
  }

  return permission;
}

/**
 * 招待一覧を取得
 */
export async function getFormInvitations(
  formId: string,
  page: number = 1,
  limit: number = 20,
  status?: FormInvitationStatus,
): Promise<{
  invitations: FormInvitationWithInviter[];
  total: number;
  page: number;
  limit: number;
}> {
  // 検索条件を構築
  const conditions = [eq(formInvitation.formId, formId)];

  if (status) {
    conditions.push(eq(formInvitation.status, status));
  }

  const whereClause = and(...conditions);

  // 招待一覧を取得
  const [invitations, totalResult] = await Promise.all([
    db
      .select()
      .from(formInvitation)
      .where(whereClause)
      .orderBy(desc(formInvitation.createdAt))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ count: count() }).from(formInvitation).where(whereClause),
  ]);

  const total = totalResult[0]?.count ?? 0;

  // 招待者情報を取得
  const inviterIds = [...new Set(invitations.map((inv) => inv.invitedBy))];
  const inviters =
    inviterIds.length > 0
      ? await db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
          })
          .from(user)
          .where(inArray(user.id, inviterIds))
      : [];

  const inviterMap = new Map(inviters.map((inviter) => [inviter.id, inviter]));

  return {
    invitations: invitations.map((invitation) => {
      const inviter = inviterMap.get(invitation.invitedBy);
      if (!inviter) {
        throw new Error("Inviter not found");
      }

      return {
        id: invitation.id,
        form_id: invitation.formId,
        email: invitation.email,
        role: invitation.role as FormPermissionType,
        token: invitation.token,
        status: invitation.status as FormInvitationStatus,
        message: invitation.message || undefined,
        expires_at: invitation.expiresAt.toISOString(),
        created_at: invitation.createdAt.toISOString(),
        updated_at: invitation.updatedAt.toISOString(),
        invited_by: invitation.invitedBy,
        inviter: {
          id: inviter.id,
          name: inviter.name,
          email: inviter.email,
          discord_id: null,
          created_at: "",
          updated_at: "",
        },
      };
    }),
    total,
    page,
    limit,
  };
}

/**
 * 招待を削除（キャンセル）
 */
export async function cancelInvitation(
  invitationId: string,
  userId: string,
  formId?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // 招待を取得（フォームの作成者も取得）
    const [invitation] = await tx
      .select({
        id: formInvitation.id,
        formId: formInvitation.formId,
        invitedBy: formInvitation.invitedBy,
        status: formInvitation.status,
        formCreatorId: form.creatorId,
      })
      .from(formInvitation)
      .innerJoin(form, eq(formInvitation.formId, form.id))
      .where(eq(formInvitation.id, invitationId))
      .limit(1);

    if (!invitation) {
      throw new Error("Invitation not found");
    }

    // フォームIDの整合性をチェック（指定されている場合）
    if (formId && invitation.formId !== formId) {
      throw new Error("Invitation does not belong to the specified form");
    }

    // フォームの所有者または招待者本人のみが削除可能
    const isOwner = invitation.formCreatorId === userId;
    const isInviter = invitation.invitedBy === userId;

    if (!isOwner && !isInviter) {
      throw new Error("Insufficient permissions to cancel this invitation");
    }

    // 既に承諾済みの招待は削除不可
    if (invitation.status === "ACCEPTED") {
      throw new Error("Cannot cancel an accepted invitation");
    }

    if (isInviter && !isOwner) {
      const [currentPermission] = await tx
        .select({ role: formPermission.role })
        .from(formPermission)
        .where(
          and(
            eq(formPermission.formId, invitation.formId),
            eq(formPermission.userId, userId),
          ),
        )
        .for("update")
        .limit(1);

      if (
        !currentPermission ||
        (currentPermission.role !== "OWNER" &&
          currentPermission.role !== "EDITOR")
      ) {
        throw new InsufficientFormPermissionError(
          invitation.formId,
          "EDITOR",
          currentPermission?.role ?? null,
        );
      }
    }

    // 招待を削除
    await tx.delete(formInvitation).where(eq(formInvitation.id, invitationId));
  });
}

/**
 * 共有リンク一覧を取得
 */
export async function getShareLinks(
  formId: string,
  page: number = 1,
  limit: number = 20,
  isActive?: boolean,
): Promise<{
  share_links: FormShareLinkResult[];
  total: number;
  page: number;
  limit: number;
}> {
  // 検索条件を構築
  const conditions = [eq(formShareLink.formId, formId)];

  if (isActive !== undefined) {
    conditions.push(eq(formShareLink.isActive, isActive));
  }

  const whereClause = and(...conditions);

  // 共有リンク一覧を取得
  const [shareLinks, totalResult] = await Promise.all([
    db
      .select()
      .from(formShareLink)
      .where(whereClause)
      .orderBy(desc(formShareLink.createdAt))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ count: count() }).from(formShareLink).where(whereClause),
  ]);

  const total = totalResult[0]?.count ?? 0;

  return {
    share_links: shareLinks.map((link) => ({
      id: link.id,
      form_id: link.formId,
      token: link.token,
      role: link.role as FormShareRole,
      is_active: link.isActive,
      expires_at: link.expiresAt?.toISOString(),
      created_at: link.createdAt.toISOString(),
      updated_at: link.updatedAt.toISOString(),
      created_by: link.createdBy,
    })),
    total,
    page,
    limit,
  };
}

/**
 * 共有リンクを更新
 */
export async function updateShareLink(
  shareLinkId: string,
  formId: string,
  updates: {
    isActive?: boolean;
    expiresAt?: Date;
  },
): Promise<FormShareLinkResult> {
  return await db.transaction(async (tx) => {
    // 共有リンクの存在確認（フォームIDも含めて検証）
    const [existingLink] = await tx
      .select()
      .from(formShareLink)
      .where(eq(formShareLink.id, shareLinkId))
      .limit(1);

    if (!existingLink) {
      throw new Error("Share link not found");
    }

    // フォームIDの照合
    if (existingLink.formId !== formId) {
      throw new Error("Share link not found");
    }

    // 更新データを構築
    const updateData: Partial<{
      isActive: boolean;
      expiresAt: Date;
    }> = {};
    if (updates.isActive !== undefined) {
      updateData.isActive = updates.isActive;
    }
    if (updates.expiresAt !== undefined) {
      updateData.expiresAt = updates.expiresAt;
    }

    // 共有リンクを更新
    await tx
      .update(formShareLink)
      .set(updateData)
      .where(eq(formShareLink.id, shareLinkId));

    // 更新後のリンクを取得
    const [updatedLink] = await tx
      .select()
      .from(formShareLink)
      .where(eq(formShareLink.id, shareLinkId))
      .limit(1);

    if (!updatedLink) {
      throw new Error("Failed to update share link");
    }

    return {
      id: updatedLink.id,
      form_id: updatedLink.formId,
      token: updatedLink.token,
      role: updatedLink.role as FormShareRole,
      is_active: updatedLink.isActive,
      expires_at: updatedLink.expiresAt?.toISOString(),
      created_at: updatedLink.createdAt.toISOString(),
      updated_at: updatedLink.updatedAt.toISOString(),
      created_by: updatedLink.createdBy,
    };
  });
}

/**
 * 共有リンクを削除
 */
export async function deleteShareLink(
  shareLinkId: string,
  formId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    // 共有リンクの存在確認（フォームIDも含めて検証）
    const [existingLink] = await tx
      .select()
      .from(formShareLink)
      .where(eq(formShareLink.id, shareLinkId))
      .limit(1);

    if (!existingLink) {
      throw new Error("Share link not found");
    }

    // フォームIDの照合
    if (existingLink.formId !== formId) {
      throw new Error("Share link not found");
    }

    // 共有リンクを削除
    await tx.delete(formShareLink).where(eq(formShareLink.id, shareLinkId));
  });
}

/**
 * ユーザーのフォーム権限を取得
 */
export async function getUserFormPermission(
  userId: string,
  formId: string,
  context?: {
    auth_type: "api_token" | "session";
    form_ids?: string[];
  },
): Promise<FormPermissionType | null> {
  // まず共通の実効権限を解決（Form.creatorId を OWNER として扱う）
  const resolution = await resolveFormPermission({ userId, formId });
  const resolvedRole = resolution.role as FormPermissionType | null;

  // APIトークン認証時は form_ids 制限を適用
  if (context?.auth_type === "api_token") {
    if (!resolvedRole) return null;
    if (!context.form_ids || context.form_ids.length === 0) {
      return resolvedRole;
    }
    return context.form_ids.includes(formId) ? resolvedRole : null;
  }

  // セッション/共有リンク/デフォルトは解決済みの権限を返す
  return resolvedRole;
}

/**
 * ユーザーがフォームの共有リンクを作成・管理できる権限を持っているかチェック
 * OWNER/EDITOR/VIEWER が共有リンクを閲覧・管理可能
 * APIトークン認証の場合も、実際のユーザー権限を取得して判定
 */
export async function checkShareLinkPermission(
  userId: string,
  formId: string,
  context?: {
    auth_type: "api_token" | "session";
    form_ids?: string[];
  },
): Promise<boolean> {
  const userRole = await getUserFormPermission(userId, formId, context);

  if (!userRole) {
    return false;
  }

  // OWNER/EDITOR/VIEWER が共有リンクの閲覧・管理可能
  return userRole === "OWNER" || userRole === "EDITOR" || userRole === "VIEWER";
}

/**
 * 共有リンクのroleがユーザーの権限を超えていないかチェック
 * ユーザーは自分より強い権限の共有リンクを作成できない
 */
export function validateShareLinkRole(
  requestedRole: FormShareRole,
  userRole: FormPermissionType,
): boolean {
  // ユーザーがOWNERの場合は制限なし
  if (userRole === "OWNER") {
    return true;
  }

  // ユーザーがEDITORの場合は、EDITOR/VIEWERの共有リンクのみ作成可能
  if (userRole === "EDITOR") {
    return requestedRole === "EDITOR" || requestedRole === "VIEWER";
  }

  // ユーザーがVIEWERの場合は、VIEWERの共有リンクのみ作成可能
  if (userRole === "VIEWER") {
    return requestedRole === "VIEWER";
  }

  return false;
}
