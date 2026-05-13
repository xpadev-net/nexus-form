import { db, user } from "@nexus-form/database";
import { form, formPermission } from "@nexus-form/database/schema";
import { and, eq } from "drizzle-orm";
import { FORM_ROLE_PRIORITY, type FormPermissionRole } from "./constants";

type FormPermissionCompositeKey = {
  formId: string;
  userId: string;
};

export enum FormPermissionSource {
  NONE = "NONE",
  GLOBAL_ROLE = "GLOBAL_ROLE",
  FORM_CREATOR = "FORM_CREATOR",
  ASSIGNED = "ASSIGNED",
  DISCORD_MAPPING = "DISCORD_MAPPING",
}

export interface FormPermissionResolution {
  role: FormPermissionRole | null;
  source: FormPermissionSource;
  formExists: boolean;
}

export interface FormPermissionCheckOptions {
  requiredRole?: FormPermissionRole;
}

export interface FormPermissionCheckResult {
  hasPermission: boolean;
  effectiveRole: FormPermissionRole | null;
  requiredRole: FormPermissionRole;
  source: FormPermissionSource;
  formExists: boolean;
}

export function formRoleSatisfies(
  required: FormPermissionRole,
  actual: FormPermissionRole | null,
): boolean {
  if (!actual) {
    return false;
  }

  return FORM_ROLE_PRIORITY[actual] >= FORM_ROLE_PRIORITY[required];
}

export async function resolveFormPermission(
  key: FormPermissionCompositeKey,
): Promise<FormPermissionResolution> {
  try {
    const [userRows, formRows, assignmentRows] = await Promise.all([
      db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, key.userId))
        .limit(1),
      db
        .select({ creatorId: form.creatorId })
        .from(form)
        .where(eq(form.id, key.formId))
        .limit(1),
      db
        .select({ role: formPermission.role })
        .from(formPermission)
        .where(
          and(
            eq(formPermission.formId, key.formId),
            eq(formPermission.userId, key.userId),
          ),
        )
        .limit(1),
    ]);

    const [foundUser] = userRows;
    const [foundForm] = formRows;
    const [assignment] = assignmentRows;

    if (!foundUser) {
      return {
        role: null,
        source: FormPermissionSource.NONE,
        formExists: Boolean(foundForm),
      };
    }

    if (!foundForm) {
      return {
        role: null,
        source: FormPermissionSource.NONE,
        formExists: false,
      };
    }

    if (foundForm.creatorId === key.userId) {
      return {
        role: "OWNER",
        source: FormPermissionSource.FORM_CREATOR,
        formExists: true,
      };
    }

    if (assignment) {
      return {
        role: assignment.role as FormPermissionRole,
        source: FormPermissionSource.ASSIGNED,
        formExists: true,
      };
    }

    return {
      role: null,
      source: FormPermissionSource.NONE,
      formExists: true,
    };
  } catch (error) {
    throw new Error(
      `Failed to resolve form permission: ${error instanceof Error ? error.message : "Unknown error"}`,
      error instanceof Error ? { cause: error } : undefined,
    );
  }
}

export async function checkUserFormPermission(
  key: FormPermissionCompositeKey,
  options: FormPermissionCheckOptions = {},
): Promise<FormPermissionCheckResult> {
  const requiredRole: FormPermissionRole = options.requiredRole ?? "VIEWER";
  const resolution = await resolveFormPermission(key);
  const effectiveRole = resolution.role;
  const source = resolution.source;

  return {
    hasPermission: formRoleSatisfies(requiredRole, effectiveRole),
    effectiveRole,
    requiredRole,
    source,
    formExists: resolution.formExists,
  };
}

/**
 * フォーム権限チェック用のヘルパー関数群
 */

/**
 * フォーム編集権限をチェックする（OWNER または EDITOR）
 */
export async function checkFormEditPermission(
  key: FormPermissionCompositeKey,
  options: FormPermissionCheckOptions = {},
): Promise<FormPermissionCheckResult> {
  return checkUserFormPermission(key, {
    ...options,
    requiredRole: "EDITOR",
  });
}

/**
 * フォーム削除権限をチェックする（OWNER のみ）
 */
export async function checkFormDeletePermission(
  key: FormPermissionCompositeKey,
  options: FormPermissionCheckOptions = {},
): Promise<FormPermissionCheckResult> {
  return checkUserFormPermission(key, {
    ...options,
    requiredRole: "OWNER",
  });
}

/**
 * フォーム閲覧権限をチェックする（すべての権限レベル）
 */
export async function checkFormViewPermission(
  key: FormPermissionCompositeKey,
  options: FormPermissionCheckOptions = {},
): Promise<FormPermissionCheckResult> {
  return checkUserFormPermission(key, {
    ...options,
    requiredRole: "VIEWER",
  });
}

/**
 * 回答閲覧権限をチェックする（OWNER または EDITOR）
 */
export async function checkResponseViewPermission(
  key: FormPermissionCompositeKey,
  options: FormPermissionCheckOptions = {},
): Promise<FormPermissionCheckResult> {
  return checkUserFormPermission(key, {
    ...options,
    requiredRole: "VIEWER",
  });
}

/**
 * ブロック編集権限をチェックする（OWNER または EDITOR）
 */
export async function checkBlockEditPermission(
  key: FormPermissionCompositeKey,
  options: FormPermissionCheckOptions = {},
): Promise<FormPermissionCheckResult> {
  return checkUserFormPermission(key, {
    ...options,
    requiredRole: "EDITOR",
  });
}
