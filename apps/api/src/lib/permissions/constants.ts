// Form permission role priority
// Replaces Prisma's FormPermissionRole enum with string literals
export type FormPermissionRole = "OWNER" | "EDITOR" | "VIEWER";

type FormRolePriorityMap = Record<FormPermissionRole, number>;

// 優先度: OWNER > EDITOR > VIEWER
export const FORM_ROLE_PRIORITY: FormRolePriorityMap = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
};

export function isValidFormPermissionRole(
  role: FormPermissionRole | null | undefined,
): role is FormPermissionRole {
  return Boolean(role && FORM_ROLE_PRIORITY[role] != null);
}

export function compareFormPermissionRole(
  a: FormPermissionRole,
  b: FormPermissionRole,
): number {
  return FORM_ROLE_PRIORITY[b] - FORM_ROLE_PRIORITY[a];
}
